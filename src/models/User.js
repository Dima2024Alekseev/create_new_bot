const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  userId: {
    type: Number,
    required: true,
    unique: true,
  },
  chatId: {
    type: Number,
    default: null,
    index: true // Добавляем индекс для chatId, но не unique, чтобы избежать конфликтов
  },
  username: String,
  firstName: String,
  paymentPhotoId: String,
  paymentPhotoDate: {
    type: Date,
    default: null,
  },
  status: {
    type: String,
    enum: ['active', 'pending', 'rejected', 'inactive'],
    default: 'inactive',
  },
  expireDate: {
    type: Date,
    default: null,
  },
  subscriptionCount: {
    type: Number,
    default: 0,
  },
  isAdmin: {
    type: Boolean,
    default: false,
  },
  vpnConfigured: {
    type: Boolean,
    default: false,
  },
  vpnClientName: {
    type: String,
    default: null,
  },
  rejectionReason: {
    type: String,
    default: null,
  },
  lastSeen: {
    type: Date,
    default: null,
  },
  session: {
    type: Object,
    default: {},
  },
});

module.exports = mongoose.model('User', userSchema);