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
// deja de ser legible aunque haga salto de linea; el maximo evita que una columna con
// texto realmente largo (ej. "Notas") deje sin espacio a las demas.
const ANCHO_MIN_ATRIBUTO = 70;
const ANCHO_MAX_ATRIBUTO = 220;

// Deben coincidir con la fuente/tamano/padding que usa pdfTable.js para dibujar las celdas
// de atributo - esto solo ESTIMA el ancho antes de dibujar nada, con la misma fuente real,
// para que la estimacion sea exacta y no un numero inventado.
const FUENTE_ATRIBUTO = 'Helvetica';
const TAMANO_ATRIBUTO = 8;
const PADDING_ATRIBUTO = 4;

// La celda ID alterna de fondo azul/rojo palido segun la posicion del registro dentro de la
// tabla de esa categoria (1ro azul, 2do rojo palido, 3ro azul...) para separar visualmente un
// registro del siguiente. Se dibuja aparte (ver idColumn en pdfTable.js/drawTable), como una
// sola casilla que abarca toda la altura del bloque del registro (fila principal + fila de
// continuacion si la tiene), no como una columna mas de la fila principal.
const COLOR_ID_IMPAR = { fondo: '#dbeafe', texto: '#1e3a8a' };
const COLOR_ID_PAR = { fondo: '#fecaca', texto: '#7f1d1d' };
const colorIdDe = (indice) => (indice % 2 === 0 ? COLOR_ID_IMPAR : COLOR_ID_PAR);

const ANCHO_ID = 40;
const COLUMNA_ID = () => ({
  key: 'idInventario',
  header: 'ID',
  width: ANCHO_ID,
  fontSize: 11,
  negrita: true,
  bgColorFn: (row, indice) => colorIdDe(indice).fondo,
  colorFn: (row, indice) => colorIdDe(indice).texto,
});

const COLUMNAS_FIJAS = () => [{ key: 'titulo', header: 'Título', width: 140 }, { key: 'autor', header: 'Autor', width: 95 }];

// "idioma", "anio", "edicion", "lugar" y "paginasImpresas" son campos comunes del
// catalogo (existen para cualquier categoria, ver catalog_model.js) y no campos
// propios de la categoria (esos van en categoriaDoc.campos) - por eso antes no
// salian en el PDF: construirColumnas solo recorria categoriaDoc.campos. Cada
// categoria puede apagar cualquiera de estos desde Gestion de Categorias
// (camposComunesDesactivados), asi que el reporte debe respetar esa misma regla.
const CAMPOS_COMUNES_OPCIONALES = [
  { clave: 'idioma', key: 'idioma', header: 'Idioma', width: 55 },
  { clave: 'anio', key: 'anio', header: 'Año', width: 40 },
  { clave: 'edicion', key: 'edicion', header: 'Edición', width: 65 },
  { clave: 'lugar', key: 'lugar', header: 'Lugar', width: 75 },
  { clave: 'paginasImpresas', key: 'paginasImpresas', header: 'Páginas', width: 50 },
];

// Estado fisico casi siempre es un dato corto ("Buen estado", "Regular", "Hojas manchadas"),
// asi que no deberia poder crecer tanto como Notas u otro atributo con texto de verdad largo -
// se le pone la mitad del tope normal: si algun registro trae algo excepcionalmente largo
// (ej. texto viejo de una importacion de antes de separar "Notas"), simplemente hace salto de
// linea en su celda en vez de ensanchar la columna entera.
const ANCHO_MAX_ESTADO_FISICO = Math.round(ANCHO_MAX_ATRIBUTO / 2);

const COLUMNA_ESTADO_REVISION = () => ({ key: 'estadoRevision', header: 'Estado', width: 65, render: estadoRevisionTexto });
const COLUMNA_ESTADO_FISICO = (doc, registros) => ({
  clave: 'estadoFisico',
  key: 'estadoFisico',
  header: 'Estado físico',
  width: anchoIdealParaValores(doc, 'Estado físico', registros.map((r) => r.estadoFisico), ANCHO_MAX_ESTADO_FISICO),
  anchoMaximo: ANCHO_MAX_ESTADO_FISICO,
  render: estadoFisicoTexto,
  colorFn: colorSiDanado,
});

// Columnas comunes (Idioma, Anio, Edicion, Lugar, Paginas) que esta categoria no
// desactivo. Estado (revision) y Estado fisico se devuelven aparte: Estado nunca ocupa mas
// de una linea ("Aprobado"/"Pendiente"/"Rechazado") asi que siempre va en la fila principal,
// pero Estado fisico se trata como un atributo mas (puede pasar a la fila de continuacion) -
// ver construirGruposColumnas.
function columnasComunesActivas(doc, categoriaDoc, registros) {
  const desactivados = categoriaDoc.camposComunesDesactivados || [];
  const opcionales = CAMPOS_COMUNES_OPCIONALES.filter((c) => !desactivados.includes(c.clave)).map(({ clave, ...columna }) => columna);
  const estadoFisico = desactivados.includes('estadoFisico') ? null : COLUMNA_ESTADO_FISICO(doc, registros);
  return { opcionales, estadoRevision: COLUMNA_ESTADO_REVISION(), estadoFisico };
}

