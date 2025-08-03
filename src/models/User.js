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
  vpnConfigured: {
    type: Boolean,
    default: false,
  },
  vpnClientName: {
    type: String,
    default: null,
  },
  // Новые поля для отклонения платежей
  rejectionReason: {
    type: String,
    default: null
  },
  rejectedByAdmin: {
    type: Boolean,
    default: false
  },
  paymentPhotoDate: {
    type: Date,
    default: null
  }
});

module.exports = mongoose.model('User', userSchema);