const User = require('../models/User');
const { Markup } = require('telegraf');
const { checkAdmin } = require('../utils/auth');
const { formatDate, escapeMarkdown } = require('../utils/helpers');
const wgService = require('../services/wireguardService'); // НОВОЕ: Импорт wireguardService

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

        // Если пользователя нет или он уже неактивен, возможно, это повторное одобрение или ошибка.
        if (!user) {
            await ctx.answerCbQuery('🚫 Пользователь не найден.');
            return ctx.reply(`⚠️ Пользователь с ID ${userId} не найден в базе данных. Невозможно одобрить платёж.`);
        }

        let newExpireDate = new Date();

        if (user.expireDate && user.expireDate > new Date()) {
            // Если подписка активна, продлеваем от текущей даты истечения
            newExpireDate = new Date(user.expireDate);
        }
        // Добавляем месяц
        newExpireDate.setMonth(newExpireDate.getMonth() + 1);
        newExpireDate.setHours(23, 59, 59, 999); // Устанавливаем конец дня

        // НОВОЕ: Логика создания клиента WireGuard и получения конфига
        let wgClientId = user.wgClientId;
        let fileBuffer;
        let qrCodeBuffer;
        let vpnSetupSuccess = true; // Флаг для отслеживания успешности создания VPN-клиента

        // Создаем клиента WG-Easy только если его еще нет у пользователя
        if (!wgClientId) { 
            try {
                // Используем username или firstName для имени клиента WireGuard
                const clientName = user.username || user.firstName || `user_${userId}`;
                const wgClient = await wgService.createWgClient(clientName);
                wgClientId = wgClient.id; // Получаем ID созданного клиента WireGuard
                
                fileBuffer = await wgService.getWgClientConfig(wgClientId);
                qrCodeBuffer = await wgService.getWgClientQrCode(wgClientId);
                
                // Сохраняем wgClientId в базе данных пользователя
                await User.findOneAndUpdate(
                    { userId },
                    { wgClientId: wgClientId }
                );

            } catch (wgError) {
                console.error(`❌ Ошибка работы с WG-Easy API для пользователя ${userId}:`, wgError);
                vpnSetupSuccess = false; // Отмечаем, что VPN не был настроен
                await ctx.telegram.sendMessage(
                    process.env.ADMIN_ID,
                    `⚠️ Ошибка при создании VPN-клиента или получении конфига для пользователя ${userId} (${user.firstName || user.username}).\n` +
                    `Ошибка: ${escapeMarkdown(wgError.message)}\n` +
                    `_Возможно, потребуется ручная настройка._`
                );
            }
        } else {
            console.log(`[handleApprove] Клиент WG-Easy уже существует для ${userId}: ${wgClientId}. Пропуск создания.`);
            // Если клиент уже существует, предполагаем, что это продление,
            // и конфиг уже был отправлен ранее.
        }

        // Обновляем пользователя: активируем статус, устанавливаем дату истечения,
        // очищаем ID скриншота и увеличиваем счетчик подписок.
        const updatedUser = await User.findOneAndUpdate(
            { userId },
            {
                status: 'active',
                expireDate: newExpireDate,
                paymentPhotoId: null, // Очищаем ID скриншота после одобрения
                paymentPhotoDate: null, // Очищаем дату скриншота
                $inc: { subscriptionCount: 1 } // Увеличиваем счетчик подписок
            },
            { new: true, upsert: true }
        );

        let message = `🎉 *Платёж подтверждён!* 🎉\n\n` +
                      `Доступ к VPN активен до *${formatDate(newExpireDate, true)}*\n\n`;

        let keyboard = Markup.inlineKeyboard([]);

        // ОТПРАВКА КОНФИГА И ИНСТРУКЦИИ ПРИ ПЕРВОЙ АКТИВАЦИИ И УСПЕШНОМ СОЗДАНИИ VPN
        if (updatedUser.subscriptionCount === 1 && vpnSetupSuccess) {
            message += `Ниже вы найдёте ваш файл конфигурации VPN и QR-код для быстрой настройки.\n`;
            message += `Также я пришлю видеоинструкцию для удобства.\n\n`;

            // Отправляем файл конфига (.conf)
            const configFileName = `wg-config-${userId}.conf`;
            await ctx.telegram.sendDocument(
                userId,
                { source: fileBuffer, filename: configFileName }, // Передаем буфер и имя файла
                { caption: '📁 Ваш файл конфигурации WireGuard:' }
            );

            // Отправляем QR-код
            await ctx.telegram.sendPhoto(
                userId,
                { source: qrCodeBuffer, filename: `wg-qr-${userId}.svg` }, // SVG-изображение
                { caption: '📸 QR-код для настройки WireGuard:' }
            );
            
            // Отправляем видео-инструкцию, если file_id указан в .env
            if (process.env.VPN_VIDEO_FILE_ID) {
                await ctx.telegram.sendVideo(
                    userId,
                    process.env.VPN_VIDEO_FILE_ID,
                    { caption: '🎬 Видеоинструкция по настройке VPN:' }
                );
            } else {
                message += `_Для получения видеоинструкции, пожалуйста, используйте кнопку "Получить файл и инструкцию" в главном меню._\n`;
            }

            // Добавляем кнопки подтверждения настройки
            keyboard = Markup.inlineKeyboard([
                [
                    Markup.button.callback('✅ Успешно настроил', `vpn_configured_${userId}`),
                    Markup.button.callback('❌ Не справился с настройкой', `vpn_failed_${userId}`)
                ]
            ]);

        } else if (updatedUser.subscriptionCount > 1) {
            message += `Ваша подписка успешно продлена.`;
            // Для продления можно просто дать кнопку "Посмотреть срок действия" или "Главное меню"
            keyboard = Markup.inlineKeyboard([
                [Markup.button.callback('🗓 Посмотреть срок действия подписки', 'check_subscription')]
            ]);
        } else { // Если vpnSetupSuccess = false (т.е. при первой подписке что-то пошло не так с VPN)
            message += `⚠️ Возникла проблема при автоматической выдаче VPN-конфига. Администратор уже уведомлен и свяжется с вами для ручной настройки.`;
            keyboard = Markup.inlineKeyboard([
                [Markup.button.callback('❓ Задать вопрос', 'ask_question')] // Дать возможность задать вопрос
            ]);
        }
        
        // Отправляем сообщение пользователю
        await ctx.telegram.sendMessage(
            userId,
            message,
            keyboard.reply_markup ? { parse_mode: 'Markdown', ...keyboard } : { parse_mode: 'Markdown' }
        );

        await ctx.answerCbQuery('✅ Платёж принят'); // Отвечаем на callbackQuery
        await ctx.deleteMessage(); // Удаляем сообщение со скриншотом в админ-чате
    } catch (error) {
        console.error(`Ошибка при одобрении платежа для пользователя ${userId}:`, error);
        await ctx.answerCbQuery('⚠️ Ошибка при одобрении платежа!');
        await ctx.reply('⚠️ Произошла ошибка при одобрении платежа. Проверьте логи.');
        // Дополнительно: уведомить админа, если произошла общая ошибка обработки
        await ctx.telegram.sendMessage(
            process.env.ADMIN_ID,
            `⚠️ Произошла общая ошибка при одобрении платежа для пользователя ${userId}: ${escapeMarkdown(error.message)}`
        );
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