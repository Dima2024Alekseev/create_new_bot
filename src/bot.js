require('dotenv').config({ path: __dirname + '/../primer.env' });

const { Telegraf, session, Markup } = require('telegraf');
const LocalSession = require('telegraf-session-local');
const connectDB = require('./config/db');
const User = require('./models/User');

const {
  handleStart,
  checkSubscriptionStatus,
  extendSubscription,
  confirmPayment,
  cancelPayment,
  promptForQuestion,
  handleVpnConfigured,
  promptVpnFailure,
  promptCancelSubscription,
  cancelSubscriptionFinal,
  cancelSubscriptionAbort
} = require('./controllers/userController');

const { 
  handlePhoto, 
  handleApprove, 
  handleReject,
  handleForceApprove
} = require('./controllers/paymentController');
const { checkPayments, stats, checkAdminMenu } = require('./controllers/adminController');
const { handleQuestion, handleAnswer, listQuestions } = require('./controllers/questionController');
const { setupReminders } = require('./services/reminderService');
const { checkAdmin } = require('./utils/auth');

const bot = new Telegraf(process.env.BOT_TOKEN, {
  telegram: {
    agent: null,
    handshakeTimeout: 30000
  }
});

// Улучшенная конфигурация сессии
bot.use((new LocalSession({ 
  database: 'session_db.json',
  property: 'session',
  getSessionKey: (ctx) => ctx.from?.id.toString()
})).middleware());

connectDB().catch(err => {
  console.error('❌ MongoDB connection failed:', err);
  process.exit(1);
});

// Глобальные обработчики ошибок
process.on('unhandledRejection', (reason, promise) => {
  console.error('⚠️ Unhandled Rejection at:', promise, 'reason:', reason);
  console.error('Stack trace:', reason.stack);
});

process.on('uncaughtException', async (err) => {
  console.error('⚠️ Uncaught Exception:', err);
  console.error('Stack trace:', err.stack);
  try {
    await bot.telegram.sendMessage(
      process.env.ADMIN_ID, 
      `🚨 Критическая ошибка бота: ${err.message}\n\`\`\`\n${err.stack}\n\`\`\``, 
      { parse_mode: 'Markdown' }
    ).catch(e => console.error("Error sending exception to admin:", e));
  } catch (e) {
    console.error("Failed to send uncaught exception to admin:", e);
  }
  await bot.stop().catch(e => console.error("Error stopping bot:", e));
  process.exit(1);
});

// Middleware для проверки ожидания скриншота
bot.use(async (ctx, next) => {
  // Пропускаем все сообщения от админа
  if (ctx.from?.id === parseInt(process.env.ADMIN_ID)) {
    if (ctx.session?.awaitingAnswerFor && ctx.message?.text) {
      await handleAnswer(ctx);
      return;
    }

    if (ctx.session?.awaitingAnswerVpnIssueFor && ctx.message?.text) {
      const targetUserId = ctx.session.awaitingAnswerVpnIssueFor;
      const adminAnswer = ctx.message.text;

      try {
        await ctx.telegram.sendMessage(
          targetUserId,
          `🛠️ *Ответ администратора по вашей проблеме с VPN:*\n\n"${adminAnswer}"`,
          { parse_mode: 'Markdown' }
        );
        await ctx.reply(`✅ Ответ отправлен пользователю ${targetUserId}`);
      } catch (error) {
        console.error(`Ошибка отправки ответа пользователю ${targetUserId}:`, error);
        await ctx.reply('⚠️ Не удалось отправить ответ');
      } finally {
        ctx.session.awaitingAnswerVpnIssueFor = null;
      }
      return;
    }
    return next();
  }

  // Обработка проблем с VPN
  if (ctx.session?.awaitingVpnTroubleshoot && ctx.message?.text) {
    const userId = ctx.from.id;
    const problem = ctx.message.text;
    const user = await User.findOne({ userId });

    await ctx.telegram.sendMessage(
      process.env.ADMIN_ID,
      `🚨 Проблема с VPN от ${user.firstName} (@${user.username || 'нет'}):\n\n${problem}`,
      Markup.inlineKeyboard([
        [Markup.button.callback('Ответить', `answer_vpn_issue_${userId}`)]
      ])
    );

    await ctx.reply('✅ Ваша проблема передана администратору');
    ctx.session.awaitingVpnTroubleshoot = null;
    return;
  }

  // Блокировка случайных скриншотов
  if (ctx.message?.photo && !ctx.session?.expectingPaymentPhoto) {
    return ctx.replyWithMarkdown(
      '📢 *Чтобы оплатить подписку:*\n\n' +
      '1. Нажмите *"💰 Оплатить подписку"*\n' +
      '2. Следуйте инструкциям\n' +
      '3. *Только затем* отправляйте скриншот\n\n' +
      '❌ Случайные скриншоты не принимаются!'
    );
  }

  return next();
});

// Обработчики команд
bot.start(async (ctx) => {
  if (checkAdmin(ctx)) {
    await checkAdminMenu(ctx);
  } else {
    await handleStart(ctx);
  }
});

// Обработка текстовых сообщений
bot.on('text', async (ctx, next) => {
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
bot.command('questions', listQuestions);

// Обработка платежей
bot.on('photo', handlePhoto);

// Кнопки админа
bot.action(/approve_(\d+)/, handleApprove);
bot.action(/reject_(\d+)/, handleReject);
bot.action(/force_approve_(\d+)/, handleForceApprove);
bot.action('list_questions', listQuestions);
bot.action('check_payments_admin', checkPayments);
bot.action('show_stats_admin', stats);
bot.action('refresh_stats', stats);
bot.action(/answer_(\d+)/, async (ctx) => {
  if (!checkAdmin(ctx)) return ctx.answerCbQuery('🚫 Только для админа');
  ctx.session.awaitingAnswerFor = ctx.match[1];
  await ctx.reply('✍️ Введите ответ для пользователя:');
});
bot.action(/answer_vpn_issue_(\d+)/, async (ctx) => {
  if (!checkAdmin(ctx)) return ctx.answerCbQuery('🚫 Только для админа');
  ctx.session.awaitingAnswerVpnIssueFor = ctx.match[1];
  await ctx.reply(`✍️ Введите ответ для пользователя ${ctx.match[1]}:`);
});

// Кнопки пользователя
bot.action('check_subscription', checkSubscriptionStatus);
bot.action('ask_question', promptForQuestion);
bot.action('extend_subscription', extendSubscription);
bot.action('confirm_payment', confirmPayment);
bot.action('cancel_payment', cancelPayment);
bot.action(/vpn_configured_(\d+)/, handleVpnConfigured);
bot.action(/vpn_failed_(\d+)/, promptVpnFailure);
bot.action('cancel_subscription_confirm', promptCancelSubscription);
bot.action('cancel_subscription_final', cancelSubscriptionFinal);
bot.action('cancel_subscription_abort', cancelSubscriptionAbort);

// Напоминания
setupReminders(bot);

// Запуск бота
bot.launch()
  .then(() => console.log('🤖 Бот запущен'))
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