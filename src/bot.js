require('dotenv').config({ path: __dirname + '/../primer.env' });

const { Telegraf, session, Markup } = require('telegraf');
const sessionMongo = require('telegraf-session-mongodb');
const connectDB = require('./config/db');
const User = require('./models/User');

// Логирование импорта sessionMongo для диагностики
console.log('Импорт sessionMongo:', sessionMongo);

const {
  handleStart,
  checkSubscriptionStatus,
  extendSubscription,
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
  handleRejectSimple,
  handleRejectWithComment,
  handleCancelRejection,
  handleReviewLater,
  finalizeRejectionWithComment
} = require('./controllers/paymentController');

const {
  checkPayments,
  stats,
  checkAdminMenu,
  handlePaymentsPage,
  listUsers,
  handleUsersPage,
  listReviews,
  handleReviewsPage,
  showBroadcastMenu,
  startBroadcast,
  executeBroadcast,
  cancelBroadcast
} = require('./controllers/adminController');

const { handleQuestion, handleAnswer, listQuestions } = require('./controllers/questionController');
const {
  startReview,
  handleRating,
  handleSpeed,
  handleStability,
  requestComment,
  finishReview,
  cancelReview
} = require('./controllers/reviewController');
const { setupReminders } = require('./services/reminderService');
const { checkAdmin } = require('./utils/auth');
const { setConfigField, getConfig } = require('./services/configService');

const bot = new Telegraf(process.env.BOT_TOKEN, {
  telegram: {
    agent: null,
    handshakeTimeout: 30000
  }
});

// Настройка сессий MongoDB
const setupSession = async () => {
  console.log('Настройка сессий MongoDB...');
  try {
    await connectDB();
    console.log('MongoDB подключена успешно');
    
    // Проверяем, является ли sessionMongo функцией
    if (typeof sessionMongo === 'function') {
      console.log('sessionMongo является функцией, используем напрямую');
      bot.use(sessionMongo({
        url: process.env.MONGODB_URI,
        collectionName: 'users',
        sessionField: 'session',
        model: User
      }));
    } else if (sessionMongo && typeof sessionMongo.session === 'function') {
      console.log('sessionMongo.session является функцией, используем sessionMongo.session');
      bot.use(sessionMongo.session({
        url: process.env.MONGODB_URI,
        collectionName: 'users',
        sessionField: 'session',
        model: User
      }));
    } else {
      console.error('Ошибка: sessionMongo не является функцией и не содержит метод session:', sessionMongo);
      throw new Error('Неверный API telegraf-session-mongodb');
    }
    
    console.log('Сессии MongoDB настроены успешно');
  } catch (error) {
    console.error('Ошибка при настройке сессий MongoDB:', error);
    throw error;
  }
};

// Вспомогательная функция для изменения цены
async function finalizePriceChange(ctx, newPrice) {
  try {
    const config = await getConfig();
    const oldPrice = config.vpnPrice;
    await setConfigField('vpnPrice', newPrice);

    delete ctx.session.awaitingNewPrice;
    delete ctx.session.pendingPriceChange;

    await ctx.reply(`✅ Цена успешно изменена с ${oldPrice} ₽ на ${newPrice} ₽`);
    await checkAdminMenu(ctx);

    console.log(`[PRICE CHANGE] Admin ${ctx.from.id} changed price from ${oldPrice} to ${newPrice} RUB`);
  } catch (error) {
    console.error('Ошибка при изменении цены:', error);
    await ctx.reply('⚠️ Произошла ошибка при сохранении новой цены.');
    await checkAdminMenu(ctx);
  }
}

// Вспомогательные функции для изменения реквизитов
async function finalizePaymentPhoneChange(ctx, newPhone) {
  try {
    const config = await getConfig();
    const oldPhone = config.paymentPhone;
    await setConfigField('paymentPhone', newPhone);

    delete ctx.session.awaitingPaymentPhone;
    delete ctx.session.pendingPaymentPhoneChange;

    await ctx.reply(`✅ Номер телефона успешно изменён с ${oldPhone} на ${newPhone}`);
    await checkAdminMenu(ctx);

    console.log(`[PAYMENT PHONE CHANGE] Admin ${ctx.from.id} changed phone from ${oldPhone} to ${newPhone}`);
  } catch (error) {
    console.error('Ошибка при изменении номера телефона:', error);
    await ctx.reply('⚠️ Произошла ошибка при сохранении номера телефона.');
    await checkAdminMenu(ctx);
  }
}

