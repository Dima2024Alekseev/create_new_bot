const User = require('../models/User');
const Question = require('../models/Question');
const Review = require('../models/Review');
const { Markup } = require('telegraf');
const { checkAdmin } = require('../utils/auth');
const { getConfig } = require('../services/configService');
const { formatDate, escapeMarkdown } = require('../utils/helpers');

/**
 * Обрабатывает запрос на проверку ожидающих платежей с пагинацией.
 */
exports.checkPayments = async (ctx) => {
    if (!checkAdmin(ctx)) {
        return ctx.answerCbQuery('🚫 Только для администратора');
    }

    try {
        // Показываем первую страницу
        await showPaymentsPage(ctx, 1);

        if (ctx.callbackQuery) {
            await ctx.answerCbQuery();
        }
    } catch (error) {
        console.error('Ошибка при проверке платежей:', error);
        if (ctx.callbackQuery) {
            await ctx.answerCbQuery('Произошла ошибка при проверке!');
        }
        await ctx.reply('⚠️ Произошла ошибка при проверке платежей. Пожалуйста, проверьте логи сервера.');
    }
};

/**
 * Показывает страницу с одним платежом
 */
const showPaymentsPage = async (ctx, page = 1) => {
    const PAYMENTS_PER_PAGE = 1; // Один платеж на страницу
    const skip = (page - 1) * PAYMENTS_PER_PAGE;

    try {
        // Получаем общее количество ожидающих платежей
        const totalPayments = await User.countDocuments({ status: 'pending' });

        if (totalPayments === 0) {
            return ctx.reply('✅ Нет ожидающих платежей для проверки.');
        }

        // Получаем один платеж для текущей страницы
        const user = await User.findOne({ status: 'pending' })
            .sort({ paymentPhotoDate: -1 }) // Сортируем по дате (новые сначала)
            .skip(skip);

        if (!user) {
            return ctx.reply('⚠️ Платеж не найден. Возможно, он уже был обработан.');
        }

        const totalPages = totalPayments;

        // Формируем сообщение с информацией о платеже
        let message = `📸 *Заявка на оплату от пользователя:*\n` +
            `ID: ${user.userId}\n` +
            `Имя: ${user.firstName || 'Не указано'}\n` +
            `Username: ${user.username ? `@${user.username}` : 'Не указан'}\n` +
            `Дата подачи: ${user.paymentPhotoDate ? formatDate(user.paymentPhotoDate) : 'Не указана'}\n\n` +
            `📄 Платеж ${page} из ${totalPages}`;

        // Создаем кнопки действий
        const actionButtons = [
            [
                { text: '✅ Принять', callback_data: `approve_${user.userId}` },
                { text: '❌ Отклонить', callback_data: `reject_${user.userId}` }
            ],
            [
                { text: '⏰ Рассмотреть позже', callback_data: `review_later_${user.userId}` }
            ]
        ];

        // Создаем кнопки навигации
        const navigationButtons = [];

        if (totalPages > 1) {
            // Кнопка "Предыдущий платеж"
            if (page > 1) {
                navigationButtons.push({ text: '⬅️ Предыдущий', callback_data: `payments_page_${page - 1}` });
            }

            // Кнопка "Следующий платеж"
            if (page < totalPages) {
                navigationButtons.push({ text: 'Следующий ➡️', callback_data: `payments_page_${page + 1}` });
            }

            // Кнопка обновления
            navigationButtons.push({ text: '🔄 Обновить', callback_data: `payments_page_${page}` });
        }

        // Объединяем кнопки
        const allButtons = [...actionButtons];
        if (navigationButtons.length > 0) {
            allButtons.push(navigationButtons);
        }

        // Отправляем платеж
        if (user.paymentPhotoId) {
            await ctx.telegram.sendPhoto(
                ctx.chat.id,
                user.paymentPhotoId,
                {
                    caption: message,
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: allButtons
                    }
                }
            );
        } else {
            await ctx.replyWithMarkdown(
                `⚠️ *Заявка от пользователя ${user.firstName || user.username || 'Без имени'} (ID: ${user.userId}) без скриншота!*\n` +
                `Возможно, пользователь не отправил фото или произошла ошибка сохранения.\n\n` +
                `${message}`,
                {
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: allButtons
                    }
                }
            );
        }

    } catch (error) {
        console.error('Ошибка при показе страницы платежей:', error);
        await ctx.reply('⚠️ Произошла ошибка при загрузке платежей.');
    }
};

