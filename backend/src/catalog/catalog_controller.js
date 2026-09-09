const Catalog = require('./catalog_model');
const Category = require('./category_model');
const User = require('../users/user_model');
const { registrarAuditoria } = require('../audit/audit_service');
const { ROLES, ESTADOS_REVISION, ACCIONES_AUDITORIA } = require('../../utils/constants');
const { escapeRegExp } = require('../../helpers/regex');
const { previsualizarWorkbook } = require('../../helpers/excelImport');
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

  // "" no es lo mismo que ausente para el indice unique+sparse: Mongo solo salta el indice
  // cuando el campo no existe en el documento, no cuando vale "". Sin esto, el primer registro
  // sin numero de inventario se guarda bien, pero el segundo choca contra el primero como si
  // fuera un No. de Inventario duplicado (los dos valen "").
  if (typeof datos.noInventario === 'string') {
    const limpio = datos.noInventario.trim();
    datos.noInventario = limpio || undefined;
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

async function enviarLote(req, res, next) {
  try {
    const { ids } = req.body;

    if (!Array.isArray(ids) || ids.length === 0) {
      return fail(res, 'Debes indicar al menos un registro para enviar');
    }

    const registros = await Catalog.find({
      _id: { $in: ids },
      registradoPor: req.user.userId,
      enviado: false,
      eliminado: false,
    });

    for (const item of registros) {
      item.enviado = true;
      await item.save();

      await registrarAuditoria({
        accion: ACCIONES_AUDITORIA.ENVIAR,
        entidad: 'Catalog',
        entidadId: item._id,
        usuario: req.user.userId,
        detalles: { lote: true },
      });
    }

    return ok(res, { enviados: registros.length }, `${registros.length} registro(s) enviado(s) a revision`);
  } catch (err) {
    return next(err);
  }
}

function filtroVisibilidadBorradores(userId) {
  // Un borrador (enviado: false) solo lo puede ver quien lo creo. Todo lo ya enviado
  // es visible para cualquiera, como siempre.
  return { $or: [{ enviado: true }, { registradoPor: userId, enviado: false }] };
}

async function listItems(req, res, next) {
  try {
    const { estadoRevision, categoria, registradoPor, buscar, page = 1, limit = 20 } = req.query;

    const filtro = { eliminado: false };
    if (estadoRevision) filtro.estadoRevision = estadoRevision;
    if (categoria) filtro.categoria = categoria;
    if (registradoPor) filtro.registradoPor = registradoPor;

    const clausulas = [filtro, filtroVisibilidadBorradores(req.user.userId)];
    if (buscar && buscar.trim()) {
      const patron = new RegExp(escapeRegExp(buscar.trim()), 'i');
      clausulas.push({ $or: [{ titulo: patron }, { autor: patron }, { noInventario: patron }] });
    }
    const filtroFinal = { $and: clausulas };

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.max(1, parseInt(limit, 10) || 20);

    const [registros, total] = await Promise.all([
      Catalog.find(filtroFinal)
        .populate('registradoPor', 'nombre email')
        .populate('revisadoPorAdmin', 'nombre email')
        .sort({ createdAt: -1 })
        .skip((pageNum - 1) * limitNum)
        .limit(limitNum),
      Catalog.countDocuments(filtroFinal),
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
      .populate('revisadoPorAdmin', 'nombre email');

    if (!item) {
      return notFound(res, 'Registro no encontrado');
    }

    if (!item.enviado && item.registradoPor._id.toString() !== req.user.userId) {
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
    const esManager = req.user.rol === ROLES.MANAGER;
    const esSupervisor = [ROLES.ADMIN, ROLES.MANAGER].includes(req.user.rol);

    if (!esAutor && !esSupervisor) {
      return forbidden(res, 'Solo puedes editar tus propios registros');
    }

    if (item.estadoRevision === ESTADOS_REVISION.APROBADO) {
      // Una vez aprobado, solo la Manager lo puede corregir - ni el Admin ni el autor original.
      if (!esManager) {
        return forbidden(res, 'Un registro ya aprobado solo lo puede corregir la Manager');
      }
    } else if (esAutor && !esSupervisor) {
      const editable = [ESTADOS_REVISION.PENDIENTE, ESTADOS_REVISION.RECHAZADO].includes(item.estadoRevision);
      if (!editable) {
        return fail(res, 'Este registro ya no se puede editar en su estado actual', 409);
      }
    }

    // Admin/Manager pueden corregir un registro Pendiente o Rechazado sin que eso reinicie
    // el flujo de revision (solo Manager puede tocar uno ya Aprobado, validado arriba).

    const estadoAnterior = item.estadoRevision;
    Object.assign(item, pickCatalogFields(req.body));

    if (esAutor && estadoAnterior === ESTADOS_REVISION.RECHAZADO) {
      item.estadoRevision = ESTADOS_REVISION.PENDIENTE;
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

async function revisarMaterial(req, res, next) {
  try {
    const { decision, observaciones } = req.body;

    if (!['APROBAR', 'RECHAZAR'].includes(decision)) {
      return fail(res, "La decision debe ser 'APROBAR' o 'RECHAZAR'");
    }

    const item = await Catalog.findOne({ _id: req.params.id, eliminado: false });
    if (!item || !item.enviado) {
      return notFound(res, 'Registro no encontrado');
    }

    if (item.estadoRevision !== ESTADOS_REVISION.PENDIENTE) {
      return fail(res, 'Este registro no esta pendiente de revision', 409);
    }

    Object.assign(item, pickCatalogFields(req.body));

    if (decision === 'APROBAR') {
      item.estadoRevision = ESTADOS_REVISION.APROBADO;
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
      detalles: { estadoNuevo: item.estadoRevision },
    });

    return ok(res, item);
  } catch (err) {
    return next(err);
  }
}

async function aprobarLote(req, res, next) {
  try {
    const { ids } = req.body;

    if (!Array.isArray(ids) || ids.length === 0) {
      return fail(res, 'Debes indicar al menos un registro para aprobar');
    }

    const registros = await Catalog.find({
      _id: { $in: ids },
      eliminado: false,
      enviado: true,
      estadoRevision: ESTADOS_REVISION.PENDIENTE,
    });

    for (const item of registros) {
      item.estadoRevision = ESTADOS_REVISION.APROBADO;
      item.revisadoPorAdmin = req.user.userId;
      await item.save();

      await registrarAuditoria({
        accion: ACCIONES_AUDITORIA.APROBAR,
        entidad: 'Catalog',
        entidadId: item._id,
        usuario: req.user.userId,
        detalles: { estadoNuevo: item.estadoRevision, lote: true },
      });
    }

    return ok(res, { aprobados: registros.length }, `${registros.length} registro(s) aprobado(s)`);
  } catch (err) {
    return next(err);
  }
}

async function previsualizarImportacion(req, res, next) {
  try {
    if (!req.file) {
      return fail(res, 'Debes subir un archivo de Excel (.xlsx)');
    }

    const categorias = await Category.find({ activo: true });
    const categoriasPorClave = new Map(categorias.map((c) => [c.clave, c]));

    const hojas = await previsualizarWorkbook(req.file.buffer, categoriasPorClave);

    if (hojas.length === 0) {
      return fail(
        res,
        'No se encontraron hojas reconocibles (Libros, Revistas, Diccionarios, Enciclopedias, Folletos, Publicacion institucional) con datos'
      );
    }

    const totalItems = hojas.reduce((suma, h) => suma + h.items.length, 0);
    const totalValidos = hojas.reduce((suma, h) => suma + h.items.filter((i) => i.valido).length, 0);

    return ok(res, { hojas, totalItems, totalValidos });
  } catch (err) {
    if (err.message && err.message.toLowerCase().includes('central directory')) {
      return fail(res, 'El archivo no parece ser un Excel valido (.xlsx)');
    }
    return next(err);
  }
}

async function confirmarImportacion(req, res, next) {
  try {
    const { items, archivoOrigen } = req.body;

    if (!Array.isArray(items) || items.length === 0) {
      return fail(res, 'No hay materiales para importar');
    }

    let creados = 0;
    const errores = [];

    for (const item of items) {
      const copias = Math.max(1, parseInt(item.copias, 10) || 1);
      // Si varias filas del Excel se fusionaron en este item por ser el mismo material
      // (100% igual salvo estado fisico), cada una pudo traer su propio No. de Inventario:
      // se le asigna a cada copia el suyo, en el mismo orden. Si no hay tantos numeros como
      // copias, las que sobran quedan sin numero para completarse despues con el fisico real.
      const noInventarios =
        Array.isArray(item.noInventarios) && item.noInventarios.length > 0
          ? item.noInventarios
          : [item.noInventario].filter(Boolean);

      for (let i = 0; i < copias; i++) {
        try {
          const datos = pickCatalogFields(item);
          const numeroDeEstaCopia = noInventarios[i];
          if (numeroDeEstaCopia) {
            datos.noInventario = numeroDeEstaCopia;
          } else {
            delete datos.noInventario;
          }

          // Queda Pendiente (no Aprobado): son datos que vienen de otra fuente y pueden
          // necesitar correccion, asi que igual pasan por revision antes de darse por buenos.
          const registro = await Catalog.create({
            ...datos,
            registradoPor: req.user.userId,
            enviado: true,
            estadoRevision: ESTADOS_REVISION.PENDIENTE,
            origenImportacion: archivoOrigen ? String(archivoOrigen).trim() : null,
          });

          await registrarAuditoria({
            accion: ACCIONES_AUDITORIA.CREAR,
            entidad: 'Catalog',
            entidadId: registro._id,
            usuario: req.user.userId,
            detalles: { categoria: registro.categoria, noInventario: registro.noInventario, importado: true },
          });

          creados += 1;
        } catch (err) {
          const mensaje = err.code === 11000 ? 'Ya existe un registro con ese No. de Inventario' : err.message;
          errores.push({ titulo: item.titulo, noInventario: item.noInventario, error: mensaje });
        }
      }
    }

    return ok(res, { creados, errores }, `${creados} material(es) importado(s)`);
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
  revisarMaterial,
  aprobarLote,
  enviarLote,
  previsualizarImportacion,
  confirmarImportacion,
  deleteItem,
};
