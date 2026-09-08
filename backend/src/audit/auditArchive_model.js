const mongoose = require('mongoose');
const { ACCIONES_AUDITORIA } = require('../../utils/constants');

// Mismo esquema que Audit: aqui caen las entradas de auditoria de mas de 30 dias
// (ver helpers/archiveAudit.js) para mantener la coleccion "en caliente" pequeña
// sin perder el historial - sigue siendo consultable desde la pestaña Archivo.
const auditArchiveSchema = new mongoose.Schema(
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

module.exports = mongoose.model('AuditArchive', auditArchiveSchema);
