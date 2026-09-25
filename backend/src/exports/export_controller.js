const PDFDocument = require('pdfkit');
const Catalog = require('../catalog/catalog_model');
const Category = require('../catalog/category_model');
const { filtroVisibilidadBorradores } = require('../catalog/catalog_controller');
const { registrarAuditoria } = require('../audit/audit_service');
const { ACCIONES_AUDITORIA, tieneDanoFisico } = require('../../utils/constants');
const { drawTable, DANGER_TEXT } = require('../../helpers/pdfTable');
const { resolverOrden } = require('../../helpers/catalogSort');
const { escapeRegExp } = require('../../helpers/regex');
const { fail } = require('../../utils/httpResponse');

const ESTADO_LABELS = {
  PENDIENTE: 'Pendiente',
  APROBADO: 'Aprobado',
  RECHAZADO: 'Rechazado',
};

// Tamaño oficio (8.5" x 13") en puntos, para tener mas ancho que A4 y que quepan
// mas columnas de atributos antes de necesitar una tabla de continuacion.
const TAMANO_PAGINA_OFICIO = [612, 936];

// Ancho minimo/maximo de cada columna de atributo: por debajo del minimo el texto
// deja de ser legible aunque haga salto de linea; el maximo evita que una sola
// columna sobrante en una tabla de continuacion quede estirada de forma absurda.
const ANCHO_MIN_ATRIBUTO = 70;
const ANCHO_MAX_ATRIBUTO = 220;

const COLUMNAS_FIJAS = () => [
  { key: 'idInventario', header: 'ID', width: 40 },
  { key: 'titulo', header: 'Titulo', width: 140 },
  { key: 'autor', header: 'Autor', width: 95 },
];

// "idioma", "anio", "edicion", "lugar" y "paginasImpresas" son campos comunes del
// catalogo (existen para cualquier categoria, ver catalog_model.js) y no campos
// propios de la categoria (esos van en categoriaDoc.campos) - por eso antes no
// salian en el PDF: construirColumnas solo recorria categoriaDoc.campos. Cada
// categoria puede apagar cualquiera de estos desde Gestion de Categorias
// (camposComunesDesactivados), asi que el reporte debe respetar esa misma regla.
const CAMPOS_COMUNES_OPCIONALES = [
  { clave: 'idioma', key: 'idioma', header: 'Idioma', width: 55 },
  { clave: 'anio', key: 'anio', header: 'Anio', width: 40 },
  { clave: 'edicion', key: 'edicion', header: 'Edicion', width: 65 },
  { clave: 'lugar', key: 'lugar', header: 'Lugar', width: 75 },
  { clave: 'paginasImpresas', key: 'paginasImpresas', header: 'Paginas', width: 50 },
];

const COLUMNA_ESTADO_REVISION = () => ({ key: 'estadoRevision', header: 'Estado', width: 65, render: estadoRevisionTexto });
const COLUMNA_ESTADO_FISICO = () => ({
  clave: 'estadoFisico',
  key: 'estadoFisico',
  header: 'Estado fisico',
  width: 100,
  render: estadoFisicoTexto,
  colorFn: colorSiDanado,
});

// Cuando los atributos de una categoria no caben en una sola tabla, las columnas
// que sobran se dibujan debajo repitiendo esta para poder ubicar cada fila. No
// hace falta repetir tambien "No. Inv." porque el encabezado (y por lo tanto el
// registro completo) siempre queda junto, nunca separado del titulo.
const COLUMNAS_IDENTIDAD_CONTINUACION = () => [{ key: 'titulo', header: 'Titulo', width: 220 }];

