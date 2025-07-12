const User = require('../models/User');
const { paymentDetails, formatDate, formatDuration } = require('../utils/helpers');
const { checkAdmin } = require('./adminController');
const { Markup } = require('telegraf');

exports.handleStart = async (ctx) => {
    const { id, first_name } = ctx.from;

    // === ЛОГИКА ДЛЯ АДМИНА ===
    if (id === parseInt(process.env.ADMIN_ID) && checkAdmin(ctx)) {
        return ctx.replyWithMarkdown(
            '👋 *Админ-панель*\n\n' +
            'Команды:\n' +
            '/check - Проверить заявки\n' +
            '/stats - Статистика\n' +
            '/questions - Все вопросы',
            {
                reply_markup: { // Используем InlineKeyboardMarkup
                    inline_keyboard: [
                        [{ text: 'Проверить заявки', callback_data: 'check_payments_admin' }],
                        [{ text: 'Статистика', callback_data: 'show_stats_admin' }],
                        [{ text: 'Все вопросы', callback_data: 'list_questions' }]
                    ]
                }
            }
        );
    }

    // === ЛОГИКА ДЛЯ ОБЫЧНОГО ПОЛЬЗОВАТЕЛЯ ===
    const user = await User.findOne({ userId: id });

    let message = '';
    let keyboardButtons = [];

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

        // Показываем кнопку "Получить файл и инструкцию" только если это первая подписка
        // ИЛИ если пользователь еще не подтвердил настройку
        if ((!user.subscriptionCount || user.subscriptionCount === 1) && !user.vpnConfigured) {
            keyboardButtons.push([{ text: '📁 Получить файл и инструкцию', callback_data: `send_vpn_info_${id}` }]);
        }
        // Если уже настроил и не первая подписка, то кнопки с файлом не нужно
        // Если настроил, а кнопка "Не получилось" была, то ее тоже не показываем
        // Если НЕ настроил, но подписка активна, то кнопки "Успешно/Не получилось"
        if (user.subscriptionCount && user.subscriptionCount === 1 && !user.vpnConfigured) {
             keyboardButtons.push(
                [{ text: '✅ Успешно настроил', callback_data: `vpn_configured_${id}` }],
                [{ text: '❌ Не получилось настроить', callback_data: `vpn_failed_${id}` }]
            );
        }


    } else {
        message = `🔐 *VPN подписка: ${process.env.VPN_PRICE || 132} руб/мес*\n\n` +
            `${paymentDetails(id, first_name)}\n\n` +
            '_После оплаты отправьте скриншот чека_';
    }

    if (hasActiveOrPendingSubscription) {
        keyboardButtons.push(
            [{ text: '🗓 Посмотреть срок действия подписки', callback_data: 'check_subscription' }]
        );
    }

    keyboardButtons.push(
        [{ text: '❓ Задать вопрос', callback_data: 'ask_question' }]
    );

    // Для обычного пользователя продолжим использовать InlineKeyboard
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

exports.checkSubscriptionStatus = async (ctx) => {
    const { id, first_name } = ctx.from;
    const user = await User.findOne({ userId: id });

    if (!user || (user.status !== 'active' && user.status !== 'pending')) {
        await ctx.replyWithMarkdown(
            `Вы пока не активировали подписку. VPN подписка: *${process.env.VPN_PRICE || 132} руб/мес*\n\n` +
            `${paymentDetails(id, first_name)}\n\n` +
            '_После оплаты отправьте скриншот чека_',
            { disable_web_page_preview: true }
        );
        return ctx.answerCbQuery();
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
        await ctx.replyWithMarkdown(
            `Вы пока не активировали подписку. VPN подписка: *${process.env.VPN_PRICE || 132} руб/мес*\n\n` +
            `${paymentDetails(id, first_name)}\n\n` +
            '_После оплаты отправьте скриншот чека_',
            { disable_web_page_preview: true }
        );
    }
    await ctx.answerCbQuery();
};

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

exports.promptForQuestion = async (ctx) => {
    await ctx.reply('✍️ Напишите ваш вопрос в следующем сообщении. Я передам его администратору.');
    await ctx.answerCbQuery();
};

