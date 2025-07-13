const User = require('../models/User');
const Question = require('../models/Question');
const { formatDate } = require('../utils/helpers');
const { Markup } = require('telegraf');

exports.checkAdmin = (ctx) => {
    return ctx.from && ctx.from.id === parseInt(process.env.ADMIN_ID);
};

exports.checkPayments = async (ctx) => {
    if (!exports.checkAdmin(ctx)) {
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
                          `Дата подачи: ${formatDate(user.paymentScreenshotDate)}`;

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
        }
        await ctx.answerCbQuery(); 
    } catch (error) {
        console.error('Ошибка при проверке платежей:', error);
        if (ctx.callbackQuery) {
            await ctx.answerCbQuery('Ошибка!');
        }
    }
};

exports.stats = async (ctx) => {
    if (!exports.checkAdmin(ctx)) {
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
                      `_Обновлено: ${new Date().toLocaleTimeString('ru-RU')}_`; // ДОБАВЛЕНО: метка времени для уникальности

        // Всегда отправляем новое сообщение
        await ctx.replyWithMarkdown(message, {
            reply_markup: {
                inline_keyboard: [
                    [{ text: '🔄 Обновить', callback_data: 'refresh_stats' }]
                ]
            }
        });
        
        // Отвечаем на callbackQuery, если это было нажатие кнопки
        if (ctx.callbackQuery) {
            await ctx.answerCbQuery('Статистика обновлена!'); 
        } else {
            // Для команды /stats не нужно answerCbQuery
            // await ctx.answerCbQuery(); // Эту строку удалили ранее
        }

    } catch (error) {
        console.error('Ошибка при получении статистики:', error);
        if (ctx.callbackQuery) {
             await ctx.reply('⚠️ Произошла ошибка при обновлении статистики.'); // Отправляем новое сообщение с ошибкой
             await ctx.answerCbQuery('Ошибка!');
        } else {
            await ctx.reply('⚠️ Произошла ошибка при получении статистики.');
        }
    }
};