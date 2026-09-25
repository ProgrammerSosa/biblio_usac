const mongoose = require('mongoose');
const ExcelJS = require('exceljs');
const Catalog = require('../catalog/catalog_model');
const Category = require('../catalog/category_model');
const Counter = require('../catalog/counter_model');
const { CONTADOR_ID } = require('../../helpers/idInventario');
const { normalizarTexto } = require('../../helpers/catalogGroup');
const { registrarAuditoria } = require('../audit/audit_service');
const { ACCIONES_AUDITORIA } = require('../../utils/constants');
const { ok, fail } = require('../../utils/httpResponse');

// Respaldo manual en Excel (no automatico): el Manager lo genera cuando quiere, lo guarda
// donde le convenga (USB, nube, etc.) y lo puede volver a subir para restaurar si algo pasa.
// Se hizo en Excel a proposito, no en un formato tecnico (zip/json de Mongo), porque es lo que
// ya se usa y entiende en el resto de la app. El catalogo sale en una hoja POR CATEGORIA (el
// nombre de hoja es la clave, ej. "FOLLETO") en vez de una sola hoja mezclada - asi cada hoja
// solo trae las columnas de atributo que le corresponden a esa categoria (Editorial, ISBN,
// etc.), igual que ya se ve en el resto de la app, en vez de un bloque generico de JSON.

const COLUMNAS_CATEGORIAS = [
  { header: 'clave', key: 'clave', width: 25 },
  { header: 'nombre', key: 'nombre', width: 25 },
  { header: 'campos', key: 'campos', width: 55 },
  { header: 'camposComunesDesactivados', key: 'camposComunesDesactivados', width: 30 },
  { header: 'activo', key: 'activo', width: 10 },
];

// Columnas comunes a cualquier categoria. Los atributos propios (Editorial, ISBN, Tomos...)
// se insertan entre estos dos bloques al armar cada hoja, segun lo que declare esa categoria.
const COLUMNAS_CATALOGO_INICIO = [
  { header: '_id', key: '_id', width: 26 },
  { header: 'idInventario', key: 'idInventario', width: 12 },
  { header: 'autor', key: 'autor', width: 25 },
  { header: 'titulo', key: 'titulo', width: 30 },
  { header: 'idioma', key: 'idioma', width: 12 },
  { header: 'anio', key: 'anio', width: 10 },
  { header: 'edicion', key: 'edicion', width: 12 },
  { header: 'lugar', key: 'lugar', width: 15 },
  { header: 'paginasImpresas', key: 'paginasImpresas', width: 15 },
  { header: 'estadoFisico', key: 'estadoFisico', width: 25 },
];
const COLUMNAS_CATALOGO_FIN = [
  { header: 'estadoRevision', key: 'estadoRevision', width: 15 },
  { header: 'observaciones', key: 'observaciones', width: 25 },
  { header: 'enviado', key: 'enviado', width: 10 },
  { header: 'registradoPor', key: 'registradoPor', width: 26 },
  { header: 'registradoPorEmail', key: 'registradoPorEmail', width: 28 },
  { header: 'origenImportacion', key: 'origenImportacion', width: 25 },
  { header: 'revisadoPorAdmin', key: 'revisadoPorAdmin', width: 26 },
  { header: 'revisadoPorAdminEmail', key: 'revisadoPorAdminEmail', width: 28 },
  { header: 'eliminado', key: 'eliminado', width: 10 },
  { header: 'createdAt', key: 'createdAt', width: 22 },
  { header: 'updatedAt', key: 'updatedAt', width: 22 },
];

function nombreArchivoRespaldo() {
  const ahora = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const fecha = `${ahora.getFullYear()}-${pad(ahora.getMonth() + 1)}-${pad(ahora.getDate())}`;
  return `respaldo-biblioteca-${fecha}.xlsx`;
}

// Nombres de hoja de Excel no pueden pasar de 31 caracteres ni traer : \ / ? * [ ]. La clave
// de categoria (LIBRO, PUBLICACIONES_INSTITUCIONALES...) ya cumple esto casi siempre, pero se
// recorta/limpia por si alguna categoria futura tuviera una clave mas larga o rara.
function nombreHojaSeguro(clave) {
  return String(clave || 'CATEGORIA')
    .replace(/[:\\/?*[\]]/g, '_')
    .slice(0, 31);
}