async function finalizePaymentCardChange(ctx, newCard) {
  try {
    const config = await getConfig();
    const oldCard = config.paymentCard;
    await setConfigField('paymentCard', newCard);

    delete ctx.session.awaitingPaymentCard;
    delete ctx.session.pendingPaymentCardChange;

    await ctx.reply(`✅ Номер карты успешно изменён с ${oldCard} на ${newCard}`);
    await checkAdminMenu(ctx);

    console.log(`[PAYMENT CARD CHANGE] Admin ${ctx.from.id} changed card from ${oldCard} to ${newCard}`);
  } catch (error) {
    console.error('Ошибка при изменении номера карты:', error);
    await ctx.reply('⚠️ Произошла ошибка при сохранении номера карты.');
    await checkAdminMenu(ctx);
  }
}

async function finalizePaymentBankChange(ctx, newBank) {
  try {
    const config = await getConfig();
    const oldBank = config.paymentBank;
    await setConfigField('paymentBank', newBank);

    delete ctx.session.awaitingPaymentBank;
    delete ctx.session.pendingPaymentBankChange;

    await ctx.reply(`✅ Банк успешно изменён с ${oldBank} на ${newBank}`);
    await checkAdminMenu(ctx);

    console.log(`[PAYMENT BANK CHANGE] Admin ${ctx.from.id} changed bank from ${oldBank} to ${newBank}`);
  } catch (error) {
    console.error('Ошибка при изменении банка:', error);
    await ctx.reply('⚠️ Произошла ошибка при сохранении банка.');
    await checkAdminMenu(ctx);
  }
}

// --- Глобальные обработчики ошибок ---
process.on('unhandledRejection', (reason, promise) => {
  console.error('⚠️ Unhandled Rejection at:', promise, 'reason:', reason);
  console.error('Stack trace:', reason.stack);
});

process.on('uncaughtException', async (err) => {
  console.error('⚠️ Uncaught Exception:', err);
  console.error('Stack trace:', err.stack);
  try {
    await bot.telegram.sendMessage(process.env.ADMIN_ID, `🚨 Критическая ошибка бота: ${err.message}\n\`\`\`\n${err.stack}\n\`\`\``, { parse_mode: 'Markdown' }).catch(e => console.error("Error sending exception to admin:", e));
  } catch (e) {
    console.error("Failed to send uncaught exception to admin:", e);
  }
  await bot.stop().catch(e => console.error("Error stopping bot on uncaught exception:", e));
  process.exit(1);
});

