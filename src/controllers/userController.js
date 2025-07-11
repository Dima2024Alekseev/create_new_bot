// controllers/userController.js

const User = require('../models/User');
const Question = require('../models/Question'); // Добавьте этот импорт, если его нет
const { paymentDetails, formatDate, formatDuration } = require('../utils/helpers');
const { checkAdmin } = require('./adminController');
const { Markup } = require('telegraf');

// === handleStart ===
exports.handleStart = async (ctx) => {
  const { id, first_name } = ctx.from;

  // === ЛОГИКА ДЛЯ АДМИНА ===
  if (id === parseInt(process.env.ADMIN_ID) && checkAdmin(ctx)) {
    return ctx.replyWithMarkdown(
      '👋 *Админ-панель*\n\n' +
      'Команды:\n' +
      '/check - Проверить заявки\n' +
      '/stats - Статистика\n' +
      '/questions - Все вопросы',
      {
        reply_markup: { // Используем InlineKeyboardMarkup
          inline_keyboard: [
            [{ text: 'Проверить заявки', callback_data: 'check_payments_admin' }],
            [{ text: 'Статистика', callback_data: 'show_stats_admin' }],
            [{ text: 'Все вопросы', callback_data: 'list_questions' }]
          ]
        }
      }
    );
  }

  // === ЛОГИКА ДЛЯ ОБЫЧНОГО ПОЛЬЗОВАТЕЛЯ ===
  const user = await User.findOne({ userId: id });

  let message = '';
  let keyboardButtons = [];

  const hasActiveOrPendingSubscription = user?.status === 'active' || user?.status === 'pending';

  if (user?.status === 'active' && user.expireDate) {
    const timeLeft = user.expireDate.getTime() - new Date().getTime();

    message = `✅ *Ваша подписка активна до ${formatDate(user.expireDate, true)}*`;
    if (timeLeft > 0) {
      message += `\nОсталось: ${formatDuration(timeLeft)}.`;
    } else {
      message += `\nСрок действия истёк.`;
    }

    keyboardButtons.push([{ text: '🗓 Продлить подписку', callback_data: 'extend_subscription' }]);

    // Показываем кнопку "Получить файл и инструкцию" только если это первая подписка
    if (!user.subscriptionCount || user.subscriptionCount === 1) {
      keyboardButtons.push([{ text: '📁 Получить файл и инструкцию', callback_data: `send_vpn_info_${id}` }]);
    }

  } else {
    message = `🔐 *VPN подписка: ${process.env.VPN_PRICE || 132} руб/мес*\n\n` +
      `${paymentDetails(id, first_name)}\n\n` +
      '_После оплаты отправьте скриншот чека_';
  }

  if (hasActiveOrPendingSubscription) {
    keyboardButtons.push(
      [{ text: '🗓 Посмотреть срок действия подписки', callback_data: 'check_subscription' }]
    );
  }

  keyboardButtons.push(
    [{ text: '❓ Задать вопрос', callback_data: 'ask_question' }]
  );

  // Для обычного пользователя продолжим использовать InlineKeyboard
  ctx.replyWithMarkdown(
    message,
    {
      disable_web_page_preview: true,
      reply_markup: {
        inline_keyboard: keyboardButtons
      }
    }
  );
};

// === checkSubscriptionStatus ===
exports.checkSubscriptionStatus = async (ctx) => {
  const { id, first_name } = ctx.from;
  const user = await User.findOne({ userId: id });

  if (!user || (user.status !== 'active' && user.status !== 'pending')) {
    await ctx.replyWithMarkdown(
      `Вы пока не активировали подписку. VPN подписка: *${process.env.VPN_PRICE || 132} руб/мес*\n\n` +
      `${paymentDetails(id, first_name)}\n\n` +
      '_После оплаты отправьте скриншот чека_',
      { disable_web_page_preview: true }
    );
    return ctx.answerCbQuery();
  }

  if (user?.status === 'active' && user.expireDate) {
    const timeLeft = user.expireDate.getTime() - new Date().getTime();

    let message = `✅ *Ваша подписка активна до ${formatDate(user.expireDate, true)}*`;
    if (timeLeft > 0) {
      message += `\nОсталось: ${formatDuration(timeLeft)}.`;
    } else {
      message += `\nСрок действия истёк.`;
    }

    await ctx.replyWithMarkdown(message);
  } else if (user?.status === 'pending') {
    await ctx.reply('⏳ Ваша заявка на оплату находится на проверке. Ожидайте подтверждения.');
  } else if (user?.status === 'rejected') {
    await ctx.reply('❌ Ваша последняя заявка на оплату была отклонена. Пожалуйста, отправьте новый скриншот.');
  } else {
    await ctx.replyWithMarkdown(
      `Вы пока не активировали подписку. VPN подписка: *${process.env.VPN_PRICE || 132} руб/мес*\n\n` +
      `${paymentDetails(id, first_name)}\n\n` +
      '_После оплаты отправьте скриншот чека_',
      { disable_web_page_preview: true }
    );
  }
  await ctx.answerCbQuery();
};

