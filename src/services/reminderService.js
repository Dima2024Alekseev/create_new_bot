const cron = require('node-cron');
const User = require('../models/User');
const { paymentDetails } = require('../utils/helpers');

exports.setupReminders = (bot) => {
  cron.schedule('0 10 * * *', async () => {
    try {
      const users = await User.find({
        status: 'active',
        expireDate: { 
          $lte: new Date(Date.now() + process.env.REMIND_DAYS * 86400000),
          $gt: new Date(),
          $gt: new Date() // Исключаем уже истекшие
        },
        $or: [
          { lastReminder: { $exists: false } },
          { lastReminder: { $lt: new Date(Date.now() - 86400000) } // Не чаще 1 раза в день
        ]
      });

      for (const user of users) {
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
    } catch (err) {
      console.error('Ошибка в задаче напоминаний:', err);
    }
  });
};