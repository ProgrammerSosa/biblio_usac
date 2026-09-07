const mongoose = require('mongoose');
const { ROLES, ESTADOS_INVITACION } = require('../../utils/constants');

const SIETE_DIAS_MS = 7 * 24 * 60 * 60 * 1000;

const invitationSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: [true, 'El correo es obligatorio'],
      lowercase: true,
      trim: true,
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
    token: {
      type: String,
      required: true,
      unique: true,
    },
    estado: {
      type: String,
      enum: Object.values(ESTADOS_INVITACION),
      default: ESTADOS_INVITACION.PENDIENTE,
    },
    invitadoPor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    expiresAt: {
      type: Date,
      default: () => new Date(Date.now() + SIETE_DIAS_MS),
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Invitation', invitationSchema);
