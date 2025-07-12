// controllers/paymentController.js
const User = require('../models/User');
const { Markup } = require('telegraf');
const { checkAdmin } = require('./adminController');
const { formatDate } = require('../utils/helpers');
// Если у вас есть wireguardService, убедитесь, что он импортирован,
// даже если вы временно отключили его в handleApprove, он все еще нужен для создания клиента.
// const { createWgClient } = require('../services/wireguardService'); 

exports.handlePhoto = async (ctx) => {
    const { id, first_name, username } = ctx.from;

    if (id === parseInt(process.env.ADMIN_ID) && checkAdmin(ctx)) {
        // Убедитесь, что checkAdmin(ctx) не возвращает true для админа в данном контексте,
        // или пересмотрите эту проверку, если админ должен иметь возможность отправлять фото.
        // Скорее всего, это сообщение для админа, если он введет /start, а потом отправит фото.
        return ctx.reply('Вы в режиме админа, скриншоты не требуются.');
    }
    if (!ctx.message.photo || ctx.message.photo.length === 0) {
        return ctx.reply('Пожалуйста, отправьте фотографию чека.');
    }

    const photo = ctx.message.photo.pop(); // Берем фото наилучшего качества

    await User.findOneAndUpdate(
        { userId: id },
        {
            userId: id,
            username: username || first_name,
            firstName: first_name,
            paymentPhotoId: photo.file_id,
            status: 'pending'
        },
        { upsert: true, new: true }
    );
    const keyboard = Markup.inlineKeyboard([
        Markup.button.callback('✅ Принять', `approve_${id}`),
        Markup.button.callback('❌ Отклонить', `reject_${id}`)
    ]);
    await ctx.telegram.sendPhoto(
        process.env.ADMIN_ID,
        photo.file_id,
        {
            caption: `📸 Новый платёж от ${first_name} (@${username || 'нет'})\nID: ${id}`,
            ...keyboard
        }
    );
    await ctx.reply('✅ Скриншот получен! Админ проверит его в ближайшее время.');
};

exports.handleApprove = async (ctx) => {
    if (!checkAdmin(ctx)) {
        return ctx.answerCbQuery('🚫 Только для админа');
    }
    const userId = parseInt(ctx.match[1]);
    const user = await User.findOne({ userId });

    if (!user) {
        return ctx.answerCbQuery('Пользователь не найден.');
    }

    // Если статус уже активен, можно выйти или дать другое сообщение
    // if (user.status === 'active') {
    //     return ctx.answerCbQuery('Подписка пользователя уже активна.');
    // }

    let newExpireDate = new Date();

    if (user && user.expireDate && user.expireDate > new Date()) {
        newExpireDate = new Date(user.expireDate);
    }

    newExpireDate.setMonth(newExpireDate.getMonth() + 1);
    newExpireDate.setHours(23, 59, 59, 999);

    let clientData = null; // Инициализируем clientData

    try {
        // !!! ВАЖНО: Если вы хотите создавать WG клиента при одобрении,
        // раскомментируйте и используйте функцию createWgClient здесь.
        // Убедитесь, что 'wireguardService' импортирован.
        // Пример:
        /*
        try {
            clientData = await createWgClient(user.userId, user.firstName || user.username);
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
        */

        // Увеличиваем счетчик подписок
        const updatedUser = await User.findOneAndUpdate(
            { userId },
            {
                status: 'active',
                expireDate: newExpireDate,
                paymentPhotoId: null,
                $inc: { subscriptionCount: 1 }, // Увеличиваем subscriptionCount на 1
                // wireguardPeerId: clientData?.peerId, // Раскомментируйте, если используете WG
                // wireguardClientName: clientData?.clientName // Раскомментируйте, если используете WG
            },
            { new: true, upsert: true }
        );

        let messageToUser = `🎉 Ваш платёж подтверждён! Подписка активна до ${formatDate(newExpireDate, true)}.\n\n`;
        let userKeyboard = Markup.inlineKeyboard([]);

        // Отправка файла и видеоинструкции переносится в `requestVpnInfo`
        // или инициируется админом через `send_instruction_to_`
        // ВАЖНО: Если вы *хотите*, чтобы файл отправлялся СРАЗУ при одобрении,
        // то нужно раскомментировать код отправки файла и видео здесь,
        // и убрать кнопку "Получить файл и инструкцию" из стартового сообщения.

        // Здесь отправляем админу сообщение, что подписка активирована.
        await ctx.telegram.sendMessage(
            process.env.ADMIN_ID,
            `✅ Подписка пользователя ${user.firstName || user.username} (ID: ${userId}) активирована до ${formatDate(updatedUser.expireDate, true)}.`,
            { reply_to_message_id: ctx.callbackQuery.message.message_id }
        );

        // Пользователю отправляем сообщение с кнопками подтверждения настройки,
        // ЕСЛИ это первая подписка или если логика подразумевает, что файл должен быть отправлен
        // и пользователь должен его подтвердить.
        if (updatedUser.subscriptionCount === 1) { // Или если вы всегда отправляете инструкцию и ждете подтверждения
             messageToUser += 'Как только вы настроите VPN, пожалуйста, нажмите одну из кнопок ниже:';
             userKeyboard = Markup.inlineKeyboard([
                [Markup.button.callback('✅ Успешно настроил', `vpn_configured_${userId}`)],
                [Markup.button.callback('❌ Не получилось настроить', `vpn_failed_${userId}`)]
             ]);
        } else {
             messageToUser += 'Ваша подписка успешно продлена.';
             // Здесь можно добавить другие кнопки, если нужно для продления
        }

        await ctx.telegram.sendMessage(
            userId,
            messageToUser,
            userKeyboard.reply_markup ? userKeyboard : {} // Отправляем клавиатуру только если она не пустая
        );

        await ctx.answerCbQuery('✅ Платёж принят');
        await ctx.deleteMessage(); // Удаляем сообщение с чеком
    } catch (error) {
        console.error(`Ошибка при подтверждении оплаты для ${userId}:`, error);
        await ctx.reply(`⚠️ Произошла критическая ошибка при подтверждении оплаты для ${user.firstName || user.username}. Сообщите администратору.`);
        await ctx.answerCbQuery('Произошла ошибка.');
    }
};

exports.handleReject = async (ctx) => {
    if (!checkAdmin(ctx)) {
        return ctx.answerCbQuery('🚫 Только для админа');
    }
    const userId = parseInt(ctx.match[1]);
    const user = await User.findOne({ userId }); // Находим пользователя для имени

    await User.findOneAndUpdate(
        { userId },
        { status: 'rejected', paymentPhotoId: null } // Очищаем photoId при отклонении
    );

    // Уведомляем пользователя
    await ctx.telegram.sendMessage(
        userId,
        '❌ Платёж отклонён\n\n' +
        'Возможные причины:\n' +
        '- Неверная сумма\n' +
        '- Нет комментария\n' +
        '- Нечитаемый скриншот\n\n' +
        'Попробуйте отправить чек ещё раз.'
    );
    // Уведомляем администратора о том, что он отклонил
    await ctx.telegram.sendMessage(
        process.env.ADMIN_ID,
        `❌ Отклонена заявка от пользователя ${user?.firstName || user?.username || 'Без имени'} (ID: ${userId}).`,
        { reply_to_message_id: ctx.callbackQuery.message.message_id } // Отвечаем на сообщение с чеком
    );

    await ctx.answerCbQuery('❌ Платёж отклонён');
    await ctx.deleteMessage(); // Удаляем сообщение с чеком
};