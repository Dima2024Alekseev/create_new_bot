const { Markup } = require('telegraf');
const Question = require('../models/Question');
// ИЗМЕНЕНО: Импорт checkAdmin из нового модуля utils/auth
const { checkAdmin } = require('../utils/auth'); 
const { formatDate } = require('../utils/helpers');

/**
 * Обработка вопроса от пользователя
 * @param {object} ctx - Объект контекста Telegraf.
 */
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

/**
 * Уведомление администратора о новом вопросе
 * @param {object} ctx - Объект контекста Telegraf.
 */
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

/**
 * Обработка ответа на вопрос
 * @param {object} ctx - Объект контекста Telegraf.
 */
exports.handleAnswer = async (ctx) => {
  // ИЗМЕНЕНО: Использование checkAdmin из импорта
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
      `📩 *Ответ администратора:*\n"${answerText}"\n\nВаш исходный вопрос: "${question.questionText}"`,
      { parse_mode: 'Markdown' }
    );

    await ctx.reply('✅ Ответ успешно отправлен пользователю.');
    ctx.session.awaitingAnswerFor = null;
  } catch (err) {
    console.error('Ошибка при ответе на вопрос:', err);
    await ctx.reply('⚠️ Не удалось отправить ответ.');
  }
};

/**
 * Список всех вопросов
 * @param {object} ctx - Объект контекста Telegraf.
 */
exports.listQuestions = async (ctx) => {
  // ИЗМЕНЕНО: Использование checkAdmin из импорта
  if (!checkAdmin(ctx)) { 
    if (ctx.callbackQuery) {
        await ctx.answerCbQuery('🚫 Только для админа.');
    }
    return ctx.reply('🚫 Только для админа.');
  }

  if (ctx.callbackQuery) {
      await ctx.answerCbQuery('Загружаю вопросы...');
  }

  try {
    const questions = await Question.find({ status: 'pending' }).sort({ createdAt: -1 }).limit(10);
    
    if (!questions.length) {
      return ctx.reply('ℹ️ Нет ожидающих вопросов.');
    }

    let message = '📋 *Ожидающие ответа вопросы:*\n\n';
    questions.forEach((q, i) => {
      message += `${i + 1}. *Пользователь:* ${q.firstName} (@${q.username || 'нет'})\n`;
      message += `*Вопрос:* "${q.questionText}"\n`;
      message += `*Дата:* ${formatDate(q.createdAt)}\n\n`;
    });

    await ctx.replyWithMarkdown(message, Markup.inlineKeyboard([
      [Markup.button.callback('🔄 Обновить', 'list_questions')]
    ]));
  } catch (err) {
    console.error('Ошибка получения списка вопросов:', err);
    await ctx.reply('⚠️ Не удалось загрузить список вопросов.');
  }
};