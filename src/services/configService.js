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
        throw error;
    }
};

exports.getPaymentDetailsConfig = async () => {
    try {
        const defaults = {
            sbp_phone: '+7 (995) 431-34-57',
            card_number: '2202 2050 2287 6913',
            payment_comment: 'VPN {name} {userId}',
            vpn_price: 132
        };
        const [sbp_phone, card_number, payment_comment, vpn_price] = await Promise.all([
            exports.getConfig('sbp_phone', defaults.sbp_phone),
            exports.getConfig('card_number', defaults.card_number),
            exports.getConfig('payment_comment', defaults.payment_comment),
            exports.getConfig('vpn_price', defaults.vpn_price)
        ]);
        return { sbp_phone, card_number, payment_comment, vpn_price };
    } catch (error) {
        console.error('Ошибка при получении реквизитов:', error);
        return {
            sbp_phone: defaults.sbp_phone,
            card_number: defaults.card_number,
            payment_comment: defaults.payment_comment,
            vpn_price: defaults.vpn_price
        };
    }
};

exports.setPaymentDetailsConfig = async ({ sbp_phone, card_number, payment_comment, vpn_price }) => {
    try {
        await Promise.all([
            sbp_phone && exports.setConfig('sbp_phone', sbp_phone),
            card_number && exports.setConfig('card_number', card_number),
            payment_comment && exports.setConfig('payment_comment', payment_comment),
            vpn_price && exports.setConfig('vpn_price', vpn_price)
        ]);
        console.log('Реквизиты успешно обновлены.');
    } catch (error) {
        console.error('Ошибка при обновлении реквизитов:', error);
        throw error;
    }
};