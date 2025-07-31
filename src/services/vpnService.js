const axios = require('axios');

const API_CONFIG = {
  BASE_URL: 'http://37.233.85.212:51821',
  PASSWORD: process.env.WG_API_PASSWORD || 'test1',
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
    sessionCookie = response.headers['set-cookie']?.toString();
    console.log('🔑 Авторизация успешна');
    return true;
  } catch (error) {
    console.error('❌ Ошибка авторизации:', error.response?.data || error.message);
    throw new Error('Ошибка входа в систему');
  }
}

async function getClientConfig(clientName) {
  try {
    // Получаем данные клиента
    const response = await api.get('/api/wireguard/client');
    const client = response.data.find(c => c.name === clientName);
    
    if (!client) {
      throw new Error('Клиент не найден');
    }

    // Генерируем конфиг на основе полученных данных
    const config = `[Interface]
PrivateKey = ${client.privateKey || 'ВАШ_ПРИВАТНЫЙ_КЛЮЧ'}
Address = ${client.address}
DNS = 1.1.1.1, 8.8.8.8

[Peer]
PublicKey = ${client.serverPublicKey || 'ПУБЛИЧНЫЙ_КЛЮЧ_СЕРВЕРА'}
Endpoint = ${API_CONFIG.BASE_URL.replace('http://', '').replace(':51821', '')}:51820
AllowedIPs = 0.0.0.0/0
PersistentKeepalive = 25`;

    return config;
  } catch (error) {
    console.error('❌ Ошибка получения конфига:', error.message);
    throw error;
  }
}

async function getVpnConfig(clientName) {
  try {
    await login();
    console.log(`⌛ Получаем конфиг для: ${clientName}`);
    const config = await getClientConfig(clientName);
    console.log('✅ Конфигурация успешно получена');
    return config;
  } catch (error) {
    console.error('🔥 Ошибка:', error.message);
    throw error;
  }
}

// Пример использования
getVpnConfig('valeriya')
  .then(config => console.log(config))
  .catch(err => console.error(err));