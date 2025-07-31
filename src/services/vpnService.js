const axios = require('axios');
const tough = require('tough-cookie');
const { wrapper } = require('axios-cookiejar-support');

const cookieJar = new tough.CookieJar();
const api = wrapper(axios.create({
    baseURL: process.env.WG_API_URL,
    jar: cookieJar,
    withCredentials: true,
    timeout: 10000
}));

const login = async () => {
    try {
        const response = await api.post('/api/session', {
            password: process.env.WG_API_PASSWORD
        });
        console.log('✅ Авторизация успешна');
        return true;
    } catch (error) {
        console.error('❌ Ошибка авторизации:', error.response?.data || error.message);
        throw error;
    }
};

exports.createVpnClient = async (clientName) => {
    try {
        // 1. Авторизация
        await login();

        // 2. Создание клиента
        console.log('⌛ Создание клиента:', clientName);
        const createResponse = await api.post('/api/wireguard/client', {
            name: clientName,
            allowedIPs: '10.8.0.0/24'
        });

        // 3. Получение конфигурации (используем имя клиента)
        console.log('⌛ Получение конфигурации для:', clientName);
        const configResponse = await api.get(
            `/api/wireguard/client/${clientName}/download`, // Измененный эндпоинт
            { responseType: 'text' }
        );

        // 4. Проверка конфигурации
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