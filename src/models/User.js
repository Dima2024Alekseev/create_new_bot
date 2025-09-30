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
  trialUsed: {
    type: Boolean,
    default: false,
  },
  trialClientName: {
    type: String,
    default: null,
  },
  trialStart: {
    type: Date,
    default: null,
  },
  trialExpire: {
    type: Date,
    default: null,
  },
  lastInteraction: {
    type: Date,
    default: Date.now,
  },
});

module.exports = mongoose.model('User', userSchema);