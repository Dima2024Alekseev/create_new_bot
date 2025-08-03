require('dotenv').config({ path: __dirname + '/../primer.env' });

const { Telegraf, Markup } = require('telegraf');
const LocalSession = require('telegraf-session-local');
const connectDB = require('./config/db');
const User = require('./models/User');

const {
  handleStart,
  checkSubscriptionStatus,
  extendSubscription,
  promptForQuestion,
  handleVpnConfigured,
  promptVpnFailure,
  promptCancelSubscription,
  cancelSubscriptionFinal,
  cancelSubscriptionAbort,
  askRejectionReason
} = require('./controllers/userController');

const {
  handlePhoto,
  handleApprove,
  handleReject,
  handleRejectionComment,
  cancelRejection
} = require('./controllers/paymentController');

const { checkPayments, stats, checkAdminMenu } = require('./controllers/adminController');
const { handleQuestion, handleAnswer, listQuestions } = require('./controllers/questionController');
const { setupReminders } = require('./services/reminderService');
const { checkAdmin } = require('./utils/auth');
const { setConfig, getConfig } = require('./services/configService');

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
  getSessionKey: (ctx) => ctx.from?.id.toString(),
  storage: LocalSession.storageFileAsync,
  format: {
    serialize: (obj) => JSON.stringify(obj, null, 2),
    deserialize: (str) => JSON.parse(str)
  }
})).middleware());

// Функция изменения цены
async function finalizePriceChange(ctx, newPrice) {
  const oldPrice = await getConfig('vpn_price', 132);
  await setConfig('vpn_price', newPrice);

  delete ctx.session.awaitingNewPrice;
  delete ctx.session.pendingPriceChange;

  await ctx.reply(`✅ Цена успешно изменена с ${oldPrice} ₽ на ${newPrice} ₽`);
  await checkAdminMenu(ctx);

  console.log(`[PRICE CHANGE] Admin ${ctx.from.id} changed price from ${oldPrice} to ${newPrice} RUB`);
}

// Подключение к БД
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
  await bot.stop().catch(e => console.error("Error stopping bot on uncaught exception:", e));
  process.exit(1);
});

// Middleware для обработки администраторских действий
bot.use(async (ctx, next) => {
  if (ctx.from?.id === parseInt(process.env.ADMIN_ID)) {
    // Обработка ответа на вопрос
    if (ctx.session?.awaitingAnswerFor && ctx.message?.text) {
      await handleAnswer(ctx);
      return;
    }

    // Обработка ответа на проблему с VPN
    if (ctx.session?.awaitingAnswerVpnIssueFor && ctx.message?.text) {
      const targetUserId = ctx.session.awaitingAnswerVpnIssueFor;
      const adminAnswer = ctx.message.text;

      try {
        await ctx.telegram.sendMessage(
          targetUserId,
          `🛠️ *Ответ администратора по вашей проблеме с VPN:*\n\n"${adminAnswer}"`,
          { parse_mode: 'Markdown' }
        );
        await ctx.reply(`✅ Ответ отправлен пользователю ${targetUserId}.`);
      } catch (error) {
        console.error(`Ошибка отправки ответа пользователю ${targetUserId}:`, error);
        await ctx.reply(`⚠️ Ошибка отправки ответа.`);
      } finally {
        ctx.session.awaitingAnswerVpnIssueFor = null;
      }
      return;
    }

    // Обработка новой цены
    if (ctx.session?.awaitingNewPrice && ctx.message?.text) {
      const newPrice = parseInt(ctx.message.text);

      if (isNaN(newPrice)) {
        return ctx.reply('❌ Цена должна быть числом. Попробуйте еще раз:');
      }

      if (newPrice < 50 || newPrice > 5000) {
        return ctx.reply('❌ Цена должна быть от 50 до 5000 ₽. Введите корректную сумму:');
      }

      const oldPrice = await getConfig('vpn_price', 132);

      if (Math.abs(newPrice - oldPrice) > 500) {
        ctx.session.pendingPriceChange = { newPrice, oldPrice };
        return ctx.reply(
          `⚠️ Вы изменяете цену более чем на 500 ₽\nТекущая: ${oldPrice} ₽\nНовая: ${newPrice} ₽\n\nПодтвердите:`,
          Markup.inlineKeyboard([
            [Markup.button.callback('✅ Подтвердить', 'confirm_price_change')],
            [Markup.button.callback('❌ Отменить', 'cancel_price_change')]
          ])
        );
      }

      await finalizePriceChange(ctx, newPrice);
      return;
    }

    // Обработка комментария отклонения
    if (ctx.session?.rejectingPaymentFor && ctx.message?.text) {
      await handleRejectionComment(ctx);
      return;
    }
  }

  // Обработка проблемы с VPN от пользователя
  if (ctx.session?.awaitingVpnTroubleshoot && ctx.from?.id === ctx.session.awaitingVpnTroubleshoot && ctx.message?.text) {
    const userId = ctx.from.id;
    const problemDescription = ctx.message.text;
    const user = await User.findOne({ userId });

    let userName = user?.firstName || user?.username || 'Без имени';
    if (user?.username) userName = `${userName} (@${user.username})`;

    await ctx.telegram.sendMessage(
      process.env.ADMIN_ID,
      `🚨 *Проблема с VPN от ${userName} (ID: ${userId}):*\n\n"${problemDescription}"`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '➡️ Ответить', callback_data: `answer_vpn_issue_${userId}` }]
          ]
        }
      }
    );

    await ctx.reply('✅ Ваша проблема отправлена администратору. Он свяжется с вами.');
    ctx.session.awaitingVpnTroubleshoot = null;
    return;
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