// --- Middleware для обработки админских ответов и реквизитов ---
bot.use(async (ctx, next) => {
  console.log(`Получен контекст для userId: ${ctx.from?.id}, session:`, ctx.session);
  if (ctx.from?.id === parseInt(process.env.ADMIN_ID)) {
    // Обработка ответа на вопрос пользователя
    if (ctx.session?.awaitingAnswerFor && ctx.message?.text) {
      console.log(`Обработка ответа на вопрос для ${ctx.session.awaitingAnswerFor}`);
      await handleAnswer(ctx);
      return;
    }

    // Обработка ответа на проблему с VPN
    if (ctx.session?.awaitingAnswerVpnIssueFor && ctx.message?.text) {
      const targetUserId = ctx.session.awaitingAnswerVpnIssueFor;
      const adminAnswer = ctx.message.text;
      console.log(`Отправка ответа по VPN для userId: ${targetUserId}`);

      try {
        await ctx.telegram.sendMessage(
          targetUserId,
          `🛠️ *Ответ администратора по вашей проблеме с настройкой VPN:*\n\n` +
          `"${adminAnswer}"`,
          { parse_mode: 'Markdown' }
        );
        await ctx.reply(`✅ Ваш ответ успешно отправлен пользователю ${targetUserId}.`);
      } catch (error) {
        console.error(`Ошибка при отправке ответа на проблему VPN пользователю ${targetUserId}:`, error);
        await ctx.reply(`⚠️ Произошла ошибка при отправке ответа.`);
      } finally {
        ctx.session.awaitingAnswerVpnIssueFor = null;
      }
      return;
    }

    // Обработка сообщения для массовой рассылки
    if (ctx.session?.awaitingBroadcastMessage && ctx.message?.text) {
      const broadcastMessage = ctx.message.text.trim();
      console.log('Получено сообщение для рассылки:', broadcastMessage);

      // Валидация сообщения
      if (broadcastMessage.length < 1) {
        return ctx.reply('❌ Сообщение не может быть пустым:');
      }

      if (broadcastMessage.length > 4000) {
        return ctx.reply('❌ Сообщение слишком длинное. Максимум 4000 символов:');
      }

      ctx.session.awaitingBroadcastMessage = false;
      const { confirmBroadcast } = require('./controllers/adminController');
      await confirmBroadcast(ctx, broadcastMessage);
      return;
    }

    // Обработка комментария к отклонению платежа
    if (ctx.session?.awaitingRejectionCommentFor && ctx.message?.text) {
      const rejectionComment = ctx.message.text.trim();
      console.log('Получен комментарий к отклонению платежа:', rejectionComment);

      // Валидация комментария
      if (rejectionComment.length < 5) {
        return ctx.reply('❌ Комментарий слишком короткий. Минимум 5 символов:');
      }

      if (rejectionComment.length > 500) {
        return ctx.reply('❌ Комментарий слишком длинный. Максимум 500 символов:');
      }

      await finalizeRejectionWithComment(ctx, rejectionComment);
      return;
    }

    // Обработка новой цены
    if (ctx.session?.awaitingNewPrice && ctx.message?.text) {
      const newPrice = parseInt(ctx.message.text);
      console.log('Получена новая цена:', newPrice);

      // Валидация
      if (isNaN(newPrice)) {
        return ctx.reply('❌ Цена должна быть числом. Попробуйте еще раз:');
      }

      if (newPrice < 50) {
        return ctx.reply('❌ Цена не может быть меньше 50 ₽. Введите корректную сумму:');
      }

      if (newPrice > 5000) {
        return ctx.reply('❌ Цена не может превышать 5000 ₽. Введите корректную сумму:');
      }

      const config = await getConfig();
      const oldPrice = config.vpnPrice;

      // Если изменение больше чем на 500 руб - запрашиваем подтверждение
      if (Math.abs(newPrice - oldPrice) > 500) {
        ctx.session.pendingPriceChange = {
          newPrice,
          oldPrice
        };

        return ctx.reply(
          `⚠️ Вы изменяете цену более чем на 500 ₽\n` +
          `Текущая цена: ${oldPrice} ₽\n` +
          `Новая цена: ${newPrice} ₽\n\n` +
          `Подтвердите изменение:`,
          Markup.inlineKeyboard([
            [Markup.button.callback('✅ Подтвердить', 'confirm_price_change')],
            [Markup.button.callback('❌ Отменить', 'cancel_price_change')]
          ])
        );
      }

      await finalizePriceChange(ctx, newPrice);
      return;
    }

    // Обработка номера телефона для оплаты
    if (ctx.session?.awaitingPaymentPhone && ctx.message?.text) {
      const newPhone = ctx.message.text.trim();
      console.log('Получен новый номер телефона:', newPhone);

      // Валидация номера телефона
      const phoneRegex = /^\+?\d{1,4}?[-.\s]?\(?\d{1,3}?\)?[-.\s]?\d{1,4}[-.\s]?\d{1,4}[-.\s]?\d{1,9}$/;
      if (!phoneRegex.test(newPhone)) {
        return ctx.reply('❌ Номер телефона введён некорректно. Попробуйте ещё раз:');
      }

      ctx.session.pendingPaymentPhoneChange = { newPhone };
      return ctx.reply(
        `📋 *Подтверждение изменения номера телефона*\n\n` +
        `Новый номер: ${newPhone}\n\n` +
        `Подтвердите изменение:`,
        Markup.inlineKeyboard([
          [Markup.button.callback('✅ Подтвердить', 'confirm_payment_phone_change')],
          [Markup.button.callback('❌ Отменить', 'cancel_payment_phone_change')]
        ])
      );
    }

    // Обработка номера карты
    if (ctx.session?.awaitingPaymentCard && ctx.message?.text) {
      const newCard = ctx.message.text.trim();
      console.log('Получен новый номер карты:', newCard);

      // Валидация номера карты
      const cardRegex = /^\d{4}\s?\d{4}\s?\d{4}\s?\d{4}$/;
      if (!cardRegex.test(newCard)) {
        return ctx.reply('❌ Номер карты введён некорректно. Введите 16 цифр (например, 1234 5678 9012 3456):');
      }

      ctx.session.pendingPaymentCardChange = { newCard };
      return ctx.reply(
        `📋 *Подтверждение изменения номера карты*\n\n` +
        `Новый номер карты: ${newCard}\n\n` +
        `Подтвердите изменение:`,
        Markup.inlineKeyboard([
          [Markup.button.callback('✅ Подтвердить', 'confirm_payment_card_change')],
          [Markup.button.callback('❌ Отменить', 'cancel_payment_card_change')]
        ])
      );
    }

    // Обработка названия банка
    if (ctx.session?.awaitingPaymentBank && ctx.message?.text) {
      const newBank = ctx.message.text.trim();
      console.log('Получено новое название банка:', newBank);

      // Валидация названия банка
      if (newBank.length < 2 || newBank.length > 50) {
        return ctx.reply('❌ Название банка должно быть от 2 до 50 символов:');
      }

      ctx.session.pendingPaymentBankChange = { newBank };
      return ctx.reply(
        `📋 *Подтверждение изменения банка*\n\n` +
        `Новый банк: ${newBank}\n\n` +
        `Подтвердите изменение:`,
        Markup.inlineKeyboard([
          [Markup.button.callback('✅ Подтвердить', 'confirm_payment_bank_change')],
          [Markup.button.callback('❌ Отменить', 'cancel_payment_bank_change')]
        ])
      );
    }
  }

  // Обработка комментария к отзыву (для всех пользователей)
  if (ctx.session?.awaitingReviewComment && ctx.message?.text) {
    const reviewComment = ctx.message.text.trim();
    console.log('Получен комментарий к отзыву:', reviewComment);

    // Валидация комментария
    if (reviewComment.length > 500) {
      return ctx.reply('❌ Комментарий слишком длинный. Максимум 500 символов:');
    }

    ctx.session.awaitingReviewComment = false;
    await finishReview(ctx, reviewComment);
    return;
  }

  // Обработка проблемы с VPN от пользователя
  if (ctx.session?.awaitingVpnTroubleshoot && ctx.from?.id === ctx.session.awaitingVpnTroubleshoot && ctx.message?.text) {
    const userId = ctx.from.id;
    const problemDescription = ctx.message.text;
    const user = await User.findOne({ userId });
    console.log(`Получена проблема с VPN от userId: ${userId}`);

    let userName = user?.firstName || user?.username || 'Без имени';
    if (user?.username) {
      userName = `${userName} (@${user.username})`;
    }

    await ctx.telegram.sendMessage(
      process.env.ADMIN_ID,
      `🚨 *Проблема с настройкой VPN от пользователя ${userName} (ID: ${userId}):*\n\n` +
      `"${problemDescription}"`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '➡️ Ответить пользователю', callback_data: `answer_vpn_issue_${userId}` }]
          ]
        }
      }
    );

    await ctx.reply('✅ Ваше описание проблемы отправлено администратору. Он свяжется с вами для дальнейших инструкций.');
    ctx.session.awaitingVpnTroubleshoot = null;
    return;
  }

  return next();
});

