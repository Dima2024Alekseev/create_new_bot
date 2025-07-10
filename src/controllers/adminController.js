const User = require('../models/User');

exports.checkPayments = async (ctx) => {
  if (ctx.from.id !== parseInt(process.env.ADMIN_ID)) {
    return ctx.reply('🚫 Доступ только для админа');
  }

  const pendingUsers = await User.find({ status: 'pending' });
  
  if (!pendingUsers.length) {
    return ctx.reply('ℹ️ Нет заявок на проверку');
  }

  let message = '⏳ Ожидают проверки:\n';
  pendingUsers.forEach((user, index) => {
    message += `${index + 1}. ${user.firstName} (ID: ${user.userId})\n`;
  });

  ctx.reply(message);
};

exports.stats = async (ctx) => {
  if (ctx.from.id !== parseInt(process.env.ADMIN_ID)) {
    return ctx.reply('🚫 Доступ только для админа');
  }

  const [active, pending, total] = await Promise.all([
    User.countDocuments({ status: 'active' }),
    User.countDocuments({ status: 'pending' }),
    User.countDocuments()
  ]);

  const expiringSoon = await User.find({ 
    status: 'active',
    expireDate: { $lt: new Date(Date.now() + 7 * 86400000) }
  }).sort({ expireDate: 1 }).limit(5);

  let statsText = `📊 Статистика:\n\n` +
    `Всего пользователей: ${total}\n` +
    `✅ Активных: ${active}\n` +
    `⏳ На проверке: ${pending}\n\n` +
    `Ближайшие истечения:\n`;

  expiringSoon.forEach(user => {
    statsText += `- ${user.firstName}: ${user.expireDate.toLocaleDateString()}\n`;
  });

  ctx.reply(statsText);
};