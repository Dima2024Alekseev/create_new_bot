const User = require('../models/User');
const { paymentDetails, formatDate, formatDuration } = require('../utils/helpers');
const { checkAdmin } = require('./adminController');
const { Markup } = require('telegraf');

exports.handleStart = async (ctx) => {
  const { id, first_name, username } = ctx.from;
  
  // === ЛОГИКА ДЛЯ АДМИНА ===
  // Если пользователь является админом, показываем админ-панель с INLINE-клавиатурой
  if (id === parseInt(process.env.ADMIN_ID) && checkAdmin(ctx)) {
    return ctx.replyWithMarkdown(
      '👋 *Админ-панель*\n\n',
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
    
    // Показываем кнопку "Получить файл и инструкцию" только если это первая подписка ИЛИ если он еще не подтвердил настройку
    // и если это активная подписка (чтобы не предлагать неактивным)
    if ((!user.subscriptionCount || user.subscriptionCount === 1) && !user.vpnConfigured) {
      keyboardButtons.push([{ text: '📁 Получить файл и инструкцию', callback_data: `send_vpn_info_${id}` }]);
    }
    
    // --- НОВАЯ КНОПКА ДЛЯ АКТИВНЫХ ПОЛЬЗОВАТЕЛЕЙ ---
    keyboardButtons.push([{ text: '🚫 Отменить подписку', callback_data: 'cancel_subscription_confirm' }]); 
    // ----------------------------------------------

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
    
    await ctx.replyWithMarkdown(message, {
        reply_markup: {
            inline_keyboard: [
                [{ text: '🗓 Продлить подписку', callback_data: 'extend_subscription' }],
                [{ text: '🚫 Отменить подписку', callback_data: 'cancel_subscription_confirm' }] // Добавляем кнопку здесь
            ]
        }
    });
  } else if (user?.status === 'pending') {
    await ctx.reply('⏳ Ваша заявка на оплату находится на проверке. Ожидайте подтверждения.');
  } else if (user?.status === 'rejected') {
    await ctx.reply('❌ Ваша последняя заявка на оплату была отклонена. Пожалуйста, отправьте новый скриншот.');
  } else {
    // Эта ветка, по идее, не должна быть достигнута благодаря первой проверке, но оставлю на всякий случай.
    await ctx.replyWithMarkdown(
      `Вы пока не активировали подписку. VPN подписка: *${process.env.VPN_PRICE || 132} руб/мес*\n\n` +
      `${paymentDetails(id, first_name)}\n\n` +
      '_После оплаты отправьте скриншот чека_',
      { disable_web_page_preview: true }
    );
  }
  await ctx.answerCbQuery();
};

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

exports.promptForQuestion = async (ctx) => {
  await ctx.reply('✍️ Напишите ваш вопрос в следующем сообщении. Я передам его администратору.');
  await ctx.answerCbQuery();
};

exports.requestVpnInfo = async (ctx) => {
  const userId = parseInt(ctx.match[1]);
  const user = await User.findOne({ userId });

  // Проверяем, что подписка активна и пользователь не подтверждал настройку
  // Также проверяем, что это первая подписка (хотя флаг vpnConfigured более универсален)
  if (!user || user.status !== 'active' || user.vpnConfigured) {
    await ctx.reply('⚠️ Вы можете запросить инструкцию только при активной подписке и если вы ещё не подтверждали настройку.');
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

// Обработка нажатия кнопки "Успешно настроил"
exports.handleVpnConfigured = async (ctx) => {
  const userId = parseInt(ctx.match[1]);
  const user = await User.findOne({ userId });

  if (!user) {
    return ctx.answerCbQuery('Пользователь не найден.');
  }

  // Проверяем, не подтверждал ли пользователь уже настройку
  if (user.vpnConfigured) {
    return ctx.answerCbQuery('Вы уже подтвердили успешную настройку ранее.');
  }

  // Обновляем статус пользователя в базе данных
  await User.findOneAndUpdate(
    { userId },
    { vpnConfigured: true },
    { new: true }
  );

  // Уведомляем администратора
  await ctx.telegram.sendMessage(
    process.env.ADMIN_ID,
    `🎉 Пользователь ${user.firstName || user.username || 'Без имени'} (ID: ${userId}) успешно настроил VPN!`
  );

  await ctx.reply('Спасибо за подтверждение! Приятного использования VPN.');
  await ctx.answerCbQuery('Подтверждение получено!');
};

// НОВАЯ ФУНКЦИЯ: Запрос описания проблемы с настройкой VPN
exports.promptVpnFailure = async (ctx) => {
  const userId = parseInt(ctx.match[1]); 

  if (ctx.from.id !== userId) {
    return ctx.answerCbQuery('Это не ваша кнопка.');
  }

  ctx.session.awaitingVpnTroubleshoot = userId;

  await ctx.reply('Пожалуйста, подробно опишите, что именно у вас не получилось при настройке VPN, или на каком шаге возникла проблема.');
  await ctx.answerCbQuery();
};

// --- Новые функции для отмены подписки ---
exports.promptCancelSubscription = async (ctx) => {
    const userId = ctx.from.id;
    const user = await User.findOne({ userId });

    if (!user || user.status !== 'active') {
        await ctx.reply('⚠️ У вас нет активной подписки для отмены.');
        return ctx.answerCbQuery();
    }

    await ctx.reply(
        'Вы уверены, что хотите отменить подписку? Она будет деактивирована, и доступ к VPN будет прекращен.\n\n' +
        'Ваша подписка активна до ' + formatDate(user.expireDate, true) + '.',
        Markup.inlineKeyboard([
            [
                Markup.button.callback('✅ Да, отменить', 'cancel_subscription_final'),
                Markup.button.callback('❌ Нет, оставить', 'cancel_subscription_abort')
            ]
        ])
    );
    await ctx.answerCbQuery();
};

exports.cancelSubscriptionFinal = async (ctx) => {
    const userId = ctx.from.id;
    const user = await User.findOne({ userId });

    if (!user || user.status !== 'active') {
        await ctx.reply('⚠️ У вас нет активной подписки для отмены.');
        return ctx.answerCbQuery();
    }

    try {
        await User.findOneAndUpdate(
            { userId },
            { 
                status: 'inactive', 
                expireDate: new Date(), 
                vpnConfigured: false 
            }
        );

        await ctx.reply('✅ Ваша подписка успешно отменена. Доступ к VPN прекращен.');

        // Уведомление администратора об отмене
        let userName = user.firstName || user.username || 'Без имени';
        if (user.username) {
            userName = `${userName} (@${user.username})`;
        }
        await ctx.telegram.sendMessage(
            process.env.ADMIN_ID,
            `🚫 Пользователь ${userName} (ID: ${userId}) отменил свою подписку.`
        );

    } catch (error) {
        console.error(`Ошибка при отмене подписки для пользователя ${userId}:`, error);
        await ctx.reply('⚠️ Произошла ошибка при отмене подписки. Пожалуйста, попробуйте позже или свяжитесь с администратором.');
    }
    await ctx.answerCbQuery();
};

exports.cancelSubscriptionAbort = async (ctx) => {
    await ctx.reply('Отмена подписки отклонена. Ваша подписка продолжает действовать.');
    await ctx.answerCbQuery();
};