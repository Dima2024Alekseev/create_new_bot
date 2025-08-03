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
  paymentPhotoDate: Date,
  rejectionComment: {
    type: String,
    default: null
  },
  lastReminder: Date
}, { timestamps: true });

module.exports = mongoose.model('User', userSchema);