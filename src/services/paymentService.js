const User = require('../models/User');
const { Markup } = require('telegraf');
const { checkAdmin } = require('../utils/auth');
const { formatDate, escapeMarkdown } = require('../utils/helpers');

/**
 * Обрабатывает загруженный пользователем скриншот оплаты.
 * Теперь требует предварительного нажатия кнопки оплаты.
 */
exports.handlePhoto = async (ctx) => {
  const { id, first_name, username } = ctx.from;

  // Проверка для админа
  if (id === parseInt(process.env.ADMIN_ID)) {
    return ctx.reply('Вы в режиме админа, скриншоты не требуются.');
  }

  // Проверяем, ожидает ли бот скриншота от этого пользователя
  if (!ctx.session?.expectingPaymentPhoto) {
    return ctx.replyWithMarkdown(
      '⚠️ *Порядок оплаты:*\n\n' +
      '1. Нажмите *"💰 Оплатить подписку"*\n' +
      '2. Получите реквизиты\n' +
      '3. Нажмите *"✅ Я оплатил"*\n' +
      '4. Отправьте скриншот\n\n' +
      'Случайные скриншоты не обрабатываются!'
    );
  }

  const photo = ctx.message.photo.pop();

  try {
    const user = await User.findOneAndUpdate(
      { userId: id },
      {
        userId: id,
        username: username || first_name,
        firstName: first_name,
        paymentPhotoId: photo.file_id,
        paymentPhotoDate: new Date(),
        status: 'pending'
      },
      { upsert: true, new: true }
    );

    // Сбрасываем флаг ожидания скриншота
    ctx.session.expectingPaymentPhoto = false;

    // Формируем информацию о пользователе
    let userDisplay = '';
    const safeFirstName = escapeMarkdown(first_name || 'Не указано');

    if (username) {
      userDisplay = `${safeFirstName} (@${escapeMarkdown(username)})`;
    } else {
      userDisplay = `${safeFirstName} (без username)`;
    }

    if (!first_name && !username) {
      userDisplay = `Неизвестный пользователь`;
    }

    // Отправляем админу
    await ctx.telegram.sendPhoto(
      process.env.ADMIN_ID,
      photo.file_id,
      {
        caption: `📸 *Новый платёж от пользователя:*\n` +
          `Имя: ${userDisplay}\n` +
          `ID: ${id}\n` +
          `Статус: ${user.status}\n` +
          `Подписка до: ${user.expireDate ? formatDate(user.expireDate) : 'нет'}`,
        parse_mode: 'Markdown',
        reply_markup: Markup.inlineKeyboard([
          [
            Markup.button.callback('✅ Одобрить', `approve_${id}`),
            Markup.button.callback('❌ Отклонить', `reject_${id}`)
          ]
        ])
      }
    );

    await ctx.reply('✅ Скриншот получен! Админ проверит его в ближайшее время.');
  } catch (error) {
    console.error('Ошибка при обработке фото:', error);
    await ctx.reply('⚠️ Произошла ошибка. Пожалуйста, попробуйте позже.');
  }
};

/**
 * Одобрение платежа с защитой активных подписок
 */
