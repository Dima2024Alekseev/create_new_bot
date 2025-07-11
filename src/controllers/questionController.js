const { Markup } = require('telegraf');
const Question = require('../models/Question');
const { checkAdmin } = require('./adminController');

exports.handleQuestion = async (ctx) => {
  if (ctx.message.text.startsWith('/') || !ctx.message.text) return;

  try {
    await Question.create({
      userId: ctx.from.id,
      username: ctx.from.username,
      firstName: ctx.from.first_name,
      questionText: ctx.message.text
    });
    
    await ctx.reply('✅ Ваш вопрос отправлен администратору. Ответ придёт в этом чате.');
    await notifyAdminAboutQuestion(ctx);
  } catch (err) {
    console.error('Ошибка при сохранении вопроса:', err);
    await ctx.reply('⚠️ Не удалось отправить вопрос');
  }
};

async function notifyAdminAboutQuestion(ctx) {
  try {
    await ctx.telegram.sendMessage(
      process.env.ADMIN_ID,
      `❓ Новый вопрос от ${ctx.from.first_name} (@${ctx.from.username || 'нет'}):\n\n` +
      `"${ctx.message.text}"\n\n` +
      `ID пользователя: ${ctx.from.id}`,
      Markup.inlineKeyboard([
        [Markup.button.callback('📝 Ответить', `answer_${ctx.from.id}`)],
        [Markup.button.callback('👀 Все вопросы', 'pending_questions')]
      ])
    );
  } catch (err) {
    console.error('Ошибка уведомления админа:', err);
  }
}

exports.handleAnswer = async (ctx, userId, answerText) => {
  if (!checkAdmin(ctx)) {
    return ctx.reply('🚫 Только для админа');
  }

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
      return ctx.reply('⚠️ Не найден ожидающий вопрос от этого пользователя');
    }

    await ctx.telegram.sendMessage(
      userId,
      `📩 Ответ администратора:\n\n${answerText}\n\n` +
      `Ваш исходный вопрос: "${question.questionText}"`
    );
    
    await ctx.reply('✅ Ответ успешно отправлен пользователю');
  } catch (err) {
    console.error('Ошибка при ответе на вопрос:', err);
    await ctx.reply('⚠️ Не удалось отправить ответ');
  }
};