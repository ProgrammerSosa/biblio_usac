require('dotenv').config();

const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const connectDB = require('../config/db');

// Colecciones que se vacian. Usuarios, categorias e invitaciones NO se tocan: sin usuarios nadie
// podria iniciar sesion, y las categorias son la estructura del catalogo. "counters" ya no se usa
// (el ID dejo de ser automatico), se limpia de paso.
const COLECCIONES_A_VACIAR = ['catalogs', 'audits', 'auditarchives', 'counters'];

function marcaDeTiempo() {
  const ahora = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${ahora.getFullYear()}-${pad(ahora.getMonth() + 1)}-${pad(ahora.getDate())}_${pad(ahora.getHours())}-${pad(ahora.getMinutes())}-${pad(ahora.getSeconds())}`;
}

async function contar() {
  const conteo = {};
  for (const nombre of COLECCIONES_A_VACIAR) {
    conteo[nombre] = await mongoose.connection.collection(nombre).countDocuments({});
  }
  return conteo;
}

/**
 * Vacia el catalogo y la auditoria. Sin `confirmar` es una prueba en seco: solo cuenta y no
 * borra ni escribe nada. Con `confirmar`, primero guarda un respaldo completo (un JSON por
 * coleccion) en `directorioRespaldo` y SOLO si el respaldo quedo escrito borra los datos.
 */
async function limpiarBaseDeDatos({ confirmar = false, directorioRespaldo } = {}) {
  const antes = await contar();
  if (!confirmar) return { antes, respaldo: null, borrados: null };

  const carpeta = path.join(directorioRespaldo, marcaDeTiempo());
  fs.mkdirSync(carpeta, { recursive: true });
  for (const nombre of COLECCIONES_A_VACIAR) {
    const documentos = await mongoose.connection.collection(nombre).find({}).toArray();
    fs.writeFileSync(path.join(carpeta, `${nombre}.json`), JSON.stringify(documentos));
  }

  const borrados = {};
  for (const nombre of COLECCIONES_A_VACIAR) {
    const resultado = await mongoose.connection.collection(nombre).deleteMany({});
    borrados[nombre] = resultado.deletedCount;
  }
  return { antes, respaldo: carpeta, borrados };
}

if (require.main === module) {
  (async () => {
    try {
      await connectDB();
      const confirmar = process.argv.includes('--confirmar');
      const { host, name } = mongoose.connection;

      console.log(`Base de datos: ${name} en ${host}`);
      const resultado = await limpiarBaseDeDatos({
        confirmar,
        directorioRespaldo: path.join(__dirname, '..', 'respaldos-limpieza'),
      });

      console.log('Hoy hay:', resultado.antes);
      if (!confirmar) {
        console.log('\nPRUEBA EN SECO: no se borro nada. Para borrar de verdad (haciendo antes un respaldo), agrega --confirmar');
        return;
      }
      console.log(`Respaldo guardado en: ${resultado.respaldo}`);
      console.log('Borrados:', resultado.borrados);
      console.log('Se conservaron: usuarios, categorias e invitaciones.');
    } catch (err) {
      console.error('Error:', err.message);
      process.exitCode = 1;
    } finally {
      await mongoose.disconnect();
    }
  })();
}

module.exports = { limpiarBaseDeDatos, COLECCIONES_A_VACIAR };
