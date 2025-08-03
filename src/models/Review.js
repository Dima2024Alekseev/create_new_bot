const mongoose = require('mongoose');

const reviewSchema = new mongoose.Schema({
    userId: {
        type: Number,
        required: true,
    },
    username: String,
    firstName: String,
    rating: {
        type: Number,
        required: true,
        min: 1,
        max: 5,
    },
    comment: {
        type: String,
        maxlength: 500,
    },
    vpnSpeed: {
        type: String,
        enum: ['excellent', 'good', 'average', 'poor'],
    },
    vpnStability: {
        type: String,
        enum: ['excellent', 'good', 'average', 'poor'],
    },
    createdAt: {
        type: Date,
        default: Date.now,
    },
    isPublic: {
        type: Boolean,
        default: true,
    }
}, { timestamps: true });

module.exports = mongoose.model('Review', reviewSchema);