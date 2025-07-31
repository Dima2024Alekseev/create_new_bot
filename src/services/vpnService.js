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
        // Шаг 1: Убедимся, что у нас есть активная сессия.
        await login();

        // Шаг 2: Создаем клиента, используя API-адрес, который чаще всего работает
        const createClientUrl = '/api/v1/users';
        console.log(`Отправка запроса на создание клиента по адресу: ${createClientUrl}`);
        
        const createResponse = await api.post(createClientUrl, { name: clientName });
        const newClient = createResponse.data.data; // Здесь может быть разный путь в зависимости от версии
        const clientId = newClient.id;

        // Шаг 3: Получаем конфиг, используя id нового клиента
        const getConfigUrl = `/api/clients/${clientId}/configuration`;
        const configResponse = await api.get(getConfigUrl, { responseType: 'text' });

        return configResponse.data;
    } catch (error) {
        console.error('Ошибка при создании клиента VPN:', error.response?.data || error.message);
        throw new Error('Не удалось создать клиента VPN. Проверьте настройки API.');
    }
};