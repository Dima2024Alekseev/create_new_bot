const User = require('../models/User');
const Question = require('../models/Question');
const { Markup } = require('telegraf');
const { formatDate, formatDuration, paymentDetails } = require('../utils/helpers');

/**
 * Обрабатывает команду /start, приветствуя пользователя и отображая главное меню.
 * @param {object} ctx - Объект контекста Telegraf.
 */
exports.handleStart = async (ctx) => {
    const userId = ctx.from.id;
    const { first_name, username } = ctx.from;

    try {
        const user = await User.findOneAndUpdate(
            { userId },
            {
                userId,
                firstName: first_name,
                username,
                lastSeen: new Date()
            },
            { upsert: true, new: true, setDefaultsOnInsert: true }
        );

        let statusText = '';
        let keyboardButtons = [];

        if (user.status === 'active') {
            const timeLeft = user.expireDate - new Date();
            const daysLeft = Math.ceil(timeLeft / (1000 * 60 * 60 * 24));
            statusText = `✅ *Ваша подписка активна!* Доступно ещё *${daysLeft}* дней.\n`;

            if (daysLeft < 7) {
                statusText += `\n⚠️ Ваша подписка скоро истекает. Чтобы продлить её, нажмите кнопку ниже.\n`;
                keyboardButtons.push([{ text: '💰 Продлить подписку', callback_data: 'extend_subscription' }]);
            }
            keyboardButtons.push(
                [{ text: '🗓 Посмотреть срок действия подписки', callback_data: 'check_subscription' }]
            );

        } else if (user.status === 'inactive') {
            statusText = '❌ *Ваша подписка неактивна.*\n\nЧтобы получить доступ к VPN, пожалуйста, оплатите подписку.';
            keyboardButtons.push(
                [{ text: '💰 Оплатить подписку', callback_data: 'extend_subscription' }]
            );

        } else if (user.status === 'pending') {
            statusText = '⏳ *Ваш платёж на проверке.* Пожалуйста, подождите, пока администратор подтвердит его.';
            keyboardButtons.push([{ text: '❓ Задать вопрос', callback_data: 'ask_question' }]);

        } else if (user.status === 'rejected') {
            statusText = '❌ *Ваш платёж был отклонён.*\n\nПожалуйста, отправьте скриншот ещё раз, убедившись в правильности данных.';
            keyboardButtons.push(
                [{ text: '💰 Оплатить подписку', callback_data: 'extend_subscription' }]
            );
        }

        keyboardButtons.push([{ text: '❓ Задать вопрос', callback_data: 'ask_question' }]);

        await ctx.reply(
            `👋 Привет, *${user.firstName}!* Я бот для управления VPN.\n\n` + statusText,
            {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: keyboardButtons
                }
            }
        );

    } catch (error) {
        console.error('Ошибка в handleStart:', error);
        await ctx.reply('⚠️ Произошла ошибка. Пожалуйста, попробуйте позже.');
    }
};

/**
 * Проверяет статус подписки пользователя.
 * @param {object} ctx - Объект контекста Telegraf.
 */
exports.checkSubscriptionStatus = async (ctx) => {
    const userId = ctx.from.id;
    try {
        const user = await User.findOne({ userId });
        await ctx.answerCbQuery();

        if (!user || user.status !== 'active') {
            return ctx.reply('❌ Ваша подписка неактивна. Чтобы получить доступ, оплатите подписку.');
        }

        const now = new Date();
        const timeLeft = user.expireDate - now;

        if (timeLeft > 0) {
            await ctx.reply(
                `✅ *Ваша подписка активна!*` +
                `\n\nСрок действия: *${formatDate(user.expireDate, true)}*` +
                `\nОсталось: *${formatDuration(timeLeft)}*`,
                { parse_mode: 'Markdown' }
            );
        } else {
            // Если дата истечения в прошлом, но статус 'active', обновляем его
            user.status = 'inactive';
            await user.save();
            await ctx.reply('❌ Ваша подписка истекла. Пожалуйста, продлите её.');
        }

    } catch (error) {
        console.error('Ошибка в checkSubscriptionStatus:', error);
        await ctx.reply('⚠️ Произошла ошибка при проверке статуса.');
    }
};

/**
 * Запускает процесс продления подписки, отправляя реквизиты.
 * @param {object} ctx - Объект контекста Telegraf.
 */
