const mongoose = require('mongoose');

const configSchema = new mongoose.Schema({
    vpnPrice: {
        type: Number,
        required: true,
        default: 132
    },
    paymentPhone: {
        type: String,
        required: true,
        default: '+7 (995) 431-34-57'
    },
    paymentCard: {
        type: String,
        required: true,
        default: '2202 2050 2287 6913'
    },
    paymentBank: {
        type: String,
        required: true,
        default: 'Сбербанк'
    }
});

// Удаляем старый индекс name_1, если он существует, и не создаём новых уникальных индексов
configSchema.index({}); // Пустой индекс, чтобы избежать конфликтов

module.exports = mongoose.model('Config', configSchema);