const User = require('../models/User');
const Question = require('../models/Question');
const { Markup } = require('telegraf');
const { checkAdmin } = require('../utils/auth');
const { formatDate } = require('../utils/helpers');

/**
 * Обрабатывает вопрос, заданный пользователем.
 * @param {object} ctx - Объект контекста Telegraf.
 */
exports.handleQuestion = async (ctx) => {
    const userId = ctx.from.id;
    const questionText = ctx.message.text;

    try {
        const user = await User.findOne({ userId });
        const name = user?.firstName || user?.username || 'Пользователь';

        const newQuestion = new Question({
            userId,
            questionText: questionText,
            status: 'pending'
        });

        await newQuestion.save();

        const questionId = newQuestion._id.toString();

        const keyboard = Markup.inlineKeyboard([
            Markup.button.callback('➡️ Ответить', `answer_${questionId}`)
        ]);

        await ctx.telegram.sendMessage(
            process.env.ADMIN_ID,
            `❓ *Новый вопрос от ${name}* (ID: ${userId}):\n` +
            `\n${questionText}`,
            { parse_mode: 'Markdown', ...keyboard }
        );

        // Проверяем статус пользователя для отправки более релевантного ответа
        if (user && user.status === 'active') {
            await ctx.reply('✅ Ваш вопрос отправлен администратору. Он ответит вам в ближайшее время.');
        } else {
            await ctx.reply(
                '✅ Ваш вопрос отправлен администратору. Он ответит вам в ближайшее время.' +
                '\n\n' +
                'Чтобы получить доступ к VPN, пожалуйста, оплатите подписку. ' +
                'Для этого нажмите кнопку "Оплатить подписку" в главном меню.'
            );
        }

    } catch (error) {
        console.error('Ошибка при обработке вопроса:', error);
        await ctx.reply('⚠️ Произошла ошибка при отправке вашего вопроса.');
    }
};

/**
 * Отображает список неотвеченных вопросов для администратора.
 * @param {object} ctx - Объект контекста Telegraf.
 */
exports.listQuestions = async (ctx) => {
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
        const keyboardButtons = [];

        for (const question of questions) {
            const user = await User.findOne({ userId: question.userId });
            const name = user?.firstName || user?.username || 'Неизвестный пользователь';
            const questionId = question._id.toString();
            const date = new Date(question.createdAt).toLocaleString('ru-RU', { timeZone: 'Asia/Krasnoyarsk' });

            message += `*Вопрос от ${name}* (ID: ${question.userId}) ${date}:\n` +
                `_${question.questionText.slice(0, 50)}..._\n\n`;

            keyboardButtons.push(
                Markup.button.callback(`➡️ Ответить на вопрос от ${name}`, `answer_${questionId}`)
            );
        }
        
        await ctx.reply(message, {
            parse_mode: 'Markdown',
            reply_markup: Markup.inlineKeyboard(keyboardButtons, { columns: 1 }).reply_markup
        });

    } catch (error) {
        console.error('Ошибка получения списка вопросов:', error);
        await ctx.reply('⚠️ Не удалось загрузить список вопросов.');
    }
};

/**
 * Обрабатывает ответ администратора на вопрос.
 * @param {object} ctx - Объект контекста Telegraf.
 */
exports.handleAnswer = async (ctx) => {
    const questionId = ctx.session.awaitingAnswerFor;
    const answerText = ctx.message.text;

    try {
        const question = await Question.findById(questionId);
        if (!question) {
            return ctx.reply('❌ Вопрос не найден.');
        }

        // ⚠️ ИЗМЕНЕНО: Добавлен оригинальный вопрос в ответ администратора
        await ctx.telegram.sendMessage(
            question.userId,
            `✅ *Ответ администратора на ваш вопрос:*\n\n` +
            `"${answerText}"\n\n` +
            `_Ваш вопрос: "${question.questionText}"_`,
            { parse_mode: 'Markdown' }
        );

        question.status = 'answered';
        question.answer = answerText;
        await question.save();

        await ctx.reply('✅ Ответ отправлен пользователю.');
        ctx.session.awaitingAnswerFor = null;
    } catch (error) {
        console.error('Ошибка при отправке ответа:', error);
        await ctx.reply('⚠️ Произошла ошибка при отправке ответа.');
    }
};