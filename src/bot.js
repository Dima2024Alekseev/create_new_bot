require('dotenv').config({ path: 'primer.env' });
const { Telegraf } = require('telegraf');
const connectDB = require('./config/db');
const { handleStart } = require('./controllers/userController');
const { handlePhoto, handleApprove, handleReject } = require('./controllers/paymentController');
const { checkPayments, stats } = require('./controllers/adminController');
const { setupReminders } = require('./services/reminderService');

const bot = new Telegraf(process.env.BOT_TOKEN);
connectDB();

// Обработчики
bot.start(handleStart);
bot.on('photo', handlePhoto);
bot.command('check', checkPayments);
bot.command('stats', stats);

// Обработка кнопок
bot.action(/approve_(\d+)/, handleApprove);
bot.action(/reject_(\d+)/, handleReject);

// Напоминания
setupReminders(bot);

// Запуск
bot.launch()
  .then(() => console.log('Бот успешно запущен'))
  .catch(err => console.error('Ошибка запуска бота:', err));

// Graceful shutdown
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));