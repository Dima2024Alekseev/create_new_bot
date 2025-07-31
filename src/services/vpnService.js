// src/services/vpnService.js
const axios = require('axios');
const tough = require('tough-cookie');
const { wrapper } = require('axios-cookiejar-support');

// Создаем хранилище для куки
const cookieJar = new tough.CookieJar();

// Создаем специальный экземпляр axios
const api = wrapper(axios.create({
    baseURL: process.env.WG_API_URL,
    jar: cookieJar,
    withCredentials: true,
}));

/**
 * Выполняет вход в API wg-easy
 */
const login = async () => {
    try {
        await api.post('/api/session', {
            password: process.env.WG_API_PASSWORD
        });
    } catch (error) {
        console.error('❌ Ошибка авторизации:', error.response?.data || error.message);
        throw new Error('Ошибка авторизации в WG-Easy API');
    }
};

/**
 * Создает VPN-клиента и возвращает его конфигурацию
 */
exports.createVpnClient = async (clientName) => {
    try {
        await login();
        
        console.log('⌛ Создаем клиента:', clientName);
        const createResponse = await api.post('/api/wireguard/client', {
            name: clientName,
            allowedIPs: '10.8.0.0/24'
        });

        const responseData = createResponse.data;
        
        // ИСПРАВЛЕНО: Поскольку в ответе нет ID, используем имя клиента как ID
        const clientId = responseData.name;
        
        if (!clientId) {
            throw new Error('Не удалось определить имя клиента для получения конфига.');
        }

        console.log('🔑 Используем имя клиента как ID:', clientId);

        console.log('⌛ Запрашиваем конфигурацию для ID:', clientId);
        // Используем имя клиента в URL для получения конфигурации
        const configResponse = await api.get(
            `/api/wireguard/client/${clientId}/configuration`,
            { responseType: 'text' }
        );

        return configResponse.data;

    } catch (error) {
        console.error('🔥 Критическая ошибка:', {
            message: error.message,
            stack: error.stack,
            response: error.response?.data
        });
        
        throw new Error(`Ошибка создания VPN-клиента: ${error.message}`);
    }
};