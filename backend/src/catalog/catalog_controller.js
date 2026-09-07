const Catalog = require('./catalog_model');
const User = require('../users/user_model');
const { registrarAuditoria } = require('../audit/audit_service');
const { ROLES, ESTADOS_REVISION, ACCIONES_AUDITORIA } = require('../../utils/constants');
const { ok, created, fail, notFound, forbidden } = require('../../utils/httpResponse');

const CAMPOS_EDITABLES = [
  'categoria',
  'noInventario',
  'autor',
  'titulo',
  'idioma',
  'anio',
  'edicion',
  'lugar',
  'paginasImpresas',
  'estadoFisico',
  'atributos',
];

function pickCatalogFields(body) {
  const datos = {};
  for (const campo of CAMPOS_EDITABLES) {
    if (body[campo] !== undefined) {
      datos[campo] = body[campo];
    }
  }
  return datos;
}

async function createItem(req, res, next) {
  try {
    const datos = pickCatalogFields(req.body);

    if (!datos.categoria) {
      return fail(res, 'La categoria es obligatoria');
    }
    datos.categoria = datos.categoria.toUpperCase().trim();

    if (req.user.rol === ROLES.USER) {
      const usuario = await User.findById(req.user.userId);
      if (!usuario.allowedCategories.includes(datos.categoria)) {
        return forbidden(res, `No tienes permiso para registrar materiales de la categoria ${datos.categoria}`);
      }
    }

    const item = await Catalog.create({
      ...datos,
      registradoPor: req.user.userId,
    });

    await registrarAuditoria({
      accion: ACCIONES_AUDITORIA.CREAR,
      entidad: 'Catalog',
      entidadId: item._id,
      usuario: req.user.userId,
      detalles: { categoria: item.categoria, noInventario: item.noInventario },
    });

    return created(res, item);
  } catch (err) {
    return next(err);
  }
}

