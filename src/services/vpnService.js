const axios = require('axios');

// Конфигурация API
const API_CONFIG = {
  BASE_URL: 'http://37.233.85.212:51821',
  PASSWORD: process.env.WG_API_PASSWORD,
  SERVER_PUBLIC_KEY: '+VmjO9mBKNMW7G7sdn6Haqxzx2YXgi592/LfepbRLDU=',
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
    console.log('[DEBUG] Добавляем cookies в запрос:', sessionCookies);
  }
  return config;
});

// Перехватчик ответов для сохранения cookies
api.interceptors.response.use(response => {
  // Проверяем оба варианта названия заголовка
  const cookies = response.headers['set-cookie'] || response.headers['Set-Cookie'];
  
  if (cookies) {
    sessionCookies = Array.isArray(cookies) ? cookies.join('; ') : cookies;
    console.log('[DEBUG] Получены cookies:', sessionCookies);
  }
  
  return response;
}, error => {
  console.error('[DEBUG] Ошибка запроса:', {
    status: error.response?.status,
    headers: error.response?.headers,
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
      validateStatus: (status) => status === 204,
      transformResponse: [(data) => data] // Важно для обработки пустых ответов
    });

    if (!sessionCookies) {
      console.error('[DEBUG] Заголовки ответа:', response.headers);
      throw new Error('Не удалось получить cookies авторизации');
    }

    console.log('🔑 Авторизация успешна');
    return true;
  } catch (error) {
    console.error('❌ Ошибка авторизации:', {
      message: error.message,
      config: error.config,
      response: {
        status: error.response?.status,
        headers: error.response?.headers,
        data: error.response?.data
      }
    });
    throw new Error('Ошибка входа в систему');
  }
}

async function createClient(clientName) {
  try {
    console.log(`[DEBUG] Создание клиента: ${clientName}`);
    const response = await api.post('/api/wireguard/client', {
      name: clientName,
      allowedIPs: '10.8.0.0/24'
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

async function getClientConfigFromText(clientId) {
  try {
    console.log(`[DEBUG] Запрос конфигурации для ID: ${clientId}`);
    const response = await api.get(`/api/wireguard/client/${clientId}/configuration`, {
      responseType: 'text'
    });

    const configText = response.data;
    const privateKeyMatch = configText.match(/PrivateKey = (.+)/);
    const presharedKeyMatch = configText.match(/PresharedKey = (.+)/);

    if (!privateKeyMatch) {
      throw new Error('Не найден PrivateKey в конфигурации');
    }

    return {
      privateKey: privateKeyMatch[1].trim(),
      presharedKey: presharedKeyMatch?.[1]?.trim()
    };
  } catch (error) {
    console.error('❌ Ошибка получения конфигурации:', {
      status: error.response?.status,
      data: error.response?.data
    });
    throw error;
  }
}

function generateConfig(configData) {
  if (!configData.privateKey || !configData.address || !API_CONFIG.SERVER_PUBLIC_KEY) {
    throw new Error('Недостаточно данных для генерации конфига');
  }

  return `[Interface]
PrivateKey = ${configData.privateKey}
Address = ${configData.address}/24
DNS = 1.1.1.1

[Peer]
PublicKey = ${API_CONFIG.SERVER_PUBLIC_KEY}
${configData.presharedKey ? `PresharedKey = ${configData.presharedKey}` : ''}
Endpoint = ${API_CONFIG.BASE_URL.replace('http://', '').replace(':51821', '')}:51820
AllowedIPs = 0.0.0.0/0
PersistentKeepalive = 25`;
}

exports.createVpnClient = async (clientName) => {
  try {
    console.log(`⌛ Начало создания клиента: ${clientName}`);
    
    // Авторизация
    await login();
    
    // Создание клиента
    await createClient(clientName);
    
    // Задержка для обновления данных
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Получение данных клиента
    const clientData = await getClientData(clientName);
    
    // Получение конфигурации
    const { privateKey, presharedKey } = await getClientConfigFromText(clientData.id);
    
    // Генерация конфига
    const config = generateConfig({
      privateKey,
      presharedKey,
      address: clientData.address
    });
    
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