const PDFDocument = require('pdfkit');
const Catalog = require('../catalog/catalog_model');
const Category = require('../catalog/category_model');
const { filtroVisibilidadBorradores } = require('../catalog/catalog_controller');
const { registrarAuditoria } = require('../audit/audit_service');
const { ACCIONES_AUDITORIA, tieneDanoFisico } = require('../../utils/constants');
const { drawTable, DANGER_TEXT, GRIS_BAJA_FONDO, ROJO_RECHAZO_FONDO } = require('../../helpers/pdfTable');
const { resolverOrden } = require('../../helpers/catalogSort');
const { escapeRegExp } = require('../../helpers/regex');
const { claveDeGrupo, normalizarTexto } = require('../../helpers/catalogGroup');
const { fail } = require('../../utils/httpResponse');

const ESTADO_LABELS = {
  PENDIENTE: 'Pendiente',
  APROBADO: 'Aprobado',
  RECHAZADO: 'Rechazado',
};

// En la columna Estado del reporte se usa una sola letra (para que quepa mas en una fila) en
// vez de la palabra completa - se explica en la leyenda del encabezado (dibujarLeyendaColores).
// "DB" manda sobre lo que sea que diga estadoRevision: un registro dado de baja siempre fue
// Aprobado antes, pero para el reporte lo que importa mostrar es que ya no esta disponible.
const ESTADO_LETRAS = {
  PENDIENTE: 'P',
  APROBADO: 'A',
  RECHAZADO: 'D',
};

// Tamaño de hoja real medido por el usuario: 33 x 21.5cm (no 8.5x14in/35.6x21.6cm que se
// habia usado antes - esa medida no coincidia con el papel oficio real que se esta imprimiendo,
// causaba los problemas de margenes/recorte al imprimir). Va en formato "portrait" [corto,
// largo] porque layout:'landscape' abajo invierte width/height.
const CM_A_PUNTOS = 28.3465;
const TAMANO_PAGINA_OFICIO = [21.5 * CM_A_PUNTOS, 33 * CM_A_PUNTOS];

// Margen parejo de 1cm en los 4 lados (arriba, abajo, izquierda, derecha). Los intentos
// anteriores de calcular un ancho de tabla "exacto" en cm (30cm, luego 33cm) y de correr el
// bloque hacia la izquierda nunca terminaban de coincidir con lo que salia impreso de verdad
// (la impresora/el driver de la impresora no necesariamente respeta el tamaño de hoja del PDF
// al pie de la letra) - un margen parejo y chico en los 4 lados es mas simple y mas facil de
// verificar con una regla. anchoDisponible y bottomLimit se calculan siempre a partir de
// doc.page.margins, asi que la tabla (ancho Y alto) crece sola para aprovechar TODO lo que
// quede - mas alto disponible tambien significa que entran mas registros antes de necesitar
// una pagina nueva.
const MARGEN_PAGINA = 1 * CM_A_PUNTOS;

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

// La celda ID se colorea segun si el registro es el primer ejemplar detectado de su material
// o una copia de uno que ya aparecio antes (misma regla de "son copias" que ya usa Catalogo y
// el import de Excel - ver claveDeGrupo). El primer ejemplar de cada material sigue el patron
// alternado azul/rojo palido; cualquier copia se marca aparte, en amarillo palido, sin
// importar en que posicion del reporte caiga. Se dibuja aparte (ver idColumn en
// pdfTable.js/drawTable), como una sola casilla que abarca toda la altura del bloque del
// registro (fila principal + fila de continuacion si la tiene), no como una columna mas.
const COLOR_EJEMPLAR_A = { fondo: '#dbeafe', texto: '#1e3a8a' }; // azul
const COLOR_EJEMPLAR_B = { fondo: '#fecaca', texto: '#7f1d1d' }; // rojo palido
const COLOR_COPIA = { fondo: '#fef9c3', texto: '#713f12' }; // amarillo palido

