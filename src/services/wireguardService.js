// services/wireguardService.js
const axios = require('axios');

const WG_EASY_BASE_URL = process.env.WG_EASY_BASE_URL;
const WG_EASY_PASSWORD = process.env.WG_EASY_PASSWORD;

let authToken = null; // Будет хранить токен аутентификации

// Функция для авторизации и получения токена
async function authenticate() {
    if (authToken) {
        return authToken; // Если токен уже есть, используем его
    }
    try {
        const response = await axios.post(`${WG_EASY_BASE_URL}/api/login`, {
            password: WG_EASY_PASSWORD
        });
        authToken = response.data.token;
        console.log('[WG Easy API] Успешная аутентификация, токен получен.');
        return authToken;
    } catch (error) {
        console.error('[WG Easy API] Ошибка аутентификации:', error.response?.data || error.message);
        throw new Error('Не удалось авторизоваться в WireGuard Easy.');
    }
}

// Функция для создания нового клиента
exports.createWgClient = async (userId, userName) => {
    try {
        const token = await authenticate();
        const clientName = `user_${userId}`; // Уникальное имя для клиента, например, user_123456789

        const response = await axios.post(`${WG_EASY_BASE_URL}/api/clients`, {
            name: clientName
        }, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        const client = response.data;
        console.log(`[WG Easy API] Клиент "${clientName}" создан, ID: ${client.id}`);

        // WG Easy API возвращает конфиг в отдельном endpoint /api/clients/{id}/configuration
        const configResponse = await axios.get(`${WG_EASY_BASE_URL}/api/clients/${client.id}/configuration`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        return {
            clientName: clientName,
            peerId: client.id, // ID пира в базе данных wg-easy
            configFileContent: configResponse.data // Содержимое .conf файла
        };

    } catch (error) {
        console.error(`[WG Easy API] Ошибка при создании WireGuard клиента для ${userId}:`, error.response?.data || error.message);
        // Если ошибка 401 (токен устарел), сбрасываем токен и пробуем еще раз (опционально, для повышения устойчивости)
        if (error.response?.status === 401) {
            authToken = null;
            console.warn('[WG Easy API] Токен аутентификации устарел, будет произведена повторная попытка.');
            return exports.createWgClient(userId, userName); // Рекурсивный вызов для повторной попытки
        }
        throw new Error('Не удалось создать WireGuard клиента.');
    }
};

// Функция для удаления клиента (понадобится при истечении подписки)
exports.deleteWgClient = async (peerId) => {
    try {
        const token = await authenticate();
        await axios.delete(`${WG_EASY_BASE_URL}/api/clients/${peerId}`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        console.log(`[WG Easy API] Клиент WireGuard с ID ${peerId} успешно удален.`);
    } catch (error) {
        console.error(`[WG Easy API] Ошибка при удалении WireGuard клиента ${peerId}:`, error.response?.data || error.message);
        if (error.response?.status === 401) {
            authToken = null;
            console.warn('[WG Easy API] Токен аутентификации устарел при удалении, будет произведена повторная попытка.');
            return exports.deleteWgClient(peerId);
        }
        throw new Error('Не удалось удалить WireGuard клиента.');
    }
};

// !!! Добавьте эту функцию в ваш reminderService.js для обработки истекших подписок !!!
// services/reminderService.js
// ...
// for (const user of expiredUsers) {
//     try {
//         // ... (отправка сообщения об истечении) ...
//         if (user.wireguardPeerId) {
//             await deleteWgClient(user.wireguardPeerId); // Вызов функции удаления
//         }
//         await User.updateOne( /* ... */ );
//     } catch (e) { /* ... */ }
// }