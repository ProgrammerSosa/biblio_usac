const HEADER_FILL = '#1e3a8a';
const HEADER_TEXT = '#ffffff';
const HEADER_BORDER = '#0f172a';
const ROW_TEXT = '#0f172a';
const DANGER_TEXT = '#dc2626';
const BORDER_COLOR = '#e2e8f0';
// Un registro dado de baja se dibuja completo en gris y con el texto tachado, sin importar el
// color que le tocaria por el patron normal (ejemplar/copia) - se nota de un vistazo que ya
// no esta disponible, sin tener que borrarlo del reporte. Un gris mas fuerte que BORDER_COLOR
// (que usa ese mismo tono claro para el borde de cualquier fila) para que la fila de baja se
// distinga de un vistazo y no parezca solo una fila con borde grueso.
const GRIS_BAJA_FONDO = '#cbd5e1';
const GRIS_BAJA_TEXTO = '#475569';
// Un registro rechazado se dibuja completo en rojo (sin tachar, a diferencia de dado de baja:
// todavia se puede corregir y volver a enviar) para que salte a la vista igual que un dado de
// baja, tambien sin importar el color que le tocaria por el patron ejemplar/copia.
const ROJO_RECHAZO_FONDO = '#fee2e2';
const ROJO_RECHAZO_TEXTO = '#991b1b';

const PADDING_X = 4;
const PADDING_Y = 4;
const FONT_SIZE = 8;
const ALTO_MIN_HEADER = 20;
const ALTO_MIN_FILA = 18;

// Un campo opcional puede llegar como null/undefined (nunca se lleno) o como
// string vacio "" (se lleno y se dejo en blanco, ej. al importar un Excel con
// esa celda sin nada) - los dos casos deben verse igual como "N/A" en vez de
// una celda muda que parece un error de la tabla.
function valorCelda(col, row) {
  const valor = col.render ? col.render(row) : row[col.key];
  if (valor === null || valor === undefined) return 'N/A';
  const texto = String(valor).trim();
  return texto === '' ? 'N/A' : valor;
}

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
  // Tiene que medir con la MISMA fuente con la que drawFila va a dibujar (ver mas abajo) -
  // Helvetica-Bold es un poco mas ancha, asi que si aqui se mide con la fuente equivocada el
  // texto real podria necesitar una linea mas de las que se calcularon y quedar recortado.
  const negritaForzada = !!estiloEspecialFila(row)?.tachado;
  return columns.reduce((alto, col) => {
    const fuente = col.negrita || negritaForzada ? 'Helvetica-Bold' : 'Helvetica';
    const h = altoTexto(doc, valorCelda(col, row), col.width - PADDING_X * 2, fuente) + PADDING_Y * 2;
    return Math.max(alto, h);
  }, ALTO_MIN_FILA);
}

function anchoDe(columns) {
  return columns.reduce((sum, col) => sum + col.width, 0);
}

// Estilo especial que manda sobre el patron normal (ejemplar/copia) para toda la fila/celda ID
// de un registro: dado de baja gana sobre rechazado si por algun motivo se dieran los dos
// (no deberia pasar: solo se puede dar de baja un Aprobado, ver darDeBaja en el backend).
function estiloEspecialFila(row) {
  if (row.deBaja) return { fondo: GRIS_BAJA_FONDO, colorTexto: GRIS_BAJA_TEXTO, tachado: true };
  if (row.estadoRevision === 'RECHAZADO') return { fondo: ROJO_RECHAZO_FONDO, colorTexto: ROJO_RECHAZO_TEXTO, tachado: false };
  return null;
}