/**
 * Обрабатывает переход на определенную страницу платежей
 */
exports.handlePaymentsPage = async (ctx) => {
    if (!checkAdmin(ctx)) {
        return ctx.answerCbQuery('🚫 Только для администратора');
    }

    const page = parseInt(ctx.match[1]);

    try {
        await ctx.answerCbQuery(`Загружаю страницу ${page}...`);
        await showPaymentsPage(ctx, page);
    } catch (error) {
        console.error(`Ошибка при переходе на страницу ${page}:`, error);
        await ctx.answerCbQuery('⚠️ Ошибка при загрузке страницы!');
        await ctx.reply('⚠️ Произошла ошибка при переходе на страницу.');
    }
};

/**
 * Генерирует и отправляет статистику бота администратору.
 */
exports.stats = async (ctx) => {
    if (!checkAdmin(ctx)) {
        if (ctx.callbackQuery) {
            return ctx.answerCbQuery('🚫 Только для администратора');
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
 * Отображает главное меню администратора с кнопками для изменения цены и каждого реквизита.
 */
exports.checkAdminMenu = async (ctx) => {
    if (!checkAdmin(ctx)) {
        return;
    }

    const config = await getConfig();
    const currentPrice = config.vpnPrice;
    const phoneNumber = config.paymentPhone;
    const cardNumber = config.paymentCard;
    const bankName = config.paymentBank;

    const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('💳 Проверить платежи', 'check_payments_admin')],
        [Markup.button.callback('📊 Статистика', 'show_stats_admin')],
        [Markup.button.callback('👥 Список пользователей', 'list_users_admin')],
        [Markup.button.callback('⭐ Отзывы о VPN', 'list_reviews_admin')],
        [Markup.button.callback('📢 Массовая рассылка', 'mass_broadcast_admin')],
        [Markup.button.callback('❓ Все вопросы', 'list_questions')],
        [
            Markup.button.callback(
                `💰 Изменить цену (Текущая: ${currentPrice} ₽)`,
                'set_price_admin'
            )
        ],
        [
            Markup.button.callback(
                `📱 Изменить номер телефона (Текущий: ${phoneNumber})`,
                'set_payment_phone_admin'
            )
        ],
        [
            Markup.button.callback(
                `💳 Изменить номер карты (Текущий: ${cardNumber})`,
                'set_payment_card_admin'
            )
        ],
        [
            Markup.button.callback(
                `🏦 Изменить банк (Текущий: ${bankName})`,
                'set_payment_bank_admin'
            )
        ]
    ]);

    await ctx.reply('⚙️ Панель администратора:', keyboard);
};

/**
 * Показывает список пользователей с пагинацией
 */
exports.listUsers = async (ctx) => {
    if (!checkAdmin(ctx)) {
        return ctx.answerCbQuery('🚫 Только для администратора');
    }

    try {
        // Показываем первую страницу
        await showUsersPage(ctx, 1);

        if (ctx.callbackQuery) {
            await ctx.answerCbQuery();
        }
    } catch (error) {
        console.error('Ошибка при получении списка пользователей:', error);
        if (ctx.callbackQuery) {
            await ctx.answerCbQuery('Произошла ошибка!');
        }
        await ctx.reply('⚠️ Произошла ошибка при загрузке списка пользователей.');
    }
};

/**
 * Показывает страницу с пользователями
 */
