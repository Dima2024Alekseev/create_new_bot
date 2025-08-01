const User = require('../models/User');
const { Markup } = require('telegraf');
const { checkAdmin } = require('../utils/auth');
const { formatDate, escapeMarkdown } = require('../utils/helpers');
const { createVpnClient } = require('../services/vpnService');
const fs = require('fs');
const path = require('path');

/**
 * Обрабатывает загруженный пользователем скриншот оплаты.
 * Сохраняет скриншот в БД и отправляет его администратору для проверки.
 * @param {object} ctx - Объект контекста Telegraf.
 */
exports.handlePhoto = async (ctx) => {
  const { id, first_name, username } = ctx.from;
  // Если это админ, и он случайно отправил фото, игнорируем его.
  if (id === parseInt(process.env.ADMIN_ID)) {
    return ctx.reply('Вы в режиме админа, скриншоты не требуются.');
  }
  // Получаем ID последнего (самого большого) фото из массива
  const photo = ctx.message.photo.pop();
  try {
    // Находим или создаем пользователя и обновляем информацию о платеже
    await User.findOneAndUpdate(
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
    // Подготавливаем кнопки для администратора
    const keyboard = Markup.inlineKeyboard([
      Markup.button.callback('✅ Принять', `approve_${id}`),
      Markup.button.callback('❌ Отклонить', `reject_${id}`)
    ]);
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
    await ctx.telegram.sendPhoto(
      process.env.ADMIN_ID,
      photo.file_id,
      {
        caption: `📸 *Новый платёж от пользователя:*\n` +
          `Имя: ${userDisplay}\n` +
          `ID: ${id}`,
        parse_mode: 'Markdown',
        ...keyboard
      }
    );
    await ctx.reply('✅ Скриншот получен! Админ проверит его в ближайшее время.');
  } catch (error) {
    console.error('Ошибка при обработке фото/платежа:', error);
    await ctx.reply('⚠️ Произошла ошибка при получении вашего скриншота. Пожалуйста, попробуйте позже.');
  }
};

/**
 * Обрабатывает одобрение платежа администратором.
 * Активирует подписку пользователя и отправляет уведомление.
 * @param {object} ctx - Объект контекста Telegraf.
 */
exports.handleApprove = async (ctx) => {
  if (!checkAdmin(ctx)) {
    return ctx.answerCbQuery('🚫 Только для админа');
  }

  const userId = parseInt(ctx.match[1]);

  try {
    const user = await User.findOne({ userId });
    let newExpireDate = new Date();
    if (user && user.expireDate && user.expireDate > new Date()) {
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
      { new: true, upsert: true }
    );

    let message = `🎉 *Платёж подтверждён!* 🎉\n\n` +
      `Доступ к VPN активен до *${formatDate(newExpireDate, true)}*\n\n`;

    let keyboard = Markup.inlineKeyboard([]);

    if (updatedUser.subscriptionCount === 1) {
      message += `Нажмите кнопку ниже, чтобы получить файл конфигурации и видеоинструкцию.`;
      keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('📁 Получить файл и инструкцию', `send_vpn_info_${userId}`)]
      ]);

      // Отправка конфигурационного файла
      const configContent = await createVpnClient(`telegram_${userId}`);
      await ctx.telegram.sendDocument(
        userId,
        { source: Buffer.from(configContent), filename: `telegram_${userId}.conf` }
      );

      // Отправка видеоинструкции
      const videoPath = path.join(__dirname, '..', 'videos', 'instruction.mp4');
      if (fs.existsSync(videoPath)) {
        await ctx.telegram.sendVideo(
          userId,
          { source: fs.readFileSync(videoPath) },
          { caption: '🎬 Видеоинструкция по настройке VPN:' }
        );
      } else {
        console.error('Видеоинструкция не найдена по указанному пути:', videoPath);
      }
    } else {
      message += `Ваша подписка успешно продлена.`;
    }

    await ctx.telegram.sendMessage(
      userId,
      message,
      keyboard.reply_markup ? { parse_mode: 'Markdown', ...keyboard } : { parse_mode: 'Markdown' }
    );

    await ctx.answerCbQuery('✅ Платёж принят');
    await ctx.deleteMessage();
  } catch (error) {
    console.error(`Ошибка при одобрении платежа для пользователя ${userId}:`, error);
    await ctx.answerCbQuery('⚠️ Ошибка при одобрении платежа!');
    await ctx.reply('⚠️ Произошла ошибка при одобрении платежа. Проверьте логи.');
  }
};

/**
 * Обрабатывает отклонение платежа администратором.
 * Устанавливает статус пользователя как "rejected" и уведомляет его.
 * @param {object} ctx - Объект контекста Telegraf.
 */
exports.handleReject = async (ctx) => {
  if (!checkAdmin(ctx)) {
    return ctx.answerCbQuery('🚫 Только для админа');
  }
  const userId = parseInt(ctx.match[1]);
  try {
    await User.findOneAndUpdate(
      { userId },
      {
        status: 'rejected',
        paymentPhotoId: null,
        paymentPhotoDate: null
      }
    );
    await ctx.telegram.sendMessage(
      userId,
      '❌ *Платёж отклонён*\n\n' +
      'Возможные причины:\n' +
      '- Неверная сумма\n' +
      '- Нет комментария к платежу\n' +
      '- Нечитаемый скриншот\n\n' +
      '*Попробуйте отправить чек ещё раз.*',
      { parse_mode: 'Markdown' }
    );
    await ctx.answerCbQuery('❌ Платёж отклонён');
    await ctx.deleteMessage();
  } catch (error) {
    console.error(`Ошибка при отклонении платежа для пользователя ${userId}:`, error);
    await ctx.answerCbQuery('⚠️ Ошибка при отклонении платежа!');
    await ctx.reply('⚠️ Произошла ошибка при отклонении платежа. Проверьте логи.');
  }
};
