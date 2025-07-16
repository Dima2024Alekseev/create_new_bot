const cron = require('node-cron');
const User = require('../models/User');
const Question = require('../models/Question');
const { paymentDetails, formatDate } = require('../utils/helpers');
const wgService = require('./wireguardService'); // НОВОЕ: Импорт wgService
const { escapeMarkdown } = require('../utils/helpers'); // Для экранирования в сообщениях админу

exports.setupReminders = (bot) => {
    // Ежедневные напоминания о скором истечении подписки в 10:00 по Москве
    cron.schedule('0 10 * * *', async () => {
        console.log('[Cron] Запуск задачи напоминаний о подписках и вопросах...');
        try {
            const now = new Date(); // Единая точка отсчета времени для этой задачи

            // 1. Напоминания о скором истечении подписки
            const REMIND_DAYS_MS = parseInt(process.env.REMIND_DAYS || '3') * 86400000;

            const expiringUsers = await User.find({
                status: 'active',
                expireDate: {
                    $lte: new Date(now.getTime() + REMIND_DAYS_MS), // Дата истечения <= (сейчас + REMIND_DAYS дней)
                    $gt: now                                       // Дата истечения > (сейчас)
                },
                $or: [
                    { lastReminder: { $exists: false } },          // Напоминание еще не отправлялось
                    { lastReminder: { $lt: new Date(now.getTime() - 86400000) } } // Или напоминание отправлялось более 24 часов назад
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
                        paymentDetails(user.userId, user.firstName || user.username), // Передаем данные пользователя
                        { parse_mode: 'Markdown', disable_web_page_preview: true }
                    );

                    await User.updateOne(
                        { userId: user.userId },
                        { lastReminder: now } // Обновляем время последнего напоминания
                    );
                    console.log(`[Cron] Отправлено напоминание пользователю ${user.userId}.`);
                } catch (e) {
                    console.error(`[Cron] Ошибка напоминания для ${user.userId}:`, e.message);
                }
            }

            // 2. Напоминания о неотвеченных вопросах (для админа)
            const pendingQuestions = await Question.countDocuments({
                status: 'pending',
                createdAt: { $gt: new Date(now.getTime() - 7 * 86400000) } // Только за последние 7 дней
            });

            if (pendingQuestions > 0) {
                await bot.telegram.sendMessage(
                    process.env.ADMIN_ID,
                    `🔔 У вас ${pendingQuestions} неотвеченных вопросов!\n` +
                    `Используйте /questions для просмотра\n` +
                    `Последний вопрос: ${formatDate(now)}`
                );
                console.log(`[Cron] Отправлено напоминание админу о ${pendingQuestions} вопросах.`);
            }

        } catch (err) {
            console.error('[Cron] Ошибка в ежедневной задаче напоминаний:', err);
        }
    });

    // НОВАЯ ЗАДАЧА: Обработка пользователей, у которых подписка УЖЕ ИСТЕКЛА
    // Запускается ежедневно в 11:00 по Москве (через час после основной проверки)
    cron.schedule('0 11 * * *', async () => {
        console.log('[Cron] Запуск задачи обработки истекших подписок...');
        try {
            const now = new Date(); // Единая точка отсчета времени для этой задачи

            const expiredUsers = await User.find({
                status: 'active', // Ищем тех, кто все еще 'active'
                expireDate: { $lte: now } // Но их подписка истекла или истекает прямо сейчас
            });

            console.log(`[Cron] Найдено ${expiredUsers.length} пользователей с истекшей подпиской.`);

            for (const user of expiredUsers) {
                try {
                    await bot.telegram.sendMessage(
                        user.userId,
                        `🚫 *Ваша подписка на VPN истекла!*` +
                        `\n\nЧтобы продолжить пользоваться VPN, пожалуйста, продлите подписку.` +
                        `\n\nПродлите VPN за ${process.env.VPN_PRICE} руб.\n\n` +
                        paymentDetails(user.userId, user.firstName || user.username), // Передаем данные пользователя
                        { parse_mode: 'Markdown', disable_web_page_preview: true }
                    );

                    // НОВОЕ: Удаление клиента WireGuard из wg-easy при истечении подписки
                    if (user.wgClientId) {
                        try {
                            await wgService.deleteWgClient(user.wgClientId);
                            console.log(`[Cron] WG-клиент ${user.wgClientId} пользователя ${user.userId} удален.`);
                        } catch (wgError) {
                            console.error(`[Cron] Ошибка при удалении WG-клиента ${user.wgClientId} для пользователя ${user.userId}:`, wgError.message);
                            await bot.telegram.sendMessage(
                                process.env.ADMIN_ID,
                                `⚠️ Cron-задача: Не удалось удалить VPN-клиента ${user.wgClientId} для пользователя ${user.userId} (истекла подписка).` +
                                `\nОшибка: ${escapeMarkdown(wgError.message)}` +
                                `\n_Проверьте wg-easy вручную._`
                            );
                        }
                    }

                    await User.updateOne(
                        { userId: user.userId },
                        {
                            status: 'inactive', // Изменяем статус на неактивный
                            lastReminder: now, // Обновляем lastReminder, чтобы не отправлять это сообщение повторно каждый день
                            wgClientId: null // Очищаем ссылку на клиента WG-Easy
                        }
                    );
                    console.log(`[Cron] Подписка пользователя ${user.userId} истекла, статус изменен на 'inactive'.`);
                } catch (e) {
                    console.error(`[Cron] Ошибка при обработке истекшей подписки для ${user.userId}:`, e.message);
                }
            }
        } catch (err) {
            console.error('[Cron] Ошибка в задаче обработки истекших подписок:', err);
        }
    });

    // Экстренные напоминания каждые 3 часа о важных (старых) вопросах (для админа)
    cron.schedule('0 */3 * * *', async () => {
        console.log('[Cron] Запуск задачи экстренных напоминаний о вопросах...');
        try {
            const now = new Date();
            const urgentQuestions = await Question.countDocuments({
                status: 'pending',
                createdAt: { $lt: new Date(now.getTime() - 86400000) } // Вопросы старше 24 часов
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
    });

    console.log('✅ Напоминания cron запланированы.');
};