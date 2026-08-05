const axios = require('axios');

// Конфигурация API
const API_CONFIG = {
    BASE_URL: 'http://151.245.139.177:51821',
    PASSWORD: process.env.WG_API_PASSWORD,
    TIMEOUT: 30000
};

// Глобальная переменная для хранения cookies
let sessionCookies = null;

const api = axios.create({
    baseURL: API_CONFIG.BASE_URL,
    timeout: API_CONFIG.TIMEOUT,
    headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
    }
});

// Перехватчик запросов для добавления cookies
api.interceptors.request.use(config => {
    if (sessionCookies) {
        config.headers.Cookie = sessionCookies;
        console.log('[DEBUG] Добавляем cookies в запрос');
    }
    return config;
});

// Перехватчик ответов для сохранения cookies
api.interceptors.response.use(response => {
    const cookies = response.headers['set-cookie'] || response.headers['Set-Cookie'];
    if (cookies) {
        sessionCookies = Array.isArray(cookies) ? cookies.join('; ') : cookies;
        console.log('[DEBUG] Получены cookies');
    }
    return response;
}, error => {
    console.error('[DEBUG] Ошибка запроса:', {
        status: error.response?.status,
        data: error.response?.data
    });
    return Promise.reject(error);
});

async function login() {
    try {
        console.log('[DEBUG] Попытка авторизации...');
        const response = await api.post('/api/session', {
            password: API_CONFIG.PASSWORD
        }, {
            validateStatus: (status) => status === 204
        });
        if (!sessionCookies) {
            throw new Error('Не удалось получить cookies авторизации');
        }
        console.log('🔑 Авторизация успешна');
        return true;
    } catch (error) {
        throw new Error(`Ошибка входа в систему: ${error.message}`);
    }
}

async function checkClientNameUnique(clientName) {
    try {
        console.log(`[DEBUG] Проверка уникальности имени клиента: ${clientName}`);
        const response = await api.get('/api/wireguard/client');
        const clients = response.data;
        return !clients.some(c => c.name === clientName);
    } catch (error) {
        console.error('❌ Ошибка проверки уникальности имени клиента:', error.message);
        throw error;
    }
}

async function generateUniqueClientName(baseName) {
    let clientName = baseName;
    let suffix = 1;
    while (!(await checkClientNameUnique(clientName))) {
        clientName = `${baseName}_${suffix}`;
        suffix++;
        console.log(`[DEBUG] Имя ${baseName} занято, пробуем: ${clientName}`);
    }
    return clientName;
}

async function createClient(clientName) {
    try {
        console.log(`[DEBUG] Создание клиента: ${clientName}`);
        const response = await api.post('/api/wireguard/client', {
            name: clientName
        });
        console.log(`✅ Клиент "${clientName}" создан успешно`);
        return response.data;
    } catch (error) {
        console.error('❌ Ошибка создания клиента:', {
            status: error.response?.status,
            data: error.response?.data
        });
        throw error;
    }
}

async function getClientData(clientName) {
    try {
        console.log(`[DEBUG] Поиск клиента: ${clientName}`);
        const response = await api.get('/api/wireguard/client');
        const client = response.data.find(c => c.name === clientName);

        if (!client) {
            throw new Error(`Клиент "${clientName}" не найден`);
        }
        return client;
    } catch (error) {
        console.error('❌ Ошибка поиска клиента:', error.message);
        throw error;
    }
}

async function getClientConfigText(clientId) {
    try {
        console.log(`[DEBUG] Запрос конфигурации для ID: ${clientId}`);
        const response = await api.get(`/api/wireguard/client/${clientId}/configuration`, {
            responseType: 'text'
        });
        return response.data;
    } catch (error) {
        console.error('❌ Ошибка получения конфигурации:', {
            status: error.response?.status,
            data: error.response?.data
        });
        throw error;
    }
}

async function disableClient(clientId) {
    try {
        console.log(`[DEBUG] Отключение клиента с ID: ${clientId}`);
        await api.post(`/api/wireguard/client/${clientId}/disable`);
        console.log(`✅ Клиент с ID "${clientId}" успешно отключен`);
    } catch (error) {
        console.error('❌ Ошибка отключения клиента:', {
            status: error.response?.status,
            data: error.response?.data,
            message: error.message
        });
        throw error;
    }
}

async function enableClient(clientId) {
    try {
        console.log(`[DEBUG] Включение клиента с ID: ${clientId}`);
        await api.post(`/api/wireguard/client/${clientId}/enable`);
        console.log(`✅ Клиент с ID "${clientId}" успешно включен`);
    } catch (error) {
        console.error('❌ Ошибка включения клиента:', {
            status: error.response?.status,
            data: error.response?.data,
            message: error.message
        });
        throw error;
    }
}

