const mongoose = require('mongoose');
require('dotenv').config();

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  const Category = require('./src/catalog/category_model');
  const c = await Category.findOne({ clave: 'DOCS_SELLO_FACUJURI_Y_SOCI' });
  c.campos = [
    { clave: 'EDITORIAL', etiqueta: 'Editorial', requerido: true },
    { clave: 'PAIS', etiqueta: 'Pais', requerido: true },
    { clave: 'TIPO_DE_DOCUMENTO', etiqueta: 'Tipo de Documento', requerido: true },
    { clave: 'NOTAS', etiqueta: 'Notas', requerido: true },
  ];
  c.camposComunesDesactivados = ['edicion', 'lugar'];
  await c.save();
  console.log('Reparado:', JSON.stringify(c, null, 2));
  await mongoose.disconnect();
})().catch((e) => { console.error(e.message); process.exit(1); });
