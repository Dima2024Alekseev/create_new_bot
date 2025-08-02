// src/utils/helpers.js

/**
 * Генерирует реквизиты для оплаты VPN с динамическим комментарием.
 * @param {number} userId - ID пользователя.
 * @param {string} [name=''] - Имя пользователя.
 * @returns {string} Отформатированная строка с реквизитами.
 */
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
\`2202 2050 2287 6913\` (Сбербанк)
*Обязательно укажите комментарий:*
\`${comment}\`
_Сумма: ${this.formatMoney(price)}_
`;
};

/**
 * Форматирует дату с опциональным временем.
 * @param {Date|string} date - Дата для форматирования.
 * @param {boolean} [withTime=false] - Включать время.
 * @returns {string} Отформатированная строка.
 */
exports.formatDate = (date, withTime = false) => {
  if (!date) return 'Нет данных';
  const d = new Date(date);
  if (isNaN(d.getTime())) return 'Неверная дата';

  const options = {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  };

  if (withTime) {
    options.hour = '2-digit';
    options.minute = '2-digit';
  }

  return d.toLocaleString('ru-RU', options);
};

/**
 * Форматирует продолжительность в читаемый формат.
 * @param {number} ms - Время в миллисекундах.
 * @returns {string} Отформатированная строка.
 */
exports.formatDuration = (ms) => {
  if (!ms || ms < 0) return '0м';
  
  const days = Math.floor(ms / 86400000);
  const hours = Math.floor((ms % 86400000) / 3600000);
  const mins = Math.round((ms % 3600000) / 60000);

  return `${days > 0 ? days + 'д ' : ''}${hours > 0 ? hours + 'ч ' : ''}${mins}м`;
};

/**
 * Экранирует спецсимволы Markdown.
 * @param {string} text - Исходный текст.
 * @returns {string} Экранированный текст.
 */
exports.escapeMarkdown = (text) => {
  if (typeof text !== 'string') return '';
  return text.replace(/([_*[\]()~`>#+\-=|{}.!])/g, '\\$1');
};

/**
 * Транслитерирует строку для использования в именах файлов.
 * @param {string} str - Исходная строка.
 * @returns {string} Транслитерированная строка.
 */
exports.transliterate = (str) => {
  if (!str || typeof str !== 'string') return '';

  const rus = {
    'а': 'a', 'б': 'b', 'в': 'v', 'г': 'g', 'д': 'd', 'е': 'e', 'ё': 'yo',
    'ж': 'zh', 'з': 'z', 'и': 'i', 'й': 'y', 'к': 'k', 'л': 'l', 'м': 'm',
    'н': 'n', 'о': 'o', 'п': 'p', 'р': 'r', 'с': 's', 'т': 't', 'у': 'u',
    'ф': 'f', 'х': 'h', 'ц': 'ts', 'ч': 'ch', 'ш': 'sh', 'щ': 'shch', 'ъ': '',
    'ы': 'y', 'ь': '', 'э': 'e', 'ю': 'yu', 'я': 'ya',
    'А': 'A', 'Б': 'B', 'В': 'V', 'Г': 'G', 'Д': 'D', 'Е': 'E', 'Ё': 'YO',
    'Ж': 'ZH', 'З': 'Z', 'И': 'I', 'Й': 'Y', 'К': 'K', 'Л': 'L', 'М': 'M',
    'Н': 'N', 'О': 'O', 'П': 'P', 'Р': 'R', 'С': 'S', 'Т': 'T', 'У': 'U',
    'Ф': 'F', 'Х': 'H', 'Ц': 'TS', 'Ч': 'CH', 'Ш': 'SH', 'Щ': 'SHCH', 'Ъ': '',
    'Ы': 'Y', 'Ь': '', 'Э': 'E', 'Ю': 'YU', 'Я': 'YA'
  };

  return str.normalize()
    .split('')
    .map(char => rus[char] || char)
    .join('')
    .replace(/[^a-zA-Z0-9_]/g, '')
    .toLowerCase();
};

/**
 * Форматирует сумму в денежный формат.
 * @param {number} amount - Сумма.
 * @returns {string} Отформатированная сумма.
 */
exports.formatMoney = (amount) => {
  return new Intl.NumberFormat('ru-RU', {
    style: 'currency',
    currency: 'RUB',
    minimumFractionDigits: 0
  }).format(amount);
};

/**
 * Проверяет комментарий к платежу.
 * @param {string} comment - Комментарий.
 * @param {number} userId - ID пользователя.
 * @returns {boolean} Соответствует ли формату.
 */
exports.validatePaymentComment = (comment, userId) => {
  if (!comment) return false;
  const regex = new RegExp(`VPN (.+ )?${userId}$`);
  return regex.test(comment.trim());
};