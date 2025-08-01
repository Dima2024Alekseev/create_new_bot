const User = require('../models/User');
const { Markup } = require('telegraf');
const { checkAdmin } = require('../utils/auth');
// Убедитесь, что escapeMarkdown импортирован правильно вместе с formatDate
const { formatDate, escapeMarkdown } = require('../utils/helpers');

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
    
    if (!user) {
      return ctx.answerCbQuery('❌ Пользователь не найден');
    }

    // Текущая дата
    const now = new Date();
    
    // Инициализируем новую дату окончания
    let newExpireDate = new Date();
    
    // Если подписка активна и еще не истекла - продлеваем от текущей даты окончания
    if (user.status === 'active' && user.expireDate && user.expireDate > now) {
      newExpireDate = new Date(user.expireDate);
    }
    
    // Добавляем ровно 1 месяц к вычисленной дате
    newExpireDate.setMonth(newExpireDate.getMonth() + 1);
    
    // Устанавливаем время на конец дня (23:59:59)
    newExpireDate.setHours(23, 59, 59, 999);

    // Обновляем пользователя
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

    // Уведомляем пользователя
    await ctx.telegram.sendMessage(
      userId,
      `🎉 *Платёж подтверждён!*\n\n` +
      `Ваша подписка продлена до *${formatDate(newExpireDate, true)}*\n` +
      `Новых дней доступа: ${Math.ceil((newExpireDate - now) / (1000 * 60 * 60 * 24))}`,
      { parse_mode: 'Markdown' }
    );

    await ctx.answerCbQuery('✅ Платёж принят');
    await ctx.deleteMessage();

  } catch (error) {
    console.error(`Ошибка продления подписки для ${userId}:`, error);
    await ctx.answerCbQuery('⚠️ Ошибка продления!');
    await ctx.reply('❌ Ошибка при обработке платежа. Проверьте логи.');
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