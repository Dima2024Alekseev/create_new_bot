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
    enum: ['active', 'pending', 'rejected', 'inactive'], // Добавил 'inactive' для ясности
    default: 'inactive', // По умолчанию пользователь неактивен
  },
  expireDate: {
    type: Date,
    default: null,
  },
  // НОВОЕ ПОЛЕ: Количество подписок/продлений
  subscriptionCount: {
    type: Number,
    default: 0, // По умолчанию 0, будет увеличиваться при каждом одобрении платежа
  },
  isAdmin: { // Добавил, если у вас есть такое поле для админ-режима
    type: Boolean,
    default: false,
  }
});

module.exports = mongoose.model('User', userSchema);