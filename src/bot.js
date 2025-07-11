require('dotenv').config({ path: __dirname + '/../primer.env' });
const { Telegraf, Markup, session } = require('telegraf');
const LocalSession = require('telegraf-session-local');
const connectDB = require('./config/db');

// Контроллеры
const { handleStart } = require('./controllers/userController');
const { handlePhoto, handleApprove, handleReject } = require('./controllers/paymentController');
const { 
  showMainMenu,
  showPaymentsMenu,
  showQuestionsMenu,
  handleAdminActions,
  switchMode,
  stats,
  checkAdmin
} = require('./controllers/adminController');
const { handleQuestion, handleAnswer, listQuestions } = require('./controllers/questionController');

// Сервисы
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

// ===== Middleware =====
bot.use(async (ctx, next) => {
  // Логирование входящих сообщений
  console.log(`[${new Date().toISOString()}] Update from ${ctx.from?.id}:`, ctx.message?.text || ctx.updateType);
  return next();
});

// ===== Обработчики команд =====

// Стартовая команда
bot.start(handleStart);

// Команда админ-панели
bot.command('admin', async (ctx) => {
  if (checkAdmin(ctx)) {
    await showMainMenu(ctx);
  } else {
    await ctx.reply('🚫 Доступ только для администратора');
  }
});

// Статистика
bot.command('stats', stats);

// Переключение режима
bot.command('switchmode', switchMode);

// Проверка платежей
bot.command('check', async (ctx) => {
  if (checkAdmin(ctx)) {
    await showPaymentsMenu(ctx);
  }
});

// Управление вопросами
bot.command('questions', async (ctx) => {
  if (checkAdmin(ctx)) {
    await showQuestionsMenu(ctx);
  }
});

// ===== Обработчики сообщений =====

// Обработка фото (платежи)
bot.on('photo', handlePhoto);

// Обработка текстовых сообщений (вопросы)
bot.hears(/^[^\/].*/, async (ctx) => {
  if (ctx.session?.awaitingAnswerFor) {
    // Режим ответа на вопрос
    await handleAnswer(ctx, ctx.session.awaitingAnswerFor, ctx.message.text);
    ctx.session.awaitingAnswerFor = null;
  } else if (!ctx.message.text.startsWith('/')) {
    // Обычный вопрос от пользователя
    await handleQuestion(ctx);
  }
});

// ===== Обработчики кнопок =====

// Платежи
bot.action(/approve_(\d+)/, handleApprove);
bot.action(/reject_(\d+)/, handleReject);
bot.action(/pending_payments|active_payments|rejected_payments|expiring_payments/, handleAdminActions);
bot.action('back_to_payments', showPaymentsMenu);

// Вопросы
bot.action(/answer_(\d+)/, async (ctx) => {
  ctx.session.awaitingAnswerFor = ctx.match[1];
  await ctx.reply('✍️ Введите ответ для пользователя:');
});
bot.action(/pending_questions|answered_questions|clear_questions/, handleAdminActions);
bot.action('back_to_questions', showQuestionsMenu);

// Общие
bot.action('back_to_main', showMainMenu);
bot.action('refresh_stats', stats);

// Текстовые команды из клавиатуры
bot.hears('📊 Статистика', stats);
bot.hears('📝 Вопросы', showQuestionsMenu);
bot.hears('💳 Платежи', showPaymentsMenu);
bot.hears('🔄 Режим', switchMode);

// ===== Напоминания =====
setupReminders(bot);

// ===== Запуск бота =====
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

module.exports = bot;