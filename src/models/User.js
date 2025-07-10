const { Schema, model } = require('mongoose');

const userSchema = new Schema({
  userId: { type: Number, required: true, unique: true },
  username: String,
  firstName: String,
  lastName: String,
  status: { 
    type: String, 
    enum: ['pending', 'active', 'rejected'], 
    default: 'pending' 
  },
  paymentPhotoId: String,
  startDate: { type: Date, default: Date.now },
  expireDate: Date,
  lastReminder: Date
}, { timestamps: true });

module.exports = model('User', userSchema);