const axios = require('axios');
const tough = require('tough-cookie');
const { wrapper } = require('axios-cookiejar-support');

// Конфигурация HTTP-клиента
const cookieJar = new tough.CookieJar();
const api = wrapper(axios.create({
    baseURL: process.env.WG_API_URL,
    jar: cookieJar,
    withCredentials: true,
    timeout: 10000,
    headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
    }
}));

/**
 * Выполняет вход в API wg-easy
 */
const login = async () => {
    try {
        const response = await api.post('/api/session', {
            password: process.env.WG_API_PASSWORD
        });
        
        console.log('✅ Успешная авторизация. Куки:', response.headers['set-cookie']);
        return true;
    } catch (error) {
        console.error('❌ Ошибка авторизации:', {
            status: error.response?.status,
            data: error.response?.data,
            headers: error.response?.headers
        });
        throw new Error('Ошибка авторизации в WG-Easy API');
    }
};

/**
 * Создает VPN-клиента и возвращает его конфигурацию
 */
exports.createVpnClient = async (clientName) => {
    try {
        // 1. Авторизация
        await login();
        
        // 2. Создание клиента
        console.log('⌛ Создаем клиента:', clientName);
        const createResponse = await api.post('/api/wireguard/client', {
            name: clientName,
            allowedIPs: '10.8.0.0/24'
        });

        // 3. Анализ ответа
        const responseData = createResponse.data;
        console.log('📦 Ответ сервера:', JSON.stringify(responseData, null, 2));

        // 4. Извлечение ID клиента (все возможные варианты)
        const clientId = responseData.id 
                      || responseData.clientId
                      || (responseData.data && responseData.data.id)
                      || (responseData.client && responseData.client.id)
                      || clientName; // Последний вариант - используем имя как ID

        if (!clientId) {
            throw new Error('Не удалось определить ID клиента');
        }

        console.log('🔑 Полученный ID клиента:', clientId);

        // 5. Получение конфигурации
        console.log('⌛ Запрашиваем конфигурацию для ID:', clientId);
        const configResponse = await api.get(
            `/api/wireguard/client/${clientId}/configuration`,
            { responseType: 'text' }
        );

        // 6. Проверка конфигурации
        if (!configResponse.data.includes('[Interface]')) {
            throw new Error('Получена неверная конфигурация');
        }

        console.log('✅ Конфигурация успешно получена');
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