const Category = require('./category_model');
const Catalog = require('./catalog_model');
const { registrarAuditoria } = require('../audit/audit_service');
const { generarClave } = require('../../helpers/slug');
const { ACCIONES_AUDITORIA } = require('../../utils/constants');
const { ok, created, fail, notFound } = require('../../utils/httpResponse');

// Campos comunes: el formulario de registro los muestra siempre, sin importar la categoria,
// asi que no tiene sentido (y genera campos repetidos) que alguien los agregue de nuevo como
// "campo propio" de una categoria. Autor, Titulo y No. de Inventario nunca se pueden desactivar;
// el resto la categoria los puede apagar via camposComunesDesactivados.
const CLAVES_COMUNES_DESACTIVABLES = ['idioma', 'anio', 'edicion', 'lugar', 'paginasImpresas', 'estadoFisico'];
const ETIQUETAS_COMUNES = [
  'No. de Inventario',
  'Autor',
  'Titulo',
  'Idioma',
  'Ano',
  'Edicion',
  'Lugar',
  'Paginas impresas',
  'Estado fisico',
];

function normalizarTexto(texto) {
  return String(texto || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[.,]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const ETIQUETAS_COMUNES_NORMALIZADAS = new Set([
  ...ETIQUETAS_COMUNES.map(normalizarTexto),
  'no de inventario',
]);

function normalizarComunesDesactivados(valores) {
  if (!Array.isArray(valores)) return [];
  return [...new Set(valores.filter((v) => CLAVES_COMUNES_DESACTIVABLES.includes(v)))];
}

function normalizarCampos(campos) {
  if (!Array.isArray(campos)) return { campos: [], error: null };

  const limpios = campos.filter((c) => c && typeof c.etiqueta === 'string' && c.etiqueta.trim());

  const repetido = limpios.find((c) => ETIQUETAS_COMUNES_NORMALIZADAS.has(normalizarTexto(c.etiqueta)));
  if (repetido) {
    return {
      campos: null,
      error: `"${repetido.etiqueta.trim()}" ya es un campo comun del formulario, no hace falta agregarlo como campo propio`,
    };
  }

  return {
    campos: limpios.map((c) => ({
      clave: generarClave(c.etiqueta),
      etiqueta: c.etiqueta.trim(),
      requerido: c.requerido !== false,
    })),
    error: null,
  };
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
    const { nombre, campos, camposComunesDesactivados } = req.body;

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

    const { campos: camposNormalizados, error: errorCampos } = normalizarCampos(campos);
    if (errorCampos) {
      return fail(res, errorCampos);
    }

    const categoria = await Category.create({
      clave,
      nombre: nombre.trim(),
      campos: camposNormalizados,
      camposComunesDesactivados: normalizarComunesDesactivados(camposComunesDesactivados),
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
      const { campos: camposNormalizados, error: errorCampos } = normalizarCampos(req.body.campos);
      if (errorCampos) {
        return fail(res, errorCampos);
      }
      categoria.campos = camposNormalizados;
    }

    if (req.body.camposComunesDesactivados !== undefined) {
      categoria.camposComunesDesactivados = normalizarComunesDesactivados(req.body.camposComunesDesactivados);
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
