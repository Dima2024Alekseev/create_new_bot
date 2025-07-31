const axios = require('axios');
const { execSync } = require('child_process');

// Конфигурация
const config = {
  WG_API_URL: process.env.WG_API_URL || 'http://localhost:51821',
  WG_API_PASSWORD: process.env.WG_API_PASSWORD,
  WG_CONF_PATH: '/etc/wireguard/wg0.conf'
};

let sessionCookie = null;

const api = axios.create({
  baseURL: config.WG_API_URL,
  timeout: 15000,
  headers: {
    'Accept': 'application/json',
    'Content-Type': 'application/json'
  }
});

// Интерцептор для кук
api.interceptors.request.use(cfg => {
  if (sessionCookie) {
    cfg.headers.Cookie = sessionCookie;
  }
  return cfg;
});

async function login() {
  try {
    const response = await api.post('/api/session', {
      password: config.WG_API_PASSWORD
    });
    sessionCookie = response.headers['set-cookie']?.toString();
    console.log('✅ Авторизация успешна');
    return true;
  } catch (error) {
    console.error('❌ Ошибка авторизации:', error.response?.data || error.message);
    throw error;
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
    console.error('❌ Ошибка создания клиента:', error.response?.data || error.message);
    throw error;
  }
}

async function extractConfigFromFile(clientName) {
  try {
    // Получаем весь конфиг файл
    const cmd = `docker exec wg.easy cat ${config.WG_CONF_PATH}`;
    const fullConfig = execSync(cmd, { timeout: 5000 }).toString();
    
    // Ищем секцию клиента
    const clientSection = fullConfig.split('\n\n').find(section => 
      section.includes(`# ${clientName}`) && section.includes('[Peer]')
    );
    
    if (!clientSection) {
      throw new Error('Секция клиента не найдена');
    }
    
    // Формируем полный конфиг клиента
    const privateKey = await getPrivateKey(clientName);
    const configText = `[Interface]
PrivateKey = ${privateKey}
Address = ${clientSection.match(/AllowedIPs = (.+?)\//)?.[1] || '10.8.0.2/32'}
DNS = 1.1.1.1

${clientSection.replace('# ' + clientName, '[Peer]')}`;
    
    return configText;
  } catch (error) {
    console.error('⚠️ Ошибка извлечения конфига:', error.message);
    return null;
  }
}

async function getPrivateKey(clientName) {
  try {
    // Парсим JSON-файл с конфигурацией
    const cmd = `docker exec wg.easy cat /etc/wireguard/wg0.json`;
    const wgJson = JSON.parse(execSync(cmd, { timeout: 5000 }).toString());
    
    // Ищем клиента в массиве peers
    const client = wgJson.peers.find(p => p.name === clientName);
    if (!client) throw new Error('Клиент не найден в wg0.json');
    
    return client.privateKey;
  } catch (error) {
    console.error('⚠️ Ошибка получения приватного ключа:', error.message);
    throw error;
  }
}

exports.createVpnClient = async (clientName) => {
  try {
    // 1. Авторизация
    await login();
    
    // 2. Создание клиента
    console.log(`⌛ Создаем клиента: ${clientName}`);
    await createClient(clientName);
    
    // 3. Получаем конфигурацию из файла
    const configText = await extractConfigFromFile(clientName);
    if (!configText) {
      throw new Error('Не удалось извлечь конфигурацию');
    }
    
    console.log('✅ Конфигурация успешно получена');
    return configText;
  } catch (error) {
    console.error('🔥 Критическая ошибка:', {
      message: error.message,
      stack: error.stack
    });
    throw new Error(`Не удалось создать VPN-клиента: ${error.message}`);
  }
};