const axios = require('axios');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../primer.env') }); // Убедитесь, что dotenv загружен корректно

const WG_API_URL = process.env.WG_API_URL;
const WG_API_USERNAME = process.env.WG_API_USERNAME;
const WG_API_PASSWORD = process.env.WG_API_PASSWORD;

// --- DEBUG LOGS START ---
console.log('DEBUG: Resolved .env path:', path.resolve(__dirname, '../../primer.env'));
console.log('DEBUG: WG_API_URL from .env:', WG_API_URL);
console.log('DEBUG: WG_API_USERNAME from .env:', WG_API_USERNAME);
console.log('DEBUG: WG_API_PASSWORD length from .env:', WG_API_PASSWORD ? WG_API_PASSWORD.length : 'undefined/null');
// Если вы ОЧЕНЬ хотите увидеть сам пароль (ТОЛЬКО ДЛЯ ДЕБАГА, НЕ ОСТАВЛЯЙТЕ В ПРОДАКШЕНЕ!):
// console.log('DEBUG: WG_API_PASSWORD value from .env:', WG_API_PASSWORD);
// --- DEBUG LOGS END ---


// Функция для получения токена аутентификации
async function getAuthToken() {
    try {
        const response = await axios.post(`${WG_API_URL}/auth`, {
            username: WG_API_USERNAME,
            password: WG_API_PASSWORD,
        }, { timeout: 10000 }); // Увеличиваем таймаут на всякий случай
        return response.data.token;
    } catch (error) {
        console.error('❌ Ошибка аутентификации WG-Easy API:', error.response ? error.response.data : error.message);
        throw new Error('Не удалось получить токен аутентификации WG-Easy.');
    }
}

// Функция для создания пользователя WireGuard
async function createWgClient(name) {
    const token = await getAuthToken(); // Эта строка вызовет getAuthToken()
    try {
        const response = await axios.post(`${WG_API_URL}/users`, {
            name: name, // Имя клиента в WireGuard, например, имя пользователя Telegram
        }, {
            headers: {
                'Authorization': `Bearer ${token}`
            },
            timeout: 10000
        });
        console.log(`✅ Клиент WireGuard ${name} создан. ID: ${response.data.id}`);
        return response.data; // Возвращает объект пользователя, включая 'id' (peerId)
    } catch (error) {
        console.error('❌ Ошибка создания клиента WG-Easy:', error.response ? error.response.data : error.message);
        throw new Error('Не удалось создать клиента WireGuard.');
    }
}

// Функция для получения конфиг-файла клиента
async function getWgClientConfig(clientId) {
    const token = await getAuthToken();
    try {
        const response = await axios.get(`${WG_API_URL}/users/${clientId}/configuration`, {
            headers: {
                'Authorization': `Bearer ${token}`
            },
            responseType: 'arraybuffer', // Важно для получения бинарных данных файла
            timeout: 10000
        });
        // Возвращаем буфер файла
        return response.data;
    } catch (error) {
        console.error(`❌ Ошибка получения конфига клиента ${clientId} WG-Easy:`, error.response ? error.response.data : error.message);
        throw new Error('Не удалось получить конфиг-файл WireGuard.');
    }
}

// Функция для получения QR-кода клиента
async function getWgClientQrCode(clientId) {
    const token = await getAuthToken();
    try {
        const response = await axios.get(`${WG_API_URL}/users/${clientId}/qrcode.svg`, {
            headers: {
                'Authorization': `Bearer ${token}`
            },
            responseType: 'arraybuffer', // Важно для получения бинарных данных изображения
            timeout: 10000
        });
        // Возвращаем буфер SVG-изображения
        return response.data;
    } catch (error) {
        console.error(`❌ Ошибка получения QR-кода клиента ${clientId} WG-Easy:`, error.response ? error.response.data : error.message);
        throw new Error('Не удалось получить QR-код WireGuard.');
    }
}

// Функция для удаления клиента (при отмене подписки или истечении)
async function deleteWgClient(clientId) {
    const token = await getAuthToken();
    try {
        await axios.delete(`${WG_API_URL}/users/${clientId}`, {
            headers: {
                'Authorization': `Bearer ${token}`
            },
            timeout: 10000
        });
        console.log(`✅ Клиент WireGuard ${clientId} удален.`);
    } catch (error) {
        console.error(`❌ Ошибка удаления клиента ${clientId} WG-Easy:`, error.response ? error.response.data : error.message);
        // Не выбрасываем ошибку, чтобы не прерывать другие важные операции
        // Просто логируем, чтобы админ мог проверить вручную.
        throw new Error(`Не удалось удалить клиента WireGuard ${clientId}.`);
    }
}


module.exports = {
    createWgClient,
    getWgClientConfig,
    getWgClientQrCode,
    deleteWgClient
};