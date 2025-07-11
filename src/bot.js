// bot.js

// ОЧЕНЬ ВАЖНО: dotenv должен быть загружен только один раз, в самом начале корневого файла приложения.
// Убедитесь, что путь к вашему primer.env файлу верен относительно этого bot.js файла.
// Например, если primer.env находится в корне проекта, а bot.js в папке src/, то __dirname + '/../primer.env' - правильный путь.
require('dotenv').config({ path: __dirname + '/../primer.env' });

// Отладочные логи для проверки загрузки переменных окружения
console.log('DEBUG: BOT_TOKEN is:', process.env.BOT_TOKEN ? 'LOADED' : 'NOT LOADED');
console.log('DEBUG: ADMIN_ID is:', process.env.ADMIN_ID ? 'LOADED' : 'NOT LOADED');
console.log('DEBUG: WG_EASY_BASE_URL is:', process.env.WG_EASY_BASE_URL ? 'LOADED' : 'NOT LOADED');

const { Telegraf, session, Markup } = require('telegraf');
const LocalSession = require('telegraf-session-local');
const connectDB = require('./config/db'); // Импортируем функцию подключения к БД

// === Контроллеры пользователя ===
const {
  handleStart,
  checkSubscriptionStatus,
  extendSubscription,
  promptForQuestion,
  requestVpnInfo,
  handleVpnConfigured,
  handleUserReplyKeyboard, // Для обработки кнопок Reply Keyboard
  showUserQuestions       // Для команды /myquestions и кнопки "Мои вопросы"
} = require('./controllers/userController');

// === Контроллеры оплаты ===
const { handlePhoto, handleApprove, handleReject } = require('./controllers/paymentController');

// === Контроллеры администратора ===
const { checkPayments, stats, checkAdmin } = require('./controllers/adminController');

// === Контроллеры вопросов ===
const { handleQuestion, handleAnswer, listQuestions } = require('./controllers/questionController');

// === Сервисы ===
const { setupReminders } = require('./services/reminderService');


// Инициализация бота
const bot = new Telegraf(process.env.BOT_TOKEN, {
  telegram: {
    agent: null, // Используйте прокси, если требуется: new HttpsProxyAgent(process.env.PROXY_SOCKS5)
    handshakeTimeout: 30000 // Увеличьте, если наблюдаются частые таймауты
  }
});

// Использование LocalSession для хранения сессий пользователей
bot.use((new LocalSession({ database: 'session_db.json' })).middleware());

// ===== ГЛАВНАЯ ФУНКЦИЯ ЗАПУСКА БОТА =====
const startBot = async () => {
  try {
    // 1. Подключение к базе данных
    await connectDB();

    // 2. Запуск бота Telegram
    console.log('DEBUG: Attempting to launch bot...');
    await bot.launch();
    console.log('🤖 Бот запущен (Q&A + Payments)');

    // 3. Планирование задач CRON (напоминаний)
    setupReminders(bot);
    console.log('✅ Напоминания cron запланированы.');

  } catch (err) {
    // Если произошла ошибка на любом из этапов запуска, логируем ее и выходим
    console.error('🚨 Критическая ошибка при запуске бота или подключении к БД:', err);
    process.exit(1); // Выходим с кодом ошибки
  }
};

// Вызываем функцию запуска бота
startBot();

// ===== Обработка необработанных ошибок для стабильности =====
process.on('unhandledRejection', (reason, promise) => {
  console.error('⚠️ Unhandled Rejection at:', promise, 'reason:', reason);
  // Можно также отправить уведомление администратору
});

process.on('uncaughtException', async (err) => {
  console.error('⚠️ Uncaught Exception:', err);
  // В случае критической ошибки, пытаемся остановить бота перед выходом
  try {
    await bot.stop();
    console.log('✅ Бот остановлен после Uncaught Exception');
  } catch (stopErr) {
    console.error('Ошибка при остановке бота после Uncaught Exception:', stopErr);
  }
  process.exit(1); // Завершаем процесс
});


