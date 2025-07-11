require('dotenv').config({ path: __dirname + '/../primer.env' });
const { Telegraf, session } = require('telegraf');
const LocalSession = require('telegraf-session-local');
const connectDB = require('./config/db');
const { handleStart, checkSubscriptionStatus, extendSubscription, promptForQuestion, requestVpnInfo } = require('./controllers/userController'); // Импортируем новую функцию
const { handlePhoto, handleApprove, handleReject } = require('./controllers/paymentController');
const { checkPayments, stats, switchMode } = require('./controllers/adminController');
const { handleQuestion, handleAnswer, listQuestions } = require('./controllers/questionController');
const { setupReminders } = require('./services/reminderService');
const { checkAdmin } = require('./controllers/adminController'); // Убедимся, что checkAdmin импортирован

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

// ===== Middleware для ответов АДМИНА и отправки инструкций =====
bot.use(async (ctx, next) => {
  if (ctx.from?.id === parseInt(process.env.ADMIN_ID)) {
    // 1. Обработка ответа на вопрос
    if (ctx.session?.awaitingAnswerFor && ctx.message?.text) {
      console.log(`[AdminMiddleware] Обработка ответа на вопрос для пользователя ${ctx.session.awaitingAnswerFor}`);
      await handleAnswer(ctx, ctx.session.awaitingAnswerFor, ctx.message.text);
      ctx.session.awaitingAnswerFor = null;
      return;
    }
    // 2. Обработка отправки файла/видеоинструкции
    if (ctx.session?.awaitingVpnInfoFor && (ctx.message?.document || ctx.message?.video)) {
      const targetUserId = ctx.session.awaitingVpnInfoFor;
      try {
        if (ctx.message.document) {
          await ctx.telegram.sendDocument(targetUserId, ctx.message.document.file_id, {
            caption: '📁 Ваш файл конфигурации VPN:'
          });
          await ctx.reply(`✅ Файл успешно отправлен пользователю ${targetUserId}.`);
        } else if (ctx.message.video) {
          await ctx.telegram.sendVideo(targetUserId, ctx.message.video.file_id, {
            caption: '🎬 Видеоинструкция по настройке VPN:'
          });
          await ctx.reply(`✅ Видеоинструкция успешно отправлена пользователю ${targetUserId}.`);
        }
      } catch (error) {
        console.error(`Ошибка при отправке инструкции пользователю ${targetUserId}:`, error);
        await ctx.reply(`⚠️ Произошла ошибка при отправке инструкции пользователю ${targetUserId}.`);
      } finally {
        ctx.session.awaitingVpnInfoFor = null; // Сбрасываем состояние
      }
      return; // Завершаем обработку
    }
  }
  return next();
});

// ===== Обработчики команд =====
// Пользовательские
bot.start(handleStart);
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
bot.action('check_payments_admin', checkPayments);
bot.action('show_stats_admin', stats);

bot.action(/answer_(\d+)/, async (ctx) => {
  if (!checkAdmin(ctx)) {
    return ctx.answerCbQuery('🚫 Только для админа');
  }
  ctx.session.awaitingAnswerFor = ctx.match[1];
  await ctx.reply('✍️ Введите ответ для пользователя:');
  await ctx.answerCbQuery();
});

// НОВЫЙ ОБРАБОТЧИК КНОПКИ "ОТПРАВИТЬ ИНСТРУКЦИЮ" для админа
bot.action(/send_instruction_to_(\d+)/, async (ctx) => {
  if (!checkAdmin(ctx)) {
    return ctx.answerCbQuery('🚫 Только для админа');
  }
  const targetUserId = ctx.match[1];
  ctx.session.awaitingVpnInfoFor = targetUserId; // Устанавливаем, кому админ собирается отправить инструкцию
  await ctx.reply(`Загрузите файл (например, .ovpn) или видеоинструкцию для пользователя ${targetUserId}:`);
  await ctx.answerCbQuery();
});

// Кнопки пользователя
bot.action('check_subscription', checkSubscriptionStatus);
bot.action('ask_question', promptForQuestion);
bot.action('extend_subscription', extendSubscription);
// НОВЫЙ ОБРАБОТЧИК КНОПКИ "ПОЛУЧИТЬ ФАЙЛ И ИНСТРУКЦИЮ" для пользователя
bot.action(/send_vpn_info_(\d+)/, requestVpnInfo);


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