// --- Обработчики команд ---
bot.start(async (ctx) => {
  console.log(`Команда /start от userId: ${ctx.from.id}`);
  if (checkAdmin(ctx)) {
    await checkAdminMenu(ctx);
  } else {
    await handleStart(ctx);
  }
});

// Обработчик текстовых сообщений
bot.on('text', async (ctx, next) => {
  console.log(`Получено текстовое сообщение от userId: ${ctx.from.id}, текст: ${ctx.message.text}`);
  if (ctx.from?.id === parseInt(process.env.ADMIN_ID) && (ctx.session?.awaitingAnswerFor || ctx.session?.awaitingAnswerVpnIssueFor || ctx.session?.awaitingNewPrice || ctx.session?.awaitingRejectionCommentFor || ctx.session?.awaitingBroadcastMessage || ctx.session?.awaitingPaymentPhone || ctx.session?.awaitingPaymentCard || ctx.session?.awaitingPaymentBank)) {
    return next();
  }

  if (ctx.session?.awaitingReviewComment) {
    return next();
  }

  if (ctx.session?.awaitingPaymentProof) {
    return ctx.reply('⚠️ Пожалуйста, отправьте скриншот оплаты, а не текст. Если вы передумали, нажмите /start.');
  }

  if (ctx.message.text.startsWith('/')) {
    return next();
  }

  if (checkAdmin(ctx)) {
    return ctx.reply("О нет, только не это... Ты дошёл до стадии 'напишу боту, вдруг ответит'? 😭 Бро, срочно жми в нейросеть — она хотя бы делает вид, что слушает, а не тупо шлёт стикеры. 🚨🤖");
  } else {
    await handleQuestion(ctx);
  }
});

