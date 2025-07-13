const User = require('../models/User');
const Question = require('../models/Question');
const { formatDate } = require('../utils/helpers'); // Убедитесь, что этот путь верен
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
 * Отображает основное меню администратора.
 * @param {object} ctx - Объект контекста Telegraf.
 */
exports.checkAdminMenu = async (ctx) => {
    if (!exports.checkAdmin(ctx)) {
        return ctx.reply('🚫 Эта команда доступна только администратору.');
    }
    await ctx.reply('👋 Привет, Админ! Выберите действие:', Markup.inlineKeyboard([
        [Markup.button.callback('Проверить заявки на оплату', 'check_payments_admin')],
        [Markup.button.callback('Посмотреть статистику', 'refresh_stats')],
        // Можно добавить кнопку для рассылки, если не хотите использовать команду напрямую
        // [Markup.button.callback('Сделать рассылку', 'prompt_broadcast')] 
    ]));
    // Важно ответить на callbackQuery, если вызов был по кнопке
    if (ctx.callbackQuery) {
        await ctx.answerCbQuery();
    }
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
            // Важно ответить на callbackQuery
            return ctx.answerCbQuery();
        }

        // Перебираем каждую заявку
        for (const user of pendingUsers) {
            // Формируем общую информацию о заявке
            let message = `📸 *Заявка на оплату от пользователя:*\n` +
                          `ID: ${user.userId}\n` +
                          `Имя: ${user.firstName || 'Не указано'}\n` +
                          `Username: ${user.username ? `@${user.username}` : 'Не указан'}\n` +
                          `Дата подачи: ${user.paymentPhotoDate ? formatDate(user.paymentPhotoDate) : 'Не указана'}`; 
            
            // Если ID скриншота присутствует, отправляем фото
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
                // Если paymentPhotoId отсутствует, отправляем текстовое уведомление
                await ctx.replyWithMarkdown(
                    `⚠️ *Заявка от пользователя ${user.firstName || user.username || 'Без имени'} (ID: ${user.userId}) без скриншота!*\n` +
                    `Возможно, пользователь не отправил фото или произошла ошибка сохранения.\n\n` +
                    `${message}`, 
                    { parse_mode: 'Markdown' }
                );
            }
        }
        // Важно ответить на callbackQuery
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

/**
 * Отправляет массовое сообщение всем пользователям бота.
 * @param {object} ctx - Объект контекста Telegraf.
 */
exports.broadcastMessage = async (ctx) => {
    // Проверка прав администратора
    if (!exports.checkAdmin(ctx)) {
        return ctx.reply('🚫 Эта команда доступна только администратору.');
    }

    // Текст сообщения для рассылки
    // Берем все, что идет после команды /broadcast
    const messageText = ctx.message.text.split(' ').slice(1).join(' '); 

    if (!messageText) {
        return ctx.reply('Пожалуйста, укажите текст для рассылки. Пример: `/broadcast Привет всем пользователям!`', { parse_mode: 'Markdown' });
    }

    let sentCount = 0;
    let blockedCount = 0;
    let errorCount = 0;

    try {
        const allUsers = await User.find({}); // Получаем всех пользователей из базы данных

        await ctx.reply(`Начинаю рассылку сообщения для ${allUsers.length} пользователей...`);

        for (const user of allUsers) {
            try {
                // Отправляем сообщение каждому пользователю
                await ctx.telegram.sendMessage(user.userId, messageText, { parse_mode: 'Markdown' });
                sentCount++;
                // Небольшая задержка, чтобы избежать ограничений Telegram API
                await new Promise(resolve => setTimeout(resolve, 50)); 
            } catch (userError) {
                // Обработка ошибок для каждого пользователя
                console.error(`Ошибка при отправке сообщения пользователю ${user.userId}:`, userError.message);
                if (userError.message.includes('bot was blocked by the user')) {
                    blockedCount++;
                    // Опционально: можно обновить статус пользователя в БД на 'blocked'
                    // await User.updateOne({ userId: user.userId }, { status: 'blocked' });
                } else {
                    errorCount++;
                }
            }
        }

        await ctx.reply(
            `✅ Рассылка завершена!\n` +
            `Отправлено сообщений: *${sentCount}*\n` +
            `Пользователей заблокировали бота: *${blockedCount}*\n` +
            `Другие ошибки отправки: *${errorCount}*`,
            { parse_mode: 'Markdown' }
        );

    } catch (error) {
        console.error('Глобальная ошибка при выполнении рассылки:', error);
        await ctx.reply('⚠️ Произошла ошибка при выполнении рассылки. Проверьте логи сервера.');
    }
};