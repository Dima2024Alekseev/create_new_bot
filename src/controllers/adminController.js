require('dotenv').config({ path: __dirname + '/../primer.env' });
const { Markup } = require('telegraf');
const User = require('../models/User');
const Question = require('../models/Question');
const { formatDate } = require('../utils/helpers');

// Хранилище режимов админа
const adminModes = {};

// Проверка прав администратора
exports.checkAdmin = (ctx) => {
  return ctx.from.id === parseInt(process.env.ADMIN_ID) && 
         (!adminModes[ctx.from.id] || adminModes[ctx.from.id] === 'admin');
};

// Клавиатуры
const adminMainKeyboard = Markup.keyboard([
  ['📊 Статистика', '📝 Вопросы'],
  ['💳 Платежи', '🔄 Режим']
]).resize();

const paymentsKeyboard = Markup.inlineKeyboard([
  [Markup.button.callback('⏳ Ожидают', 'pending_payments'), Markup.button.callback('✅ Активные', 'active_payments')],
  [Markup.button.callback('❌ Отклоненные', 'rejected_payments'), Markup.button.callback('📆 Истекают', 'expiring_payments')],
  [Markup.button.callback('⬅️ Назад', 'back_to_main')]
]);

const questionsKeyboard = Markup.inlineKeyboard([
  [Markup.button.callback('⏳ Ожидают', 'pending_questions'), Markup.button.callback('✅ Отвеченные', 'answered_questions')],
  [Markup.button.callback('🗑 Очистить', 'clear_questions'), Markup.button.callback('📝 Ответить', 'answer_question')],
  [Markup.button.callback('⬅️ Назад', 'back_to_main')]
]);

// Главное меню админа
exports.showMainMenu = async (ctx) => {
  if (!exports.checkAdmin(ctx)) return;
  
  await ctx.reply(
    '👑 Админ-панель управления',
    adminMainKeyboard
  );
};

// Меню платежей
exports.showPaymentsMenu = async (ctx) => {
  if (!exports.checkAdmin(ctx)) return;
  
  await ctx.reply(
    '💳 Управление платежами:',
    paymentsKeyboard
  );
};

// Меню вопросов
exports.showQuestionsMenu = async (ctx) => {
  if (!exports.checkAdmin(ctx)) return;
  
  await ctx.reply(
    '📋 Управление вопросами:',
    questionsKeyboard
  );
};

// Обработчик действий админа
exports.handleAdminActions = async (ctx) => {
  if (!exports.checkAdmin(ctx)) return;

  try {
    switch (ctx.match[0]) {
      case 'pending_payments':
        await showPendingPayments(ctx);
        break;
      case 'active_payments':
        await showActivePayments(ctx);
        break;
      case 'rejected_payments':
        await showRejectedPayments(ctx);
        break;
      case 'expiring_payments':
        await showExpiringPayments(ctx);
        break;
      case 'pending_questions':
        await showPendingQuestions(ctx);
        break;
      case 'answered_questions':
        await showAnsweredQuestions(ctx);
        break;
      case 'clear_questions':
        await clearQuestions(ctx);
        break;
      case 'back_to_main':
        await exports.showMainMenu(ctx);
        break;
      default:
        await ctx.answerCbQuery('Неизвестное действие');
    }
  } catch (err) {
    console.error('Admin action error:', err);
    await ctx.reply('⚠️ Ошибка выполнения действия');
  }
};

// Функции отображения данных
async function showPendingPayments(ctx) {
  const pending = await User.find({ status: 'pending' }).sort({ createdAt: -1 }).limit(50);
  
  if (!pending.length) {
    return ctx.reply('ℹ️ Нет ожидающих платежей');
  }

  const buttons = pending.map(user => [
    Markup.button.callback(
      `${user.firstName || 'Без имени'} (${formatDate(user.createdAt)})`,
      `user_detail_${user.userId}`
    )
  ]);

  await ctx.reply(
    `⏳ Ожидающие платежи (${pending.length}):`,
    Markup.inlineKeyboard([
      ...buttons,
      [Markup.button.callback('⬅️ Назад', 'back_to_payments')]
    ])
  );
}

async function showActivePayments(ctx) {
  const active = await User.find({ status: 'active' }).sort({ expireDate: 1 }).limit(50);
  
  const buttons = active.map(user => [
    Markup.button.callback(
      `${user.firstName || 'Без имени'} (до ${formatDate(user.expireDate)})`,
      `user_detail_${user.userId}`
    )
  ]);

  await ctx.reply(
    `✅ Активные подписки (${active.length}):`,
    Markup.inlineKeyboard([
      ...buttons,
      [Markup.button.callback('⬅️ Назад', 'back_to_payments')]
    ])
  );
}

