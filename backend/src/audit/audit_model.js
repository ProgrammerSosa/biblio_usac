const mongoose = require('mongoose');
const { ACCIONES_AUDITORIA } = require('../../utils/constants');

const auditSchema = new mongoose.Schema(
  {
    accion: {
      type: String,
      enum: Object.values(ACCIONES_AUDITORIA),
      required: true,
    },
    entidad: {
      type: String,
      required: true,
    },
    entidadId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
    },
    usuario: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    detalles: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    fecha: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: false }
);

module.exports = mongoose.model('Audit', auditSchema);
