const Config = require('../models/Config');

exports.getConfig = async (key, defaultValue) => {
    try {
        if (!key) {
            throw new Error('Ключ настройки не может быть пустым');
        }
        const config = await Config.findOne({ name: key });
        return config ? config.value : defaultValue;
    } catch (error) {
        console.error(`Ошибка при получении настройки '${key}':`, error);
        return defaultValue;
    }
};

exports.setConfig = async (key, value) => {
    try {
        if (!key) {
            throw new Error('Ключ настройки не может быть пустым');
        }
        await Config.findOneAndUpdate(
            { name: key },
            { value },
            { upsert: true, new: true, runValidators: true }
        );
        console.log(`Настройка '${key}' успешно обновлена.`);
    } catch (error) {
        console.error(`Ошибка при обновлении настройки '${key}':`, error);
        throw error; // Продолжаем выбрасывать ошибку для обработки выше
    }
};
