require('dotenv').config({ path: __dirname + '/../primer.env' }); // Путь к .env файлу

const { Telegraf, session, Markup } = require('telegraf');
const LocalSession = require('telegraf-session-local');
const connectDB = require('./config/db');
const User = require('./models/User'); // Добавлен импорт модели User для middleware

// Импорт контроллеров
const userController = require('./controllers/userController'); 
const { handlePhoto, handleApprove, handleReject } = require('./controllers/paymentController');
// Обновленный импорт: добавлены broadcastMessage и checkAdminMenu
const { checkPayments, stats, checkAdmin, broadcastMessage, checkAdminMenu } = require('./controllers/adminController'); 
const { handleQuestion, handleAnswer, listQuestions } = require('./controllers/questionController');
const vpnController = require('./controllers/vpnController'); // Предполагаю, что у вас есть vpnController
const { setupReminders } = require('./services/reminderService');


const bot = new Telegraf(process.env.BOT_TOKEN, {
  telegram: {
    agent: null,
    handshakeTimeout: 30000
  }
});

// Использование LocalSession для хранения данных сессии
bot.use((new LocalSession({ database: 'session_db.json' })).middleware());

// Подключение к MongoDB
connectDB().catch(err => {
  console.error('❌ MongoDB connection failed:', err);
  process.exit(1);
});

// Обработка необработанных ошибок и отклонений промисов
process.on('unhandledRejection', (err) => {
  console.error('⚠️ Unhandled Rejection:', err);
});
process.on('uncaughtException', async (err) => {
  console.error('⚠️ Uncaught Exception:', err);
  // Опционально: отправить уведомление админу о критической ошибке
  // await bot.telegram.sendMessage(process.env.ADMIN_ID, `🚨 Uncaught Exception: ${err.message}`).catch(e => console.error("Error sending exception to admin:", e));
  await bot.stop();
  process.exit(1);
});

