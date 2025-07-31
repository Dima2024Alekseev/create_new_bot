const axios = require('axios');
const { execSync } = require('child_process');

// Конфигурация API
const API_CONFIG = {
  BASE_URL: 'http://37.233.85.212:51821',
  PASSWORD: process.env.WG_API_PASSWORD,
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

// Интерцептор для обработки кук
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
    if (!sessionCookie) {
      throw new Error('Не получены куки авторизации');
    }

    console.log('🔑 Авторизация успешна');
    return true;
  } catch (error) {
    console.error('❌ Ошибка авторизации:', {
      status: error.response?.status,
      data: error.response?.data
    });
    throw new Error('Ошибка входа в систему');
  }
}

async function createClient(clientName) {
  try {
    const response = await api.post('/api/wireguard/client', {
      name: clientName,
      allowedIPs: '10.8.0.0/24'
    });
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
    const response = await api.get('/api/wireguard/client');
    const client = response.data.find(c => c.name === clientName);
    if (!client) {
      throw new Error('Клиент не найден');
    }
    return client;
  } catch (error) {
    console.error('❌ Ошибка получения данных клиента:', error.message);
    throw error;
  }
}

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
    // 1. Авторизация
    await login();

    // 2. Создание клиента
    console.log(`⌛ Создаем клиента: ${clientName}`);
    await createClient(clientName);

    // 3. Получение данных клиента
    console.log(`🔍 Получаем данные клиента: ${clientName}`);
    const clientData = await getClientData(clientName);

    // 4. Генерация конфигурации
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