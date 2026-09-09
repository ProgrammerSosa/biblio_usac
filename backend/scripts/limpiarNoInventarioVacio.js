// Migracion unica: algunos registros quedaron guardados con noInventario: "" (cadena vacia)
// en vez de sin el campo. Para el indice unique+sparse de noInventario eso SI cuenta como un
// valor real - Mongo solo salta el indice cuando el campo esta ausente, no cuando vale "".
// Mientras exista un solo registro con "", nadie mas puede guardar otro material sin numero
// de inventario (choca como si fuera un duplicado). Este paso limpia esos registros dejando
// el campo realmente ausente.
// Ejecutar con las variables de entorno apuntando a la base que se quiera migrar:
//   node scripts/limpiarNoInventarioVacio.js
require('dotenv').config();
const mongoose = require('mongoose');

async function migrar() {
  await mongoose.connect(process.env.MONGODB_URI);
  const Catalog = mongoose.connection.collection('catalogs');

  const res = await Catalog.updateMany({ noInventario: '' }, { $unset: { noInventario: '' } });
  console.log(`Registros con noInventario vacio corregidos (campo ahora ausente): ${res.modifiedCount}`);

  await mongoose.disconnect();
}

migrar().catch((err) => {
  console.error(err);
  process.exit(1);
});