function filaCatalogoComun(r) {
  return {
    _id: String(r._id),
    idInventario: r.idInventario ?? '',
    autor: r.autor,
    titulo: r.titulo,
    idioma: r.idioma || '',
    anio: r.anio || '',
    edicion: r.edicion || '',
    lugar: r.lugar || '',
    paginasImpresas: r.paginasImpresas ?? '',
    estadoFisico: r.estadoFisico || '',
    estadoRevision: r.estadoRevision,
    observaciones: r.observaciones || '',
    enviado: r.enviado,
    registradoPor: r.registradoPor ? String(r.registradoPor._id) : '',
    registradoPorEmail: r.registradoPor?.email || '',
    origenImportacion: r.origenImportacion || '',
    revisadoPorAdmin: r.revisadoPorAdmin ? String(r.revisadoPorAdmin._id) : '',
    revisadoPorAdminEmail: r.revisadoPorAdmin?.email || '',
    eliminado: r.eliminado,
    createdAt: r.createdAt ? r.createdAt.toISOString() : '',
    updatedAt: r.updatedAt ? r.updatedAt.toISOString() : '',
  };
}

async function exportarRespaldo(req, res, next) {
  try {
    // Incluye TODO (hasta lo eliminado) - un respaldo que no puede traer de vuelta un
    // registro borrado por error no serviria para el "por si algo pasa" que se pidio.
    const [categorias, registros] = await Promise.all([
      Category.find({}).sort({ clave: 1 }),
      Catalog.find({}).populate('registradoPor', 'email').populate('revisadoPorAdmin', 'email').sort({ createdAt: 1 }),
    ]);

    const workbook = new ExcelJS.Workbook();

    const hojaCategorias = workbook.addWorksheet('Categorias');
    hojaCategorias.columns = COLUMNAS_CATEGORIAS;
    categorias.forEach((c) => {
      hojaCategorias.addRow({
        clave: c.clave,
        nombre: c.nombre,
        campos: JSON.stringify(c.campos),
        camposComunesDesactivados: JSON.stringify(c.camposComunesDesactivados),
        activo: c.activo,
      });
    });

    const registrosPorCategoria = new Map();
    registros.forEach((r) => {
      if (!registrosPorCategoria.has(r.categoria)) registrosPorCategoria.set(r.categoria, []);
      registrosPorCategoria.get(r.categoria).push(r);
    });

    categorias.forEach((categoria) => {
      const columnasAtributos = categoria.campos.map((campo) => ({
        header: campo.etiqueta,
        key: `atributo__${campo.clave}`,
        width: 25,
      }));

      const hoja = workbook.addWorksheet(nombreHojaSeguro(categoria.clave));
      hoja.columns = [...COLUMNAS_CATALOGO_INICIO, ...columnasAtributos, ...COLUMNAS_CATALOGO_FIN];

      const filas = registrosPorCategoria.get(categoria.clave) || [];
      filas.forEach((r) => {
        const fila = filaCatalogoComun(r);
        categoria.campos.forEach((campo) => {
          fila[`atributo__${campo.clave}`] = (r.atributos && r.atributos[campo.clave]) ?? '';
        });
        hoja.addRow(fila);
      });
    });

    await registrarAuditoria({
      accion: ACCIONES_AUDITORIA.EXPORTAR,
      entidad: 'Respaldo',
      entidadId: req.user.userId,
      usuario: req.user.userId,
      detalles: { categorias: categorias.length, registros: registros.length },
    });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${nombreArchivoRespaldo()}"`);
    await workbook.xlsx.write(res);
    return res.end();
  } catch (err) {
    return next(err);
  }
}

function valorCelda(cell) {
  if (cell === null || cell === undefined) return '';
  if (typeof cell === 'object') {
    if (Array.isArray(cell.richText)) return cell.richText.map((run) => run.text || '').join('');
    if (cell.text !== undefined) return cell.text;
    if (cell.result !== undefined) return cell.result;
    return '';
  }
  return cell;
}

