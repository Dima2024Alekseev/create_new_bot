const User = require('../models/User');
const Question = require('../models/Question');

// Хранилище режимов админа
const adminModes = {};

// Проверка прав администратора с учетом режима
function checkAdmin(ctx) {
  return ctx.from.id === parseInt(process.env.ADMIN_ID) && 
         (!adminModes[ctx.from.id] || adminModes[ctx.from.id] === 'admin');
}

// Переключение режима
exports.switchMode = async (ctx) => {
  if (ctx.from.id !== parseInt(process.env.ADMIN_ID)) {
    return ctx.reply('🚫 Доступ только для админа');
  }

  const currentMode = adminModes[ctx.from.id] || 'admin';
  const newMode = currentMode === 'admin' ? 'user' : 'admin';

  adminModes[ctx.from.id] = newMode;

  await ctx.reply(
    `🔄 Режим изменен: ${newMode === 'admin' ? '👑 Администратор' : '👤 Обычный пользователь'}\n\n` +
    `Теперь бот будет реагировать на вас как на ${newMode === 'admin' ? 'администратора' : 'обычного пользователя'}.\n\n` +
    `Используйте /switchmode для обратного переключения.`
  );
};

exports.checkPayments = async (ctx) => {
  if (!checkAdmin(ctx)) {
    return ctx.reply('🚫 Доступ только для админа');
  }

  try {
    const pendingUsers = await User.find({ status: 'pending' })
      .sort({ createdAt: 1 })
      .limit(50);
    
    if (!pendingUsers.length) {
      return ctx.reply('ℹ️ Нет заявок на проверку');
    }

    let message = '⏳ Ожидают проверки:\n\n';
    pendingUsers.forEach((user, index) => {
      message += `${index + 1}. ${user.firstName || 'Без имени'}`;
      if (user.username) message += ` (@${user.username})`;
      message += `\nID: ${user.userId}\n`;
      message += `Дата: ${new Date(user.createdAt).toLocaleString('ru-RU')}\n\n`;
    });

    const buttons = [];
    if (pendingUsers.length > 10) {
      buttons.push([{ text: '🗑 Очистить все', callback_data: 'clear_payments' }]);
    }

    await ctx.reply(message, {
      reply_markup: { inline_keyboard: buttons }
    });

  } catch (err) {
    console.error('Ошибка при проверке платежей:', err);
    await ctx.reply('⚠️ Произошла ошибка при загрузке данных');
  }
};

exports.stats = async (ctx) => {
  if (!checkAdmin(ctx)) {
    return ctx.reply('🚫 Доступ только для админа');
  }

  const currentMode = adminModes[ctx.from.id] || 'admin';

  try {
    const [usersStats, questionsStats, expiringSoon] = await Promise.all([
      User.aggregate([
        { $group: { _id: '$status', count: { $sum: 1 } } }
      ]),
      Question.aggregate([
        { $group: { _id: '$status', count: { $sum: 1 } } }
      ]),
      User.find({ 
        status: 'active',
        expireDate: { $lt: new Date(Date.now() + 7 * 86400000) }
      }).sort({ expireDate: 1 }).limit(5)
    ]);

    let statsText = '📊 *Статистика бота*\n\n';
    
    statsText += '👤 *Пользователи:*\n';
    usersStats.forEach(stat => {
      statsText += `- ${stat._id}: ${stat.count}\n`;
    });

    statsText += '\n❓ *Вопросы:*\n';
    questionsStats.forEach(stat => {
      statsText += `- ${stat._id}: ${stat.count}\n`;
    });

    statsText += '\n🔔 *Ближайшие истечения:*\n';
    if (expiringSoon.length > 0) {
      expiringSoon.forEach(user => {
        const daysLeft = Math.ceil((user.expireDate - new Date()) / 86400000);
        statsText += `- ${user.firstName}: через ${daysLeft} дней (${user.expireDate.toLocaleDateString('ru-RU')})\n`;
      });
    } else {
      statsText += 'Нет подписок, истекающих в ближайшую неделю\n';
    }

    statsText += `\nТекущий режим: ${currentMode === 'admin' ? '👑 Админ' : '👤 Пользователь'}`;

    await ctx.replyWithMarkdown(statsText, {
      reply_markup: {
        inline_keyboard: [
          [{ text: '🔄 Обновить', callback_data: 'refresh_stats' }],
          [{ text: '🔀 Сменить режим', callback_data: 'switch_mode' }]
        ]
      }
    });

  } catch (err) {
    console.error('Ошибка при формировании статистики:', err);
    await ctx.reply('⚠️ Произошла ошибка при загрузке статистики');
  }
};