// Columnas comunes (Idioma, Anio, Edicion, Lugar, Paginas) que esta categoria no
// desactivo, mas Estado fisico si tampoco esta desactivado para ella.
function columnasComunesActivas(categoriaDoc) {
  const desactivados = categoriaDoc.camposComunesDesactivados || [];
  const opcionales = CAMPOS_COMUNES_OPCIONALES.filter((c) => !desactivados.includes(c.clave)).map(({ clave, ...columna }) => columna);
  const finales = [COLUMNA_ESTADO_REVISION(), ...(desactivados.includes('estadoFisico') ? [] : [COLUMNA_ESTADO_FISICO()])];
  return { opcionales, finales };
}

const colorSiDanado = (row) => (tieneDanoFisico(row.estadoFisico) ? DANGER_TEXT : null);
const estadoFisicoTexto = (row) => row.estadoFisico || 'N/A';
const estadoRevisionTexto = (row) => ESTADO_LABELS[row.estadoRevision] || row.estadoRevision;
const sumaAnchos = (columnas) => columnas.reduce((sum, col) => sum + col.width, 0);

function nombreArchivoPdf() {
  const ahora = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const fecha = `${ahora.getFullYear()}-${pad(ahora.getMonth() + 1)}-${pad(ahora.getDate())}`;
  const hora = `${pad(ahora.getHours())}-${pad(ahora.getMinutes())}-${pad(ahora.getSeconds())}`;
  return `catalogo-biblioteca-${fecha}_${hora}.pdf`;
}

function construirColumnasAtributos(campos) {
  return campos.map((campo) => ({
    key: `atributos.${campo.clave}`,
    header: campo.etiqueta,
    width: ANCHO_MIN_ATRIBUTO,
    render: (row) => (row.atributos && row.atributos[campo.clave]) || 'N/A',
  }));
}

// Arma una tabla principal (columnas fijas + tantos atributos como quepan en el
// ancho de la hoja) y, si sobran atributos, una o mas tablas de continuacion
// debajo, cada una con su propio lote de columnas hasta agotarlos todos. Asi
// ninguna columna termina mas angosta que ANCHO_MIN_ATRIBUTO, sin importar
// cuantos campos tenga la categoria.
function construirGruposColumnas(categoriaDoc, anchoDisponible) {
  const { opcionales: comunesActivos, finales: columnasFinales } = columnasComunesActivas(categoriaDoc);
  const columnasAtributos = construirColumnasAtributos(categoriaDoc.campos || []);
  const columnasFijas = COLUMNAS_FIJAS();

  if (columnasAtributos.length === 0) {
    return [[...columnasFijas, ...comunesActivos, ...columnasFinales]];
  }

  const anchoBase = sumaAnchos(columnasFijas) + sumaAnchos(comunesActivos) + sumaAnchos(columnasFinales);
  const anchoIdentidad = sumaAnchos(COLUMNAS_IDENTIDAD_CONTINUACION());

  const grupos = [];
  let restantes = [...columnasAtributos];
  let esPrimerGrupo = true;

  while (restantes.length > 0) {
    const anchoOcupado = esPrimerGrupo ? anchoBase : anchoIdentidad;
    const anchoLibre = Math.max(anchoDisponible - anchoOcupado, ANCHO_MIN_ATRIBUTO);
    const cantidadQueCaben = Math.max(1, Math.floor(anchoLibre / ANCHO_MIN_ATRIBUTO));
    const lote = restantes.splice(0, cantidadQueCaben);

    const anchoPorColumna = Math.min(ANCHO_MAX_ATRIBUTO, Math.max(ANCHO_MIN_ATRIBUTO, Math.floor(anchoLibre / lote.length)));
    lote.forEach((columna) => {
      columna.width = anchoPorColumna;
    });

    grupos.push(
      esPrimerGrupo
        ? [...columnasFijas, ...comunesActivos, ...lote, ...columnasFinales]
        : [...COLUMNAS_IDENTIDAD_CONTINUACION(), ...lote]
    );
    esPrimerGrupo = false;
  }

  return grupos;
}

function agruparPorCategoria(registros) {
  const grupos = new Map();
  for (const item of registros) {
    if (!grupos.has(item.categoria)) {
      grupos.set(item.categoria, []);
    }
    grupos.get(item.categoria).push(item);
  }
  return grupos;
}

