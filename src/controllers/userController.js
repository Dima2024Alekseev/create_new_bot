const User = require('../models/User');
const { Markup } = require('telegraf');
const { formatDate, paymentDetails } = require('../utils/helpers');
const wgService = require('../services/wireguardService'); // НОВОЕ: Импорт wgService
const { escapeMarkdown } = require('../utils/helpers'); // Для экранирования в сообщениях админу

// ... (Остальные импорты и экспорты не меняются) ...

/**
 * Обрабатывает команду /start.
 * Приветствует пользователя и предлагает опции в зависимости от статуса подписки.
 * @param {object} ctx - Объект контекста Telegraf.
 */
exports.handleStart = async (ctx) => {
    const { id, first_name, username } = ctx.from;

    try {
        const user = await User.findOneAndUpdate(
            { userId: id },
            { 
                userId: id,
                username: username || null,
                firstName: first_name || null
            },
            { upsert: true, new: true, setDefaultsOnInsert: true }
        );

        // Проверяем, активна ли подписка и не истекла ли она
        const hasActiveSubscription = user.status === 'active' && user.expireDate && user.expireDate > new Date();

        let welcomeMessage = `👋 Привет, *${escapeMarkdown(first_name || username || 'пользователь')}*! Я бот для управления VPN.\n\n`;
        let keyboard;

        if (hasActiveSubscription) {
            welcomeMessage += `🗓 Ваша подписка активна до *${formatDate(user.expireDate, true)}*.\n\n`;
            keyboard = Markup.inlineKeyboard([
                [Markup.button.callback('🗓 Проверить статус', 'check_subscription')],
                [Markup.button.callback('➕ Продлить подписку', 'extend_subscription')],
                [Markup.button.callback('❓ Задать вопрос', 'ask_question')]
            ]);
        } else {
            welcomeMessage += `Вы ещё не оформили подписку или она истекла. \n\n` +
                              `Подключитесь к VPN за *${process.env.VPN_PRICE} руб.* в месяц.\n\n` +
                              paymentDetails(id, first_name || username); // Передача имени для комментария

            keyboard = Markup.inlineKeyboard([
                [Markup.button.callback('➕ Оформить подписку', 'extend_subscription')],
                [Markup.button.callback('❓ Задать вопрос', 'ask_question')]
            ]);
        }

        await ctx.replyWithMarkdown(welcomeMessage, keyboard);
    } catch (error) {
        console.error('Ошибка в handleStart:', error);
        await ctx.reply('⚠️ Произошла ошибка. Пожалуйста, попробуйте позже.');
    }
};

/**
 * Проверяет и отображает статус подписки пользователя.
 * @param {object} ctx - Объект контекста Telegraf.
 */
exports.checkSubscriptionStatus = async (ctx) => {
    const { id, first_name, username } = ctx.from;

    try {
        const user = await User.findOne({ userId: id });

        if (!user) {
            return ctx.reply('ℹ️ Мы не нашли информации о вашей подписке. Возможно, вы новый пользователь. Нажмите /start.');
        }

        let message = `*Ваш статус подписки:*\n\n`;
        let keyboard;

        const hasActiveSubscription = user.status === 'active' && user.expireDate && user.expireDate > new Date();
        
        if (hasActiveSubscription) {
            message += `✅ *Активна*\n`;
            message += `Срок действия до: *${formatDate(user.expireDate, true)}*\n\n`;
            message += `Продлите VPN за *${process.env.VPN_PRICE} руб.* в месяц.\n\n`;
            
            keyboard = Markup.inlineKeyboard([
                [Markup.button.callback('➕ Продлить подписку', 'extend_subscription')],
                [Markup.button.callback('📁 Получить файл и инструкцию', `send_vpn_info_${id}`)],
                [Markup.button.callback('❓ Задать вопрос', 'ask_question')]
            ]);

            // Если подписка активна, но пользователь еще не подтвердил настройку
            if (!user.vpnConfigured) {
                keyboard.reply_markup.inline_keyboard.push(
                    [Markup.button.callback('❌ Не справился с настройкой', `vpn_failed_${id}`)]
                );
            }
            
        } else if (user.status === 'pending') {
            message += `⏳ *Ожидает подтверждения оплаты*\n`;
            message += `Мы получили ваш скриншот и ожидаем подтверждения администратором. Это может занять некоторое время.`;
            keyboard = Markup.inlineKeyboard([
                [Markup.button.callback('❓ Задать вопрос', 'ask_question')]
            ]);
        } else {
            message += `🚫 *Неактивна* или *Истекла*\n`;
            if (user.expireDate && user.expireDate <= new Date()) {
                message += `Срок действия истёк: *${formatDate(user.expireDate, true)}*\n\n`;
            }
            message += `Подключитесь к VPN за *${process.env.VPN_PRICE} руб.* в месяц.\n\n` +
                       paymentDetails(id, first_name || username); // Передача имени для комментария
            keyboard = Markup.inlineKeyboard([
                [Markup.button.callback('➕ Оформить подписку', 'extend_subscription')],
                [Markup.button.callback('❓ Задать вопрос', 'ask_question')]
            ]);
        }

        await ctx.reply(message, { parse_mode: 'Markdown', ...keyboard, disable_web_page_preview: true });
        await ctx.answerCbQuery();
    } catch (error) {
        console.error('Ошибка в checkSubscriptionStatus:', error);
        await ctx.reply('⚠️ Произошла ошибка при проверке статуса подписки. Пожалуйста, попробуйте позже.');
        await ctx.answerCbQuery('Ошибка');
    }
};

