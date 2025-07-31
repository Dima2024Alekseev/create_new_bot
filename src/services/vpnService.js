// src/services/vpnService.js
const axios = require('axios');
const tough = require('tough-cookie');
const { wrapper } = require('axios-cookiejar-support');

// Создаем хранилище для куки
const cookieJar = new tough.CookieJar();

// Создаем специальный экземпляр axios, который будет автоматически использовать хранилище куки
const api = wrapper(axios.create({
    baseURL: process.env.WG_API_URL,
    jar: cookieJar, // Указываем хранилище куки
    withCredentials: true,
}));

/**
 * Выполняет вход в API wg-easy и устанавливает сессию (куки).
 */
const login = async () => {
    // API-адрес для входа
    const loginUrl = '/api/session';
    const password = process.env.WG_API_PASSWORD;

    try {
        // Отправляем пароль и получаем куки. Axios автоматически сохранит их в cookieJar.
        await api.post(loginUrl, { password });
        console.log('✅ Успешный вход в API wg-easy, получены сессионные куки.');
    } catch (error) {
        console.error('❌ Ошибка входа в API wg-easy:', error.response?.data || error.message);
        throw new Error('Не удалось войти в API. Проверьте WG_API_URL и WG_API_PASSWORD.');
    }
};

/**
 * Создает нового клиента в wg-easy.
 * @param {string} clientName - Имя клиента (например, Telegram ID).
 * @returns {Promise<string>} - Содержимое конфиг-файла клиента.
 */
exports.createVpnClient = async (clientName) => {
    try {
        // Шаг 1: Выполняем вход, чтобы убедиться, что у нас есть сессия.
        await login();

        // Шаг 2: Создаем клиента. Axios теперь сам отправит нужные куки из хранилища.
        const createResponse = await api.post('/api/clients', { name: clientName });
        const newClient = createResponse.data;
        const clientId = newClient.id;

        // Шаг 3: Получаем конфиг. Куки снова отправятся автоматически.
        const configResponse = await api.get(`/api/clients/${clientId}/configuration`, { responseType: 'text' });

        return configResponse.data;
    } catch (error) {
        // Если авторизация не удалась, выбрасываем ошибку
        console.error('Ошибка при создании клиента VPN:', error.response?.data || error.message);
        throw new Error('Не удалось создать клиента VPN. Проверьте настройки API.');
    }
};