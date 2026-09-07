const Category = require('../../src/catalog/category_model');
const { CATEGORIAS_POR_DEFECTO } = require('../../scripts/seed');

async function seedCategoriasDePrueba() {
  await Category.insertMany(CATEGORIAS_POR_DEFECTO);
}

module.exports = { seedCategoriasDePrueba };
