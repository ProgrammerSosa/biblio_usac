require('dotenv').config();

const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const connectDB = require('../config/db');
const { DEFAULT_MANAGER_EMAIL, DEFAULT_MANAGER_NOMBRE } = require('./seed');
const { ROLES } = require('../utils/constants');

// Colecciones que se vacian siempre. Las categorias NO se tocan nunca (son la estructura del
// catalogo). "counters" ya no se usa (el ID dejo de ser automatico), se limpia de paso.
const COLECCIONES_A_VACIAR = ['catalogs', 'audits', 'auditarchives', 'counters'];

// Por defecto los usuarios y las invitaciones tampoco se tocan: sin usuarios nadie podria iniciar
// sesion. Con "vaciarInvitaciones" se vacian las invitaciones (una invitacion pendiente le permite
// a alguien crear su cuenta), y con "conservarUsuarios" tambien, ademas de borrar a los usuarios
// que no esten en la lista.
const COLECCIONES_CON_INVITACIONES = [...COLECCIONES_A_VACIAR, 'invitations'];

function marcaDeTiempo() {
  const ahora = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${ahora.getFullYear()}-${pad(ahora.getMonth() + 1)}-${pad(ahora.getDate())}_${pad(ahora.getHours())}-${pad(ahora.getMinutes())}-${pad(ahora.getSeconds())}`;
}

// Sin acentos ni mayusculas, para que "ádaly" encuentre a "Adaly Mejia".
function normalizar(texto) {
  return String(texto ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

async function contar(colecciones) {
  const conteo = {};
  for (const nombre of colecciones) {
    conteo[nombre] = await mongoose.connection.collection(nombre).countDocuments({});
  }
  return conteo;
}

const resumirUsuario = (usuario, motivo) => ({
  id: usuario._id,
  nombre: usuario.nombre,
  email: usuario.email,
  rol: usuario.rol,
  ...(motivo ? { motivo } : {}),
});

/**
 * A quien se conserva y a quien se borra. Siempre se conserva el usuario por defecto; ademas, cada
 * texto de "conservarUsuarios" tiene que coincidir con UN solo usuario (en su nombre o su correo).
 * Si algo no cuadra (un texto sin coincidencias o con varias, o si no quedaria ningun Manager)
 * queda anotado en "problemas" y NO se debe borrar nada.
 */
async function planDeUsuarios(conservarUsuarios, usuarioPorDefecto) {
  const usuarios = await mongoose.connection.collection('users').find({}).toArray();
  const conservar = new Map();
  const problemas = [];

  usuarios
    .filter((u) => u.email === normalizar(usuarioPorDefecto.email) || u.nombre === usuarioPorDefecto.nombre)
    .forEach((u) => conservar.set(String(u._id), resumirUsuario(u, 'usuario por defecto')));

  for (const texto of conservarUsuarios) {
    const buscado = normalizar(texto);
    const coincidencias = usuarios.filter((u) => normalizar(u.nombre).includes(buscado) || normalizar(u.email).includes(buscado));
    if (coincidencias.length === 0) {
      problemas.push(`"${texto}" no coincide con ningun usuario`);
    } else if (coincidencias.length > 1) {
      const quienes = coincidencias.map((u) => `${u.nombre} <${u.email}>`).join(', ');
      problemas.push(`"${texto}" coincide con ${coincidencias.length} usuarios (${quienes}); escribe el correo completo`);
    } else {
      conservar.set(String(coincidencias[0]._id), resumirUsuario(coincidencias[0], `coincide con "${texto}"`));
    }
  }

  if (![...conservar.values()].some((u) => u.rol === ROLES.MANAGER)) {
    problemas.push('no quedaria ningun usuario Manager (nadie podria administrar el sistema)');
  }

  return {
    conservar: [...conservar.values()],
    eliminar: usuarios.filter((u) => !conservar.has(String(u._id))).map((u) => resumirUsuario(u)),
    problemas,
  };
}

/**
 * Vacia el catalogo y la auditoria. Sin `confirmar` es una prueba en seco: solo cuenta y no
 * borra ni escribe nada. Con `confirmar`, primero guarda un respaldo completo (un JSON por
 * coleccion) en `directorioRespaldo` y SOLO si el respaldo quedo escrito borra los datos.
 *
 * Con `vaciarInvitaciones` tambien vacia las invitaciones (todos los usuarios se quedan).
 * Con `conservarUsuarios` (lista de nombres o correos) vacia las invitaciones y borra a todos los
 * usuarios salvo el usuario por defecto y los indicados. Las categorias se conservan siempre.
 */
async function limpiarBaseDeDatos({
  confirmar = false,
  directorioRespaldo,
  conservarUsuarios = null,
  vaciarInvitaciones = false,
  usuarioPorDefecto = { email: DEFAULT_MANAGER_EMAIL, nombre: DEFAULT_MANAGER_NOMBRE },
} = {}) {
  const colecciones = conservarUsuarios || vaciarInvitaciones ? COLECCIONES_CON_INVITACIONES : COLECCIONES_A_VACIAR;
  const antes = await contar(colecciones);
  const plan = conservarUsuarios ? await planDeUsuarios(conservarUsuarios, usuarioPorDefecto) : null;
  if (plan) antes.users = plan.conservar.length + plan.eliminar.length;

  if (!confirmar) return { antes, plan, respaldo: null, borrados: null };

  if (plan && plan.problemas.length > 0) {
    throw new Error(`No se borro nada: ${plan.problemas.join('; ')}`);
  }

  const aRespaldar = plan ? [...colecciones, 'users'] : colecciones;
  const carpeta = path.join(directorioRespaldo, marcaDeTiempo());
  fs.mkdirSync(carpeta, { recursive: true });
  for (const nombre of aRespaldar) {
    const documentos = await mongoose.connection.collection(nombre).find({}).toArray();
    fs.writeFileSync(path.join(carpeta, `${nombre}.json`), JSON.stringify(documentos));
  }

  const borrados = {};
  for (const nombre of colecciones) {
    const resultado = await mongoose.connection.collection(nombre).deleteMany({});
    borrados[nombre] = resultado.deletedCount;
  }
  if (plan) {
    const resultado = await mongoose.connection.collection('users').deleteMany({ _id: { $in: plan.eliminar.map((u) => u.id) } });
    borrados.users = resultado.deletedCount;
  }
  return { antes, plan, respaldo: carpeta, borrados };
}

// "--conservar-usuarios=anderson,adaly" -> ['anderson', 'adaly'] (null si no se uso la opcion).
function leerConservarUsuarios(argumentos) {
  const argumento = argumentos.find((a) => a.startsWith('--conservar-usuarios='));
  if (!argumento) return null;
  return argumento
    .slice('--conservar-usuarios='.length)
    .split(',')
    .map((texto) => texto.trim())
    .filter(Boolean);
}

function imprimirPlan(plan) {
  console.log('\nUsuarios que se CONSERVAN:');
  plan.conservar.forEach((u) => console.log(`  - ${u.nombre} <${u.email}> (${u.rol}) [${u.motivo}]`));
  console.log('Usuarios que se BORRAN:');
  if (plan.eliminar.length === 0) console.log('  (ninguno)');
  plan.eliminar.forEach((u) => console.log(`  - ${u.nombre} <${u.email}> (${u.rol})`));
  if (plan.problemas.length > 0) {
    console.log('\nPROBLEMAS (con --confirmar no se borraria nada hasta resolverlos):');
    plan.problemas.forEach((p) => console.log(`  ! ${p}`));
  }
}

if (require.main === module) {
  (async () => {
    try {
      await connectDB();
      const confirmar = process.argv.includes('--confirmar');
      const conservarUsuarios = leerConservarUsuarios(process.argv);
      const { host, name } = mongoose.connection;

      console.log(`Base de datos: ${name} en ${host}`);
      const resultado = await limpiarBaseDeDatos({
        confirmar,
        conservarUsuarios,
        vaciarInvitaciones: process.argv.includes('--vaciar-invitaciones'),
        directorioRespaldo: path.join(__dirname, '..', 'respaldos-limpieza'),
      });

      console.log('Hoy hay:', resultado.antes);
      if (resultado.plan) imprimirPlan(resultado.plan);
      if (!confirmar) {
        console.log('\nPRUEBA EN SECO: no se borro nada. Para borrar de verdad (haciendo antes un respaldo), agrega --confirmar');
        return;
      }
      console.log(`\nRespaldo guardado en: ${resultado.respaldo}`);
      console.log('Borrados:', resultado.borrados);
      console.log(
        resultado.plan
          ? 'Se conservaron: las categorias y los usuarios indicados arriba.'
          : 'Se conservaron: usuarios y categorias.'
      );
    } catch (err) {
      console.error('Error:', err.message);
      process.exitCode = 1;
    } finally {
      await mongoose.disconnect();
    }
  })();
}

module.exports = { limpiarBaseDeDatos, COLECCIONES_A_VACIAR, COLECCIONES_CON_INVITACIONES };
