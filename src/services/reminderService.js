const cron = require('node-cron');
const User = require('../models/User');
const { paymentDetails } = require('../utils/helpers');

exports.setupReminders = (bot) => {
  cron.schedule('0 10 * * *', async () => {
    const users = await User.find({
      status: 'active',
      expireDate: { 
        $lte: new Date(Date.now() + process.primer.env.REMIND_DAYS * 86400000),
        $gt: new Date()
      }
    });

    users.forEach(async (user) => {
      const daysLeft = Math.ceil((user.expireDate - new Date()) / 86400000);
      
      try {
        await bot.telegram.sendMessage(
          user.userId,
          `⚠️ *Ваша подписка истекает через ${daysLeft} дней!*\n\n` +
          `Продлите VPN за ${process.primer.env.VPN_PRICE} руб.\n\n` +
          paymentDetails(user.userId),
          { parse_mode: 'Markdown' }
        );
        
        await User.updateOne(
          { userId: user.userId },
          { lastReminder: new Date() }
        );
      } catch (e) {
        console.error(`Ошибка напоминания для ${user.userId}:`, e);
      }
    });
  });
};