exports.requestVpnInfo = async (ctx) => {
    const userId = parseInt(ctx.match[1]);
    const user = await User.findOne({ userId });

    // Добавляем проверку на то, что запрос идет от текущего пользователя
    if (ctx.from.id !== userId) {
        return ctx.answerCbQuery('Вы не можете запросить инструкцию для другого пользователя.');
    }

    // Изменено условие: Теперь инструкция отправляется только если vpnConfigured не true
    // и это первая подписка. Если уже успешно настроил, то нет смысла отправлять.
    if (!user || user.status !== 'active' || user.vpnConfigured || (user.subscriptionCount && user.subscriptionCount > 1)) {
        let replyMessage = '⚠️ Запрос инструкции невозможен.';
        if (!user || user.status !== 'active') {
            replyMessage = '⚠️ Вы можете запросить инструкцию только при активной подписке.';
        } else if (user.vpnConfigured) {
            replyMessage = '⚠️ Вы уже подтвердили успешную настройку VPN ранее.';
        } else if (user.subscriptionCount && user.subscriptionCount > 1) {
             replyMessage = '⚠️ Инструкции предоставляются при первой активации подписки.';
        }
        await ctx.reply(replyMessage);
        return ctx.answerCbQuery();
    }


    await ctx.telegram.sendMessage(
        process.env.ADMIN_ID,
        `🔔 Пользователь ${user.firstName || user.username || 'Без имени'} (ID: ${userId}) запросил файл конфигурации и видеоинструкцию.`,
        Markup.inlineKeyboard([
            [Markup.button.callback('➡️ Отправить инструкцию', `send_instruction_to_${userId}`)]
        ])
    );

    await ctx.reply('✅ Ваш запрос на получение инструкции отправлен администратору. Он вышлет вам необходимые файлы в ближайшее время.');
    await ctx.answerCbQuery();
};

// Обработка нажатия кнопки "Успешно настроил"
exports.handleVpnConfigured = async (ctx) => {
    const userId = parseInt(ctx.match[1]);
    // Проверяем, что кнопку нажал сам пользователь
    if (ctx.from.id !== userId) {
        return ctx.answerCbQuery('Эта кнопка предназначена для подтверждения настройки вашего VPN.');
    }

    try {
        const user = await User.findOne({ userId });

        if (!user) {
            return ctx.answerCbQuery('Пользователь не найден.');
        }

        // Проверяем, не подтверждал ли пользователь уже настройку
        if (user.vpnConfigured) {
            return ctx.answerCbQuery('Вы уже подтвердили успешную настройку ранее.');
        }

        // Обновляем статус пользователя в базе данных
        const updatedUser = await User.findOneAndUpdate(
            { userId },
            { vpnConfigured: true, vpnConfiguredAt: new Date() }, // Добавляем vpnConfiguredAt
            { new: true }
        );

        // Уведомляем администратора
        await ctx.telegram.sendMessage(
            process.env.ADMIN_ID,
            `🎉 Пользователь ${updatedUser.firstName || updatedUser.username || 'Без имени'} (ID: ${updatedUser.userId}) *успешно настроил VPN!*`,
            { parse_mode: 'Markdown' }
        );

        await ctx.reply('Спасибо за подтверждение! Рад, что вам удалось настроить VPN. Приятного пользования! 😊');
    } catch (error) {
        console.error(`Ошибка при подтверждении настройки VPN для ${userId}:`, error);
        await ctx.reply('Произошла ошибка при сохранении вашего статуса настройки. Пожалуйста, свяжитесь с поддержкой.');
    } finally {
        await ctx.answerCbQuery('Подтверждение получено!');
    }
};

// НОВАЯ ФУНКЦИЯ: Обработчик кнопки "Не получилось настроить"
exports.handleVpnFailed = async (ctx) => {
    const userId = parseInt(ctx.match[1]);
    // Проверяем, что кнопку нажал сам пользователь
    if (ctx.from.id !== userId) {
        return ctx.answerCbQuery('Эта кнопка предназначена для вашего VPN.');
    }

    // Устанавливаем сессию для ожидания сообщения от пользователя
    ctx.session.awaitingVpnIssueFor = ctx.from.id;
    await ctx.reply('Пожалуйста, опишите, какая возникла проблема с настройкой VPN:');
    await ctx.answerCbQuery();
};

// НОВАЯ ФУНКЦИЯ: Обработка сообщения пользователя с описанием проблемы
exports.handleUserVpnIssue = async (ctx) => {
    const userId = ctx.from.id;
    const issueDescription = ctx.message.text;

    // Сбрасываем ожидание
    ctx.session.awaitingVpnIssueFor = null;

    try {
        const user = await User.findOne({ userId });

        if (user) {
            // Отправляем уведомление администратору
            await ctx.telegram.sendMessage(
                process.env.ADMIN_ID,
                `🚨 *Проблема с настройкой VPN от пользователя:* ${user.firstName || user.username} (ID: ${userId})\n\n` +
                `*Описание проблемы:*\n\`\`\`\n${issueDescription}\n\`\`\``, // Описание проблемы в блоке кода
                {
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [
                            [Markup.button.callback('➡️ Ответить пользователю', `answer_${userId}`)]
                        ]
                    }
                }
            );
            await ctx.reply('Спасибо, ваше сообщение о проблеме отправлено администратору. Он свяжется с вами для помощи.');
        } else {
            await ctx.reply('Произошла ошибка. Не удалось найти ваши данные.');
        }
    } catch (error) {
        console.error(`Ошибка при отправке проблемы VPN от пользователя ${userId}:`, error);
        await ctx.reply('Произошла ошибка при отправке вашего сообщения. Пожалуйста, свяжитесь с поддержкой.');
    }
};