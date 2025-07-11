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

      // 1. Создаем пользователя
      const createResponse = await axios.post(
        `${process.env.WG_EASY_URL}/api/session`,
        { username, password },
        { 
          auth: this.getWgAuth(),
          timeout: 10000 // 10 секунд таймаут
        }
      );

      if (!createResponse.data?.name) {
        throw new Error('Invalid response from WG-Easy');
      }

      // 2. Получаем конфиг
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
      const response = await axios.get(
        `${process.env.WG_EASY_URL}/api/wireguard/client/${username}/configuration`,
        {
          ...this.getWgAuth(),
          responseType: 'stream',
          timeout: 10000
        }
      );

      const writer = fs.createWriteStream(configPath);
      response.data.pipe(writer);

      return new Promise((resolve, reject) => {
        writer.on('finish', () => {
          // Проверяем что файл содержит валидный конфиг
          const content = fs.readFileSync(configPath, 'utf8');
          if (!content.includes('[Interface]') || !content.includes('[Peer]')) {
            fs.unlinkSync(configPath);
            reject(new Error('Invalid config file content'));
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

  static getWgAuth() {
    if (!process.env.WG_EASY_USERNAME || !process.env.WG_EASY_PASSWORD) {
      throw new Error('WG-Easy credentials not configured');
    }
    return {
      auth: {
        username: process.env.WG_EASY_USERNAME,
        password: process.env.WG_EASY_PASSWORD
      }
    };
  }

  static generatePassword() {
    return Math.random().toString(36).slice(-8);
  }
}

module.exports = PaymentService;