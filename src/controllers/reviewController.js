const User = require('../models/User');
const Review = require('../models/Review');
const { Markup } = require('telegraf');
const { formatDate } = require('../utils/helpers');

/**
 * Инициирует процесс оставления отзыва
 */
exports.startReview = async (ctx) => {
    const userId = ctx.from.id;

    try {
        const user = await User.findOne({ userId });

        // Проверяем, есть ли у пользователя активная подписка
        if (!user || user.status !== 'active') {
            return ctx.reply('⚠️ Отзыв могут оставлять только пользователи с активной подпиской.');
        }

        // Проверяем, не оставлял ли пользователь отзыв недавно (например, за последние 30 дней)
        const recentReview = await Review.findOne({
            userId,
            createdAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) }
        });

        if (recentReview) {
            return ctx.reply('⚠️ Вы уже оставляли отзыв в течение последних 30 дней. Попробуйте позже.');
        }

        // Инициализируем reviewData заново для предотвращения загрязнения данными
        delete ctx.session.reviewData;
        ctx.session.reviewData = {};

        await ctx.reply(
            '⭐ *Оценка работы VPN*\n\n' +
            'Пожалуйста, оцените качество работы VPN от 1 до 5 звёзд:',
            {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [
                            { text: '⭐ 1', callback_data: 'review_rating_1' },
                            { text: '⭐⭐ 2', callback_data: 'review_rating_2' },
                            { text: '⭐⭐⭐ 3', callback_data: 'review_rating_3' }
                        ],
                        [
                            { text: '⭐⭐⭐⭐ 4', callback_data: 'review_rating_4' },
                            { text: '⭐⭐⭐⭐⭐ 5', callback_data: 'review_rating_5' }
                        ],
                        [
                            { text: '❌ Отмена', callback_data: 'review_cancel' }
                        ]
                    ]
                }
            }
        );

        await ctx.answerCbQuery();

    } catch (error) {
        console.error('Ошибка при инициации отзыва:', error);
        await ctx.reply('⚠️ Произошла ошибка. Попробуйте позже.');
    }
};

/**
 * Обрабатывает выбор рейтинга
 */
exports.handleRating = async (ctx) => {
    const rating = parseInt(ctx.match[1]);
    const userId = ctx.from.id;

    try {
        // Сохраняем рейтинг в сессии
        ctx.session.reviewData = {
            rating,
            userId,
            username: ctx.from.username,
            firstName: ctx.from.first_name
        };

        await ctx.editMessageText(
            `⭐ *Оценка: ${rating} из 5*\n\n` +
            'Теперь оцените скорость работы VPN:',
            {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [
                            { text: '🚀 Отлично', callback_data: 'review_speed_excellent' },
                            { text: '👍 Хорошо', callback_data: 'review_speed_good' }
                        ],
                        [
                            { text: '👌 Средне', callback_data: 'review_speed_average' },
                            { text: '👎 Плохо', callback_data: 'review_speed_poor' }
                        ],
                        [
                            { text: '❌ Отмена', callback_data: 'review_cancel' }
                        ]
                    ]
                }
            }
        );

        await ctx.answerCbQuery();

    } catch (error) {
        console.error('Ошибка при обработке рейтинга:', error);
        await ctx.answerCbQuery('⚠️ Произошла ошибка');
    }
};

/**
 * Обрабатывает выбор скорости
 */
exports.handleSpeed = async (ctx) => {
    const speed = ctx.match[1];

    try {
        ctx.session.reviewData.vpnSpeed = speed;

        const speedText = getSpeedText(speed);

        await ctx.editMessageText(
            `⭐ *Оценка: ${ctx.session.reviewData.rating} из 5*\n` +
            `🚀 *Скорость: ${speedText}*\n\n` +
            'Оцените стабильность соединения:',
            {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [
                            { text: '🔒 Отлично', callback_data: 'review_stability_excellent' },
                            { text: '👍 Хорошо', callback_data: 'review_stability_good' }
                        ],
                        [
                            { text: '👌 Средне', callback_data: 'review_stability_average' },
                            { text: '👎 Плохо', callback_data: 'review_stability_poor' }
                        ],
                        [
                            { text: '❌ Отмена', callback_data: 'review_cancel' }
                        ]
                    ]
                }
            }
        );

        await ctx.answerCbQuery();

    } catch (error) {
        console.error('Ошибка при обработке скорости:', error);
        await ctx.answerCbQuery('⚠️ Произошла ошибка');
    }
};

/**
 * Обрабатывает выбор стабильности
 */
exports.handleStability = async (ctx) => {
    const stability = ctx.match[1];

    try {
        if (!['excellent', 'good', 'average', 'poor'].includes(stability)) {
            throw new Error('Недопустимое значение стабильности');
        }
        ctx.session.reviewData.vpnStability = stability;

        const speedText = getSpeedText(ctx.session.reviewData.vpnSpeed);
        const stabilityText = getStabilityText(stability);

        await ctx.editMessageText(
            `⭐ *Оценка: ${ctx.session.reviewData.rating} из 5*\n` +
            `🚀 *Скорость: ${speedText}*\n` +
            `🔒 *Стабильность: ${stabilityText}*\n\n` +
            'Хотите добавить комментарий? (необязательно)',
            {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [
                            { text: '✍️ Добавить комментарий', callback_data: 'review_add_comment' },
                            { text: '✅ Завершить отзыв', callback_data: 'review_finish' }
                        ],
                        [
                            { text: '❌ Отмена', callback_data: 'review_cancel' }
                        ]
                    ]
                }
            }
        );

        await ctx.answerCbQuery();

    } catch (error) {
        console.error('Ошибка при обработке стабильности:', error);
        await ctx.answerCbQuery('⚠️ Произошла ошибка');
    }
};

