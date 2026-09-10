// Migracion unica: algunos registros quedaron guardados con noInventario: "" (cadena vacia) o
// con un marcador de "esto no aplica" (N/A, NA, S/N...) en vez de sin el campo. Para el indice
// unique+sparse de noInventario eso SI cuenta como un valor real - Mongo solo salta el indice
// cuando el campo esta ausente, no cuando vale "" o "N/A". Mientras exista un solo registro
// con ese valor, nadie mas puede guardar otro material sin numero de inventario (choca como
// si fuera un duplicado). Este paso limpia esos registros dejando el campo realmente ausente.
// Ejecutar con las variables de entorno apuntando a la base que se quiera migrar:
//   node scripts/limpiarNoInventarioVacio.js
require('dotenv').config();
const mongoose = require('mongoose');

const MARCADORES_SIN_DATO = ['', 'n/a', 'na', 'n.a.', 's/n', 'sin numero', '-', '--'];

async function migrar() {
  await mongoose.connect(process.env.MONGODB_URI);
  const Catalog = mongoose.connection.collection('catalogs');

  const patrones = MARCADORES_SIN_DATO.map((m) => new RegExp(`^${m.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'));
  const res = await Catalog.updateMany({ noInventario: { $in: patrones } }, { $unset: { noInventario: '' } });
  console.log(`Registros con noInventario vacio o "sin dato" corregidos (campo ahora ausente): ${res.modifiedCount}`);

  await mongoose.disconnect();
}

migrar().catch((err) => {
  console.error(err);
  process.exit(1);
});
