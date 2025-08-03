const User = require('../models/User');
const Question = require('../models/Question');
const { formatDate } = require('../utils/helpers');
const { Markup } = require('telegraf');
const { checkAdmin } = require('../utils/auth');
const { getConfig, setConfig } = require('../services/configService');

/**
 * Проверяет ожидающие платежи и отправляет их администратору
 */
exports.checkPayments = async (ctx) => {
    if (!checkAdmin(ctx)) {
        return ctx.answerCbQuery('🚫 Только для админа');
    }

    try {
        const pendingUsers = await User.find({ status: 'pending' }).sort({ createdAt: 1 });

        if (pendingUsers.length === 0) {
            await ctx.reply('✅ Нет ожидающих платежей для проверки.');
            return ctx.answerCbQuery();
        }

        for (const user of pendingUsers) {
            let message = `📸 *Заявка на оплату от пользователя:*\n` +
                `ID: ${user.userId}\n` +
                `Имя: ${user.firstName || 'Не указано'}\n` +
                `Username: ${user.username ? `@${user.username}` : 'Не указан'}\n` +
                `Дата подачи: ${formatDate(user.paymentPhotoDate || user.createdAt)}\n` +
                `Попыток оплаты: ${user.subscriptionCount || 0}`;

            if (user.rejectionComment) {
                message += `\n\n*Предыдущий комментарий отклонения:*\n"${user.rejectionComment}"`;
            }

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
                                    { text: '❌ Отклонить с комментарием', callback_data: `reject_${user.userId}` }
                                ],
                                [
                                    { text: '🔄 Проверить позже', callback_data: 'defer_payment' }
                                ]
                            ]
                        }
                    }
                );
            } else {
                await ctx.replyWithMarkdown(
                    `⚠️ *Заявка без скриншота от ${user.firstName || 'Без имени'} (ID: ${user.userId})*\n\n` +
                    message,
                    { parse_mode: 'Markdown' }
                );
            }
        }
        await ctx.answerCbQuery();
    } catch (error) {
        console.error('Ошибка при проверке платежей:', error);
        await ctx.answerCbQuery('Произошла ошибка при проверке!');
        await ctx.reply('⚠️ Произошла ошибка при проверке платежей. Пожалуйста, проверьте логи сервера.');
    }
};

/**
 * Генерирует и отправляет статистику бота
 */
exports.stats = async (ctx) => {
    if (!checkAdmin(ctx)) {
        if (ctx.callbackQuery) {
            return ctx.answerCbQuery('🚫 Только для админа');
        }
        return;
    }

    try {
        const [
            totalUsers,
            activeUsers,
            pendingPayments,
            pendingQuestions,
            last7DaysUsers
        ] = await Promise.all([
            User.countDocuments(),
            User.countDocuments({ status: 'active' }),
            User.countDocuments({ status: 'pending' }),
            Question.countDocuments({ status: 'pending' }),
            User.countDocuments({
                createdAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }
            })
        ]);

        const latestSubscription = await User.findOne({
            status: 'active',
            expireDate: { $exists: true }
        }).sort({ expireDate: -1 }).limit(1);

        let latestExpireDate = 'N/A';
        if (latestSubscription && latestSubscription.expireDate) {
            latestExpireDate = formatDate(latestSubscription.expireDate, true);
        }

        const currentPrice = await getConfig('vpn_price', 132);

        let message = `📊 *Статистика Бота*\n\n` +
            `💰 Текущая цена: *${currentPrice} ₽*\n` +
            `👥 Всего пользователей: *${totalUsers}*\n` +
            `✅ Активных подписок: *${activeUsers}*\n` +
            `⏳ Ожидают проверки оплаты: *${pendingPayments}*\n` +
            `❓ Неотвеченных вопросов: *${pendingQuestions}*\n` +
            `🆕 Новых пользователей (7 дней): *${last7DaysUsers}*\n` +
            `🗓 Самая поздняя подписка до: *${latestExpireDate}*`;

        await ctx.replyWithMarkdown(message, {
            reply_markup: {
                inline_keyboard: [
                    [{ text: '🔄 Обновить', callback_data: 'refresh_stats' }],
                    [{ text: '💳 Проверить платежи', callback_data: 'check_payments_admin' }]
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
 * Отображает меню администратора
 */
exports.checkAdminMenu = async (ctx) => {
    if (!checkAdmin(ctx)) {
        return;
    }

    const currentPrice = await getConfig('vpn_price', 132);
    const pendingPayments = await User.countDocuments({ status: 'pending' });
    const pendingQuestions = await Question.countDocuments({ status: 'pending' });

    const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback(`💳 Проверить платежи (${pendingPayments})`, 'check_payments_admin')],
        [Markup.button.callback('📊 Статистика', 'show_stats_admin')],
        [Markup.button.callback(`❓ Вопросы (${pendingQuestions})`, 'list_questions')],
        [
            Markup.button.callback(
                `💰 Изменить цену (Текущая: ${currentPrice} ₽)`,
                'set_price_admin'
            )
        ],
        [Markup.button.callback('🔄 Проверить новые вопросы', 'check_new_questions')]
    ]);

    await ctx.reply('⚙️ *Панель администратора*', {
        parse_mode: 'Markdown',
        ...keyboard
    });
};

/**
 * Отображает список неотвеченных вопросов
 */
exports.listQuestions = async (ctx) => {
    if (!checkAdmin(ctx)) {
        if (ctx.callbackQuery) {
            return ctx.answerCbQuery('🚫 Только для админа');
        }
        return;
    }

    try {
        const questions = await Question.find({ status: 'pending' })
            .sort({ createdAt: 1 })
            .limit(20);

        if (questions.length === 0) {
            await ctx.reply('ℹ️ Нет ожидающих вопросов.');
            return ctx.answerCbQuery();
        }

        for (const question of questions) {
            const user = await User.findOne({ userId: question.userId });
            const name = user?.firstName || user?.username || 'Неизвестный';

            const message = `❓ *Вопрос от ${name}* (ID: ${question.userId})\n` +
                `Дата: ${formatDate(question.createdAt, true)}\n\n` +
                `${question.questionText}\n\n` +
                `_Статус: Ожидает ответа_`;

            await ctx.replyWithMarkdown(message, {
                reply_markup: {
                    inline_keyboard: [
                        [
                            { text: '➡️ Ответить', callback_data: `answer_${question._id}` },
                            { text: '❌ Удалить', callback_data: `delete_question_${question._id}` }
                        ]
                    ]
                }
            });
        }

        await ctx.answerCbQuery();
    } catch (error) {
        console.error('Ошибка получения списка вопросов:', error);
        await ctx.reply('⚠️ Не удалось загрузить список вопросов.');
        await ctx.answerCbQuery('Ошибка!');
    }
};