/**
 * Запрашивает комментарий от пользователя
 */
exports.requestComment = async (ctx) => {
    try {
        ctx.session.awaitingReviewComment = true;

        await ctx.editMessageText(
            '✍️ *Добавление комментария*\n\n' +
            'Напишите ваш комментарий о работе VPN (максимум 500 символов):',
            {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '❌ Отмена', callback_data: 'review_cancel' }]
                    ]
                }
            }
        );

        await ctx.answerCbQuery();

    } catch (error) {
        console.error('Ошибка при запросе комментария:', error);
        await ctx.answerCbQuery('⚠️ Произошла ошибка');
    }
};

/**
 * Завершает создание отзыва
 */
exports.finishReview = async (ctx, comment = null) => {
    try {
        const reviewData = ctx.session.reviewData;

        if (!reviewData) {
            return ctx.reply('⚠️ Данные отзыва не найдены. Попробуйте начать заново.');
        }

        // Проверяем и устанавливаем значения по умолчанию
        if (!reviewData.vpnSpeed) reviewData.vpnSpeed = 'not_specified';
        if (!reviewData.vpnStability) reviewData.vpnStability = 'not_specified';
        if (comment) {
            reviewData.comment = comment.trim(); // Сохраняем только введённый комментарий
        } else {
            delete reviewData.comment; // Удаляем комментарий, если он не введён
        }

        // Создаём и сохраняем отзыв
        const review = new Review({
            userId: reviewData.userId,
            username: reviewData.username,
            firstName: reviewData.firstName,
            rating: reviewData.rating,
            comment: reviewData.comment,
            vpnSpeed: reviewData.vpnSpeed,
            vpnStability: reviewData.vpnStability
        });
        await review.save();

        // Очищаем сессию
        delete ctx.session.reviewData;
        delete ctx.session.awaitingReviewComment;

        const speedText = getSpeedText(reviewData.vpnSpeed);
        const stabilityText = getStabilityText(reviewData.vpnStability);

        let message = `✅ *Спасибо за отзыв!*\n\n` +
            `⭐ Оценка: ${reviewData.rating} из 5\n` +
            `🚀 Скорость: ${speedText}\n` +
            `🔒 Стабильность: ${stabilityText}`;

        if (reviewData.comment) {
            message += `\n💬 Комментарий: "${reviewData.comment}"`;
        } else {
            message += '\n💬 Комментарий: Без комментария';
        }

        message += `\n\n_Ваш отзыв поможет нам улучшить качество сервиса!_`;

        if (ctx.callbackQuery) {
            await ctx.editMessageText(message, { parse_mode: 'Markdown' });
        } else {
            await ctx.replyWithMarkdown(message);
        }

        // Уведомляем администратора о новом отзыве
        await ctx.telegram.sendMessage(
            process.env.ADMIN_ID,
            `📝 *Новый отзыв о VPN*\n\n` +
            `От: ${reviewData.firstName || reviewData.username || 'Неизвестный'} (ID: ${reviewData.userId})\n` +
            `⭐ Оценка: ${reviewData.rating}/5\n` +
            `🚀 Скорость: ${speedText}\n` +
            `🔒 Стабильность: ${stabilityText}` +
            (reviewData.comment ? `\n💬 "${reviewData.comment}"` : '\n💬 Без комментария'),
            { parse_mode: 'Markdown' }
        );

    } catch (error) {
        console.error('Ошибка при завершении отзыва:', error);
        await ctx.reply('⚠️ Произошла ошибка при сохранении отзыва. Попробуйте позже.');
    }
};

/**
 * Отменяет создание отзыва
 */
exports.cancelReview = async (ctx) => {
    try {
        delete ctx.session.reviewData;
        delete ctx.session.awaitingReviewComment;

        await ctx.editMessageText('❌ Создание отзыва отменено.');
        await ctx.answerCbQuery();

    } catch (error) {
        console.error('Ошибка при отмене отзыва:', error);
        await ctx.answerCbQuery('⚠️ Произошла ошибка');
    }
};

/**
 * Возвращает текстовое описание скорости
 */
const getSpeedText = (speed) => {
    switch (speed) {
        case 'excellent': return 'Отлично';
        case 'good': return 'Хорошо';
        case 'average': return 'Средне';
        case 'poor': return 'Плохо';
        case 'not_specified': return 'Не указано';
        default: return 'Не указано';
    }
};

/**
 * Возвращает текстовое описание стабильности
 */
const getStabilityText = (stability) => {
    switch (stability) {
        case 'excellent': return 'Отлично';
        case 'good': return 'Хорошо';
        case 'average': return 'Средне';
        case 'poor': return 'Плохо';
        case 'not_specified': return 'Не указано';
        default: return 'Не указано';
    }
};