// src/services/vpnService.js
const axios = require('axios');

/**
 * Создает нового клиента в wg-easy и возвращает его конфигурацию.
 * @param {string} clientName - Имя клиента (например, Telegram ID).
 * @returns {Promise<string>} - Содержимое конфиг-файла клиента.
 */
exports.createVpnClient = async (clientName) => {
    const createClientUrl = `${process.env.WG_API_URL}/api/v1/users`;
    
    // Используем Basic Auth для доступа к API.
    const authHeader = `Basic ${Buffer.from(`wg-easy:${process.env.WG_API_PASSWORD}`).toString('base64')}`;

    // --- НАЧАЛО ОТЛАДОЧНОГО КОДА ---
    console.log('--- Проверка настроек VPN API ---');
    console.log('URL запроса:', createClientUrl);
    console.log('Пароль:', process.env.WG_API_PASSWORD);
    console.log('--- Конец проверки ---');
    // --- КОНЕЦ ОТЛАДОЧНОГО КОДА ---

    try {
        // Шаг 1: Создаем клиента
        const createResponse = await axios.post(
            createClientUrl,
            { name: clientName },
            { headers: { 'Authorization': authHeader } }
        );

        const newClient = createResponse.data.data;
        const clientId = newClient.id;

        // Шаг 2: Получаем конфиг-файл созданного клиента
        const getConfigUrl = `${process.env.WG_API_URL}/api/v1/users/${clientId}/configuration`;
        const configResponse = await axios.get(
            getConfigUrl,
            { 
                headers: { 'Authorization': authHeader },
                responseType: 'text'
            }
        );

        return configResponse.data;
    } catch (error) {
        console.error('Ошибка при создании клиента VPN:', error.response?.data || error.message);
        throw new Error('Не удалось создать клиента VPN. Проверьте настройки API.');
    }
};