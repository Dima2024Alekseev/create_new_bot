// src/services/vpnService.js
const axios = require('axios');

let authToken = null; // Переменная для хранения токена сессии

/**
 * Выполняет вход в API wg-easy и получает токен сессии.
 */
const login = async () => {
    // Если токен уже есть, возвращаем его
    if (authToken) {
        return authToken;
    }

    // API-адрес для входа из твоего примера
    const loginUrl = `${process.env.WG_API_URL}/api/session`;
    const password = process.env.WG_API_PASSWORD;

    try {
        const response = await axios.post(loginUrl, { password });
        authToken = response.data.token;
        console.log('✅ Успешный вход в API wg-easy, получен токен сессии.');
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
        const token = await login(); // Шаг 1: Получаем токен сессии

        // API-адрес для создания клиента из твоего примера
        const createClientUrl = `${process.env.WG_API_URL}/api/clients`;
        // Используем полученный токен для авторизации
        const headers = { 'Authorization': `Bearer ${token}` };

        // Шаг 2: Создаем клиента, используя токен
        const createResponse = await axios.post(
            createClientUrl,
            { name: clientName },
            { headers }
        );

        // API-адрес для получения конфига из твоего примера
        const getConfigUrl = `${process.env.WG_API_URL}/api/clients/${createResponse.data.id}/configuration`;
        
        // Шаг 3: Получаем конфиг-файл созданного клиента
        const configResponse = await axios.get(
            getConfigUrl,
            { 
                headers,
                responseType: 'text' // Получаем ответ как обычный текст
            }
        );

        return configResponse.data;
    } catch (error) {
        // Если авторизация не удалась (статус 401), сбрасываем токен
        if (error.response?.status === 401) {
            authToken = null;
        }
        console.error('Ошибка при создании клиента VPN:', error.response?.data || error.message);
        throw new Error('Не удалось создать клиента VPN. Проверьте настройки API.');
    }
};