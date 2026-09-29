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
    orden: 1,
    campos: [campo('Editorial', false), campo('Notas', false)],
  },
  {
    clave: 'ENCICLOPEDIA',
    nombre: 'Enciclopedia',
    campos: [campo('Tomos')],
  },
  {
    clave: 'REVISTA',
    nombre: 'Revista',
    orden: 2,
    campos: [campo('Editorial'), campo('Volumen')],
  },
  {
    clave: 'DICCIONARIO',
    nombre: 'Diccionario',
    campos: [campo('Editorial', false), campo('Notas', false)],
  },
  {
    clave: 'FOLLETO',
    nombre: 'Folleto',
    orden: 3,
    campos: [campo('Editorial', false), campo('Notas', false), campo('Tematica', false)],
  },
  {
    clave: 'PUBLICACIONES_INSTITUCIONALES',
    nombre: 'Publicaciones Institucionales',
    orden: 4,
    campos: [campo('Editorial', false), campo('Notas')],
  },
  {
    clave: 'TESIS',
    nombre: 'Tesis',
    camposComunesDesactivados: ['edicion', 'lugar', 'estadoFisico'],
    campos: [campo('Pais', false), campo('Institucion', false), campo('Notas', false)],
  },
  {
    clave: 'DOCS_CON_NUMERO_DE_INVENTARIO',
    nombre: 'Docs con Numero de Inventario',
    ordenarPorTipoDocumento: true,
    camposComunesDesactivados: ['edicion'],
    campos: [campo('Editorial', false), campo('Tipo de documento', false), campo('Notas', false)],
  },
  {
    clave: 'DOCS_DE_DONACION',
    nombre: 'Docs de Donacion',
    ordenarPorTipoDocumento: true,
    camposComunesDesactivados: ['edicion'],
    campos: [campo('Editorial', false), campo('Tipo de documento', false), campo('Notas', false)],
  },
  {
    clave: 'DOCS_SELLO_DE_BIBLIOCENTRAL',
    nombre: 'Docs Sello de Biblioteca Central',
    ordenarPorTipoDocumento: true,
    camposComunesDesactivados: ['edicion'],
    campos: [campo('Editorial', false), campo('Tipo de documento', true), campo('Notas', false)],
  },
  {
    clave: 'DOCS_CON_SELLO_FACUECONOMICAS',
    nombre: 'Docs con Sello Facultad de Ciencias Económicas',
    ordenarPorTipoDocumento: true,
    camposComunesDesactivados: ['edicion'],
    campos: [campo('Editorial', false), campo('Tipo de documento', false), campo('Notas', false)],
  },
  {
    clave: 'DOCS_SELLO_FACUJURI_Y_SOCI',
    nombre: 'Docs Sello Facultad de Ciencias Jurídicas y Sociales',
    ordenarPorTipoDocumento: true,
    camposComunesDesactivados: ['edicion'],
    campos: [campo('Editorial', false), campo('Tipo de Documento', false), campo('Notas', false)],
  },
  {
    clave: 'DOCS_FACULTAD_HUMANIDADES',
    nombre: 'Docs Facultad de Humanidades',
    ordenarPorTipoDocumento: true,
    camposComunesDesactivados: ['edicion'],
    campos: [campo('Editorial', false), campo('Tipo de documento', false), campo('Notas', false)],
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
