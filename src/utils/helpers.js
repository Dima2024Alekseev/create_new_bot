exports.paymentDetails = (userId, name = '') => {
  const price = process.env.VPN_PRICE || 132;
  const comment = name 
    ? `VPN ${name} ${userId}`
    : `VPN ${userId}`;

  return `
💳 *Реквизиты для оплаты (${price} руб/мес):*

📱 СБП (по номеру):
\`+7 (995) 431-34-57\`
💳 Банковская карта:
\`2202 2002 2002 2002\` (Сбербанк)

📌 *Обязательно укажите в комментарии:*
\`${comment}\`

После оплаты отправьте скриншот чека в этот чат.`;
};

exports.formatDate = (date, withTime = false) => {
  const options = {
    day: '2-digit',
    month: '2-digit', 
    year: 'numeric'
  };
  
  if (withTime) {
    options.hour = '2-digit';
    options.minute = '2-digit';
  }

  return new Date(date).toLocaleString('ru-RU', options);
};

// Форматирование времени (дни:часы:минуты)
exports.formatDuration = (ms) => {
  const days = Math.floor(ms / 86400000);
  const hours = Math.floor((ms % 86400000) / 3600000);
  const mins = Math.round((ms % 3600000) / 60000);
  
  return `${days}д ${hours}ч ${mins}м`;
};