const HEADER_HEIGHT = 22;
const ROW_HEIGHT = 20;
const HEADER_FILL = '#1e3a8a';
const HEADER_TEXT = '#ffffff';
const ROW_TEXT = '#0f172a';
const DANGER_TEXT = '#dc2626';
const BORDER_COLOR = '#e2e8f0';

function drawTableHeader(doc, { x, y, columns }) {
  let cursorX = x;
  const width = columns.reduce((sum, col) => sum + col.width, 0);

  doc.rect(x, y, width, HEADER_HEIGHT).fill(HEADER_FILL);
  doc.fillColor(HEADER_TEXT).font('Helvetica-Bold').fontSize(8);

  columns.forEach((col) => {
    doc.text(col.header, cursorX + 4, y + 7, { width: col.width - 8, height: HEADER_HEIGHT - 8, ellipsis: true });
    cursorX += col.width;
  });

  return y + HEADER_HEIGHT;
}

/**
 * Dibuja una tabla con bordes y encabezado repetido en cada pagina nueva.
 * Devuelve la posicion Y final, para poder seguir escribiendo debajo.
 */
function drawTable(doc, { x, columns, rows }) {
  const bottomLimit = doc.page.height - doc.page.margins.bottom;
  const width = columns.reduce((sum, col) => sum + col.width, 0);

  let y = drawTableHeader(doc, { x, y: doc.y, columns });

  rows.forEach((row) => {
    if (y + ROW_HEIGHT > bottomLimit) {
      doc.addPage();
      y = drawTableHeader(doc, { x, y: doc.page.margins.top, columns });
    }

    let cursorX = x;
    doc.rect(x, y, width, ROW_HEIGHT).strokeColor(BORDER_COLOR).stroke();

    columns.forEach((col) => {
      const valor = col.render ? col.render(row) : row[col.key] ?? 'N/A';
      doc
        .fillColor(col.colorFn ? col.colorFn(row) || ROW_TEXT : ROW_TEXT)
        .font('Helvetica')
        .fontSize(8)
        .text(String(valor ?? 'N/A'), cursorX + 4, y + 6, { width: col.width - 8, height: ROW_HEIGHT - 6, ellipsis: true });
      cursorX += col.width;
    });

    y += ROW_HEIGHT;
  });

  doc.y = y;
  doc.fillColor(ROW_TEXT);
  return y;
}

module.exports = { drawTable, DANGER_TEXT };
