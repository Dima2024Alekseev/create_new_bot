const { Markup } = require('telegraf');
const Question = require('../models/Question'); // Модель для вопросов
const { checkAdmin } = require('./adminController'); // Функция для проверки админа
const { formatDate } = require('../utils/helpers'); // Утилита для форматирования даты

/**
 * Обрабатывает входящий текст от пользователя как новый вопрос.
 * Сохраняет вопрос в базе данных и уведомляет администратора.
 * @param {object} ctx - Объект контекста Telegraf.
 */
exports.handleQuestion = async (ctx) => {
  // Игнорируем команды (начинающиеся с '/') и пустые сообщения
  if (ctx.message.text.startsWith('/') || !ctx.message.text) return;
  
  try {
    // Создаем новый документ вопроса в MongoDB
    await Question.create({
      userId: ctx.from.id,
      username: ctx.from.username,
      firstName: ctx.from.first_name,
      questionText: ctx.message.text,
      status: 'pending' // Устанавливаем статус "ожидает ответа"
    });
    
    await ctx.reply('✅ Ваш вопрос успешно отправлен администратору.');
    
    // Уведомляем администратора о новом вопросе
    await notifyAdminAboutQuestion(ctx);
  } catch (err) {
    console.error('Ошибка при сохранении вопроса:', err);
    await ctx.reply('⚠️ Не удалось отправить вопрос.');
  }
};

/**
 * Отправляет уведомление администратору о новом поступившем вопросе.
 * @param {object} ctx - Объект контекста Telegraf (используется для доступа к информации о пользователе и методам Telegram).
 */
async function notifyAdminAboutQuestion(ctx) {
  try {
    await ctx.telegram.sendMessage(
      process.env.ADMIN_ID,
      `❓ Новый вопрос от ${ctx.from.first_name} (@${ctx.from.username || 'нет'}):
"${ctx.message.text}"
ID пользователя: ${ctx.from.id}`,
      Markup.inlineKeyboard([
        [Markup.button.callback('📝 Ответить', `answer_${ctx.from.id}`)], // Кнопка для ответа на вопрос
        [Markup.button.callback('👀 Все вопросы', 'list_questions')] // Кнопка для просмотра всех вопросов
      ])
    );
  } catch (err) {
    console.error('Ошибка уведомления админа:', err);
  }
}

/**
 * Обрабатывает ответ администратора на вопрос пользователя.
 * Обновляет статус вопроса в базе данных и отправляет ответ пользователю.
 * @param {object} ctx - Объект контекста Telegraf.
 */
exports.handleAnswer = async (ctx) => {
  // Проверяем, является ли отправитель администратором
  if (!checkAdmin(ctx)) {
    return ctx.reply('🚫 Только для админа.');
  }

  // Получаем ID пользователя, которому отвечаем, из сессии
  const userId = ctx.session.awaitingAnswerFor;
  // Получаем текст ответа администратора
  const answerText = ctx.message.text;

  try {
    // Находим и обновляем первый вопрос от пользователя со статусом "pending"
    const question = await Question.findOneAndUpdate(
      { userId, status: 'pending' },
      {
        answerText,
        status: 'answered', // Меняем статус на "отвечен"
        answeredAt: new Date() // Устанавливаем время ответа
      },
      { new: true } // Возвращаем обновленный документ
    );

    if (!question) {
      return ctx.reply('⚠️ Не найдено активных вопросов от этого пользователя.');
    }

    // Отправляем ответ пользователю
    await ctx.telegram.sendMessage(
      userId,
      `📩 *Ответ администратора:*\n"${answerText}"\n\nВаш исходный вопрос: "${question.questionText}"`,
      { parse_mode: 'Markdown' } // Используем Markdown для форматирования
    );

    await ctx.reply('✅ Ответ успешно отправлен пользователю.');
    // Сбрасываем состояние ожидания ответа в сессии администратора
    ctx.session.awaitingAnswerFor = null;
  } catch (err) {
    console.error('Ошибка при ответе на вопрос:', err);
    await ctx.reply('⚠️ Не удалось отправить ответ.');
  }
};

/**
 * Возвращает список вопросов, ожидающих ответа, администратору.
 * @param {object} ctx - Объект контекста Telegraf.
 */
exports.listQuestions = async (ctx) => {
  // Проверяем, является ли отправитель администратором
  if (!checkAdmin(ctx)) {
    // Если это callbackQuery (нажатие кнопки), отвечаем на него, чтобы убрать "часики"
    if (ctx.callbackQuery) {
        await ctx.answerCbQuery('🚫 Только для админа.');
    }
    return ctx.reply('🚫 Только для админа.'); // Отвечаем в чат
  }

  // Если это callbackQuery, отвечаем на него, чтобы убрать "часики" с кнопки
  // и дать обратную связь пользователю о загрузке.
  if (ctx.callbackQuery) {
      await ctx.answerCbQuery('Загружаю вопросы...');
  }

  try {
    // Находим до 10 вопросов со статусом "pending", отсортированных по дате создания (от новых к старым)
    const questions = await Question.find({ status: 'pending' }).sort({ createdAt: -1 }).limit(10);
    
    if (!questions.length) {
      // Если вопросов нет, сообщаем об этом
      return ctx.reply('ℹ️ Нет ожидающих вопросов.');
    }

    // Формируем сообщение со списком вопросов
    let message = '📋 *Ожидающие ответа вопросы:*\n\n';
    questions.forEach((q, i) => {
      message += `${i + 1}. *Пользователь:* ${q.firstName} (@${q.username || 'нет'})\n`;
      message += `*Вопрос:* "${q.questionText}"\n`;
      message += `*Дата:* ${formatDate(q.createdAt)}\n\n`; // Используем formatDate для удобного отображения
    });

    // Отправляем сообщение со списком и кнопкой "Обновить"
    await ctx.replyWithMarkdown(message, Markup.inlineKeyboard([
      [Markup.button.callback('🔄 Обновить', 'list_questions')]
    ]));
  } catch (err) {
    console.error('Ошибка получения списка вопросов:', err);
    await ctx.reply('⚠️ Не удалось загрузить список вопросов.');
    // В случае ошибки, если это был callbackQuery, можно отправить еще одно уведомление,
    // но обычно достаточно того, что уже было отправлено 'Загружаю вопросы...'.
  }
};