const axios = require('axios');
const { execSync } = require('child_process');

// Конфигурация API
const API_CONFIG = {
  BASE_URL: 'http://37.233.85.212:51821',
  PASSWORD: process.env.WG_API_PASSWORD, // Убедитесь, что эта переменная окружения установлена
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

/**
 * Performs login to the WireGuard API.
 * @returns {Promise<boolean>} True if login is successful, false otherwise.
 */
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

/**
 * Creates a new WireGuard client.
 * @param {string} clientName - The name of the client to create.
 * @returns {Promise<object>} The data of the created client.
 */
async function createClient(clientName) {
  try {
    const response = await api.post('/api/wireguard/client', {
      name: clientName,
      allowedIPs: '10.8.0.0/24' // Adjust AllowedIPs as needed
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

/**
 * Retrieves data for a specific WireGuard client.
 * @param {string} clientName - The name of the client to retrieve data for.
 * @returns {Promise<object>} The client data including privateKey, address, and serverPublicKey.
 */
async function getClientData(clientName) {
  try {
    const response = await api.get('/api/wireguard/client');
    const client = response.data.find(c => c.name === clientName);

    if (!client) {
      throw new Error('Клиент не найден');
    }

    // Assuming the API returns privateKey and serverPublicKey directly in the client object
    // If not, you might need another API call to get the full client details including keys.
    // For example, if there's an endpoint like /api/wireguard/client/{clientId}/config
    // For now, we assume the initial /api/wireguard/client endpoint returns all necessary data.
    if (!client.privateKey) {
        // This is the crucial part: if privateKey is not directly available,
        // you might need to fetch it from a different endpoint or the API
        // might provide it only upon client creation.
        // For demonstration, let's assume the API provides a way to get the config
        // or that privateKey is part of the initial client creation response.
        // If the API doesn't return privateKey in the GET /api/wireguard/client response,
        // you would need to adjust this.
        console.warn('⚠️ privateKey не найден в данных клиента. Убедитесь, что API возвращает его.');
        // You might need to make another API call here to get the full config or private key
        // For example: const configResponse = await api.get(`/api/wireguard/client/${client.id}/config`);
        // and then parse it to get the privateKey.
    }

    return client;
  } catch (error) {
    console.error('❌ Ошибка получения данных клиента:', error.message);
    throw error;
  }
}

/**
 * Generates the WireGuard configuration string.
 * @param {object} clientData - The client data containing privateKey, address, and serverPublicKey.
 * @returns {string} The WireGuard configuration string.
 */
function generateConfig(clientData) {
  // Ensure clientData and its properties exist before accessing them
  if (!clientData || !clientData.privateKey || !clientData.address || !clientData.serverPublicKey) {
    console.error('Недостаточно данных для генерации конфигурации:', clientData);
    throw new Error('Отсутствуют необходимые данные для генерации конфигурации (privateKey, address или serverPublicKey).');
  }

  // The endpoint needs to be just the IP/hostname without http:// and port
  const endpoint = API_CONFIG.BASE_URL.replace('http://', '').replace(':51821', '') + ':51820';

  return `[Interface]
PrivateKey = ${clientData.privateKey}
Address = ${clientData.address}
DNS = 1.1.1.1

[Peer]
PublicKey = ${clientData.serverPublicKey}
Endpoint = ${endpoint}
AllowedIPs = 0.0.0.0/0
PersistentKeepalive = 25`;
}

/**
 * Main function to create a VPN client and generate its configuration.
 * @param {string} clientName - The name of the client to create.
 * @returns {Promise<string>} The generated WireGuard configuration.
 */
exports.createVpnClient = async (clientName) => {
  try {
    // 1. Авторизация
    await login();

    // 2. Создание клиента
    console.log(`⌛ Создаем клиента: ${clientName}`);
    // The createClient function should ideally return the full client object including privateKey
    // If it doesn't, you might need to modify the API or make an additional call to get the privateKey
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