/**
 * Предлагает пользователю оформить или продлить подписку.
 * @param {object} ctx - Объект контекста Telegraf.
 */
exports.extendSubscription = async (ctx) => {
    const { id, first_name, username } = ctx.from;
    const user = await User.findOne({ userId: id });

    let message;
    let keyboard;

    if (user && user.status === 'pending') {
        message = `⏳ *Вы уже отправили скриншот оплаты и ожидаете подтверждения администратором.* Пожалуйста, дождитесь проверки.`;
        keyboard = Markup.inlineKeyboard([
            [Markup.button.callback('🗓 Проверить статус', 'check_subscription')]
        ]);
    } else {
        message = `Для оформления/продления подписки на VPN:\n\n` +
                  `1. Отправьте *${process.env.VPN_PRICE} руб.* на указанные реквизиты.\n` +
                  `2. *ОБЯЗАТЕЛЬНО* укажите комментарий к платежу.\n` +
                  `3. После оплаты пришлите *скриншот* чека в этот чат.\n\n` +
                  paymentDetails(id, first_name || username);
        keyboard = Markup.inlineKeyboard([
            [Markup.button.callback('❓ Задать вопрос', 'ask_question')]
        ]);
    }
    
    await ctx.reply(message, { parse_mode: 'Markdown', ...keyboard, disable_web_page_preview: true });
    await ctx.answerCbQuery();
};

/**
 * Просит пользователя написать вопрос.
 * @param {object} ctx - Объект контекста Telegraf.
 */
exports.promptForQuestion = async (ctx) => {
    // Устанавливаем флаг, что бот ожидает вопрос от пользователя
    ctx.session.awaitingQuestion = true; 
    await ctx.reply('✍️ Напишите ваш вопрос в следующем сообщении. Я передам его администратору.');
    await ctx.answerCbQuery();
};

/**
 * Отправляет конфиг-файл VPN и видеоинструкцию пользователю.
 * @param {object} ctx - Объект контекста Telegraf.
 */
