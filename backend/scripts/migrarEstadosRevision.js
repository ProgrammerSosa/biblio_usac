// Migracion unica: colapsa el flujo de 2 filtros (Admin + Manager) a 1 filtro (solo Admin).
// PENDIENTE_ADMIN pasa a PENDIENTE_ADMIN -> ya paso el (unico) filtro que sigue existiendo, asi que se mantiene pendiente.
// PENDIENTE_MANAGER ya habia pasado el filtro de Admin y solo esperaba al Manager, que ya no aprueba: se da por aprobado.
// Ejecutar con las variables de entorno apuntando a la base que se quiera migrar (local o produccion/Render):
//   node scripts/migrarEstadosRevision.js
require('dotenv').config();
const mongoose = require('mongoose');

async function migrar() {
  await mongoose.connect(process.env.MONGODB_URI);
  const Catalog = mongoose.connection.collection('catalogs');

  const deAdmin = await Catalog.updateMany({ estadoRevision: 'PENDIENTE_ADMIN' }, { $set: { estadoRevision: 'PENDIENTE' } });
  const deManager = await Catalog.updateMany({ estadoRevision: 'PENDIENTE_MANAGER' }, { $set: { estadoRevision: 'APROBADO' } });

  console.log(`PENDIENTE_ADMIN -> PENDIENTE: ${deAdmin.modifiedCount}`);
  console.log(`PENDIENTE_MANAGER -> APROBADO: ${deManager.modifiedCount}`);

  await mongoose.disconnect();
}

migrar().catch((err) => {
  console.error(err);
  process.exit(1);
});
