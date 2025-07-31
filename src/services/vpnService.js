const axios = require('axios');
const { execSync } = require('child_process');

// Конфигурация API
const API_CONFIG = {
  BASE_URL: 'http://37.233.85.212:51821',
  PASSWORD: process.env.WG_API_PASSWORD,
  SERVER_PUBLIC_KEY: '+VmjO9mBKNMW7G7sdn6Haqxzx2YXgi592/LfepbRLDU=',
  TIMEOUT: 15000
};

// Глобальная сессия
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
    const response = await api.post('/api/session', {
      password: API_CONFIG.PASSWORD
    });
    sessionCookie = response.headers['set-cookie']?.toString();
    if (!sessionCookie) throw new Error('Не получены куки авторизации');
    console.log('🔑 Авторизация успешна');
    return true;
  } catch (error) {
    console.error('❌ Ошибка авторизации:', { status: error.response?.status, data: error.response?.data });
    throw new Error('Ошибка входа в систему');
  }
}

async function createClient(clientName) {
  try {
    const response = await api.post('/api/wireguard/client', {
      name: clientName,
      allowedIPs: '10.8.0.0/24'
    });
    console.log(`✅ Клиент "${clientName}" создан успешно.`);
    return response.data;
  } catch (error) {
    console.error('❌ Ошибка создания клиента:', { status: error.response?.status, data: error.response?.data });
    throw error;
  }
}

async function getClientData(clientName) {
  try {
    const response = await api.get('/api/wireguard/client');
    const client = response.data.find(c => c.name === clientName);
    if (!client) throw new Error(`Клиент с именем "${clientName}" не найден.`);
    return client;
  } catch (error) {
    console.error('❌ Ошибка получения данных клиента:', error.message);
    throw error;
  }
}

/**
 * Получает полную конфигурацию клиента (включая приватный ключ и PresharedKey) в виде текста из API.
 * @param {string} clientId ID клиента.
 * @returns {Promise<object>} Объект с извлеченными ключами: { privateKey, presharedKey }.
 */
async function getClientConfigFromText(clientId) {
    const endpoint = `/api/wireguard/client/${clientId}/configuration`;
    try {
        const response = await api.get(endpoint, {
            responseType: 'text' // Указываем, что ожидаем текстовый ответ, а не JSON
        });

        const configText = response.data;

        // Регулярные выражения для поиска нужных ключей
        const privateKeyMatch = configText.match(/PrivateKey = (.+)/);
        const presharedKeyMatch = configText.match(/PresharedKey = (.+)/);

        if (!privateKeyMatch) {
            throw new Error('Не удалось найти PrivateKey в конфигурации.');
        }

        const privateKey = privateKeyMatch[1].trim();
        const presharedKey = presharedKeyMatch ? presharedKeyMatch[1].trim() : null; // PresharedKey может отсутствовать

        return { privateKey, presharedKey };
    } catch (error) {
        console.error('❌ Ошибка получения конфигурации клиента:', error.message);
        throw new Error(`Не удалось получить полную конфигурацию клиента: ${error.message}`);
    }
}

/**
 * Генерирует финальный конфигурационный файл.
 * @param {object} configData Объект с данными для конфигурации.
 * @returns {string} Строка конфигурационного файла.
 */
function generateConfig(configData) {
  if (!configData.privateKey || !configData.address || !API_CONFIG.SERVER_PUBLIC_KEY) {
    throw new Error('Недостаточно данных для генерации конфигурации.');
  }

  // Добавляем PresharedKey только если он существует
  const presharedKeyLine = configData.presharedKey ? `PresharedKey = ${configData.presharedKey}` : '';

  return `[Interface]
PrivateKey = ${configData.privateKey}
Address = ${configData.address}/24
DNS = 1.1.1.1

[Peer]
PublicKey = ${API_CONFIG.SERVER_PUBLIC_KEY}
${presharedKeyLine}
Endpoint = ${API_CONFIG.BASE_URL.replace('http://', '').replace(':51821', '')}:51820
AllowedIPs = 0.0.0.0/0
PersistentKeepalive = 25`;
}

/**
 * Основная функция для создания VPN-клиента.
 * @param {string} clientName Имя клиента.
 * @returns {Promise<string>} Строка конфигурационного файла.
 */
exports.createVpnClient = async (clientName) => {
  try {
    // 1. Авторизация
    await login();

    // 2. Создание клиента через API (API сам сгенерирует ключи)
    console.log(`⌛ Создаем клиента: ${clientName}`);
    const creationResponse = await createClient(clientName);
    const clientId = creationResponse.id; // Получаем ID созданного клиента

    // 3. Получаем данные о созданном клиенте, чтобы узнать его IP-адрес
    // Это нужно, потому что API не возвращает полный конфиг в одном запросе
    const clientData = await getClientData(clientName);

    // 4. Получаем полную конфигурацию в виде текста и извлекаем ключи
    console.log(`🔍 Получаем ключи из конфигурации клиента: ${clientName}`);
    const { privateKey, presharedKey } = await getClientConfigFromText(clientId);

    // 5. Генерируем финальный конфигурационный файл, используя все собранные данные
    console.log(`⚙️ Генерируем конфиг для: ${clientName}`);
    const config = generateConfig({
        privateKey,
        presharedKey,
        address: clientData.address,
    });

    console.log('✅ Конфигурация успешно сгенерирована.');
    return config;
  } catch (error) {
    console.error('🔥 Критическая ошибка в createVpnClient:', {
      message: error.message,
      stack: error.stack
    });
    throw new Error(`Не удалось создать VPN-клиента: ${error.message}`);
  }
};