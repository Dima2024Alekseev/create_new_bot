/**
 * Проверяет, является ли текущий пользователь администратором.
 * @param {object} ctx - Объект контекста Telegraf.
 * @returns {boolean} - true, если пользователь администратор, иначе false.
 */
exports.checkAdmin = (ctx) => {
    if (!ctx.from) return false;
    const adminIds = process.env.ADMIN_ID.split(',').map(id => parseInt(id.trim()));
    return adminIds.includes(ctx.from.id);
};