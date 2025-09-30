const cron = require('node-cron');
const User = require('../models/User');
const Question = require('../models/Question');
const { paymentDetails, formatDate } = require('../utils/helpers');
const { revokeVpnClient, deleteVpnClient } = require('./vpnService');

// Установка часового пояса для Красноярска (GMT+7)
process.env.TZ = 'Asia/Krasnoyarsk';

/**
 * Проверяет неотвеченные вопросы старше 24 часов
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
                `🚨 *Срочно!* ${urgentQuestions} вопросов ждут ответа более 24 часов!`,
                { parse_mode: 'Markdown' }
            );
            console.log(`[Cron][${now.toLocaleString('ru-RU', { timeZone: 'Asia/Krasnoyarsk' })}] Уведомление администратору о ${urgentQuestions} вопросах.`);
        }
    } catch (err) {
        console.error('[Cron] Ошибка проверки вопросов:', err);
    }
};

/**
 * Напоминает о подписках, истекающих через REMIND_DAYS дней
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

        console.log(`[Cron][${now.toLocaleString('ru-RU', { timeZone: 'Asia/Krasnoyarsk' })}] Найдено ${expiringUsers.length} пользователей для напоминания.`);

        for (const user of expiringUsers) {
            try {
                const daysLeft = Math.ceil((user.expireDate - now) / 86400000);
                const paymentMessage = await paymentDetails(user.userId, user.firstName || user.username);

                await bot.telegram.sendMessage(
                    user.userId,
                    `⚠️ *Ваша подписка истекает через ${daysLeft} дней!*\n\n` + paymentMessage,
                    { parse_mode: 'Markdown', disable_web_page_preview: true }
                );

                await User.updateOne(
                    { userId: user.userId },
                    { lastReminder: now }
                );
            } catch (e) {
                console.error(`Ошибка уведомления для ${user.userId}:`, e.message);
            }
        }
    } catch (err) {
        console.error('[Cron] Ошибка проверки подписок:', err);
    }
};

/**
 * Отключает истекшие подписки
 */
const checkExpiredSubscriptions = async (bot) => {
    try {
        const now = new Date();
        const expiredUsers = await User.find({
            status: 'active',
            expireDate: { $lte: now }
        });

        console.log(`[Cron][${now.toLocaleString('ru-RU', { timeZone: 'Asia/Krasnoyarsk' })}] Найдено ${expiredUsers.length} истекших подписок.`);

        for (const user of expiredUsers) {
            try {
                await User.updateOne(
                    { userId: user.userId },
                    { status: 'inactive' }
                );

                await bot.telegram.sendMessage(
                    user.userId,
                    '❌ *Ваша подписка истекла!* Доступ к VPN отключён.\n\n' +
                    'Для продления оплатите подписку.',
                    { parse_mode: 'Markdown' }
                );

                if (user.vpnClientName) {
                    await revokeVpnClient(user.vpnClientName);
                    console.log(`Отозван доступ для ${user.userId} (${user.vpnClientName})`);
                } else {
                    console.warn(`Нет данных VPN для ${user.userId}`);
                    await bot.telegram.sendMessage(
                        process.env.ADMIN_ID,
                        `⚠️ У пользователя ${user.userId} нет VPN-клиента`,
                        { parse_mode: 'Markdown' }
                    );
                }
            } catch (e) {
                console.error(`Ошибка обработки для ${user.userId}:`, e.message);
            }
        }
    } catch (err) {
        console.error('[Cron] Ошибка отключения подписок:', err);
    }
};

/**
 * Проверяет истекшие пробные доступы
 */
const checkExpiredTrials = async (bot) => {
    try {
        const now = new Date();
        const expiredTrials = await User.find({
            trialUsed: true,
            trialExpire: { $lte: now },
            trialClientName: { $ne: null }
        });

        console.log(`[Cron] Найдено ${expiredTrials.length} истекших пробных доступов.`);

        for (const user of expiredTrials) {
            try {
                await deleteVpnClient(user.trialClientName);

                user.trialClientName = null;
                user.trialExpire = null;
                await user.save();

                await bot.telegram.sendMessage(
                    user.userId,
                    '⏰ *Пробный доступ истёк!* Если вам понравилось, оплатите подписку в меню (/start).',
                    { parse_mode: 'Markdown' }
                );

                await bot.telegram.sendMessage(
                    process.env.ADMIN_ID,
                    `🔔 *Пробный доступ истёк для:* ${user.firstName || user.username} (ID: ${user.userId})`,
                    { parse_mode: 'Markdown' }
                );

            } catch (e) {
                console.error(`Ошибка удаления trial для ${user.userId}:`, e);
                await bot.telegram.sendMessage(
                    process.env.ADMIN_ID,
                    `🚨 Ошибка удаления trial для ${user.userId}: ${e.message}`,
                    { parse_mode: 'Markdown' }
                );
            }
        }
    } catch (err) {
        console.error('[Cron] Ошибка проверки trial:', err);
    }
};

