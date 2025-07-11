// services/reminderService.js
const cron = require('node-cron');
const User = require('../models/User');
const Question = require('../models/Question');
const { paymentDetails, formatDate } = require('../utils/helpers');
const { deleteWgClient } = require('./wireguardService'); // <-- Импортируем функцию удаления WG клиента

exports.setupReminders = (bot) => {
  // Ежедневные напоминания о скором истечении подписки в 10:00 по Москве
  cron.schedule('0 10 * * *', async () => {
    console.log('[Cron] Запуск задачи напоминаний о подписках и вопросах...');
    try {
      const now = new Date();

      const expiringUsers = await User.find({
        status: 'active',
        expireDate: {
          $lte: new Date(now.getTime() + process.env.REMIND_DAYS * 86400000), // Дата истечения <= (сейчас + REMIND_DAYS дней)
          $gt: now                                                        // Дата истечения > (сейчас)
        },
        $or: [
          { lastReminder: { $exists: false } },
          { lastReminder: { $lt: new Date(now.getTime() - 86400000) } }
        ]
      });

      console.log(`[Cron] Найдено ${expiringUsers.length} пользователей с истекающей подпиской.`);

      for (const user of expiringUsers) {
        try {
          const daysLeft = Math.ceil((user.expireDate - now) / 86400000);

          await bot.telegram.sendMessage(
            user.userId,
            `⚠️ *Ваша подписка истекает через ${daysLeft} дней!*\n\n` +
            `Продлите VPN за ${process.env.VPN_PRICE} руб.\n\n` +
            paymentDetails(user.userId, user.firstName || user.username),
            { parse_mode: 'Markdown', disable_web_page_preview: true }
          );

          await User.updateOne(
            { userId: user.userId },
            { lastReminder: now }
          );
          console.log(`[Cron] Отправлено напоминание пользователю ${user.userId}.`);
        } catch (e) {
          console.error(`[Cron] Ошибка напоминания для ${user.userId}:`, e.message);
        }
      }

      // Напоминания о неотвеченных вопросах (для админа)
      const pendingQuestions = await Question.countDocuments({
        status: 'pending',
        createdAt: { $gt: new Date(now.getTime() - 7 * 86400000) } // Только за последние 7 дней
      });

      if (pendingQuestions > 0) {
        await bot.telegram.sendMessage(
          process.env.ADMIN_ID,
          `🔔 У вас ${pendingQuestions} неотвеченных вопросов!\n` +
          `Используйте /questions для просмотра\n` +
          `Последний вопрос: ${formatDate(now)}`
        );
        console.log(`[Cron] Отправлено напоминание админу о ${pendingQuestions} вопросах.`);
      }

    } catch (err) {
      console.error('[Cron] Ошибка в ежедневной задаче напоминаний:', err);
    }
  });

  // НОВАЯ ЗАДАЧА: Обработка пользователей, у которых подписка УЖЕ ИСТЕКЛА
  // Запускается ежедневно в 11:00 по Москве (через час после основной проверки)
  cron.schedule('0 11 * * *', async () => {
    console.log('[Cron] Запуск задачи обработки истекших подписок...');
    try {
      const now = new Date();

      const expiredUsers = await User.find({
        status: 'active',
        expireDate: { $lte: now }
      });

      console.log(`[Cron] Найдено ${expiredUsers.length} пользователей с истекшей подпиской.`);

      for (const user of expiredUsers) {
        try {
          await bot.telegram.sendMessage(
            user.userId,
            `🚫 *Ваша подписка на VPN истекла!*` +
            `\n\nЧтобы продолжить пользоваться VPN, пожалуйста, продлите подписку.` +
            `\n\nПродлите VPN за ${process.env.VPN_PRICE} руб.\n\n` +
            paymentDetails(user.userId, user.firstName || user.username),
            { parse_mode: 'Markdown', disable_web_page_preview: true }
          );

          // !!! АВТОМАТИЧЕСКОЕ УДАЛЕНИЕ КЛИЕНТА WIREGUARD !!!
          if (user.wireguardPeerId) {
            try {
              await deleteWgClient(user.wireguardPeerId); // <-- Вызов функции удаления WireGuard клиента
              console.log(`[Cron] Клиент WireGuard ${user.wireguardPeerId} для пользователя ${user.userId} удален.`);
              await bot.telegram.sendMessage(
                process.env.ADMIN_ID,
                `✅ Клиент WireGuard ${user.wireguardClientName} (ID: ${user.wireguardPeerId}) для пользователя ${user.firstName || user.username} (ID: ${user.userId}) был автоматически удален.`
              );
            } catch (wgDeleteError) {
              console.error(`[Cron] Ошибка при удалении WireGuard клиента ${user.wireguardPeerId} для ${user.userId}:`, wgDeleteError.message);
              await bot.telegram.sendMessage(
                process.env.ADMIN_ID,
                `⚠️ Ошибка автоматического удаления WireGuard клиента для пользователя ${user.firstName || user.username} (ID: ${user.userId}). ` +
                `Peer ID: ${user.wireguardPeerId}. Причина: ${wgDeleteError.message}. Требуется ручная проверка.`
              );
            }
          }

          await User.updateOne(
            { userId: user.userId },
            {
              status: 'inactive',
              lastReminder: now,
              wireguardPeerId: null, // Очищаем ID пира после удаления
              wireguardClientName: null // Очищаем имя клиента
            }
          );
          console.log(`[Cron] Подписка пользователя ${user.userId} истекла, статус изменен на 'inactive'.`);
        } catch (e) {
          console.error(`[Cron] Ошибка при обработке истекшей подписки для ${user.userId}:`, e.message);
        }
      }
    } catch (err) {
      console.error('[Cron] Ошибка в задаче обработки истекших подписок:', err);
    }
  });

  // Экстренные напоминания каждые 3 часа о важных (старых) вопросах (для админа)
  cron.schedule('0 */3 * * *', async () => {
    console.log('[Cron] Запуск задачи экстренных напоминаний о вопросах...');
    try {
      const now = new Date();
      const urgentQuestions = await Question.countDocuments({
        status: 'pending',
        createdAt: { $lt: new Date(now.getTime() - 86400000) } // Вопросы старше 24 часов
      });

      if (urgentQuestions > 0) {
        await bot.telegram.sendMessage(
          process.env.ADMIN_ID,
          `🚨 Срочно! ${urgentQuestions} вопросов ждут ответа более 24 часов!`
        );
        console.log(`[Cron] Отправлено экстренное напоминание админу о ${urgentQuestions} срочных вопросах.`);
      }
    } catch (err) {
      console.error('[Cron] Ошибка в задаче экстренных напоминаний:', err);
    }
  });

  console.log('✅ Напоминания cron запланированы.');
};