// config/db.js

// !!! ВАЖНО: Убедитесь, что dotenv НЕ ЗАГРУЖАЕТСЯ здесь. Он должен быть загружен только один раз в bot.js.
// require('dotenv').config({ path: __dirname + '/../primer.env' }); // <-- ЭТУ СТРОКУ УДАЛИТЬ, если она была!

const mongoose = require('mongoose');

const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI, {
      socketTimeoutMS: 30000,
      connectTimeoutMS: 10000,
      serverSelectionTimeoutMS: 5000,
      heartbeatFrequencyMS: 10000
    });
    console.log('✅ MongoDB connected');
  } catch (err) {
    console.error('❌ MongoDB connection error:', err);
    // Важно: здесь мы выбрасываем ошибку, чтобы вызывающая функция (в bot.js)
    // могла ее поймать и решить, что делать дальше (например, выйти из процесса).
    // Повторное подключение теперь будет обрабатываться извне, если это необходимо
    // через логику перезапуска PM2 или другую систему оркестрации.
    throw err;
  }
};

// Обработчики событий подключения (оставьте их)
// Эти обработчики будут срабатывать при потере и восстановлении соединения MongoDB
// после успешного первоначального подключения.
mongoose.connection.on('disconnected', () => {
  console.log('⚠️ MongoDB disconnected');
});

mongoose.connection.on('reconnected', () => {
  console.log('🔁 MongoDB reconnected');
});

module.exports = connectDB;