const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

class PaymentService {
  static async getAuthToken() {
    try {
      const response = await axios.post(
        `${process.env.WG_EASY_URL}/api/session`,
        {
          username: process.env.WG_EASY_USERNAME,
          password: process.env.WG_EASY_PASSWORD
        },
        {
          timeout: 10000,
          headers: {
            'Content-Type': 'application/json'
          }
        }
      );
      return response.data.token;
    } catch (err) {
      console.error('Auth error:', {
        config: err.config,
        response: err.response?.data
      });
      throw new Error('Ошибка аутентификации в WG-Easy');
    }
  }

  static async generateVpnCredentials(user) {
    try {
      const username = `user_${user.userId}_${uuidv4().split('-')[0]}`;
      const password = this.generatePassword();
      const authToken = await this.getAuthToken();

      console.log(`Creating VPN user: ${username}`);

      // Создание пользователя
      const createResponse = await axios.post(
        `${process.env.WG_EASY_URL}/api/users`,
        { name: username, password },
        {
          timeout: 10000,
          headers: {
            'Authorization': `Bearer ${authToken}`,
            'Content-Type': 'application/json'
          }
        }
      );

      if (!createResponse.data?.name) {
        throw new Error('Invalid user creation response');
      }

      // Получение конфига
      const configPath = await this.downloadConfig(username, authToken);
      
      return {
        username,
        password,
        configPath,
        configFile: `wg_${username}.conf`
      };
    } catch (err) {
      console.error('VPN Creation Error:', {
        message: err.message,
        stack: err.stack
      });
      throw new Error(`Не удалось создать VPN: ${err.message}`);
    }
  }

  static async downloadConfig(username, authToken) {
    const configDir = path.join(__dirname, '../../temp_configs');
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }

    const configPath = path.join(configDir, `wg_${username}.conf`);
    
    try {
      const response = await axios.get(
        `${process.env.WG_EASY_URL}/api/wireguard/client/${username}/configuration`,
        {
          responseType: 'stream',
          timeout: 10000,
          headers: {
            'Authorization': `Bearer ${authToken}`
          }
        }
      );

      const writer = fs.createWriteStream(configPath);
      response.data.pipe(writer);

      return new Promise((resolve, reject) => {
        writer.on('finish', () => {
          const content = fs.readFileSync(configPath, 'utf8');
          if (!content.includes('[Interface]')) {
            fs.unlinkSync(configPath);
            reject(new Error('Invalid config content'));
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

  static generatePassword() {
    return Math.random().toString(36).slice(-8);
  }

  static async removeUserFromWg(username) {
    try {
      const authToken = await this.getAuthToken();
      await axios.delete(
        `${process.env.WG_EASY_URL}/api/users/${username}`,
        {
          headers: {
            'Authorization': `Bearer ${authToken}`
          }
        }
      );
    } catch (err) {
      console.error('User removal error:', err.message);
      throw err;
    }
  }
}

module.exports = PaymentService;