// "Notas" (o "Nota") es el unico atributo de categoria pensado para texto libre y largo (a
// diferencia de Editorial/ISBN/Tipo de documento, que son un dato corto) - por eso, si la
// categoria lo tiene, se saca del reparto normal de atributos y se garantiza un lugar en la
// fila principal (ver construirGruposColumnas): asi comparte alto con el titulo/autor (que a
// veces tambien ocupan varias lineas) en vez de forzar una fila de continuacion aparte solo
// para el.
function esCampoNotas(campo) {
  const etiqueta = String(campo.etiqueta || '').trim().toLowerCase();
  return etiqueta === 'notas' || etiqueta === 'nota';
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

// El ancho de cada columna (de atributo, o Estado fisico) se mide contra su propio dato real
// (el percentil 75 entre los registros que se estan exportando en ese momento), en vez de un
// numero fijo adivinado - asi una columna con puros "N/A" o textos cortos queda angosta, y
// una con texto de verdad largo (ej. "Notas" con una descripcion) queda mas ancha, categoria
// por categoria. Se usa el percentil 75 y no el maximo absoluto a proposito: un solo dato
// excepcionalmente largo (ej. el nombre de UNA editorial rarisima entre 87 folletos) no
// deberia obligar a la columna entera a quedar ancha para todos los demas registros que
// tienen datos normales - ese caso raro simplemente hace salto de linea (el alto de fila ya
// se ajusta solo a eso, ver pdfTable.js), en vez de desperdiciar espacio en el resto de la
// tabla ni dejar afuera a otra columna que si cabria.
function anchoIdealParaValores(doc, etiqueta, valores, anchoMaximo = ANCHO_MAX_ATRIBUTO) {
  doc.font(FUENTE_ATRIBUTO).fontSize(TAMANO_ATRIBUTO);
  const anchoEtiqueta = doc.widthOfString(etiqueta || '');

  const anchos = valores
    .map((valor) => String(valor || 'N/A'))
    .map((valor) => doc.widthOfString(valor))
    .sort((a, b) => a - b);
  const indicePercentil75 = anchos.length > 0 ? Math.min(anchos.length - 1, Math.floor(anchos.length * 0.75)) : -1;
  const anchoTipico = indicePercentil75 >= 0 ? anchos[indicePercentil75] : 0;

  const anchoObjetivo = Math.max(anchoEtiqueta, anchoTipico);
  return Math.min(anchoMaximo, Math.max(ANCHO_MIN_ATRIBUTO, Math.ceil(anchoObjetivo) + PADDING_ATRIBUTO * 2));
}

function construirColumnasAtributos(doc, campos, registros) {
  return campos.map((campo) => ({
    key: `atributos.${campo.clave}`,
    header: campo.etiqueta,
    width: anchoIdealParaValores(doc, campo.etiqueta, registros.map((r) => r.atributos && r.atributos[campo.clave])),
    anchoMaximo: ANCHO_MAX_ATRIBUTO,
    render: (row) => (row.atributos && row.atributos[campo.clave]) || 'N/A',
  }));
}

// Arma una tabla principal (columnas garantizadas + tantos atributos como quepan en el
// ancho de la hoja) y, si sobran, una o mas tablas de continuacion debajo, cada una con su
// propio lote de columnas hasta agotarlos todos. Cada columna de atributo ya trae su ancho
// ideal medido contra su propio dato (ver anchoIdealParaAtributo), asi que aqui solo se
// decide CUANTAS caben completas en el espacio disponible - ninguna se aprieta por debajo de
// lo que su contenido necesita. La continuacion no repite Titulo/ID: como el bloque de un
// registro nunca se corta entre paginas, su fila de continuacion siempre queda pegada justo
// debajo de la principal, asi que repetir el titulo ahi solo duplicaba el dato sin ayudar a
// identificar nada.
//
// "Notas" va garantizado en la fila principal (ver esCampoNotas) y "Estado fisico" pasa a
// competir por espacio como un atributo mas - es lo opuesto al orden de antes, pero tiene mas
// sentido: "Notas" puede ser texto largo que conviene compartir alto con el titulo/autor, y
// "Estado fisico" casi siempre es corto ("Buen estado", "Regular"), asi que sufre menos si le
// toca la fila de continuacion cuando el espacio no alcanza para todo.
function construirGruposColumnas(doc, categoriaDoc, anchoDisponible, filas) {
  const { opcionales: comunesActivos, estadoRevision, estadoFisico } = columnasComunesActivas(doc, categoriaDoc, filas);
  const columnasFijas = COLUMNAS_FIJAS();
  const camposCategoria = categoriaDoc.campos || [];

  const campoNotas = camposCategoria.find(esCampoNotas);
  const otrosCampos = camposCategoria.filter((c) => c !== campoNotas);
  const columnaNotas = campoNotas ? construirColumnasAtributos(doc, [campoNotas], filas)[0] : null;

  const columnasGarantizadas = [...columnasFijas, ...comunesActivos, ...(columnaNotas ? [columnaNotas] : []), estadoRevision];
  const columnasOverflow = [...construirColumnasAtributos(doc, otrosCampos, filas), ...(estadoFisico ? [estadoFisico] : [])];

  if (columnasOverflow.length === 0) {
    return [columnasGarantizadas];
  }

  const anchoBase = sumaAnchos(columnasGarantizadas);

  // Se ordenan de mas angosta a mas ancha antes de repartir: para "cuantas entran completas
  // en el espacio que queda" (no cuanto VALEN, solo cuantas caben), empezar por las mas
  // angostas es matematicamente lo que mas columnas mete en la fila principal antes de
  // necesitar una de continuacion - justo lo que importa aqui (aprovechar la primera fila al
  // maximo). El orden en que se definieron los campos en Gestion de Categorias ya no decide
  // que va arriba y que se cae a la continuacion.
  const grupos = [];
  let restantes = [...columnasOverflow].sort((a, b) => a.width - b.width);
  let esPrimerGrupo = true;

  while (restantes.length > 0) {
    const anchoOcupado = esPrimerGrupo ? anchoBase : 0;
    const anchoLibre = Math.max(anchoDisponible - anchoOcupado, ANCHO_MIN_ATRIBUTO);

    // Se van tomando columnas en orden mientras quepan completas (con su propio ancho
    // ideal) - siempre al menos una, aunque se pase, para no trabarse en un loop infinito.
    const lote = [];
    let anchoUsado = 0;
    while (restantes.length > 0 && (lote.length === 0 || anchoUsado + restantes[0].width <= anchoLibre)) {
      const columna = restantes.shift();
      lote.push(columna);
      anchoUsado += columna.width;
    }

    // El sobrante de este lote solo se reparte cuando ya no queda NINGUN otro atributo
    // esperando turno - repartirlo antes estiraria una columna hasta llenar el hueco, aunque
    // el siguiente atributo en la lista si hubiera cabido ahi con su propio ancho ideal (eso
    // era el bug: una columna angosta terminaba "inflada" y le tapaba el lugar a la que
    // seguia, en vez de dejarla entrar). Solo en el ultimo lote no hay a quien cederle el
    // espacio, asi que ahi si tiene sentido repartirlo para no dejar un hueco en blanco.
    if (restantes.length === 0) {
      const sobrante = anchoLibre - anchoUsado;
      if (sobrante > 0) {
        // Cada columna respeta su propio tope (ej. Estado fisico no pasa de
        // ANCHO_MAX_ESTADO_FISICO aunque sobre espacio de mas) - no todas pueden
        // estirarse hasta el mismo maximo generico.
        const conEspacio = lote.filter((c) => c.width < (c.anchoMaximo ?? ANCHO_MAX_ATRIBUTO));
        if (conEspacio.length > 0) {
          const bonoPorColumna = sobrante / conEspacio.length;
          conEspacio.forEach((c) => {
            c.width = Math.min(c.anchoMaximo ?? ANCHO_MAX_ATRIBUTO, c.width + bonoPorColumna);
          });
        }
      }
    }

    grupos.push(esPrimerGrupo ? [...columnasGarantizadas, ...lote] : lote);
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
      .text('Biblioteca - Facultad de Ciencias Jurídicas y Sociales (USAC)', { align: 'center' });
    doc.font('Helvetica').fontSize(10).text('Reporte de catálogo', { align: 'center' });
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

      // El ancho de la columna ID se resta aparte porque ya no es una columna mas de
      // construirGruposColumnas - se dibuja aparte, a la izquierda de todo (ver idColumn).
      const anchoDisponible = doc.page.width - doc.page.margins.left - doc.page.margins.right - ANCHO_ID;
      const gruposColumnas = construirGruposColumnas(doc, categoriaDoc, anchoDisponible, filas);
      drawTable(doc, { x: doc.page.margins.left, columnGroups: gruposColumnas, rows: filas, idColumn: COLUMNA_ID() });
      doc.moveDown(1);
    }

    doc.end();
  } catch (err) {
    return next(err);
  }
}

module.exports = { exportCatalogPdf, construirGruposColumnas, ANCHO_MIN_ATRIBUTO, ANCHO_MAX_ATRIBUTO, ANCHO_MAX_ESTADO_FISICO, ANCHO_ID };
