const User = require('../models/User');
const { Markup } = require('telegraf');
const { checkAdmin } = require('../utils/auth');
const { formatDate, escapeMarkdown } = require('../utils/helpers');
const { createVpnClient } = require('../services/vpnService');
const fs = require('fs');
const path = require('path');

/**
 * Обрабатывает загруженный пользователем скриншот оплаты.
 */
exports.handlePhoto = async (ctx) => {
  const { id, first_name, username } = ctx.from;

  if (id === parseInt(process.env.ADMIN_ID)) {
    return ctx.reply('Вы в режиме админа, скриншоты не требуются.');
  }

  const photo = ctx.message.photo.pop();

  try {
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

    await ctx.telegram.sendPhoto(
      process.env.ADMIN_ID,
      photo.file_id,
      {
        caption: `📸 *Новый платёж от пользователя:*\nИмя: ${userDisplay}\nID: ${id}`,
        parse_mode: 'Markdown',
        ...keyboard
      }
    );

    await ctx.reply('✅ Скриншот получен! Админ проверит его в ближайшее время.');
  } catch (error) {
    console.error('Ошибка при обработке фото:', error);
    await ctx.reply('⚠️ Произошла ошибка при обработке скриншота.');
  }
};

/**
 * Обрабатывает одобрение платежа и отправляет конфиг + видеоинструкцию
 */
exports.handleApprove = async (ctx) => {
  if (!checkAdmin(ctx)) {
    return ctx.answerCbQuery('🚫 Только для админа');
  }

  const userId = parseInt(ctx.match[1]);

  try {
    const user = await User.findOne({ userId });
    let newExpireDate = new Date();

    if (user?.expireDate > new Date()) {
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

    await ctx.answerCbQuery('✅ Платёж принят');
    await ctx.deleteMessage();

    if (updatedUser.subscriptionCount === 1) {
      // Генерация и отправка конфига
      const clientName = user.username 
        ? user.username.replace(/[^a-zA-Z0-9_]/g, '') 
        : `user_${userId}`;
      
      const configContent = await createVpnClient(clientName);
      
      // Отправка конфигурационного файла
      await ctx.telegram.sendDocument(
        userId,
        { source: Buffer.from(configContent), filename: `${clientName}.conf` },
        { caption: '🔐 Ваш конфигурационный файл для VPN' }
      );

      // Отправка видеоинструкции
      const videoPath = path.join(__dirname, '../../src/videos/instruction.mp4');
      
      if (fs.existsSync(videoPath)) {
        await ctx.telegram.sendVideo(
          userId,
          { source: fs.createReadStream(videoPath) },
          {
            caption: '🎥 Видеоинструкция по настройке:',
            parse_mode: 'Markdown'
          }
        );
      } else {
        console.error('Видеоинструкция не найдена:', videoPath);
        await ctx.telegram.sendMessage(
          process.env.ADMIN_ID,
          '⚠️ Файл видеоинструкции не найден!'
        );
      }

      // Кнопки подтверждения настройки
      await ctx.telegram.sendMessage(
        userId,
        'После настройки подтвердите:',
        Markup.inlineKeyboard([
          [
            Markup.button.callback('✅ Всё работает', `vpn_configured_${userId}`),
            Markup.button.callback('❌ Проблемы', `vpn_failed_${userId}`)
          ]
        ])
      );
    } else {
      await ctx.telegram.sendMessage(
        userId,
        `🎉 Подписка продлена до ${formatDate(newExpireDate, true)}!`,
        { parse_mode: 'Markdown' }
      );
    }
  } catch (error) {
    console.error('Ошибка при одобрении платежа:', error);
    await ctx.answerCbQuery('⚠️ Ошибка!');
    await ctx.reply('Ошибка при обработке платежа. Проверьте логи.');
  }
};

/**
 * Обрабатывает отклонение платежа
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
      '❌ Платёж отклонён. Возможные причины:\n' +
      '- Неверная сумма\n- Нет комментария\n- Нечитаемый скриншот\n\n' +
      'Попробуйте отправить чек ещё раз.',
      { parse_mode: 'Markdown' }
    );

    await ctx.answerCbQuery('❌ Платёж отклонён');
    await ctx.deleteMessage();
  } catch (error) {
    console.error('Ошибка при отклонении платежа:', error);
    await ctx.answerCbQuery('⚠️ Ошибка!');
    await ctx.reply('Ошибка при отклонении платежа.');
  }
};