// ===== Middleware для обработки сообщений администратора =====
bot.use(async (ctx, next) => {
  // Отладочные логи для Middleware
  console.log(`[Middleware Debug] Сообщение от: ${ctx.from?.id}`);
  console.log(`[Middleware Debug] awaitingAnswerFor: ${ctx.session?.awaitingAnswerFor}`);
  console.log(`[Middleware Debug] awaitingVpnVideoFor: ${ctx.session?.awaitingVpnVideoFor}`);
  console.log(`[Middleware Debug] Тип сообщения: ${Object.keys(ctx.message || {})}`);

  // Проверяем, является ли отправитель администратором
  if (ctx.from?.id === parseInt(process.env.ADMIN_ID)) {
    // 1. Обработка ответа на вопрос
    if (ctx.session?.awaitingAnswerFor && ctx.message?.text) {
      console.log(`[AdminMiddleware] Обработка ответа на вопрос для пользователя ${ctx.session.awaitingAnswerFor}`);
      await handleAnswer(ctx, ctx.session.awaitingAnswerFor, ctx.message.text);
      ctx.session.awaitingAnswerFor = null; // Сбрасываем ожидание
      return; // Завершаем обработку
    }

    // 2. Обработка отправки ВИДЕО инструкции от админа (файл теперь отправляется автоматически)
    // Эта ветка срабатывает, когда админ отправляет видео после создания клиента
    if (ctx.session?.awaitingVpnVideoFor && ctx.message?.video) {
      const targetUserId = ctx.session.awaitingVpnVideoFor;
      try {
        console.log(`[AdminMiddleware] Отправка видео пользователю ${targetUserId}`);
        await ctx.telegram.sendVideo(targetUserId, ctx.message.video.file_id, {
          caption: '🎬 Видеоинструкция по настройке VPN:'
        });
        await ctx.reply(`✅ Видеоинструкция успешно отправлена пользователю ${targetUserId}.`);

        // Предлагаем пользователю подтвердить настройку VPN
        await ctx.telegram.sendMessage(
          targetUserId,
          'Если вы успешно настроили VPN, пожалуйста, нажмите кнопку ниже:',
          Markup.inlineKeyboard([
            Markup.button.callback('✅ Успешно настроил', `vpn_configured_${targetUserId}`)
          ])
        );

      } catch (error) {
        console.error(`Ошибка при отправке видео пользователю ${targetUserId}:`, error);
        await ctx.reply(`⚠️ Произошла ошибка при отправке видео пользователю ${targetUserId}.`);
      } finally {
        ctx.session.awaitingVpnVideoFor = null; // Сбрасываем ожидание в любом случае
      }
      return; // Завершаем обработку
    }

    // Если админ отправил сообщение, которое не соответствует ни одному ожидающему состоянию
    if (ctx.message) {
      console.log(`[AdminMiddleware] Сообщение админа не соответствует текущему состоянию ожидания: ${JSON.stringify(ctx.message)}`);
      // Можно добавить тут какое-то дефолтное поведение или игнорирование
    }
  }
  return next(); // Передаем управление следующему middleware или обработчику
});

// ===== Обработчики команд =====
bot.start(handleStart);
bot.command('myquestions', showUserQuestions); // Команда для просмотра вопросов пользователя

// !!! ВАЖНО: Обработчики для Reply Keyboard ДОЛЖНЫ быть ПЕРЕД общим bot.hears(/^[^\/].*/, handleQuestion);
// Это позволяет обработать нажатия кнопок до того, как они будут интерпретированы как вопрос.
bot.hears('🗓 Моя подписка', handleUserReplyKeyboard);
bot.hears('❓ Задать вопрос', handleUserReplyKeyboard);
bot.hears('💰 Продлить VPN', handleUserReplyKeyboard);
bot.hears('📚 Мои вопросы', handleUserReplyKeyboard);

// Общий обработчик текстовых сообщений, если ни одна из предыдущих команд/hears не сработала
bot.hears(/^[^\/].*/, handleQuestion);

// === Админские команды ===
bot.command('check', checkPayments);
bot.command('stats', stats);
bot.command('questions', listQuestions); // Показать список вопросов

// Обработка фотографий (для отправки чеков оплаты)
bot.on('photo', handlePhoto);

// ===== Обработчики кнопок (callback_data) =====
// === Кнопки админа (Inline Keyboard) ===
bot.action(/approve_(\d+)/, handleApprove);
bot.action(/reject_(\d+)/, handleReject);
bot.action('list_questions', listQuestions);
bot.action('check_payments_admin', checkPayments);
bot.action('show_stats_admin', stats);

// Кнопка для ответа на вопрос (устанавливает ожидание ответа)
bot.action(/answer_(\d+)/, async (ctx) => {
  if (!checkAdmin(ctx)) {
    return ctx.answerCbQuery('🚫 Только для админа');
  }
  ctx.session.awaitingAnswerFor = ctx.match[1]; // Сохраняем ID пользователя, которому отвечаем
  await ctx.reply('✍️ Введите ответ для пользователя:');
  await ctx.answerCbQuery(); // Закрываем всплывающее уведомление от кнопки
});

// Кнопка для отправки видеоинструкции (файл конфига отправляется автоматически при одобрении)
bot.action(/send_instruction_to_(\d+)/, async (ctx) => {
  if (!checkAdmin(ctx)) {
    return ctx.answerCbQuery('🚫 Только для админа');
  }
  const targetUserId = ctx.match[1];
  // Мы предполагаем, что конфиг файл уже отправлен автоматически в handleApprove
  ctx.session.awaitingVpnVideoFor = targetUserId; // Устанавливаем ожидание видео
  await ctx.reply(`Загрузите *видеоинструкцию* для пользователя ${targetUserId}:`);
  await ctx.answerCbQuery();
});

// === Кнопки пользователя (Inline Keyboard) ===
// Эти кнопки могут быть вызваны из сообщений бота (например, после `/start` или `/check_subscription`)
// Некоторые из них могут быть продублированы Reply Keyboard для удобства
bot.action('check_subscription', checkSubscriptionStatus);
bot.action('ask_question', promptForQuestion);
bot.action('extend_subscription', extendSubscription);
bot.action(/send_vpn_info_(\d+)/, requestVpnInfo); // Кнопка для запроса VPN информации/инструкций
bot.action(/vpn_configured_(\d+)/, handleVpnConfigured); // Кнопка подтверждения настройки VPN


// ===== Graceful shutdown (аккуратное завершение работы) =====
// Обработка сигналов завершения процесса для корректной остановки бота
['SIGINT', 'SIGTERM'].forEach(signal => {
  process.once(signal, async () => {
    console.log(`🛑 Получен ${signal}, останавливаю бота...`);
    try {
      await bot.stop(); // Остановка бота Telegraf
      console.log('✅ Бот остановлен');
      process.exit(0); // Корректный выход из процесса
    } catch (err) {
      console.error('Ошибка завершения:', err);
      process.exit(1); // Выход с ошибкой
    }
  });
});