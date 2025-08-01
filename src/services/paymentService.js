const User = require('../models/User');
const { Markup } = require('telegraf');
const { formatDate, escapeMarkdown, transliterate } = require('../utils/helpers');
const { createVpnClient } = require('./vpnService');
const path = require('path');

/**
 * Обрабатывает новый скриншот оплаты, сохраняет его и отправляет админу на проверку.
 */
exports.processNewPaymentPhoto = async (ctx, id, first_name, username, photo) => {
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
    // НОВОЕ: Более надёжное формирование строки с именем пользователя для отображения
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
};

/**
 * Одобряет платёж, продлевает подписку, создает VPN-клиента при необходимости.
 * @param {object} ctx - Объект контекста Telegraf.
 * @param {number} userId - ID пользователя.
 */
exports.approvePayment = async (ctx, userId) => {
    const user = await User.findOne({ userId });
    
    if (!user) {
        throw new Error('Пользователь не найден');
    }

    let newExpireDate;
    const now = new Date();

    // Исправленная логика продления
    // Если подписка активна и не истекла, продлеваем её от существующей даты
    if (user.status === 'active' && user.expireDate && user.expireDate > now) {
        newExpireDate = new Date(user.expireDate);
        newExpireDate.setMonth(newExpireDate.getMonth() + 1);
    } else {
        // Иначе, начинаем новую подписку с сегодняшнего дня
        newExpireDate = now;
        newExpireDate.setMonth(newExpireDate.getMonth() + 1);
    }
    
    // Устанавливаем время на конец дня для всех новых подписок
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

    await ctx.answerCbQuery('✅ Платёж принят');
    await ctx.deleteMessage();

    // Логика для первого платежа
    if (updatedUser.subscriptionCount === 1) {
        try {
            const clientName = (updatedUser.username ? transliterate(updatedUser.username).replace(/[^a-zA-Z0-9_]/g, '') : `telegram_${userId}`) || `telegram_${userId}`;
            const configContent = await createVpnClient(clientName);
            
            await ctx.telegram.sendMessage(
                userId,
                `🎉 *Платёж подтверждён!* 🎉\n\n` +
                `Доступ к VPN активен до *${formatDate(newExpireDate, true)}*\n\n` +
                `📁 Ваш файл конфигурации VPN:`,
                { parse_mode: 'Markdown' }
            );

            await ctx.telegram.sendDocument(
                userId,
                { source: Buffer.from(configContent), filename: `${clientName}.conf` }
            );

            const videoPath = path.join(__dirname, '../videos/instruction.mp4');
            await ctx.telegram.sendVideo(
                userId,
                { source: videoPath },
                { caption: '🎬 *Видеоинструкция* по настройке VPN:' }
            );

            let userName = updatedUser.firstName || updatedUser.username || 'Без имени';
            if (updatedUser.username) {
                userName = `${userName} (@${updatedUser.username})`;
            }

            await ctx.telegram.sendMessage(
                process.env.ADMIN_ID,
                `🎉 *Автоматическая отправка завершена!* 🎉\n\n` +
                `Пользователю ${userName} (ID: ${userId}) отправлен файл конфигурации и видеоинструкция.`
            );

            await ctx.telegram.sendMessage(
                userId,
                'После просмотра видео, пожалуйста, сообщите, удалось ли вам настроить VPN:',
                Markup.inlineKeyboard([
                    [
                        Markup.button.callback('✅ Успешно настроил', `vpn_configured_${userId}`),
                        Markup.button.callback('❌ Не справился с настройкой', `vpn_failed_${userId}`)
                    ]
                ])
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
                `⚠️ Произошла ошибка при создании VPN конфига для пользователя ${userId}. ` +
                `Сообщи ему, что файл будет отправлен вручную.`
            );
        }
    } else {
        // Если это продление, просто уведомляем пользователя
        const message = `🎉 *Платёж подтверждён!* 🎉\n\n` +
            `Ваша подписка успешно продлена до *${formatDate(newExpireDate, true)}*.`;
        await ctx.telegram.sendMessage(userId, message, { parse_mode: 'Markdown' });
    }
};

/**
 * Отклоняет платёж и уведомляет пользователя.
 * @param {object} ctx - Объект контекста Telegraf.
 * @param {number} userId - ID пользователя.
 */
exports.rejectPayment = async (ctx, userId) => {
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
};