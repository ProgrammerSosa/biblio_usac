require('dotenv').config();

const mongoose = require('mongoose');
const connectDB = require('../config/db');
const User = require('../src/users/user_model');
const Category = require('../src/catalog/category_model');
const { ROLES } = require('../utils/constants');
const { hashPassword } = require('../helpers/password');
const { generarClave } = require('../helpers/slug');

const DEFAULT_MANAGER_NOMBRE = process.env.DEFAULT_MANAGER_NOMBRE || 'libroderecho';
const DEFAULT_MANAGER_EMAIL = process.env.DEFAULT_MANAGER_EMAIL || 'sosabalcarcel@gmail.com';
const DEFAULT_MANAGER_PASSWORD = process.env.DEFAULT_MANAGER_PASSWORD || 'l@wbook';

// clave de cada campo se genera igual que cuando la Manager crea una categoria desde la app,
// para que un campo "Editorial" tenga siempre la misma clave sin importar de donde salio.
function campo(etiqueta, requerido = true) {
  return { clave: generarClave(etiqueta), etiqueta, requerido };
}

const CATEGORIAS_POR_DEFECTO = [
  {
    clave: 'LIBRO',
    nombre: 'Libro',
    campos: [campo('Editorial'), campo('ISBN'), campo('Tipo de documento')],
  },
  {
    clave: 'ENCICLOPEDIA',
    nombre: 'Enciclopedia',
    campos: [campo('Tomos')],
  },
  {
    clave: 'REVISTA',
    nombre: 'Revista',
    campos: [campo('Editorial'), campo('ISSN'), campo('Volumen')],
  },
  {
    clave: 'DICCIONARIO',
    nombre: 'Diccionario',
    campos: [campo('Editorial')],
  },
  {
    clave: 'FOLLETO',
    nombre: 'Folleto',
    campos: [campo('Editorial'), campo('Tipo de documento')],
  },
  {
    clave: 'PUBLICACIONES_INSTITUCIONALES',
    nombre: 'Publicaciones Institucionales',
    campos: [campo('Editorial'), campo('Tipo de documento')],
  },
];

async function seedCategorias() {
  const existenCategorias = await Category.exists({});
  if (existenCategorias) {
    console.log('Ya existen categorias, no se requiere bootstrap.');
    return;
  }

  await Category.insertMany(CATEGORIAS_POR_DEFECTO);
  console.log(`Categorias por defecto creadas: ${CATEGORIAS_POR_DEFECTO.map((c) => c.clave).join(', ')}`);
}

async function seedManagerPorDefecto() {
  const existeManager = await User.exists({ rol: ROLES.MANAGER });
  if (existeManager) {
    console.log('Ya existe una cuenta Manager, no se requiere bootstrap.');
    return;
  }

  const passwordHash = await hashPassword(DEFAULT_MANAGER_PASSWORD);

  await User.create({
    nombre: DEFAULT_MANAGER_NOMBRE,
    email: DEFAULT_MANAGER_EMAIL,
    passwordHash,
    rol: ROLES.MANAGER,
  });

  console.log('Cuenta Manager por defecto creada. Inicia sesion con:');
  console.log(`  Nombre o correo: ${DEFAULT_MANAGER_NOMBRE} / ${DEFAULT_MANAGER_EMAIL}`);
  console.log(`  Contraseña:      ${DEFAULT_MANAGER_PASSWORD}`);
}

async function seed() {
  await seedCategorias();
  await seedManagerPorDefecto();
}

if (require.main === module) {
  (async () => {
    try {
      await connectDB();
      await seed();
    } catch (err) {
      console.error('Error al ejecutar el seed:', err.message);
      process.exitCode = 1;
    } finally {
      await mongoose.disconnect();
    }
  })();
}

module.exports = {
  seed,
  seedCategorias,
  CATEGORIAS_POR_DEFECTO,
  DEFAULT_MANAGER_NOMBRE,
  DEFAULT_MANAGER_EMAIL,
  DEFAULT_MANAGER_PASSWORD,
};
