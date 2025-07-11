// models/User.js
const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
  userId: { type: Number, required: true, unique: true },
  firstName: { type: String },
  username: { type: String },
  status: { type: String, enum: ['new', 'pending', 'active', 'inactive', 'rejected'], default: 'new' },
  expireDate: { type: Date },
  lastReminder: { type: Date },
  paymentPhotoId: { type: String },
  paymentConfirmedAt: { type: Date },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
  subscriptionCount: { type: Number, default: 0 },
  vpnConfigured: { type: Boolean, default: false },
  wireguardPeerId: { type: String }, // <-- НОВОЕ ПОЛЕ: ID клиента в WireGuard Easy
  wireguardClientName: { type: String } // <-- НОВОЕ ПОЛЕ: Имя клиента в WireGuard Easy (опционально, для удобства)
});

UserSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

module.exports = mongoose.model('User', UserSchema);