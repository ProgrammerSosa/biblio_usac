require('dotenv').config();

const mongoose = require('mongoose');
const connectDB = require('../config/db');
const Catalog = require('../src/catalog/catalog_model');

// Hasta ahora el sistema asignaba un ID numerico solo (10001, 10002...) al aprobar cada registro.
// Ya no: el ID lo escribe la biblioteca (texto como "20F" o "20F-C1"). Este script quita esos IDs
// numericos que ya estaban guardados. Es seguro volver a correrlo: solo toca los IDs guardados
// como NUMERO (los que genero el sistema) - un ID escrito por la biblioteca siempre se guarda
// como texto, asi que nunca se borra. De paso borra el contador que los generaba.
async function quitarIdsAutomaticos() {
  const registros = await Catalog.collection.updateMany({ idInventario: { $type: 'number' } }, { $unset: { idInventario: '' } });
  const contador = await mongoose.connection.collection('counters').deleteOne({ _id: 'idInventarioCatalog' });

  console.log(`Registros a los que se les quito el ID automatico: ${registros.modifiedCount}`);
  console.log(`Contador de IDs eliminado: ${contador.deletedCount === 1 ? 'si' : 'no existia'}`);
}

if (require.main === module) {
  (async () => {
    try {
      await connectDB();
      await quitarIdsAutomaticos();
    } catch (err) {
      console.error('Error:', err.message);
      process.exitCode = 1;
    } finally {
      await mongoose.disconnect();
    }
  })();
}

module.exports = { quitarIdsAutomaticos };
