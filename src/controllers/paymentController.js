const User = require('../models/User');
const { Markup } = require('telegraf');
const { checkAdmin } = require('./adminController');

exports.handlePhoto = async (ctx) => {
  const { id, first_name, username } = ctx.from;
  
  if (id === parseInt(process.env.ADMIN_ID) && checkAdmin(ctx)) {
    return ctx.reply('Вы в режиме админа, скриншоты не требуются');
  }

  const photo = ctx.message.photo.pop();
  const existingUser = await User.findOne({ userId: id });

  // Если у пользователя есть активная подписка
  if (existingUser?.status === 'active' && existingUser.expireDate > new Date()) {
    const confirmKeyboard = Markup.inlineKeyboard([
      Markup.button.callback('✅ Да, продлить', `confirm_extend_${id}`),
      Markup.button.callback('❌ Отмена', `cancel_extend_${id}`)
    ]);
    
    return ctx.reply(
      `У вас уже есть активная подписка до ${existingUser.expireDate.toLocaleDateString('ru-RU')}\n` +
      'Вы действительно хотите продлить подписку?',
      confirmKeyboard
    );
  }

  // Обработка нового платежа или продления
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
      caption: `📸 ${existingUser?.status === 'active' ? 'Продление подписки' : 'Новый платёж'} от ${first_name} (@${username || 'нет'})\nID: ${id}`,
      ...keyboard
    }
  );

  await ctx.reply('✅ Скриншот получен! Админ проверит его в ближайшее время.');
};

exports.handleConfirmExtend = async (ctx) => {
  const userId = parseInt(ctx.match[1]);
  
  // Проверяем, что пользователь отправил фото
  if (!ctx.message?.photo) {
    return ctx.reply('Пожалуйста, отправьте скриншот оплаты для продления');
  }

  const photo = ctx.message.photo.pop();
  await User.findOneAndUpdate(
    { userId },
    {
      paymentPhotoId: photo.file_id,
      status: 'pending'
    }
  );

  const keyboard = Markup.inlineKeyboard([
    Markup.button.callback('✅ Принять', `approve_${userId}`),
    Markup.button.callback('❌ Отклонить', `reject_${userId}`)
  ]);

  await ctx.telegram.sendPhoto(
    process.env.ADMIN_ID,
    photo.file_id,
    {
      caption: `🔄 Запрос на продление подписки от ID: ${userId}`,
      ...keyboard
    }
  );

  await ctx.reply('✅ Запрос на продление подписки отправлен администратору');
  await ctx.deleteMessage();
};

exports.handleCancelExtend = async (ctx) => {
  await ctx.answerCbQuery('❌ Продление отменено');
  await ctx.deleteMessage();
};

exports.handleApprove = async (ctx) => {
  if (!checkAdmin(ctx)) {
    return ctx.answerCbQuery('🚫 Только для админа');
  }

  const userId = parseInt(ctx.match[1]);
  const user = await User.findOne({ userId });
  let expireDate = new Date();

  // Если уже есть активная подписка, продлеваем от текущей даты окончания
  if (user.status === 'active' && user.expireDate > new Date()) {
    expireDate = new Date(user.expireDate);
  }
  expireDate.setMonth(expireDate.getMonth() + 1);
  expireDate.setHours(23, 59, 59, 999);

  await User.findOneAndUpdate(
    { userId },
    { 
      status: 'active',
      expireDate 
    }
  );

  const formatDate = (date) => {
    return date.toLocaleDateString('ru-RU', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  await ctx.telegram.sendMessage(
    userId,
    `🎉 ${user.status === 'active' ? 'Подписка продлена' : 'Платёж подтверждён'}!\n\n` +
    `Доступ к VPN активен до ${formatDate(expireDate)}\n\n` +
    `Данные для подключения ${user.status === 'active' ? 'остаются прежними' : 'указаны ниже'}:\n` +
    (user.status !== 'active' ? 
      `Сервер: vpn.example.com\n` +
      `Логин: ваш_логин\n` +
      `Пароль: ${Math.random().toString(36).slice(-8)}` : '')
  );

  await ctx.answerCbQuery(`✅ ${user.status === 'active' ? 'Продлено' : 'Принято'}`);
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