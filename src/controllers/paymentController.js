const User = require('../models/User');
const { Markup } = require('telegraf');
const { checkAdmin } = require('./adminController');

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
  const expireDate = new Date();
  expireDate.setMonth(expireDate.getMonth() + 1);
  expireDate.setHours(23, 59, 59, 999); // Устанавливаем на конец дня

  await User.findOneAndUpdate(
    { userId },
    { 
      status: 'active',
      expireDate 
    }
  );

  const formatDate = (date) => {
    const options = {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    };
    return date.toLocaleDateString('ru-RU', options);
  };

  await ctx.telegram.sendMessage(
    userId,
    `🎉 Платёж подтверждён!\n\n` +
    `Доступ к VPN активен до ${formatDate(expireDate)}\n\n`
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