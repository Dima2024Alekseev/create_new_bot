const User = require('../models/User');
const { Markup } = require('telegraf');
const { checkAdmin } = require('../utils/auth');
const { formatDate, escapeMarkdown, transliterate } = require('../utils/helpers');
const { createVpnClient } = require('../services/vpnService');
const path = require('path');

/**
 * Обрабатывает загруженный пользователем скриншот оплаты.
 * Сохраняет скриншот в БД и отправляет его администратору для проверки.
 * @param {object} ctx - Объект контекста Telegraf.
 */
exports.handlePhoto = async (ctx) => {
    const { id, first_name, username } = ctx.from;
    // Если это админ, и он случайно отправил фото, игнорируем его.
    if (id === parseInt(process.env.ADMIN_ID)) {
        return ctx.reply('Вы в режиме админа, скриншоты не требуются.');
    }
    // Получаем ID последнего (самого большого) фото из массива
    const photo = ctx.message.photo.pop();
    try {
        // Находим или создаем пользователя и обновляем информацию о платеже
        await User.findOneAndUpdate(
            { userId: id },
            {
                userId: id,
                username: username || first_name, // Сохраняем username или first_name для пользователя
                firstName: first_name,
                paymentPhotoId: photo.file_id,
                paymentPhotoDate: new Date(), // Добавлено: сохраняет дату отправки скриншота
                status: 'pending' // Статус ожидания проверки
            },
            { upsert: true, new: true } // Создать, если не существует; вернуть обновленный документ
        );
        // Подготавливаем кнопки для администратора
        const keyboard = Markup.inlineKeyboard([
            Markup.button.callback('✅ Принять', `approve_${id}`),
            Markup.button.callback('❌ Отклонить', `reject_${id}`)
        ]);
        // НОВОЕ: Более надёжное формирование строки с именем пользователя для отображения
        let userDisplay = '';
        // Всегда экранируем first_name (если есть, иначе используем заглушку)
        const safeFirstName = escapeMarkdown(first_name || 'Не указано');
        if (username) {
            // Если username есть, используем его с @ и экранируем
            userDisplay = `${safeFirstName} (@${escapeMarkdown(username)})`;
        } else {
            // Если username нет, используем только safeFirstName и явно указываем отсутствие username
            userDisplay = `${safeFirstName} (без username)`;
        }
        // Если по какой-то причине first_name тоже пустой (редко, но возможно)
        if (!first_name && !username) {
            userDisplay = `Неизвестный пользователь`;
        }
        await ctx.telegram.sendPhoto(
            process.env.ADMIN_ID,
            photo.file_id,
            {
                caption: `📸 *Новый платёж от пользователя:*\n` +
                    `Имя: ${userDisplay}\n` + // ИСПОЛЬЗУЕМ НОВУЮ СТРОКУ userDisplay
                    `ID: ${id}`,
                parse_mode: 'Markdown', // Указываем режим парсинга для Markdown в подписи
                ...keyboard // Разворачиваем кнопки
            }
        );
        await ctx.reply('✅ Скриншот получен! Админ проверит его в ближайшее время.');
    } catch (error) {
        console.error('Ошибка при обработке фото/платежа:', error);
        await ctx.reply('⚠️ Произошла ошибка при получении вашего скриншота. Пожалуйста, попробуйте позже.');
    }
};

/**
 * Обрабатывает одобрение платежа администратором.
 * Активирует подписку пользователя и отправляет уведомление.
 * @param {object} ctx - Объект контекста Telegraf.
 */