// Recorre los registros en el mismo orden en que se van a dibujar y le asigna a cada uno su
// color: la primera vez que aparece una clave de material es un ejemplar nuevo (alterna entre
// los 2 colores segun cuantos ejemplares distintos van vistos, sin contar las copias); la
// segunda vez (y siguientes) que aparece esa misma clave es una copia, siempre amarillo
// palido. Se calcula una sola vez para todo el reporte, antes de agrupar por categoria.
function calcularColoresPorRegistro(registros) {
  const colores = new Map();
  const clavesVistas = new Set();
  let contadorEjemplares = 0;

  for (const registro of registros) {
    const clave = claveDeGrupo(registro);
    if (clavesVistas.has(clave)) {
      colores.set(String(registro._id), COLOR_COPIA);
      continue;
    }
    clavesVistas.add(clave);
    colores.set(String(registro._id), contadorEjemplares % 2 === 0 ? COLOR_EJEMPLAR_A : COLOR_EJEMPLAR_B);
    contadorEjemplares += 1;
  }

  return colores;
}

const ANCHO_ID = 40;
const COLUMNA_ID = (coloresPorRegistro) => ({
  key: 'idInventario',
  header: 'ID',
  width: ANCHO_ID,
  fontSize: 11,
  negrita: true,
  bgColorFn: (row) => (coloresPorRegistro.get(String(row._id)) || COLOR_EJEMPLAR_A).fondo,
  colorFn: (row) => (coloresPorRegistro.get(String(row._id)) || COLOR_EJEMPLAR_A).texto,
});

// Con la hoja real (33 x 21.5cm) la tabla queda en 31cm - un poco mas angosta que antes. 125 y
// 85 son el TOPE maximo de Titulo/Autor (antes eran fijos) - igual que con los campos comunes
// (ver camposComunesOpcionales), si el dato real es mas corto se achican solas y le devuelven
// ese espacio a los atributos propios de la categoria, que son los que mas lo necesitan para
// no caerse a una fila de continuacion.
const ANCHO_MAX_TITULO = 125;
const ANCHO_MAX_AUTOR = 85;
const COLUMNAS_FIJAS = (doc, registros) => [
  { key: 'titulo', header: 'Título', width: anchoIdealParaValores(doc, 'Título', registros.map((r) => r.titulo), ANCHO_MAX_TITULO) },
  { key: 'autor', header: 'Autor', width: anchoIdealParaValores(doc, 'Autor', registros.map((r) => r.autor), ANCHO_MAX_AUTOR) },
];

// Año en que el registro se creo en el sistema (no confundir con "Año", que es el año de
// publicacion del material y es un dato que se escribe a mano). Sale de createdAt, que
// Mongoose ya pone solo (timestamps: true) - por eso va como columna fija siempre visible,
// igual que Estado, y no como un campo comun mas que cada categoria pueda apagar.
const COLUMNA_ANIO_REGISTRO = () => ({
  key: 'anioRegistro',
  header: 'Año reg.',
  width: 40,
  align: 'center',
  render: (row) => (row.createdAt ? new Date(row.createdAt).getFullYear() : 'N/A'),
});

// Sigla de 3 letras para los idiomas mas comunes en la biblioteca - se busca por el nombre
// normalizado (sin acentos, minuscula) para que "Español"/"español"/"Espanol" den lo mismo.
// Un idioma que no este en la tabla simplemente usa sus primeras 3 letras en mayuscula, para
// no dejar la celda vacia ni tener que actualizar esta lista para cada idioma nuevo que
// aparezca.
const ABREVIATURAS_IDIOMA = {
  espanol: 'ESP',
  ingles: 'ING',
  frances: 'FRA',
  aleman: 'ALE',
  italiano: 'ITA',
  portugues: 'POR',
  latin: 'LAT',
  ruso: 'RUS',
  chino: 'CHI',
  japones: 'JAP',
  arabe: 'ARA',
  bilingue: 'BIL',
};

function abreviarIdioma(idioma) {
  const texto = String(idioma || '').trim();
  if (!texto) return 'N/A';
  const abreviatura = ABREVIATURAS_IDIOMA[normalizarTexto(texto)];
  return abreviatura || texto.slice(0, 3).toUpperCase();
}

