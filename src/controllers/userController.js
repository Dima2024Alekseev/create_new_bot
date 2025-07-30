const User = require('../models/User');
const { paymentDetails, formatDate, formatDuration } = require('../utils/helpers');
const { Markup } = require('telegraf');
const { checkAdmin } = require('../utils/auth');

/**
 * Отображает главное меню для пользователя или админа.
 * Изменено: добавлена кнопка "Моя подписка" для пользователя.
 * @param {object} ctx - Объект контекста Telegraf.
 */
exports.handleStart = async (ctx) => {
  const { id, first_name, username } = ctx.from;

  // === ЛОГИКА ДЛЯ АДМИНА ===
  if (id === parseInt(process.env.ADMIN_ID) && checkAdmin(ctx)) {
    return ctx.replyWithMarkdown(
      '👋 *Админ-панель*\n\n',
      {
        reply_markup: {
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
  // Приветствие и предложение перейти в "Моя подписка"
  const safeFirstName = first_name ? first_name : 'пользователь'; // Используем безопасное имя
  const message = `Привет, ${safeFirstName}! 👋\n\n` +
    `Здесь ты можешь управлять своей VPN подпиской и получать поддержку.`;

  const keyboardButtons = [
    [{ text: '👤 Моя подписка', callback_data: 'my_subscription' }], // НОВАЯ КНОПКА
    [{ text: '❓ Задать вопрос', callback_data: 'ask_question' }]
  ];

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

/**
 * Отображает детали подписки пользователя (Личный кабинет).
 * @param {object} ctx - Объект контекста Telegraf.
 */
exports.showMySubscription = async (ctx) => {
  const { id, first_name, username } = ctx.from;
  const user = await User.findOne({ userId: id });

  let message = '';
  let keyboardButtons = [];

  if (!user || user.status === 'inactive' || user.status === 'rejected') {
    // Пользователь неактивен, его заявка отклонена или он новый
    message = `🔐 *VPN подписка: ${process.env.VPN_PRICE || 132} руб/мес*\n\n` +
      `У вас пока нет активной подписки или она истекла/была отклонена.\n\n` +
      `${paymentDetails(id, first_name || username)}\n\n` + // Используем first_name или username для paymentDetails
      '_После оплаты отправьте скриншот чека в этот чат._';

    keyboardButtons.push(
      [{ text: '❓ Задать вопрос', callback_data: 'ask_question' }]
    );

  } else if (user.status === 'pending') {
    // Заявка на проверке
    message = `⏳ Ваша заявка на оплату находится на проверке. Ожидайте подтверждения.`;
    keyboardButtons.push(
      [{ text: '❓ Задать вопрос', callback_data: 'ask_question' }]
    );

  } else if (user.status === 'active' && user.expireDate) {
    // Активная подписка
    const timeLeft = user.expireDate.getTime() - new Date().getTime();

    message = `✅ *Ваша подписка активна до ${formatDate(user.expireDate, true)}*`;
    if (timeLeft > 0) {
      message += `\nОсталось: ${formatDuration(timeLeft)}.`;
    } else {
      // Эта ветка сработает только если cron ещё не успел поменять статус,
      // но пользователь все равно увидит, что срок истек.
      message += `\nСрок действия истёк.`;
    }

    // Кнопки для активного пользователя
    keyboardButtons.push(
      [{ text: '🗓 Продлить подписку', callback_data: 'extend_subscription' }]
    );

    // Показываем кнопку "Получить файл и инструкцию" только если это первая подписка ИЛИ если он еще не подтвердил настройку
    // Добавлено условие: если vpnConfigured не существует или false.
    if ((!user.subscriptionCount || user.subscriptionCount === 1) || !user.vpnConfigured) {
      keyboardButtons.push([{ text: '📁 Получить файл и инструкцию', callback_data: `send_vpn_info_${id}` }]);
    }

    keyboardButtons.push(
      [{ text: '🚫 Отменить подписку', callback_data: 'cancel_subscription_confirm' }],
      [{ text: '❓ Задать вопрос', callback_data: 'ask_question' }]
    );
  } else {
    // Неизвестный статус или ошибка
    message = '⚠️ Произошла ошибка при получении информации о вашей подписке. Пожалуйста, попробуйте позже или свяжитесь с поддержкой.';
    keyboardButtons.push(
      [{ text: '❓ Задать вопрос', callback_data: 'ask_question' }]
    );
  }

  await ctx.replyWithMarkdown(message, {
    disable_web_page_preview: true,
    reply_markup: {
      inline_keyboard: keyboardButtons
    }
  });

  if (ctx.callbackQuery) {
    await ctx.answerCbQuery(); // Закрываем spinning wheel на кнопке
  }
};

/**
 * Обрабатывает запрос пользователя на продление подписки.
 * Отправляет ему реквизиты для оплаты.
 * @param {object} ctx - Объект контекста Telegraf.
 */
exports.extendSubscription = async (ctx) => {
  const { id, first_name, username } = ctx.from;
  await ctx.replyWithMarkdown(
    `Для продления VPN за ${process.env.VPN_PRICE} руб. воспользуйтесь реквизитами:\n\n` +
    paymentDetails(id, first_name || username) +
    '\n\n_После оплаты отправьте скриншот чека в этот чат._',
    { disable_web_page_preview: true }
  );
  await ctx.answerCbQuery();
};

/**
 * Предлагает пользователю ввести свой вопрос.
 * @param {object} ctx - Объект контекста Telegraf.
 */
exports.promptForQuestion = async (ctx) => {
  // Пользователь нажимает "Задать вопрос", мы не устанавливаем awaitingAnswerFor здесь
  // Это происходит в middleware, когда админ отвечает.
  await ctx.reply('✍️ Напишите ваш вопрос, и я перешлю его администратору.');
  if (ctx.callbackQuery) {
    await ctx.answerCbQuery();
  }
};

/**
 * Запрашивает у администратора файл конфигурации и видеоинструкцию для пользователя.
 * @param {object} ctx - Объект контекста Telegraf.
 */
exports.requestVpnInfo = async (ctx) => {
  const userId = parseInt(ctx.match[1]); // ID пользователя из callback_data
  const user = await User.findOne({ userId });

  if (!user) {
    await ctx.reply('⚠️ Пользователь не найден.');
    return ctx.answerCbQuery();
  }

  // Проверяем, что запрос делает сам пользователь, а не кто-то другой
  if (ctx.from.id !== userId) {
    return ctx.answerCbQuery('🚫 Вы не можете запросить информацию для другого пользователя.');
  }

  // Устанавливаем статус ожидания для админа (для отправки файла)
  ctx.session.awaitingVpnFileFor = userId;
  ctx.session.awaitingVpnVideoFor = null; // Сбрасываем, чтобы начать с файла

  // Уведомляем админа о запросе
  await ctx.telegram.sendMessage(
    process.env.ADMIN_ID,
    `🔔 Пользователь ${user.firstName || user.username} (ID: ${userId}) запросил файл конфигурации VPN и инструкцию. ` +
    `Нажмите кнопку, чтобы отправить.`,
    Markup.inlineKeyboard([
      [Markup.button.callback('➡️ Отправить файл и видео', `send_instruction_to_${userId}`)]
    ])
  );

  await ctx.reply('✅ Ваш запрос на получение файла конфигурации и видеоинструкции отправлен администратору. Ожидайте.');
  await ctx.answerCbQuery();
};

/**
 * Обрабатывает подтверждение пользователем успешной настройки VPN.
 * @param {object} ctx - Объект контекста Telegraf.
 */
exports.handleVpnConfigured = async (ctx) => {
  const userId = parseInt(ctx.match[1]);

  if (ctx.from.id !== userId) {
    return ctx.answerCbQuery('🚫 Вы не можете подтвердить настройку для другого пользователя.');
  }

  try {
    await User.findOneAndUpdate(
      { userId },
      { vpnConfigured: true }, // Устанавливаем флаг, что VPN настроен
      { new: true }
    );
    await ctx.reply('🎉 Отлично! Рады, что VPN успешно настроен. Приятного пользования!');
    await ctx.deleteMessage(); // Удаляем сообщение с кнопками "Успешно настроил"/"Не справился"
    await ctx.answerCbQuery('Настройка подтверждена.');
  } catch (error) {
    console.error(`Ошибка при подтверждении настройки VPN для пользователя ${userId}:`, error);
    await ctx.reply('⚠️ Произошла ошибка при сохранении вашего подтверждения. Попробуйте позже.');
    await ctx.answerCbQuery('Ошибка.');
  }
};

/**
 * Предлагает пользователю описать проблему с настройкой VPN.
 * @param {object} ctx - Объект контекста Telegraf.
 */
exports.promptVpnFailure = async (ctx) => {
  const userId = parseInt(ctx.match[1]);

  if (ctx.from.id !== userId) {
    return ctx.answerCbQuery('🚫 Вы не можете сообщить о проблеме для другого пользователя.');
  }

  await ctx.reply('✍️ Пожалуйста, подробно опишите вашу проблему с настройкой VPN. Администратор ответит вам.');
  ctx.session.awaitingVpnTroubleshoot = userId; // Устанавливаем ожидание ответа от пользователя
  await ctx.deleteMessage(); // Удаляем сообщение с кнопками "Успешно настроил"/"Не справился"
  await ctx.answerCbQuery('Ожидаем описание проблемы.');
};

/**
 * Запрашивает подтверждение отмены подписки у пользователя.
 * @param {object} ctx - Объект контекста Telegraf.
 */
exports.promptCancelSubscription = async (ctx) => {
  const userId = ctx.from.id;
  await ctx.reply(
    'Вы уверены, что хотите отменить подписку?\n\n' +
    'Ваш VPN доступ будет отключен по истечении текущего оплаченного периода.',
    Markup.inlineKeyboard([
      Markup.button.callback('✅ Да, отменить', 'cancel_subscription_final'),
      Markup.button.callback('❌ Нет, оставить', 'cancel_subscription_abort')
    ])
  );
  await ctx.answerCbQuery();
};

/**
 * Окончательно отменяет подписку пользователя.
 * @param {object} ctx - Объект контекста Telegraf.
 */
exports.cancelSubscriptionFinal = async (ctx) => {
  const userId = ctx.from.id;
  try {
    const user = await User.findOneAndUpdate(
      { userId },
      { status: 'inactive', expireDate: new Date() }, // Немедленная деактивация
      { new: true }
    );
    if (user) {
      await ctx.reply('✅ Ваша подписка успешно отменена. VPN доступ будет отключен.');
      // Здесь можно добавить логику для немедленного отзыва доступа на VPN-сервере
      // Например: await vpnService.revokeAccess(userId);
      console.log(`Подписка пользователя ${userId} отменена.`);
    } else {
      await ctx.reply('⚠️ Произошла ошибка при отмене подписки. Пользователь не найден.');
    }
    await ctx.deleteMessage(); // Удаляем сообщение с подтверждением отмены
    await ctx.answerCbQuery('Подписка отменена.');
  } catch (error) {
    console.error(`Ошибка при отмене подписки для пользователя ${userId}:`, error);
    await ctx.reply('⚠️ Произошла ошибка при отмене подписки. Пожалуйста, попробуйте позже.');
    await ctx.answerCbQuery('Ошибка при отмене.');
  }
};

/**
 * Отменяет процесс отмены подписки.
 * @param {object} ctx - Объект контекста Telegraf.
 */
exports.cancelSubscriptionAbort = async (ctx) => {
  await ctx.reply('Операция отмены подписки отменена.');
  await ctx.deleteMessage(); // Удаляем сообщение с подтверждением отмены
  await ctx.answerCbQuery('Отмена отмены подписки.');
};

// Неэкспортированные вспомогательные функции (если есть, оставьте их здесь)
// function someHelperFunction() { ... }