// A diferencia del import de catalogo (excelImport.js), este archivo no lo escribe una
// persona a mano - lo genera exportarRespaldo, asi que los encabezados siempre vienen exactos
// (los nombres de columna fijos, letra por letra; los de atributo, la etiqueta tal cual la
// tiene la categoria - por eso se normalizan igual que en el resto de la app antes de
// compararlos, por si la etiqueta trae acentos o mayusculas distintas).
function leerFilasConEncabezados(worksheet) {
  const encabezados = {};
  worksheet.getRow(1).eachCell({ includeEmpty: false }, (cell, colNumber) => {
    encabezados[colNumber] = String(valorCelda(cell.value) || '').trim();
  });

  const filas = [];
  worksheet.eachRow({ includeEmpty: false }, (row, numeroFila) => {
    if (numeroFila === 1) return;
    const datos = {};
    row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
      const clave = encabezados[colNumber];
      if (clave) datos[clave] = valorCelda(cell.value);
    });
    if (Object.keys(datos).length > 0) filas.push(datos);
  });
  return filas;
}

function parseJSONSeguro(texto, porDefecto) {
  if (texto === undefined || texto === null || texto === '') return porDefecto;
  try {
    return JSON.parse(texto);
  } catch {
    return porDefecto;
  }
}

function esBooleanoVerdadero(valor) {
  return valor === true || valor === 'true' || valor === 'TRUE' || valor === 1;
}

const NOMBRES_COLUMNAS_FIJAS_CATALOGO = new Set([...COLUMNAS_CATALOGO_INICIO, ...COLUMNAS_CATALOGO_FIN].map((c) => c.header));