async function showRejectedPayments(ctx) {
  const rejected = await User.find({ status: 'rejected' }).sort({ createdAt: -1 }).limit(50);
  
  if (!rejected.length) {
    return ctx.reply('ℹ️ Нет отклоненных платежей');
  }

  const buttons = rejected.map(user => [
    Markup.button.callback(
      `${user.firstName || 'Без имени'} (${formatDate(user.createdAt)})`,
      `user_detail_${user.userId}`
    )
  ]);

  await ctx.reply(
    `❌ Отклоненные платежи (${rejected.length}):`,
    Markup.inlineKeyboard([
      ...buttons,
      [Markup.button.callback('⬅️ Назад', 'back_to_payments')]
    ])
  );
}

async function showExpiringPayments(ctx) {
  const expiring = await User.find({ 
    status: 'active',
    expireDate: { $lt: new Date(Date.now() + 7 * 86400000) }
  }).sort({ expireDate: 1 }).limit(50);

  if (!expiring.length) {
    return ctx.reply('ℹ️ Нет подписок, истекающих в ближайшую неделю');
  }

  const buttons = expiring.map(user => {
    const daysLeft = Math.ceil((user.expireDate - new Date()) / 86400000);
    return [
      Markup.button.callback(
        `${user.firstName || 'Без имени'} (${daysLeft} дн.)`,
        `user_detail_${user.userId}`
      )
    ];
  });

  await ctx.reply(
    `📆 Подписки, истекающие в ближайшие 7 дней (${expiring.length}):`,
    Markup.inlineKeyboard([
      ...buttons,
      [Markup.button.callback('⬅️ Назад', 'back_to_payments')]
    ])
  );
}

async function showPendingQuestions(ctx) {
  const questions = await Question.find({ status: 'pending' }).sort({ createdAt: -1 }).limit(50);
  
  if (!questions.length) {
    return ctx.reply('ℹ️ Нет ожидающих вопросов');
  }

  const buttons = questions.map(question => [
    Markup.button.callback(
      `${question.firstName}: ${question.questionText.substring(0, 30)}...`,
      `question_detail_${question._id}`
    )
  ]);

  await ctx.reply(
    `⏳ Ожидающие вопросы (${questions.length}):`,
    Markup.inlineKeyboard([
      ...buttons,
      [Markup.button.callback('⬅️ Назад', 'back_to_questions')]
    ])
  );
}

async function showAnsweredQuestions(ctx) {
  const questions = await Question.find({ status: 'answered' }).sort({ answeredAt: -1 }).limit(50);
  
  if (!questions.length) {
    return ctx.reply('ℹ️ Нет отвеченных вопросов');
  }

  const buttons = questions.map(question => [
    Markup.button.callback(
      `${question.firstName}: ${question.questionText.substring(0, 30)}...`,
      `question_detail_${question._id}`
    )
  ]);

  await ctx.reply(
    `✅ Отвеченные вопросы (${questions.length}):`,
    Markup.inlineKeyboard([
      ...buttons,
      [Markup.button.callback('⬅️ Назад', 'back_to_questions')]
    ])
  );
}

async function clearQuestions(ctx) {
  await Question.deleteMany({ status: 'answered' });
  await ctx.answerCbQuery('✅ Отвеченные вопросы очищены');
  await showQuestionsMenu(ctx);
}

// Переключение режима
exports.switchMode = async (ctx) => {
  if (!exports.checkAdmin(ctx)) {
    return ctx.reply('🚫 Доступ только для админа');
  }

  const currentMode = adminModes[ctx.from.id] || 'admin';
  const newMode = currentMode === 'admin' ? 'user' : 'admin';

  adminModes[ctx.from.id] = newMode;

  await ctx.reply(
    `🔄 Режим изменен: ${newMode === 'admin' ? '👑 Администратор' : '👤 Обычный пользователь'}`,
    Markup.removeKeyboard()
  );
  
  if (newMode === 'admin') {
    await exports.showMainMenu(ctx);
  }
};

// Статистика
exports.stats = async (ctx) => {
  if (!exports.checkAdmin(ctx)) {
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
      reply_markup: {
        inline_keyboard: [
          [{ text: '🔄 Обновить', callback_data: 'refresh_stats' }],
          [{ text: '💳 Платежи', callback_data: 'pending_payments' }],
          [{ text: '📝 Вопросы', callback_data: 'pending_questions' }]
        ]
      }
    });

  } catch (err) {
    console.error('Ошибка при формировании статистики:', err);
    await ctx.reply('⚠️ Произошла ошибка при загрузке статистики');
  }
};