// Админские команды
bot.command('admin', checkAdminMenu);
bot.command('check', checkPayments);
bot.command('stats', stats);
bot.command('questions', listQuestions);

// Обработка платежей (фото)
bot.on('photo', handlePhoto);

// --- Обработчики кнопок (callback_data) ---

// Кнопки админа
bot.action(/approve_(\d+)/, handleApprove);
bot.action(/reject_(\d+)/, handleReject);
bot.action(/reject_simple_(\d+)/, handleRejectSimple);
bot.action(/reject_with_comment_(\d+)/, handleRejectWithComment);
bot.action(/cancel_rejection_(\d+)/, handleCancelRejection);
bot.action(/review_later_(\d+)/, handleReviewLater);
bot.action('list_questions', listQuestions);
bot.action('check_payments_admin', checkPayments);
bot.action('show_stats_admin', stats);
bot.action('refresh_stats', stats);
bot.action('list_users_admin', listUsers);
bot.action('list_reviews_admin', listReviews);
bot.action('mass_broadcast_admin', showBroadcastMenu);
bot.action(/payments_page_(\d+)/, handlePaymentsPage);
bot.action(/users_page_(\d+)/, handleUsersPage);
bot.action(/reviews_page_(\d+)/, handleReviewsPage);
bot.action(/broadcast_(.+)/, startBroadcast);
bot.action('execute_broadcast', executeBroadcast);
bot.action('cancel_broadcast', cancelBroadcast);
bot.action('back_to_admin_menu', checkAdminMenu);
bot.action('set_price_admin', async (ctx) => {
  console.log('Админ активировал set_price_admin, userId:', ctx.from.id);
  if (!checkAdmin(ctx)) {
    return ctx.answerCbQuery('🚫 Только для админа');
  }

  const config = await getConfig();
  const currentPrice = config.vpnPrice;
  ctx.session.awaitingNewPrice = true;

  await ctx.reply(
    `✏️ <b>Изменение цены подписки</b>\n\n` +
    `Текущая цена: <b>${currentPrice} ₽</b>\n\n` +
    `Введите новую цену (от 50 до 5000 ₽):`,
    {
      parse_mode: 'HTML',
      reply_markup: Markup.inlineKeyboard([
        [Markup.button.callback('❌ Отмена', 'cancel_price_change')]
      ])
    }
  );

  await ctx.answerCbQuery();
});

bot.action('set_payment_phone_admin', async (ctx) => {
  console.log('Админ активировал set_payment_phone_admin, userId:', ctx.from.id);
  if (!checkAdmin(ctx)) {
    return ctx.answerCbQuery('🚫 Только для админа');
  }

  const config = await getConfig();
  ctx.session.awaitingPaymentPhone = true;

  await ctx.reply(
    `✏️ <b>Изменение номера телефона</b>\n\n` +
    `Текущий номер: <b>${config.paymentPhone}</b>\n\n` +
    `Введите новый номер телефона для СБП (например, +79954313457):`,
    {
      parse_mode: 'HTML',
      reply_markup: Markup.inlineKeyboard([
        [Markup.button.callback('❌ Отмена', 'cancel_payment_phone_change')]
      ])
    }
  );

  await ctx.answerCbQuery();
});

bot.action('set_payment_card_admin', async (ctx) => {
  console.log('Админ активировал set_payment_card_admin, userId:', ctx.from.id);
  if (!checkAdmin(ctx)) {
    return ctx.answerCbQuery('🚫 Только для админа');
  }

  const config = await getConfig();
  ctx.session.awaitingPaymentCard = true;

  await ctx.reply(
    `✏️ <b>Изменение номера карты</b>\n\n` +
    `Текущий номер: <b>${config.paymentCard}</b>\n\n` +
    `Введите новый номер карты (например, 1234 5678 9012 3456):`,
    {
      parse_mode: 'HTML',
      reply_markup: Markup.inlineKeyboard([
        [Markup.button.callback('❌ Отмена', 'cancel_payment_card_change')]
      ])
    }
  );

  await ctx.answerCbQuery();
});

