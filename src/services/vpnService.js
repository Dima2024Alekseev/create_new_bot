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

const login = async () => {
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

exports.createVpnClient = async (clientName) => {
    try {
        await login();

        const createClientUrl = '/api/wireguard/client';
        console.log(`Отправка запроса на создание клиента по адресу: ${createClientUrl}`);
        
        const createResponse = await api.post(createClientUrl, { name: clientName });

        // ОТЛАДКА: Выводим весь ответ сервера в консоль, чтобы увидеть его структуру
        console.log('Ответ от сервера на создание клиента:', createResponse.data);
        
        // ИСПРАВЛЕНО: Пытаемся получить ID из разных возможных мест в ответе
        const newClient = createResponse.data.data || createResponse.data;
        const clientId = newClient.id || (newClient.client && newClient.client.id);

        if (!clientId) {
            throw new Error('Не удалось получить ID нового клиента из ответа сервера.');
        }

        const getConfigUrl = `/api/wireguard/client/${clientId}/configuration`;
        const configResponse = await api.get(getConfigUrl, { responseType: 'text' });

        return configResponse.data;
    } catch (error) {
        console.error('Ошибка при создании клиента VPN:', error.response?.data || error.message);
        throw new Error('Не удалось создать клиента VPN. Проверьте настройки API.');
    }
};