exports.extendSubscription = async (ctx) => {
    const userId = ctx.from.id;
    const { first_name, username } = ctx.from;
    const name = first_name || username;

    try {
        // Убедимся, что мы отвечаем на колбэк
        await ctx.answerCbQuery();
        await ctx.reply(
            `*Чтобы продлить или оплатить подписку, переведите ${process.env.VPN_PRICE} руб. по реквизитам ниже:*\n\n` +
            paymentDetails(userId, name) +
            `\n\n*После оплаты отправьте скриншот сюда. Администратор проверит его и активирует вашу подписку.*`,
            {
                parse_mode: 'Markdown',
                disable_web_page_preview: true
            }
        );
    } catch (error) {
        console.error('Ошибка в extendSubscription:', error);
        await ctx.reply('⚠️ Произошла ошибка при отправке реквизитов.');
    }
};

/**
 * Предлагает пользователю задать вопрос.
 * @param {object} ctx - Объект контекста Telegraf.
 */
exports.promptForQuestion = async (ctx) => {
    try {
        await ctx.answerCbQuery('✍️ Теперь напишите ваш вопрос.');
        await ctx.reply('✍️ Напишите ваш вопрос, и я перешлю его администратору.');
    } catch (error) {
        console.error('Ошибка в promptForQuestion:', error);
    }
};

// Функция requestVpnInfo была удалена, так как отправка видео теперь автоматизирована в paymentController.js
// и не требует ручного запроса пользователя.

/**
 * Обрабатывает нажатие пользователем кнопки "Успешно настроил".
 * @param {object} ctx - Объект контекста Telegraf.
 */
exports.handleVpnConfigured = async (ctx) => {
    const userId = parseInt(ctx.match[1]);
    try {
        const user = await User.findOneAndUpdate({ userId }, { vpnConfigured: true }, { new: true });
        
        // НОВОЕ: Оповещение для админа
        let userName = user?.firstName || user?.username || 'Без имени';
        if (user?.username) {
            userName = `${userName} (@${user.username})`;
        }
        await ctx.telegram.sendMessage(
            process.env.ADMIN_ID,
            `🎉 *Пользователь успешно настроил VPN!* 🎉\n\n` +
            `Пользователь ${userName} (ID: ${userId}) нажал кнопку "Успешно настроил".`
        );

        await ctx.answerCbQuery('✅ Отлично!');
        await ctx.reply('Поздравляем! VPN успешно настроен. Приятного пользования!');
        // Удаляем кнопки, чтобы не засорять чат
        await ctx.deleteMessage().catch(e => console.error("Could not delete message:", e));
    } catch (error) {
        console.error(`Ошибка при обработке vpn_configured для пользователя ${userId}:`, error);
        await ctx.answerCbQuery('⚠️ Произошла ошибка.');
    }
};

/**
 * Обрабатывает нажатие пользователем кнопки "Не справился с настройкой".
 * @param {object} ctx - Объект контекста Telegraf.
 */
exports.promptVpnFailure = async (ctx) => {
    const userId = parseInt(ctx.match[1]);
    try {
        await ctx.answerCbQuery('✍️ Пожалуйста, опишите вашу проблему.');
        await ctx.reply('Пожалуйста, подробно опишите, с чем возникли трудности при настройке VPN. Я перешлю ваше сообщение администратору.');
        // Сохраняем в сессию, что ждем описание проблемы от этого пользователя
        ctx.session.awaitingVpnTroubleshoot = userId;
    } catch (error) {
        console.error(`Ошибка при обработке vpn_failed для пользователя ${userId}:`, error);
        await ctx.answerCbQuery('⚠️ Произошла ошибка.');
    }
};

/**
 * Обрабатывает запрос пользователя на отмену подписки.
 * @param {object} ctx - Объект контекста Telegraf.
 */
exports.promptCancelSubscription = async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.reply(
        'Вы уверены, что хотите отменить подписку?\n\n' +
        'Отмена подписки приведёт к потере доступа к VPN. ' +
        'Возможно, вам лучше просто не продлевать её по истечении срока?',
        Markup.inlineKeyboard([
            [
                Markup.button.callback('❌ Да, отменить', 'cancel_subscription_final'),
                Markup.button.callback('✅ Нет, оставить', 'cancel_subscription_abort')
            ]
        ])
    );
};

/**
 * Финальное подтверждение отмены подписки.
 * @param {object} ctx - Объект контекста Telegraf.
 */
exports.cancelSubscriptionFinal = async (ctx) => {
    const userId = ctx.from.id;
    await ctx.answerCbQuery('Подписка отменена.');
    await User.findOneAndUpdate({ userId }, { status: 'inactive' });
    await ctx.reply('Ваша подписка отменена. Доступ к VPN будет прекращен.');
    // TODO: Добавить логику для отзыва доступа на VPN-сервере
};

/**
 * Отмена запроса на отмену подписки.
 * @param {object} ctx - Объект контекста Telegraf.
 */
exports.cancelSubscriptionAbort = async (ctx) => {
    await ctx.answerCbQuery('Отмена отменена.');
    await ctx.reply('Отлично! Ваша подписка остаётся активной.');
};