bot.on('text', async (ctx, next) => {
  if (ctx.from?.id === parseInt(process.env.ADMIN_ID) &&
    (ctx.session?.awaitingAnswerFor ||
      ctx.session?.awaitingAnswerVpnIssueFor ||
      ctx.session?.awaitingNewPrice ||
      ctx.session?.rejectingPaymentFor)) {
    return next();
  }

  if (ctx.session?.awaitingPaymentProof) {
    return ctx.reply('⚠️ Пожалуйста, отправьте скриншот оплаты. Для отмены нажмите /start');
  }

  if (ctx.message.text.startsWith('/')) {
    return next();
  }

  if (checkAdmin(ctx)) {
    return ctx.reply("Команда не распознана. Используйте панель администратора /admin");
  } else {
    await handleQuestion(ctx);
  }
});

// Админские команды
bot.command('admin', checkAdminMenu);
bot.command('check', checkPayments);
bot.command('stats', stats);
bot.command('questions', listQuestions);

// Обработка фото платежей
bot.on('photo', handlePhoto);

// Обработчики callback-кнопок
bot.action(/approve_(\d+)/, handleApprove);
bot.action(/reject_(\d+)/, handleReject);
bot.action('cancel_rejection', cancelRejection);
bot.action('list_questions', listQuestions);
bot.action('check_payments_admin', checkPayments);
bot.action('show_stats_admin', stats);
bot.action('refresh_stats', stats);
bot.action('ask_rejection_reason', askRejectionReason);

bot.action('set_price_admin', async (ctx) => {
  if (!checkAdmin(ctx)) return ctx.answerCbQuery('🚫 Только для админа');

  const currentPrice = await getConfig('vpn_price', 132);
  ctx.session.awaitingNewPrice = true;

  await ctx.reply(
    `✏️ <b>Изменение цены подписки</b>\n\nТекущая цена: <b>${currentPrice} ₽</b>\n\nВведите новую цену (50-5000 ₽):`,
    {
      parse_mode: 'HTML',
      reply_markup: Markup.inlineKeyboard([
        [Markup.button.callback('❌ Отмена', 'cancel_price_change')]
      ])
    }
  );
  await ctx.answerCbQuery();
});

bot.action('confirm_price_change', async (ctx) => {
  if (!checkAdmin(ctx)) return ctx.answerCbQuery('🚫 Только для админа');
  const { newPrice } = ctx.session.pendingPriceChange;
  await finalizePriceChange(ctx, newPrice);
  await ctx.answerCbQuery();
});

bot.action('cancel_price_change', async (ctx) => {
  if (!checkAdmin(ctx)) return ctx.answerCbQuery('🚫 Только для админа');
  delete ctx.session.pendingPriceChange;
  delete ctx.session.awaitingNewPrice;
  await ctx.reply('❌ Изменение цены отменено');
  await ctx.answerCbQuery();
  await checkAdminMenu(ctx);
});

bot.action(/answer_([0-9a-fA-F]{24})/, async (ctx) => {
  if (!checkAdmin(ctx)) return ctx.answerCbQuery('🚫 Только для админа');
  ctx.session.awaitingAnswerFor = ctx.match[1];
  await ctx.reply('✍️ Введите ответ для пользователя:');
  await ctx.answerCbQuery();
});

bot.action(/answer_vpn_issue_(\d+)/, async (ctx) => {
  if (!checkAdmin(ctx)) return ctx.answerCbQuery('🚫 Только для админа');
  ctx.session.awaitingAnswerVpnIssueFor = parseInt(ctx.match[1]);
  await ctx.reply(`✍️ Введите ответ для пользователя ${ctx.match[1]}:`);
  await ctx.answerCbQuery();
});

// Пользовательские кнопки
bot.action('check_subscription', checkSubscriptionStatus);
bot.action('ask_question', promptForQuestion);
bot.action('extend_subscription', extendSubscription);
bot.action(/vpn_configured_(\d+)/, handleVpnConfigured);
bot.action(/vpn_failed_(\d+)/, promptVpnFailure);
bot.action('cancel_subscription_confirm', promptCancelSubscription);
bot.action('cancel_subscription_final', cancelSubscriptionFinal);
bot.action('cancel_subscription_abort', cancelSubscriptionAbort);

// Настройка напоминаний
setupReminders(bot);

// Запуск бота
bot.launch()
  .then(() => console.log('🤖 Бот успешно запущен'))
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