require('dotenv').config({ path: __dirname + '/../primer.env' });
const { Telegraf } = require('telegraf');
const connectDB = require('./config/db');
const { handleStart } = require('./controllers/userController');
const { handlePhoto, handleApprove, handleReject } = require('./controllers/paymentController');
const { checkPayments, stats } = require('./controllers/adminController');
const { setupReminders } = require('./services/reminderService');

// Проверка обязательных переменных окружения
if (!process.env.BOT_TOKEN || !process.env.ADMIN_ID) {
  console.error('❌ Отсутствуют обязательные переменные окружения');
  process.exit(1);
}

const bot = new Telegraf(process.env.BOT_TOKEN, {
  telegram: {
    agent: null,
    handshakeTimeout: 30000,
    webhookReply: false
  }
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

// Подключение БД с обработкой ошибок
connectDB().catch(err => {
  console.error('❌ Failed to connect to DB:', err);
  process.exit(1);
});

// Регистрация обработчиков
bot.start(handleStart);
bot.on('photo', handlePhoto);
bot.command('check', checkPayments);
bot.command('stats', stats);
bot.action(/approve_(\d+)/, handleApprove);
bot.action(/reject_(\d+)/, handleReject);

// Система напоминаний
setupReminders(bot);

// Запуск бота
const startBot = async () => {
  try {
    await bot.launch();
    console.log('🤖 Бот успешно запущен');
  } catch (err) {
    console.error('🚨 Ошибка запуска бота:', err);
    setTimeout(startBot, 5000); // Повторная попытка через 5 сек
  }
};

startBot();

// Graceful shutdown
['SIGINT', 'SIGTERM'].forEach(signal => {
  process.once(signal, async () => {
    console.log(`🛑 Получен ${signal}, останавливаю бота...`);
    try {
      await bot.stop();
      await mongoose.disconnect();
      console.log('✅ Ресурсы освобождены');
      process.exit(0);
    } catch (err) {
      console.error('Ошибка завершения:', err);
      process.exit(1);
    }
  });
});