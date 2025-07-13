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
            return ctx.answerCbQuery(); // Здесь answerCbQuery уместен, т.к. это часто вызывается по кнопке
        }

        for (const user of pendingUsers) {
            let message = `📸 *Заявка на оплату от пользователя:*\n` +
                          `ID: ${user.userId}\n` +
                          `Имя: ${user.firstName || 'Не указано'}\n` +
                          `Username: ${user.username ? `@${user.username}` : 'Не указан'}\n` +
                          `Дата подачи: ${formatDate(user.paymentScreenshotDate)}`;

            await ctx.telegram.sendPhoto(
                ctx.chat.id, // Отправляем фото в чат админа
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
        await ctx.answerCbQuery(); // И здесь, если вызов идет по кнопке
    } catch (error) {
        console.error('Ошибка при проверке платежей:', error);
        await ctx.reply('⚠️ Произошла ошибка при проверке платежей.');
        if (ctx.callbackQuery) { // Только если это callbackQuery, отвечаем на него
            await ctx.answerCbQuery('Ошибка!');
        }
    }
};

exports.stats = async (ctx) => {
    if (!exports.checkAdmin(ctx)) {
        // Если это callbackQuery, отвечаем на него, иначе просто завершаем
        if (ctx.callbackQuery) {
            return ctx.answerCbQuery('🚫 Только для админа');
        }
        return; // Если это не callbackQuery и не админ, просто ничего не делаем
    }

    try {
        const totalUsers = await User.countDocuments();
        const activeUsers = await User.countDocuments({ status: 'active' });
        const pendingPayments = await User.countDocuments({ status: 'pending' });
        const pendingQuestions = await Question.countDocuments({ status: 'pending' });
        const last7DaysUsers = await User.countDocuments({
            createdAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }
        });

        // Находим пользователя с самой поздней датой истечения подписки
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
                      `🗓 Самая поздняя подписка до: *${latestExpireDate}*`;

        if (ctx.callbackQuery) {
            // Если это нажатие на кнопку (callbackQuery), редактируем предыдущее сообщение
            await ctx.editMessageText(message, {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '🔄 Обновить', callback_data: 'refresh_stats' }]
                    ]
                }
            });
            await ctx.answerCbQuery('Статистика обновлена!'); // Отвечаем на callback, чтобы убрать загрузку
        } else {
            // Если это команда (message), отправляем новое сообщение
            await ctx.replyWithMarkdown(message, {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '🔄 Обновить', callback_data: 'refresh_stats' }]
                    ]
                }
            });
            // НЕ вызываем answerCbQuery() здесь, потому что это не callbackQuery
        }

    } catch (error) {
        console.error('Ошибка при получении статистики:', error);
        if (ctx.callbackQuery) {
             await ctx.editMessageText('⚠️ Произошла ошибка при обновлении статистики.');
             await ctx.answerCbQuery('Ошибка!'); // Отвечаем на callback с ошибкой
        } else {
            await ctx.reply('⚠️ Произошла ошибка при получении статистики.');
        }
    }
};