const showUsersPage = async (ctx, page = 1) => {
    const USERS_PER_PAGE = 5; // Уменьшаем до 5 пользователей на страницу
    const skip = (page - 1) * USERS_PER_PAGE;

    try {
        // Получаем общее количество пользователей
        const totalUsers = await User.countDocuments();

        if (totalUsers === 0) {
            return ctx.reply('👥 Пользователей пока нет.');
        }

        // Получаем пользователей для текущей страницы
        const users = await User.find({})
            .sort({ createdAt: -1 }) // Сортируем по дате регистрации (новые сначала)
            .skip(skip)
            .limit(USERS_PER_PAGE);

        const totalPages = Math.ceil(totalUsers / USERS_PER_PAGE);

        // Формируем сообщение со списком пользователей
        let message = `👥 *Список пользователей*\n\n`;
        message += `📄 Страница ${page} из ${totalPages} (Всего: ${totalUsers})\n\n`;

        for (const user of users) {
            const statusEmoji = getStatusEmoji(user.status);
            const subscriptionInfo = getSubscriptionInfo(user);

            // Экранируем только потенциально проблемные поля
            const safeName = escapeMarkdown(user.firstName || user.username || 'Без имени');
            const safeUsername = user.username ? `@${escapeMarkdown(user.username)}` : '';
            const safeStatus = escapeMarkdown(getStatusText(user.status));
            // Не экранируем subscriptionInfo, так как дата не содержит проблемных символов

            message += `${statusEmoji} *${safeName}*\n`;
            message += `   ID: \`${user.userId}\`\n`;
            if (safeUsername) {
                message += `   Username: ${safeUsername}\n`;
            }
            message += `   Статус: ${safeStatus}\n`;
            message += `   ${subscriptionInfo}\n`; // Без экранирования
            message += `   Подписок: ${user.subscriptionCount || 0}\n\n`;
        }

        // Проверяем длину сообщения
        console.log(`[DEBUG] Длина сообщения: ${message.length}`);
        if (message.length > 4000) {
            console.warn(`[WARNING] Длина сообщения (${message.length}) превышает лимит Telegram (4096 символов)`);
            return ctx.reply('⚠️ Список слишком длинный. Попробуйте уменьшить количество пользователей на странице.');
        }

        // Создаем кнопки навигации
        const navigationButtons = [];

        if (totalPages > 1) {
            // Кнопка "Предыдущая страница"
            if (page > 1) {
                navigationButtons.push({ text: '⬅️ Предыдущая', callback_data: `users_page_${page - 1}` });
            }

            // Кнопка "Следующая страница"
            if (page < totalPages) {
                navigationButtons.push({ text: 'Следующая ➡️', callback_data: `users_page_${page + 1}` });
            }

            // Кнопка обновления
            navigationButtons.push({ text: '🔄 Обновить', callback_data: `users_page_${page}` });
        }

        const keyboard = [];
        if (navigationButtons.length > 0) {
            keyboard.push(navigationButtons);
        }
        keyboard.push([{ text: '🏠 Главное меню', callback_data: 'back_to_admin_menu' }]);

        await ctx.replyWithMarkdown(message, {
            reply_markup: {
                inline_keyboard: keyboard
            }
        });

    } catch (error) {
        console.error('Ошибка при показе страницы пользователей:', {
            message: error.message,
            stack: error.stack
        });
        await ctx.reply('⚠️ Произошла ошибка при загрузке пользователей.');
    }
};
/**
 * Обрабатывает переход на определенную страницу пользователей
 */
exports.handleUsersPage = async (ctx) => {
    if (!checkAdmin(ctx)) {
        return ctx.answerCbQuery('🚫 Только для администратора');
    }

    const page = parseInt(ctx.match[1]);

    try {
        await ctx.answerCbQuery(`Загружаю страницу ${page}...`);
        await showUsersPage(ctx, page);
    } catch (error) {
        console.error(`Ошибка при переходе на страницу пользователей ${page}:`, error);
        await ctx.answerCbQuery('⚠️ Ошибка при загрузке страницы!');
        await ctx.reply('⚠️ Произошла ошибка при переходе на страницу.');
    }
};

/**
 * Возвращает эмодзи для статуса пользователя
 */
