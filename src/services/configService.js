const Config = require('../models/Config');

// Получение конфигурации (создаёт документ, если его нет)
exports.getConfig = async () => {
    try {
        let config = await Config.findOne();
        if (!config) {
            config = await Config.create({
                vpnPrice: 132,
                paymentPhone: '+7 (995) 431-34-57',
                paymentCard: '2202 2050 2287 6913',
                paymentBank: 'Сбербанк'
            });
        }
        return config;
    } catch (error) {
        console.error('Ошибка при получении конфигурации:', error);
        throw error;
    }
};

// Обновление одного поля конфигурации
exports.setConfigField = async (field, value) => {
    try {
        let config = await Config.findOne();
        if (!config) {
            config = await Config.create({
                vpnPrice: 132,
                paymentPhone: '+7 (995) 431-34-57',
                paymentCard: '2202 2050 2287 6913',
                paymentBank: 'Сбербанк'
            });
        }
        config[field] = value;
        await config.save();
        console.log(`Поле '${field}' успешно обновлено: ${value}`);
    } catch (error) {
        console.error(`Ошибка при обновлении поля '${field}':`, error);
        throw error;
    }
};