function drawTableHeader(doc, { x, y, columns }) {
  let cursorX = x;
  const width = anchoDe(columns);
  const alto = calcularAltoHeader(doc, columns);

  doc.rect(x, y, width, alto).fill(HEADER_FILL);
  doc.fillColor(HEADER_TEXT).font('Helvetica-Bold').fontSize(FONT_SIZE);

  columns.forEach((col) => {
    doc.text(col.header, cursorX + PADDING_X, y + PADDING_Y, { width: col.width - PADDING_X * 2, align: col.align || 'left' });
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

function drawFila(doc, { x, y, columns, row, indice }) {
  const alto = calcularAltoFila(doc, columns, row);
  const width = anchoDe(columns);
  let cursorX = x;
  const estiloEspecial = estiloEspecialFila(row);

  if (estiloEspecial) {
    doc.rect(x, y, width, alto).fill(estiloEspecial.fondo);
  }
  doc.rect(x, y, width, alto).strokeColor(BORDER_COLOR).stroke();

  columns.forEach((col) => {
    // El texto tachado (dado de baja) va en negrita para que se siga leyendo bien encima de la
    // linea del tachado - sin esto la letra fina se pierde detras del strike.
    const fuente = col.negrita || estiloEspecial?.tachado ? 'Helvetica-Bold' : 'Helvetica';
    const tamano = col.fontSize || FONT_SIZE;
    const anchoTexto = col.width - PADDING_X * 2;
    const texto = String(valorCelda(col, row));
    const colorTexto = estiloEspecial ? estiloEspecial.colorTexto : col.colorFn ? col.colorFn(row, indice) || ROW_TEXT : ROW_TEXT;

    doc.font(fuente).fontSize(tamano);
    doc.fillColor(colorTexto).text(texto, cursorX + PADDING_X, y + PADDING_Y, {
      width: anchoTexto,
      align: col.align || 'left',
      strike: !!estiloEspecial?.tachado,
    });
    cursorX += col.width;
  });

  return y + alto;
}

// Dibuja una celda que ocupa TODA la altura que se le pase (el bloque completo de un
// registro, o el bloque completo del encabezado) en vez de una sola fila - la usa la columna
// ID para que se vea como una sola casilla que abarca la fila principal y la de continuacion
// (si la hay), y asi quede clarisimo a que registro pertenece cada una sin tener que repetir
// nada.
function drawCeldaAbarcada(doc, { x, y, width, alto, texto, fondo, colorTexto, fuente, tamano, tachado }) {
  doc.rect(x, y, width, alto).fill(fondo);
  doc.strokeColor(HEADER_BORDER).lineWidth(0.75).rect(x, y, width, alto).stroke();

  doc.font(fuente).fontSize(tamano);
  const anchoTexto = width - PADDING_X * 2;
  const altoTextoReal = doc.heightOfString(texto, { width: anchoTexto });
  const offsetY = Math.max(PADDING_Y, (alto - altoTextoReal) / 2);

  doc.fillColor(colorTexto).text(texto, x + PADDING_X, y + offsetY, { width: anchoTexto, align: 'center', strike: !!tachado });
}

// Encabezados de todos los grupos de columnas, uno debajo del otro (una sola vez,
// arriba de la tabla y de nuevo al inicio de cada pagina nueva).
function drawEncabezados(doc, { x, y, columnGroups }) {
  return columnGroups.reduce((cursorY, columns) => drawTableHeader(doc, { x, y: cursorY, columns }), y);
}

// Cuanto mide en total, verticalmente, el bloque completo de UN registro (todas
// sus filas, una por grupo de columnas).
function altoBloqueRegistro(doc, columnGroups, row) {
  return columnGroups.reduce((total, columns) => total + calcularAltoFila(doc, columns, row), 0);
}

/**
 * Dibuja una tabla donde cada registro puede tener mas de una fila (una por
 * grupo de columnas, ej. datos principales + atributos que no cupieron al
 * lado). El encabezado se dibuja una sola vez arriba de la tabla, como en
 * cualquier tabla normal, y se repite solo cuando la tabla continua en una
 * pagina nueva - repetirlo antes de cada registro duplicaba el espacio usado
 * sin aportar nada, porque las columnas son las mismas para todos los
 * registros de una misma categoria. Si el bloque de un registro no cabe en lo
 * que queda de la pagina, se pasa entero a la siguiente (nunca se parte a la
 * mitad).
 * `columns` (un solo arreglo) tambien se acepta para tablas de un solo grupo.
 * `idColumn` (opcional) se dibuja aparte, a la izquierda de todo lo demas,
 * como una sola casilla que abarca la altura completa del bloque (fila
 * principal + fila de continuacion si la hay) en vez de repetirse por fila -
 * asi queda clarisimo a que registro pertenece cada fila sin duplicar nada.
 * `tituloCategoria` (opcional) se repite arriba de la tabla de columnas en CADA pagina (la
 * primera y cualquier continuacion) - si las hojas impresas se desordenan o se separan de las
 * de otra categoria, cada una sigue diciendo por su cuenta de que categoria es.
 */
function drawTable(doc, { x, columns, columnGroups, rows, idColumn, tituloCategoria }) {
  const grupos = columnGroups || [columns];
  const bottomLimit = doc.page.height - doc.page.margins.bottom;
  const anchoId = idColumn ? idColumn.width : 0;
  const xContenido = x + anchoId;

  function dibujarEncabezadoCompleto(yInicio) {
    let y = yInicio;
    if (tituloCategoria) {
      doc.fillColor('#0f172a').font('Helvetica-Bold').fontSize(11).text(tituloCategoria, x, y);
      y = doc.y + 6;
    }
    const alto = drawEncabezados(doc, { x: xContenido, y, columnGroups: grupos }) - y;
    if (idColumn) {
      drawCeldaAbarcada(doc, {
        x,
        y,
        width: anchoId,
        alto,
        texto: idColumn.header,
        fondo: HEADER_FILL,
        colorTexto: HEADER_TEXT,
        fuente: 'Helvetica-Bold',
        tamano: FONT_SIZE,
      });
    }
    return y + alto;
  }

  let y = doc.y;
  y = dibujarEncabezadoCompleto(y);

  rows.forEach((row, indice) => {
    const altoBloque = altoBloqueRegistro(doc, grupos, row);

    // Si el registro no cabe entero en lo que queda de la pagina, se pasa a
    // una nueva antes de dibujar nada (nunca se corta a la mitad) y se repite
    // el encabezado ahi arriba - si no, pdfkit corta cada celda que se sale
    // del margen en su propia pagina en blanco (una palabra por hoja).
    if (y + altoBloque > bottomLimit) {
      doc.addPage();
      y = dibujarEncabezadoCompleto(doc.page.margins.top);
    }

    const yInicioRegistro = y;
    grupos.forEach((cols) => {
      y = drawFila(doc, { x: xContenido, y, columns: cols, row, indice });
    });

    if (idColumn) {
      const estiloEspecial = estiloEspecialFila(row);
      drawCeldaAbarcada(doc, {
        x,
        y: yInicioRegistro,
        width: anchoId,
        alto: y - yInicioRegistro,
        texto: String(valorCelda(idColumn, row)),
        fondo: estiloEspecial ? estiloEspecial.fondo : idColumn.bgColorFn ? idColumn.bgColorFn(row, indice) : '#ffffff',
        colorTexto: estiloEspecial ? estiloEspecial.colorTexto : idColumn.colorFn ? idColumn.colorFn(row, indice) || ROW_TEXT : ROW_TEXT,
        fuente: idColumn.negrita ? 'Helvetica-Bold' : 'Helvetica',
        tamano: idColumn.fontSize || FONT_SIZE,
        tachado: !!estiloEspecial?.tachado,
      });
    }

    // Linea gruesa y oscura entre un registro y el siguiente (mas marcada que el borde fino
    // de cada fila) para que se note de un vistazo donde termina un registro y empieza el
    // otro, sobre todo cuando tiene 2 filas (fila principal + atributos que no cupieron).
    const anchoRegistro = anchoId + anchoDe(grupos[0]);
    doc.moveTo(x, y).lineTo(x + anchoRegistro, y).lineWidth(1.5).strokeColor(HEADER_BORDER).stroke();
  });

  doc.y = y;
  doc.fillColor(ROW_TEXT);
  return y;
}

module.exports = { drawTable, DANGER_TEXT, GRIS_BAJA_FONDO, GRIS_BAJA_TEXTO, ROJO_RECHAZO_FONDO, ROJO_RECHAZO_TEXTO };