const getStatusEmoji = (status) => {
    switch (status) {
        case 'active': return '✅';
        case 'pending': return '⏳';
        case 'rejected': return '❌';
        case 'inactive': return '⚪';
        default: return '❓';
    }
};

/**
 * Возвращает текстовое описание статуса
 */
const getStatusText = (status) => {
    switch (status) {
        case 'active': return 'Активна';
        case 'pending': return 'На проверке';
        case 'rejected': return 'Отклонена';
        case 'inactive': return 'Неактивна';
        default: return 'Неизвестно';
    }
};

/**
 * Возвращает информацию о подписке пользователя
 */
const getSubscriptionInfo = (user) => {
    if (user.status === 'active' && user.expireDate) {
        const now = new Date();
        const expireDate = new Date(user.expireDate);

        if (expireDate > now) {
            const daysLeft = Math.ceil((expireDate - now) / (1000 * 60 * 60 * 24));
            return `Истекает: ${formatDate(expireDate)} (${daysLeft} дн.)`;
        } else {
            return `Истекла: ${formatDate(expireDate)}`;
        }
    } else if (user.status === 'pending') {
        return 'Ожидает подтверждения оплаты';
    } else if (user.status === 'rejected') {
        return user.rejectionReason ? `Отклонена: ${user.rejectionReason}` : 'Отклонена';
    } else {
        return 'Подписки нет';
    }
};

/**
 * Показывает отзывы о VPN
 */
exports.listReviews = async (ctx) => {
    if (!checkAdmin(ctx)) {
        return ctx.answerCbQuery('🚫 Только для администратора');
    }

    try {
        // Показываем первую страницу отзывов
        await showReviewsPage(ctx, 1);

        if (ctx.callbackQuery) {
            await ctx.answerCbQuery();
        }
    } catch (error) {
        console.error('Ошибка при получении отзывов:', error);
        if (ctx.callbackQuery) {
            await ctx.answerCbQuery('Произошла ошибка!');
        }
        await ctx.reply('⚠️ Произошла ошибка при загрузке отзывов.');
    }
};

/**
 * Показывает страницу с отзывами
 */
const showReviewsPage = async (ctx, page = 1) => {
    const REVIEWS_PER_PAGE = 5; // Количество отзывов на страницу
    const skip = (page - 1) * REVIEWS_PER_PAGE;

    try {
        // Получаем общее количество отзывов
        const totalReviews = await Review.countDocuments();

        if (totalReviews === 0) {
            return ctx.reply('⭐ Отзывов пока нет.');
        }

        // Получаем отзывы для текущей страницы
        const reviews = await Review.find({})
            .sort({ createdAt: -1 }) // Сортируем по дате (новые сначала)
            .skip(skip)
            .limit(REVIEWS_PER_PAGE);

        const totalPages = Math.ceil(totalReviews / REVIEWS_PER_PAGE);

        // Вычисляем средний рейтинг
        const avgRatingResult = await Review.aggregate([
            { $group: { _id: null, avgRating: { $avg: "$rating" } } }
        ]);
        const avgRating = avgRatingResult.length > 0 ? avgRatingResult[0].avgRating.toFixed(1) : '0.0';

        // Формируем сообщение с отзывами
        let message = `⭐ *Отзывы о VPN*\n\n`;
        message += `📊 Средний рейтинг: ${avgRating}/5 (${totalReviews} отзывов)\n`;
        message += `📄 Страница ${page} из ${totalPages}\n\n`;

        for (const review of reviews) {
            const stars = '⭐'.repeat(review.rating);
            const speedText = getReviewSpeedText(review.vpnSpeed);
            const stabilityText = getReviewStabilityText(review.vpnStability);

            message += `${stars} *${review.firstName || review.username || 'Аноним'}*\n`;
            message += `   ID: \`${review.userId}\`\n`;
            message += `   🚀 Скорость: ${speedText}\n`;
            message += `   🔒 Стабильность: ${stabilityText}\n`;
            if (review.comment) {
                message += `   💬 "${review.comment}"\n`;
            }
            message += `   📅 ${formatDate(review.createdAt, true)}\n\n`;
        }

        // Создаем кнопки навигации
        const navigationButtons = [];

        if (totalPages > 1) {
            // Кнопка "Предыдущая страница"
            if (page > 1) {
                navigationButtons.push({ text: '⬅️ Предыдущая', callback_data: `reviews_page_${page - 1}` });
            }

            // Кнопка "Следующая страница"
            if (page < totalPages) {
                navigationButtons.push({ text: 'Следующая ➡️', callback_data: `reviews_page_${page + 1}` });
            }

            // Кнопка обновления
            navigationButtons.push({ text: '🔄 Обновить', callback_data: `reviews_page_${page}` });
        }

        const keyboard = [];
        if (navigationButtons.length > 0) {
            keyboard.push(navigationButtons);
        }
        keyboard.push([{ text: '🏠 Главное меню', callback_data: 'back_to_admin_menu' }]);

        await ctx.replyWithMarkdown(message, {
            reply_markup: {
                inline_keyboard: keyboard
            }
        });

    } catch (error) {
        console.error('Ошибка при показе страницы отзывов:', error);
        await ctx.reply('⚠️ Произошла ошибка при загрузке отзывов.');
    }
};