// "idioma", "anio", "edicion", "lugar" y "paginasImpresas" son campos comunes del
// catalogo (existen para cualquier categoria, ver catalog_model.js) y no campos
// propios de la categoria (esos van en categoriaDoc.campos) - por eso antes no
// salian en el PDF: construirColumnas solo recorria categoriaDoc.campos. Cada
// categoria puede apagar cualquiera de estos desde Gestion de Categorias
// (camposComunesDesactivados), asi que el reporte debe respetar esa misma regla.
// Idioma, Estado y Paginas salen abreviados (sigla de 3 letras, letra unica, "Pag.") a
// proposito - la meta es que un registro use una sola fila lo mas seguido posible.
// El ancho de cada una ya NO es un numero fijo: se mide contra el dato real (igual que un
// atributo, ver anchoIdealParaValores) con el numero de antes como TOPE maximo, nunca minimo -
// asi nunca ocupan mas de lo que ocupaban antes (cero riesgo de regresion), pero cuando el dato
// real es corto (ej. "ESP", "2026", "3ra") le devuelven ese espacio de sobra a los atributos
// propios de la categoria, que son los que de verdad varian de una categoria a otra y los que
// mas necesitan el espacio para no caerse a una fila de continuacion (ver COLUMNAS_FIJAS, mismo
// tope-como-maximo para Titulo/Autor).
const CAMPOS_COMUNES_OPCIONALES_DEF = [
  { clave: 'idioma', key: 'idioma', header: 'Idioma', anchoMinimo: 20, anchoMaximo: 32, render: (row) => abreviarIdioma(row.idioma) },
  { clave: 'anio', key: 'anio', header: 'Año', anchoMinimo: 24, anchoMaximo: 40 },
  { clave: 'edicion', key: 'edicion', header: 'Edición', anchoMinimo: 30, anchoMaximo: 65 },
  { clave: 'lugar', key: 'lugar', header: 'Lugar', anchoMinimo: 40, anchoMaximo: 75 },
  { clave: 'paginasImpresas', key: 'paginasImpresas', header: 'Pag.', anchoMinimo: 24, anchoMaximo: 35 },
];

function camposComunesOpcionales(doc, registros, defs) {
  return defs.map((campo) => {
    const valores = registros.map((r) => (campo.render ? campo.render(r) : r[campo.key]));
    return {
      clave: campo.clave,
      key: campo.key,
      header: campo.header,
      render: campo.render,
      width: anchoIdealParaValores(doc, campo.header, valores, campo.anchoMaximo, campo.anchoMinimo),
    };
  });
}

// Estado fisico casi siempre es un dato corto ("Buen estado", "Regular", "Hojas manchadas"),
// asi que no deberia poder crecer tanto como Notas u otro atributo con texto de verdad largo -
// se le pone la mitad del tope normal: si algun registro trae algo excepcionalmente largo
// (ej. texto viejo de una importacion de antes de separar "Notas"), simplemente hace salto de
// linea en su celda en vez de ensanchar la columna entera.
const ANCHO_MAX_ESTADO_FISICO = Math.round(ANCHO_MAX_ATRIBUTO / 2);