// --- Middleware для обработки состояний ожидания (до всех команд и текстовых обработчиков) ---
bot.use(async (ctx, next) => {
  // Отладочные логи
  console.log(`[Middleware Debug] Сообщение от: ${ctx.from?.id}`);
  console.log(`[Middleware Debug] awaitingAnswerFor: ${ctx.session?.awaitingAnswerFor}`);
  console.log(`[Middleware Debug] awaitingVpnFileFor: ${ctx.session?.awaitingVpnFileFor}`);
  console.log(`[Middleware Debug] awaitingVpnVideoFor: ${ctx.session?.awaitingVpnVideoFor}`);
  console.log(`[Middleware Debug] awaitingAnswerVpnIssueFor: ${ctx.session?.awaitingAnswerVpnIssueFor}`);
  console.log(`[Middleware Debug] awaitingVpnTroubleshoot: ${ctx.session?.awaitingVpnTroubleshoot}`);
  console.log(`[Middleware Debug] Тип сообщения: ${Object.keys(ctx.message || {}).join(', ')}`); // Более наглядный вывод типа сообщения

  // Логика для АДМИНА
  if (ctx.from?.id === parseInt(process.env.ADMIN_ID)) {
    // 1. Обработка ответа на обычный вопрос от админа
    if (ctx.session?.awaitingAnswerFor && ctx.message?.text) {
      console.log(`[AdminMiddleware] Обработка ответа на вопрос для пользователя ${ctx.session.awaitingAnswerFor}`);
      await handleAnswer(ctx); 
      return; // Останавливаем дальнейшую обработку, сообщение обработано
    }

    // 2. Обработка отправки ФАЙЛА инструкции от админа
    if (ctx.session?.awaitingVpnFileFor && ctx.message?.document) {
      const targetUserId = ctx.session.awaitingVpnFileFor;
      try {
        console.log(`[AdminMiddleware] Отправка файла пользователю ${targetUserId}`);
        await ctx.telegram.sendDocument(targetUserId, ctx.message.document.file_id, {
          caption: '📁 Ваш файл конфигурации VPN:'
        });
        await ctx.reply(`✅ Файл конфигурации успешно отправлен пользователю ${targetUserId}.`);

        ctx.session.awaitingVpnFileFor = null;
        ctx.session.awaitingVpnVideoFor = targetUserId; // Переходим к ожиданию видео
        await ctx.reply('Теперь, пожалуйста, загрузите видеоинструкцию для этого пользователя:');
      } catch (error) {
        console.error(`Ошибка при отправке файла пользователю ${targetUserId}:`, error);
        await ctx.reply(`⚠️ Произошла ошибка при отправке файла пользователю ${targetUserId}.`);
      } finally {
        // В любом случае сбрасываем, чтобы не застрять в ожидании
        ctx.session.awaitingVpnFileFor = null; 
      }
      return; // Останавливаем дальнейшую обработку
    }

    // 3. Обработка отправки ВИДЕО инструкции от админа
    if (ctx.session?.awaitingVpnVideoFor && ctx.message?.video) {
      const targetUserId = ctx.session.awaitingVpnVideoFor;
      try {
        console.log(`[AdminMiddleware] Отправка видео пользователю ${targetUserId}`);
        await ctx.telegram.sendVideo(targetUserId, ctx.message.video.file_id, {
          caption: '🎬 Видеоинструкция по настройке VPN:'
        });
        await ctx.reply(`✅ Видеоинструкция успешно отправлена пользователю ${targetUserId}.`);

        // Кнопки для пользователя: "Успешно настроил" и "Не справился"
        await ctx.telegram.sendMessage(
          targetUserId,
          'Если вы успешно настроили VPN, пожалуйста, нажмите кнопку ниже. Если у вас возникли проблемы:',
          Markup.inlineKeyboard([
            [
              Markup.button.callback('✅ Успешно настроил', `vpn_configured_${targetUserId}`),
              Markup.button.callback('❌ Не справился с настройкой', `vpn_failed_${targetUserId}`)
            ]
          ])
        );
      } catch (error) {
        console.error(`Ошибка при отправке видео пользователю ${targetUserId}:`, error);
        await ctx.reply(`⚠️ Произошла ошибка при отправке видео пользователю ${targetUserId}.`);
      } finally {
        // В любом случае сбрасываем
        ctx.session.awaitingVpnVideoFor = null; 
      }
      return; // Останавливаем дальнейшую обработку
    }

    // 4. Обработка ответа админа на проблему с VPN
    if (ctx.session?.awaitingAnswerVpnIssueFor && ctx.message?.text) {
      const targetUserId = ctx.session.awaitingAnswerVpnIssueFor;
      const adminAnswer = ctx.message.text;
      
      try {
        await ctx.telegram.sendMessage(
          targetUserId,
          `🛠️ *Ответ администратора по вашей проблеме с настройкой VPN:*\n\n` +
          `"${adminAnswer}"`,
          { parse_mode: 'Markdown' }
        );
        await ctx.reply(`✅ Ваш ответ успешно отправлен пользователю ${targetUserId}.`);
      } catch (error) {
        console.error(`Ошибка при отправке ответа на проблему VPN пользователю ${targetUserId}:`, error);
        await ctx.reply(`⚠️ Произошла ошибка при отправке ответа.`);
      } finally {
        ctx.session.awaitingAnswerVpnIssueFor = null; 
      }
      return; // Останавливаем дальнейшую обработку
    }

    // Если это команда (например, /broadcast) от админа, пропускаем её дальше по цепочке
    if (ctx.message?.text?.startsWith('/')) {
        return next();
    }

    // Если сообщение админа не является командой и не соответствует ни одному ожидающему состоянию
    if (ctx.message) {
      console.log(`[AdminMiddleware] Сообщение админа не соответствует текущему состоянию ожидания: ${JSON.stringify(ctx.message)}`);
    }
  }

  // Логика для обычного пользователя: ожидание описания проблемы с VPN
  if (ctx.session?.awaitingVpnTroubleshoot && ctx.from?.id === ctx.session.awaitingVpnTroubleshoot && ctx.message?.text) {
    const userId = ctx.from.id;
    const problemDescription = ctx.message.text;
    const user = await User.findOne({ userId }); 

    let userName = user?.firstName || user?.username || 'Без имени';
    if (user?.username) {
        userName = `${userName} (@${user.username})`;
    }

    // Уведомление администратора
    await ctx.telegram.sendMessage(
      process.env.ADMIN_ID,
      `🚨 *Проблема с настройкой VPN от пользователя ${userName} (ID: ${userId}):*\n\n` +
      `"${problemDescription}"`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '➡️ Ответить пользователю', callback_data: `answer_vpn_issue_${userId}` }]
          ]
        }
      }
    );
    
    await ctx.reply('✅ Ваше описание проблемы отправлено администратору. Он свяжется с вами для дальнейших инструкций.');
    
    ctx.session.awaitingVpnTroubleshoot = null; // Сбрасываем состояние ожидания
    return; // Останавливаем дальнейшую обработку
  }

  // Если ни один из middleware не обработал сообщение, передаем его дальше
  return next(); 
});


// --- ОБРАБОТЧИКИ КОМАНД (bot.command) ---
// Эти обработчики будут выполняться первыми, если сообщение является командой
bot.start(userController.handleStart);
bot.command('help', userController.help); 
bot.command('status', userController.checkSubscriptionStatus); // Используем checkSubscriptionStatus для /status
bot.command('faq', userController.faq); 
bot.command('contact', userController.contactAdmin); 

// Команды админа
bot.command('admin', checkAdminMenu); // Отображает меню админа
bot.command('check', checkPayments); // Проверка платежей
bot.command('stats', stats); // Статистика
bot.command('questions', listQuestions); // Список вопросов
bot.command('broadcast', broadcastMessage); // Массовая рассылка

