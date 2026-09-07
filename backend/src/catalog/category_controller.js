const Category = require('./category_model');
const Catalog = require('./catalog_model');
const { registrarAuditoria } = require('../audit/audit_service');
const { generarClave } = require('../../helpers/slug');
const { ACCIONES_AUDITORIA } = require('../../utils/constants');
const { ok, created, fail, notFound } = require('../../utils/httpResponse');

function normalizarCampos(campos) {
  if (!Array.isArray(campos)) return [];
  return campos
    .filter((c) => c && typeof c.etiqueta === 'string' && c.etiqueta.trim())
    .map((c) => ({
      clave: generarClave(c.etiqueta),
      etiqueta: c.etiqueta.trim(),
      requerido: c.requerido !== false,
    }));
}

async function listCategories(req, res, next) {
  try {
    const filtro = req.query.incluirInactivas === 'true' ? {} : { activo: true };
    const categorias = await Category.find(filtro).sort({ nombre: 1 });
    return ok(res, categorias);
  } catch (err) {
    return next(err);
  }
}

async function createCategory(req, res, next) {
  try {
    const { nombre, campos } = req.body;

    if (!nombre || !nombre.trim()) {
      return fail(res, 'El nombre de la categoria es obligatorio');
    }

    const clave = generarClave(nombre);
    if (!clave) {
      return fail(res, 'El nombre debe contener al menos una letra o numero');
    }

    const yaExiste = await Category.findOne({ clave });
    if (yaExiste) {
      return fail(res, `Ya existe una categoria equivalente a '${nombre}'`, 409);
    }

    const categoria = await Category.create({
      clave,
      nombre: nombre.trim(),
      campos: normalizarCampos(campos),
    });

    await registrarAuditoria({
      accion: ACCIONES_AUDITORIA.CREAR,
      entidad: 'Category',
      entidadId: categoria._id,
      usuario: req.user.userId,
      detalles: { clave: categoria.clave, nombre: categoria.nombre },
    });

    return created(res, categoria);
  } catch (err) {
    return next(err);
  }
}

async function updateCategory(req, res, next) {
  try {
    const categoria = await Category.findById(req.params.id);
    if (!categoria) {
      return notFound(res, 'Categoria no encontrada');
    }

    if (req.body.nombre !== undefined) {
      if (!req.body.nombre.trim()) {
        return fail(res, 'El nombre de la categoria es obligatorio');
      }
      categoria.nombre = req.body.nombre.trim();
    }

    if (req.body.campos !== undefined) {
      categoria.campos = normalizarCampos(req.body.campos);
    }

    await categoria.save();

    await registrarAuditoria({
      accion: ACCIONES_AUDITORIA.EDITAR,
      entidad: 'Category',
      entidadId: categoria._id,
      usuario: req.user.userId,
      detalles: { clave: categoria.clave },
    });

    return ok(res, categoria);
  } catch (err) {
    return next(err);
  }
}

async function setCategoryStatus(req, res, next) {
  try {
    const { activo } = req.body;
    if (typeof activo !== 'boolean') {
      return fail(res, "El campo 'activo' debe ser true o false");
    }

    const categoria = await Category.findById(req.params.id);
    if (!categoria) {
      return notFound(res, 'Categoria no encontrada');
    }

    categoria.activo = activo;
    await categoria.save();

    await registrarAuditoria({
      accion: activo ? ACCIONES_AUDITORIA.ACTIVAR_CATEGORIA : ACCIONES_AUDITORIA.DESACTIVAR_CATEGORIA,
      entidad: 'Category',
      entidadId: categoria._id,
      usuario: req.user.userId,
      detalles: { clave: categoria.clave, activo },
    });

    return ok(res, categoria);
  } catch (err) {
    return next(err);
  }
}

async function countCategoryUsage(req, res, next) {
  try {
    const categoria = await Category.findById(req.params.id);
    if (!categoria) {
      return notFound(res, 'Categoria no encontrada');
    }

    const total = await Catalog.countDocuments({ categoria: categoria.clave, eliminado: false });
    return ok(res, { total });
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  listCategories,
  createCategory,
  updateCategory,
  setCategoryStatus,
  countCategoryUsage,
};