exports.handleApprove = async (ctx) => {
  if (!checkAdmin(ctx)) {
    return ctx.answerCbQuery('🚫 Только для админа');
  }

  const userId = parseInt(ctx.match[1]);

  try {
    const user = await User.findOne({ userId });
    
    // Если пользователь уже имеет активную подписку
    if (user.status === 'active' && user.expireDate > new Date()) {
      await ctx.answerCbQuery('ℹ️ У пользователя уже есть активная подписка');
      return ctx.editMessageText(
        `Пользователь ${user.firstName || 'ID:' + userId} уже имеет активную подписку до ${formatDate(user.expireDate)}.\n` +
        'Новый срок будет добавлен к текущему.',
        Markup.inlineKeyboard([
          [
            Markup.button.callback('➕ Добавить месяц', `force_approve_${userId}`),
            Markup.button.callback('✖️ Отмена', 'cancel_action')
          ]
        ])
      );
    }

    let newExpireDate = new Date();
    
    // Если есть неистекшая подписка - продлеваем от текущей даты окончания
    if (user.expireDate && user.expireDate > newExpireDate) {
      newExpireDate = new Date(user.expireDate);
    }
    
    newExpireDate.setMonth(newExpireDate.getMonth() + 1);
    newExpireDate.setHours(23, 59, 59, 999);

    const updatedUser = await User.findOneAndUpdate(
      { userId },
      {
        status: 'active',
        expireDate: newExpireDate,
        paymentPhotoId: null,
        paymentPhotoDate: null,
        $inc: { subscriptionCount: 1 }
      },
      { new: true }
    );

    let message = `🎉 *Платёж подтверждён!*\n\n` +
      `Доступ к VPN активен до *${formatDate(newExpireDate, true)}*`;

    // Для первой подписки
    if (updatedUser.subscriptionCount === 1) {
      message += `\n\nНажмите кнопку ниже, чтобы получить инструкции:`;
      await ctx.telegram.sendMessage(
        userId,
        message,
        Markup.inlineKeyboard([
          [Markup.button.callback('📁 Получить файл VPN', `get_vpn_config_${userId}`)]
        ])
      );
    } else {
      // Для продления
      await ctx.telegram.sendMessage(userId, message);
    }

    await ctx.answerCbQuery('✅ Подписка активирована');
    await ctx.deleteMessage();

  } catch (error) {
    console.error(`Ошибка одобрения платежа для ${userId}:`, error);
    await ctx.answerCbQuery('⚠️ Ошибка! Смотри логи');
    await ctx.reply('Произошла ошибка при одобрении платежа.');
  }
};

/**
 * Отклонение платежа с защитой активных подписок
 */
exports.handleReject = async (ctx) => {
  if (!checkAdmin(ctx)) {
    return ctx.answerCbQuery('🚫 Только для админа');
  }

  const userId = parseInt(ctx.match[1]);

  try {
    const user = await User.findOne({ userId });

    // Не меняем статус активной подписки
    if (user.status === 'active' && user.expireDate > new Date()) {
      await User.updateOne(
        { userId },
        { paymentPhotoId: null, paymentPhotoDate: null }
      );
      
      await ctx.answerCbQuery('⚠️ Подписка сохранена');
      return ctx.editMessageText(
        `Скриншот отклонён, но подписка пользователя *сохранена* (активна до ${formatDate(user.expireDate)}).`,
        { parse_mode: 'Markdown' }
      );
    }

    // Стандартная обработка отклонения
    await User.updateOne(
      { userId },
      {
        status: 'rejected',
        paymentPhotoId: null,
        paymentPhotoDate: null
      }
    );

    await ctx.telegram.sendMessage(
      userId,
      '❌ *Ваш платёж отклонён*\n\n' +
      'Возможные причины:\n' +
      '- Неверная сумма\n' +
      '- Нет комментария\n' +
      '- Нечитаемый скриншот\n\n' +
      'Для повторной оплаты нажмите *"💰 Оплатить подписку"*',
      { parse_mode: 'Markdown' }
    );

    await ctx.answerCbQuery('❌ Платёж отклонён');
    await ctx.deleteMessage();

  } catch (error) {
    console.error(`Ошибка отклонения платежа для ${userId}:`, error);
    await ctx.answerCbQuery('⚠️ Ошибка!');
    await ctx.reply('Произошла ошибка при отклонении платежа.');
  }
};

/**
 * Принудительное одобрение (если у пользователя уже есть подписка)
 */
exports.handleForceApprove = async (ctx) => {
  if (!checkAdmin(ctx)) return ctx.answerCbQuery('🚫 Только для админа');

  const userId = parseInt(ctx.match[1]);

  try {
    const user = await User.findOne({ userId });
    let newExpireDate = new Date(user.expireDate);
    newExpireDate.setMonth(newExpireDate.getMonth() + 1);

    await User.updateOne(
      { userId },
      {
        paymentPhotoId: null,
        paymentPhotoDate: null,
        expireDate: newExpireDate,
        $inc: { subscriptionCount: 1 }
      }
    );

    await ctx.telegram.sendMessage(
      userId,
      `ℹ️ Ваша подписка продлена до ${formatDate(newExpireDate)}`
    );

    await ctx.answerCbQuery('✅ Месяц добавлен');
    await ctx.deleteMessage();

  } catch (error) {
    console.error(`Ошибка принудительного одобрения для ${userId}:`, error);
    await ctx.answerCbQuery('⚠️ Ошибка!');
  }
};