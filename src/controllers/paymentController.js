const User = require('../models/User');
const { Telegraf, Markup } = require('telegraf'); // Добавлен Telegraf для Markup, если он не импортирован выше
const QRCode = require('qrcode'); // Убедитесь, что эта библиотека установлена

// Предполагается, что bot.telegram доступен глобально или передается
// в реальном приложении это обычно делается через экземпляр бота
// или через ctx.telegram.

// Утилита для получения имени пользователя для админского сообщения
const getUserNameForAdmin = (user) => {
    let userName = user?.firstName || 'Неизвестный пользователь';
    if (user?.username) {
        userName += ` (@${user.username})`;
    }
    return userName;
};

// Функция для обработки полученного скриншота
async function handlePhoto(ctx) {
    const userId = ctx.from.id;
    const photo = ctx.message.photo[ctx.message.photo.length - 1]; // Получаем фото в лучшем качестве

    try {
        let user = await User.findOne({ userId });

        if (!user) {
            user = new User({
                userId: userId,
                username: ctx.from.username,
                firstName: ctx.from.first_name,
                lastName: ctx.from.last_name,
                status: 'inactive'
            });
            await user.save();
        }

        const userNameForAdmin = getUserNameForAdmin(user);

        // Отправка скриншота администратору для проверки
        // ВНИМАНИЕ: Если админ заблокировал бота, здесь будет ошибка
        try {
            await ctx.telegram.sendPhoto(
                process.env.ADMIN_ID,
                photo.file_id,
                {
                    caption: `💰 *Новый скриншот оплаты от пользователя* ${userNameForAdmin} (ID: \`${userId}\`).\n\n` +
                             `Проверьте оплату и нажмите соответствующую кнопку:`,
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [
                            [
                                Markup.button.callback('✅ Одобрить', `approve_${userId}`),
                                Markup.button.callback('❌ Отклонить', `reject_${userId}`)
                            ]
                        ]
                    }
                }
            );

            // Сохраняем file_id скриншота в сессии или БД, если нужно для дальнейшей обработки
            // Например, для того, чтобы админ мог посмотреть его позже
            // user.lastPaymentScreenshotId = photo.file_id;
            // await user.save();

            await ctx.reply('✅ Ваш скриншот получен! Администратор проверит его в ближайшее время. Пожалуйста, ожидайте.');

        } catch (error) {
            // *** УСИЛЕННОЕ ЛОГИРОВАНИЕ ОШИБКИ ПРИ ПЕРЕСЫЛКЕ АДМИНУ ***
            console.error('*** ОШИБКА ПРИ ПЕРЕСЫЛКЕ ФОТО АДМИНУ ***');
            console.error(`Попытка отправить фото админу с ID: ${process.env.ADMIN_ID}`);
            console.error('Полный объект ошибки:', JSON.stringify(error, Object.getOwnPropertyNames(error), 2)); // Логируем все свойства ошибки
            console.error('Сообщение об ошибке:', error.message);

            if (error.response) {
                console.error('Ошибка API Telegram (response):', JSON.stringify(error.response, null, 2));
                // Проверяем на специфические ошибки блокировки
                if (error.response.error_code === 403 && error.response.description && error.response.description.includes('bot was blocked by the user')) {
                    console.error(`КРИТИЧЕСКАЯ ОШИБКА: Администратор ${process.env.ADMIN_ID} заблокировал бота! Не могу отправить скриншот.`);
                    await ctx.reply(
                        '⚠️ Ваш скриншот получен, но я не могу отправить его администратору. ' +
                        'Пожалуйста, убедитесь, что администратор не заблокировал бота в своем Telegram-аккаунте. ' +
                        'Если проблема сохраняется, свяжитесь с ним напрямую.'
                    );
                } else {
                    // Другие ошибки от Telegram API
                    console.error('Другая ошибка API Telegram:', error.response.description || 'Нет описания');
                    await ctx.reply(
                        '⚠️ Произошла непредвиденная ошибка при пересылке вашего скриншота администратору. ' +
                        'Пожалуйста, попробуйте отправить скриншот еще раз или свяжитесь с поддержкой.'
                    );
                }
            } else {
                // Ошибки, не связанные напрямую с ответом API Telegram (например, проблемы с сетью)
                console.error('Неизвестная ошибка или проблема с сетью:', error);
                await ctx.reply(
                    '⚠️ Произошла внутренняя ошибка при обработке вашего скриншота. ' +
                    'Пожалуйста, попробуйте отправить его еще раз позже.'
                );
            }
        }

    } catch (error) {
        console.error('Ошибка в handlePhoto (вне блока отправки админу):', error);
        await ctx.reply('Произошла ошибка при обработке вашего запроса. Пожалуйста, попробуйте еще раз.');
    }
}


