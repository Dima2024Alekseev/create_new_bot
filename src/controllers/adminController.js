const User = require('../models/User');
const Question = require('../models/Question');
const { formatDate } = require('../utils/helpers');
const { Markup } = require('telegraf');
const { checkAdmin } = require('../utils/auth');
const { getConfig, setConfig } = require('../services/configService');

/**
 * Обрабатывает запрос на проверку ожидающих платежей с пагинацией.
 */
exports.checkPayments = async (ctx) => {
    if (!checkAdmin(ctx)) {
        return ctx.answerCbQuery('🚫 Только для админа');
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
        return ctx.answerCbQuery('🚫 Только для админа');
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
 * Отображает главное меню администратора с улучшенной кнопкой изменения цены.
 */
exports.checkAdminMenu = async (ctx) => {
    if (!checkAdmin(ctx)) {
        return;
    }

    const currentPrice = await getConfig('vpn_price', 132);

    const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('💳 Проверить платежи', 'check_payments_admin')],
        [Markup.button.callback('📊 Статистика', 'show_stats_admin')],
        [Markup.button.callback('👥 Список пользователей', 'list_users_admin')],
        [Markup.button.callback('❓ Все вопросы', 'list_questions')],
        [
            Markup.button.callback(
                `💰 Изменить цену (Текущая: ${currentPrice} ₽)`,
                'set_price_admin'
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
        return ctx.answerCbQuery('🚫 Только для админа');
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
    const USERS_PER_PAGE = 10; // Количество пользователей на страницу
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
            
            message += `${statusEmoji} *${user.firstName || user.username || 'Без имени'}*\n`;
            message += `   ID: \`${user.userId}\`\n`;
            if (user.username) {
                message += `   Username: @${user.username}\n`;
            }
            message += `   Статус: ${getStatusText(user.status)}\n`;
            message += `   ${subscriptionInfo}\n`;
            message += `   Подписок: ${user.subscriptionCount || 0}\n\n`;
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
        console.error('Ошибка при показе страницы пользователей:', error);
        await ctx.reply('⚠️ Произошла ошибка при загрузке пользователей.');
    }
};

/**
 * Обрабатывает переход на определенную страницу пользователей
 */
exports.handleUsersPage = async (ctx) => {
    if (!checkAdmin(ctx)) {
        return ctx.answerCbQuery('🚫 Только для админа');
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