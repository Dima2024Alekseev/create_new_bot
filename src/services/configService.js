// src/services/configService.js
const Config = require('../models/Config');

exports.getConfig = async (key, defaultValue) => {
    try {
        const config = await Config.findOne({ name: key });
        return config ? config.value : defaultValue;
    } catch (error) {
        console.error(`Ошибка при получении настройки '${key}':`, error);
        return defaultValue;
    }
};

exports.setConfig = async (key, value) => {
    try {
        await Config.findOneAndUpdate(
            { name: key },
            { value },
            { upsert: true, new: true, runValidators: true }
        );
        console.log(`Настройка '${key}' успешно обновлена.`);
    } catch (error) {
        console.error(`Ошибка при обновлении настройки '${key}':`, error);
    }
};

exports.getPaymentDetails = async () => {
    try {
        const [phone, cardNumber, bankName] = await Promise.all([
            this.getConfig('payment_phone', '+7 (995) 431-34-57'),
            this.getConfig('payment_card_number', '2202 2050 2287 6913'),
            this.getConfig('payment_bank_name', 'Сбербанк')
        ]);
        return { phone, cardNumber, bankName };
    } catch (error) {
        console.error('Ошибка при получении реквизитов:', error);
        return {
            phone: '+7 (995) 431-34-57',
            cardNumber: '2202 2050 2287 6913',
            bankName: 'Сбербанк'
        };
    }
};

exports.setPaymentDetails = async ({ phone, cardNumber, bankName }) => {
    try {
        await Promise.all([
            this.setConfig('payment_phone', phone),
            this.setConfig('payment_card_number', cardNumber),
            this.setConfig('payment_bank_name', bankName)
        ]);
        console.log('Реквизиты оплаты успешно обновлены');
    } catch (error) {
        console.error('Ошибка при обновлении реквизитов:', error);
        throw error;
    }
};