// Обработка одобрения платежа
async function handleApprove(ctx) {
    if (ctx.from.id !== parseInt(process.env.ADMIN_ID)) {
        return ctx.answerCbQuery('🚫 Только для админа');
    }

    const userIdToApprove = ctx.match[1];
    await ctx.answerCbQuery();

    try {
        const user = await User.findOne({ userId: userIdToApprove });

        if (!user) {
            await ctx.reply(`Пользователь с ID ${userIdToApprove} не найден.`);
            return;
        }

        // Проверяем, активна ли уже подписка
        if (user.status === 'active' && user.subscriptionEndDate && user.subscriptionEndDate > new Date()) {
            await ctx.reply(`Пользователь ${user.firstName} (ID: ${userIdToApprove}) уже имеет активную подписку до ${user.subscriptionEndDate.toLocaleDateString()}.`);
            // Предлагаем продлить
            await ctx.telegram.sendMessage(userIdToApprove, 'Ваша подписка уже активна. Вы можете продлить ее в любое время!', Markup.inlineKeyboard([
                Markup.button.callback('➕ Продлить подписку', 'extend_subscription')
            ]));
            return;
        }

        // Устанавливаем дату начала и окончания подписки (например, 30 дней)
        const startDate = new Date();
        const endDate = new Date();
        endDate.setDate(startDate.getDate() + 30); // Подписка на 30 дней

        user.status = 'active';
        user.subscriptionStartDate = startDate;
        user.subscriptionEndDate = endDate;
        user.activatedBy = ctx.from.username || ctx.from.first_name; // Кто одобрил

        await user.save();

        await ctx.telegram.sendMessage(
            userIdToApprove,
            `✅ Ваша подписка успешно активирована до *${endDate.toLocaleDateString()}*!`,
            { parse_mode: 'Markdown' }
        );

        await ctx.reply(`✅ Подписка пользователя ${user.firstName} (ID: ${userIdToApprove}) активирована до ${endDate.toLocaleDateString()}.`);

        // Предложить отправить VPN-информацию
        await ctx.telegram.sendMessage(
            userIdToApprove,
            'Чтобы получить доступ к VPN, нажмите кнопку ниже:',
            Markup.inlineKeyboard([
                Markup.button.callback('➡️ Получить доступ к VPN', `send_vpn_info_${userIdToApprove}`)
            ])
        );

        // Отметить сообщение админа как обработанное (опционально, удалить кнопки)
        try {
            await ctx.editMessageReplyMarkup(Markup.inlineKeyboard([])); // Удалить кнопки
        } catch (e) {
            console.warn('Не удалось удалить кнопки после одобрения:', e.message);
        }

    } catch (error) {
        console.error('Ошибка при одобрении платежа:', error);
        await ctx.reply('Произошла ошибка при одобрении платежа.');
    }
}

// Обработка отклонения платежа
async function handleReject(ctx) {
    if (ctx.from.id !== parseInt(process.env.ADMIN_ID)) {
        return ctx.answerCbQuery('🚫 Только для админа');
    }

    const userIdToReject = ctx.match[1];
    await ctx.answerCbQuery();

    try {
        const user = await User.findOne({ userId: userIdToReject });

        if (!user) {
            await ctx.reply(`Пользователь с ID ${userIdToReject} не найден.`);
            return;
        }

        user.status = 'rejected';
        user.activatedBy = ctx.from.username || ctx.from.first_name; // Кто отклонил
        await user.save();

        await ctx.telegram.sendMessage(
            userIdToReject,
            '❌ Ваш скриншот оплаты был отклонен. Пожалуйста, проверьте правильность платежа и отправьте скриншот еще раз. Если у вас возникли вопросы, свяжитесь с поддержкой.'
        );
        await ctx.reply(`❌ Платеж пользователя ${user.firstName} (ID: ${userIdToReject}) отклонен.`);

        // Отметить сообщение админа как обработанное (опционально, удалить кнопки)
        try {
            await ctx.editMessageReplyMarkup(Markup.inlineKeyboard([])); // Удалить кнопки
        } catch (e) {
            console.warn('Не удалось удалить кнопки после отклонения:', e.message);
        }

    } catch (error) {
        console.error('Ошибка при отклонении платежа:', error);
        await ctx.reply('Произошла ошибка при отклонении платежа.');
    }
}


module.exports = {
    handlePhoto,
    handleApprove,
    handleReject
};