/**
 * Проверяет, является ли текущий пользователь администратором.
 * @param {object} ctx - Объект контекста Telegraf.
 * @returns {boolean} - true, если пользователь администратор, иначе false.
 */
exports.checkAdmin = (ctx) => {
    return ctx.from && ctx.from.id === parseInt(process.env.ADMIN_ID);
};