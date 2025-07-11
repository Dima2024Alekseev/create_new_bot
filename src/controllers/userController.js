const User = require('../models/User');
const { paymentDetails, formatDate, formatDuration } = require('../utils/helpers');
const { checkAdmin } = require('./adminController');
const { Markup } = require('telegraf');

exports.handleStart = async (ctx) => {
  const { id, first_name } = ctx.from;
  
  // Проверяем режим админа
  if (id === parseInt(process.env.ADMIN_ID) && checkAdmin(ctx)) {
    return ctx.replyWithMarkdown(
      '👋 *Админ-панель*\n\n' +
      'Команды:\n' +
      '/check - Проверить заявки\n' +
      '/stats - Статистика\n' +
      '/questions - Все вопросы\n' +
      '/switchmode - Переключиться в режим пользователя',
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: 'Проверить заявки', callback_data: 'check_payments_admin' }],
            [{ text: 'Статистика', callback_data: 'show_stats_admin' }],
            [{ text: 'Все вопросы', callback_data: 'list_questions' }],
            [{ text: 'Сменить режим', callback_data: 'switch_mode' }]
          ]
        }
      }
    );
  }

  // Логика для обычных пользователей
  const user = await User.findOne({ userId: id });

  let message = '';
  let keyboardButtons = [];

  // Флаг, указывающий, есть ли у пользователя активная или ожидающая подписка
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
  } else {
    // Если подписки нет, просрочена или в другом статусе
    message = `🔐 *VPN подписка: ${process.env.VPN_PRICE || 132} руб/мес*\n\n` +
              `${paymentDetails(id, first_name)}\n\n` +
              '_После оплаты отправьте скриншот чека_';
  }
  
  // Добавляем кнопку "Посмотреть срок действия подписки" только если есть активная/ожидающая подписка
  if (hasActiveOrPendingSubscription) {
    keyboardButtons.push(
      [{ text: '🗓 Посмотреть срок действия подписки', callback_data: 'check_subscription' }]
    );
  }

  // Кнопка "Задать вопрос" всегда доступна
  keyboardButtons.push(
    [{ text: '❓ Задать вопрос', callback_data: 'ask_question' }]
  );

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

// Новая функция для обработки запроса на проверку срока действия
exports.checkSubscriptionStatus = async (ctx) => {
  const { id, first_name } = ctx.from;
  const user = await User.findOne({ userId: id });

  // Дополнительная проверка на всякий случай, если пользователь вызвал callback без кнопки
  if (!user || (user.status !== 'active' && user.status !== 'pending')) {
    await ctx.replyWithMarkdown(
      `Вы пока не активировали подписку. VPN подписка: *${process.env.VPN_PRICE || 132} руб/мес*\n\n` +
      `${paymentDetails(id, first_name)}\n\n` +
      '_После оплаты отправьте скриншот чека_',
      { disable_web_page_preview: true }
    );
    return ctx.answerCbQuery(); // Закрываем всплывающее уведомление и завершаем
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
    // Этот блок по идее не должен быть достигнут, т.к. мы уже проверяем выше
    // Но оставим его как запасной вариант для полной обработки всех статусов
    await ctx.replyWithMarkdown(
      `Вы пока не активировали подписку. VPN подписка: *${process.env.VPN_PRICE || 132} руб/мес*\n\n` +
      `${paymentDetails(id, first_name)}\n\n` +
      '_После оплаты отправьте скриншот чека_',
      { disable_web_page_preview: true }
    );
  }
  await ctx.answerCbQuery(); // Закрываем всплывающее уведомление
};

// Функция для обработки нажатия кнопки "Продлить подписку" (можно направить на /start)
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

// Функция для обработки нажатия кнопки "Задать вопрос"
exports.promptForQuestion = async (ctx) => {
  await ctx.reply('✍️ Напишите ваш вопрос в следующем сообщении. Я передам его администратору.');
  await ctx.answerCbQuery();
};