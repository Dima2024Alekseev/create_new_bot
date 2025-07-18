require('dotenv').config({ path: __dirname + '/../primer.env' });

const { Telegraf, session, Markup } = require('telegraf');
const LocalSession = require('telegraf-session-local');
const connectDB = require('./config/db');
const User = require('./models/User'); 

// Импорт контроллеров
const { 
  handleStart, 
  checkSubscriptionStatus, 
  extendSubscription, 
  promptForQuestion, 
  requestVpnInfo, 
  handleVpnConfigured, 
  promptVpnFailure, 
  promptCancelSubscription, 
  cancelSubscriptionFinal, 
  cancelSubscriptionAbort 
} = require('./controllers/userController'); 

const { handlePhoto, handleApprove, handleReject } = require('./controllers/paymentController');
// ИЗМЕНЕНО: checkAdmin теперь импортируется из utils/auth
const { checkPayments, stats, checkAdminMenu } = require('./controllers/adminController'); 
const { handleQuestion, handleAnswer, listQuestions } = require('./controllers/questionController');
const { setupReminders } = require('./services/reminderService');
// НОВОЕ: Импорт checkAdmin из утилиты
const { checkAdmin } = require('./utils/auth');


const bot = new Telegraf(process.env.BOT_TOKEN, {
  telegram: {
    agent: null,
    handshakeTimeout: 30000
  }
});

bot.use((new LocalSession({ database: 'session_db.json' })).middleware());

connectDB().catch(err => {
  console.error('❌ MongoDB connection failed:', err);
  process.exit(1); 
});

// --- Глобальные обработчики ошибок для устойчивости бота ---
process.on('unhandledRejection', (reason, promise) => {
  console.error('⚠️ Unhandled Rejection at:', promise, 'reason:', reason);
  console.error('Stack trace:', reason.stack); 
});

process.on('uncaughtException', async (err) => {
  console.error('⚠️ Uncaught Exception:', err);
  console.error('Stack trace:', err.stack); 
  try {
    await bot.telegram.sendMessage(process.env.ADMIN_ID, `🚨 Критическая ошибка бота: ${err.message}\n\`\`\`\n${err.stack}\n\`\`\``, { parse_mode: 'Markdown' }).catch(e => console.error("Error sending exception to admin:", e));
  } catch (e) {
    console.error("Failed to send uncaught exception to admin:", e);
  }
  await bot.stop().catch(e => console.error("Error stopping bot on uncaught exception:", e));
  process.exit(1);
});

// --- Middleware для ответов АДМИНА, отправки инструкций и обработки проблем ---
bot.use(async (ctx, next) => {
  console.log(`[Middleware Debug] Сообщение от: ${ctx.from?.id}`);
  console.log(`[Middleware Debug] awaitingAnswerFor: ${ctx.session?.awaitingAnswerFor}`);
  console.log(`[Middleware Debug] awaitingVpnFileFor: ${ctx.session?.awaitingVpnFileFor}`);
  console.log(`[Middleware Debug] awaitingVpnVideoFor: ${ctx.session?.awaitingVpnVideoFor}`);
  console.log(`[Middleware Debug] awaitingAnswerVpnIssueFor: ${ctx.session?.awaitingAnswerVpnIssueFor}`);
  console.log(`[Middleware Debug] awaitingVpnTroubleshoot: ${ctx.session?.awaitingVpnTroubleshoot}`);
  console.log(`[Middleware Debug] Тип сообщения: ${ctx.message ? Object.keys(ctx.message).join(', ') : 'No message object'}`);

  if (ctx.from?.id === parseInt(process.env.ADMIN_ID)) {
    if (ctx.session?.awaitingAnswerFor && ctx.message?.text) {
      console.log(`[AdminMiddleware] Обработка ответа на вопрос для пользователя ${ctx.session.awaitingAnswerFor}`);
      await handleAnswer(ctx); 
      return;
    }

    if (ctx.session?.awaitingVpnFileFor && ctx.message?.document) {
      const targetUserId = ctx.session.awaitingVpnFileFor;
      try {
        console.log(`[AdminMiddleware] Отправка файла пользователю ${targetUserId}`);
        await ctx.telegram.sendDocument(targetUserId, ctx.message.document.file_id, {
          caption: '📁 Ваш файл конфигурации VPN:'
        });
        await ctx.reply(`✅ Файл конфигурации успешно отправлен пользователю ${targetUserId}.`);

        ctx.session.awaitingVpnFileFor = null;
        ctx.session.awaitingVpnVideoFor = targetUserId; 
        await ctx.reply('Теперь, пожалуйста, загрузите видеоинструкцию для этого пользователя:');
        return;
      } catch (error) {
        console.error(`Ошибка при отправке файла пользователю ${targetUserId}:`, error);
        await ctx.reply(`⚠️ Произошла ошибка при отправке файла пользователю ${targetUserId}.`);
        ctx.session.awaitingVpnFileFor = null;
        ctx.session.awaitingVpnVideoFor = null;
        return;
      }
    }

    if (ctx.session?.awaitingVpnVideoFor && ctx.message?.video) {
      const targetUserId = ctx.session.awaitingVpnVideoFor;
      try {
        console.log(`[AdminMiddleware] Отправка видео пользователю ${targetUserId}`);
        await ctx.telegram.sendVideo(targetUserId, ctx.message.video.file_id, {
          caption: '🎬 Видеоинструкция по настройке VPN:'
        });
        await ctx.reply(`✅ Видеоинструкция успешно отправлена пользователю ${targetUserId}.`);

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
        ctx.session.awaitingVpnVideoFor = null; 
      }
      return;
    }

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
      return;
    }

    if (ctx.message) {
      console.log(`[AdminMiddleware] Сообщение админа не соответствует текущему состоянию ожидания: ${JSON.stringify(ctx.message)}`);
    }
  }

  if (ctx.session?.awaitingVpnTroubleshoot && ctx.from?.id === ctx.session.awaitingVpnTroubleshoot && ctx.message?.text) {
    const userId = ctx.from.id;
    const problemDescription = ctx.message.text;
    const user = await User.findOne({ userId }); 

    let userName = user?.firstName || user?.username || 'Без имени';
    if (user?.username) {
        userName = `${userName} (@${user.username})`;
    }

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
    
    ctx.session.awaitingVpnTroubleshoot = null;
    return; 
  }

  return next(); 
});


