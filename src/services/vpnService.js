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

/**
 * Генерирует пару ключей WireGuard (публичный и приватный) и PresharedKey локально.
 * @returns {object} Объект с ключами: { privateKey, publicKey, presharedKey }
 */
function generateKeys() {
  try {
    const privateKey = execSync('wg genkey').toString().trim();
    const publicKey = execSync(`echo "${privateKey}" | wg pubkey`).toString().trim();
    const presharedKey = execSync('wg genpsk').toString().trim();
    return { privateKey, publicKey, presharedKey };
  } catch (error) {
    console.error('❌ Ошибка генерации ключей:', error.message);
    throw new Error('Не удалось сгенерировать ключи WireGuard. Убедитесь, что `wireguard-tools` установлены.');
  }
}

async function login() {
  // ... (остается без изменений)
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

async function createClient(clientName, publicKey) {
  // ... (остается без изменений)
  try {
    const response = await api.post('/api/wireguard/client', {
      name: clientName,
      publicKey: publicKey,
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
  // ... (остается без изменений)
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
 * Генерирует конфигурационный файл WireGuard для клиента.
 * @param {string} privateKey Приватный ключ клиента.
 * @param {string} presharedKey Общий ключ (PresharedKey).
 * @param {object} clientData Данные клиента, полученные из API.
 * @returns {string} Строка конфигурационного файла.
 */
function generateConfig(privateKey, presharedKey, clientData) {
  if (!privateKey || !presharedKey || !clientData.address || !API_CONFIG.SERVER_PUBLIC_KEY) {
    throw new Error('Недостаточно данных для генерации конфигурации.');
  }

  return `[Interface]
PrivateKey = ${privateKey}
Address = ${clientData.address}/24
DNS = 1.1.1.1

[Peer]
PublicKey = ${API_CONFIG.SERVER_PUBLIC_KEY}
PresharedKey = ${presharedKey}
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
    // 1. Генерируем ключи локально, включая PresharedKey
    const { privateKey, publicKey, presharedKey } = generateKeys();
    console.log('🔑 Ключи сгенерированы локально.');

    // 2. Авторизация
    await login();

    // 3. Создание клиента через API с нашим публичным ключом
    console.log(`⌛ Создаем клиента: ${clientName}`);
    await createClient(clientName, publicKey);

    // 4. Получаем данные о созданном клиенте, чтобы узнать его IP-адрес
    console.log(`🔍 Получаем данные клиента: ${clientName}`);
    const clientData = await getClientData(clientName);

    // 5. Генерируем конфигурационный файл, используя все необходимые ключи
    console.log(`⚙️ Генерируем конфиг для: ${clientName}`);
    const config = generateConfig(privateKey, presharedKey, clientData);

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