async function listItems(req, res, next) {
  try {
    const { estadoRevision, categoria, registradoPor, page = 1, limit = 20 } = req.query;

    const filtro = { eliminado: false };
    if (estadoRevision) filtro.estadoRevision = estadoRevision;
    if (categoria) filtro.categoria = categoria;
    if (registradoPor) filtro.registradoPor = registradoPor;

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.max(1, parseInt(limit, 10) || 20);

    const [registros, total] = await Promise.all([
      Catalog.find(filtro)
        .populate('registradoPor', 'nombre email')
        .populate('revisadoPorAdmin', 'nombre email')
        .populate('revisadoPorManager', 'nombre email')
        .sort({ createdAt: -1 })
        .skip((pageNum - 1) * limitNum)
        .limit(limitNum),
      Catalog.countDocuments(filtro),
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

async function getItem(req, res, next) {
  try {
    const item = await Catalog.findOne({ _id: req.params.id, eliminado: false })
      .populate('registradoPor', 'nombre email')
      .populate('revisadoPorAdmin', 'nombre email')
      .populate('revisadoPorManager', 'nombre email');

    if (!item) {
      return notFound(res, 'Registro no encontrado');
    }

    return ok(res, item);
  } catch (err) {
    return next(err);
  }
}

async function updateOwnItem(req, res, next) {
  try {
    const item = await Catalog.findOne({ _id: req.params.id, eliminado: false });
    if (!item) {
      return notFound(res, 'Registro no encontrado');
    }

    const esAutor = item.registradoPor.toString() === req.user.userId;
    const esSupervisor = [ROLES.ADMIN, ROLES.MANAGER].includes(req.user.rol);

    if (!esAutor && !esSupervisor) {
      return forbidden(res, 'Solo puedes editar tus propios registros');
    }

    if (esAutor && !esSupervisor) {
      const editable = [ESTADOS_REVISION.PENDIENTE_ADMIN, ESTADOS_REVISION.RECHAZADO].includes(item.estadoRevision);
      if (!editable) {
        return fail(res, 'Este registro ya no se puede editar en su estado actual', 409);
      }
    }

    // Admin/Manager pueden corregir un registro en cualquier estado (incluso ya aprobado)
    // sin que eso reinicie el flujo de revision.

    const estadoAnterior = item.estadoRevision;
    Object.assign(item, pickCatalogFields(req.body));

    if (esAutor && estadoAnterior === ESTADOS_REVISION.RECHAZADO) {
      item.estadoRevision = ESTADOS_REVISION.PENDIENTE_ADMIN;
    }

    await item.save();

    await registrarAuditoria({
      accion: ACCIONES_AUDITORIA.EDITAR,
      entidad: 'Catalog',
      entidadId: item._id,
      usuario: req.user.userId,
      detalles: { estadoAnterior, estadoNuevo: item.estadoRevision },
    });

    return ok(res, item);
  } catch (err) {
    return next(err);
  }
}

async function reviewByAdmin(req, res, next) {
  try {
    const { decision, observaciones } = req.body;

    if (!['APROBAR', 'RECHAZAR'].includes(decision)) {
      return fail(res, "La decision debe ser 'APROBAR' o 'RECHAZAR'");
    }

    const item = await Catalog.findOne({ _id: req.params.id, eliminado: false });
    if (!item) {
      return notFound(res, 'Registro no encontrado');
    }

    if (item.estadoRevision !== ESTADOS_REVISION.PENDIENTE_ADMIN) {
      return fail(res, 'Este registro no esta pendiente del filtro de Admin', 409);
    }

    Object.assign(item, pickCatalogFields(req.body));

    if (decision === 'APROBAR') {
      item.estadoRevision = ESTADOS_REVISION.PENDIENTE_MANAGER;
    } else {
      if (!observaciones) {
        return fail(res, 'Las observaciones son obligatorias al rechazar un registro');
      }
      item.estadoRevision = ESTADOS_REVISION.RECHAZADO;
      item.observaciones = observaciones;
    }
    item.revisadoPorAdmin = req.user.userId;

    await item.save();

    await registrarAuditoria({
      accion: decision === 'APROBAR' ? ACCIONES_AUDITORIA.APROBAR : ACCIONES_AUDITORIA.RECHAZAR,
      entidad: 'Catalog',
      entidadId: item._id,
      usuario: req.user.userId,
      detalles: { filtro: 'ADMIN', estadoNuevo: item.estadoRevision },
    });

    return ok(res, item);
  } catch (err) {
    return next(err);
  }
}

async function approveByManager(req, res, next) {
  try {
    const { decision, observaciones } = req.body;

    if (!['APROBAR', 'RECHAZAR'].includes(decision)) {
      return fail(res, "La decision debe ser 'APROBAR' o 'RECHAZAR'");
    }

    const item = await Catalog.findOne({ _id: req.params.id, eliminado: false });
    if (!item) {
      return notFound(res, 'Registro no encontrado');
    }

    if (item.estadoRevision !== ESTADOS_REVISION.PENDIENTE_MANAGER) {
      return fail(res, 'Este registro no esta pendiente del filtro de Manager', 409);
    }

    if (decision === 'APROBAR') {
      item.estadoRevision = ESTADOS_REVISION.APROBADO;
    } else {
      if (!observaciones) {
        return fail(res, 'Las observaciones son obligatorias al rechazar un registro');
      }
      item.estadoRevision = ESTADOS_REVISION.RECHAZADO;
      item.observaciones = observaciones;
    }
    item.revisadoPorManager = req.user.userId;

    await item.save();

    await registrarAuditoria({
      accion: decision === 'APROBAR' ? ACCIONES_AUDITORIA.APROBAR : ACCIONES_AUDITORIA.RECHAZAR,
      entidad: 'Catalog',
      entidadId: item._id,
      usuario: req.user.userId,
      detalles: { filtro: 'MANAGER', estadoNuevo: item.estadoRevision },
    });

    return ok(res, item);
  } catch (err) {
    return next(err);
  }
}

async function deleteItem(req, res, next) {
  try {
    const item = await Catalog.findOne({ _id: req.params.id, eliminado: false });
    if (!item) {
      return notFound(res, 'Registro no encontrado');
    }

    item.eliminado = true;
    await item.save();

    await registrarAuditoria({
      accion: ACCIONES_AUDITORIA.ELIMINAR,
      entidad: 'Catalog',
      entidadId: item._id,
      usuario: req.user.userId,
      detalles: { noInventario: item.noInventario },
    });

    return ok(res, null, 'Registro eliminado correctamente');
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  createItem,
  listItems,
  getItem,
  updateOwnItem,
  reviewByAdmin,
  approveByManager,
  deleteItem,
};
