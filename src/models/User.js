const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  userId: {
    type: Number,
    required: true,
    unique: true,
  },
  username: String,
  firstName: String,
  paymentPhotoId: String,
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
  // НОВОЕ ПОЛЕ: Флаг успешной настройки VPN
  vpnConfigured: {
    type: Boolean,
    default: false, // По умолчанию пользователь еще не настроил VPN
  }
});

module.exports = mongoose.model('User', userSchema);