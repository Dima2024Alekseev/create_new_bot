require('dotenv').config({ path: __dirname + '/../primer.env' });
const { Telegraf, session } = require('telegraf');
const LocalSession = require('telegraf-session-local');
const connectDB = require('./config/db');
const { handleStart } = require('./controllers/userController');
const { handlePhoto, handleApprove, handleReject } = require('./controllers/paymentController');
const { checkPayments, stats } = require('./controllers/adminController');
const { handleQuestion, handleAnswer, listQuestions } = require('./controllers/questionController');
const { setupReminders } = require('./services/reminderService');

// Инициализация бота
const bot = new Telegraf(process.env.BOT_TOKEN, {
  telegram: { 
    agent: null,
    handshakeTimeout: 30000
  }
});

// Настройка сессий
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

// ===== Обработчики команд =====

// Пользовательские
bot.start(handleStart);
bot.hears(/^[^\/].*/, handleQuestion); // Все текстовые сообщения -> вопросы

// Админские
bot.command('check', checkPayments);
bot.command('stats', stats);
bot.command('questions', listQuestions);

// Обработка платежей
bot.on('photo', handlePhoto);

// ===== Кнопки =====
bot.action(/approve_(\d+)/, handleApprove);
bot.action(/reject_(\d+)/, handleReject);
bot.action('list_questions', listQuestions);
bot.action(/answer_(\d+)/, async (ctx) => {
  ctx.session.awaitingAnswerFor = ctx.match[1];
  await ctx.reply('✍️ Введите ответ для пользователя:');
});

// ===== Middleware для ответов =====
bot.use(async (ctx, next) => {
  if (ctx.from?.id === parseInt(process.env.ADMIN_ID)) {
    if (ctx.session?.awaitingAnswerFor && ctx.message?.text) {
      await handleAnswer(ctx, ctx.session.awaitingAnswerFor, ctx.message.text);
      ctx.session.awaitingAnswerFor = null;
      return;
    }
  }
  return next();
});

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