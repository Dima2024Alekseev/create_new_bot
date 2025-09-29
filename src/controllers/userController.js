const User = require('../models/User');
const Question = require('../models/Question');
const { Markup } = require('telegraf');
const { formatDate, formatDuration, paymentDetails, transliterate, escapeMarkdownV2 } = require('../utils/helpers');
const { createVpnClient, revokeVpnClient, enableVpnClient } = require('../services/vpnService');
const path = require('path');
const fs = require('fs').promises;

// Функция для экранирования специальных символов в MarkdownV2
function escapeMarkdownV2(text) {
    if (!text) return '';
    return text.replace(/([_*[\]()~`>#+\-=|{}.!])/g, '\\$1');
}

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
                statusText = '❌ *Ваша подписка истекла\\.*\n\nЧтобы получить доступ к VPN, пожалуйста, оплатите подписку\\.\n\nЕсли у вас есть вопросы \\- просто напишите сообщение, и администратор ответит вам\\.';
                keyboardButtons.push(
                    [{ text: '💰 Оплатить подписку', callback_data: 'extend_subscription' }]
                );
            } else {
                const timeLeft = expireDate - now;
                const daysLeft = Math.ceil(timeLeft / (1000 * 60 * 60 * 24));
                const duration = formatDuration(timeLeft);
                statusText = `✅ *Ваша подписка активна\\!* Осталось ещё *${escapeMarkdownV2(duration)}*\\.`;

                if (daysLeft < 7) {
                    statusText += `\n\n⚠️ Ваша подписка скоро истекает\\. Чтобы продлить её, нажмите кнопку ниже\\.`;
                }

                keyboardButtons.push(
                    [{ text: '💰 Продлить подписку', callback_data: 'extend_subscription' }],
                    [{ text: '🗓 Посмотреть срок действия подписки', callback_data: 'check_subscription' }],
                    [{ text: '⭐ Оставить отзыв о VPN', callback_data: 'leave_review' }],
                    [{ text: '❌ Отменить подписку', callback_data: 'cancel_subscription_confirm' }]
                );
            }
        } else if (user.status === 'inactive') {
            statusText = '❌ *Ваша подписка неактивна\\.*\n\nЧтобы получить доступ к VPN, пожалуйста, оплатите подписку\\.';
            keyboardButtons.push(
                [{ text: '💰 Оплатить подписку', callback_data: 'extend_subscription' }]
            );
            if (!user.trialUsed) {
                keyboardButtons.push(
                    [{ text: '🆓 Пробный доступ \\(1 час\\)', callback_data: 'request_trial' }]
                );
            }
        } else if (user.status === 'pending') {
            statusText = '⏳ *Ваш платёж на проверке\\.* Пожалуйста, подождите, пока администратор подтвердит его\\.';
            keyboardButtons.push(
                [{ text: '❓ Задать вопрос', callback_data: 'ask_question' }]
            );
        } else if (user.status === 'rejected') {
            statusText = '❌ *Ваш платёж был отклонён\\.*\n\nПожалуйста, отправьте скриншот ещё раз, убедившись в правильности данных\\.';
            keyboardButtons.push(
                [{ text: '💰 Оплатить подписку', callback_data: 'extend_subscription' }]
            );
            if (!user.trialUsed) {
                keyboardButtons.push(
                    [{ text: '🆓 Пробный доступ \\(1 час\\)', callback_data: 'request_trial' }]
                );
            }
        }

        await ctx.reply(
            `👋 Привет, *${escapeMarkdownV2(user.firstName)}*\\! Я бот для управления VPN\\.\n\n${statusText}`,
            {
                parse_mode: 'MarkdownV2',
                reply_markup: {
                    inline_keyboard: keyboardButtons
                }
            }
        );

    } catch (error) {
        console.error('Ошибка в handleStart:', error);
        await ctx.reply('⚠️ Произошла ошибка\\. Пожалуйста, попробуйте позже\\.', { parse_mode: 'MarkdownV2' });
    }
};

exports.checkSubscriptionStatus = async (ctx) => {
    const userId = ctx.from.id;
    try {
        const user = await User.findOne({ userId });
        await ctx.answerCbQuery();

        if (!user || user.status !== 'active') {
            return ctx.reply('❌ Ваша подписка неактивна\\. Чтобы получить доступ, оплатите подписку\\.', { parse_mode: 'MarkdownV2' });
        }

        const now = new Date();
        const timeLeft = user.expireDate - now;

        if (timeLeft > 0) {
            const duration = formatDuration(timeLeft);
            await ctx.reply(
                `✅ *Ваша подписка активна\\!*` +
                `\n\nСрок действия: *${escapeMarkdownV2(formatDate(user.expireDate, true))}*` +
                `\nОсталось: *${escapeMarkdownV2(duration)}*`,
                { parse_mode: 'MarkdownV2' }
            );
        } else {
            user.status = 'inactive';
            await user.save();
            await ctx.reply('❌ Ваша подписка истекла\\. Пожалуйста, продлите её\\.', { parse_mode: 'MarkdownV2' });
        }

    } catch (error) {
        console.error('Ошибка в checkSubscriptionStatus:', error);
        await ctx.reply('⚠️ Произошла ошибка при проверке статуса\\.', { parse_mode: 'MarkdownV2' });
    }
};

exports.extendSubscription = async (ctx) => {
    const userId = ctx.from.id;
    const { first_name, username } = ctx.from;
    const name = first_name || username;

    try {
        await ctx.answerCbQuery();
        const paymentMessage = await paymentDetails(userId, name);
        await ctx.reply(
            escapeMarkdownV2(paymentMessage) +
            `\n\n*После оплаты отправьте скриншот сюда\\. Администратор проверит его и активирует вашу подписку\\.*`,
            {
                parse_mode: 'MarkdownV2',
                disable_web_page_preview: true
            }
        );
        ctx.session.awaitingPaymentProof = true;
    } catch (error) {
        console.error('Ошибка в extendSubscription:', error);
        await ctx.reply('⚠️ Произошла ошибка при отправке реквизитов\\.', { parse_mode: 'MarkdownV2' });
    }
};

exports.promptForQuestion = async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.reply('✍️ Напишите ваш вопрос\\. Администратор ответит на него в ближайшее время\\.', { parse_mode: 'MarkdownV2' });
};

exports.promptCancelSubscription = async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.reply(
        'Вы уверены, что хотите отменить подписку\\?\n\n' +
        'Отмена подписки приведёт к потере доступа к VPN\\. ' +
        'Возможно, вам лучше просто не продлевать её по истечении срока\\?',
        {
            parse_mode: 'MarkdownV2',
            reply_markup: Markup.inlineKeyboard([
                [
                    Markup.button.callback('❌ Да, отменить', 'cancel_subscription_final'),
                    Markup.button.callback('✅ Нет, оставить', 'cancel_subscription_abort')
                ]
            ])
        }
    );
};

exports.cancelSubscriptionFinal = async (ctx) => {
    const userId = ctx.from.id;
    const { first_name, username } = ctx.from;
    const name = first_name || username || `Пользователь ${userId}`;

    try {
        const user = await User.findOne({ userId });

        if (!user) {
            await ctx.answerCbQuery('❌ Пользователь не найден\\.');
            return ctx.editMessageText('Ошибка: пользователь не найден\\.', { parse_mode: 'MarkdownV2' });
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

        await ctx.answerCbQuery('✅ Подписка отменена\\.');
        await ctx.editMessageText('Ваша подписка отменена\\. Доступ к VPN прекращён\\.', { parse_mode: 'MarkdownV2' });

        await ctx.telegram.sendMessage(
            process.env.ADMIN_ID,
            `🔔 *Оповещение:* Пользователь *${escapeMarkdownV2(name)}* \\(ID: ${userId}\\) отменил подписку\\.\n` +
            `VPN\\-клиент *${escapeMarkdownV2(user.vpnClientName || 'не указан')}* отключён\\.`,
            { parse_mode: 'MarkdownV2' }
        );

    } catch (error) {
        console.error(`Ошибка при отмене подписки (ID: ${userId}):`, error);
        await ctx.answerCbQuery('⚠️ Ошибка при отмене подписки\\!');
        await ctx.reply('Произошла ошибка\\. Попробуйте позже или свяжитесь с админом\\.', { parse_mode: 'MarkdownV2' });
    }
};

exports.cancelSubscriptionAbort = async (ctx) => {
    await ctx.answerCbQuery('Отмена отменена\\.');
    await ctx.editMessageText('Отлично\\! Ваша подписка остаётся активной\\. Вы можете проверить её статус в главном меню \\(/start\\)\\.', { parse_mode: 'MarkdownV2' });
};

exports.handleVpnConfigured = async (ctx) => {
    const userId = ctx.match[1];
    const user = await User.findOne({ userId });
    const name = user?.firstName || user?.username || `Пользователь ${userId}`;

    await ctx.answerCbQuery('Отлично\\!');
    await ctx.editMessageText(
        'Отлично\\! Приятного пользования\\.✌️\n\n' +
        'Если у вас есть вопросы — просто напишите мне\\! Нажмите на кнопку ниже, и я помогу 😊',
        {
            parse_mode: 'MarkdownV2',
            reply_markup: Markup.inlineKeyboard([
                [Markup.button.callback('❓ Задать вопрос', 'ask_question')]
            ])
        }
    );

    try {
        await ctx.telegram.sendMessage(
            process.env.ADMIN_ID,
            `✅ *Оповещение:* Пользователь *${escapeMarkdownV2(name)}* \\(ID: ${userId}\\) успешно настроил VPN\\.`,
            { parse_mode: 'MarkdownV2' }
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
        'Опишите, пожалуйста, вашу проблему с настройкой\\. Это поможет администратору быстрее найти решение\\.',
        { parse_mode: 'MarkdownV2' }
    );
};

exports.handleTrialRequest = async (ctx) => {
    const userId = ctx.from.id;
    const { first_name, username } = ctx.from;

    try {
        let user = await User.findOne({ userId });
        if (!user) {
            // Если пользователь новый, создаем
            user = new User({ userId, firstName: first_name, username });
            await user.save();
        }

        if (user.trialUsed) {
            return ctx.reply('⚠️ Вы уже использовали пробный доступ\\. Для полного доступа оплатите подписку \\(/start\\)\\.', { parse_mode: 'MarkdownV2' });
        }

        if (user.status === 'active') {
            return ctx.reply('⚠️ У вас уже активная подписка\\. Пробный доступ доступен только новым пользователям\\.', { parse_mode: 'MarkdownV2' });
        }

        // Создаем временного VPN-клиента с базовым именем 'trial'
        const baseName = 'trial';
        const { config, clientName } = await createVpnClient(baseName);

        // Обновляем пользователя
        const now = new Date();
        user.trialUsed = true;
        user.trialClientName = clientName;
        user.trialStart = now;
        user.trialExpire = new Date(now.getTime() + 60 * 60 * 1000); // 1 час
        await user.save();

        // Создаем папку configs, если она не существует
        const configDir = path.join(__dirname, '..', 'configs');
        await fs.mkdir(configDir, { recursive: true });

        // Отправляем конфиг пользователю
        const configPath = path.join(configDir, `${clientName}.conf`);
        await fs.writeFile(configPath, config);
        await ctx.telegram.sendDocument(userId, { source: configPath, filename: `${clientName}.conf` });

        // Отправляем видеоинструкцию
        const videoPath = path.join(__dirname, '..', 'videos', 'instruction.mp4');
        await ctx.telegram.sendVideo(userId, { source: videoPath, filename: 'instruction.mp4' }, {
            caption: '📹 *Видеоинструкция по настройке VPN*\n\nСледуйте инструкциям в видео для настройки конфигурации\\.',
            parse_mode: 'MarkdownV2'
        });

        await ctx.reply(
            '🆓 *Пробный доступ выдан на 1 час\\!*' +
            '\n\nСкачайте файл конфигурации и следуйте видеоинструкции выше для настройки VPN\\. Через 1 час доступ отключится автоматически\\.' +
            '\n\nЕсли всё понравится, оплатите полную подписку в меню \\(/start\\)\\.',
            { parse_mode: 'MarkdownV2' }
        );

        // Формируем текст уведомления для админа
        const adminMessage = `🔔 *Пробный доступ выдан:* Пользователь *${escapeMarkdownV2(first_name || username)}* \\(ID: ${userId}\\), клиент: ${escapeMarkdownV2(clientName)}\\. Истекает: ${escapeMarkdownV2(formatDate(user.trialExpire, true))}`;
        console.log('[DEBUG] Текст уведомления админа:', adminMessage);

        // Уведомляем админа
        await ctx.telegram.sendMessage(
            process.env.ADMIN_ID,
            adminMessage,
            { parse_mode: 'MarkdownV2' }
        );

        // Удаляем файл конфигурации после отправки
        await fs.unlink(configPath);

    } catch (error) {
        console.error(`Ошибка при выдаче пробного доступа для ${userId}:`, error);
        await ctx.reply('⚠️ Произошла ошибка при выдаче пробного доступа\\. Свяжитесь с админом\\.', { parse_mode: 'MarkdownV2' });
        await ctx.telegram.sendMessage(
            process.env.ADMIN_ID,
            `🚨 *Ошибка пробного VPN для* ${escapeMarkdownV2(userId.toString())}: ${escapeMarkdownV2(error.message)}`,
            { parse_mode: 'MarkdownV2' }
        );
    }
};