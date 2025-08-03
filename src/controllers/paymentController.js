const User = require('../models/User');
const { Markup } = require('telegraf');
const { checkAdmin } = require('../utils/auth');
const { formatDate, escapeMarkdown, transliterate } = require('../utils/helpers');
const { createVpnClient, enableVpnClient } = require('../services/vpnService');
const path = require('path');

/**
 * Обрабатывает загруженный пользователем скриншот оплаты.
 * Сохраняет скриншот в БД и отправляет его администратору для проверки.
 * @param {object} ctx - Объект контекста Telegraf.
 */
exports.handlePhoto = async (ctx) => {
    // ⚠️ НОВОЕ: Проверка, находится ли пользователь в состоянии ожидания скриншота
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
        return ctx.reply('Вы в режиме админа, скриншоты не требуются.');
    }

    const user = await User.findOne({ userId: id });

    if (user && user.status === 'pending') {
        // ⚠️ Сбросим флаг, чтобы пользователь не мог отправить ещё один скриншот
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
            [
                Markup.button.callback('✅ Принять', `approve_${id}`),
                Markup.button.callback('❌ Отклонить', `reject_${id}`)
            ],
            [
                Markup.button.callback('⏰ Рассмотреть позже', `review_later_${id}`)
            ]
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
        // ⚠️ НОВОЕ: Сброс флага после успешной отправки скриншота
        ctx.session.awaitingPaymentProof = false;
    } catch (error) {
        console.error('Ошибка при обработке фото/платежа:', error);
        await ctx.reply('⚠️ Произошла ошибка при получении вашего скриншота. Пожалуйста, попробуйте позже.');
        // ⚠️ НОВОЕ: Сброс флага при ошибке, чтобы избежать застревания пользователя в состоянии ожидания
        ctx.session.awaitingPaymentProof = false;
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

        let clientName = null;
        if (user.subscriptionCount === 0) {
            if (user.username) {
                clientName = transliterate(user.username).replace(/[^a-zA-Z0-9_]/g, '');
            }
            if (!clientName) {
                clientName = `telegram_${userId}`;
            }
        } else {
            clientName = user.vpnClientName;
        }

        const updateData = {
            status: 'active',
            expireDate: newExpireDate,
            paymentPhotoId: null,
            paymentPhotoDate: null,
            $inc: { subscriptionCount: 1 }
        };

        if (user.subscriptionCount === 0) {
            updateData.vpnClientName = clientName;
            updateData.vpnConfigured = false;
        }

        const updatedUser = await User.findOneAndUpdate(
            { userId },
            updateData,
            { new: true, upsert: true }
        );

        await ctx.answerCbQuery('✅ Платёж принят');
        await ctx.deleteMessage();

        // Логика для первого платежа
        if (updatedUser.subscriptionCount === 1) {
            try {
                const configContent = await createVpnClient(clientName);
                await ctx.telegram.sendMessage(
                    userId,
                    `🎉 *Платёж подтверждён!* 🎉\n\n` +
                    `Доступ к VPN активен до *${formatDate(newExpireDate, true)}*\n\n` +
                    `📁 Ваш файл конфигурации VPN и видеоинструкция отправлены ниже.`,
                    { parse_mode: 'Markdown' }
                );
                await ctx.telegram.sendDocument(
                    userId,
                    { source: Buffer.from(configContent), filename: `${clientName}.conf` }
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
        } else { // Логика для продления
            try {
                await enableVpnClient(clientName);
                console.log(`Клиент ${clientName} был успешно включен.`);
            } catch (vpnError) {
                console.error(`Ошибка при включении VPN-клиента для ${clientName}:`, vpnError);
            }

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

/**
 * Обрабатывает отклонение платежа администратором.
 * Показывает дополнительные опции для отклонения.
 * @param {object} ctx - Объект контекста Telegraf.
 */
exports.handleReject = async (ctx) => {
    if (!checkAdmin(ctx)) {
        return ctx.answerCbQuery('🚫 Только для админа');
    }
    const userId = parseInt(ctx.match[1]);

    try {
        await ctx.answerCbQuery('Выберите действие');

        // Показываем дополнительные опции для отклонения
        await ctx.reply(
            `❌ *Отклонение платежа пользователя ${userId}*\n\n` +
            `Выберите действие:`,
            {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [
                            { text: '❌ Отклонить без комментария', callback_data: `reject_simple_${userId}` },
                            { text: '✍️ Отклонить с комментарием', callback_data: `reject_with_comment_${userId}` }
                        ],
                        [
                            { text: '🔄 Отменить отклонение', callback_data: `cancel_rejection_${userId}` }
                        ]
                    ]
                }
            }
        );
    } catch (error) {
        console.error(`Ошибка при обработке отклонения для пользователя ${userId}:`, error);
        await ctx.answerCbQuery('⚠️ Ошибка при обработке отклонения!');
        await ctx.reply('⚠️ Произошла ошибка. Проверьте логи.');
    }
};

/**
 * Обрабатывает простое отклонение платежа без комментария.
 * @param {object} ctx - Объект контекста Telegraf.
 */
exports.handleRejectSimple = async (ctx) => {
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
                paymentPhotoDate: null,
                rejectionReason: null // Очищаем предыдущую причину
            }
        );

        // Отправляем стандартное сообщение об отклонении
        await ctx.telegram.sendMessage(
            userId,
            '❌ *Платёж отклонён*\n\n' +
            '*Причина: это не скриншот со Сбербанка*\n\n' +
            'Возможные причины:\n' +
            '- Неверная сумма\n' +
            '- Нет комментария к платежу\n' +
            '- Нечитаемый скриншот\n\n' +
            '*Попробуйте отправить чек ещё раз.*',
            { parse_mode: 'Markdown' }
        );

        await ctx.answerCbQuery('❌ Платёж отклонён');
        await ctx.editMessageText('✅ Платёж отклонён без комментария');

    } catch (error) {
        console.error(`Ошибка при простом отклонении платежа для пользователя ${userId}:`, error);
        await ctx.answerCbQuery('⚠️ Ошибка при отклонении платежа!');
        await ctx.reply('⚠️ Произошла ошибка при отклонении платежа. Проверьте логи.');
    }
};

