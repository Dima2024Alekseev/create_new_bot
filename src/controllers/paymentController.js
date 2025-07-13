const User = require('../models/User');
const { Markup } = require('telegraf');
const { checkAdmin } = require('./adminController');
const { formatDate } = require('../utils/helpers');

exports.handlePhoto = async (ctx) => {
  const { id, first_name, username } = ctx.from;

  if (id === parseInt(process.env.ADMIN_ID) && checkAdmin(ctx)) {
    return ctx.reply('Вы в режиме админа, скриншоты не требуются');
  }
  const photo = ctx.message.photo.pop();

  await User.findOneAndUpdate(
    { userId: id },
    {
      userId: id,
      username: username || first_name,
      firstName: first_name,
      paymentPhotoId: photo.file_id,
      status: 'pending'
    },
    { upsert: true, new: true }
  );
  const keyboard = Markup.inlineKeyboard([
    Markup.button.callback('✅ Принять', `approve_${id}`),
    Markup.button.callback('❌ Отклонить', `reject_${id}`)
  ]);
  await ctx.telegram.sendPhoto(
    process.env.ADMIN_ID,
    photo.file_id,
    {
      caption: `📸 Новый платёж от ${first_name} (@${username || 'нет'})\nID: ${id}`,
      ...keyboard
    }
  );
  await ctx.reply('✅ Скриншот получен! Админ проверит его в ближайшее время.');
};

exports.handleApprove = async (ctx) => {
  if (!checkAdmin(ctx)) {
    return ctx.answerCbQuery('🚫 Только для админа');
  }
  const userId = parseInt(ctx.match[1]);

  const user = await User.findOne({ userId });

  let newExpireDate = new Date();

  if (user && user.expireDate && user.expireDate > new Date()) {
    newExpireDate = new Date(user.expireDate);
  }

  newExpireDate.setMonth(newExpireDate.getMonth() + 1);
  newExpireDate.setHours(23, 59, 59, 999);

  // Увеличиваем счетчик подписок
  const updatedUser = await User.findOneAndUpdate(
    { userId },
    {
      status: 'active',
      expireDate: newExpireDate,
      paymentPhotoId: null,
      $inc: { subscriptionCount: 1 } // Увеличиваем subscriptionCount на 1
    },
    { new: true, upsert: true } // new: true - вернуть обновленный документ, upsert: true - создать, если не существует
  );

  let message = `🎉 Платёж подтверждён!\n\n` +
    `Доступ к VPN активен до ${formatDate(newExpireDate, true)}\n\n`;

  let keyboard = Markup.inlineKeyboard([]);

  // Если это первая подписка (subscriptionCount === 1), показываем инструкцию и кнопку
  if (updatedUser.subscriptionCount === 1) {
    message += `Нажмите кнопку ниже, чтобы получить файл конфигурации и видеоинструкцию.`;
    keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('📁 Получить файл и инструкцию', `send_vpn_info_${userId}`)]
    ]);
  } else {
    // Для повторных подписок просто подтверждаем продление
    message += `Ваша подписка успешно продлена.`;
    // Здесь можно добавить другие кнопки, если нужно, например, "Задать вопрос"
    // Но по условию, кнопку "Получить файл и инструкцию" не показываем.
  }

  await ctx.telegram.sendMessage(
    userId,
    message,
    keyboard.reply_markup ? keyboard : {} // Отправляем клавиатуру только если она не пустая
  );
  await ctx.answerCbQuery('✅ Платёж принят');
  await ctx.deleteMessage();
};

exports.handleReject = async (ctx) => {
  if (!checkAdmin(ctx)) {
    return ctx.answerCbQuery('🚫 Только для админа');
  }
  const userId = parseInt(ctx.match[1]);
  await User.findOneAndUpdate(
    { userId },
    { status: 'rejected' }
  );
  await ctx.telegram.sendMessage(
    userId,
    '❌ Платёж отклонён\n\n' +
    'Возможные причины:\n' +
    '- Неверная сумма\n' +
    '- Нет комментария\n' +
    '- Нечитаемый скриншот\n\n' +
    'Попробуйте отправить чек ещё раз.'
  );
  await ctx.answerCbQuery('❌ Платёж отклонён');
  await ctx.deleteMessage();
};