const User = require('../models/User');
const Question = require('../models/Question');
const { formatDate } = require('../utils/helpers');
const { Markup } = require('telegraf');

/**
 * Проверяет, является ли текущий пользователь администратором.
 * @param {object} ctx - Объект контекста Telegraf.
 * @returns {boolean} - true, если пользователь админ, иначе false.
 */
exports.checkAdmin = (ctx) => {
    return ctx.from && ctx.from.id === parseInt(process.env.ADMIN_ID);
};

/**
 * Обрабатывает запрос на проверку ожидающих платежей.
 * Администратор получает информацию о заявках с скриншотами.
 * Если скриншота нет, админ получает текстовое уведомление.
 * @param {object} ctx - Объект контекста Telegraf.
 */
exports.checkPayments = async (ctx) => {
    // Проверка прав администратора
    if (!exports.checkAdmin(ctx)) {
        return ctx.answerCbQuery('🚫 Только для админа');
    }

    try {
        // Находим всех пользователей со статусом "pending" (ожидает проверки)
        const pendingUsers = await User.find({ status: 'pending' });

        // Если нет ожидающих платежей
        if (pendingUsers.length === 0) {
            await ctx.reply('✅ Нет ожидающих платежей для проверки.');
            return ctx.answerCbQuery(); 
        }

        // Перебираем каждую заявку
        for (const user of pendingUsers) {
            // Формируем общую информацию о заявке
            let message = `📸 *Заявка на оплату от пользователя:*\n` +
                          `ID: ${user.userId}\n` +
                          `Имя: ${user.firstName || 'Не указано'}\n` +
                          `Username: ${user.username ? `@${user.username}` : 'Не указан'}\n` +
                          `Дата подачи: ${user.paymentScreenshotDate ? formatDate(user.paymentScreenshotDate) : 'Не указана'}`; 
            
            // Если ID скриншота присутствует, отправляем фото
            if (user.paymentScreenshotId) {
                await ctx.telegram.sendPhoto(
                    ctx.chat.id, 
                    user.paymentScreenshotId,
                    {
                        caption: message,
                        parse_mode: 'Markdown',
                        reply_markup: {
                            inline_keyboard: [
                                [
                                    { text: '✅ Одобрить', callback_data: `approve_${user.userId}` },
                                    { text: '❌ Отклонить', callback_data: `reject_${user.userId}` }
                                ]
                            ]
                        }
                    }
                );
            } else {
                // Если paymentScreenshotId отсутствует, отправляем текстовое уведомление
                await ctx.replyWithMarkdown(
                    `⚠️ *Заявка от пользователя ${user.firstName || user.username || 'Без имени'} (ID: ${user.userId}) без скриншота!*\n` +
                    `Возможно, пользователь не отправил фото или произошла ошибка сохранения.\n\n` +
                    `${message}`, 
                    { parse_mode: 'Markdown' }
                );
            }
        }
        await ctx.answerCbQuery(); 
    } catch (error) {
        console.error('Ошибка при проверке платежей:', error);
        // Отвечаем на callbackQuery, если вызов был по кнопке
        if (ctx.callbackQuery) {
            await ctx.answerCbQuery('Произошла ошибка при проверке!');
        }
        await ctx.reply('⚠️ Произошла ошибка при проверке платежей. Пожалуйста, проверьте логи сервера.');
    }
};

/**
 * Генерирует и отправляет статистику бота администратору.
 * Включает кнопку "Обновить" для актуализации данных.
 * @param {object} ctx - Объект контекста Telegraf.
 */
exports.stats = async (ctx) => {
    // Проверка прав администратора
    if (!exports.checkAdmin(ctx)) {
        if (ctx.callbackQuery) {
            return ctx.answerCbQuery('🚫 Только для админа');
        }
        return; 
    }

    try {
        // Собираем статистические данные из базы данных
        const totalUsers = await User.countDocuments();
        const activeUsers = await User.countDocuments({ status: 'active' });
        const pendingPayments = await User.countDocuments({ status: 'pending' });
        const pendingQuestions = await Question.countDocuments({ status: 'pending' });
        const last7DaysUsers = await User.countDocuments({
            createdAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }
        });

        // Находим самую позднюю дату истечения подписки
        const latestSubscription = await User.findOne({ status: 'active', expireDate: { $exists: true } })
                                           .sort({ expireDate: -1 })
                                           .limit(1);

        let latestExpireDate = 'N/A';
        if (latestSubscription && latestSubscription.expireDate) {
            latestExpireDate = formatDate(latestSubscription.expireDate, true);
        }

        // Формируем текстовое сообщение статистики
        let message = `📊 *Статистика Бота*\n\n` +
                      `👥 Всего пользователей: *${totalUsers}*\n` +
                      `✅ Активных подписок: *${activeUsers}*\n` +
                      `⏳ Ожидают проверки оплаты: *${pendingPayments}*\n` +
                      `❓ Неотвеченных вопросов: *${pendingQuestions}*\n` +
                      `🆕 Новых пользователей (7 дней): *${last7DaysUsers}*\n` +
                      `🗓 Самая поздняя подписка до: *${latestExpireDate}*\n` +
                      `_Обновлено: ${new Date().toLocaleTimeString('ru-RU')}_`; // Добавляем метку времени для уникальности

        // Отправляем новое сообщение со статистикой (не редактируем старое)
        await ctx.replyWithMarkdown(message, {
            reply_markup: {
                inline_keyboard: [
                    [{ text: '🔄 Обновить', callback_data: 'refresh_stats' }]
                ]
            }
        });
        
        // Отвечаем на callbackQuery, если вызов был по кнопке "Обновить"
        if (ctx.callbackQuery) {
            await ctx.answerCbQuery('Статистика обновлена!'); 
        }

    } catch (error) {
        console.error('Ошибка при получении статистики:', error);
        if (ctx.callbackQuery) {
             await ctx.reply('⚠️ Произошла ошибка при обновлении статистики.'); 
             await ctx.answerCbQuery('Ошибка!');
        } else {
            await ctx.reply('⚠️ Произошла ошибка при получении статистики.');
        }
    }
};