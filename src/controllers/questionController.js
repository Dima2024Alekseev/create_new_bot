const { Markup } = require('telegraf');
const Question = require('../models/Question');
const { checkAdmin } = require('./adminController');
const { formatDate } = require('../utils/helpers');

// Обработка вопроса от пользователя
exports.handleQuestion = async (ctx) => {
  if (ctx.message.text.startsWith('/') || !ctx.message.text) return;
  try {
    await Question.create({
      userId: ctx.from.id,
      username: ctx.from.username,
      firstName: ctx.from.first_name,
      questionText: ctx.message.text,
      status: 'pending'
    });
    await ctx.reply('✅ Ваш вопрос успешно отправлен администратору.');
    await notifyAdminAboutQuestion(ctx);
  } catch (err) {
    console.error('Ошибка при сохранении вопроса:', err);
    await ctx.reply('⚠️ Не удалось отправить вопрос.');
  }
};

// Уведомление администратора о новом вопросе
async function notifyAdminAboutQuestion(ctx) {
  try {
    await ctx.telegram.sendMessage(
      process.env.ADMIN_ID,
      `❓ Новый вопрос от ${ctx.from.first_name} (@${ctx.from.username || 'нет'}):
"${ctx.message.text}"
ID пользователя: ${ctx.from.id}`,
      Markup.inlineKeyboard([
        [Markup.button.callback('📝 Ответить', `answer_${ctx.from.id}`)],
        [Markup.button.callback('👀 Все вопросы', 'list_questions')]
      ])
    );
  } catch (err) {
    console.error('Ошибка уведомления админа:', err);
  }
}

// Обработка ответа на вопрос
exports.handleAnswer = async (ctx) => {
  if (!checkAdmin(ctx)) {
    return ctx.reply('🚫 Только для админа.');
  }

  const userId = ctx.session.awaitingAnswerFor;
  const answerText = ctx.message.text;

  try {
    const question = await Question.findOneAndUpdate(
      { userId, status: 'pending' },
      {
        answerText,
        status: 'answered',
        answeredAt: new Date()
      },
      { new: true }
    );

    if (!question) {
      return ctx.reply('⚠️ Не найдено активных вопросов от этого пользователя.');
    }

    await ctx.telegram.sendMessage(
      userId,
      `📩 Ответ администратора:
"${answerText}"

Ваш исходный вопрос: "${question.questionText}"`,
      { parse_mode: 'Markdown' }
    );

    await ctx.reply('✅ Ответ успешно отправлен пользователю.');
    ctx.session.awaitingAnswerFor = null;
  } catch (err) {
    console.error('Ошибка при ответе на вопрос:', err);
    await ctx.reply('⚠️ Не удалось отправить ответ.');
  }
};

// Список всех вопросов
exports.listQuestions = async (ctx) => {
  if (!checkAdmin(ctx)) {
    return ctx.reply('🚫 Только для админа.');
  }

  try {
    const questions = await Question.find({ status: 'pending' }).sort({ createdAt: -1 }).limit(10);
    if (!questions.length) {
      return ctx.reply('ℹ️ Нет ожидающих вопросов.');
    }

    let message = '📋 Ожидающие ответа вопросы:\n';
    questions.forEach((q, i) => {
      message += `${i + 1}. ${q.firstName} (@${q.username || 'нет'})\n`;
      message += `"${q.questionText}"\n`;
      message += `Дата: ${formatDate(q.createdAt)}\n\n`;
    });

    await ctx.reply(message, Markup.inlineKeyboard([
      [Markup.button.callback('🔄 Обновить', 'list_questions')]
    ]));
  } catch (err) {
    console.error('Ошибка получения списка вопросов:', err);
    await ctx.reply('⚠️ Не удалось загрузить список вопросов.');
  }
};