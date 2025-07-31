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
  try {
    const response = await api.get(`/api/wireguard/client/${clientName}/configuration`, {
      responseType: 'text'
    });
    
    if (response.data.includes('[Interface]')) {
      return response.data;
    }
    throw new Error('Неверный формат конфигурации');
  } catch (error) {
    console.error('⚠️ Не удалось получить конфиг через API:', error.message);
    return null;
  }
}

async function getConfigFromDocker(clientName) {
  try {
    const config = execSync(
      `docker exec wg.easy wg showconf ${clientName}`,
      { timeout: 5000 }
    ).toString();
    
    if (config.includes('[Interface]')) {
      return config;
    }
    throw new Error('Неверный формат конфигурации');
  } catch (error) {
    console.error('⚠️ Не удалось получить конфиг через docker:', error.message);
    return null;
  }
}

exports.createVpnClient = async (clientName) => {
  try {
    // 1. Авторизация
    await login();
    
    // 2. Создание клиента
    console.log(`⌛ Создаем клиента: ${clientName}`);
    await createClient(clientName);
    
    // 3. Получение конфигурации (пробуем разные методы)
    const config = await getConfigFromAPI(clientName) || 
                  await getConfigFromDocker(clientName);
    
    if (!config) {
      throw new Error('Все методы получения конфигурации не сработали');
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