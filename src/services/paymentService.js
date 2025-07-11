const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

class PaymentService {
  /**
   * Генерация новых VPN-учетных данных через WG-Easy API
   */
  static async generateVpnCredentials(user) {
    try {
      const username = `user_${user.userId}_${uuidv4().split('-')[0]}`;
      const password = this.generatePassword();

      // 1. Создаем нового пользователя в WG-Easy
      await axios.post(
        `${process.env.WG_EASY_URL}/api/session`,
        { username, password },
        { auth: this.getWgAuth() }
      );

      // 2. Получаем конфигурационный файл
      const configPath = await this.downloadConfig(username);
      
      return {
        username,
        password,
        configPath,
        configFile: `wg_${username}.conf`
      };
    } catch (err) {
      console.error('WG-Easy API error:', err.response?.data || err.message);
      throw new Error('Ошибка при генерации VPN конфигурации');
    }
  }

  /**
   * Скачивание конфигурационного файла
   */
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
          responseType: 'stream'
        }
      );

      const writer = fs.createWriteStream(configPath);
      response.data.pipe(writer);

      return new Promise((resolve, reject) => {
        writer.on('finish', () => resolve(configPath));
        writer.on('error', reject);
      });
    } catch (err) {
      // Удаляем частично скачанный файл при ошибке
      if (fs.existsSync(configPath)) {
        fs.unlinkSync(configPath);
      }
      throw err;
    }
  }

  /**
   * Удаление пользователя из WG-Easy
   */
  static async removeUserFromWg(username) {
    try {
      await axios.delete(
        `${process.env.WG_EASY_URL}/api/wireguard/client/${username}`,
        { auth: this.getWgAuth() }
      );
      return true;
    } catch (err) {
      console.error('Ошибка удаления пользователя из WG-Easy:', err);
      return false;
    }
  }

  /**
   * Проверка существования пользователя в WG-Easy
   */
  static async checkUserInWg(username) {
    try {
      await axios.get(
        `${process.env.WG_EASY_URL}/api/wireguard/client/${username}`,
        { auth: this.getWgAuth() }
      );
      return true;
    } catch (err) {
      return false;
    }
  }

  /**
   * Данные аутентификации для WG-Easy API
   */
  static getWgAuth() {
    return {
      auth: {
        username: process.env.WG_EASY_USERNAME,
        password: process.env.WG_EASY_PASSWORD
      }
    };
  }

  /**
   * Генерация случайного пароля
   */
  static generatePassword() {
    return Math.random().toString(36).slice(-8) + 
           Math.random().toString(36).slice(-4);
  }
}

module.exports = PaymentService;