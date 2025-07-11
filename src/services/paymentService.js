const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

class PaymentService {
  static async generateVpnCredentials(user) {
    try {
      const username = `user_${user.userId}_${uuidv4().split('-')[0]}`;
      const password = this.generatePassword();

      console.log(`[WG-Easy] Creating user: ${username}`);

      // 1. Аутентификация в WG-Easy API
      const authResponse = await axios.post(
        `${process.env.WG_EASY_URL}/api/session`,
        {}, // Пустое тело запроса
        {
          auth: {
            username: process.env.WG_EASY_USERNAME,
            password: process.env.WG_EASY_PASSWORD
          },
          timeout: 10000
        }
      );

      if (!authResponse.data?.token) {
        throw new Error('Не удалось получить токен авторизации');
      }

      // 2. Создание пользователя VPN
      const createResponse = await axios.post(
        `${process.env.WG_EASY_URL}/api/users`,
        {
          name: username,
          password: password
        },
        {
          headers: {
            'Authorization': `Bearer ${authResponse.data.token}`,
            'Content-Type': 'application/json'
          },
          timeout: 10000
        }
      );

      if (!createResponse.data?.name) {
        throw new Error('Не удалось создать пользователя VPN');
      }

      // 3. Получение конфигурационного файла
      const configPath = await this.downloadConfig(username);
      
      return {
        username,
        password,
        configPath,
        configFile: `wg_${username}.conf`
      };
    } catch (err) {
      console.error('WG-Easy API error:', {
        message: err.message,
        response: err.response?.data,
        url: err.config?.url
      });
      throw new Error(`Не удалось создать VPN конфигурацию: ${err.message}`);
    }
  }

  static async downloadConfig(username) {
    const configDir = path.join(__dirname, '../../temp_configs');
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }

    const configPath = path.join(configDir, `wg_${username}.conf`);
    
    try {
      // Получаем конфиг с авторизацией через Basic Auth
      const response = await axios.get(
        `${process.env.WG_EASY_URL}/api/wireguard/client/${username}/configuration`,
        {
          auth: {
            username: process.env.WG_EASY_USERNAME,
            password: process.env.WG_EASY_PASSWORD
          },
          responseType: 'stream',
          timeout: 10000
        }
      );

      const writer = fs.createWriteStream(configPath);
      response.data.pipe(writer);

      return new Promise((resolve, reject) => {
        writer.on('finish', () => {
          const content = fs.readFileSync(configPath, 'utf8');
          if (!content.includes('[Interface]') || !content.includes('[Peer]')) {
            fs.unlinkSync(configPath);
            reject(new Error('Получен невалидный конфигурационный файл'));
          } else {
            resolve(configPath);
          }
        });
        writer.on('error', reject);
      });
    } catch (err) {
      if (fs.existsSync(configPath)) {
        fs.unlinkSync(configPath);
      }
      throw err;
    }
  }

  static async removeUserFromWg(username) {
    try {
      // Аутентификация
      const authResponse = await axios.post(
        `${process.env.WG_EASY_URL}/api/session`,
        {},
        {
          auth: {
            username: process.env.WG_EASY_USERNAME,
            password: process.env.WG_EASY_PASSWORD
          },
          timeout: 5000
        }
      );

      // Удаление пользователя
      await axios.delete(
        `${process.env.WG_EASY_URL}/api/users/${username}`,
        {
          headers: {
            'Authorization': `Bearer ${authResponse.data.token}`
          },
          timeout: 5000
        }
      );
    } catch (err) {
      console.error('Ошибка при удалении пользователя из WG:', err.message);
      throw new Error('Не удалось удалить пользователя VPN');
    }
  }

  static async checkUserInWg(username) {
    try {
      const response = await axios.get(
        `${process.env.WG_EASY_URL}/api/users/${username}`,
        {
          auth: {
            username: process.env.WG_EASY_USERNAME,
            password: process.env.WG_EASY_PASSWORD
          },
          timeout: 5000
        }
      );
      return response.data?.name === username;
    } catch (err) {
      if (err.response?.status === 404) {
        return false;
      }
      throw err;
    }
  }

  static generatePassword() {
    return Math.random().toString(36).slice(-8);
  }
}

module.exports = PaymentService;