const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    userId: {
        type: Number,
        required: true,
        unique: true
    },
    username: {
        type: String,
        required: false
    },
    firstName: {
        type: String,
        required: false
    },
    status: {
        type: String,
        enum: ['new', 'pending', 'active', 'inactive', 'rejected'],
        default: 'new'
    },
    paymentPhotoId: {
        type: String,
        required: false
    },
    paymentPhotoDate: {
        type: Date,
        required: false
    },
    expireDate: {
        type: Date,
        required: false
    },
    subscriptionCount: {
        type: Number,
        default: 0
    },
    lastReminder: { // Дата последнего напоминания об окончании подписки
        type: Date,
        default: null
    },
    vpnConfigured: { // Флаг, указывающий, что пользователь успешно настроил VPN
        type: Boolean,
        default: false
    },
    awaitingVpnTroubleshoot: { // Флаг для ожидания описания проблемы от пользователя
        type: Boolean,
        default: false
    },
    wgClientId: { // НОВОЕ: ID клиента WireGuard в wg-easy
        type: String,
        default: null,
    },
}, { timestamps: true });

module.exports = mongoose.model('User', userSchema);