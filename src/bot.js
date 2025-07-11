require('dotenv').config({ path: __dirname + '/../primer.env' });
const { Telegraf, session } = require('telegraf');
const LocalSession = require('telegraf-session-local');
const connectDB = require('./config/db');
const { handleStart, checkSubscriptionStatus, extendSubscription, promptForQuestion } = require('./controllers/userController'); // Импортируем новые функции
const { handlePhoto, handleApprove, handleReject } = require('./controllers/paymentController');
const { checkPayments, stats, switchMode } = require('./controllers/adminController');
const { handleQuestion, handleAnswer, listQuestions } = require('./controllers/questionController');
const { setupReminders } = require('./services/reminderService');

// Инициализация бота
const bot = new Telegraf(process.env.BOT_TOKEN, {
  telegram: { 
    agent: null,
    handshakeTimeout: 30000
  }
});

// Настройка сессий (должна быть одной из первых)
bot.use((new LocalSession({ database: 'session_db.json' })).middleware());

// Подключение БД
connectDB().catch(err => {
  console.error('❌ MongoDB connection failed:', err);
  process.exit(1);
});

// Глобальные обработчики ошибок
process.on('unhandledRejection', (err) => {
  console.error('⚠️ Unhandled Rejection:', err);
});
process.on('uncaughtException', async (err) => {
  console.error('⚠️ Uncaught Exception:', err);
  await bot.stop();
  process.exit(1);
});

// ===== Middleware для ответов АДМИНА (ПЕРЕМЕЩЕНО ВЫШЕ) =====
// Этот middleware должен срабатывать ПЕРВЫМ для админа, чтобы перехватить его ответы
bot.use(async (ctx, next) => {
  // Проверяем, если это админ и он ожидает ответа
  if (ctx.from?.id === parseInt(process.env.ADMIN_ID)) {
    if (ctx.session?.awaitingAnswerFor && ctx.message?.text) {
      console.log(`[AdminMiddleware] Обработка ответа для пользователя ${ctx.session.awaitingAnswerFor}`);
      await handleAnswer(ctx, ctx.session.awaitingAnswerFor, ctx.message.text);
      ctx.session.awaitingAnswerFor = null; // Сбрасываем состояние
      return; // Важно: завершаем обработку, чтобы сообщение не попало в другие обработчики
    }
  }
  return next(); // Передаем управление следующему обработчику
});

// ===== Обработчики команд =====
// Пользовательские
bot.start(handleStart);
// Этот обработчик должен быть ПОСЛЕ middleware для ответов админа
bot.hears(/^[^\/].*/, handleQuestion);

// Админские
bot.command('check', checkPayments);
bot.command('stats', stats);
bot.command('questions', listQuestions);
bot.command('switchmode', switchMode);

// Обработка платежей
bot.on('photo', handlePhoto);

// ===== Обработчики кнопок (callback_data) =====
// Кнопки админа
bot.action(/approve_(\d+)/, handleApprove);
bot.action(/reject_(\d+)/, handleReject);
bot.action('list_questions', listQuestions);
bot.action('switch_mode', switchMode);
bot.action('check_payments_admin', checkPayments); // Новая кнопка для админа
bot.action('show_stats_admin', stats); // Новая кнопка для админа

bot.action(/answer_(\d+)/, async (ctx) => {
  // Проверяем, что запрос на ответ пришел от админа
  if (ctx.from.id !== parseInt(process.env.ADMIN_ID)) {
    return ctx.answerCbQuery('🚫 Доступ только для админа');
  }
  ctx.session.awaitingAnswerFor = ctx.match[1];
  await ctx.reply('✍️ Введите ответ для пользователя:');
  await ctx.answerCbQuery(); // Закрываем всплывающее уведомление о нажатии кнопки
});

// Кнопки пользователя
bot.action('check_subscription', checkSubscriptionStatus); // Обработчик для кнопки "Посмотреть срок действия"
bot.action('ask_question', promptForQuestion); // Обработчик для кнопки "Задать вопрос"
bot.action('extend_subscription', extendSubscription); // Обработчик для кнопки "Продлить подписку"


// ===== Напоминания =====
setupReminders(bot);

// ===== Запуск =====
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