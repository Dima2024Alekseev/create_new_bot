const User = require('../models/User');
const { Markup } = require('telegraf');
const { paymentDetails } = require('../utils/helpers');
const { checkAdmin } = require('./adminController');

exports.handleStart = async (ctx) => {
  const { id, first_name } = ctx.from;
  
  // Проверяем режим админа
  if (id === parseInt(process.env.ADMIN_ID) && checkAdmin(ctx)) {
    await ctx.replyWithMarkdown(
      '👋 *Админ-панель*\n\n' +
      'Используйте команду /admin для доступа к панели управления',
      Markup.keyboard([
        ['📊 Статистика', '📝 Вопросы'],
        ['💳 Платежи', '🔄 Режим']
      ]).resize()
    );
    return;
  }

  const user = await User.findOne({ userId: id });
  
  if (user?.status === 'active') {
    return ctx.replyWithMarkdown(
      `✅ *Ваша подписка активна до ${user.expireDate.toLocaleDateString()}*\n\n` +
      'Для продления отправьте новый скриншот оплаты.'
    );
  }

  ctx.replyWithMarkdown(
    `🔐 *VPN подписка: ${process.env.VPN_PRICE} руб/мес*\n\n` +
    `${paymentDetails(id)}\n\n` +
    '_После оплаты отправьте скриншот чека_',
    { disable_web_page_preview: true }
  );
};