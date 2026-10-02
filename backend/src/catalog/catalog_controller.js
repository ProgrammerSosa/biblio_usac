const Catalog = require('./catalog_model');
const Category = require('./category_model');
const User = require('../users/user_model');
const { registrarAuditoria } = require('../audit/audit_service');
const { ROLES, ESTADOS_REVISION, ACCIONES_AUDITORIA } = require('../../utils/constants');
const { escapeRegExp } = require('../../helpers/regex');
const { previsualizarWorkbook } = require('../../helpers/excelImport');
const { resolverOrden } = require('../../helpers/catalogSort');
const { agruparPorCopias } = require('../../helpers/catalogGroup');
const { ok, created, fail, notFound, forbidden } = require('../../utils/httpResponse');

const CAMPOS_EDITABLES = ['idInventario', 'categoria', 'autor', 'titulo', 'idioma', 'anio', 'edicion', 'lugar', 'paginasImpresas', 'estadoFisico', 'atributos'];

function pickCatalogFields(body) {
  const datos = {};
  for (const campo of CAMPOS_EDITABLES) {
    if (body[campo] !== undefined) {
      datos[campo] = body[campo];
    }
  }
  // Un ID en blanco no es un ID: se trata como "no vino" (si se guardara '', el indice unico
  // lo contaria como un valor y el segundo registro en blanco chocaria con el primero).
  if (datos.idInventario !== undefined) {
    const id = String(datos.idInventario ?? '').trim();
    if (id) datos.idInventario = id;
    else delete datos.idInventario;
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

    if (!datos.idInventario) {
      return fail(res, 'El ID es obligatorio (ej. 1L, 20F, 20F-C1)');
    }

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
      detalles: { categoria: item.categoria },
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

// Convierte "2024" en un rango [1 ene 2024, 1 ene 2025) para filtrar por createdAt - el año en
// que el registro se creo, no el de publicacion (ver COLUMNA_ANIO_REGISTRO en export_controller,
// que muestra este mismo dato en el reporte). Un valor invalido o vacio simplemente no filtra.
function rangoDeAnio(anioTexto) {
  const anio = parseInt(anioTexto, 10);
  if (!anioTexto || Number.isNaN(anio)) return null;
  return { $gte: new Date(Date.UTC(anio, 0, 1)), $lt: new Date(Date.UTC(anio + 1, 0, 1)) };
}

function filtroVisibilidadBorradores(userId) {
  // Un borrador (enviado: false) solo lo puede ver quien lo creo. Todo lo ya enviado
  // es visible para cualquiera, como siempre.
  return { $or: [{ enviado: true }, { registradoPor: userId, enviado: false }] };
}

async function listItems(req, res, next) {
  try {
    const { estadoRevision, categoria, registradoPor, anioRegistro, buscar, sort, page = 1, limit = 20 } = req.query;

    const filtro = { eliminado: false };
    if (estadoRevision === 'DE_BAJA') {
      filtro.deBaja = true;
    } else if (estadoRevision) {
      filtro.estadoRevision = estadoRevision;
    }
    if (categoria) filtro.categoria = categoria;
    if (registradoPor) filtro.registradoPor = registradoPor;
    const rangoAnioRegistro = rangoDeAnio(anioRegistro);
    if (rangoAnioRegistro) filtro.createdAt = rangoAnioRegistro;

    const clausulas = [filtro, filtroVisibilidadBorradores(req.user.userId)];
    if (buscar && buscar.trim()) {
      const textoBuscado = buscar.trim();
      const patron = new RegExp(escapeRegExp(textoBuscado), 'i');
      // El ID tambien se busca (ej. "20F" encuentra el ejemplar 20F y sus copias 20F-C1, 20F-C2).
      clausulas.push({ $or: [{ titulo: patron }, { autor: patron }, { idInventario: patron }] });
    }
    const filtroFinal = { $and: clausulas };

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.max(1, parseInt(limit, 10) || 20);
    const { sort: sortSpec, collation } = resolverOrden(sort);

    // La paginacion tiene que aplicarse sobre los GRUPOS (un material con sus copias cuenta
    // como un solo renglon en la tabla), no sobre cada documento suelto - si no, dos copias
    // del mismo libro podrian caer en paginas distintas segun el orden (ej. una vieja ya
    // aprobada y una recien agregada), y la tabla ya no las mostraria juntas aunque sean
    // exactamente lo mismo. Por eso se trae todo lo que coincide con el filtro, ya ordenado,
    // y la pagina se recorta despues de agrupar.
    const consultaTodo = Catalog.find(filtroFinal)
      .populate('registradoPor', 'nombre email')
      .populate('revisadoPorAdmin', 'nombre email')
      .sort(sortSpec);
    if (collation) consultaTodo.collation(collation);

    const todos = await consultaTodo;
    const grupos = agruparPorCopias(todos);
    const total = grupos.length;
    const registros = grupos.slice((pageNum - 1) * limitNum, pageNum * limitNum).flat();

    return ok(res, {
      registros,
      total,
      page: pageNum,
      totalPages: Math.max(1, Math.ceil(total / limitNum)),
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

async function rechazarLote(req, res, next) {
  try {
    const { ids, observaciones } = req.body;

    if (!Array.isArray(ids) || ids.length === 0) {
      return fail(res, 'Debes indicar al menos un registro para rechazar');
    }
    if (!observaciones || !observaciones.trim()) {
      return fail(res, 'Las observaciones son obligatorias al rechazar un registro');
    }

    const registros = await Catalog.find({
      _id: { $in: ids },
      eliminado: false,
      enviado: true,
      estadoRevision: ESTADOS_REVISION.PENDIENTE,
    });

    for (const item of registros) {
      item.estadoRevision = ESTADOS_REVISION.RECHAZADO;
      item.observaciones = observaciones.trim();
      item.revisadoPorAdmin = req.user.userId;
      await item.save();

      await registrarAuditoria({
        accion: ACCIONES_AUDITORIA.RECHAZAR,
        entidad: 'Catalog',
        entidadId: item._id,
        usuario: req.user.userId,
        detalles: { estadoNuevo: item.estadoRevision, lote: true },
      });
    }

    return ok(res, { rechazados: registros.length }, `${registros.length} registro(s) rechazado(s)`);
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

    const { hojas, hojasOmitidas } = await previsualizarWorkbook(req.file.buffer, categoriasPorClave);

    if (hojas.length === 0) {
      const detalle = hojasOmitidas.length
        ? ` Hojas con datos que se encontraron: ${hojasOmitidas.map((h) => `"${h.hoja}" (${h.motivo})`).join('; ')}.`
        : '';
      return fail(
        res,
        `No se encontro ninguna hoja que se pueda importar. El nombre de cada hoja debe ser el de una categoria (ej. Libros, Revistas, Tesis, Docs de Donacion) y los encabezados deben estar en la fila 1.${detalle}`
      );
    }

    // Un ID que ya existe en el catalogo (incluidos los registros eliminados, que siguen
    // ocupando su ID) no se puede volver a importar: se marca la fila para que no se suba por
    // descuido. Repetidos dentro del mismo Excel ya los detecto previsualizarWorkbook.
    const idsDelExcel = hojas.flatMap((h) => h.items.flatMap((i) => i.ids || []));
    if (idsDelExcel.length > 0) {
      const existentes = await Catalog.find({ idInventario: { $in: idsDelExcel } }, 'idInventario');
      const idsExistentes = new Set(existentes.map((r) => r.idInventario));
      hojas.forEach((h) =>
        h.items.forEach((item) => {
          const repetidos = (item.ids || []).filter((id) => idsExistentes.has(id));
          if (repetidos.length > 0) {
            item.valido = false;
            item.errores.push(`El ID ${repetidos.join(', ')} ya existe en el catalogo`);
          }
        })
      );
    }

    const totalItems = hojas.reduce((suma, h) => suma + h.items.length, 0);
    const totalValidos = hojas.reduce((suma, h) => suma + h.items.filter((i) => i.valido).length, 0);

    return ok(res, { hojas, hojasOmitidas, totalItems, totalValidos });
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

    // Un Auxiliar solo puede registrar (a mano o por Excel) en sus categorias asignadas -
    // misma regla que createItem, para que importar un Excel no sea una forma de saltarsela.
    let categoriasPermitidas = null;
    if (req.user.rol === ROLES.USER) {
      const usuario = await User.findById(req.user.userId);
      categoriasPermitidas = usuario.allowedCategories;
    }

    let creados = 0;
    let primerRegistroId = null;
    const categoriasImportadas = new Set();
    const errores = [];

    // Hoja por hoja, en el orden en que llegaron (la vista previa las manda en el orden del archivo).
    const ordenCategoria = new Map();
    items.forEach((item) => {
      if (!ordenCategoria.has(item.categoria)) ordenCategoria.set(item.categoria, ordenCategoria.size);
    });

    // Un registro por cada fila del Excel. "copias" ya viene sumado desde la vista previa
    // (helpers/excelImport.js): cuantas filas identicas (mismos datos salvo estado fisico y ID)
    // se fusionaron en este item. Cada ejemplar trae su propio ID, el de su fila (ej. 20F,
    // 20F-C1, 20F-C2), en "ids", y su numero de fila en "filas".
    const pendientes = [];
    for (const item of items) {
      if (categoriasPermitidas && !categoriasPermitidas.includes(item.categoria)) {
        errores.push({
          categoria: item.categoria,
          titulo: item.titulo,
          error: `No tienes permiso para registrar materiales de la categoria ${item.categoria}`,
        });
        continue;
      }

      const copias = Math.max(1, parseInt(item.copias, 10) || 1);
      const datos = pickCatalogFields(item);
      const ids = Array.isArray(item.ids) && item.ids.length > 0 ? item.ids : [item.idInventario];
      for (let i = 0; i < copias; i++) {
        const fila = Array.isArray(item.filas) && item.filas[i] !== undefined ? item.filas[i] : item.fila;
        pendientes.push({ item, datos, id: ids[i], fila: Number(fila) || 0 });
      }
    }

    // Se crean en el orden de las filas del Excel (no junto a su original: una copia que esta
    // mas abajo en el archivo se crea mas abajo), porque el orden de creacion es el orden por
    // defecto de la lista y del reporte - asi todo sale en el orden del Excel que se subio.
    pendientes.sort((a, b) => ordenCategoria.get(a.item.categoria) - ordenCategoria.get(b.item.categoria) || a.fila - b.fila);

    for (const { item, datos, id } of pendientes) {
      const idCopia = String(id ?? '').trim();
      if (!idCopia) {
        errores.push({ categoria: item.categoria, titulo: item.titulo, error: 'Falta el ID' });
        continue;
      }

      try {
        // Queda Pendiente (no Aprobado): son datos que vienen de otra fuente y pueden
        // necesitar correccion, asi que igual pasan por revision antes de darse por buenos.
        const registro = await Catalog.create({
          ...datos,
          idInventario: idCopia,
          registradoPor: req.user.userId,
          enviado: true,
          estadoRevision: ESTADOS_REVISION.PENDIENTE,
          origenImportacion: archivoOrigen ? String(archivoOrigen).trim() : null,
        });

        if (!primerRegistroId) primerRegistroId = registro._id;
        categoriasImportadas.add(registro.categoria);
        creados += 1;
      } catch (err) {
        const mensaje = err.code === 11000 ? `El ID ${idCopia} ya existe en el catalogo` : err.message;
        errores.push({ categoria: item.categoria, titulo: item.titulo, error: mensaje });
      }
    }

    // Una sola auditoria para todo el lote (quien importo, cuantos registros, que categorias),
    // en vez de una auditoria por cada registro importado - una importacion real facilmente mete
    // cientos de filas de una sola vez, y rastrear cada una por separado solo ensucia el
    // historial sin aportar nada que "importado: true" en cada registro ya no diga.
    if (creados > 0) {
      await registrarAuditoria({
        accion: ACCIONES_AUDITORIA.CREAR,
        entidad: 'Catalog',
        entidadId: primerRegistroId,
        usuario: req.user.userId,
        detalles: {
          importado: true,
          lote: true,
          archivoOrigen: archivoOrigen ? String(archivoOrigen).trim() : null,
          creados,
          categorias: [...categoriasImportadas].join(', '),
        },
      });
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
      detalles: { idInventario: item.idInventario },
    });

    return ok(res, null, 'Registro eliminado correctamente');
  } catch (err) {
    return next(err);
  }
}

// "Dar de baja" es distinto de eliminar: el registro se queda visible (en el catalogo y en
// los reportes, marcado en gris) en vez de ocultarse - deja constancia de que ese ejemplar
// existio y ya no esta disponible. Solo tiene sentido para algo que de verdad estuvo en el
// inventario (Aprobado); pedir el motivo es obligatorio, igual que rechazar pide observaciones.
async function darDeBaja(req, res, next) {
  try {
    const { motivo } = req.body;
    if (!motivo || !motivo.trim()) {
      return fail(res, 'El motivo es obligatorio para dar de baja un registro');
    }

    const item = await Catalog.findOne({ _id: req.params.id, eliminado: false });
    if (!item) {
      return notFound(res, 'Registro no encontrado');
    }
    if (item.estadoRevision !== ESTADOS_REVISION.APROBADO) {
      return fail(res, 'Solo se puede dar de baja un registro que ya esta Aprobado', 409);
    }
    if (item.deBaja) {
      return fail(res, 'Este registro ya esta dado de baja', 409);
    }

    item.deBaja = true;
    item.motivoBaja = motivo.trim();
    item.fechaBaja = new Date();
    item.dadoDeBajaPor = req.user.userId;
    await item.save();

    await registrarAuditoria({
      accion: ACCIONES_AUDITORIA.DAR_DE_BAJA,
      entidad: 'Catalog',
      entidadId: item._id,
      usuario: req.user.userId,
      detalles: { idInventario: item.idInventario, motivo: item.motivoBaja },
    });

    return ok(res, item, 'Registro dado de baja');
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
  rechazarLote,
  enviarLote,
  previsualizarImportacion,
  confirmarImportacion,
  deleteItem,
  darDeBaja,
  filtroVisibilidadBorradores,
};
