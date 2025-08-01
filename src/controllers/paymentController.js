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

    // --- НАЧАЛО ДОБАВЛЕННОЙ ЛОГИКИ ---
    // 1. Сначала находим пользователя, чтобы проверить его статус
    const user = await User.findOne({ userId: id });

    if (user && user.status === 'pending') {
        return ctx.reply('⏳ Ваш скриншот уже на проверке у администратора. Пожалуйста, подождите.');
    }
    // --- КОНЕЦ ДОБАВЛЕННОЙ ЛОГИКИ ---

    // Получаем ID последнего (самого большого) фото из массива
    const photo = ctx.message.photo.pop();

    try {
        // Находим или создаем пользователя и обновляем информацию о платеже
        await User.findOneAndUpdate(
            { userId: id },
            {
                userId: id,
                username: username || first_name,
                firstName: first_name,
                paymentPhotoId: photo.file_id,
                paymentPhotoDate: new Date(),
                status: 'pending'
            },
            { upsert: true, new: true }
        );

        // Подготавливаем кнопки для администратора
        const keyboard = Markup.inlineKeyboard([
            Markup.button.callback('✅ Принять', `approve_${id}`),
            Markup.button.callback('❌ Отклонить', `reject_${id}`)
        ]);

        let userDisplay = '';
        const safeFirstName = escapeMarkdown(first_name || 'Не указано');

        if (username) {
            userDisplay = `${safeFirstName} (@${escapeMarkdown(username)})`;
        } else {
            userDisplay = `${safeFirstName} (без username)`;
        }
        if (!first_name && !username) {
            userDisplay = `Неизвестный пользователь`;
        }

        await ctx.telegram.sendPhoto(
            process.env.ADMIN_ID,
            photo.file_id,
            {
                caption: `📸 *Новый платёж от пользователя:*\n` +
                    `Имя: ${userDisplay}\n` +
                    `ID: ${id}`,
                parse_mode: 'Markdown',
                ...keyboard
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

        let newExpireDate = new Date();
        if (user && user.expireDate && user.expireDate > new Date()) {
            newExpireDate = new Date(user.expireDate);
        }
        // ВАЖНО: ВРЕМЕННОЕ РЕШЕНИЕ ДЛЯ ТЕСТИРОВАНИЯ
        // ПОСЛЕ ТЕСТИРОВАНИЯ ИЗМЕНИТЕ ОБРАТНО НА newExpireDate.setMonth(newExpireDate.getMonth() + 1);
        newExpireDate.setMinutes(newExpireDate.getMinutes() + 3);

        // --- НОВЫЙ БЛОК ДЛЯ СОХРАНЕНИЯ ИМЕНИ КЛИЕНТА ---
        let clientName = null;
        if (user.subscriptionCount === 0) {
            // Генерируем имя только для первого платежа
            if (user.username) {
                clientName = transliterate(user.username).replace(/[^a-zA-Z0-9_]/g, '');
            }
            if (!clientName) {
                clientName = `telegram_${userId}`;
            }
        } else {
            // Для продления подписки используем уже существующее имя
            clientName = user.vpnClientName;
        }
        // --- КОНЕЦ НОВОГО БЛОКА ---

        const updateData = {
            status: 'active',
            expireDate: newExpireDate,
            paymentPhotoId: null,
            paymentPhotoDate: null,
            $inc: { subscriptionCount: 1 }
        };
        // ЕСЛИ ЭТО ПЕРВЫЙ ПЛАТЕЖ, ДОБАВЛЯЕМ ИМЯ КЛИЕНТА В ОБНОВЛЕНИЕ
        if (user.subscriptionCount === 0) {
            updateData.vpnClientName = clientName;
            updateData.vpnConfigured = false;
        }

        const updatedUser = await User.findOneAndUpdate(
            { userId },
            updateData,
            { new: true, upsert: true }
        );

        await ctx.answerCbQuery('✅ Платёж принят');
        await ctx.deleteMessage();

        // Теперь проверяем subscriptionCount === 1, чтобы избежать повторной генерации
        if (updatedUser.subscriptionCount === 1) {
            try {
                const configContent = await createVpnClient(clientName);
                await ctx.telegram.sendMessage(
                    userId,
                    `🎉 *Платёж подтверждён!* 🎉\n\n` +
                    `Доступ к VPN активен до *${formatDate(newExpireDate, true)}*\n\n` +
                    `📁 Ваш файл конфигурации VPN и видеоинструкция отправлены ниже.`,
                    { parse_mode: 'Markdown' }
                );

                await ctx.telegram.sendDocument(
                    userId,
                    { source: Buffer.from(configContent), filename: `${clientName}.conf` }
                );

                const videoPath = path.join(__dirname, '..', 'videos', 'instruction.mp4');
                await ctx.telegram.sendVideo(
                    userId,
                    { source: videoPath },
                    { caption: '🎬 Видеоинструкция по настройке VPN' }
                );

                await ctx.telegram.sendMessage(
                    userId,
                    'Если вы успешно настроили VPN, пожалуйста, нажмите кнопку ниже. Если у вас возникли проблемы:',
                    Markup.inlineKeyboard([
                        [
                            Markup.button.callback('✅ Успешно настроил', `vpn_configured_${userId}`),
                            Markup.button.callback('❌ Не справился с настройкой', `vpn_failed_${userId}`)
                        ]
                    ])
                );

                await ctx.telegram.sendMessage(
                    process.env.ADMIN_ID,
                    `✅ *VPN-доступ успешно создан для пользователя:*\n\n` +
                    `Имя: ${updatedUser.firstName || updatedUser.username || 'Не указано'}\n` +
                    `ID: ${userId}\n` +
                    `Срок действия: ${formatDate(newExpireDate, true)}`,
                    { parse_mode: 'Markdown' }
                );

            } catch (vpnError) {
                console.error(`Ошибка при создании/отправке VPN конфига для ${userId}:`, vpnError);

                await ctx.telegram.sendMessage(
                    userId,
                    `⚠️ *Произошла ошибка при автоматической генерации файла конфигурации VPN.*` +
                    `\nПожалуйста, свяжитесь с администратором.`
                );

                await ctx.telegram.sendMessage(
                    process.env.ADMIN_ID,
                    `🚨 *Критическая ошибка при создании VPN для пользователя ${userId}:*\n` +
                    `\`\`\`\n${vpnError.stack}\n\`\`\``,
                    { parse_mode: 'Markdown' }
                );
            }
        } else {
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