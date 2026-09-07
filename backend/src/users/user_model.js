const mongoose = require('mongoose');
const { ROLES } = require('../../utils/constants');

const userSchema = new mongoose.Schema(
  {
    nombre: {
      type: String,
      required: [true, 'El nombre es obligatorio'],
      trim: true,
    },
    email: {
      type: String,
      required: [true, 'El correo es obligatorio'],
      unique: true,
      lowercase: true,
      trim: true,
    },
    passwordHash: {
      type: String,
      required: true,
    },
    rol: {
      type: String,
      enum: Object.values(ROLES),
      required: true,
    },
    allowedCategories: {
      type: [String],
      default: [],
      set: (categorias) => categorias.map((c) => c.toUpperCase().trim()),
    },
    activo: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('User', userSchema);