exports.requestVpnInfo = async (ctx) => {
    const userId = parseInt(ctx.match[1]);
    const user = await User.findOne({ userId });

    if (!user || user.status !== 'active') {
        await ctx.reply('⚠️ Вы можете запросить инструкцию только при активной подписке.');
        return ctx.answerCbQuery();
    }

    // НОВОЕ: Если клиент WG уже создан, переотправляем конфиг
    if (user.wgClientId) {
        try {
            const fileBuffer = await wgService.getWgClientConfig(user.wgClientId);
            const qrCodeBuffer = await wgService.getWgClientQrCode(user.wgClientId);

            await ctx.telegram.sendDocument(
                userId,
                { source: fileBuffer, filename: `wg-config-${userId}.conf` },
                { caption: '📁 Ваш файл конфигурации WireGuard (повторно):' }
            );
            await ctx.telegram.sendPhoto(
                userId,
                { source: qrCodeBuffer, filename: `wg-qr-${userId}.svg` },
                { caption: '📸 QR-код для настройки WireGuard (повторно):' }
            );

            if (process.env.VPN_VIDEO_FILE_ID) {
                await ctx.telegram.sendVideo(
                    userId,
                    process.env.VPN_VIDEO_FILE_ID,
                    { caption: '🎬 Видеоинструкция по настройке VPN (повторно):' }
                );
            }

            await ctx.telegram.sendMessage(
                userId,
                '✅ Файл конфигурации, QR-код и видеоинструкция (если есть) отправлены повторно. Если проблемы остались, нажмите "Не справился с настройкой".',
                Markup.inlineKeyboard([
                    [
                        Markup.button.callback('✅ Успешно настроил', `vpn_configured_${userId}`),
                        Markup.button.callback('❌ Не справился с настройкой', `vpn_failed_${userId}`)
                    ]
                ])
            );

            let userName = user.firstName || user.username || 'Без имени';
            if (user.username) {
                userName = `${userName} (@${user.username})`;
            }
            await ctx.telegram.sendMessage(
                process.env.ADMIN_ID,
                `🔔 Пользователь ${userName} (ID: ${userId}) повторно запросил файл конфигурации.`
            );

        } catch (error) {
            console.error(`Ошибка при повторной отправке WG-конфига для ${userId}:`, error);
            await ctx.reply('⚠️ Произошла ошибка при повторной отправке файла. Пожалуйста, свяжитесь с администратором.');
            await ctx.telegram.sendMessage(
                process.env.ADMIN_ID,
                `🚨 Ошибка при повторной отправке VPN-конфига пользователю ${userId}: ${escapeMarkdown(error.message)}`
            );
        }
        return ctx.answerCbQuery();
    }

    // Если wgClientId еще нет (очень редкий случай после одобрения)
    // или если админ хочет выслать вручную:
    let userName = user.firstName || user.username || 'Без имени';
    if (user.username) {
        userName = `${userName} (@${user.username})`;
    }
    await ctx.telegram.sendMessage(
        process.env.ADMIN_ID,
        `🔔 Пользователь ${userName} (ID: ${userId}) запросил файл конфигурации и видеоинструкцию.\n` +
        `_wgClientId отсутствует или произошла ошибка при автоматической выдаче. Возможно, требуется ручная отправка или пересоздание клиента в wg-easy._`,
        Markup.inlineKeyboard([
            [Markup.button.callback('➡️ Отправить инструкцию', `send_instruction_to_${userId}`)]
        ])
    );

    await ctx.reply('✅ Ваш запрос на получение инструкции отправлен администратору. Он вышлет вам необходимые файлы в ближайшее время.');
    await ctx.answerCbQuery();
};

/**
 * Обрабатывает успешную настройку VPN пользователем.
 * @param {object} ctx - Объект контекста Telegraf.
 */
exports.handleVpnConfigured = async (ctx) => {
    const userId = parseInt(ctx.match[1]);
    if (ctx.from.id !== userId) {
        return ctx.answerCbQuery('Это не для вас.');
    }

    try {
        await User.findOneAndUpdate(
            { userId },
            { vpnConfigured: true, awaitingVpnTroubleshoot: false }
        );
        await ctx.reply('👍 Отлично! Рады, что VPN успешно настроен. Если возникнут вопросы, вы всегда можете задать их.');
        await ctx.answerCbQuery('Настройка подтверждена!');
        await ctx.deleteMessage(); // Удалить сообщение с кнопками настройки
    } catch (error) {
        console.error(`Ошибка при подтверждении настройки VPN для пользователя ${userId}:`, error);
        await ctx.reply('⚠️ Произошла ошибка при сохранении вашего статуса настройки. Пожалуйста, попробуйте позже.');
        await ctx.answerCbQuery('Ошибка');
    }
};

/**
 * Просит пользователя описать проблему с настройкой VPN.
 * @param {object} ctx - Объект контекста Telegraf.
 */
