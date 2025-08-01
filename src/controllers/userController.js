const User = require('../models/User');
const Question = require('../models/Question');
const { Markup } = require('telegraf');
const { formatDate, formatDuration, paymentDetails } = require('../utils/helpers');

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

        // Проверяем актуальность статуса подписки
        if (user.status === 'active' && user.expireDate && user.expireDate <= new Date()) {
            user.status = 'inactive';
            await user.save();
        }

        if (user.status === 'active') {
            const timeLeft = user.expireDate - new Date();
            const daysLeft = Math.ceil(timeLeft / (1000 * 60 * 60 * 24));
            statusText = `✅ *Подписка активна!* Осталось ${daysLeft} дней.`;
            keyboardButtons.push(
                [{ text: '💰 Продлить', callback_data: 'extend_subscription' }],
                [{ text: '🗓 Проверить статус', callback_data: 'check_subscription' }],
                [{ text: '❌ Отменить', callback_data: 'cancel_subscription_confirm' }]
            );
        } else {
            statusText = '❌ *Подписка неактивна.*\nОплатите подписку для доступа к VPN.';
            keyboardButtons.push([{ text: '💰 Оплатить', callback_data: 'extend_subscription' }]);
        }

        keyboardButtons.push([{ text: '❓ Поддержка', callback_data: 'ask_question' }]);

        await ctx.reply(
            `👋 Привет, *${user.firstName}!* Я VPN бот.\n\n${statusText}`,
            {
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: keyboardButtons }
            }
        );
    } catch (error) {
        console.error('Ошибка в handleStart:', error);
        await ctx.reply('⚠️ Ошибка. Попробуйте позже.');
    }
};

exports.checkSubscriptionStatus = async (ctx) => {
    const userId = ctx.from.id;
    try {
        const user = await User.findOne({ userId });
        if (!user) {
            return ctx.reply('❌ Пользователь не найден. Нажмите /start');
        }

        await ctx.answerCbQuery();
        const now = new Date();

        // Автоматическая деактивация при истечении срока
        if (user.status === 'active' && user.expireDate && user.expireDate <= now) {
            user.status = 'inactive';
            await user.save();
        }

        if (user.status !== 'active') {
            return ctx.reply('❌ Подписка неактивна. Оплатите подписку.');
        }

        const timeLeft = user.expireDate - now;
        const keyboardButtons = [
            [{ text: '💰 Продлить', callback_data: 'extend_subscription' }],
            [{ text: '❌ Отменить', callback_data: 'cancel_subscription_confirm' }],
            [{ text: '❓ Поддержка', callback_data: 'ask_question' }]
        ];

        await ctx.reply(
            `✅ *Подписка активна!*\n\nДействует до: *${formatDate(user.expireDate, true)}*\nОсталось: *${formatDuration(timeLeft)}*`,
            {
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: keyboardButtons }
            }
        );
    } catch (error) {
        console.error('Ошибка в checkSubscriptionStatus:', error);
        await ctx.reply('⚠️ Ошибка при проверке статуса.');
    }
};

exports.extendSubscription = async (ctx) => {
    const userId = ctx.from.id;
    const { first_name, username } = ctx.from;
    const name = first_name || username;
    try {
        await ctx.answerCbQuery();
        await ctx.reply(
            `*Для оплаты подписки (${process.env.VPN_PRICE} руб.):*\n\n` +
            paymentDetails(userId, name) +
            `\n\n*Отправьте скриншот оплаты после перевода.*`,
            {
                parse_mode: 'Markdown',
                disable_web_page_preview: true
            }
        );
    } catch (error) {
        console.error('Ошибка в extendSubscription:', error);
        await ctx.reply('⚠️ Ошибка при отправке реквизитов.');
    }
};

exports.promptForQuestion = async (ctx) => {
    try {
        await ctx.answerCbQuery('✍️ Теперь напишите ваш вопрос.');
        await ctx.reply('✍️ Напишите ваш вопрос, и я перешлю его администратору.');
    } catch (error) {
        console.error('Ошибка в promptForQuestion:', error);
    }
};

exports.handleVpnConfigured = async (ctx) => {
    const userId = parseInt(ctx.match[1]);
    try {
        const user = await User.findOneAndUpdate({ userId }, { vpnConfigured: true }, { new: true });
        
        let userName = user?.firstName || user?.username || 'Без имени';
        if (user?.username) {
            userName = `${userName} (@${user.username})`;
        }
        await ctx.telegram.sendMessage(
            process.env.ADMIN_ID,
            `🎉 *Пользователь успешно настроил VPN!*\n\nПользователь ${userName} (ID: ${userId})`
        );

        await ctx.answerCbQuery('✅ Отлично!');
        await ctx.reply('Поздравляем! VPN успешно настроен. Приятного пользования!');
        
        await ctx.deleteMessage().catch(e => console.error("Could not delete message:", e));
    } catch (error) {
        console.error(`Ошибка при обработке vpn_configured для ${userId}:`, error);
        await ctx.answerCbQuery('⚠️ Произошла ошибка.');
    }
};

exports.promptVpnFailure = async (ctx) => {
    const userId = parseInt(ctx.match[1]);
    try {
        await ctx.answerCbQuery('✍️ Пожалуйста, опишите вашу проблему.');
        await ctx.reply('Пожалуйста, подробно опишите, с чем возникли трудности при настройке VPN. Я перешлю ваше сообщение администратору.');
        
        ctx.session.awaitingVpnTroubleshoot = userId;
    } catch (error) {
        console.error(`Ошибка при обработке vpn_failed для ${userId}:`, error);
        await ctx.answerCbQuery('⚠️ Произошла ошибка.');
    }
};

exports.promptCancelSubscription = async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.reply(
        'Вы уверены, что хотите отменить подписку?\n\n' +
        'Отмена подписки приведёт к потере доступа к VPN.',
        Markup.inlineKeyboard([
            [
                Markup.button.callback('❌ Да, отменить', 'cancel_subscription_final'),
                Markup.button.callback('✅ Нет, оставить', 'cancel_subscription_abort')
            ]
        ])
    );
};

exports.cancelSubscriptionFinal = async (ctx) => {
    const userId = ctx.from.id;
    try {
        const user = await User.findOneAndUpdate(
            { userId },
            { status: 'inactive', expireDate: null },
            { new: true }
        );

        await ctx.answerCbQuery('Подписка отменена.');
        await ctx.reply('Ваша подписка отменена. Доступ к VPN будет прекращен.');
        
        let userName = user?.firstName || user?.username || 'Без имени';
        if (user?.username) {
            userName = `${userName} (@${user.username})`;
        }
        await ctx.telegram.sendMessage(
            process.env.ADMIN_ID,
            `❌ *Пользователь отменил подписку!*\n\nПользователь ${userName} (ID: ${userId})`
        );
    } catch (error) {
        console.error(`Ошибка при отмене подписки для ${userId}:`, error);
        await ctx.reply('⚠️ Ошибка при отмене подписки.');
    }
};

exports.cancelSubscriptionAbort = async (ctx) => {
    await ctx.answerCbQuery('Отмена отменена.');
    await ctx.reply('Отлично! Ваша подписка остаётся активной.');
};