async function restaurarRespaldo(req, res, next) {
  try {
    if (!req.file) {
      return fail(res, 'Debes subir el archivo de respaldo (.xlsx)');
    }

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(req.file.buffer);

    const hojaCategorias = workbook.getWorksheet('Categorias');
    if (!hojaCategorias) {
      return fail(res, 'El archivo no tiene el formato de un respaldo valido (falta la hoja "Categorias")');
    }

    const resultado = {
      categoriasCreadas: 0,
      categoriasActualizadas: 0,
      catalogoCreados: 0,
      catalogoActualizados: 0,
      errores: [],
    };

    // Categorias primero: un registro de Catalogo solo pasa la validacion (Catalog.create)
    // si su categoria ya existe con los campos que declara. Se guarda tambien en memoria
    // (campos por clave) para saber, hoja por hoja, cuales de sus columnas son atributos.
    const camposPorCategoria = new Map();
    for (const datos of leerFilasConEncabezados(hojaCategorias)) {
      if (!datos.clave) continue;
      const clave = String(datos.clave).toUpperCase().trim();
      const campos = parseJSONSeguro(datos.campos, []);
      camposPorCategoria.set(clave, campos);
      try {
        const existia = await Category.exists({ clave });
        await Category.findOneAndUpdate(
          { clave },
          {
            clave,
            nombre: datos.nombre || clave,
            campos,
            camposComunesDesactivados: parseJSONSeguro(datos.camposComunesDesactivados, []),
            activo: esBooleanoVerdadero(datos.activo),
          },
          { upsert: true, new: true, setDefaultsOnInsert: true }
        );
        if (existia) resultado.categoriasActualizadas++;
        else resultado.categoriasCreadas++;
      } catch (err) {
        resultado.errores.push({ titulo: `Categoria: ${datos.clave}`, error: err.message });
      }
    }

    let idInventarioMasAlto = 0;

    // Una hoja por categoria (el nombre de la hoja es la clave) - "Categorias" es la unica
    // que no es una hoja de catalogo.
    for (const hoja of workbook.worksheets) {
      if (hoja.name === 'Categorias') continue;

      const claveCategoria = hoja.name.toUpperCase().trim();
      const camposCategoria = camposPorCategoria.get(claveCategoria) || [];
      const clavesAtributosPorEtiqueta = new Map(camposCategoria.map((c) => [normalizarTexto(c.etiqueta), c.clave]));

      for (const datos of leerFilasConEncabezados(hoja)) {
        if (!datos.titulo && !datos.autor) continue;
        try {
          const idInventario = datos.idInventario !== '' && datos.idInventario !== undefined ? Number(datos.idInventario) : undefined;
          if (Number.isFinite(idInventario) && idInventario > idInventarioMasAlto) {
            idInventarioMasAlto = idInventario;
          }

          // Cualquier columna que no sea una de las fijas es un atributo propio de esta
          // categoria (Editorial, ISBN, Tomos...) - se reconstruye comparando su encabezado
          // contra la etiqueta que declara la categoria, igual que hace excelImport.js.
          const atributos = {};
          Object.keys(datos).forEach((encabezado) => {
            if (NOMBRES_COLUMNAS_FIJAS_CATALOGO.has(encabezado)) return;
            const claveAtributo = clavesAtributosPorEtiqueta.get(normalizarTexto(encabezado));
            if (claveAtributo) atributos[claveAtributo] = datos[encabezado];
          });

          const campos = {
            categoria: claveCategoria,
            idInventario: Number.isFinite(idInventario) ? idInventario : undefined,
            autor: datos.autor || '',
            titulo: datos.titulo || '',
            idioma: datos.idioma || '',
            anio: datos.anio !== undefined && datos.anio !== '' ? String(datos.anio) : '',
            edicion: datos.edicion || '',
            lugar: datos.lugar || '',
            paginasImpresas: datos.paginasImpresas !== '' && datos.paginasImpresas !== undefined ? Number(datos.paginasImpresas) : undefined,
            estadoFisico: datos.estadoFisico || '',
            atributos,
            estadoRevision: datos.estadoRevision || 'PENDIENTE',
            observaciones: datos.observaciones || '',
            enviado: esBooleanoVerdadero(datos.enviado),
            registradoPor: mongoose.isValidObjectId(datos.registradoPor) ? datos.registradoPor : req.user.userId,
            origenImportacion: datos.origenImportacion || undefined,
            revisadoPorAdmin: mongoose.isValidObjectId(datos.revisadoPorAdmin) ? datos.revisadoPorAdmin : undefined,
            eliminado: esBooleanoVerdadero(datos.eliminado),
          };

          const idValido = datos._id && mongoose.isValidObjectId(datos._id);
          if (idValido) {
            const existia = await Catalog.exists({ _id: datos._id });
            // El respaldo trae datos que ya se sabe que eran validos cuando se guardaron
            // (createdAt/idInventario/estadoRevision incluidos) - un upsert directo sin pasar
            // otra vez por las validaciones de "categoria recien creada" es lo correcto aqui,
            // restaurar es distinto a capturar un material nuevo.
            await Catalog.findByIdAndUpdate(datos._id, campos, { upsert: true, new: true, setDefaultsOnInsert: true });
            if (existia) resultado.catalogoActualizados++;
            else resultado.catalogoCreados++;
          } else {
            await Catalog.create(campos);
            resultado.catalogoCreados++;
          }
        } catch (err) {
          resultado.errores.push({ titulo: datos.titulo || 'Sin titulo', error: err.message });
        }
      }
    }

    // El contador de ID de inventario no puede quedar por debajo de lo que ya se restauro,
    // o la siguiente aprobacion asignaria un ID que ya existe (choca con el indice unico).
    if (idInventarioMasAlto > 0) {
      const actual = await Counter.findById(CONTADOR_ID);
      if (!actual || actual.seq < idInventarioMasAlto) {
        await Counter.findByIdAndUpdate(CONTADOR_ID, { seq: idInventarioMasAlto }, { upsert: true });
      }
    }

    await registrarAuditoria({
      accion: ACCIONES_AUDITORIA.RESTAURAR_RESPALDO,
      entidad: 'Respaldo',
      entidadId: req.user.userId,
      usuario: req.user.userId,
      detalles: resultado,
    });

    return ok(res, resultado, 'Respaldo restaurado');
  } catch (err) {
    return next(err);
  }
}

module.exports = { exportarRespaldo, restaurarRespaldo };
