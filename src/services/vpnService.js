const axios = require('axios');
const { execSync } = require('child_process');

// Конфигурация API
const API_CONFIG = {
  BASE_URL: process.env.WG_API_URL || 'http://localhost:51821',
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

async function getConfigFromAPI(clientName) {
  const endpoints = [
    `/api/wireguard/client/${clientName}/configuration`,
    `/api/wireguard/config/${clientName}`,
    `/api/wireguard/download/${clientName}`
  ];

  const maxRetries = 5;
  const retryDelay = 2000; // 2 секунды

  for (const endpoint of endpoints) {
    for (let i = 0; i < maxRetries; i++) {
      try {
        const response = await api.get(endpoint, {
          responseType: 'text'
        });

        if (response.data.includes('[Interface]')) {
          return response.data;
        }
        throw new Error('Неверный формат конфигурации');
      } catch (error) {
        if (error.response?.status === 404 && i < maxRetries - 1) {
          console.log(`⚠️ Попытка ${i + 1}/${maxRetries}: Конфиг не найден (404) для эндпоинта ${endpoint}, повторяю через ${retryDelay / 1000} сек.`);
          await new Promise(resolve => setTimeout(resolve, retryDelay));
        } else {
          console.error(`❌ Не удалось получить конфиг через API для эндпоинта ${endpoint}:`, error.message);
        }
      }
    }
  }

  return null;
}

exports.createVpnClient = async (clientName) => {
  try {
    // 1. Авторизация
    await login();

    // 2. Создание клиента
    console.log(`⌛ Создаем клиента: ${clientName}`);
    await createClient(clientName);

    // 3. Получение конфигурации с повторными попытками
    const config = await getConfigFromAPI(clientName);

    if (!config) {
      throw new Error('Не удалось получить конфигурацию клиента через API');
    }

    console.log('✅ Конфигурация успешно получена');
    return config;
  } catch (error) {
    console.error('🔥 Критическая ошибка:', {
      message: error.message,
      stack: error.stack
    });
    throw new Error(`Не удалось создать VPN-клиента: ${error.message}`);
  }
};