/**
 * Обрабатывает переход на определенную страницу отзывов
 */
exports.handleReviewsPage = async (ctx) => {
    if (!checkAdmin(ctx)) {
        return ctx.answerCbQuery('🚫 Только для администратора');
    }

    const page = parseInt(ctx.match[1]);

    try {
        await ctx.answerCbQuery(`Загружаю страницу ${page}...`);
        await showReviewsPage(ctx, page);
    } catch (error) {
        console.error(`Ошибка при переходе на страницу отзывов ${page}:`, error);
        await ctx.answerCbQuery('⚠️ Ошибка при загрузке страницы!');
        await ctx.reply('⚠️ Произошла ошибка при переходе на страницу.');
    }
};

/**
 * Возвращает текстовое описание скорости для отзывов
 */
const getReviewSpeedText = (speed) => {
    switch (speed) {
        case 'excellent': return 'Отлично';
        case 'good': return 'Хорошо';
        case 'average': return 'Средне';
        case 'poor': return 'Плохо';
        default: return 'Не указано';
    }
};

/**
 * Возвращает текстовое описание стабильности для отзывов
 */
const getReviewStabilityText = (stability) => {
    switch (stability) {
        case 'excellent': return 'Отлично';
        case 'good': return 'Хорошо';
        case 'average': return 'Средне';
        case 'poor': return 'Плохо';
        default: return 'Не указано';
    }
};

/**
 * Показывает меню массовой рассылки
 */
exports.showBroadcastMenu = async (ctx) => {
    if (!checkAdmin(ctx)) {
        return ctx.answerCbQuery('🚫 Только для администратора');
    }

    try {
        const totalUsers = await User.countDocuments();
        const activeUsers = await User.countDocuments({ status: 'active' });
        const inactiveUsers = await User.countDocuments({ status: 'inactive' });
        const pendingUsers = await User.countDocuments({ status: 'pending' });

        await ctx.reply(
            `📢 *Массовая рассылка*\n\n` +
            `👥 Всего пользователей: ${totalUsers}\n` +
            `✅ Активных: ${activeUsers}\n` +
            `⚪ Неактивных: ${inactiveUsers}\n` +
            `⏳ На проверке: ${pendingUsers}\n\n` +
            `Выберите группу для рассылки:`,
            {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [
                            { text: '👥 Всем пользователям', callback_data: 'broadcast_all' },
                            { text: '✅ Только активным', callback_data: 'broadcast_active' }
                        ],
                        [
                            { text: '⚪ Только неактивным', callback_data: 'broadcast_inactive' },
                            { text: '⏳ Ожидающим проверки', callback_data: 'broadcast_pending' }
                        ],
                        [
                            { text: '🏠 Главное меню', callback_data: 'back_to_admin_menu' }
                        ]
                    ]
                }
            }
        );

        if (ctx.callbackQuery) {
            await ctx.answerCbQuery();
        }

    } catch (error) {
        console.error('Ошибка при показе меню рассылки:', error);
        if (ctx.callbackQuery) {
            await ctx.answerCbQuery('Произошла ошибка!');
        }
        await ctx.reply('⚠️ Произошла ошибка при загрузке меню рассылки.');
    }
};

