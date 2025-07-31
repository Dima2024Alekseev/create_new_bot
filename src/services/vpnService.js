const axios = require('axios');

// Конфигурация API
const API_CONFIG = {
    BASE_URL: 'http://37.233.85.212:51821',
    PASSWORD: process.env.WG_API_PASSWORD,
    TIMEOUT: 15000
};

let sessionCookie = null;

const api = axios.create({
    baseURL: API_CONFIG.BASE_URL,
    timeout: API_CONFIG.TIMEOUT,
    headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
    }
});

api.interceptors.request.use(config => {
    if (sessionCookie) {
        config.headers.Cookie = sessionCookie;
    }
    return config;
});

async function login() {
    try {
        const response = await api.post('/api/session', { password: API_CONFIG.PASSWORD });
        sessionCookie = response.headers['set-cookie']?.toString();
        if (!sessionCookie) {
            throw new Error('Не получены куки авторизации');
        }
        console.log('🔑 Авторизация успешна');
    } catch (error) {
        console.error('❌ Ошибка авторизации:', {
            status: error.response?.status,
            data: error.response?.data
        });
        throw new Error('Ошибка входа в систему');
    }
}

// ИЗМЕНЕНО: Эта функция теперь возвращает данные созданного клиента
async function createClient(clientName) {
    try {
        const response = await api.post('/api/wireguard/client', {
            name: clientName,
            allowedIPs: '10.8.0.0/24'
        });
        return response.data; // Возвращаем данные из ответа API
    } catch (error) {
        console.error('❌ Ошибка создания клиента:', {
            status: error.response?.status,
            data: error.response?.data
        });
        throw error;
    }
}

// УДАЛЕНО: Эта функция больше не нужна, так как createClient уже возвращает нужные данные.
// async function getClientData(clientName) { ... }

function generateConfig(clientData) {
    return `[Interface]
PrivateKey = ${clientData.privateKey}
Address = ${clientData.address}
DNS = 1.1.1.1

[Peer]
PublicKey = ${clientData.serverPublicKey}
Endpoint = ${API_CONFIG.BASE_URL.replace('http://', '').replace(':51821', '')}:51820
AllowedIPs = 0.0.0.0/0
PersistentKeepalive = 25`;
}

exports.createVpnClient = async (clientName) => {
    try {
        await login();

        console.log(`⌛ Создаем клиента: ${clientName}`);
        // ИЗМЕНЕНО: Теперь мы сразу получаем clientData из createClient
        const clientData = await createClient(clientName);

        if (!clientData || !clientData.privateKey || !clientData.serverPublicKey) {
             console.error('❌ API не вернул необходимые ключи для клиента.');
             console.log('Полученный ответ:', JSON.stringify(clientData, null, 2));
             throw new Error('От API не получены ключи для конфигурации');
        }

        console.log(`⚙️ Генерируем конфиг для: ${clientName}`);
        const config = generateConfig(clientData);

        if (!config) {
            throw new Error('Не удалось сгенерировать конфигурацию');
        }

        console.log('✅ Конфигурация успешно сгенерирована');
        return config;
    } catch (error) {
        console.error('🔥 Критическая ошибка:', {
            message: error.message,
            stack: error.stack
        });
        throw new Error(`Не удалось создать VPN-клиента: ${error.message}`);
    }
};