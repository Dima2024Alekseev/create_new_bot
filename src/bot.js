// bot.js
require('dotenv').config({ path: __dirname + '/../primer.env' }); // <-- Убедитесь, что путь к .env верный, изменил на .env
const { Telegraf, session, Markup } = require('telegraf'); // Добавил Markup
const LocalSession = require('telegraf-session-local');
const connectDB = require('./config/db');

// Контроллеры пользователя
const {
  handleStart,
  checkSubscriptionStatus,
  extendSubscription,
  promptForQuestion,
  requestVpnInfo,
  handleVpnConfigured,
  handleUserReplyKeyboard, // <-- Новый импорт для обработки Reply Keyboard
  showUserQuestions // <-- Новый импорт для команды /myquestions
} = require('./controllers/userController');

// Контроллеры оплаты
const { handlePhoto, handleApprove, handleReject } = require('./controllers/paymentController');

// Контроллеры администратора
const { checkPayments, stats, checkAdmin } = require('./controllers/adminController');

// Контроллеры вопросов
const { handleQuestion, handleAnswer, listQuestions } = require('./controllers/questionController');

// Сервисы
const { setupReminders } = require('./services/reminderService');
// const { createWgClient, deleteWgClient } = require('./services/wireguardService'); // Эти импорты здесь не нужны, если используются только в других контроллерах/сервисах.

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

process.on('unhandledRejection', (err) => {
  console.error('⚠️ Unhandled Rejection:', err);
});
process.on('uncaughtException', async (err) => {
  console.error('⚠️ Uncaught Exception:', err);
  // В случае критической ошибки, пытаемся остановить бота перед выходом
  await bot.stop();
  process.exit(1);
});

// ===== Middleware для ответов АДМИНА и отправки инструкций =====
bot.use(async (ctx, next) => {
  console.log(`[Middleware Debug] Сообщение от: ${ctx.from?.id}`);
  console.log(`[Middleware Debug] awaitingAnswerFor: ${ctx.session?.awaitingAnswerFor}`);
  console.log(`[Middleware Debug] awaitingVpnVideoFor: ${ctx.session?.awaitingVpnVideoFor}`);
  console.log(`[Middleware Debug] Тип сообщения: ${Object.keys(ctx.message || {})}`);

  if (ctx.from?.id === parseInt(process.env.ADMIN_ID)) {
    // 1. Обработка ответа на вопрос
    if (ctx.session?.awaitingAnswerFor && ctx.message?.text) {
      console.log(`[AdminMiddleware] Обработка ответа на вопрос для пользователя ${ctx.session.awaitingAnswerFor}`);
      await handleAnswer(ctx, ctx.session.awaitingAnswerFor, ctx.message.text);
      ctx.session.awaitingAnswerFor = null;
      return;
    }

    // 2. Обработка отправки ВИДЕО инструкции от админа (ФАЙЛ теперь отправляется автоматически)
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
          'Если вы успешно настроили VPN, пожалуйста, нажмите кнопку ниже:',
          Markup.inlineKeyboard([
            Markup.button.callback('✅ Успешно настроил', `vpn_configured_${targetUserId}`)
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

    if (ctx.message) {
      console.log(`[AdminMiddleware] Сообщение админа не соответствует текущему состоянию ожидания: ${JSON.stringify(ctx.message)}`);
    }
  }
  return next();
});

// ===== Обработчики команд =====
bot.start(handleStart);
bot.command('myquestions', showUserQuestions); // <-- Новая команда для просмотра вопросов пользователя

// !!! ВАЖНО: Эти обработчики для Reply Keyboard ДОЛЖНЫ быть ПЕРЕД общим bot.hears(/^[^\/].*/, handleQuestion);
bot.hears('🗓 Моя подписка', handleUserReplyKeyboard);
bot.hears('❓ Задать вопрос', handleUserReplyKeyboard);
bot.hears('💰 Продлить VPN', handleUserReplyKeyboard);
bot.hears('📚 Мои вопросы', handleUserReplyKeyboard); // <-- Новая кнопка Reply Keyboard

// Общий обработчик текстовых сообщений, если не сработали другие bot.hears
bot.hears(/^[^\/].*/, handleQuestion);

// Админские команды
bot.command('check', checkPayments);
bot.command('stats', stats);
bot.command('questions', listQuestions);

// Обработка платежей
bot.on('photo', handlePhoto);

// ===== Обработчики кнопок (callback_data) =====
// Кнопки админа
bot.action(/approve_(\d+)/, handleApprove);
bot.action(/reject_(\d+)/, handleReject);
bot.action('list_questions', listQuestions);
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

// Кнопка 'send_instruction_to_(\d+)' теперь только для видео, файл отправляется автоматически
bot.action(/send_instruction_to_(\d+)/, async (ctx) => {
  if (!checkAdmin(ctx)) {
    return ctx.answerCbQuery('🚫 Только для админа');
  }
  const targetUserId = ctx.match[1];
  // Мы предполагаем, что конфиг файл уже отправлен автоматически
  ctx.session.awaitingVpnVideoFor = targetUserId; // Сразу ожидаем видео
  await ctx.reply(`Загрузите *видеоинструкцию* для пользователя ${targetUserId}:`);
  await ctx.answerCbQuery();
});


// Кнопки пользователя (Inline Keyboard)
bot.action('check_subscription', checkSubscriptionStatus); // Эта кнопка больше не нужна, если есть Reply Keyboard
bot.action('ask_question', promptForQuestion); // Эта кнопка больше не нужна, если есть Reply Keyboard
bot.action('extend_subscription', extendSubscription); // Эта кнопка больше не нужна, если есть Reply Keyboard
bot.action(/send_vpn_info_(\d+)/, requestVpnInfo); // Эта кнопка теперь только для запроса видео
bot.action(/vpn_configured_(\d+)/, handleVpnConfigured);

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