exports.promptVpnFailure = async (ctx) => {
    const userId = parseInt(ctx.match[1]);
    if (ctx.from.id !== userId) {
        return ctx.answerCbQuery('Это не для вас.');
    }

    try {
        // Устанавливаем флаг в сессии для пользователя, что ожидаем описание проблемы
        ctx.session.awaitingVpnTroubleshoot = userId; 
        await ctx.reply('😞 Извините, что возникли трудности. Пожалуйста, опишите вашу проблему как можно подробнее в следующем сообщении, и администратор свяжется с вами для помощи.');
        await ctx.answerCbQuery('Ожидание описания проблемы');
        await ctx.deleteMessage(); // Удалить сообщение с кнопками настройки
    } catch (error) {
        console.error(`Ошибка при запросе описания проблемы для пользователя ${userId}:`, error);
        await ctx.reply('⚠️ Произошла ошибка. Пожалуйста, попробуйте позже.');
        await ctx.answerCbQuery('Ошибка');
    }
};


// --- Обработчики для отмены подписки ---

/**
 * Запрашивает подтверждение отмены подписки.
 * @param {object} ctx - Объект контекста Telegraf.
 */
exports.promptCancelSubscription = async (ctx) => {
    await ctx.reply(
        'Вы уверены, что хотите отменить подписку на VPN? Доступ будет немедленно прекращен.',
        Markup.inlineKeyboard([
            [
                Markup.button.callback('✅ Да, отменить', 'cancel_subscription_final'),
                Markup.button.callback('❌ Нет, оставить', 'cancel_subscription_abort')
            ]
        ])
    );
    await ctx.answerCbQuery();
};

/**
 * Окончательная отмена подписки и удаление клиента WireGuard.
 * @param {object} ctx - Объект контекста Telegraf.
 */
exports.cancelSubscriptionFinal = async (ctx) => {
    const userId = ctx.from.id;
    const user = await User.findOne({ userId });

    if (!user || user.status !== 'active') {
        await ctx.reply('⚠️ У вас нет активной подписки для отмены.');
        return ctx.answerCbQuery();
    }

    try {
        await User.findOneAndUpdate(
            { userId },
            { 
                status: 'inactive', 
                expireDate: new Date(), // Устанавливаем дату истечения на текущую
                vpnConfigured: false,
                wgClientId: null // Очищаем WG Client ID
            }
        );

        // НОВОЕ: Удаление клиента WireGuard из wg-easy
        if (user.wgClientId) {
            try {
                await wgService.deleteWgClient(user.wgClientId);
                console.log(`[cancelSubscriptionFinal] Клиент WireGuard ${user.wgClientId} удален из wg-easy.`);
            } catch (wgError) {
                console.error(`❌ Ошибка при удалении WG-Easy клиента ${user.wgClientId}:`, wgError.message);
                await ctx.telegram.sendMessage(
                    process.env.ADMIN_ID,
                    `⚠️ Ошибка при попытке удалить VPN-клиента ${user.wgClientId} для пользователя ${userId}. Проверьте wg-easy вручную.\n` +
                    `Ошибка: ${escapeMarkdown(wgError.message)}`
                );
            }
        }

        await ctx.reply('✅ Ваша подписка успешно отменена. Доступ к VPN прекращен.');
        await ctx.answerCbQuery();
        await ctx.deleteMessage(); // Удаляем сообщение с кнопками подтверждения

        let userName = user.firstName || user.username || 'Без имени';
        if (user.username) {
            userName = `${userName} (@${user.username})`;
        }
        await ctx.telegram.sendMessage(
            process.env.ADMIN_ID,
            `🚫 Пользователь ${userName} (ID: ${userId}) отменил свою подписку.`
        );

    } catch (error) {
        console.error(`Ошибка при отмене подписки для пользователя ${userId}:`, error);
        await ctx.reply('⚠️ Произошла ошибка при отмене подписки. Пожалуйста, попробуйте позже или свяжитесь с администратором.');
        await ctx.answerCbQuery('Ошибка');
    }
};

/**
 * Отмена действия по отмене подписки.
 * @param {object} ctx - Объект контекста Telegraf.
 */
exports.cancelSubscriptionAbort = async (ctx) => {
    await ctx.reply('Отмена подписки отменена. Ваша подписка продолжает действовать.');
    await ctx.answerCbQuery();
    await ctx.deleteMessage(); // Удаляем сообщение с кнопками подтверждения
};