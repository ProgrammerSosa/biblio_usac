// Migracion unica: los registros del catalogo creados antes de que existiera el modo
// borrador no tienen el campo "enviado". Sin este paso, la nueva regla de visibilidad
// (los borradores solo los ve su autor) los esconderia de todo el mundo por error, ya
// que a nivel de base de datos "el campo no existe" no es lo mismo que "enviado: true".
// Ejecutar con las variables de entorno apuntando a la base que se quiera migrar:
//   node scripts/migrarEnviado.js
require('dotenv').config();
const mongoose = require('mongoose');

async function migrar() {
  await mongoose.connect(process.env.MONGODB_URI);
  const Catalog = mongoose.connection.collection('catalogs');

  const res = await Catalog.updateMany({ enviado: { $exists: false } }, { $set: { enviado: true } });
  console.log(`Registros marcados como enviados (ya existian antes del modo borrador): ${res.modifiedCount}`);

  await mongoose.disconnect();
}

migrar().catch((err) => {
  console.error(err);
  process.exit(1);
});
