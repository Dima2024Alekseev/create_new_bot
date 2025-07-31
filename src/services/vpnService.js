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

// Добавляем интерцепторы для отладки
api.interceptors.request.use(config => {
    console.log(`➡️ Отправка запроса: ${config.method?.toUpperCase()} ${config.url}`);
    return config;
});

api.interceptors.response.use(response => {
    console.log(`⬅️ Получен ответ: ${response.status} ${response.config.url}`);
    return response;
}, error => {
    console.error(`⚠️ Ошибка запроса: ${error.config?.url} | ${error.response?.status}`);
    return Promise.reject(error);
});

const login = async () => {
    try {
        const response = await api.post('/api/session', {
            password: process.env.WG_API_PASSWORD
        });
        console.log('✅ Авторизация успешна');
        return response.headers['set-cookie'];
    } catch (error) {
        console.error('❌ Ошибка авторизации:', {
            status: error.response?.status,
            data: error.response?.data,
            headers: error.response?.headers
        });
        throw error;
    }
};

exports.createVpnClient = async (clientName) => {
    try {
        // 1. Авторизация
        const cookies = await login();
        
        // 2. Создание клиента
        console.log('⌛ Создание клиента:', clientName);
        const createResponse = await api.post('/api/wireguard/client', {
            name: clientName,
            allowedIPs: '10.8.0.0/24'
        });
        
        // 3. Проверка создания клиента
        console.log('🔍 Проверка списка клиентов');
        const clientsResponse = await api.get('/api/wireguard/clients');
        const clientExists = clientsResponse.data.some(c => c.name === clientName);
        
        if (!clientExists) {
            throw new Error('Клиент не появился в списке после создания');
        }

        // 4. Получение конфигурации (3 попытки с задержкой)
        let config;
        for (let i = 0; i < 3; i++) {
            try {
                console.log(`🔄 Попытка ${i+1} получения конфигурации`);
                const response = await api.get(
                    `/api/wireguard/client/${clientName}/configuration`,
                    { responseType: 'text' }
                );
                
                if (response.data.includes('[Interface]')) {
                    config = response.data;
                    break;
                }
            } catch (error) {
                if (i === 2) throw error;
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
        }

        if (!config) {
            throw new Error('Не удалось получить валидную конфигурацию');
        }

        console.log('✅ Конфигурация успешно получена');
        return config;

    } catch (error) {
        console.error('🔥 Критическая ошибка:', {
            message: error.message,
            stack: error.stack,
            response: error.response?.data
        });
        
        // Попробуем альтернативный метод через веб-интерфейс
        try {
            console.log('🔄 Попытка получения конфигурации через веб-интерфейс');
            const config = await getConfigViaWebInterface(clientName);
            return config;
        } catch (fallbackError) {
            throw new Error(`Ошибка создания VPN-клиента: ${error.message} | Fallback также не сработал: ${fallbackError.message}`);
        }
    }
};

// Альтернативный метод через веб-интерфейс
async function getConfigViaWebInterface(clientName) {
    const puppeteer = require('puppeteer');
    const browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();

    try {
        await page.goto(`${process.env.WG_API_URL}/login`, { waitUntil: 'networkidle2' });
        await page.type('input[name="password"]', process.env.WG_API_PASSWORD);
        await page.click('button[type="submit"]');
        await page.waitForNavigation();
        
        await page.goto(`${process.env.WG_API_URL}/client/${clientName}/download`);
        const config = await page.evaluate(() => document.body.innerText);
        
        if (!config.includes('[Interface]')) {
            throw new Error('Неверный формат конфигурации');
        }
        
        return config;
    } finally {
        await browser.close();
    }
}