/**
 * Удаляет неактивных пользователей и пользователей с истёкшей подпиской
 */
const cleanInactiveUsers = async (bot) => {
    try {
        const now = new Date();
        const deletionThreshold = new Date(now.getTime() - 5 * 60 * 1000); // 5 минут назад для тестирования

        // Пользователи без подписки, не взаимодействовавшие 5 минут
        const inactiveUsers = await User.find({
            status: { $in: ['inactive', 'pending', 'rejected'] },
            lastInteraction: { $lte: deletionThreshold },
            subscriptionCount: 0,
            expireDate: null
        });

        // Пользователи с истёкшей подпиской, не продлившие 5 минут
        const expiredSubscriptionUsers = await User.find({
            status: 'inactive',
            subscriptionCount: { $gt: 0 },
            expireDate: { $lte: deletionThreshold },
            lastInteraction: { $lte: deletionThreshold }
        });

        console.log(`[Cron][${now.toLocaleString('ru-RU', { timeZone: 'Asia/Krasnoyarsk' })}] Найдено ${inactiveUsers.length} неактивных пользователей и ${expiredSubscriptionUsers.length} пользователей с истёкшей подпиской для удаления.`);

        // Удаление неактивных пользователей (без подписки)
        for (const user of inactiveUsers) {
            try {
                if (user.trialClientName) {
                    await deleteVpnClient(user.trialClientName);
                    console.log(`[DEBUG] Удалён пробный клиент: ${user.trialClientName} для ${user.userId}`);
                }
                await User.deleteOne({ userId: user.userId });
                console.log(`[DEBUG] Удалён неактивный пользователь: ${user.userId}`);

                await bot.telegram.sendMessage(
                    process.env.ADMIN_ID,
                    `🗑 *Удалён неактивный пользователь:* ${user.firstName || user.username} (ID: ${user.userId})`,
                    { parse_mode: 'Markdown' }
                );
            } catch (e) {
                console.error(`Ошибка удаления неактивного пользователя ${user.userId}:`, e);
            }
        }

        // Удаление пользователей с истёкшей подпиской
        for (const user of expiredSubscriptionUsers) {
            try {
                if (user.vpnClientName) {
                    await deleteVpnClient(user.vpnClientName);
                    console.log(`[DEBUG] Удалён VPN-клиент: ${user.vpnClientName} для ${user.userId}`);
                }
                if (user.trialClientName) {
                    await deleteVpnClient(user.trialClientName);
                    console.log(`[DEBUG] Удалён пробный клиент: ${user.trialClientName} для ${user.userId}`);
                }
                await User.deleteOne({ userId: user.userId });
                console.log(`[DEBUG] Удалён пользователь с истёкшей подпиской: ${user.userId}`);

                await bot.telegram.sendMessage(
                    process.env.ADMIN_ID,
                    `🗑 *Удалён пользователь с истёкшей подпиской:* ${user.firstName || user.username} (ID: ${user.userId})`,
                    { parse_mode: 'Markdown' }
                );
            } catch (e) {
                console.error(`Ошибка удаления пользователя с истёкшей подпиской ${user.userId}:`, e);
            }
        }
    } catch (err) {
        console.error('[Cron] Ошибка очистки неактивных пользователей:', err);
    }
};

/**
 * Настройка расписания задач
 */
exports.setupReminders = (bot) => {
    // Ежедневно в 10:00 по Красноярску - напоминания
    cron.schedule('0 10 * * *', () => checkExpiringSubscriptions(bot), {
        timezone: 'Asia/Krasnoyarsk'
    });

    // Каждые 3 часа - проверка вопросов
    cron.schedule('0 */3 * * *', () => checkUnansweredQuestions(bot), {
        timezone: 'Asia/Krasnoyarsk'
    });

    // Каждые 6 часов - проверка истекших подписок
    cron.schedule('0 */6 * * *', () => checkExpiredSubscriptions(bot), {
        timezone: 'Asia/Krasnoyarsk'
    });

    // Каждые 10 минут - проверка истекших пробных доступов
    cron.schedule('0 */10 * * * *', () => checkExpiredTrials(bot), {
        timezone: 'Asia/Krasnoyarsk'
    });

    // Каждые 5 минут - очистка неактивных пользователей (для тестирования)
    cron.schedule('*/5 * * * * *', () => cleanInactiveUsers(bot), {
        timezone: 'Asia/Krasnoyarsk'
    });

    console.log('✅ Cron-задачи настроены для GMT+7 (Красноярск)');
    console.log('Расписание:');
    console.log('- Напоминания: ежедневно в 10:00');
    console.log('- Вопросы: каждые 3 часа (0,3,6,9,12,15,18,21)');
    console.log('- Истекшие подписки: каждые 6 часов (0,6,12,18)');
    console.log('- Истекшие пробные доступы: каждые 10 минут');
    console.log('- Очистка неактивных пользователей: каждые 5 минут (для тестирования)');
};