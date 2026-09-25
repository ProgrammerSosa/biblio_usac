const mongoose = require('mongoose');

// Contador atomico generico (_id = nombre del contador, seq = ultimo valor usado).
// Mongo no tiene autoincrement nativo; este es el patron estandar para simularlo
// con un solo findOneAndUpdate($inc), que es atomico incluso con varias
// aprobaciones ocurriendo al mismo tiempo.
const counterSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  seq: { type: Number, required: true, default: 1000 },
});

module.exports = mongoose.model('Counter', counterSchema);