// === extendSubscription ===
exports.extendSubscription = async (ctx) => {
  const { id, first_name } = ctx.from;
  await ctx.replyWithMarkdown(
    `Для продления подписки отправьте новый скриншот оплаты.\n\n` +
    `🔐 *VPN подписка: ${process.env.VPN_PRICE || 132} руб/мес*\n\n` +
    `${paymentDetails(id, first_name)}\n\n` +
    '_После оплаты отправьте скриншот чека_',
    { disable_web_page_preview: true }
  );
  await ctx.answerCbQuery();
};

// === promptForQuestion ===
exports.promptForQuestion = async (ctx) => {
  await ctx.reply('✍️ Напишите ваш вопрос в следующем сообщении. Я передам его администратору.');
  await ctx.answerCbQuery();
};

// === requestVpnInfo ===
exports.requestVpnInfo = async (ctx) => {
  const userId = parseInt(ctx.match[1]);
  const user = await User.findOne({ userId });

  if (!user || user.status !== 'active' || (user.subscriptionCount && user.subscriptionCount > 1)) {
    await ctx.reply('⚠️ Вы можете запросить инструкцию только при первой активации подписки.');
    return ctx.answerCbQuery();
  }

  await ctx.telegram.sendMessage(
    process.env.ADMIN_ID,
    `🔔 Пользователь ${user.firstName || user.username || 'Без имени'} (ID: ${userId}) запросил файл конфигурации и видеоинструкцию.`,
    Markup.inlineKeyboard([
      [Markup.button.callback('➡️ Отправить инструкцию', `send_instruction_to_${userId}`)]
    ])
  );

  await ctx.reply('✅ Ваш запрос на получение инструкции отправлен администратору. Он вышлет вам необходимые файлы в ближайшее время.');
  await ctx.answerCbQuery();
};

// === handleVpnConfigured ===
exports.handleVpnConfigured = async (ctx) => {
  const userId = parseInt(ctx.match[1]);
  const user = await User.findOne({ userId });

  if (!user) {
    return ctx.answerCbQuery('Пользователь не найден.');
  }

  if (user.vpnConfigured) {
    return ctx.answerCbQuery('Вы уже подтвердили успешную настройку ранее.');
  }

  await User.findOneAndUpdate(
    { userId },
    { vpnConfigured: true },
    { new: true }
  );

  await ctx.telegram.sendMessage(
    process.env.ADMIN_ID,
    `🎉 Пользователь ${user.firstName || user.username || 'Без имени'} (ID: ${userId}) успешно настроил VPN!`
  );

  await ctx.reply('Спасибо за подтверждение! Приятного использования VPN.');
  await ctx.answerCbQuery('Подтверждение получено!');
};

// === handleUserReplyKeyboard (новый) ===
exports.handleUserReplyKeyboard = async (ctx) => {
    const text = ctx.message.text;
    switch (text) {
        case '🗓 Моя подписка':
            await exports.checkSubscriptionStatus(ctx);
            break;
        case '❓ Задать вопрос':
            await exports.promptForQuestion(ctx);
            break;
        case '💰 Продлить VPN':
            await exports.extendSubscription(ctx);
            break;
        case '📚 Мои вопросы':
            await exports.showUserQuestions(ctx); // Вызываем новую функцию
            break;
        default:
            // Этого не должно произойти, если кнопки обрабатываются явно.
            // Но можно добавить запасной вариант.
            await ctx.reply('Извините, я не понял эту команду. Пожалуйста, используйте кнопки.');
            break;
    }
};

// === showUserQuestions (новый) ===
exports.showUserQuestions = async (ctx) => {
    try {
        const userId = ctx.from.id;

        // Убедитесь, что импортировали модель Question вверху
        const Question = require('../models/Question'); // Если еще не импортирован

        const userQuestions = await Question.find({ userId: userId })
                                          .sort({ createdAt: -1 })
                                          .limit(10);

        if (userQuestions.length === 0) {
            return ctx.reply('У вас пока нет заданных вопросов.');
        }

        let message = '📚 *Ваши недавние вопросы:*\n\n';

        for (const [index, question] of userQuestions.entries()) {
            message += `*${index + 1}. Вопрос от ${formatDate(question.createdAt, true)}:*\n`;
            message += `> ${question.questionText}\n`;
            if (question.status === 'answered' && question.answerText) {
                message += `*Ответ:* ${question.answerText}\n`;
            } else if (question.status === 'pending') {
                message += `_Статус:_ ⏳ Ожидает ответа\n`;
            } else {
                 message += `_Статус:_ ${question.status}\n`;
            }
            message += '\n';
        }

        await ctx.reply(message, { parse_mode: 'Markdown' });

    } catch (error) {
        console.error(`Ошибка при получении вопросов пользователя ${ctx.from.id}:`, error);
        await ctx.reply('Произошла ошибка при попытке получить ваши вопросы. Пожалуйста, попробуйте позже.');
    }
};