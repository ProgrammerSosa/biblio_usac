require('dotenv').config();

const mongoose = require('mongoose');
const connectDB = require('../config/db');
const Category = require('../src/catalog/category_model');
const { CATEGORIAS_POR_DEFECTO } = require('./seed');

// A diferencia de seed.js (que solo actua si la base esta completamente vacia), este script
// se puede correr en una base que YA tiene categorias reales (ej. produccion) sin miedo:
// unicamente agrega las categorias de CATEGORIAS_POR_DEFECTO que todavia no existan (por
// clave). Nunca modifica ni toca una categoria que ya este ahi.
async function agregarCategoriasFaltantes() {
  const creadas = [];
  const yaExistian = [];

  for (const categoria of CATEGORIAS_POR_DEFECTO) {
    const existe = await Category.exists({ clave: categoria.clave });
    if (existe) {
      yaExistian.push(categoria.clave);
      continue;
    }
    await Category.create(categoria);
    creadas.push(categoria.clave);
  }

  console.log('Categorias creadas:', creadas.length ? creadas.join(', ') : '(ninguna)');
  console.log('Categorias que ya existian (no se tocaron):', yaExistian.length ? yaExistian.join(', ') : '(ninguna)');
}

if (require.main === module) {
  (async () => {
    try {
      await connectDB();
      await agregarCategoriasFaltantes();
    } catch (err) {
      console.error('Error:', err.message);
      process.exitCode = 1;
    } finally {
      await mongoose.disconnect();
    }
  })();
}

module.exports = { agregarCategoriasFaltantes };
