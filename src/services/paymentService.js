const User = require('../models/User');
const { Markup } = require('telegraf');
const { checkAdmin } = require('../utils/auth');
const { formatDate, escapeMarkdown, transliterate } = require('../utils/helpers');
const { createVpnClient, enableVpnClient } = require('../services/vpnService');
const path = require('path');

exports.handlePhoto = async (ctx) => {
  if (!ctx.session.awaitingPaymentProof) {
    const userId = ctx.from.id;
    const user = await User.findOne({ userId });

    if (user && user.status === 'active') {
      return ctx.reply('⚠️ Ваша подписка ещё активна. Если вы хотите её продлить, нажмите кнопку "Продлить подписку" в главном меню (/start).');
    } else {
      return ctx.reply('⚠️ Чтобы отправить скриншот, пожалуйста, сначала нажмите кнопку "Оплатить подписку" в главном меню (/start).');
    }
  }

  const { id, first_name, username } = ctx.from;

  if (id === parseInt(process.env.ADMIN_ID)) {
    return ctx.reply('Вы в режиме администратора, скриншоты не требуются.');
  }

  const user = await User.findOne({ userId: id });

  if (user && user.status === 'pending') {
    ctx.session.awaitingPaymentProof = false;
    return ctx.reply('⏳ Ваш скриншот уже на проверке у администратора. Пожалуйста, подождите.');
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

    await ctx.reply('✅ Скриншот получен! Администратор проверит его в ближайшее время.');
    ctx.session.awaitingPaymentProof = false;
  } catch (error) {
    console.error('Ошибка при обработке фото/платежа:', error);
    await ctx.reply('⚠️ Произошла ошибка при получении вашего скриншота. Пожалуйста, попробуйте позже.');
    ctx.session.awaitingPaymentProof = false;
  }
};

exports.handleApprove = async (ctx) => {
  if (!checkAdmin(ctx)) {
    return ctx.answerCbQuery('🚫 Только для администратора');
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

    let clientName = null;
    if (user && user.subscriptionCount > 0) {
      clientName = user.vpnClientName;
    } else {
      // Формируем базовое имя клиента
      const baseName = user?.username ? transliterate(user.username).replace(/[^a-zA-Z0-9_]/g, '') : `telegram_${userId}`;
      clientName = baseName; // Уникальность будет проверена в createVpnClient
    }

    const updateData = {
      status: 'active',
      expireDate: newExpireDate,
      paymentPhotoId: null,
      paymentPhotoDate: null,
      $inc: { subscriptionCount: 1 }
    };

    let configContent = null;
    if (user && user.subscriptionCount > 0 && user.vpnClientName) {
      // Продление подписки
      await enableVpnClient(user.vpnClientName);
      console.log(`🔓 VPN включён для ${user.vpnClientName} (ID: ${userId})`);
    } else {
      // Первый платёж
      const { config, clientName: uniqueClientName } = await createVpnClient(clientName);
      configContent = config;
      updateData.vpnClientName = uniqueClientName;
      updateData.vpnConfigured = false;
    }

    const updatedUser = await User.findOneAndUpdate(
      { userId },
      updateData,
      { new: true, upsert: true }
    );

    await ctx.answerCbQuery('✅ Платёж принят');
    await ctx.deleteMessage();

    if (updatedUser.subscriptionCount === 1) {
      try {
        await ctx.telegram.sendMessage(
          userId,
          `🎉 *Платёж подтверждён!* 🎉\n\n` +
          `Доступ к VPN активен до *${escapeMarkdown(formatDate(newExpireDate, true))}*\n\n` +
          `📁 Ваш файл конфигурации VPN и видеоинструкция отправлены ниже. \n\n` +
          `Не забудьте скачать приложение AmneziaWG с Google Play https://play.google.com/store/apps/details?id=org.amnezia.awg \n\n` +
          `Не забудьте скачать приложение AmneziaWG с Apple Store https://apps.apple.com/app/id6478942365 \n\n` +
          `Скачайте файл конфигурации и следуйте видеоинструкции ниже для настройки VPN`,
          { parse_mode: 'Markdown' }
        );
        await ctx.telegram.sendDocument(
          userId,
          { source: Buffer.from(configContent), filename: `${updatedUser.vpnClientName}.conf` }
        );
        const videoPath = path.join(__dirname, '..', 'videos', 'instruction.mp4');
        await ctx.telegram.sendVideo(
          userId,
          { source: videoPath },
          { caption: '🎬 Видеоинструкция по настройке VPN' }
        );
        await ctx.telegram.sendMessage(
          userId,
          'Если вы успешно настроили VPN, пожалуйста, нажмите кнопку ниже. Если у вас возникли проблемы:',
          Markup.inlineKeyboard([
            [
              Markup.button.callback('✅ Успешно настроил', `vpn_configured_${userId}`),
              Markup.button.callback('❌ Не справился с настройкой', `vpn_failed_${userId}`)
            ]
          ])
        );
        await ctx.telegram.sendMessage(
          process.env.ADMIN_ID,
          `✅ *VPN-доступ успешно создан для пользователя:*\n\n` +
          `Имя: ${updatedUser.firstName || updatedUser.username || 'Не указано'}\n` +
          `ID: ${userId}\n` +
          `Клиент: ${updatedUser.vpnClientName}\n` +
          `Срок действия: ${formatDate(newExpireDate, true)}`,
          { parse_mode: 'Markdown' }
        );
      } catch (vpnError) {
        console.error(`Ошибка при создании/отправке VPN конфига для ${userId}:`, vpnError);
        await ctx.telegram.sendMessage(
          userId,
          `⚠️ *Произошла ошибка при автоматической генерации файла конфигурации VPN.*` +
          `\nПожалуйста, свяжитесь с администратором.`
        );
        await ctx.telegram.sendMessage(
          process.env.ADMIN_ID,
          `🚨 *Критическая ошибка при создании VPN для пользователя ${userId}:*\n` +
          `\`\`\`\n${vpnError.stack}\n\`\`\``,
          { parse_mode: 'Markdown' }
        );
      }
    } else {
      let message = `🎉 *Платёж подтверждён!* 🎉\n\n` +
        `Ваша подписка успешно продлена до *${formatDate(newExpireDate, true)}*.`;
      await ctx.telegram.sendMessage(
        userId,
        message,
        { parse_mode: 'Markdown' }
      );
    }

  } catch (error) {
    console.error(`Ошибка при одобрении платежа для пользователя ${userId}:`, error);
    await ctx.answerCbQuery('⚠️ Ошибка при одобрении платежа!');
    await ctx.reply('⚠️ Произошла ошибка при одобрении платежа. Проверьте логи.');
  }
};

exports.handleReject = async (ctx) => {
  if (!checkAdmin(ctx)) {
    return ctx.answerCbQuery('🚫 Только для администратора');
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