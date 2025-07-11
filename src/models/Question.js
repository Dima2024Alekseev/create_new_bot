const { Schema, model } = require('mongoose');

const questionSchema = new Schema({
  userId: { type: Number, required: true },
  username: String,
  firstName: String,
  questionText: { type: String, required: true },
  answerText: String,
  status: { 
    type: String, 
    enum: ['pending', 'answered'], 
    default: 'pending' 
  },
  createdAt: { type: Date, default: Date.now },
  answeredAt: Date
}, { timestamps: true });

module.exports = model('Question', questionSchema);