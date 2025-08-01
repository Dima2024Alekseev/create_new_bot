const User = require('../models/User');
const { Markup } = require('telegraf');
const { checkAdmin } = require('../utils/auth');
const { formatDate, escapeMarkdown, transliterate } = require('../utils/helpers');
const { createVpnClient } = require('../services/vpnService');
const path = require('path');

exports.handlePhoto = async (ctx) => {
    const { id, first_name, username } = ctx.from;
    if (id === parseInt(process.env.ADMIN_ID)) {
        return ctx.reply('Вы в режиме админа, скриншоты не требуются.');
    }

    const photo = ctx.message.photo.pop();
    try {
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

        await ctx.telegram.sendPhoto(
            process.env.ADMIN_ID,
            photo.file_id,
            {
                caption: `📸 *Новый платёж от пользователя:*\nИмя: ${userDisplay}\nID: ${id}`,
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

exports.handleApprove = async (ctx) => {
    if (!checkAdmin(ctx)) {
        return ctx.answerCbQuery('🚫 Только для админа');
    }

    const userId = parseInt(ctx.match[1]);
    try {
        const user = await User.findOne({ userId });
        if (!user) {
            return ctx.answerCbQuery('⚠️ Пользователь не найден!');
        }

        const today = new Date();
        let newExpireDate = new Date();

        // Если есть активная подписка - продлеваем от текущей даты окончания
        if (user.status === 'active' && user.expireDate && user.expireDate > today) {
            newExpireDate = new Date(user.expireDate);
        }
        
        // Добавляем 1 месяц (учитываем переход через год)
        newExpireDate.setMonth(newExpireDate.getMonth() + 1);
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
            { new: true }
        );

        await ctx.answerCbQuery('✅ Платёж принят');
        await ctx.deleteMessage();

        if (updatedUser.subscriptionCount === 1) {
            try {
                let clientName = updatedUser.username 
                    ? transliterate(updatedUser.username).replace(/[^a-zA-Z0-9_]/g, '')
                    : `telegram_${userId}`;
                
                if (!clientName) clientName = `telegram_${userId}`;
                
                const configContent = await createVpnClient(clientName);
                
                await ctx.telegram.sendMessage(
                    userId,
                    `🎉 *Платёж подтверждён!* 🎉\n\nДоступ к VPN активен до *${formatDate(newExpireDate, true)}*\n\n📁 Ваш файл конфигурации VPN:`,
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

                let userName = updatedUser.firstName || updatedUser.username || 'Без имени';
                if (updatedUser.username) {
                    userName = `${userName} (@${updatedUser.username})`;
                }

                await ctx.telegram.sendMessage(
                    process.env.ADMIN_ID,
                    `🎉 *Автоматическая отправка завершена!*\n\nПользователю ${userName} (ID: ${userId}) отправлен файл конфигурации.`
                );

                await ctx.telegram.sendMessage(
                    userId,
                    'После просмотра видео, пожалуйста, сообщите:',
                    Markup.inlineKeyboard([
                        [
                            Markup.button.callback('✅ Успешно', `vpn_configured_${userId}`),
                            Markup.button.callback('❌ Проблемы', `vpn_failed_${userId}`)
                        ]
                    ])
                );
            } catch (vpnError) {
                console.error(`Ошибка при создании VPN конфига для ${userId}:`, vpnError);
                await ctx.telegram.sendMessage(
                    userId,
                    '⚠️ *Ошибка при генерации VPN конфига*\nСвяжитесь с администратором.'
                );
                await ctx.reply(
                    `⚠️ Ошибка VPN конфига для ${userId}. Отправьте файл вручную.`
                );
            }
        } else {
            await ctx.telegram.sendMessage(
                userId,
                `🎉 *Подписка продлена!*\n\nДоступ до *${formatDate(newExpireDate, true)}*`,
                { parse_mode: 'Markdown' }
            );
        }
    } catch (error) {
        console.error(`Ошибка при одобрении платежа для ${userId}:`, error);
        await ctx.answerCbQuery('⚠️ Ошибка при одобрении!');
        await ctx.reply('⚠️ Проверьте логи.');
    }
};

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
            '❌ *Платёж отклонён*\n\nПричины:\n- Неверная сумма\n- Нет комментария\n- Нечитаемый скриншот\n\n*Отправьте чек ещё раз.*',
            { parse_mode: 'Markdown' }
        );

        await ctx.answerCbQuery('❌ Платёж отклонён');
        await ctx.deleteMessage();
    } catch (error) {
        console.error(`Ошибка при отклонении платежа для ${userId}:`, error);
        await ctx.answerCbQuery('⚠️ Ошибка при отклонении!');
        await ctx.reply('⚠️ Проверьте логи.');
    }
};