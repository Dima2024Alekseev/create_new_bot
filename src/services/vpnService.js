const axios = require('axios');

// Конфигурация API
const API_CONFIG = {
  BASE_URL: 'http://37.233.85.212:51821',
  PASSWORD: process.env.WG_API_PASSWORD,
  SERVER_PUBLIC_KEY: '+VmjO9mBKNMW7G7sdn6Haqxzx2YXgi592/LfepbRLDU=',
  TIMEOUT: 30000 // Увеличенный таймаут
};

// Отладочный вывод пароля (только для теста)
console.log('[DEBUG] WG_API_PASSWORD:', API_CONFIG.PASSWORD ? '***' : 'не задан');

let sessionCookie = null;

const api = axios.create({
  baseURL: API_CONFIG.BASE_URL,
  timeout: API_CONFIG.TIMEOUT,
  headers: {
    'Accept': 'application/json',
    'Content-Type': 'application/json',
    'Origin': API_CONFIG.BASE_URL
  },
  withCredentials: true // Важно для работы с куки
});

// Перехватчик запросов
api.interceptors.request.use(config => {
  if (sessionCookie) {
    config.headers.Cookie = sessionCookie;
    console.log('[DEBUG] Отправляемые куки:', config.headers.Cookie);
  }
  return config;
});

// Перехватчик ответов для отладки
api.interceptors.response.use(response => {
  console.log('[DEBUG] Ответ получен:', {
    status: response.status,
    headers: response.headers
  });
  return response;
}, error => {
  console.error('[DEBUG] Ошибка запроса:', {
    status: error.response?.status,
    data: error.response?.data,
    headers: error.response?.headers,
    config: error.config
  });
  return Promise.reject(error);
});

async function login() {
  try {
    console.log('[DEBUG] Попытка авторизации...');
    const response = await api.post('/api/session', {
      password: API_CONFIG.PASSWORD
    }, {
      validateStatus: (status) => status === 204 // Разрешаем 204 статус
    });

    // Извлекаем куки из заголовков
    const cookies = response.headers['set-cookie'];
    sessionCookie = Array.isArray(cookies) ? cookies.join('; ') : cookies;

    if (!sessionCookie) {
      throw new Error('Не получены куки авторизации');
    }

    console.log('🔑 Авторизация успешна. Куки:', sessionCookie);
    return true;
  } catch (error) {
    console.error('❌ Ошибка авторизации:', {
      message: error.message,
      status: error.response?.status,
      data: error.response?.data,
      headers: error.response?.headers
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
    console.log(`✅ Клиент "${clientName}" создан успешно.`);
    return response.data;
  } catch (error) {
    console.error('❌ Ошибка создания клиента:', {
      status: error.response?.status,
      data: error.response?.data,
      config: error.config
    });
    throw error;
  }
}

async function getClientData(clientName) {
  try {
    console.log(`[DEBUG] Получение данных клиента: ${clientName}`);
    const response = await api.get('/api/wireguard/client');
    const client = response.data.find(c => c.name === clientName);
    if (!client) throw new Error(`Клиент "${clientName}" не найден`);
    return client;
  } catch (error) {
    console.error('❌ Ошибка получения данных клиента:', {
      message: error.message,
      status: error.response?.status,
      data: error.response?.data
    });
    throw error;
  }
}

async function getClientConfigFromText(clientId) {
  const endpoint = `/api/wireguard/client/${clientId}/configuration`;
  console.log(`🌐 Запрашиваю конфигурацию по URL: ${API_CONFIG.BASE_URL + endpoint}`);
  
  try {
    const response = await api.get(endpoint, {
      responseType: 'text'
    });

    const configText = response.data;
    console.log('✅ Конфигурация получена успешно. Парсинг данных...');

    const privateKeyMatch = configText.match(/PrivateKey = (.+)/);
    const presharedKeyMatch = configText.match(/PresharedKey = (.+)/);

    if (!privateKeyMatch) {
      throw new Error('Не удалось найти PrivateKey в конфигурации');
    }

    return {
      privateKey: privateKeyMatch[1].trim(),
      presharedKey: presharedKeyMatch ? presharedKeyMatch[1].trim() : null
    };
  } catch (error) {
    console.error('❌ Ошибка получения конфигурации клиента:', {
      status: error.response?.status,
      data: error.response?.data,
      config: error.config
    });
    throw error;
  }
}

function generateConfig(configData) {
  if (!configData.privateKey || !configData.address || !API_CONFIG.SERVER_PUBLIC_KEY) {
    throw new Error('Недостаточно данных для генерации конфигурации');
  }

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

exports.createVpnClient = async (clientName) => {
  try {
    console.log('[DEBUG] Начало создания VPN клиента...');
    
    // Авторизация
    await login();
    
    // Создание клиента
    console.log(`⌛ Создаем клиента: ${clientName}`);
    await createClient(clientName);
    
    // Задержка для обновления данных на сервере
    console.log('⏳ Ожидаю 1 секунду...');
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Получение данных клиента
    console.log(`🔍 Получаем данные клиента: ${clientName}`);
    const clientData = await getClientData(clientName);
    
    // Получение конфигурации
    console.log(`🔍 Получаем ключи из конфигурации (ID: ${clientData.id})`);
    const { privateKey, presharedKey } = await getClientConfigFromText(clientData.id);
    
    // Генерация конфига
    console.log(`⚙️ Генерируем конфиг для: ${clientName}`);
    const config = generateConfig({
      privateKey,
      presharedKey,
      address: clientData.address,
    });
    
    console.log('✅ Конфигурация успешно сгенерирована');
    return config;
  } catch (error) {
    console.error('🔥 Критическая ошибка:', {
      message: error.message,
      stack: error.stack,
      response: error.response?.data
    });
    throw new Error(`Не удалось создать VPN-клиента: ${error.message}`);
  }
};