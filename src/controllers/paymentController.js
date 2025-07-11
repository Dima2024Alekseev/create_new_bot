// controllers/paymentController.js
const User = require('../models/User');
const { createWgClient } = require('../services/wireguardService'); // Импортируем WireGuard сервис
const { checkAdmin } = require('./adminController'); // Убедимся, что импорт есть
const { formatDate } = require('../utils/helpers'); // Убедимся, что импорт есть
const { Markup } = require('telegraf'); // Убедимся, что импорт есть

// === handlePhoto ===
// Эта функция должна быть здесь!
exports.handlePhoto = async (ctx) => {
    try {
        if (!ctx.message.photo || ctx.message.photo.length === 0) {
            return ctx.reply('Пожалуйста, отправьте фотографию чека.');
        }

        const photo = ctx.message.photo.pop(); // Берем фото наилучшего качества
        const fileId = photo.file_id;
        const userId = ctx.from.id;

        // Сохраняем информацию о фото в базе данных пользователя
        await User.findOneAndUpdate(
            { userId },
            {
                paymentPhotoId: fileId,
                status: 'pending', // Статус "ожидает проверки"
                lastPaymentAttemptAt: new Date()
            },
            { upsert: true, new: true } // Создать, если нет, и вернуть обновленный документ
        );

        // Уведомляем администратора о новой заявке
        const user = await User.findOne({ userId }); // Перезагружаем пользователя, чтобы получить актуальные данные

        await ctx.telegram.sendMessage(
            process.env.ADMIN_ID,
            `💰 *Новая заявка на оплату от:* ${user.firstName || user.username || 'Пользователь без имени'} (ID: ${userId})\n` +
            `Отправлен скриншот для проверки.`,
            {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [
                            Markup.button.callback('✅ Подтвердить', `approve_${userId}`),
                            Markup.button.callback('❌ Отклонить', `reject_${userId}`)
                        ]
                    ]
                }
            }
        );

        await ctx.reply('✅ Ваш скриншот отправлен на проверку администратору. Ожидайте подтверждения.');

    } catch (error) {
        console.error(`Ошибка при обработке фото от пользователя ${ctx.from.id}:`, error);
        await ctx.reply('Произошла ошибка при обработке вашего чека. Пожалуйста, попробуйте еще раз или свяжитесь с поддержкой.');
    }
};

// === handleApprove ===
exports.handleApprove = async (ctx) => {
  if (!checkAdmin(ctx)) {
    return ctx.answerCbQuery('🚫 У вас нет доступа к этой команде.');
  }

  const userId = parseInt(ctx.match[1]);
  const user = await User.findOne({ userId });

  if (!user) {
    return ctx.answerCbQuery('Пользователь не найден.');
  }

  if (user.status === 'active') {
    return ctx.answerCbQuery('Подписка пользователя уже активна.');
  }

  try {
    let clientData;
    // 1. Создание WireGuard клиента
    try {
      clientData = await createWgClient(user.userId, user.firstName || user.username);
      // Сохраняем ID и имя клиента WireGuard в MongoDB
      user.wireguardPeerId = clientData.peerId;
      user.wireguardClientName = clientData.clientName;
    } catch (wgError) {
      console.error(`[Approve] Ошибка создания WG клиента для ${userId}:`, wgError.message);
      await ctx.telegram.sendMessage(
        process.env.ADMIN_ID,
        `⚠️ Ошибка: Не удалось создать WireGuard клиента для пользователя ${user.firstName || user.username} (ID: ${userId}). ` +
        `Причина: ${wgError.message}. Подписка не активирована.`,
        { reply_to_message_id: ctx.callbackQuery.message.message_id }
      );
      return ctx.answerCbQuery('Ошибка при создании WireGuard клиента.');
    }

    // 2. Активация подписки в вашей БД
    const newExpireDate = user.expireDate && user.expireDate > new Date()
      ? new Date(user.expireDate.getTime() + 30 * 24 * 60 * 60 * 1000) // Добавляем 30 дней к текущей дате истечения
      : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // Или 30 дней от сейчас

    const update = {
      status: 'active',
      expireDate: newExpireDate,
      paymentPhotoId: null, // Очищаем ID фото после обработки
      paymentConfirmedAt: new Date(),
      $inc: { subscriptionCount: 1 }, // Увеличиваем счетчик подписок
      wireguardPeerId: clientData.peerId, // Сохраняем ID пира WireGuard
      wireguardClientName: clientData.clientName // Сохраняем имя клиента WireGuard
    };

    const updatedUser = await User.findOneAndUpdate(
      { userId },
      update,
      { new: true }
    );

    // 3. Отправка конфиг-файла пользователю
    const configBuffer = Buffer.from(clientData.configFileContent, 'utf-8');
    await ctx.telegram.sendDocument(userId, { source: configBuffer, filename: `${clientData.clientName}.conf` }, {
        caption: '📁 Ваш файл конфигурации VPN WireGuard:'
    });

    // 4. Запрос на отправку видеоинструкции (как у вас уже реализовано)
    // Теперь администратор будет только отправлять видеоинструкцию.
    ctx.session.awaitingVpnVideoFor = userId; // Устанавливаем сессию для ожидания видео
    await ctx.telegram.sendMessage(
      process.env.ADMIN_ID,
      `✅ Подписка пользователя ${user.firstName || user.username} (ID: ${userId}) активирована до ${formatDate(updatedUser.expireDate, true)}. ` +
      `Файл конфигурации автоматически создан и отправлен пользователю (${clientData.clientName}). ` +
      `*Теперь загрузите видеоинструкцию для этого пользователя:*`,
      { parse_mode: 'Markdown', reply_to_message_id: ctx.callbackQuery.message.message_id }
    );
    await ctx.telegram.sendMessage(userId, '🎉 Ваша подписка активирована! Файл конфигурации отправлен. Ожидайте видеоинструкцию.');

    await ctx.answerCbQuery('Подписка успешно активирована и файл отправлен.');

  } catch (error) {
    console.error(`Ошибка при подтверждении оплаты для ${userId}:`, error);
    await ctx.reply(`⚠️ Произошла критическая ошибка при подтверждении оплаты для ${user.firstName || user.username}. Сообщите администратору.`);
    await ctx.answerCbQuery('Произошла ошибка.');
  }
};

// === handleReject ===
// Эта функция также должна быть здесь!
exports.handleReject = async (ctx) => {
    if (!checkAdmin(ctx)) {
        return ctx.answerCbQuery('🚫 У вас нет доступа к этой команде.');
    }

    const userId = parseInt(ctx.match[1]);
    const user = await User.findOne({ userId });

    if (!user) {
        return ctx.answerCbQuery('Пользователь не найден.');
    }

    // Обновляем статус пользователя на "rejected" и очищаем photoId
    await User.findOneAndUpdate(
        { userId },
        { status: 'rejected', paymentPhotoId: null },
        { new: true }
    );

    // Уведомляем пользователя
    await ctx.telegram.sendMessage(
        userId,
        '❌ Ваша заявка на оплату отклонена. Пожалуйста, убедитесь, что вы отправили корректный скриншот оплаты и попробуйте снова.'
    );

    // Уведомляем админа
    await ctx.telegram.sendMessage(
        process.env.ADMIN_ID,
        `Отклонена заявка от пользователя ${user.firstName || user.username} (ID: ${userId}).`,
        { reply_to_message_id: ctx.callbackQuery.message.message_id }
    );

    await ctx.answerCbQuery('Заявка отклонена.');
};