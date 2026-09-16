const HEADER_FILL = '#1e3a8a';
const HEADER_TEXT = '#ffffff';
const HEADER_BORDER = '#0f172a';
const ROW_TEXT = '#0f172a';
const DANGER_TEXT = '#dc2626';
const BORDER_COLOR = '#e2e8f0';

const PADDING_X = 4;
const PADDING_Y = 4;
const FONT_SIZE = 8;
const ALTO_MIN_HEADER = 20;
const ALTO_MIN_FILA = 18;

// Sin limite de altura ni "ellipsis": el texto siempre se dibuja completo, con
// tantas lineas como necesite dentro del ancho de la columna. Por eso cada fila
// (y el encabezado) mide su alto real segun el contenido mas largo, en vez de
// usar una altura fija que recorte los valores.
function altoTexto(doc, texto, ancho, font) {
  doc.font(font).fontSize(FONT_SIZE);
  return doc.heightOfString(String(texto ?? ''), { width: ancho });
}

function calcularAltoHeader(doc, columns) {
  return columns.reduce((alto, col) => {
    const h = altoTexto(doc, col.header, col.width - PADDING_X * 2, 'Helvetica-Bold') + PADDING_Y * 2;
    return Math.max(alto, h);
  }, ALTO_MIN_HEADER);
}

function calcularAltoFila(doc, columns, row) {
  return columns.reduce((alto, col) => {
    const valor = col.render ? col.render(row) : row[col.key] ?? 'N/A';
    const h = altoTexto(doc, valor ?? 'N/A', col.width - PADDING_X * 2, 'Helvetica') + PADDING_Y * 2;
    return Math.max(alto, h);
  }, ALTO_MIN_FILA);
}

function anchoDe(columns) {
  return columns.reduce((sum, col) => sum + col.width, 0);
}

function drawTableHeader(doc, { x, y, columns }) {
  let cursorX = x;
  const width = anchoDe(columns);
  const alto = calcularAltoHeader(doc, columns);

  doc.rect(x, y, width, alto).fill(HEADER_FILL);
  doc.fillColor(HEADER_TEXT).font('Helvetica-Bold').fontSize(FONT_SIZE);

  columns.forEach((col) => {
    doc.text(col.header, cursorX + PADDING_X, y + PADDING_Y, { width: col.width - PADDING_X * 2 });
    cursorX += col.width;
  });

  // Contorno alrededor de cada casilla del encabezado (no solo del bloque
  // completo) para que cada columna resalte por separado dentro del azul.
  cursorX = x;
  doc.strokeColor(HEADER_BORDER).lineWidth(0.75);
  columns.forEach((col) => {
    doc.rect(cursorX, y, col.width, alto).stroke();
    cursorX += col.width;
  });

  return y + alto;
}

function drawFila(doc, { x, y, columns, row }) {
  const alto = calcularAltoFila(doc, columns, row);
  const width = anchoDe(columns);
  let cursorX = x;

  doc.rect(x, y, width, alto).strokeColor(BORDER_COLOR).stroke();

  columns.forEach((col) => {
    const valor = col.render ? col.render(row) : row[col.key] ?? 'N/A';
    doc
      .fillColor(col.colorFn ? col.colorFn(row) || ROW_TEXT : ROW_TEXT)
      .font('Helvetica')
      .fontSize(FONT_SIZE)
      .text(String(valor ?? 'N/A'), cursorX + PADDING_X, y + PADDING_Y, { width: col.width - PADDING_X * 2 });
    cursorX += col.width;
  });

  return y + alto;
}

// Encabezados de todos los grupos de columnas, uno debajo del otro (una sola vez,
// arriba de la tabla y de nuevo al inicio de cada pagina nueva).
function drawEncabezados(doc, { x, y, columnGroups }) {
  return columnGroups.reduce((cursorY, columns) => drawTableHeader(doc, { x, y: cursorY, columns }), y);
}

function altoEncabezados(doc, columnGroups) {
  return columnGroups.reduce((total, columns) => total + calcularAltoHeader(doc, columns), 0);
}

// Cuanto mide en total, verticalmente, el bloque completo de UN registro (todas
// sus filas, una por grupo de columnas).
function altoBloqueRegistro(doc, columnGroups, row) {
  return columnGroups.reduce((total, columns) => total + calcularAltoFila(doc, columns, row), 0);
}

/**
 * Dibuja una tabla donde cada registro puede tener mas de una fila (una por
 * grupo de columnas, ej. datos principales + atributos que no cupieron al
 * lado). El encabezado se repite justo arriba de CADA registro (no solo una
 * vez al inicio de la tabla) - asi cada libro queda como un bloque completo y
 * autocontenido, con sus columnas identificadas ahi mismo, sin tener que subir
 * la vista para saber que significa cada dato. Si el bloque completo de un
 * registro (encabezados + filas) no cabe en lo que queda de la pagina, se pasa
 * entero a la siguiente (nunca se parte a la mitad).
 * `columns` (un solo arreglo) tambien se acepta para tablas de un solo grupo.
 */
function drawTable(doc, { x, columns, columnGroups, rows }) {
  const grupos = columnGroups || [columns];
  const bottomLimit = doc.page.height - doc.page.margins.bottom;

  let y = doc.y;

  rows.forEach((row) => {
    const altoBloque = altoEncabezados(doc, grupos) + altoBloqueRegistro(doc, grupos, row);

    // Si el bloque completo (encabezados + registro) no cabe entero en lo que
    // queda de la pagina, se pasa a una nueva antes de dibujar nada - si no,
    // pdfkit corta cada celda que se sale del margen en su propia pagina en
    // blanco (una palabra por hoja), en vez de mover el bloque completo.
    if (y + altoBloque > bottomLimit) {
      doc.addPage();
      y = doc.page.margins.top;
    }

    y = drawEncabezados(doc, { x, y, columnGroups: grupos });

    grupos.forEach((cols) => {
      y = drawFila(doc, { x, y, columns: cols, row });
    });
  });

  doc.y = y;
  doc.fillColor(ROW_TEXT);
  return y;
}

module.exports = { drawTable, DANGER_TEXT };
