const Counter = require('../src/catalog/counter_model');

const CONTADOR_ID = 'idInventarioCatalog';

/**
 * Siguiente ID de inventario (10001, 10002, 10003...), atomico incluso si varias
 * aprobaciones ocurren al mismo tiempo. Primero se asegura de que el contador
 * exista arrancando en 10000 (no hace nada si ya existe), y luego lo incrementa -
 * asi el primer numero que se asigna de verdad es 10001, sin importar si el
 * contador ya estaba sembrado desde antes (scripts/seed.js) o no.
 */
async function siguienteIdInventario() {
  await Counter.updateOne({ _id: CONTADOR_ID }, { $setOnInsert: { seq: 10000 } }, { upsert: true });
  const contador = await Counter.findByIdAndUpdate(CONTADOR_ID, { $inc: { seq: 1 } }, { new: true });
  return contador.seq;
}

module.exports = { siguienteIdInventario, CONTADOR_ID };
