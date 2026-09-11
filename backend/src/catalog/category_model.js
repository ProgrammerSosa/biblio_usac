const mongoose = require('mongoose');

const campoSchema = new mongoose.Schema(
  {
    clave: { type: String, required: true, trim: true },
    etiqueta: { type: String, required: true, trim: true },
    requerido: { type: Boolean, default: true },
  },
  { _id: false }
);

const categorySchema = new mongoose.Schema(
  {
    clave: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      trim: true,
    },
    nombre: {
      type: String,
      required: [true, 'El nombre de la categoria es obligatorio'],
      trim: true,
    },
    campos: {
      type: [campoSchema],
      default: [],
    },
    camposComunesDesactivados: {
      type: [String],
      default: [],
    },
    activo: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Category', categorySchema);
