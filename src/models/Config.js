// src/models/Config.js
const mongoose = require('mongoose');

const configSchema = new mongoose.Schema({
    name: { 
        type: String, 
        required: true, 
        unique: true 
    },
    value: { 
        type: Number, 
        required: true 
    }
});

module.exports = mongoose.model('Config', configSchema);