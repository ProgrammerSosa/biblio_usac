const mongoose = require('mongoose');

async function connectDB() {
  const uri = process.env.MONGODB_URI;

  if (!uri) {
    throw new Error('Falta la variable de entorno MONGODB_URI');
  }

  mongoose.connection.on('connected', () => {
    console.log('MongoDB conectado');
  });

  mongoose.connection.on('error', (err) => {
    console.error('Error de conexion a MongoDB:', err.message);
  });

  await mongoose.connect(uri);

  return mongoose.connection;
}

module.exports = connectDB;