bot.action('set_payment_bank_admin', async (ctx) => {
  console.log('Админ активировал set_payment_bank_admin, userId:', ctx.from.id);
  if (!checkAdmin(ctx)) {
    return ctx.answerCbQuery('🚫 Только для админа');
  }

  const config = await getConfig();
  ctx.session.awaitingPaymentBank = true;

  await ctx.reply(
    `✏️ <b>Изменение банка</b>\n\n` +
    `Текущий банк: <b>${config.paymentBank}</b>\n\n` +
    `Введите новое название банка:`,
    {
      parse_mode: 'HTML',
      reply_markup: Markup.inlineKeyboard([
        [Markup.button.callback('❌ Отмена', 'cancel_payment_bank_change')]
      ])
    }
  );

  await ctx.answerCbQuery();
});

bot.action('confirm_price_change', async (ctx) => {
  console.log('Админ подтвердил изменение цены, userId:', ctx.from.id);
  if (!checkAdmin(ctx)) return ctx.answerCbQuery('🚫 Только для админа');

  const { newPrice } = ctx.session.pendingPriceChange;
  await finalizePriceChange(ctx, newPrice);
  await ctx.answerCbQuery();
});

bot.action('cancel_price_change', async (ctx) => {
  console.log('Админ отменил изменение цены, userId:', ctx.from.id);
  if (!checkAdmin(ctx)) return ctx.answerCbQuery('🚫 Только для админа');

  delete ctx.session.pendingPriceChange;
  delete ctx.session.awaitingNewPrice;

  await ctx.reply('❌ Изменение цены отменено');
  await ctx.answerCbQuery();
  await checkAdminMenu(ctx);
});

bot.action('confirm_payment_phone_change', async (ctx) => {
  console.log('Админ подтвердил изменение номера телефона, userId:', ctx.from.id);
  if (!checkAdmin(ctx)) return ctx.answerCbQuery('🚫 Только для админа');

  const { newPhone } = ctx.session.pendingPaymentPhoneChange;
  await finalizePaymentPhoneChange(ctx, newPhone);
  await ctx.answerCbQuery();
});

bot.action('cancel_payment_phone_change', async (ctx) => {
  console.log('Админ отменил изменение номера телефона, userId:', ctx.from.id);
  if (!checkAdmin(ctx)) return ctx.answerCbQuery('🚫 Только для админа');

  delete ctx.session.pendingPaymentPhoneChange;
  delete ctx.session.awaitingPaymentPhone;

  await ctx.reply('❌ Изменение номера телефона отменено');
  await ctx.answerCbQuery();
  await checkAdminMenu(ctx);
});

bot.action('confirm_payment_card_change', async (ctx) => {
  console.log('Админ подтвердил изменение номера карты, userId:', ctx.from.id);
  if (!checkAdmin(ctx)) return ctx.answerCbQuery('🚫 Только для админа');

  const { newCard } = ctx.session.pendingPaymentCardChange;
  await finalizePaymentCardChange(ctx, newCard);
  await ctx.answerCbQuery();
});

bot.action('cancel_payment_card_change', async (ctx) => {
  console.log('Админ отменил изменение номера карты, userId:', ctx.from.id);
  if (!checkAdmin(ctx)) return ctx.answerCbQuery('🚫 Только для админа');

  delete ctx.session.pendingPaymentCardChange;
  delete ctx.session.awaitingPaymentCard;

  await ctx.reply('❌ Изменение номера карты отменено');
  await ctx.answerCbQuery();
  await checkAdminMenu(ctx);
});

bot.action('confirm_payment_bank_change', async (ctx) => {
  console.log('Админ подтвердил изменение банка, userId:', ctx.from.id);
  if (!checkAdmin(ctx)) return ctx.answerCbQuery('🚫 Только для админа');

  const { newBank } = ctx.session.pendingPaymentBankChange;
  await finalizePaymentBankChange(ctx, newBank);
  await ctx.answerCbQuery();
});

