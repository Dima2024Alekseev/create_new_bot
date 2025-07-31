// src/services/vpnService.js
const axios = require('axios');

let authToken = null; // Переменная для хранения токена

/**
 * Выполняет вход в API wg-easy и получает токен.
 */
const login = async () => {
    if (authToken) {
        return authToken;
    }

    const loginUrl = `${process.env.WG_API_URL}/api/v1/login`;
    const password = process.env.WG_API_PASSWORD;

    try {
        const response = await axios.post(loginUrl, { password });
        authToken = response.data.token;
        console.log('✅ Успешный вход в API wg-easy, получен токен.');
        return authToken;
    } catch (error) {
        console.error('❌ Ошибка входа в API wg-easy:', error.response?.data || error.message);
        throw new Error('Не удалось войти в API. Проверьте WG_API_URL и WG_API_PASSWORD.');
    }
};

/**
 * Создает нового клиента в wg-easy и возвращает его конфигурацию.
 * @param {string} clientName - Имя клиента (например, Telegram ID).
 * @returns {Promise<string>} - Содержимое конфиг-файла клиента.
 */
exports.createVpnClient = async (clientName) => {
    try {
        const token = await login(); // Шаг 1: Получаем токен

        const createClientUrl = `${process.env.WG_API_URL}/api/v1/users`;
        const headers = { 'Authorization': `Bearer ${token}` };

        // Шаг 2: Создаем клиента, используя токен
        const createResponse = await axios.post(
            createClientUrl,
            { name: clientName },
            { headers }
        );

        const newClient = createResponse.data.data;
        const clientId = newClient.id;

        // Шаг 3: Получаем конфиг-файл созданного клиента
        const getConfigUrl = `${process.env.WG_API_URL}/api/v1/users/${clientId}/configuration`;
        const configResponse = await axios.get(
            getConfigUrl,
            { 
                headers,
                responseType: 'text'
            }
        );

        return configResponse.data;
    } catch (error) {
        // Если авторизация не удалась, пытаемся войти снова на следующий раз
        if (error.response?.status === 401) {
            authToken = null;
        }
        console.error('Ошибка при создании клиента VPN:', error.response?.data || error.message);
        throw new Error('Не удалось создать клиента VPN. Проверьте настройки API.');
    }
};