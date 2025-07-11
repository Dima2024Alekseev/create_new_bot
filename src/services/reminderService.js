const cron = require('node-cron');
const User = require('../models/User');
const Question = require('../models/Question');
const { paymentDetails, formatDate } = require('../utils/helpers');

exports.setupReminders = (bot) => {
  // Ежедневные напоминания в 10:00
  cron.schedule('0 10 * * *', async () => {
    try {
      // 1. Напоминания о подписках
      const expiringUsers = await User.find({
        status: 'active',
        expireDate: { 
          $lte: new Date(Date.now() + process.env.REMIND_DAYS * 86400000),
          $gt: new Date()
        },
        $or: [
          { lastReminder: { $exists: false } },
          { lastReminder: { $lt: new Date(Date.now() - 86400000) } }
        ]
      });

      for (const user of expiringUsers) {
        try {
          const daysLeft = Math.ceil((user.expireDate - new Date()) / 86400000);
          
          await bot.telegram.sendMessage(
            user.userId,
            `⚠️ *Ваша подписка истекает через ${daysLeft} дней!*\n\n` +
            `Продлите VPN за ${process.env.VPN_PRICE} руб.\n\n` +
            paymentDetails(user.userId),
            { parse_mode: 'Markdown' }
          );
          
          await User.updateOne(
            { userId: user.userId },
            { lastReminder: new Date() }
          );
        } catch (e) {
          console.error(`Ошибка напоминания для ${user.userId}:`, e.message);
        }
      }

      // 2. Напоминания о неотвеченных вопросах
      const pendingQuestions = await Question.countDocuments({ 
        status: 'pending',
        createdAt: { $gt: new Date(Date.now() - 7 * 86400000) } // Только за последние 7 дней
      });

      if (pendingQuestions > 0) {
        await bot.telegram.sendMessage(
          process.env.ADMIN_ID,
          `🔔 У вас ${pendingQuestions} неотвеченных вопросов!\n` +
          `Используйте /questions для просмотра\n` +
          `Последний вопрос: ${formatDate(new Date())}`
        );
      }

    } catch (err) {
      console.error('Ошибка в задаче напоминаний:', err);
    }
  });

  // Экстренные напоминания каждые 3 часа о важных вопросах
  cron.schedule('0 */3 * * *', async () => {
    const urgentQuestions = await Question.countDocuments({
      status: 'pending',
      createdAt: { $lt: new Date(Date.now() - 86400000) } // Старые вопросы (>24 часов)
    });
    
    if (urgentQuestions > 0) {
      await bot.telegram.sendMessage(
        process.env.ADMIN_ID,
        `🚨 Срочно! ${urgentQuestions} вопросов ждут ответа более 24 часов!`
      );
    }
  });
};