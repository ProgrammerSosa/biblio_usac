const mongoose = require('mongoose');
require('dotenv').config();

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  const Category = require('./src/catalog/category_model');
  const todas = await Category.find({}).sort({ createdAt: 1 });
  todas.forEach((c) => {
    console.log(c.clave, '| creada:', c.createdAt.toISOString(), '| actualizada:', c.updatedAt.toISOString(), '| v:', c.__v, c.createdAt.getTime() !== c.updatedAt.getTime() ? '<<< MODIFICADA DESPUES DE CREAR' : '');
  });
  await mongoose.disconnect();
})().catch((e) => { console.error(e.message); process.exit(1); });
