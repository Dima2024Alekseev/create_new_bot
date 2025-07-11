const User = require('../models/User');
const Question = require('../models/Question');
const { Markup } = require('telegraf');

// Функция для создания клавиатуры с кнопками для администратора
function getAdminKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('📋 Просмотр заявок', 'view_applications')],
    [Markup.button.callback('📊 Статистика', 'view_stats')],
    [Markup.button.callback('❓ Просмотреть вопросы', 'view_questions')]
  ]);
}

exports.checkPayments = async (ctx) => {
  if (ctx.from.id !== parseInt(process.env.ADMIN_ID)) {
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

    await ctx.reply(message, getAdminKeyboard());
  } catch (err) {
    console.error('Ошибка при проверке платежей:', err);
    await ctx.reply('⚠️ Произошла ошибка при загрузке данных');
  }
};

exports.stats = async (ctx) => {
  if (ctx.from.id !== parseInt(process.env.ADMIN_ID)) {
    return ctx.reply('🚫 Доступ только для админа');
  }

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

    await ctx.replyWithMarkdown(statsText, {
      reply_markup: getAdminKeyboard()
    });
  } catch (err) {
    console.error('Ошибка при формировании статистики:', err);
    await ctx.reply('⚠️ Произошла ошибка при загрузке статистики');
  }
};

exports.listQuestions = async (ctx) => {
  try {
    const questions = await Question.find()
      .sort({ createdAt: -1 })
      .limit(10);

    if (!questions.length) {
      return ctx.reply('ℹ️ Нет вопросов в базе');
    }

    let message = '📋 Последние вопросы:\n\n';
    questions.forEach((q, i) => {
      message += `${i+1}. ${q.firstName} (@${q.username || 'нет'}):\n` +
                 `"${q.questionText}"\n` +
                 `Статус: ${q.status === 'answered' ? '✅ Отвечено' : '⏳ Ожидает'}\n` +
                 `Дата: ${q.createdAt.toLocaleString()}\n\n`;
    });

    await ctx.reply(message, getAdminKeyboard());
  } catch (err) {
    console.error('Ошибка получения списка вопросов:', err);
    await ctx.reply('⚠️ Не удалось загрузить вопросы');
  }
};
