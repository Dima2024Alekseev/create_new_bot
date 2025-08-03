const User = require('../models/User');
const { Markup } = require('telegraf');
const { checkAdmin } = require('../utils/auth');
const { formatDate, escapeMarkdown, transliterate } = require('../utils/helpers');
const { createVpnClient, enableVpnClient } = require('../services/vpnService');
const path = require('path');
const bot = require('../bot');

class PaymentController {
    /**
     * Обрабатывает загруженный пользователем скриншот оплаты
     */
    async handlePhoto(ctx) {
        if (!ctx.session.awaitingPaymentProof) {
            const userId = ctx.from.id;
            const user = await User.findOne({ userId });

            if (user && user.status === 'active') {
                return ctx.reply(
                    '⚠️ Ваша подписка ещё активна. Если вы хотите её продлить, ' +
                    'нажмите кнопку "Продлить подписку" в главном меню (/start).'
                );
            }
            return ctx.reply(
                '⚠️ Чтобы отправить скриншот, пожалуйста, сначала нажмите ' +
                'кнопку "Оплатить подписку" в главном меню (/start).'
            );
        }

        const { id, first_name, username } = ctx.from;

        // Админам не нужно отправлять скриншоты
        if (id === parseInt(process.env.ADMIN_ID)) {
            return ctx.reply('Вы в режиме админа, скриншоты не требуются.');
        }

        const user = await User.findOne({ userId: id });

        // Проверка на уже ожидающий проверки платёж
        if (user && user.status === 'pending') {
            ctx.session.awaitingPaymentProof = false;
            return ctx.reply(
                '⏳ Ваш скриншот уже на проверке у администратора. Пожалуйста, подождите.'
            );
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
                    status: 'pending',
                    rejectionReason: null,
                    rejectedByAdmin: false
                },
                { upsert: true, new: true }
            );

            const keyboard = Markup.inlineKeyboard([
                [Markup.button.callback('✅ Принять', `approve_${id}`)],
                [Markup.button.callback('❌ Отклонить', `reject_${id}`)]
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
                    reply_markup: keyboard.reply_markup
                }
            );

            await ctx.reply('✅ Скриншот получен! Админ проверит его в ближайшее время.');
            ctx.session.awaitingPaymentProof = false;
        } catch (error) {
            console.error('Ошибка при обработке фото/платежа:', error);
            await ctx.reply(
                '⚠️ Произошла ошибка при получении вашего скриншота. Пожалуйста, попробуйте позже.'
            );
            ctx.session.awaitingPaymentProof = false;
        }
    }

    /**
     * Одобряет платёж пользователя
     */
    async handleApprove(ctx) {
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

            newExpireDate.setMonth(newExpireDate.getMonth() + 1);
            newExpireDate.setHours(23, 59, 59, 999);

            let clientName = null;
            if (user.subscriptionCount === 0) {
                if (user.username) {
                    clientName = transliterate(user.username).replace(/[^a-zA-Z0-9_]/g, '');
                }
                if (!clientName) {
                    clientName = `telegram_${userId}`;
                }
            } else {
                clientName = user.vpnClientName;
            }

            const updateData = {
                status: 'active',
                expireDate: newExpireDate,
                paymentPhotoId: null,
                paymentPhotoDate: null,
                rejectionReason: null,
                rejectedByAdmin: false,
                $inc: { subscriptionCount: 1 }
            };

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

            // Логика для первого платежа
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
                    console.error(`Ошибка при создании VPN для ${userId}:`, vpnError);
                    await ctx.telegram.sendMessage(
                        userId,
                        `⚠️ *Произошла ошибка при генерации файла конфигурации VPN.*\n` +
                        `Пожалуйста, свяжитесь с администратором.`
                    );
                    await ctx.telegram.sendMessage(
                        process.env.ADMIN_ID,
                        `🚨 *Ошибка создания VPN для ${userId}:*\n` +
                        `\`\`\`\n${vpnError.stack}\n\`\`\``,
                        { parse_mode: 'Markdown' }
                    );
                }
            } else {
                // Логика для продления подписки
                try {
                    await enableVpnClient(clientName);
                    console.log(`VPN включён для ${clientName}`);
                } catch (vpnError) {
                    console.error(`Ошибка включения VPN для ${clientName}:`, vpnError);
                }

                await ctx.telegram.sendMessage(
                    userId,
                    `🎉 *Платёж подтверждён!* 🎉\n\n` +
                    `Ваша подписка успешно продлена до *${formatDate(newExpireDate, true)}*.`,
                    { parse_mode: 'Markdown' }
                );
            }
        } catch (error) {
            console.error(`Ошибка одобрения платежа для ${userId}:`, error);
            await ctx.answerCbQuery('⚠️ Ошибка при одобрении платежа!');
            await ctx.reply('⚠️ Произошла ошибка при одобрении платежа. Проверьте логи.');
        }
    }

    /**
     * Начинает процесс отклонения платежа
     */
    async handleReject(ctx) {
        if (!checkAdmin(ctx)) {
            return ctx.answerCbQuery('🚫 Только для админа');
        }

        const userId = parseInt(ctx.match[1]);
        try {
            await User.findOneAndUpdate(
                { userId },
                {
                    status: 'rejected',
                    rejectedByAdmin: true,
                    paymentPhotoId: null,
                    paymentPhotoDate: null
                }
            );

            await ctx.deleteMessage();

            await ctx.replyWithMarkdown(
                `❌ Вы отклонили платёж пользователя ${userId}.`,
                Markup.inlineKeyboard([
                    [
                        Markup.button.callback('📝 Добавить комментарий', `add_reject_comment_${userId}`),
                        Markup.button.callback('↩️ Отменить отклонение', `undo_reject_${userId}`)
                    ],
                    [
                        Markup.button.callback('✅ Подтвердить без комментария', `confirm_reject_${userId}`)
                    ]
                ])
            );

            await ctx.answerCbQuery('Выберите действие');
        } catch (error) {
            console.error(`Ошибка отклонения платежа для ${userId}:`, error);
            await ctx.answerCbQuery('⚠️ Ошибка!');
        }
    }

    /**
     * Отправляет пользователю сообщение об отклонении платежа
     */
    async sendRejectionMessage(userId, customReason = null) {
        const user = await User.findOne({ userId });

        let message = '❌ *Платёж отклонён*';

        if (customReason) {
            message += `\n\nПричина: ${customReason}`;
        } else if (user.rejectionReason) {
            message += `\n\nПричина: ${user.rejectionReason}`;
        } else {
            message += '\n\nВозможные причины:\n' +
                '- Неверная сумма\n' +
                '- Нет комментария к платежу\n' +
                '- Нечитаемый скриншот\n\n' +
                '*Попробуйте отправить чек ещё раз.*';
        }

        try {
            await bot.telegram.sendMessage(
                userId,
                message,
                { parse_mode: 'Markdown' }
            );
        } catch (error) {
            console.error(`Ошибка отправки уведомления пользователю ${userId}:`, error);
        }
    }

    /**
     * Отменяет отклонение платежа
     */
    async undoRejection(userId) {
        await User.findOneAndUpdate(
            { userId },
            {
                status: 'pending',
                rejectedByAdmin: false,
                rejectionReason: null
            }
        );
    }
}

module.exports = new PaymentController();