const Audit = require('./audit_model');
const User = require('../users/user_model');
const { ROLES } = require('../../utils/constants');
const { ok } = require('../../utils/httpResponse');

async function idsVisiblesParaAdmin() {
  const auxiliares = await User.find({ rol: ROLES.USER }).select('_id');
  return auxiliares.map((u) => u._id.toString());
}

async function listAudit(req, res, next) {
  try {
    const { usuario, accion, entidad, desde, hasta, page = 1, limit = 20 } = req.query;

    const filtro = {};
    if (accion) filtro.accion = accion;
    if (entidad) filtro.entidad = entidad;
    if (desde || hasta) {
      filtro.fecha = {};
      if (desde) filtro.fecha.$gte = new Date(desde);
      if (hasta) filtro.fecha.$lte = new Date(hasta);
    }

    if (req.user.rol === ROLES.ADMIN) {
      // Un Admin solo puede auditar a los Auxiliares, no a otros Admin ni a la Manager.
      const idsPermitidos = await idsVisiblesParaAdmin();
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
      Audit.find(filtro)
        .populate('usuario', 'nombre email rol')
        .sort({ fecha: -1 })
        .skip((pageNum - 1) * limitNum)
        .limit(limitNum),
      Audit.countDocuments(filtro),
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
    const filtroRol = req.user.rol === ROLES.ADMIN ? { rol: ROLES.USER } : { rol: { $in: [ROLES.ADMIN, ROLES.USER, ROLES.MANAGER] } };

    const usuarios = await User.find(filtroRol).select('nombre email rol').sort({ nombre: 1 });
    return ok(res, usuarios);
  } catch (err) {
    return next(err);
  }
}

module.exports = { listAudit, listUsuariosFiltrables };