async function exportCatalogPdf(req, res, next) {
  try {
    const { estadoRevision, categoria, buscar, registradoPor, sort } = req.query;

    const filtro = { eliminado: false };
    if (estadoRevision) filtro.estadoRevision = estadoRevision;
    if (categoria) filtro.categoria = categoria;
    if (registradoPor) filtro.registradoPor = registradoPor;

    // Cualquier rol puede exportar (antes solo Admin/Manager), asi que el export tiene que
    // respetar la misma regla de visibilidad de borradores que la lista: un borrador sin
    // enviar solo lo ve quien lo creo, nunca deberia colarse en el PDF de alguien mas.
    const clausulas = [filtro, filtroVisibilidadBorradores(req.user.userId)];
    if (buscar && buscar.trim()) {
      const textoBuscado = buscar.trim();
      const patron = new RegExp(escapeRegExp(textoBuscado), 'i');
      const opciones = [{ titulo: patron }, { autor: patron }];
      if (/^\d+$/.test(textoBuscado)) {
        opciones.push({ idInventario: parseInt(textoBuscado, 10) });
      }
      clausulas.push({ $or: opciones });
    }
    const filtroFinal = { $and: clausulas };

    const { sort: sortSpec, collation } = resolverOrden(sort);
    const consulta = Catalog.find(filtroFinal).sort({ categoria: 1, ...sortSpec });
    if (collation) consulta.collation(collation);
    const registros = await consulta;

    if (registros.length === 0) {
      return fail(res, 'No hay registros que coincidan con los filtros indicados', 404);
    }

    await registrarAuditoria({
      accion: ACCIONES_AUDITORIA.EXPORTAR,
      entidad: 'Catalog',
      entidadId: registros[0]._id,
      usuario: req.user.userId,
      detalles: { filtro, totalRegistros: registros.length },
    });

    const grupos = agruparPorCategoria(registros);
    const categorias = await Category.find({ clave: { $in: [...grupos.keys()] } }).sort({ nombre: 1 });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${nombreArchivoPdf()}"`);

    const doc = new PDFDocument({ margin: 40, size: TAMANO_PAGINA_OFICIO, layout: 'landscape' });
    doc.pipe(res);

    doc
      .fillColor('#0f172a')
      .font('Helvetica-Bold')
      .fontSize(14)
      .text('Biblioteca - Facultad de Ciencias Juridicas y Sociales (USAC)', { align: 'center' });
    doc.font('Helvetica').fontSize(10).text('Reporte de catalogo', { align: 'center' });
    doc.moveDown(0.5);
    doc
      .fontSize(8)
      .fillColor('#475569')
      .text(
        `Generado: ${new Date().toLocaleString('es-GT')}  |  Filtros: categoria=${categoria || 'todas'}, estado=${
          estadoRevision ? ESTADO_LABELS[estadoRevision] : 'todos'
        }${buscar && buscar.trim() ? `, busqueda="${buscar.trim()}"` : ''}  |  Total: ${registros.length}`
      );
    doc.moveDown(1);

    for (const categoriaDoc of categorias) {
      const filas = grupos.get(categoriaDoc.clave) || [];
      if (filas.length === 0) continue;

      doc
        .fillColor('#0f172a')
        .font('Helvetica-Bold')
        .fontSize(11)
        .text(`${categoriaDoc.nombre} (${filas.length})`, doc.page.margins.left, doc.y);
      doc.moveDown(0.3);

      const anchoDisponible = doc.page.width - doc.page.margins.left - doc.page.margins.right;
      const gruposColumnas = construirGruposColumnas(categoriaDoc, anchoDisponible);
      drawTable(doc, { x: doc.page.margins.left, columnGroups: gruposColumnas, rows: filas });
      doc.moveDown(1);
    }

    doc.end();
  } catch (err) {
    return next(err);
  }
}

module.exports = { exportCatalogPdf };