bot.action('cancel_payment_bank_change', async (ctx) => {
  console.log('Админ отменил изменение банка, userId:', ctx.from.id);
  if (!checkAdmin(ctx)) return ctx.answerCbQuery('🚫 Только для админа');

  delete ctx.session.pendingPaymentBankChange;
  delete ctx.session.awaitingPaymentBank;

  await ctx.reply('❌ Изменение банка отменено');
  await ctx.answerCbQuery();
  await checkAdminMenu(ctx);
});

bot.action(/answer_([0-9a-fA-F]{24})/, async (ctx) => {
  console.log(`Админ активировал ответ на вопрос, questionId: ${ctx.match[1]}, userId: ${ctx.from.id}`);
  if (!checkAdmin(ctx)) {
    return ctx.answerCbQuery('🚫 Только для админа');
  }
  ctx.session.awaitingAnswerFor = ctx.match[1];
  await ctx.reply('✍️ Введите ответ для пользователя:');
  await ctx.answerCbQuery();
});

bot.action(/answer_vpn_issue_(\d+)/, async (ctx) => {
  console.log(`Админ активировал ответ на VPN проблему, targetUserId: ${ctx.match[1]}, userId: ${ctx.from.id}`);
  if (!checkAdmin(ctx)) {
    return ctx.answerCbQuery('🚫 Только для админа');
  }
  const targetUserId = parseInt(ctx.match[1]);
  ctx.session.awaitingAnswerVpnIssueFor = targetUserId;
  await ctx.reply(`✍️ Введите ответ для пользователя ${targetUserId} по его проблеме с VPN:`);
  await ctx.answerCbQuery();
});

// Кнопки пользователя
bot.action('check_subscription', async (ctx) => {
  console.log('Пользователь проверяет подписку, userId:', ctx.from.id);
  await checkSubscriptionStatus(ctx);
  await ctx.reply(
    'Нажмите, чтобы вернуться в главное меню:',
    Markup.inlineKeyboard([[Markup.button.callback('🏠 Личный кабинет', 'back_to_user_menu')]])
  );
});
bot.action('ask_question', promptForQuestion);
bot.action('extend_subscription', async (ctx) => {
  console.log('Пользователь продлевает подписку, userId:', ctx.from.id);
  await extendSubscription(ctx);
  await ctx.reply(
    'Нажмите, чтобы вернуться в главное меню:',
    Markup.inlineKeyboard([[Markup.button.callback('🏠 Личный кабинет', 'back_to_user_menu')]])
  );
});
bot.action('leave_review', async (ctx) => {
  console.log('Пользователь оставляет отзыв, userId:', ctx.from.id);
  await startReview(ctx);
  await ctx.reply(
    'Нажмите, чтобы вернуться в главное меню:',
    Markup.inlineKeyboard([[Markup.button.callback('🏠 Личный кабинет', 'back_to_user_menu')]])
  );
});
bot.action(/vpn_configured_(\d+)/, handleVpnConfigured);
bot.action(/vpn_failed_(\d+)/, promptVpnFailure);
bot.action('back_to_user_menu', async (ctx) => {
  console.log('Пользователь возвращается в главное меню, userId:', ctx.from.id);
  await ctx.answerCbQuery();
  await handleStart(ctx);
});

// Обработчики для отмены подписки
bot.action('cancel_subscription_confirm', async (ctx) => {
  console.log('Пользователь подтверждает отмену подписки, userId:', ctx.from.id);
  await promptCancelSubscription(ctx);
  await ctx.reply(
    'Нажмите, чтобы вернуться в главное меню:',
    Markup.inlineKeyboard([[Markup.button.callback('🏠 Личный кабинет', 'back_to_user_menu')]])
  );
});
bot.action('cancel_subscription_final', cancelSubscriptionFinal);
bot.action('cancel_subscription_abort', cancelSubscriptionAbort);

// Обработчики для отзывов
bot.action(/review_rating_(\d+)/, handleRating);
bot.action(/review_speed_(.+)/, handleSpeed);
bot.action(/review_stability_(.+)/, handleStability);
bot.action('review_add_comment', requestComment);
bot.action('review_finish', finishReview);
bot.action('review_cancel', cancelReview);

// --- Напоминания ---
setupReminders(bot);

// --- Запуск ---
setupSession().then(() => {
  console.log('Запуск бота...');
  bot.launch()
    .then(() => console.log('🤖 Бот запущен (Q&A + Payments)'))
    .catch(err => {
      console.error('🚨 Ошибка запуска:', err);
      process.exit(1);
    });
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