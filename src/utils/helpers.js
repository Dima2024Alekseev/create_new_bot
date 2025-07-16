// src/utils/helpers.js

/**
 * Генерирует реквизиты для оплаты VPN с динамическим комментарием.
 * @param {number} userId - ID пользователя.
 * @param {string} [name=''] - Имя пользователя (необязательно, для формирования комментария).
 * @returns {string} Отформатированная строка с реквизитами для оплаты.
 */
exports.paymentDetails = (userId, name = '') => {
  const price = process.env.VPN_PRICE || 132; // Можно использовать, если нужна сумма
  // Формируем комментарий для платежа
  const comment = name
    ? `VPN ${name} ${userId}`
    : `VPN ${userId}`;

  return `
💳 *Реквизиты для оплаты:*

📱 СБП (по номеру):
\`+7 (995) 431-34-57\`
💳 Банковская карта:
\`2202 2050 2287 6913\` (Сбербанк)
*Обязательно укажите комментарий к платежу:*
\`${comment}\`
_Цена: ${price} руб._
`;
};

/**
 * Форматирует объект даты в строку в формате 'ДД.ММ.ГГГГ' или 'ДД.ММ.ГГГГ ЧЧ:ММ'.
 * @param {Date|string} date - Дата для форматирования.
 * @param {boolean} [withTime=false] - Включать ли время в форматированную строку.
 * @returns {string} Отформатированная строка даты/времени.
 */
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

  // Убеждаемся, что date является объектом Date, так как toLocaleString работает с ним
  return new Date(date).toLocaleString('ru-RU', options);
};

/**
 * Форматирует продолжительность в миллисекундах в строку 'Дд Чч Мм'.
 * @param {number} ms - Продолжительность в миллисекундах.
 * @returns {string} Отформатированная строка продолжительности.
 */
exports.formatDuration = (ms) => {
  const days = Math.floor(ms / 86400000);
  const hours = Math.floor((ms % 86400000) / 3600000);
  const mins = Math.round((ms % 3600000) / 60000);

  return `${days}д ${hours}ч ${mins}м`;
};

/**
 * Экранирует специальные символы MarkdownV2 в строке.
 * Используется для текста, который может содержать символы Markdown, но не должен форматироваться.
 * Это предотвращает ошибки парсинга Telegram, если пользовательские данные содержат символы Markdown.
 * @param {string} text - Исходный текст.
 * @returns {string} - Экранированный текст.
 */
exports.escapeMarkdown = (text) => {
  if (typeof text !== 'string') return text; // Убеждаемся, что работаем со строкой
  // Полный список символов, требующих экранирования в MarkdownV2
  // _, *, [, ], (, ), ~, `, >, #, +, -, =, |, {, }, ., !
  const charsToEscape = /[_*[\]()~`>#+\-=|{}.!]/g;
  return text.replace(charsToEscape, '\\$&');
};