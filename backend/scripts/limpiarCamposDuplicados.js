// Migracion unica: al configurar las categorias desde la app, se agregaron como "campo propio"
// varios de los campos comunes que el formulario YA muestra siempre (Autor, Titulo, Idioma, Año,
// Edicion, Lugar, Paginas impresas, No. de Inventario, Estado fisico). Eso hace que el formulario
// de "Registrar material" los pida dos veces: una vez como campo comun, y otra como campo propio
// de la categoria. Este script quita del arreglo "campos" de cada categoria los que duplican un
// campo comun, dejando solo los que de verdad son propios de esa categoria (ISBN, Editorial, etc).
//
// Por defecto solo MUESTRA que cambiaria (no escribe nada). Para aplicar los cambios de verdad:
//   MONGODB_URI="<cadena de conexion>" node scripts/limpiarCamposDuplicados.js --aplicar
require('dotenv').config();
const mongoose = require('mongoose');

function normalizar(texto) {
  return String(texto || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[.,]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const CAMPOS_COMUNES = new Set([
  'no inventario',
  'no de inventario',
  'autor',
  'titulo',
  'idioma',
  'ano',
  'edicion',
  'lugar',
  'paginas impresas',
  'estado fisico',
]);

async function migrar() {
  const aplicar = process.argv.includes('--aplicar');
  await mongoose.connect(process.env.MONGODB_URI);
  const Category = mongoose.connection.collection('categories');

  const categorias = await Category.find({}).toArray();
  let categoriasConCambios = 0;

  for (const categoria of categorias) {
    const campos = categoria.campos || [];
    const camposFiltrados = campos.filter((c) => !CAMPOS_COMUNES.has(normalizar(c.etiqueta)));

    if (camposFiltrados.length === campos.length) continue;

    categoriasConCambios++;
    const quitados = campos.filter((c) => CAMPOS_COMUNES.has(normalizar(c.etiqueta))).map((c) => c.etiqueta);
    const quedan = camposFiltrados.map((c) => c.etiqueta);

    console.log(`\n${categoria.nombre} (${categoria.clave})`);
    console.log(`  Se quitan (duplican campos comunes): ${quitados.join(', ') || '(ninguno)'}`);
    console.log(`  Quedan (propios de la categoria):    ${quedan.join(', ') || '(ninguno)'}`);

    if (aplicar) {
      await Category.updateOne({ _id: categoria._id }, { $set: { campos: camposFiltrados } });
    }
  }

  console.log(
    aplicar
      ? `\nListo. ${categoriasConCambios} categoria(s) actualizadas.`
      : `\n${categoriasConCambios} categoria(s) tendrian cambios. Esto fue solo una vista previa - nada se guardo.` +
          `\nPara aplicar de verdad, vuelve a correr agregando --aplicar al final.`
  );

  await mongoose.disconnect();
}

migrar().catch((err) => {
  console.error(err);
  process.exit(1);
});
