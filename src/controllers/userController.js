const User = require('../models/User');
const { paymentDetails, formatDate, formatDuration } = require('../utils/helpers');
const { checkAdmin } = require('./adminController');
const { Markup } = require('telegraf');

exports.handleStart = async (ctx) => {
  const { id, first_name } = ctx.from;
  
  // === ЛОГИКА ДЛЯ АДМИНА ===
  // Если пользователь является админом, показываем админ-панель с ReplyKeyboard
  if (id === parseInt(process.env.ADMIN_ID) && checkAdmin(ctx)) {
    return ctx.replyWithMarkdown(
      '👋 *Админ-панель*\n\n' +
      'Команды:\n' +
      '/check - Проверить заявки\n' +
      '/stats - Статистика\n' +
      '/questions - Все вопросы', // Убрал упоминание /switchmode
      {
        reply_markup: { // Используем ReplyKeyboardMarkup
          keyboard: [
            [{ text: '🖥 Мониторинг' }, { text: '⚙️ Управление' }],
            [{ text: '🔒 Безопасность' }, { text: '📸 Скриншот' }],
            [{ text: '❓ Помощь' }]
          ],
          resize_keyboard: true, // Делает клавиатуру компактнее
          one_time_keyboard: false // Клавиатура будет видна всегда
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