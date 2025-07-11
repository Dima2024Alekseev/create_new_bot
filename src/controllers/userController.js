const User = require('../models/User');
const Question = require('../models/Question');
const { paymentDetails, formatDate } = require('../utils/helpers');
const { Markup } = require('telegraf');
const { checkAdmin } = require('./adminController');

// Главное меню пользователя
const getUserMenu = () => Markup.keyboard([
  ['📅 Срок действия подписки', '❓ Задать вопрос'],
  ['📩 Посмотреть ответы']
]).resize().oneTime();

exports.handleStart = async (ctx) => {
  const { id, first_name } = ctx.from;
  
  if (id === parseInt(process.env.ADMIN_ID) && checkAdmin(ctx)) {
    return ctx.replyWithMarkdown(
      '👋 *Админ-панель*\n\n' +
      'Команды:\n' +
      '/check - Проверить заявки\n' +
      '/stats - Статистика\n' +
      '/switchmode - Переключиться в режим пользователя',
      Markup.removeKeyboard()
    );
  }

  const user = await User.findOne({ userId: id });
  
  let message = `Привет, ${first_name}!\n\n`;
  let keyboard = getUserMenu();

  if (user?.status === 'active') {
    message += `✅ *Ваша подписка активна до ${formatDate(user.expireDate)}*\n\n`;
    message += 'Для продления отправьте новый скриншот оплаты.';
  } else if (user?.status === 'pending') {
    message += '⏳ Ваш платёж на проверке. Ожидайте подтверждения.';
  } else if (user?.status === 'rejected') {
    message += '❌ Ваш платёж был отклонён. Попробуйте отправить снова.';
  } else {
    message += `🔐 *VPN подписка: ${process.env.VPN_PRICE} руб/мес*\n\n`;
    message += paymentDetails(id);
    message += '\n\n_После оплаты отправьте скриншот чека_';
  }

  await ctx.replyWithMarkdown(message, {
    ...keyboard,
    disable_web_page_preview: true
  });
};

// Просмотр срока действия подписки
exports.checkSubscription = async (ctx) => {
  const user = await User.findOne({ userId: ctx.from.id });
  
  if (!user || user.status !== 'active') {
    return ctx.reply('❌ У вас нет активной подписки');
  }

  const daysLeft = Math.ceil((user.expireDate - new Date()) / 86400000);
  
  await ctx.replyWithMarkdown(
    `📅 *Срок действия подписки:*\n\n` +
    `Активна до: ${formatDate(user.expireDate)}\n` +
    `Осталось: ${daysLeft} дней\n\n` +
    `Для продления отправьте скриншот оплаты.`
  );
};

// Обработка кнопки "Задать вопрос"
exports.startQuestion = async (ctx) => {
  await ctx.reply('Напишите ваш вопрос текстом и отправьте его. Администратор ответит в ближайшее время.');
};

// Просмотр ответов на вопросы
exports.checkAnswers = async (ctx) => {
  const questions = await Question.find({ 
    userId: ctx.from.id,
    status: 'answered'
  }).sort({ answeredAt: -1 }).limit(5);

  if (!questions.length) {
    return ctx.reply('ℹ️ У вас пока нет ответов на вопросы');
  }

  let message = '📩 *Последние ответы администратора:*\n\n';
  questions.forEach((q, i) => {
    message += `❓ *Вопрос:* ${q.questionText}\n` +
               `📩 *Ответ:* ${q.answerText}\n` +
               `📅 ${formatDate(q.answeredAt)}\n\n`;
  });

  await ctx.replyWithMarkdown(message);
};