// --- ОБРАБОТЧИКИ ТИПОВ СООБЩЕНИЙ (кроме 'text') ---
// Эти обработчики срабатывают до общего bot.on('text')
bot.on('photo', handlePhoto); // Обработка скриншотов оплаты

// --- ОБРАБОТЧИКИ КНОПОК (callback_data) ---
// Эти обработчики срабатывают для нажатий на инлайн-кнопки
// Кнопки админа
bot.action(/approve_(\d+)/, handleApprove);
bot.action(/reject_(\d+)/, handleReject);
bot.action('list_questions', listQuestions);
bot.action('check_payments_admin', checkPayments);
bot.action('show_stats_admin', stats); // Если есть кнопка "Посмотреть статистику" в меню админа
bot.action('refresh_stats', stats); // Кнопка "Обновить" для статистики

// Админ: Запрос на ответ пользователю
bot.action(/answer_(\d+)/, async (ctx) => {
  if (!checkAdmin(ctx)) {
    return ctx.answerCbQuery('🚫 Только для админа');
  }
  ctx.session.awaitingAnswerFor = ctx.match[1];
  await ctx.reply('✍️ Введите ответ для пользователя:');
  await ctx.answerCbQuery();
});

// Админ: Запрос на отправку VPN файла
bot.action(/send_instruction_to_(\d+)/, async (ctx) => {
  if (!checkAdmin(ctx)) {
    return ctx.answerCbQuery('🚫 Только для админа');
  }
  const targetUserId = ctx.match[1];
  ctx.session.awaitingVpnFileFor = targetUserId;
  ctx.session.awaitingVpnVideoFor = null; 
  await ctx.reply(`Загрузите *файл* конфигурации (например, .ovpn) для пользователя ${targetUserId}:`);
  await ctx.answerCbQuery();
});

// Админ: Запрос на ответ по VPN-проблеме
bot.action(/answer_vpn_issue_(\d+)/, async (ctx) => {
    if (!checkAdmin(ctx)) {
      return ctx.answerCbQuery('🚫 Только для админа');
    }
    const targetUserId = parseInt(ctx.match[1]);
    ctx.session.awaitingAnswerVpnIssueFor = targetUserId; 
    await ctx.reply(`✍️ Введите ответ для пользователя ${targetUserId} по его проблеме с VPN:`);
    await ctx.answerCbQuery();
});


// Кнопки пользователя (примеры, убедитесь, что они ведут к нужным контроллерам)
bot.action('check_subscription', userController.checkSubscriptionStatus);
bot.action('ask_question', userController.promptForQuestion);
bot.action('extend_subscription', userController.extendSubscription);
bot.action(/send_vpn_info_(\d+)/, vpnController.requestVpnInfo); // Отправка VPN-инфо по кнопке
bot.action(/vpn_configured_(\d+)/, vpnController.handleVpnConfigured);
bot.action(/vpn_failed_(\d+)/, vpnController.promptVpnFailure); 

// Обработчики для отмены подписки
bot.action('cancel_subscription_confirm', userController.promptCancelSubscription); 
bot.action('cancel_subscription_final', userController.cancelSubscriptionFinal);   
bot.action('cancel_subscription_abort', userController.cancelSubscriptionAbort);   


// --- НАСТРОЙКА НАПОМИНАНИЙ ---
setupReminders(bot);


// --- ОБЩИЙ ОБРАБОТЧИК ТЕКСТОВЫХ СООБЩЕНИЙ (самый последний в цепочке) ---
// Этот обработчик срабатывает, если сообщение не было обработано ни одной из команд,
// ни bot.on('photo'), ни action-кнопками, ни middleware для состояний ожидания админа/пользователя.
bot.on('text', async (ctx) => {
    // Если сообщение начинается с '/', это команда, и она уже должна была быть обработана bot.command()
    // Поэтому просто игнорируем, чтобы избежать двойной обработки или ошибочного распознавания.
    if (ctx.message.text.startsWith('/')) {
        return; // Ничего не делаем, команда уже обработана
    }

    // Если мы дошли сюда, и сообщение не было командой и не было обработано в middleware (например, как ответ админа или описание проблемы пользователя)
    // Тогда это считается новым вопросом от пользователя
    await handleQuestion(ctx);
});


// --- Запуск бота ---
bot.launch()
  .then(() => console.log('🤖 Бот запущен (Q&A + Payments + Broadcast)!'))
  .catch(err => {
    console.error('🚨 Ошибка запуска:', err);
    process.exit(1);
  });

// Graceful shutdown
['SIGINT', 'SIGTERM'].forEach(signal => {
  process.once(signal, async () => {
    console.log(`🛑 Получен ${signal}, останавливаю бота...`);
    try {
      await bot.stop();
      console.log('✅ Бот остановлен');
      process.exit(0);
    } catch (err) {
      console.error('Ошибка завершения:', err);
      process.exit(1);
    }
  });
});