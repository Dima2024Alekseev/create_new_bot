const User = require('../models/User');
const { paymentDetails } = require('../utils/helpers');

exports.handleStart = async (ctx) => {
  const { id, first_name, last_name, username } = ctx.from;
  
  if (id === parseInt(process.env.ADMIN_ID)) {
    return ctx.replyWithMarkdown(
      '👋 *Админ-панель*\n\n' +
      'Команды:\n' +
      '/check - Проверить заявки\n' +
      '/stats - Статистика'
    );
  }

  const user = await User.findOne({ userId: id });
  
  if (user?.status === 'active') {
    return ctx.replyWithMarkdown(
      `✅ *Ваша подписка активна до ${user.expireDate.toLocaleDateString()}*\n\n` +
      'Для продления отправьте новый скриншот оплаты.'
    );
  }

  ctx.replyWithMarkdown(
    `🔐 *VPN подписка: ${process.primer.env.VPN_PRICE} руб/мес*\n\n` +
    `${paymentDetails(id)}\n\n` +
    '_После оплаты отправьте скриншот чека_',
    { disable_web_page_preview: true }
  );
};