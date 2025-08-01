const mongoose = require('mongoose');

const paymentDetailsSchema = new mongoose.Schema({
  bankCard: { 
    type: String, 
    required: true,
    validate: {
      validator: v => /^\d{16,19}$/.test(v.replace(/\s/g, '')),
      message: 'Номер карты должен содержать 16-19 цифр'
    }
  },
  phoneNumber: { 
    type: String, 
    required: true,
    validate: {
      validator: v => /^\+?[\d\s\-\(\)]{10,15}$/.test(v),
      message: 'Неверный формат телефона'
    }
  },
  updatedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('PaymentDetails', paymentDetailsSchema);