async function deleteClient(clientId) {
    try {
        console.log(`[DEBUG] Удаление клиента с ID: ${clientId}`);
        await api.delete(`/api/wireguard/client/${clientId}`);
        console.log(`✅ Клиент с ID "${clientId}" успешно удален`);
    } catch (error) {
        console.error('❌ Ошибка удаления клиента:', {
            status: error.response?.status,
            data: error.response?.data,
            message: error.message
        });
        throw error;
    }
}

// --- ЭКСПОРТИРУЕМЫЕ ФУНКЦИИ ---

/**
 * Создает нового VPN-клиента
 * @param {string} baseName - Базовое имя клиента
 * @returns {Promise<{config: string, clientName: string}>}
 */
exports.createVpnClient = async (baseName) => {
    try {
        console.log(`⌛ Начало создания клиента: ${baseName}`);
        await login();
        const clientName = await generateUniqueClientName(baseName);
        await createClient(clientName);
        await new Promise(resolve => setTimeout(resolve, 1000)); // Ждем создания
        const clientData = await getClientData(clientName);
        const config = await getClientConfigText(clientData.id);
        console.log('✅ Конфигурация успешно получена');
        return { config, clientName };
    } catch (error) {
        console.error('🔥 Критическая ошибка:', {
            message: error.message,
            stack: error.stack
        });
        throw new Error(`Не удалось создать VPN-клиента: ${error.message}`);
    }
};

/**
 * Отключает VPN-клиента (отзыв доступа)
 * @param {string} clientName - Имя клиента
 */
exports.revokeVpnClient = async (clientName) => {
    try {
        console.log(`⌛ Начало отзыва клиента: ${clientName}`);
        await login();
        const clientData = await getClientData(clientName);
        await disableClient(clientData.id);
        console.log(`✅ Клиент "${clientName}" успешно отозван.`);
    } catch (error) {
        console.error('🔥 Критическая ошибка:', {
            message: error.message,
            stack: error.stack
        });
        throw new Error(`Не удалось отозвать VPN-клиента: ${error.message}`);
    }
};

/**
 * Включает VPN-клиента (восстановление доступа)
 * @param {string} clientName - Имя клиента
 */
exports.enableVpnClient = async (clientName) => {
    try {
        console.log(`⌛ Начало включения клиента: ${clientName}`);
        await login();
        const clientData = await getClientData(clientName);
        await enableClient(clientData.id);
        console.log(`✅ Клиент "${clientName}" успешно включен.`);
    } catch (error) {
        console.error('🔥 Критическая ошибка:', {
            message: error.message,
            stack: error.stack
        });
        throw new Error(`Не удалось включить VPN-клиента: ${error.message}`);
    }
};

/**
 * Полностью удаляет VPN-клиента
 * @param {string} clientName - Имя клиента
 */
exports.deleteVpnClient = async (clientName) => {
    try {
        console.log(`⌛ Начало удаления клиента: ${clientName}`);
        await login();
        const clientData = await getClientData(clientName);
        if (!clientData) {
            console.warn(`[WARN] Клиент "${clientName}" не найден, пропускаем удаление`);
            return;
        }
        await deleteClient(clientData.id);
        console.log(`✅ Клиент "${clientName}" успешно удален.`);
    } catch (error) {
        if (error.response?.status === 404) {
            console.warn(`[WARN] Клиент "${clientName}" уже не существует на сервере`);
            return;
        }
        console.error('🔥 Критическая ошибка при удалении:', {
            message: error.message,
            stack: error.stack
        });
        throw new Error(`Не удалось удалить VPN-клиента: ${error.message}`);
    }
};

/**
 * Возвращает список всех VPN-клиентов
 * @returns {Promise<Array>}
 */
exports.listVpnClients = async () => {
    try {
        console.log('[DEBUG] Запрос списка клиентов');
        await login();
        const response = await api.get('/api/wireguard/client');
        return response.data;
    } catch (error) {
        console.error('❌ Ошибка получения списка клиентов:', error.message);
        throw error;
    }
};

/**
 * Получает конфигурацию клиента по имени
 * @param {string} clientName - Имя клиента
 * @returns {Promise<string>} - Текст конфигурации
 */
exports.getVpnClientConfig = async (clientName) => {
    try {
        console.log(`[DEBUG] Получение конфигурации для клиента: ${clientName}`);
        await login();
        const clientData = await getClientData(clientName);
        const config = await getClientConfigText(clientData.id);
        return config;
    } catch (error) {
        console.error('❌ Ошибка получения конфигурации клиента:', error.message);
        throw error;
    }
};