exports.paymentDetails = (userId) => `
💳 *Реквизиты для оплаты VPN (${process.env.VPN_PRICE} руб/мес):*

• СБП: \`+7 (995) 431-34-57\`  
• Карта: \`2202 2002 2002 2002\` (Сбербанк)`;

// Форматирование даты
exports.formatDate = (date) => {
  return new Date(date).toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  });
};