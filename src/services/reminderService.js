const cron = require('node-cron');
const User = require('../models/User');
const { formatDate, formatDuration } = require('../utils/helpers');

module.exports = {
  /**
   * Настройка автоматических напоминаний
   */
  setupReminders: (bot) => {
    // Ежедневная проверка в 10:00
    cron.schedule('0 10 * * *', async () => {
      try {
        await this.checkExpiringSubscriptions(bot);
        await this.checkExpiredSubscriptions(bot);
      } catch (err) {
        console.error('Ошибка в задаче напоминаний:', err);
      }
    });

    // Экстренные напоминания каждые 3 часа
    cron.schedule('0 */3 * * *', async () => {
      await this.checkUrgentReminders(bot);
    });
  },

  /**
   * Проверка истекающих подписок
   */
  checkExpiringSubscriptions: async (bot) => {
    const expiringUsers = await User.find({
      status: 'active',
      expireDate: { 
        $lte: new Date(Date.now() + 3 * 86400000), // 3 дня
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
          `Для продления отправьте скриншот оплаты или используйте /getconfig ` +
          `для получения текущего конфига.`,
          { parse_mode: 'Markdown' }
        );
        
        await User.updateOne(
          { _id: user._id },
          { lastReminder: new Date() }
        );
      } catch (e) {
        console.error(`Ошибка напоминания для ${user.userId}:`, e.message);
      }
    }
  },

  /**
   * Обработка истекших подписок
   */
  checkExpiredSubscriptions: async (bot) => {
    const expiredUsers = await User.find({
      status: 'active',
      expireDate: { $lte: new Date() }
    });

    for (const user of expiredUsers) {
      await User.updateOne(
        { _id: user._id },
        { status: 'expired' }
      );
      
      try {
        await bot.telegram.sendMessage(
          user.userId,
          `❌ Ваша подписка истекла ${formatDate(user.expireDate)}\n\n` +
          `Для продления отправьте скриншот оплаты.`
        );
      } catch (e) {
        console.error(`Ошибка уведомления об истечении для ${user.userId}:`, e.message);
      }
    }
  },

  /**
   * Срочные напоминания админу
   */
  checkUrgentReminders: async (bot) => {
    // Напоминания о старых платежах на проверке (>24 часов)
    const oldPendingPayments = await User.find({
      status: 'pending',
      createdAt: { $lt: new Date(Date.now() - 86400000) }
    }).countDocuments();

    if (oldPendingPayments > 0) {
      await bot.telegram.sendMessage(
        process.env.ADMIN_ID,
        `🚨 Срочно! ${oldPendingPayments} платежей ждут проверки более 24 часов!`
      );
    }

    // Проблемные конфиги (не найденные в WG-Easy)
    const problemConfigs = await User.find({
      configGenerated: true,
      wgConfigChecked: { $ne: true },
      status: 'active'
    }).limit(5);

    for (const user of problemConfigs) {
      const exists = await PaymentService.checkUserInWg(user.wgUsername);
      if (!exists) {
        await bot.telegram.sendMessage(
          process.env.ADMIN_ID,
          `🚨 Проблема с конфигом для ${user.firstName} (@${user.username || 'нет'})\n` +
          `ID: ${user.userId}\n` +
          `WG username: ${user.wgUsername}\n` +
          `Конфиг не найден в WG-Easy!`
        );
      }
      await User.updateOne({ _id: user._id }, { wgConfigChecked: true });
    }
  }
};