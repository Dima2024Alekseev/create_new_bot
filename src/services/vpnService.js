const axios = require('axios');
const fs = require('fs');
const path = require('path');

// Пути к файлам конфигурации
const WG_CONFIG_PATH = path.join(require('os').homedir(), '.wg.easy/wg0.json');

// API конфигурация
const API_CONFIG = {
  BASE_URL: 'http://37.233.85.212:51821',
  PASSWORD: process.env.WG_API_PASSWORD,
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

// Авторизация
async function login() {
  try {
    const response = await api.post('/api/session', {
      password: API_CONFIG.PASSWORD
    });
    sessionCookie = response.headers['set-cookie']?.toString();
    return true;
  } catch (error) {
    console.error('Auth error:', error.response?.data);
    throw error;
  }
}

// Чтение конфигурации из wg0.json
function readWgConfig() {
  try {
    const rawData = fs.readFileSync(WG_CONFIG_PATH);
    return JSON.parse(rawData);
  } catch (error) {
    console.error('Error reading wg0.json:', error);
    throw error;
  }
}

// Генерация конфига клиента
function generateClientConfig(clientData, serverPublicKey) {
  return `[Interface]
PrivateKey = ${clientData.privateKey}
Address = ${clientData.address}
DNS = 1.1.1.1

[Peer]
PublicKey = ${serverPublicKey}
Endpoint = ${API_CONFIG.BASE_URL.replace('http://', '').replace(':51821', '')}:51820
AllowedIPs = 0.0.0.0/0
PersistentKeepalive = 25`;
}

// Создание VPN клиента
exports.createVpnClient = async (clientName) => {
  try {
    // Авторизация
    await login();

    // Создание клиента через API
    const createResponse = await api.post('/api/wireguard/client', {
      name: clientName,
      allowedIPs: '10.8.0.0/24'
    });

    // Чтение обновленной конфигурации
    const wgConfig = readWgConfig();
    
    // Находим созданного клиента
    const client = wgConfig.clients.find(c => c.name === clientName);
    if (!client) {
      throw new Error('Client not found in wg0.json');
    }

    // Получаем серверный публичный ключ
    const serverPublicKey = wgConfig.server.publicKey;

    // Генерируем конфиг
    const config = generateClientConfig(client, serverPublicKey);
    
    return {
      name: clientName,
      config: config
    };
    
  } catch (error) {
    console.error('Error in createVpnClient:', error);
    throw error;
  }
};