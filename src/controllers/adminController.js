const User = require('../models/User');
const Question = require('../models/Question'); 
const { formatDate } = require('../utils/helpers');
const { Markup } = require('telegraf');
// ИЗМЕНЕНО: Импорт checkAdmin из нового модуля utils/auth
const { checkAdmin } = require('../utils/auth');

/**
 * Обрабатывает запрос на проверку ожидающих платежей.
 * Администратор получает информацию о заявках с скриншотами.
 * Если скриншота нет, админ получает текстовое уведомление.
 * @param {object} ctx - Объект контекста Telegraf.
 */
exports.checkPayments = async (ctx) => {
    // ИЗМЕНЕНО: Использование checkAdmin из импорта
    if (!checkAdmin(ctx)) { 
        return ctx.answerCbQuery('🚫 Только для админа');
    }

    try {
        const pendingUsers = await User.find({ status: 'pending' });

        if (pendingUsers.length === 0) {
            await ctx.reply('✅ Нет ожидающих платежей для проверки.');
            return ctx.answerCbQuery();
        }

        for (const user of pendingUsers) {
            let message = `📸 *Заявка на оплату от пользователя:*\n` +
                          `ID: ${user.userId}\n` +
                          `Имя: ${user.firstName || 'Не указано'}\n` +
                          `Username: ${user.username ? `@${user.username}` : 'Не указан'}\n` +
                          `Дата подачи: ${user.paymentPhotoDate ? formatDate(user.paymentPhotoDate) : 'Не указана'}`; 
            
            if (user.paymentPhotoId) { 
                await ctx.telegram.sendPhoto(
                    ctx.chat.id, 
                    user.paymentPhotoId, 
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
    // ИЗМЕНЕНО: Использование checkAdmin из импорта
    if (!checkAdmin(ctx)) { 
        if (ctx.callbackQuery) {
            return ctx.answerCbQuery('🚫 Только для админа');
        }
        return;
    }

    try {
        const totalUsers = await User.countDocuments();
        const activeUsers = await User.countDocuments({ status: 'active' });
        const pendingPayments = await User.countDocuments({ status: 'pending' });
        const pendingQuestions = await Question.countDocuments({ status: 'pending' });
        const last7DaysUsers = await User.countDocuments({
            createdAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }
        });

        const latestSubscription = await User.findOne({ status: 'active', expireDate: { $exists: true } })
                                                 .sort({ expireDate: -1 })
                                                 .limit(1);

        let latestExpireDate = 'N/A';
        if (latestSubscription && latestSubscription.expireDate) {
            latestExpireDate = formatDate(latestSubscription.expireDate, true);
        }

        let message = `📊 *Статистика Бота*\n\n` +
                      `👥 Всего пользователей: *${totalUsers}*\n` +
                      `✅ Активных подписок: *${activeUsers}*\n` +
                      `⏳ Ожидают проверки оплаты: *${pendingPayments}*\n` +
                      `❓ Неотвеченных вопросов: *${pendingQuestions}*\n` +
                      `🆕 Новых пользователей (7 дней): *${last7DaysUsers}*\n` +
                      `🗓 Самая поздняя подписка до: *${latestExpireDate}*\n` +
                      `_Обновлено: ${new Date().toLocaleTimeString('ru-RU')}_`; 

        await ctx.replyWithMarkdown(message, {
            reply_markup: {
                inline_keyboard: [
                    [{ text: '🔄 Обновить', callback_data: 'refresh_stats' }]
                ]
            }
        });
        
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

/**
 * Отображает главное меню администратора.
 * @param {object} ctx - Объект контекста Telegraf.
 */
exports.checkAdminMenu = async (ctx) => {
    if (!checkAdmin(ctx)) {
        return ctx.reply('🚫 У вас нет доступа к админ-панели.');
    }

    try {
        await ctx.reply('Панель администратора:', Markup.inlineKeyboard([
            [Markup.button.callback('💳 Проверить платежи', 'check_payments_admin')],
            [Markup.button.callback('📊 Статистика', 'show_stats_admin')],
            [Markup.button.callback('❓ Все вопросы', 'list_questions')]
        ]));
    } catch (error) {
        console.error('Ошибка при отображении админ-панели:', error);
        await ctx.reply('⚠️ Произошла ошибка при загрузке админ-панели.');
    }
};