// --- Обработчики команд ---

bot.start(async (ctx) => {
    if (checkAdmin(ctx)) {
        await checkAdminMenu(ctx); 
    } else {
        await handleStart(ctx); 
    }
});

bot.on('text', async (ctx, next) => {
    if (ctx.session?.awaitingVpnTroubleshoot || ctx.from?.id === parseInt(process.env.ADMIN_ID)) {
        return next(); 
    }
    if (!ctx.message.text.startsWith('/')) {
        await handleQuestion(ctx);
    } else {
        return next(); 
    }
});


// Админские команды
bot.command('admin', checkAdminMenu); 
bot.command('check', checkPayments);
bot.command('stats', stats);
// ИЗМЕНЕНО: test-обработчик для проверки, потом можно заменить на listQuestions
bot.command('questions', listQuestions); 


// Обработка платежей (фото)
bot.on('photo', handlePhoto);


// --- Обработчики кнопок (callback_data) ---

// Кнопки админа
bot.action(/approve_(\d+)/, handleApprove);
bot.action(/reject_(\d+)/, handleReject);
bot.action('list_questions', listQuestions);
bot.action('check_payments_admin', checkPayments);
bot.action('show_stats_admin', stats);
bot.action('refresh_stats', stats); 

bot.action(/answer_(\d+)/, async (ctx) => {
  if (!checkAdmin(ctx)) { // Используем новый импорт checkAdmin
    return ctx.answerCbQuery('🚫 Только для админа');
  }
  ctx.session.awaitingAnswerFor = ctx.match[1];
  await ctx.reply('✍️ Введите ответ для пользователя:');
  await ctx.answerCbQuery();
});

bot.action(/send_instruction_to_(\d+)/, async (ctx) => {
  if (!checkAdmin(ctx)) { // Используем новый импорт checkAdmin
    return ctx.answerCbQuery('🚫 Только для админа');
  }
  const targetUserId = ctx.match[1];
  ctx.session.awaitingVpnFileFor = targetUserId;
  ctx.session.awaitingVpnVideoFor = null; 
  await ctx.reply(`Загрузите *файл* конфигурации (например, .ovpn) для пользователя ${targetUserId}:`);
  await ctx.answerCbQuery();
});

bot.action(/answer_vpn_issue_(\d+)/, async (ctx) => {
    if (!checkAdmin(ctx)) { // Используем новый импорт checkAdmin
      return ctx.answerCbQuery('🚫 Только для админа');
    }
    const targetUserId = parseInt(ctx.match[1]);
    ctx.session.awaitingAnswerVpnIssueFor = targetUserId; 
    await ctx.reply(`✍️ Введите ответ для пользователя ${targetUserId} по его проблеме с VPN:`);
    await ctx.answerCbQuery();
});


// Кнопки пользователя
bot.action('check_subscription', checkSubscriptionStatus);
bot.action('ask_question', promptForQuestion);
bot.action('extend_subscription', extendSubscription);
bot.action(/send_vpn_info_(\d+)/, requestVpnInfo);
bot.action(/vpn_configured_(\d+)/, handleVpnConfigured);
bot.action(/vpn_failed_(\d+)/, promptVpnFailure); 

// --- Новые обработчики для отмены подписки ---
bot.action('cancel_subscription_confirm', promptCancelSubscription); 
bot.action('cancel_subscription_final', cancelSubscriptionFinal);   
bot.action('cancel_subscription_abort', cancelSubscriptionAbort);   


// --- Напоминания ---
setupReminders(bot);


// --- Запуск ---
bot.launch()
  .then(() => console.log('🤖 Бот запущен (Q&A + Payments)'))
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