const COLUMNA_ESTADO_REVISION = () => ({ key: 'estadoRevision', header: 'Est.', width: 28, align: 'center', render: estadoRevisionTexto });
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
// desactivo. Estado (revision) y Estado fisico se devuelven aparte: los 2 van garantizados en
// la fila principal (ver construirGruposColumnas) - ninguno de los 2 compite por espacio con
// los atributos propios de la categoria.
function columnasComunesActivas(doc, categoriaDoc, registros) {
  const desactivados = categoriaDoc.camposComunesDesactivados || [];
  const defsActivos = CAMPOS_COMUNES_OPCIONALES_DEF.filter((c) => !desactivados.includes(c.clave));
  const opcionales = camposComunesOpcionales(doc, registros, defsActivos);
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

// Orden fijo para categorias "variante" (ej. materiales con un sello especial) que agrupan
// libros/revistas/folletos/publicaciones bajo una categoria propia, usando su campo "Tipo de
// documento" para decir cual es cual - ver ordenarFilasPorTipoDocumentoSiAplica.
const ORDEN_TIPO_DOCUMENTO = {
  libro: 1,
  revista: 2,
  folleto: 3,
  'publicaciones institucionales': 4,
};

function esCampoTipoDocumento(campo) {
  return normalizarTexto(campo.etiqueta) === 'tipo de documento';
}

// Si la categoria tiene "ordenarPorTipoDocumento" activo (ver Gestion de Categorias) y tiene un
// campo "Tipo de documento", sus filas en el reporte no van en el orden normal - se reordenan
// segun ese valor (Libro, Revista, Folleto, Publicaciones Institucionales, en ese orden fijo).
// Un valor que no coincide con ninguno de los 4 (o que esta vacio) se manda al final, sin
// romper nada. Si la categoria no tiene el campo, o no tiene el check activo, las filas se
// quedan en el orden que ya traian (no se toca nada).
function ordenarFilasPorTipoDocumentoSiAplica(categoriaDoc, filas) {
  if (!categoriaDoc.ordenarPorTipoDocumento) return filas;
  const campoTipoDocumento = (categoriaDoc.campos || []).find(esCampoTipoDocumento);
  if (!campoTipoDocumento) return filas;

  const rangoDe = (fila) => {
    const valor = normalizarTexto(fila.atributos && fila.atributos[campoTipoDocumento.clave]);
    return ORDEN_TIPO_DOCUMENTO[valor] ?? Number.MAX_SAFE_INTEGER;
  };
  return [...filas].sort((a, b) => rangoDe(a) - rangoDe(b));
}

const colorSiDanado = (row) => (tieneDanoFisico(row.estadoFisico) ? DANGER_TEXT : null);
const estadoFisicoTexto = (row) => row.estadoFisico || 'N/A';
const estadoRevisionTexto = (row) => (row.deBaja ? 'DB' : ESTADO_LETRAS[row.estadoRevision] || row.estadoRevision);
const sumaAnchos = (columnas) => columnas.reduce((sum, col) => sum + col.width, 0);

// Convierte "2024" en un rango [1 ene 2024, 1 ene 2025) para filtrar por createdAt - el mismo
// dato que muestra COLUMNA_ANIO_REGISTRO. Un valor invalido o vacio simplemente no filtra.
function rangoDeAnio(anioTexto) {
  const anio = parseInt(anioTexto, 10);
  if (!anioTexto || Number.isNaN(anio)) return null;
  return { $gte: new Date(Date.UTC(anio, 0, 1)), $lt: new Date(Date.UTC(anio + 1, 0, 1)) };
}

// Si el registro esta dado de baja o fue rechazado, "Notas" deja de mostrar el atributo libre
// que haya escrito quien lo registro y en su lugar muestra el motivo (dar de baja) o la
// observacion de rechazo - es el dato que de verdad importa leer ahi para ese registro, y asi
// no hay que ir a buscarlo aparte. Para cualquier otro registro se comporta como siempre.
function textoNotas(row, clave) {
  if (row.deBaja) return row.motivoBaja || 'N/A';
  if (row.estadoRevision === 'RECHAZADO') return row.observaciones || 'N/A';
  return (row.atributos && row.atributos[clave]) || 'N/A';
}

// Leyenda debajo de los filtros: colores del ID con muestra de color de verdad (no solo el
// nombre) y que significa cada letra de la columna Estado - para que quede claro de un vistazo
// sin tener que adivinar ni perderse al leer la tabla.
function dibujarLeyendaColores(doc, x, y) {
  const ladoMuestra = 9;

  function dibujarFila(yFila, etiqueta, items) {
    doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#475569').text(etiqueta, x, yFila - 1);
    let cursorX = x + doc.widthOfString(etiqueta) + 4;

    doc.font('Helvetica').fontSize(7.5);
    items.forEach((item) => {
      if (item.color) {
        doc.rect(cursorX, yFila, ladoMuestra, ladoMuestra).fill(item.color);
        doc.strokeColor('#94a3b8').lineWidth(0.5).rect(cursorX, yFila, ladoMuestra, ladoMuestra).stroke();
        cursorX += ladoMuestra + 3;
      }
      doc.fillColor('#475569').text(item.texto, cursorX, yFila - 1);
      cursorX += doc.widthOfString(item.texto) + 14;
    });

    return yFila + ladoMuestra + 6;
  }

  let cursorY = dibujarFila(y, 'Colores del ID (alterna por material): ', [
    { color: COLOR_EJEMPLAR_A.fondo, texto: 'Ejemplar' },
    { color: COLOR_EJEMPLAR_B.fondo, texto: 'Ejemplar' },
    { color: COLOR_COPIA.fondo, texto: 'Copia (mismo material, otro ejemplar fisico)' },
    { color: GRIS_BAJA_FONDO, texto: 'Dado de baja (fila completa, texto tachado)' },
    { color: ROJO_RECHAZO_FONDO, texto: 'Rechazado (fila completa)' },
  ]);

  cursorY = dibujarFila(cursorY, 'Estado: ', [
    { texto: 'A = Aprobado' },
    { texto: 'D = Rechazado' },
    { texto: 'P = Pendiente' },
    { texto: 'DB = Dado de baja' },
  ]);

  return cursorY;
}

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
// anchoMinimo es distinto de ANCHO_MIN_ATRIBUTO (70pt, pensado para un atributo de categoria
// con texto arbitrario) - las columnas comunes cortas (Idioma, Año, Pag.) tienen un dato
// estructuralmente corto (una sigla, un numero) y su propio tope maximo ya es menor a 70, asi
// que necesitan su propio minimo mas chico para poder achicarse de verdad en vez de quedarse
// siempre en su tope (ver camposComunesOpcionales).
function anchoIdealParaValores(doc, etiqueta, valores, anchoMaximo = ANCHO_MAX_ATRIBUTO, anchoMinimo = ANCHO_MIN_ATRIBUTO) {
  doc.font(FUENTE_ATRIBUTO).fontSize(TAMANO_ATRIBUTO);
  const anchoEtiqueta = doc.widthOfString(etiqueta || '');

  const anchos = valores
    .map((valor) => String(valor || 'N/A'))
    .map((valor) => doc.widthOfString(valor))
    .sort((a, b) => a - b);
  const indicePercentil75 = anchos.length > 0 ? Math.min(anchos.length - 1, Math.floor(anchos.length * 0.75)) : -1;
  const anchoTipico = indicePercentil75 >= 0 ? anchos[indicePercentil75] : 0;

  const anchoObjetivo = Math.max(anchoEtiqueta, anchoTipico);
  return Math.min(anchoMaximo, Math.max(anchoMinimo, Math.ceil(anchoObjetivo) + PADDING_ATRIBUTO * 2));
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

// Reparte el sobrante entre las columnas de un lote respetando el tope de cada una - pero a
// diferencia de un simple "a cada quien le toca sobrante/n", lo hace en rondas: si el tope de
// una columna no le deja usar toda su parte pareja, lo que le sobro a ELLA se vuelve a repartir
// entre las que todavia tengan espacio, en vez de perderse. Sin esto, una sola columna ya cerca
// de su tope (ej. Estado fisico, con un tope bajo) le "robaba" sobrante a las demas sin poder
// usarlo, y ese pedazo quedaba en blanco aunque otra columna del mismo lote si lo hubiera
// podido aprovechar.
function repartirSobrante(lote, sobranteInicial) {
  let sobrante = sobranteInicial;
  let candidatas = lote.filter((c) => c.width < (c.anchoMaximo ?? ANCHO_MAX_ATRIBUTO));

  while (sobrante > 0.01 && candidatas.length > 0) {
    const bonoPorColumna = sobrante / candidatas.length;
    let usado = 0;
    candidatas.forEach((c) => {
      const tope = c.anchoMaximo ?? ANCHO_MAX_ATRIBUTO;
      const bono = Math.min(bonoPorColumna, tope - c.width);
      c.width += bono;
      usado += bono;
    });
    sobrante -= usado;
    candidatas = candidatas.filter((c) => c.width < (c.anchoMaximo ?? ANCHO_MAX_ATRIBUTO));
  }
}

// Minimo al que se puede comprimir cada columna cuando los anchos ideales no caben en una sola
// fila (ver comprimirAnchos). Titulo/Autor/Estado fisico son las unicas columnas garantizadas que
// se comprimen (las comunes, como Idioma o Año, ya son angostas); cualquier atributo de
// categoria baja hasta ANCHO_MIN_ATRIBUTO.
const MINIMO_AL_COMPRIMIR = { titulo: 80, autor: 60, estadoFisico: ANCHO_MIN_ATRIBUTO };
const minimoAlComprimir = (columna) => MINIMO_AL_COMPRIMIR[columna.key] ?? ANCHO_MIN_ATRIBUTO;

// Le quita "excedente" puntos de ancho a las columnas dadas, empezando por las mas anchas (un
// mismo tope baja de a poco hasta que lo recortado alcanza), sin dejar ninguna por debajo de su
// minimo. Devuelve false SIN tocar nada si ni con todas al minimo se llega - en ese caso el
// llamador tiene que usar la fila de continuacion en vez de apretar las columnas hasta que el
// texto sea ilegible.
function comprimirAnchos(columnas, excedente) {
  const holgura = columnas.reduce((suma, c) => suma + Math.max(0, c.width - minimoAlComprimir(c)), 0);
  if (excedente > holgura) return false;

  const anchoTotal = sumaAnchos(columnas);
  let bajo = 0;
  let alto = Math.max(...columnas.map((c) => c.width));
  for (let i = 0; i < 40; i++) {
    const tope = (bajo + alto) / 2;
    const comprimido = columnas.reduce((suma, c) => suma + Math.max(minimoAlComprimir(c), Math.min(c.width, tope)), 0);
    if (anchoTotal - comprimido > excedente) bajo = tope;
    else alto = tope;
  }

  columnas.forEach((c) => {
    c.width = Math.max(minimoAlComprimir(c), Math.min(c.width, alto));
  });
  return true;
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
// "Notas" va garantizado en la fila principal (ver esCampoNotas), pero al final de todo -
// despues incluso de los atributos que si cupieron - para que sea lo ultimo que se lee de
// cada registro. "Estado fisico" tambien va garantizado (ver columnasComunesActivas): antes
// competia por espacio como un atributo mas y en la practica eso hacia que CASI todo registro
// necesitara una fila de continuacion solo para el (es un dato casi universal, casi siempre
// corto), asi que se saco del reparto para que la fila principal alcance sola con mas
// frecuencia - solo los atributos propios de la categoria (los que de verdad varian mucho de
// una a otra) compiten por lo que quede del espacio.
function construirGruposColumnas(doc, categoriaDoc, anchoDisponible, filas) {
  const { opcionales: comunesActivos, estadoRevision, estadoFisico } = columnasComunesActivas(doc, categoriaDoc, filas);
  const columnasFijas = COLUMNAS_FIJAS(doc, filas);
  const camposCategoria = categoriaDoc.campos || [];

  const campoNotas = camposCategoria.find(esCampoNotas);
  const otrosCampos = camposCategoria.filter((c) => c !== campoNotas);
  const columnaNotas = campoNotas
    ? { ...construirColumnasAtributos(doc, [campoNotas], filas)[0], render: (row) => textoNotas(row, campoNotas.clave) }
    : null;
  const columnasNotasFinal = columnaNotas ? [columnaNotas] : [];

  const columnasGarantizadas = [
    ...columnasFijas,
    ...comunesActivos,
    ...(estadoFisico ? [estadoFisico] : []),
    estadoRevision,
    COLUMNA_ANIO_REGISTRO(),
  ];
  const columnasOverflow = construirColumnasAtributos(doc, otrosCampos, filas);

  // Un registro = una fila (pedido del cliente). Si con los anchos ideales no caben todas las
  // columnas, en vez de mandar atributos a una fila de continuacion se comprimen las mas anchas
  // (el texto hace salto de linea dentro de su celda y la fila crece en alto, pero sigue siendo
  // una sola fila). La continuacion de mas abajo queda solo para cuando ni al minimo caben.
  const excedente = sumaAnchos(columnasGarantizadas) + sumaAnchos(columnasNotasFinal) + sumaAnchos(columnasOverflow) - anchoDisponible;
  if (excedente > 0) {
    const atributosPorAncho = [...columnasOverflow].sort((a, b) => a.width - b.width);
    const comprimibles = [
      ...columnasGarantizadas.filter((c) => c.key in MINIMO_AL_COMPRIMIR),
      ...columnasOverflow,
      ...columnasNotasFinal,
    ];
    if (comprimirAnchos(comprimibles, excedente)) {
      return [[...columnasGarantizadas, ...atributosPorAncho, ...columnasNotasFinal]];
    }
  }

  if (columnasOverflow.length === 0) {
    // Sin atributos que reparar en una fila de continuacion, "Notas" (si la categoria la
    // tiene) es la unica columna de esta fila que puede aprovechar el espacio que sobre -
    // antes esto se saltaba por completo y todo lo que sobraba quedaba en blanco.
    const sobrante = anchoDisponible - sumaAnchos(columnasGarantizadas) - sumaAnchos(columnasNotasFinal);
    if (sobrante > 0 && columnasNotasFinal.length > 0) repartirSobrante(columnasNotasFinal, sobrante);
    return [[...columnasGarantizadas, ...columnasNotasFinal]];
  }

  const anchoBase = sumaAnchos(columnasGarantizadas) + sumaAnchos(columnasNotasFinal);

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
    // "Notas" entra al reparto solo cuando este lote es el primer grupo (es la unica vez que
    // va pegada a el, ver mas abajo) - si no, ya se dibujo en un grupo anterior y su ancho
    // quedo fijo.
    if (restantes.length === 0) {
      const sobrante = anchoLibre - anchoUsado;
      if (sobrante > 0) repartirSobrante(esPrimerGrupo ? [...lote, ...columnasNotasFinal] : lote, sobrante);
    }

    grupos.push(esPrimerGrupo ? [...columnasGarantizadas, ...lote, ...columnasNotasFinal] : lote);
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

// "orden" es el que la Manager configura desde Gestion de Categorias para decidir en que
// secuencia van las categorias en el reporte (ej. Libro, Revista, Folleto...) - nombre solo
// desempata cuando 2 categorias quedan con el mismo orden (todas en 0 por defecto).
function categoriasOrdenadasParaReporte(claves) {
  return Category.find({ clave: { $in: claves } }).sort({ orden: 1, nombre: 1 });
}

async function exportCatalogPdf(req, res, next) {
  try {
    const { estadoRevision, categoria, buscar, registradoPor, anioRegistro, sort } = req.query;

    const filtro = { eliminado: false };
    if (estadoRevision === 'DE_BAJA') {
      filtro.deBaja = true;
    } else if (estadoRevision) {
      filtro.estadoRevision = estadoRevision;
    }
    if (categoria) filtro.categoria = categoria;
    if (registradoPor) filtro.registradoPor = registradoPor;
    const rangoAnioRegistro = rangoDeAnio(anioRegistro);
    if (rangoAnioRegistro) filtro.createdAt = rangoAnioRegistro;

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
    const categorias = await categoriasOrdenadasParaReporte([...grupos.keys()]);
    const coloresPorRegistro = calcularColoresPorRegistro(registros);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${nombreArchivoPdf()}"`);

    const doc = new PDFDocument({
      margin: MARGEN_PAGINA,
      size: TAMANO_PAGINA_OFICIO,
      layout: 'landscape',
    });
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
          estadoRevision === 'DE_BAJA' ? 'De baja' : estadoRevision ? ESTADO_LABELS[estadoRevision] : 'todos'
        }${rangoAnioRegistro ? `, año de registro=${anioRegistro}` : ''}${
          buscar && buscar.trim() ? `, busqueda="${buscar.trim()}"` : ''
        }  |  Total: ${registros.length}`
      );
    doc.moveDown(0.4);
    doc.y = dibujarLeyendaColores(doc, doc.page.margins.left, doc.y);
    doc.moveDown(1);

    // Cada categoria empieza en una hoja nueva (nunca comparte pagina con la anterior, aunque
    // le hubiera quedado espacio) - a pedido del usuario, para poder separar el reporte impreso
    // en un folder por categoria sin tener que cortar ninguna hoja a la mitad.
    let esPrimeraCategoriaDibujada = true;
    for (const categoriaDoc of categorias) {
      const filasCategoria = grupos.get(categoriaDoc.clave) || [];
      if (filasCategoria.length === 0) continue;
      const filas = ordenarFilasPorTipoDocumentoSiAplica(categoriaDoc, filasCategoria);

      if (!esPrimeraCategoriaDibujada) {
        doc.addPage();
      }
      esPrimeraCategoriaDibujada = false;

      // El ancho de la columna ID se resta aparte porque ya no es una columna mas de
      // construirGruposColumnas - se dibuja aparte, a la izquierda de todo (ver idColumn).
      const anchoDisponible = doc.page.width - doc.page.margins.left - doc.page.margins.right - ANCHO_ID;
      const gruposColumnas = construirGruposColumnas(doc, categoriaDoc, anchoDisponible, filas);
      drawTable(doc, {
        x: doc.page.margins.left,
        columnGroups: gruposColumnas,
        rows: filas,
        idColumn: COLUMNA_ID(coloresPorRegistro),
        tituloCategoria: `${categoriaDoc.nombre} (${filas.length})`,
      });
      doc.moveDown(1);
    }

    doc.end();
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  exportCatalogPdf,
  construirGruposColumnas,
  categoriasOrdenadasParaReporte,
  ordenarFilasPorTipoDocumentoSiAplica,
  repartirSobrante,
  comprimirAnchos,
  calcularColoresPorRegistro,
  ANCHO_MIN_ATRIBUTO,
  ANCHO_MAX_ATRIBUTO,
  ANCHO_MAX_ESTADO_FISICO,
  ANCHO_ID,
  COLOR_EJEMPLAR_A,
  COLOR_EJEMPLAR_B,
  COLOR_COPIA,
  TAMANO_PAGINA_OFICIO,
  MARGEN_PAGINA,
  CM_A_PUNTOS,
};
