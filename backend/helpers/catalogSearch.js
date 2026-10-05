const { escapeRegExp } = require('./regex');

// En que campos busca el cuadro de busqueda del catalogo (y el reporte PDF, que usa los mismos
// filtros). "buscarEn" es una lista separada por comas con estos valores conocidos - el panel de
// filtros manda, por ejemplo, "id,titulo" cuando se marcan ID y Titulo. "todo" (titulo, autor e
// ID) es el comportamiento de siempre y lo que se usa si no llega nada valido. Nunca se usa un
// nombre de campo que venga directo del query string: solo estos valores.
const MODOS_BUSQUEDA = ['todo', 'id', 'id_exacto', 'titulo', 'autor'];

const ETIQUETAS_MODO_BUSQUEDA = {
  id: 'ID',
  id_exacto: 'ID exacto',
  titulo: 'titulo',
  autor: 'autor',
};

// El ID se guarda en mayusculas y con los espacios normalizados (ver catalog_model.js), asi que
// la busqueda exacta compara contra esa misma forma: "20-f   c1" encuentra el ID "20-F C1".
function normalizarId(texto) {
  return String(texto).replace(/\s+/g, ' ').trim().toUpperCase();
}

/**
 * Campos donde se busca, sin repetidos y en un orden fijo (ID, titulo, autor). Acepta "todo", un
 * modo suelto ("autor") o una lista ("id,titulo"). Lo desconocido se ignora; sin nada valido
 * busca en todo.
 *  - id: el ID contiene el texto ("20F" encuentra 20F y sus copias 20F-C1, 20F-C2; "SDL" todos los
 *    del sello Derecho Libro).
 *  - id_exacto: el ID es exactamente ese ("20F" encuentra solo 20F, no 20F-C1). Si llegan los dos,
 *    manda el exacto.
 */
function camposDeBusqueda(buscarEn) {
  const pedidos = new Set(
    (Array.isArray(buscarEn) ? buscarEn : [buscarEn])
      .filter((valor) => typeof valor === 'string')
      .flatMap((valor) => valor.split(','))
      .map((valor) => valor.trim())
      .filter((valor) => MODOS_BUSQUEDA.includes(valor))
  );

  if (pedidos.size === 0 || pedidos.has('todo')) return ['id', 'titulo', 'autor'];

  const campos = [];
  if (pedidos.has('id_exacto')) campos.push('id_exacto');
  else if (pedidos.has('id')) campos.push('id');
  if (pedidos.has('titulo')) campos.push('titulo');
  if (pedidos.has('autor')) campos.push('autor');
  return campos;
}

function condicionDeCampo(campo, texto, patron) {
  switch (campo) {
    case 'id':
      return { idInventario: patron };
    case 'id_exacto':
      return { idInventario: normalizarId(texto) };
    case 'titulo':
      return { titulo: patron };
    default:
      return { autor: patron };
  }
}

/**
 * Condicion de Mongo para el texto buscado en los campos elegidos, o null si no hay nada que
 * buscar. Con un solo campo es la condicion directa; con varios, basta que coincida en uno.
 */
function construirFiltroBusqueda(buscar, buscarEn) {
  const texto = String(buscar ?? '').trim();
  if (!texto) return null;

  const patron = new RegExp(escapeRegExp(texto), 'i');
  const condiciones = camposDeBusqueda(buscarEn).map((campo) => condicionDeCampo(campo, texto, patron));
  return condiciones.length === 1 ? condiciones[0] : { $or: condiciones };
}

// Texto para el encabezado del PDF: "titulo, autor o ID", "ID exacto", "ID o titulo"...
function etiquetaModoBusqueda(buscarEn) {
  const campos = camposDeBusqueda(buscarEn);
  // Titulo, autor e ID (sin ser exacto) se leen como siempre: "titulo, autor o ID".
  if (campos.length === 3 && campos[0] === 'id') return 'titulo, autor o ID';

  const etiquetas = campos.map((campo) => ETIQUETAS_MODO_BUSQUEDA[campo]);
  if (etiquetas.length === 1) return etiquetas[0];
  return `${etiquetas.slice(0, -1).join(', ')} o ${etiquetas[etiquetas.length - 1]}`;
}

module.exports = { construirFiltroBusqueda, etiquetaModoBusqueda, camposDeBusqueda, MODOS_BUSQUEDA };
