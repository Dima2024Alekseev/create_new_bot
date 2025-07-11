exports.paymentDetails = (userId, name = '') => {
  const price = process.env.VPN_PRICE || 132;
  const comment = name 
    ? `VPN ${name} ${userId}`
    : `VPN ${userId}`;

  return `
💳 *Реквизиты для оплаты:*

📱 СБП (по номеру):
\`+7 (995) 431-34-57\`
💳 Банковская карта:
\`2202 2050 2287 6913\` (Сбербанк)`;
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

exports.formatDuration = (ms) => {
  const days = Math.floor(ms / 86400000);
  const hours = Math.floor((ms % 86400000) / 3600000);
  const mins = Math.round((ms % 3600000) / 60000);
  
  return `${days}д ${hours}ч ${mins}м`;
};

exports.getUserMenuButtons = () => {
  return [
    [{ text: '📅 Срок действия', callback_data: 'check_subscription' }],
    [{ text: '❓ Задать вопрос', callback_data: 'ask_question' }],
    [{ text: '📩 Мои ответы', callback_data: 'check_answers' }]
  ];
};