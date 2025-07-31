const axios = require('axios');

// Конфигурация API
const API_CONFIG = {
  BASE_URL: 'http://37.233.85.212:51821',
  PASSWORD: process.env.WG_API_PASSWORD,
  SERVER_PUBLIC_KEY: '+VmjO9mBKNMW7G7sdn6Haqxzx2YXgi592/LfepbRLDU=',
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
    const response = await api.post('/api/session', {
      password: API_CONFIG.PASSWORD
    });

    console.log('Ответ сервера:', response.headers);

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
            throw new Error('Не удалось найти PrivateKey в конфигурации.');
        }
        const privateKey = privateKeyMatch[1].trim();
        const presharedKey = presharedKeyMatch ? presharedKeyMatch[1].trim() : null;
        return { privateKey, presharedKey };
    } catch (error) {
        console.error('❌ Ошибка получения конфигурации клиента:', {
            status: error.response?.status,
            data: error.response?.data
        });
        throw new Error(`Не удалось получить полную конфигурацию клиента: Request failed with status code ${error.response?.status}`);
    }
}

function generateConfig(configData) {
  if (!configData.privateKey || !configData.address || !API_CONFIG.SERVER_PUBLIC_KEY) {
    throw new Error('Недостаточно данных для генерации конфигурации.');
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
    await login();
    console.log(`⌛ Создаем клиента: ${clientName}`);
    await createClient(clientName);
    console.log('⏳ Ожидаю 1 секунду, чтобы сервер обновил данные...');
    await new Promise(resolve => setTimeout(resolve, 1000));
    console.log(`🔍 Получаем данные клиента: ${clientName}`);
    const clientData = await getClientData(clientName);
    const clientId = clientData.id;
    console.log(`🔍 Получаем ключи из конфигурации клиента: ${clientName} (ID: ${clientId})`);
    const { privateKey, presharedKey } = await getClientConfigFromText(clientId);
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
