const cron = require('node-cron');
const User = require('../models/User');
const Question = require('../models/Question');
const { paymentDetails, formatDate } = require('../utils/helpers');
const { revokeVpnClient } = require('./vpnService');

/**
 * Проверяет вопросы, на которые не было отвечено.
 */
const checkUnansweredQuestions = async (bot) => {
    try {
        const now = new Date();
        const urgentQuestions = await Question.countDocuments({
            status: 'pending',
            createdAt: { $lt: new Date(now.getTime() - 86400000) }
        });

        if (urgentQuestions > 0) {
            await bot.telegram.sendMessage(
                process.env.ADMIN_ID,
                `🚨 Срочно! ${urgentQuestions} вопросов ждут ответа более 24 часов!`
            );
            console.log(`[Cron] Отправлено экстренное напоминание админу о ${urgentQuestions} срочных вопросах.`);
        }
    } catch (err) {
        console.error('[Cron] Ошибка в задаче экстренных напоминаний:', err);
    }
};

/**
 * Отправляет напоминания о скором истечении подписки.
 */
const checkExpiringSubscriptions = async (bot) => {
    try {
        const now = new Date();
        const expiringUsers = await User.find({
            status: 'active',
            expireDate: {
                $lte: new Date(now.getTime() + process.env.REMIND_DAYS * 86400000),
                $gt: now
            },
            $or: [
                { lastReminder: { $exists: false } },
                { lastReminder: { $lt: new Date(now.getTime() - 86400000) } }
            ]
        });

        console.log(`[Cron] Найдено ${expiringUsers.length} пользователей с истекающей подпиской.`);

        for (const user of expiringUsers) {
            try {
                const daysLeft = Math.ceil((user.expireDate - now) / 86400000);
                await bot.telegram.sendMessage(
                    user.userId,
                    `⚠️ *Ваша подписка истекает через ${daysLeft} дней!*\n\n` +
                    `Продлите VPN за ${process.env.VPN_PRICE} руб.\n\n` +
                    paymentDetails(user.userId, user.firstName || user.username),
                    { parse_mode: 'Markdown', disable_web_page_preview: true }
                );

                await User.updateOne(
                    { userId: user.userId },
                    { lastReminder: now }
                );
                console.log(`[Cron] Отправлено напоминание пользователю ${user.userId}.`);
            } catch (e) {
                console.error(`[Cron] Ошибка напоминания для ${user.userId}:`, e.message);
            }
        }
    } catch (err) {
        console.error('[Cron] Ошибка в ежедневной задаче напоминаний:', err);
    }
};

/**
 * Проверяет истекшие подписки и отзывает доступ.
 */
const checkExpiredSubscriptions = async (bot) => {
    try {
        const now = new Date();
        console.log(`[Cron] Проверка истекших подписок. Текущее время: ${now.toISOString()}`);

        const expiredUsers = await User.find({
            status: 'active',
            expireDate: { $lte: now }
        });

        console.log(`[Cron] Найдено ${expiredUsers.length} пользователей с истекшей подпиской.`);

        if (expiredUsers.length > 0) {
            console.log('[Cron] Данные истекших пользователей:', expiredUsers.map(u => ({ userId: u.userId, expireDate: u.expireDate })));
        }

        for (const user of expiredUsers) {
            try {
                await User.updateOne(
                    { userId: user.userId },
                    { status: 'inactive' }
                );
                console.log(`[Cron] Подписка пользователя ${user.userId} истекла, статус изменен на 'inactive'.`);

                await bot.telegram.sendMessage(
                    user.userId,
                    '❌ *Ваша подписка истекла!* Доступ к VPN был отключён.\n\n' +
                    'Чтобы продолжить пользоваться сервисом, пожалуйста, оплатите подписку.',
                    { parse_mode: 'Markdown' }
                );

                try {
                    const clientName = user.vpnClientName;
                    if (clientName) {
                        await revokeVpnClient(clientName);
                        console.log(`[Cron] VPN-клиент "${clientName}" успешно отозван.`);
                    } else {
                        console.warn(`[Cron] У пользователя ${user.userId} нет сохранённого имени VPN-клиента.`);
                        await bot.telegram.sendMessage(
                            process.env.ADMIN_ID,
                            `⚠️ *Внимание:* У пользователя ${user.userId} нет сохранённого имени VPN-клиента. Не удалось отозвать доступ.`
                        );
                    }
                } catch (vpnError) {
                    console.error(`[Cron] Ошибка при отзыве VPN-клиента для ${user.userId}:`, vpnError);
                    await bot.telegram.sendMessage(
                        process.env.ADMIN_ID,
                        `🚨 *Ошибка:* Не удалось отозвать VPN-клиента для пользователя ${user.userId}.`
                    );
                }

            } catch (e) {
                console.error(`[Cron] Ошибка при обработке истекшей подписки для ${user.userId}:`, e.message);
            }
        }
    } catch (err) {
        console.error('[Cron] Ошибка в задаче обработки истекших подписок:', err);
    }
};

exports.setupReminders = (bot) => {
    cron.schedule('0 10 * * *', () => checkExpiringSubscriptions(bot));
    cron.schedule('0 */3 * * *', () => checkUnansweredQuestions(bot));
    cron.schedule('*/1 * * * *', () => checkExpiredSubscriptions(bot));
    console.log('✅ Напоминания cron запланированы.');
};