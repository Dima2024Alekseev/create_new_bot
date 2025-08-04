const User = require('../models/User');
const Question = require('../models/Question');
const { Markup } = require('telegraf');
const { formatDate, formatDuration, paymentDetails } = require('../utils/helpers');
const { createVpnClient, revokeVpnClient, enableVpnClient } = require('../services/vpnService');
const path = require('path');

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
                statusText = '❌ *Ваша подписка истекла.*\n\nЧтобы получить доступ к VPN, пожалуйста, оплатите подписку.\n\nЕсли у вас есть вопросы - просто напишите сообщение, и администратор ответит вам.';
                keyboardButtons.push(
                    [{ text: '💰 Оплатить подписку', callback_data: 'extend_subscription' }],
                    [{ text: '🏠 Личный кабинет', callback_data: 'back_to_user_menu' }]
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
                    [{ text: '⭐ Оставить отзыв о VPN', callback_data: 'leave_review' }],
                    [{ text: '❌ Отменить подписку', callback_data: 'cancel_subscription_confirm' }],
                    [{ text: '🏠 Личный кабинет', callback_data: 'back_to_user_menu' }]
                );
            }
        } else if (user.status === 'inactive') {
            statusText = '❌ *Ваша подписка неактивна.*\n\nЧтобы получить доступ к VPN, пожалуйста, оплатите подписку.';
            keyboardButtons.push(
                [{ text: '💰 Оплатить подписку', callback_data: 'extend_subscription' }],
                [{ text: '🏠 Личный кабинет', callback_data: 'back_to_user_menu' }]
            );
        } else if (user.status === 'pending') {
            statusText = '⏳ *Ваш платёж на проверке.* Пожалуйста, подождите, пока администратор подтвердит его.';
            keyboardButtons.push(
                [{ text: '❓ Задать вопрос', callback_data: 'ask_question' }],
                [{ text: '🏠 Личный кабинет', callback_data: 'back_to_user_menu' }]
            );
        } else if (user.status === 'rejected') {
            statusText = '❌ *Ваш платёж был отклонён.*\n\nПожалуйста, отправьте скриншот ещё раз, убедившись в правильности данных.';
            keyboardButtons.push(
                [{ text: '💰 Оплатить подписку', callback_data: 'extend_subscription' }],
                [{ text: '🏠 Личный кабинет', callback_data: 'back_to_user_menu' }]
            );
        }

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

exports.extendSubscription = async (ctx) => {
    const userId = ctx.from.id;
    const { first_name, username } = ctx.from;
    const name = first_name || username;

    try {
        await ctx.answerCbQuery();
        const paymentMessage = await paymentDetails(userId, name);
        await ctx.replyWithMarkdown(
            paymentMessage +
            `\n\n*После оплаты отправьте скриншот сюда. Администратор проверит его и активирует вашу подписку.*`,
            {
                disable_web_page_preview: true
            }
        );
        ctx.session.awaitingPaymentProof = true;
    } catch (error) {
        console.error('Ошибка в extendSubscription:', error);
        await ctx.reply('⚠️ Произошла ошибка при отправке реквизитов.');
    }
};

exports.promptForQuestion = async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.reply('✍️ Напишите ваш вопрос. Администратор ответит на него в ближайшее время.');
};

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
            ],
            [Markup.button.callback('🏠 Личный кабинет', 'back_to_user_menu')]
        ])
    );
};

exports.cancelSubscriptionFinal = async (ctx) => {
    const userId = ctx.from.id;
    const { first_name, username } = ctx.from;
    const name = first_name || username || `Пользователь ${userId}`;

    try {
        const user = await User.findOne({ userId });

        if (!user) {
            await ctx.answerCbQuery('❌ Пользователь не найден.');
            return ctx.editMessageText('Ошибка: пользователь не найден.');
        }

        if (user.vpnClientName) {
            await revokeVpnClient(user.vpnClientName);
            console.log(`🔒 VPNmeln для ${user.vpnClientName} (ID: ${userId})`);
        }

        await User.updateOne(
            { userId },
            {
                status: 'inactive',
                expireDate: null,
                vpnConfigured: false
            }
        );

        await ctx.answerCbQuery('✅ Подписка отменена.');
        await ctx.editMessageText('Ваша подписка отменена. Доступ к VPN прекращён.');

        await ctx.telegram.sendMessage(
            process.env.ADMIN_ID,
            `🔔 *Оповещение:* Пользователь *${name}* (ID: ${userId}) отменил подписку.\n` +
            `VPN-клиент *${user.vpnClientName || 'не указан'}* отключён.`,
            { parse_mode: 'Markdown' }
        );

    } catch (error) {
        console.error(`Ошибка при отмене подписки (ID: ${userId}):`, error);
        await ctx.answerCbQuery('⚠️ Ошибка при отмене подписки!');
        await ctx.reply('Произошла ошибка. Попробуйте позже или свяжитесь с админом.');
    }
};

exports.cancelSubscriptionAbort = async (ctx) => {
    await ctx.answerCbQuery('Отмена отменена.');
    await ctx.editMessageText('Отлично! Ваша подписка остаётся активной. Вы можете проверить её статус в главном меню (/start).');
};

exports.handleVpnConfigured = async (ctx) => {
    const userId = ctx.match[1];
    const user = await User.findOne({ userId });
    const name = user?.firstName || user?.username || `Пользователь ${userId}`;

    await ctx.answerCbQuery('Отлично!');
    await ctx.editMessageText(
        'Отлично! Приятного пользования.✌️\n\n' +
        'Если у вас есть вопросы — просто напишите мне! Нажмите на кнопку ниже, и я помогу 😊',
        Markup.inlineKeyboard([
            [Markup.button.callback('❓ Задать вопрос', 'ask_question')],
            [Markup.button.callback('🏠 Личный кабинет', 'back_to_user_menu')]
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

exports.promptVpnFailure = async (ctx) => {
    const userId = ctx.from.id;
    await ctx.answerCbQuery();
    ctx.session.awaitingVpnTroubleshoot = userId;
    await ctx.reply(
        'Опишите, пожалуйста, вашу проблему с настройкой. ' +
        'Это поможет администратору быстрее найти решение.'
    );
};