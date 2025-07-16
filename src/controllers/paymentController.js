const User = require('../models/User');
const { Markup } = require('telegraf');
// ИЗМЕНЕНО: Правильный импорт checkAdmin из нового модуля utils/auth
const { checkAdmin } = require('../utils/auth'); 
const { formatDate } = require('../utils/helpers');

/**
 * Обрабатывает загруженный пользователем скриншот оплаты.
 * Сохраняет скриншот в БД и отправляет его администратору для проверки.
 * @param {object} ctx - Объект контекста Telegraf.
 */
exports.handlePhoto = async (ctx) => {
  const { id, first_name, username } = ctx.from;

  // Если это админ, и он случайно отправил фото, игнорируем
  // (хотя checkAdmin(ctx) здесь избыточно, так как id === ADMIN_ID уже проверяет это)
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
        username: username || first_name,
        firstName: first_name,
        paymentPhotoId: photo.file_id,
        paymentPhotoDate: new Date(), // Добавлено: сохраняем дату отправки скриншота
        status: 'pending' // Статус ожидания проверки
      },
      { upsert: true, new: true } // Создать, если не существует; вернуть обновленный документ
    );

    // Подготавливаем кнопки для администратора
    const keyboard = Markup.inlineKeyboard([
      Markup.button.callback('✅ Принять', `approve_${id}`),
      Markup.button.callback('❌ Отклонить', `reject_${id}`)
    ]);

    // Отправляем скриншот администратору
    await ctx.telegram.sendPhoto(
      process.env.ADMIN_ID,
      photo.file_id,
      {
        caption: `📸 *Новый платёж от пользователя:*\n` +
                 `Имя: ${first_name} (@${username || 'нет'})\n` +
                 `ID: ${id}`,
        parse_mode: 'Markdown', // Указываем режим парсинга для Markdown в caption
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
  // ИЗМЕНЕНО: Использование checkAdmin из импорта
  if (!checkAdmin(ctx)) {
    return ctx.answerCbQuery('🚫 Только для админа');
  }

  const userId = parseInt(ctx.match[1]); // ID пользователя из callback_data

  try {
    const user = await User.findOne({ userId });

    let newExpireDate = new Date(); // Начальная дата, если подписки нет или она истекла

    // Если у пользователя есть подписка и она еще активна, продлеваем от текущей даты истечения
    if (user && user.expireDate && user.expireDate > new Date()) {
      newExpireDate = new Date(user.expireDate);
    }

    newExpireDate.setMonth(newExpireDate.getMonth() + 1); // Продлеваем на 1 месяц
    newExpireDate.setHours(23, 59, 59, 999); // Устанавливаем конец дня

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
      { new: true, upsert: true } // new: true - вернуть обновленный документ; upsert: true - создать, если не существует
    );

    let message = `🎉 *Платёж подтверждён!* 🎉\n\n` +
                  `Доступ к VPN активен до *${formatDate(newExpireDate, true)}*\n\n`;

    let keyboard = Markup.inlineKeyboard([]);

    // Если это первая подписка (счетчик стал 1), показываем инструкцию и кнопку VPN
    if (updatedUser.subscriptionCount === 1) {
      message += `Нажмите кнопку ниже, чтобы получить файл конфигурации и видеоинструкцию.`;
      keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('📁 Получить файл и инструкцию', `send_vpn_info_${userId}`)]
      ]);
    } else {
      // Для повторных подписок просто подтверждаем продление
      message += `Ваша подписка успешно продлена.`;
      // Можно добавить другие кнопки, если нужно, например, "Задать вопрос"
    }

    // Отправляем сообщение пользователю
    await ctx.telegram.sendMessage(
      userId,
      message,
      keyboard.reply_markup ? { parse_mode: 'Markdown', ...keyboard } : { parse_mode: 'Markdown' } // Отправляем клавиатуру только если она не пустая
    );

    await ctx.answerCbQuery('✅ Платёж принят'); // Отвечаем на callbackQuery
    await ctx.deleteMessage(); // Удаляем сообщение со скриншотом в админ-чате
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
  // ИЗМЕНЕНО: Использование checkAdmin из импорта
  if (!checkAdmin(ctx)) {
    return ctx.answerCbQuery('🚫 Только для админа');
  }

  const userId = parseInt(ctx.match[1]); // ID пользователя из callback_data

  try {
    // Обновляем статус пользователя на "отклонён"
    await User.findOneAndUpdate(
      { userId },
      { 
        status: 'rejected',
        paymentPhotoId: null, // Очищаем ID скриншота
        paymentPhotoDate: null // Очищаем дату скриншота
      }
    );

    // Отправляем сообщение пользователю об отклонении платежа
    await ctx.telegram.sendMessage(
      userId,
      '❌ *Платёж отклонён*\n\n' +
      'Возможные причины:\n' +
      '- Неверная сумма\n' +
      '- Нет комментария к платежу\n' +
      '- Нечитаемый скриншот\n\n' +
      '*Попробуйте отправить чек ещё раз.*',
      { parse_mode: 'Markdown' } // Используем Markdown для форматирования
    );

    await ctx.answerCbQuery('❌ Платёж отклонён'); // Отвечаем на callbackQuery
    await ctx.deleteMessage(); // Удаляем сообщение со скриншотом в админ-чате
  } catch (error) {
    console.error(`Ошибка при отклонении платежа для пользователя ${userId}:`, error);
    await ctx.answerCbQuery('⚠️ Ошибка при отклонении платежа!');
    await ctx.reply('⚠️ Произошла ошибка при отклонении платежа. Проверьте логи.');
  }
};