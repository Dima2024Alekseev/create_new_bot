const User = require('../models/User');
const { Markup } = require('telegraf');
const { checkAdmin } = require('../utils/auth');
const { escapeMarkdown, transliterate } = require('../utils/helpers');
const { createVpnClient } = require('../services/vpnService');
const path = require('path');
const paymentService = require('../services/paymentService');

/**
 * Обрабатывает загруженный пользователем скриншот оплаты.
 * Сохраняет скриншот в БД и отправляет его администратору для проверки.
 * @param {object} ctx - Объект контекста Telegraf.
 */
exports.handlePhoto = async (ctx) => {
    const { id, first_name, username } = ctx.from;
    // Если это админ, и он случайно отправил фото, игнорируем его.
    if (id === parseInt(process.env.ADMIN_ID)) {
        return ctx.reply('Вы в режиме админа, скриншоты не требуются.');
    }
    // Получаем ID последнего (самого большого) фото из массива
    const photo = ctx.message.photo.pop();
    try {
        await paymentService.processNewPaymentPhoto(ctx, id, first_name, username, photo);
        await ctx.reply('✅ Скриншот получен! Админ проверит его в ближайшее время.');
    } catch (error) {
        console.error('Ошибка при обработке фото/платежа:', error);
        await ctx.reply('⚠️ Произошла ошибка при получении вашего скриншота. Пожалуйста, попробуйте позже.');
    }
};

/**
 * Обрабатывает одобрение платежа администратором.
 * Активирует подписку пользователя и отправляет уведомление.
 * @param {object} ctx - Объект контекста Telegraf.
 */
exports.handleApprove = async (ctx) => {
    if (!checkAdmin(ctx)) {
        return ctx.answerCbQuery('🚫 Только для админа');
    }
    const userId = parseInt(ctx.match[1]);
    try {
        await paymentService.approvePayment(ctx, userId);
    } catch (error) {
        console.error(`Ошибка при одобрении платежа для пользователя ${userId}:`, error);
        await ctx.answerCbQuery('⚠️ Ошибка при одобрении платежа!');
        await ctx.reply('⚠️ Произошла ошибка при одобрении платежа. Проверьте логи.');
    }
};

/**
 * Обрабатывает отклонение платежа администратором.
 * Устанавливает статус пользователя как "rejected" и уведомляет его.
 * @param {object} ctx - Объект контекста Telegraf.
 */
exports.handleReject = async (ctx) => {
    if (!checkAdmin(ctx)) {
        return ctx.answerCbQuery('🚫 Только для админа');
    }
    const userId = parseInt(ctx.match[1]);
    try {
        await paymentService.rejectPayment(ctx, userId);
    } catch (error) {
        console.error(`Ошибка при отклонении платежа для пользователя ${userId}:`, error);
        await ctx.answerCbQuery('⚠️ Ошибка при отклонении платежа!');
        await ctx.reply('⚠️ Произошла ошибка при отклонении платежа. Проверьте логи.');
    }
};