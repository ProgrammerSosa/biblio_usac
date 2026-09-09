const PDFDocument = require('pdfkit');
const Catalog = require('../catalog/catalog_model');
const Category = require('../catalog/category_model');
const { registrarAuditoria } = require('../audit/audit_service');
const { ACCIONES_AUDITORIA, tieneDanoFisico } = require('../../utils/constants');
const { drawTable, DANGER_TEXT } = require('../../helpers/pdfTable');
const { escapeRegExp } = require('../../helpers/regex');
const { fail } = require('../../utils/httpResponse');

const ESTADO_LABELS = {
  PENDIENTE: 'Pendiente',
  APROBADO: 'Aprobado',
  RECHAZADO: 'Rechazado',
};

const ANCHO_TOTAL_ATRIBUTOS = 260;

const colorSiDanado = (row) => (tieneDanoFisico(row.estadoFisico) ? DANGER_TEXT : null);
const estadoFisicoTexto = (row) => row.estadoFisico || 'N/A';
const estadoRevisionTexto = (row) => ESTADO_LABELS[row.estadoRevision] || row.estadoRevision;

function nombreArchivoPdf() {
  const ahora = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const fecha = `${ahora.getFullYear()}-${pad(ahora.getMonth() + 1)}-${pad(ahora.getDate())}`;
  const hora = `${pad(ahora.getHours())}-${pad(ahora.getMinutes())}-${pad(ahora.getSeconds())}`;
  return `catalogo-biblioteca-${fecha}_${hora}.pdf`;
}

function construirColumnas(categoriaDoc) {
  const campos = categoriaDoc.campos || [];
  const anchoPorCampo = campos.length > 0 ? Math.floor(ANCHO_TOTAL_ATRIBUTOS / campos.length) : 0;

  const columnasAtributos = campos.map((campo) => ({
    key: `atributos.${campo.clave}`,
    header: campo.etiqueta,
    width: anchoPorCampo,
    render: (row) => (row.atributos && row.atributos[campo.clave]) || 'N/A',
  }));

  return [
    { key: 'noInventario', header: 'No. Inv.', width: 50 },
    { key: 'titulo', header: 'Titulo', width: 130 },
    { key: 'autor', header: 'Autor', width: 95 },
    ...columnasAtributos,
    { key: 'anio', header: 'Anio', width: 35 },
    { key: 'estadoRevision', header: 'Estado', width: 80, render: estadoRevisionTexto },
    { key: 'estadoFisico', header: 'Estado fisico', width: 110, render: estadoFisicoTexto, colorFn: colorSiDanado },
  ];
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
    const { estadoRevision, categoria, buscar } = req.query;

    const filtro = { eliminado: false };
    if (estadoRevision) filtro.estadoRevision = estadoRevision;
    if (categoria) filtro.categoria = categoria;
    if (buscar && buscar.trim()) {
      const patron = new RegExp(escapeRegExp(buscar.trim()), 'i');
      filtro.$or = [{ titulo: patron }, { autor: patron }, { noInventario: patron }];
    }

    const registros = await Catalog.find(filtro).sort({ categoria: 1, titulo: 1 });

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

    const doc = new PDFDocument({ margin: 40, size: 'A4', layout: 'landscape' });
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

      drawTable(doc, { x: doc.page.margins.left, columns: construirColumnas(categoriaDoc), rows: filas });
      doc.moveDown(1);
    }

    doc.end();
  } catch (err) {
    return next(err);
  }
}

module.exports = { exportCatalogPdf };
