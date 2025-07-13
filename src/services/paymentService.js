const User = require('../models/User');
const { formatDate, sendTelegramMessage } = require('../utils/helpers');

class PaymentService {
  /**
   * Создание новой заявки на оплату
   */
  static async createPayment(userId, photoId, userData) {
    return await User.findOneAndUpdate(
      { userId },
      {
        userId,
        ...userData,
        paymentPhotoId: photoId,
        status: 'pending',
        startDate: new Date()
      },
      { upsert: true, new: true }
    );
  }

  /**
   * Подтверждение платежа админом
   */
  static async approvePayment(userId) {
    const expireDate = new Date();
    expireDate.setMonth(expireDate.getMonth() + 1); // +1 месяц подписки

    const user = await User.findOneAndUpdate(
      { userId },
      {
        status: 'active',
        expireDate,
        lastReminder: null // Сбрасываем напоминания
      },
      { new: true }
    );

    if (!user) throw new Error('Пользователь не найден');

    // Генерация VPN-данных
    const vpnCredentials = this.generateVpnCredentials(user);

    return {
      user,
      message: `🎉 Подписка активирована до ${formatDate(expireDate)}!\n\n` +
        `Данные для подключения:\n` +
        `Сервер: ${vpnCredentials.server}\n` +
        `Логин: ${vpnCredentials.login}\n` +
        `Пароль: ${vpnCredentials.password}`
    };
  }

  /**
   * Отклонение платежа
   */
  static async rejectPayment(userId) {
    const user = await User.findOneAndUpdate(
      { userId },
      { status: 'rejected' },
      { new: true }
    );

    if (!user) throw new Error('Пользователь не найден');

    return {
      user,
      message: '❌ Платёж отклонён. Проверьте реквизиты и попробуйте снова.'
    };
  }

  /**
   * Проверка активных подписок
   */
  static async checkActiveSubscriptions() {
    return await User.find({
      status: 'active',
      expireDate: { $gt: new Date() }
    });
  }

  /**
   * Получение pending-заявок
   */
  static async getPendingPayments() {
    return await User.find({ status: 'pending' });
  }

  /**
   * Генерация VPN-данных
   */
  static generateVpnCredentials(user) {
    return {
      server: 'vpn.example.com',
      login: user.username || `user${user.userId}`,
      password: this.generatePassword(),
      configLink: this.generateConfigLink(user.userId)
    };
  }

  /**
   * Генерация случайного пароля
   */
  static generatePassword() {
    return Math.random().toString(36).slice(-8) +
      Math.random().toString(36).slice(-8);
  }

  /**
   * Генерация ссылки на конфиг
   */
  static generateConfigLink(userId) {
    return `https://api.vpn-service.com/config/${userId}/${this.generateToken()}`;
  }

  /**
   * Генерация токена для доступа
   */
  static generateToken() {
    return require('crypto').randomBytes(16).toString('hex');
  }
}

module.exports = PaymentService;