exports.handleApprove = async (ctx) => {
    if (!checkAdmin(ctx)) {
        return ctx.answerCbQuery('🚫 Только для админа');
    }
    const userId = parseInt(ctx.match[1]);
    try {
        const user = await User.findOne({ userId });
        
        let newExpireDate;
        const today = new Date();
        const existingExpireDate = user?.expireDate;

        // НОВАЯ ЛОГИКА: Если подписка активна и не истекла, продлеваем её
        if (user && user.status === 'active' && existingExpireDate && existingExpireDate > today) {
            newExpireDate = new Date(existingExpireDate);
            newExpireDate.setMonth(newExpireDate.getMonth() + 1);
        } else {
            // Иначе, начинаем новую подписку с сегодняшнего дня
            newExpireDate = new Date();
            newExpireDate.setMonth(newExpireDate.getMonth() + 1);
        }
        
        // Устанавливаем время на конец дня для всех новых подписок
        newExpireDate.setHours(23, 59, 59, 999);

        const updatedUser = await User.findOneAndUpdate(
            { userId },
            {
                status: 'active',
                expireDate: newExpireDate,
                paymentPhotoId: null,
                paymentPhotoDate: null,
                $inc: { subscriptionCount: 1 }
            },
            { new: true, upsert: true }
        );

        await ctx.answerCbQuery('✅ Платёж принят');
        await ctx.deleteMessage();

        // НОВАЯ ЛОГИКА: Обработка первого платежа
        if (updatedUser.subscriptionCount === 1) {
            try {
                let clientName;
                if (updatedUser.username) {
                    clientName = transliterate(updatedUser.username);
                    clientName = clientName.replace(/[^a-zA-Z0-9_]/g, '');
                } else {
                    clientName = `telegram_${userId}`;
                }
                if (clientName.length === 0) {
                    clientName = `telegram_${userId}`;
                }

                const configContent = await createVpnClient(clientName);
                
                await ctx.telegram.sendMessage(
                    userId,
                    `🎉 *Платёж подтверждён!* 🎉\n\n` +
                    `Доступ к VPN активен до *${formatDate(newExpireDate, true)}*\n\n` +
                    `📁 Ваш файл конфигурации VPN:`,
                    { parse_mode: 'Markdown' }
                );

                await ctx.telegram.sendDocument(
                    userId,
                    { source: Buffer.from(configContent), filename: `${clientName}.conf` }
                );

                const videoPath = path.join(__dirname, '../videos/instruction.mp4');
                await ctx.telegram.sendVideo(
                    userId,
                    { source: videoPath },
                    { caption: '🎬 *Видеоинструкция* по настройке VPN:' }
                );

                // НОВОЕ ОПОВЕЩЕНИЕ ДЛЯ АДМИНА
                let userName = updatedUser?.firstName || updatedUser?.username || 'Без имени';
                if (updatedUser?.username) {
                    userName = `${userName} (@${updatedUser.username})`;
                }
                await ctx.telegram.sendMessage(
                    process.env.ADMIN_ID,
                    `🎉 *Автоматическая отправка завершена!* 🎉\n\n` +
                    `Пользователю ${userName} (ID: ${userId}) отправлен файл конфигурации и видеоинструкция.`
                );

                await ctx.telegram.sendMessage(
                    userId,
                    'После просмотра видео, пожалуйста, сообщите, удалось ли вам настроить VPN:',
                    Markup.inlineKeyboard([
                        [
                            Markup.button.callback('✅ Успешно настроил', `vpn_configured_${userId}`),
                            Markup.button.callback('❌ Не справился с настройкой', `vpn_failed_${userId}`)
                        ]
                    ])
                );

            } catch (vpnError) {
                console.error(`Ошибка при создании/отправке VPN конфига для ${userId}:`, vpnError);
                await ctx.telegram.sendMessage(
                    userId,
                    `⚠️ *Произошла ошибка при автоматической генерации файла конфигурации VPN.*` +
                    `\nПожалуйста, свяжитесь с администратором.`
                );
                await ctx.reply(
                    `⚠️ Произошла ошибка при создании VPN конфига для пользователя ${userId}. ` +
                    `Сообщи ему, что файл будет отправлен вручную.`
                );
            }
        } else {
            // ЛОГИКА: Обработка продления подписки
            let message = `🎉 *Платёж подтверждён!* 🎉\n\n` +
                `Ваша подписка успешно продлена до *${formatDate(newExpireDate, true)}*.`;
            await ctx.telegram.sendMessage(
                userId,
                message,
                { parse_mode: 'Markdown' }
            );
        }
    } catch (error) {
        console.error(`Ошибка при одобрении платежа для пользователя ${userId}:`, error);
        await ctx.answerCbQuery('⚠️ Ошибка при одобрении платежа!');
        await ctx.reply('⚠️ Произошла ошибка при одобрении платежа. Проверьте логи.');
    }
};

/**
 * Обрабатывает отклонение платежа администратором.
 * Устанавливает статус пользователя как "rejected" и уведомляет его.
 * @param {object} ctx - Объект контекста Telegraf.
 */
exports.handleReject = async (ctx) => {
    if (!checkAdmin(ctx)) {
        return ctx.answerCbQuery('🚫 Только для админа');
    }
    const userId = parseInt(ctx.match[1]);
    try {
        await User.findOneAndUpdate(
            { userId },
            {
                status: 'rejected',
                paymentPhotoId: null,
                paymentPhotoDate: null
            }
        );
        await ctx.telegram.sendMessage(
            userId,
            '❌ *Платёж отклонён*\n\n' +
            'Возможные причины:\n' +
            '- Неверная сумма\n' +
            '- Нет комментария к платежу\n' +
            '- Нечитаемый скриншот\n\n' +
            '*Попробуйте отправить чек ещё раз.*',
            { parse_mode: 'Markdown' }
        );
        await ctx.answerCbQuery('❌ Платёж отклонён');
        await ctx.deleteMessage();
    } catch (error) {
        console.error(`Ошибка при отклонении платежа для пользователя ${userId}:`, error);
        await ctx.answerCbQuery('⚠️ Ошибка при отклонении платежа!');
        await ctx.reply('⚠️ Произошла ошибка при отклонении платежа. Проверьте логи.');
    }
};