/**
 * Инициирует процесс создания рассылки
 */
exports.startBroadcast = async (ctx) => {
    if (!checkAdmin(ctx)) {
        return ctx.answerCbQuery('🚫 Только для администратора');
    }

    const targetGroup = ctx.match[1];

    try {
        // Сохраняем целевую группу в сессии
        ctx.session.broadcastTarget = targetGroup;
        ctx.session.awaitingBroadcastMessage = true;

        const groupNames = {
            'all': 'всем пользователям',
            'active': 'активным пользователям',
            'inactive': 'неактивным пользователям',
            'pending': 'пользователям на проверке'
        };

        await ctx.editMessageText(
            `✍️ *Создание рассылки*\n\n` +
            `Целевая группа: ${groupNames[targetGroup]}\n\n` +
            `Напишите сообщение для рассылки:\n` +
            `(поддерживается Markdown форматирование)`,
            {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '❌ Отмена', callback_data: 'cancel_broadcast' }]
                    ]
                }
            }
        );

        await ctx.answerCbQuery();

    } catch (error) {
        console.error('Ошибка при инициации рассылки:', error);
        await ctx.answerCbQuery('⚠️ Произошла ошибка!');
        await ctx.reply('⚠️ Произошла ошибка при создании рассылки.');
    }
};

/**
 * Подтверждает и выполняет рассылку
 */
exports.confirmBroadcast = async (ctx, message) => {
    if (!checkAdmin(ctx)) {
        return ctx.reply('🚫 Только для администратора');
    }

    const targetGroup = ctx.session.broadcastTarget;

    try {
        // Получаем количество пользователей для рассылки
        let filter = {};
        switch (targetGroup) {
            case 'active':
                filter = { status: 'active' };
                break;
            case 'inactive':
                filter = { status: 'inactive' };
                break;
            case 'pending':
                filter = { status: 'pending' };
                break;
            case 'all':
            default:
                filter = {};
                break;
        }

        const userCount = await User.countDocuments(filter);

        if (userCount === 0) {
            delete ctx.session.broadcastTarget;
            delete ctx.session.awaitingBroadcastMessage;
            delete ctx.session.broadcastMessage;
            return ctx.reply('⚠️ Нет пользователей в выбранной группе для рассылки.');
        }

        // Сохраняем сообщение в сессии
        ctx.session.broadcastMessage = message;

        const groupNames = {
            'all': 'всем пользователям',
            'active': 'активным пользователям',
            'inactive': 'неактивным пользователям',
            'pending': 'пользователям на проверке'
        };

        // Показываем превью сообщения
        await ctx.reply(
            `📋 *Подтверждение рассылки*\n\n` +
            `Целевая группа: ${groupNames[targetGroup]} (${userCount} чел.)\n\n` +
            `*Превью сообщения:*\n` +
            `${message}\n\n` +
            `Подтвердите отправку:`,
            {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [
                            { text: '✅ Отправить', callback_data: 'execute_broadcast' },
                            { text: '❌ Отмена', callback_data: 'cancel_broadcast' }
                        ]
                    ]
                }
            }
        );

    } catch (error) {
        console.error('Ошибка при подтверждении рассылки:', error);
        await ctx.reply('⚠️ Произошла ошибка при подготовке рассылки.');
    }
};

/**
 * Выполняет массовую рассылку
 */