/**
 * Инициирует процесс отклонения платежа с комментарием.
 * @param {object} ctx - Объект контекста Telegraf.
 */
exports.handleRejectWithComment = async (ctx) => {
    if (!checkAdmin(ctx)) {
        return ctx.answerCbQuery('🚫 Только для админа');
    }
    const userId = parseInt(ctx.match[1]);

    try {
        // Сохраняем ID пользователя для отклонения в сессии
        ctx.session.awaitingRejectionCommentFor = userId;

        await ctx.answerCbQuery('Введите комментарий');
        await ctx.editMessageText(
            `✍️ *Отклонение платежа с комментарием*\n\n` +
            `Пользователь: ${userId}\n\n` +
            `Введите причину отклонения платежа:`,
            {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '❌ Отменить', callback_data: `cancel_rejection_${userId}` }]
                    ]
                }
            }
        );

    } catch (error) {
        console.error(`Ошибка при инициации отклонения с комментарием для пользователя ${userId}:`, error);
        await ctx.answerCbQuery('⚠️ Ошибка!');
        await ctx.reply('⚠️ Произошла ошибка. Проверьте логи.');
    }
};

/**
 * Обрабатывает отмену отклонения платежа.
 * Возвращает к исходным кнопкам "Принять" и "Отклонить".
 * @param {object} ctx - Объект контекста Telegraf.
 */
