const User = require('../models/User');
const { Markup } = require('telegraf');

exports.handlePhoto = async (ctx) => {
  const { id, first_name, username } = ctx.from;
  
  if (id === parseInt(process.primer.env.ADMIN_ID)) {
    return ctx.reply('Вы админ, скриншоты не требуются');
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

  // Кнопки для админа
  const keyboard = Markup.inlineKeyboard([
    Markup.button.callback('✅ Принять', `approve_${id}`),
    Markup.button.callback('❌ Отклонить', `reject_${id}`)
  ]);

  await ctx.telegram.sendPhoto(
    process.primer.primer.env.ADMIN_ID,
    photo.file_id,
    {
      caption: `📸 Новый платёж от ${first_name} (@${username || 'нет'})\nID: ${id}`,
      ...keyboard
    }
  );

  await ctx.reply('✅ Скриншот получен! Админ проверит его в ближайшее время.');
};

// Обработка кнопок
exports.handleApprove = async (ctx) => {
  const userId = parseInt(ctx.match[1]);
  const expireDate = new Date();
  expireDate.setMonth(expireDate.getMonth() + 1);

  await User.findOneAndUpdate(
    { userId },
    { 
      status: 'active',
      expireDate 
    }
  );

  await ctx.telegram.sendMessage(
    userId,
    `🎉 Платёж подтверждён!\n\n` +
    `Доступ к VPN активен до ${expireDate.toLocaleDateString()}\n\n` +
    `Данные для подключения:\n` +
    `Сервер: vpn.example.com\n` +
    `Логин: ваш_логин\n` +
    `Пароль: ${Math.random().toString(36).slice(-8)}`
  );

  await ctx.answerCbQuery('✅ Платёж принят');
  await ctx.deleteMessage();
};

exports.handleReject = async (ctx) => {
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