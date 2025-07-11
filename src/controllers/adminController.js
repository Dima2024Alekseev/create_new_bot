const User = require('../models/User');
const Question = require('../models/Question');
const { formatDate } = require('../utils/helpers');
const { Markup } = require('telegraf'); // Добавим Markup для использования

// Проверка прав администратора (теперь без учета adminModes, так как режим переключения удален)
exports.checkAdmin = (ctx) => {
  return ctx.from?.id === parseInt(process.env.ADMIN_ID);
};

exports.checkPayments = async (ctx) => {
  if (!exports.checkAdmin(ctx)) {
    return ctx.reply('🚫 У вас нет доступа к этой команде.');
  }
  const pendingPayments = await User.find({ status: 'pending' });

  if (pendingPayments.length === 0) {
    return ctx.reply('✅ Нет ожидающих платежей.');
  }

  for (const user of pendingPayments) {
    const keyboard = Markup.inlineKeyboard([
      Markup.button.callback('✅ Принять', `approve_${user.userId}`),
      Markup.button.callback('❌ Отклонить', `reject_${user.userId}`)
    ]);
    await ctx.telegram.sendPhoto(
      ctx.from.id,
      user.paymentPhotoId,
      {
        caption: `📸 Новый платёж от ${user.firstName || user.username}\nID: ${user.userId}`,
        ...keyboard
      }
    );
  }
  await ctx.reply('🔍 Все ожидающие платежи отправлены.');
};

exports.stats = async (ctx) => {
  if (!exports.checkAdmin(ctx)) {
    return ctx.reply('🚫 У вас нет доступа к этой команде.');
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
      }).sort({ expireDate: 1 }).limit(5),
      User.countDocuments({ vpnConfigured: true }) // Добавил подсчет успешно настроивших
    ]);

    // Важно: если usersStats - это массив результатов aggregation, нужно его обработать
    const userStatusCounts = usersStats.reduce((acc, curr) => {
        acc[curr._id] = curr.count;
        return acc;
    }, {});

    const questionStatusCounts = questionsStats.reduce((acc, curr) => {
        acc[curr._id] = curr.count;
        return acc;
    }, {});

    const totalUsers = await User.countDocuments(); // Общее количество пользователей
    const activeUsers = userStatusCounts['active'] || 0;
    const pendingPayments = userStatusCounts['pending'] || 0;
    const totalQuestions = await Question.countDocuments(); // Общее количество вопросов
    const pendingQuestions = questionStatusCounts['pending'] || 0;
    const configuredUsers = await User.countDocuments({ vpnConfigured: true }); // Получаем количество из запроса

    let message = `📊 *Статистика бота*\n\n` +
                  `👤 Всего пользователей: ${totalUsers}\n` +
                  `🟢 Активных подписок: ${activeUsers}\n` +
                  `⏳ Ожидающих платежей: ${pendingPayments}\n` +
                  `❓ Всего вопросов: ${totalQuestions}\n` +
                  `💬 Неотвеченных вопросов: ${pendingQuestions}\n` +
                  `✅ Успешно настроили VPN: ${configuredUsers}\n\n`;

    message += `🔔 *Ближайшие истечения:*\n`;
    if (expiringSoon.length > 0) {
      expiringSoon.forEach(user => {
        const daysLeft = Math.ceil((user.expireDate - new Date()) / 86400000);
        message += `- ${user.firstName || user.username || 'Без имени'}: через ${daysLeft} дней (${formatDate(user.expireDate)})\n`;
      });
    } else {
      message += 'Нет подписок, истекающих в ближайшую неделю.\n';
    }

    await ctx.replyWithMarkdown(message, {
      reply_markup: {
        inline_keyboard: [
          [{ text: '🔄 Обновить', callback_data: 'refresh_stats' }] // Убрал кнопку 'Сменить режим'
        ]
      }
    });

  } catch (err) {
    console.error('Ошибка при формировании статистики:', err);
    await ctx.reply('⚠️ Произошла ошибка при загрузке статистики');
  }
};

exports.listQuestions = async (ctx) => {
  if (!exports.checkAdmin(ctx)) {
    return ctx.answerCbQuery('🚫 Только для админа');
  }

  const questions = await Question.find({ status: 'pending' }).sort({ createdAt: 1 });

  if (questions.length === 0) {
    await ctx.reply('✅ Нет неотвеченных вопросов.');
    return ctx.answerCbQuery();
  }

  for (const q of questions) {
    const keyboard = Markup.inlineKeyboard([
      Markup.button.callback('✍️ Ответить', `answer_${q.userId}`)
    ]);
    const user = await User.findOne({ userId: q.userId });
    await ctx.replyWithMarkdown(
      `❓ Новый вопрос от ${user ? user.firstName || user.username || 'Без имени' : 'Неизвестный'} (@${user?.username || 'нет'}):\n` +
      `"${q.text}"\n` +
      `ID пользователя: ${q.userId}\n` +
      `Время: ${formatDate(q.createdAt)}`,
      keyboard
    );
  }
  await ctx.answerCbQuery();
};
