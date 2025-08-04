// src/utils/helpers.js
const { getConfig } = require('../services/configService');
/**
 * Генерирует реквизиты для оплаты VPN с динамическим комментарием.
 * @param {number} userId - ID пользователя.
 * @param {string} [name=''] - Имя пользователя (необязательно, для формирования комментария).
 * @returns {string} Отформатированная строка с реквизитами для оплаты.
 */
exports.paymentDetails = async (userId, name = '') => {
  const price = await getConfig('vpn_price', 132);
  const phone = await getConfig('payment_phone', '+7 (995) 431-34-57');
  const cardNumber = await getConfig('payment_card_number', '2202 2050 2287 6913');
  const bankName = await getConfig('payment_bank_name', 'Сбербанк');

  const comment = name
    ? `VPN ${name} ${userId}`
    : `VPN ${userId}`;

  return `
      💳 *Реквизиты для оплаты:*

      📱 СБП (по номеру):
      \`${phone}\`
      💳 Банковская карта:
      \`${cardNumber}\` (${bankName})
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
 * @param {string} text - Исходный текст.
 * @returns {string} - Экранированный текст.
 */
exports.escapeMarkdown = (text) => {
  if (typeof text !== 'string') return text;
  const charsToEscape = /[_*[\]()~`>#+\-=|{}.!]/g;
  return text.replace(charsToEscape, '\\$&');
};

/**
 * Транслитерирует строку из кириллицы в латиницу.
 * @param {string} str - Исходная строка на русском языке.
 * @returns {string} - Транслитерированная строка.
 */
exports.transliterate = (str) => {
  const rus = {
    'а': 'a', 'б': 'b', 'в': 'v', 'г': 'g', 'д': 'd', 'е': 'e', 'ё': 'yo', 'ж': 'zh', 'з': 'z', 'и': 'i', 'й': 'y', 'к': 'k', 'л': 'l', 'м': 'm', 'н': 'n', 'о': 'o', 'п': 'p', 'р': 'r', 'с': 's', 'т': 't', 'у': 'u', 'ф': 'f', 'х': 'h', 'ц': 'ts', 'ч': 'ch', 'ш': 'sh', 'щ': 'shch', 'ъ': '', 'ы': 'y', 'ь': '', 'э': 'e', 'ю': 'yu', 'я': 'ya',
    'А': 'A', 'Б': 'B', 'В': 'V', 'Г': 'G', 'Д': 'D', 'Е': 'E', 'Ё': 'YO', 'Ж': 'ZH', 'З': 'Z', 'И': 'I', 'Й': 'Y', 'К': 'K', 'Л': 'L', 'М': 'M', 'Н': 'N', 'О': 'O', 'П': 'P', 'Р': 'R', 'С': 'S', 'Т': 'T', 'У': 'U', 'Ф': 'F', 'Х': 'H', 'Ц': 'TS', 'Ч': 'CH', 'Ш': 'SH', 'Щ': 'SHCH', 'Ъ': '', 'Ы': 'Y', 'Ь': '', 'Э': 'E', 'Ю': 'YU', 'Я': 'YA'
  };

  return str.split('').map(function (char) {
    return rus[char] || char;
  }).join('');
};