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
        
        console.log('⌛ Создание клиента:', clientName);
        await api.post('/api/wireguard/client', {
            name: clientName,
            allowedIPs: '10.8.0.0/24'
        });

        // ИСПРАВЛЕНО: Используем правильный эндпоинт для получения конфигурации
        console.log('⌛ Получение конфигурации для:', clientName);
        const configResponse = await api.get(
            `/api/wireguard/client/${clientName}/configuration`,
            { responseType: 'text' }
        );

        if (!configResponse.data.includes('[Interface]')) {
            throw new Error('Неверный формат конфигурации');
        }

        console.log('✅ Конфигурация успешно получена');
        return configResponse.data;

    } catch (error) {
        console.error('❌ Ошибка:', {
            message: error.message,
            response: error.response?.data,
            url: error.config?.url
        });
        throw new Error(`Не удалось получить конфигурацию: ${error.message}`);
    }
};