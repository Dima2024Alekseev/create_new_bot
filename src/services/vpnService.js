// src/services/vpnService.js
const axios = require('axios');

// Создаем специальный экземпляр axios для работы с API
// withCredentials: true позволяет автоматически отправлять и получать куки
const api = axios.create({
    baseURL: process.env.WG_API_URL,
    withCredentials: true,
});

/**
 * Выполняет вход в API wg-easy и устанавливает сессию (куки).
 */
const login = async () => {
    // URL для входа, который ты нашел
    const loginUrl = '/api/session';
    const password = process.env.WG_API_PASSWORD;

    try {
        // Отправляем пароль и получаем куки в ответ
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
        // Выполняем вход, чтобы убедиться, что у нас есть сессия
        await login();

        // API-адрес для создания клиента
        const createClientUrl = '/api/clients';

        // Создаем клиента. Axios сам отправит нужные куки.
        const createResponse = await api.post(createClientUrl, { name: clientName });
        const newClient = createResponse.data;
        const clientId = newClient.id;

        // API-адрес для получения конфига
        const getConfigUrl = `/api/clients/${clientId}/configuration`;
        
        // Получаем конфиг. Куки снова отправятся автоматически.
        const configResponse = await api.get(getConfigUrl, { responseType: 'text' });

        return configResponse.data;
    } catch (error) {
        // Если авторизация не удалась, выбрасываем ошибку
        console.error('Ошибка при создании клиента VPN:', error.response?.data || error.message);
        throw new Error('Не удалось создать клиента VPN. Проверьте настройки API.');
    }
};