exports.executeBroadcast = async (ctx) => {
    if (!checkAdmin(ctx)) {
        return ctx.answerCbQuery('🚫 Только для администратора');
    }

    const targetGroup = ctx.session.broadcastTarget;
    const message = ctx.session.broadcastMessage;

    if (!targetGroup || !message) {
        await ctx.answerCbQuery('⚠️ Данные рассылки не найдены');
        return ctx.reply('⚠️ Данные рассылки не найдены. Попробуйте начать заново.');
    }

    try {
        await ctx.answerCbQuery('Начинаю рассылку...');
        await ctx.editMessageText('🚀 *Рассылка запущена!*\n\nОтправляю сообщения...', { parse_mode: 'Markdown' });

        // Получаем пользователей для рассылки
        let filter = {};
        switch (targetGroup) {
            case 'active':
                filter = { status: 'active' };
                break;
            case 'inactive':
                filter = { status: 'inactive' };
                break;
            case 'pending':
                filter = { status: 'pending' };
                break;
            case 'all':
            default:
                filter = {};
                break;
        }

        const users = await User.find(filter).select('userId firstName username');

        let successCount = 0;
        let errorCount = 0;
        const errors = [];

        // Отправляем сообщения с задержкой для избежания лимитов Telegram
        for (const user of users) {
            try {
                await ctx.telegram.sendMessage(user.userId, message, { parse_mode: 'Markdown' });
                successCount++;

                // Задержка между сообщениями (30 сообщений в секунду - лимит Telegram)
                await new Promise(resolve => setTimeout(resolve, 35));

            } catch (error) {
                errorCount++;
                errors.push({
                    userId: user.userId,
                    name: user.firstName || user.username || 'Неизвестный',
                    error: error.message
                });

                // Если пользователь заблокировал бота, можно пометить его как неактивного
                if (error.code === 403) {
                    console.log(`Пользователь ${user.userId} заблокировал бота`);
                }
            }
        }

        // Очищаем сессию
        delete ctx.session.broadcastTarget;
        delete ctx.session.awaitingBroadcastMessage;
        delete ctx.session.broadcastMessage;

        // Отчет о рассылке
        let reportMessage = `✅ *Рассылка завершена!*\n\n` +
            `📊 Статистика:\n` +
            `✅ Успешно отправлено: ${successCount}\n` +
            `❌ Ошибок: ${errorCount}\n` +
            `👥 Всего пользователей: ${users.length}`;

        if (errorCount > 0 && errorCount <= 5) {
            reportMessage += `\n\n⚠️ Ошибки:\n`;
            errors.slice(0, 5).forEach(err => {
                reportMessage += `• ${err.name} (${err.userId}): ${err.error.substring(0, 50)}...\n`;
            });
        } else if (errorCount > 5) {
            reportMessage += `\n\n⚠️ Показаны первые 5 ошибок из ${errorCount}`;
        }

        await ctx.editMessageText(reportMessage, { parse_mode: 'Markdown' });

        // Логирование
        console.log(`[BROADCAST] Admin ${ctx.from.id} sent broadcast to ${targetGroup}: ${successCount} success, ${errorCount} errors`);

    } catch (error) {
        console.error('Ошибка при выполнении рассылки:', error);
        await ctx.reply('⚠️ Произошла критическая ошибка при выполнении рассылки.');

        // Очищаем сессию при ошибке
        delete ctx.session.broadcastTarget;
        delete ctx.session.awaitingBroadcastMessage;
        delete ctx.session.broadcastMessage;
    }
};

/**
 * Отменяет создание рассылки
 */
exports.cancelBroadcast = async (ctx) => {
    if (!checkAdmin(ctx)) {
        return ctx.answerCbQuery('🚫 Только для администратора');
    }

    try {
        // Очищаем сессию
        delete ctx.session.broadcastTarget;
        delete ctx.session.awaitingBroadcastMessage;
        delete ctx.session.broadcastMessage;

        await ctx.editMessageText('❌ Создание рассылки отменено.');
        await ctx.answerCbQuery();

    } catch (error) {
        console.error('Ошибка при отмене рассылки:', error);
        await ctx.answerCbQuery('⚠️ Произошла ошибка!');
    }
};