const User = require('../models/User');
const Question = require('../models/Question');
const { Markup } = require('telegraf');
const { formatDate, formatDuration, paymentDetails } = require('../utils/helpers');
const { createVpnClient } = require('../services/vpnService');
const path = require('path');

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
            const now = new Date();
            let expireDate = user.expireDate;

            if (expireDate && expireDate < now) {
                user.status = 'inactive';
                await user.save();
                statusText = '❌ *Ваша подписка истекла.*\n\nЧтобы получить доступ к VPN, пожалуйста, оплатите подписку.';
                keyboardButtons.push(
                    [{ text: '💰 Оплатить подписку', callback_data: 'extend_subscription' }]
                );
            } else {
                const timeLeft = expireDate - now;
                const daysLeft = Math.ceil(timeLeft / (1000 * 60 * 60 * 24));
                const duration = formatDuration(timeLeft);
                statusText = `✅ *Ваша подписка активна!* Осталось ещё *${duration}*.\n`;

                if (daysLeft < 7) {
                    statusText += `\n⚠️ Ваша подписка скоро истекает. Чтобы продлить её, нажмите кнопку ниже.\n`;
                }

                keyboardButtons.push(
                    [{ text: '💰 Продлить подписку', callback_data: 'extend_subscription' }],
                    [{ text: '🗓 Посмотреть срок действия подписки', callback_data: 'check_subscription' }],
                    [{ text: '❌ Отменить подписку', callback_data: 'cancel_subscription_confirm' }]
                );
            }
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

        // ⚠️ ИСПРАВЛЕНО: Эта строка удалена, так как дублировала кнопку "Задать вопрос".
        // keyboardButtons.push([{ text: '❓ Задать вопрос', callback_data: 'ask_question' }]);

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
            const duration = formatDuration(timeLeft);
            await ctx.reply(
                `✅ *Ваша подписка активна!*` +
                `\n\nСрок действия: *${formatDate(user.expireDate, true)}*` +
                `\nОсталось: *${duration}*`,
                { parse_mode: 'Markdown' }
            );
        } else {
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
        ctx.session.awaitingPaymentProof = true;
    } catch (error) {
        console.error('Ошибка в extendSubscription:', error);
        await ctx.reply('⚠️ Произошла ошибка при отправке реквизитов.');
    }
};

/**
 * Отправляет пользователю сообщение с предложением задать вопрос.
 * @param {object} ctx - Объект контекста Telegraf.
 */
exports.promptForQuestion = async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.reply('✍️ Напишите ваш вопрос. Администратор ответит на него в ближайшее время.');
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
    const { first_name, username } = ctx.from;
    const name = first_name || username || `Пользователь ${userId}`;

    try {
        await User.findOneAndUpdate({ userId }, { status: 'inactive', expireDate: null });

        await ctx.answerCbQuery('Подписка отменена.');
        await ctx.editMessageText('Ваша подписка отменена. Доступ к VPN будет прекращен.');

        await ctx.telegram.sendMessage(
            process.env.ADMIN_ID,
            `🔔 *Оповещение:* Пользователь *${name}* (ID: ${userId}) отменил подписку.`,
            { parse_mode: 'Markdown' }
        );

    } catch (error) {
        console.error(`Ошибка при финальной отмене подписки для пользователя ${userId}:`, error);
        await ctx.answerCbQuery('⚠️ Произошла ошибка при отмене подписки.');
        await ctx.reply('Произошла ошибка при отмене подписки.');
    }
};

/**
 * Отмена запроса на отмену подписки.
 * @param {object} ctx - Объект контекста Telegraf.
 */
exports.cancelSubscriptionAbort = async (ctx) => {
    await ctx.answerCbQuery('Отмена отменена.');
    await ctx.editMessageText('Отлично! Ваша подписка остаётся активной. Вы можете проверить её статус в главном меню (/start).');
};

/**
 * Обрабатывает ситуацию, когда пользователь подтвердил, что VPN настроен успешно.
 * @param {object} ctx - Объект контекста Telegraf.
 */
exports.handleVpnConfigured = async (ctx) => {
    const userId = ctx.match[1];
    const user = await User.findOne({ userId });
    const name = user?.firstName || user?.username || `Пользователь ${userId}`;

    await ctx.answerCbQuery('Отлично!');
    await ctx.editMessageText(
        'Отлично! Приятного пользования.✌️\n\n' +
        'Если у вас есть вопросы — просто напишите мне! Нажмите на кнопку ниже, и я помогу 😊',
        Markup.inlineKeyboard([
            [Markup.button.callback('❓ Задать вопрос', 'ask_question')]
        ])
    );

    try {
        await ctx.telegram.sendMessage(
            process.env.ADMIN_ID,
            `✅ *Оповещение:* Пользователь *${name}* (ID: ${userId}) успешно настроил VPN.`,
            { parse_mode: 'Markdown' }
        );
    } catch (error) {
        console.error(`Ошибка при отправке оповещения администратору о настройке VPN для пользователя ${userId}:`, error);
    }
};

/**
 * Отправляет администратору сообщение о проблеме с настройкой VPN.
 * @param {object} ctx - Объект контекста Telegraf.
 */
exports.promptVpnFailure = async (ctx) => {
    const userId = ctx.from.id;
    await ctx.answerCbQuery();
    ctx.session.awaitingVpnTroubleshoot = userId;
    await ctx.reply(
        'Опишите, пожалуйста, вашу проблему с настройкой. ' +
        'Это поможет администратору быстрее найти решение.'
    );
};