exports.handleCancelRejection = async (ctx) => {
    if (!checkAdmin(ctx)) {
        return ctx.answerCbQuery('🚫 Только для админа');
    }
    const userId = parseInt(ctx.match[1]);

    try {
        // Очищаем сессию если была начата процедура с комментарием
        if (ctx.session.awaitingRejectionCommentFor === userId) {
            delete ctx.session.awaitingRejectionCommentFor;
        }

        // Получаем информацию о пользователе для отображения
        const User = require('../models/User');
        const user = await User.findOne({ userId });
        const { escapeMarkdown } = require('../utils/helpers');

        let userDisplay = '';
        const safeFirstName = escapeMarkdown(user?.firstName || 'Не указано');
        if (user?.username) {
            userDisplay = `${safeFirstName} (@${escapeMarkdown(user.username)})`;
        } else {
            userDisplay = `${safeFirstName} (без username)`;
        }
        if (!user?.firstName && !user?.username) {
            userDisplay = `Неизвестный пользователь`;
        }

        await ctx.answerCbQuery('Возвращено к рассмотрению');

        // Проверяем, есть ли фото в сообщении
        if (ctx.callbackQuery.message.photo) {
            // Если это сообщение с фото, редактируем caption и кнопки
            await ctx.editMessageCaption(
                `📸 *Заявка на оплату от пользователя:*\n` +
                `Имя: ${userDisplay}\n` +
                `ID: ${userId}`,
                {
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [
                            [
                                { text: '✅ Принять', callback_data: `approve_${userId}` },
                                { text: '❌ Отклонить', callback_data: `reject_${userId}` }
                            ],
                            [
                                { text: '⏰ Рассмотреть позже', callback_data: `review_later_${userId}` }
                            ]
                        ]
                    }
                }
            );
        } else {
            // Если это текстовое сообщение, редактируем текст
            await ctx.editMessageText(
                `📸 *Заявка на оплату от пользователя:*\n` +
                `Имя: ${userDisplay}\n` +
                `ID: ${userId}`,
                {
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [
                            [
                                { text: '✅ Принять', callback_data: `approve_${userId}` },
                                { text: '❌ Отклонить', callback_data: `reject_${userId}` }
                            ],
                            [
                                { text: '⏰ Рассмотреть позже', callback_data: `review_later_${userId}` }
                            ]
                        ]
                    }
                }
            );
        }

    } catch (error) {
        console.error(`Ошибка при отмене отклонения для пользователя ${userId}:`, error);
        await ctx.answerCbQuery('⚠️ Ошибка при отмене!');
        await ctx.reply('⚠️ Произошла ошибка при отмене отклонения. Проверьте логи.');
    }
};

/**
 * Обрабатывает отложение рассмотрения платежа.
 * @param {object} ctx - Объект контекста Telegraf.
 */
exports.handleReviewLater = async (ctx) => {
    if (!checkAdmin(ctx)) {
        return ctx.answerCbQuery('🚫 Только для админа');
    }
    const userId = parseInt(ctx.match[1]);

    try {
        await ctx.answerCbQuery('Платёж отложен для рассмотрения');

        // Проверяем, есть ли фото в сообщении
        if (ctx.callbackQuery.message.photo) {
            // Если это сообщение с фото, редактируем caption
            await ctx.editMessageCaption(
                `⏰ *Платёж отложен для рассмотрения*\n\n` +
                `Пользователь: ${userId}\n` +
                `Статус: Ожидает рассмотрения\n\n` +
                `_Платёж можно найти через команду /check_`,
                {
                    parse_mode: 'Markdown',
                    reply_markup: { inline_keyboard: [] } // Убираем кнопки
                }
            );
        } else {
            // Если это текстовое сообщение, редактируем текст
            await ctx.editMessageText(
                `⏰ *Платёж отложен для рассмотрения*\n\n` +
                `Пользователь: ${userId}\n` +
                `Статус: Ожидает рассмотрения\n\n` +
                `_Платёж можно найти через команду /check_`,
                { parse_mode: 'Markdown' }
            );
        }

        console.log(`[ADMIN] Платёж пользователя ${userId} отложен для рассмотрения администратором ${ctx.from.id}`);

    } catch (error) {
        console.error(`Ошибка при отложении рассмотрения для пользователя ${userId}:`, error);
        await ctx.answerCbQuery('⚠️ Ошибка!');
        await ctx.reply('⚠️ Произошла ошибка при отложении рассмотрения. Проверьте логи.');
    }
};

/**
 * Завершает отклонение платежа с пользовательским комментарием.
 * @param {object} ctx - Объект контекста Telegraf.
 * @param {string} rejectionComment - Комментарий администратора.
 */
exports.finalizeRejectionWithComment = async (ctx, rejectionComment) => {
    const userId = ctx.session.awaitingRejectionCommentFor;

    try {
        await User.findOneAndUpdate(
            { userId },
            {
                status: 'rejected',
                paymentPhotoId: null,
                paymentPhotoDate: null,
                rejectionReason: rejectionComment
            }
        );

        // Отправляем пользователю только причину отклонения от администратора
        await ctx.telegram.sendMessage(
            userId,
            `❌ *Платёж отклонён*\n\n` +
            `*Причина:* ${rejectionComment}`,
            { parse_mode: 'Markdown' }
        );

        await ctx.reply(`✅ Платёж пользователя ${userId} отклонён с комментарием: "${rejectionComment}"`);

        // Очищаем сессию
        delete ctx.session.awaitingRejectionCommentFor;

    } catch (error) {
        console.error(`Ошибка при финальном отклонении с комментарием для пользователя ${userId}:`, error);
        await ctx.reply('⚠️ Произошла ошибка при отклонении платежа с комментарием. Проверьте логи.');
    }
};