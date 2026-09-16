const HEADER_FILL = '#1e3a8a';
const HEADER_TEXT = '#ffffff';
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

function drawTableHeader(doc, { x, y, columns }) {
  let cursorX = x;
  const width = columns.reduce((sum, col) => sum + col.width, 0);
  const alto = calcularAltoHeader(doc, columns);

  doc.rect(x, y, width, alto).fill(HEADER_FILL);
  doc.fillColor(HEADER_TEXT).font('Helvetica-Bold').fontSize(FONT_SIZE);

  columns.forEach((col) => {
    doc.text(col.header, cursorX + PADDING_X, y + PADDING_Y, { width: col.width - PADDING_X * 2 });
    cursorX += col.width;
  });

  return y + alto;
}

/**
 * Dibuja una tabla con bordes y encabezado repetido en cada pagina nueva.
 * Cada fila mide lo que necesite su contenido (nunca se recorta texto).
 * Devuelve la posicion Y final, para poder seguir escribiendo debajo.
 */
function drawTable(doc, { x, columns, rows }) {
  const bottomLimit = doc.page.height - doc.page.margins.bottom;
  const width = columns.reduce((sum, col) => sum + col.width, 0);

  let y = drawTableHeader(doc, { x, y: doc.y, columns });

  rows.forEach((row) => {
    const altoFila = calcularAltoFila(doc, columns, row);

    if (y + altoFila > bottomLimit) {
      doc.addPage();
      y = drawTableHeader(doc, { x, y: doc.page.margins.top, columns });
    }

    let cursorX = x;
    doc.rect(x, y, width, altoFila).strokeColor(BORDER_COLOR).stroke();

    columns.forEach((col) => {
      const valor = col.render ? col.render(row) : row[col.key] ?? 'N/A';
      doc
        .fillColor(col.colorFn ? col.colorFn(row) || ROW_TEXT : ROW_TEXT)
        .font('Helvetica')
        .fontSize(FONT_SIZE)
        .text(String(valor ?? 'N/A'), cursorX + PADDING_X, y + PADDING_Y, { width: col.width - PADDING_X * 2 });
      cursorX += col.width;
    });

    y += altoFila;
  });

  doc.y = y;
  doc.fillColor(ROW_TEXT);
  return y;
}

module.exports = { drawTable, DANGER_TEXT };
