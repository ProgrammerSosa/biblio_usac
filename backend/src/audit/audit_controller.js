const Audit = require('./audit_model');
const AuditArchive = require('./auditArchive_model');
const { ROLES } = require('../../utils/constants');
const { usuariosVisiblesPara } = require('../../helpers/alcanceEquipo');
const { ok } = require('../../utils/httpResponse');

async function listAudit(req, res, next) {
  try {
    const { usuario, accion, entidad, desde, hasta, origen, page = 1, limit = 20 } = req.query;
    const Modelo = origen === 'archivo' ? AuditArchive : Audit;

    const filtro = {};
    if (accion) filtro.accion = accion;
    if (entidad) filtro.entidad = entidad;
    if (desde || hasta) {
      filtro.fecha = {};
      if (desde) filtro.fecha.$gte = new Date(desde);
      if (hasta) filtro.fecha.$lte = new Date(hasta);
    }

    if (req.user.rol === ROLES.USER) {
      // Un Auxiliar solo ve su propia auditoria, sin excepcion - se ignora cualquier
      // "usuario" que intente mandar por la URL, nunca la de otra persona.
      filtro.usuario = req.user.userId;
    } else if (req.user.rol === ROLES.ADMIN) {
      // Un Admin solo puede auditar a los Auxiliares, no a otros Admin ni a la Manager.
      const visibles = await usuariosVisiblesPara(req.user.rol);
      const idsPermitidos = visibles.map((u) => u._id.toString());
      if (usuario) {
        if (!idsPermitidos.includes(usuario)) {
          return ok(res, { registros: [], total: 0, page: 1, totalPages: 0 });
        }
        filtro.usuario = usuario;
      } else {
        filtro.usuario = { $in: idsPermitidos };
      }
    } else if (usuario) {
      filtro.usuario = usuario;
    }

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.max(1, parseInt(limit, 10) || 20);

    const [registros, total] = await Promise.all([
      Modelo.find(filtro)
        .populate('usuario', 'nombre email rol')
        .sort({ fecha: -1 })
        .skip((pageNum - 1) * limitNum)
        .limit(limitNum),
      Modelo.countDocuments(filtro),
    ]);

    return ok(res, {
      registros,
      total,
      page: pageNum,
      totalPages: Math.ceil(total / limitNum),
    });
  } catch (err) {
    return next(err);
  }
}

async function listUsuariosFiltrables(req, res, next) {
  try {
    // Un Auxiliar no filtra por persona (solo ve lo suyo) - no tiene sentido mandarle la
    // lista de todo el personal.
    if (req.user.rol === ROLES.USER) {
      return ok(res, []);
    }
    const usuarios = await usuariosVisiblesPara(req.user.rol);
    usuarios.sort((a, b) => a.nombre.localeCompare(b.nombre));
    return ok(res, usuarios);
  } catch (err) {
    return next(err);
  }
}

module.exports = { listAudit, listUsuariosFiltrables };
