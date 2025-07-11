const User = require('../models/User');
const PaymentService = require('../services/paymentService');
const fs = require('fs');
const path = require('path');
const { formatDate } = require('../utils/helpers');

module.exports = {
  /**
   * Обработка фото платежа от пользователя
   */
  handlePhoto: async (ctx) => {
    const { id, first_name, username } = ctx.from;
    
    if (id === parseInt(process.env.ADMIN_ID)) {
      return ctx.reply('Вы админ, скриншоты не требуются');
    }

    const photo = ctx.message.photo.pop();
    
    try {
      await User.findOneAndUpdate(
        { userId: id },
        {
          userId: id,
          username: username || first_name,
          firstName: first_name,
          paymentPhotoId: photo.file_id,
          status: 'pending'
        },
        { upsert: true, new: true }
      );

      await ctx.reply('✅ Скриншот получен! Админ проверит его в ближайшее время.');
      
      // Уведомление админа
      await ctx.telegram.sendPhoto(
        process.env.ADMIN_ID,
        photo.file_id,
        {
          caption: `📸 Новый платёж от ${first_name} (@${username || 'нет'})\nID: ${id}`,
          reply_markup: {
            inline_keyboard: [
              [
                { text: '✅ Принять', callback_data: `approve_${id}` },
                { text: '❌ Отклонить', callback_data: `reject_${id}` }
              ]
            ]
          }
        }
      );
    } catch (err) {
      console.error('Ошибка обработки фото:', err);
      await ctx.reply('⚠️ Произошла ошибка при обработке скриншота');
    }
  },

  /**
   * Подтверждение платежа админом
   */
  const handleApprove = async (ctx) => {
    const userId = parseInt(ctx.match[1]);
    const expireDate = new Date();
    expireDate.setDate(expireDate.getDate() + parseInt(process.env.VPN_DURATION));
  
    try {
      const user = await User.findOne({ userId });
  
      if (!user) {
        await ctx.answerCbQuery('❌ Пользователь не найден');
        return;
      }
  
      let configMessage = '';
      
      try {
        if (!user.configGenerated) {
          const vpnCredentials = await PaymentService.generateVpnCredentials(user);
          
          await ctx.telegram.sendDocument(
            userId,
            { source: fs.createReadStream(vpnCredentials.configPath) },
            {
              caption: `🔐 Ваш конфигурационный файл WireGuard\n\n` +
                       `Логин: ${vpnCredentials.username}\n` +
                       `Пароль: ${vpnCredentials.password}\n\n` +
                       `Срок действия: до ${expireDate.toLocaleDateString('ru-RU')}`
            }
          );
  
          fs.unlinkSync(vpnCredentials.configPath);
  
          configMessage = '\n\n✅ Конфигурация отправлена';
          
          await User.updateOne({ userId }, {
            configGenerated: true,
            wgUsername: vpnCredentials.username,
            wgConfigSent: true
          });
        }
  
        await User.updateOne({ userId }, {
          status: 'active',
          expireDate
        });
  
        await ctx.telegram.sendMessage(
          userId,
          `🎉 Ваш платёж подтверждён!\n\n` +
          `Доступ к VPN активен до ${expireDate.toLocaleDateString('ru-RU')}`
        );
  
        await ctx.answerCbQuery(`✅ Платёж принят${configMessage}`);
      } catch (err) {
        console.error('Error in approval process:', err);
        await ctx.answerCbQuery('⚠️ Ошибка при отправке конфига');
        await ctx.telegram.sendMessage(
          process.env.ADMIN_ID,
          `🚨 Ошибка при подтверждении платежа ${userId}\n` +
          `Ошибка: ${err.message}`
        );
      } finally {
        await ctx.deleteMessage();
      }
    } catch (err) {
      console.error('Approve payment error:', err);
      await ctx.answerCbQuery('⚠️ Ошибка при подтверждении');
    }
  },

  /**
   * Отклонение платежа админом
   */
  handleReject: async (ctx) => {
    const userId = parseInt(ctx.match[1]);

    try {
      const user = await User.findOne({ userId });
      
      // Удаление пользователя из WG-Easy если был создан
      if (user?.wgUsername) {
        await PaymentService.removeUserFromWg(user.wgUsername);
      }

      await User.updateOne(
        { userId },
        { status: 'rejected' }
      );

      await ctx.telegram.sendMessage(
        userId,
        '❌ Ваш платёж отклонён\n\n' +
        'Возможные причины:\n' +
        '- Неверная сумма\n' +
        '- Нет комментария\n' +
        '- Нечитаемый скриншот\n\n' +
        'Попробуйте отправить чек ещё раз.'
      );

      await ctx.answerCbQuery('❌ Платёж отклонён');
      await ctx.deleteMessage();
    } catch (err) {
      console.error('Ошибка отклонения платежа:', err);
      await ctx.answerCbQuery('⚠️ Ошибка при отклонении');
    }
  },

  /**
   * Команда для получения конфига
   */
  handleGetConfig: async (ctx) => {
    const userId = ctx.from.id;
    
    try {
      const user = await User.findOne({ 
        userId, 
        status: 'active',
        configGenerated: true
      });
      
      if (!user) {
        return ctx.reply('❌ У вас нет активной VPN подписки или конфиг не был создан');
      }

      // Проверка срока действия
      if (user.expireDate < new Date()) {
        return ctx.reply('⚠️ Ваша подписка истекла. Для продления отправьте скриншот оплаты.');
      }

      // Проверка существования пользователя в WG-Easy
      const userExists = await PaymentService.checkUserInWg(user.wgUsername);
      if (!userExists) {
        await ctx.reply('⚠️ Ваш конфиг не найден в системе. Администратор уведомлен.');
        
        await ctx.telegram.sendMessage(
          process.env.ADMIN_ID,
          `🚨 Ошибка конфига для @${ctx.from.username || 'no_username'} (${userId})\n` +
          `WG username: ${user.wgUsername}\n` +
          `Требуется ручное вмешательство!`
        );
        return;
      }

      // Скачивание и отправка конфига
      const configPath = await PaymentService.downloadConfig(user.wgUsername);
      
      await ctx.replyWithDocument(
        { source: fs.createReadStream(configPath) },
        {
          caption: `🔐 Ваш конфигурационный файл WireGuard\n\n` +
                   `Срок действия: до ${formatDate(user.expireDate)}\n` +
                   `Это тот же файл, что вы получали ранее.`
        }
      );

      fs.unlinkSync(configPath);
    } catch (err) {
      console.error('Ошибка команды /getconfig:', err);
      await ctx.reply('⚠️ Произошла ошибка при получении конфига. Попробуйте позже.');
    }
  }
};