const Audit = require('./audit_model');

async function registrarAuditoria({ accion, entidad, entidadId, usuario, detalles = {} }) {
  return Audit.create({ accion, entidad, entidadId, usuario, detalles });
}

module.exports = { registrarAuditoria };
