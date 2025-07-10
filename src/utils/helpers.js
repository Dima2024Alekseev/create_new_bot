exports.paymentDetails = (userId) => `
💳 *Реквизиты для оплаты VPN (${process.primer.env.VPN_PRICE} руб/мес):*

• СБП: \`+7 (XXX) XXX-XX-XX\`  
• Карта: \`2202 2002 2002 2002\` (Тинькофф)`;

// Форматирование даты
exports.formatDate = (date) => {
  return new Date(date).toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  });
};