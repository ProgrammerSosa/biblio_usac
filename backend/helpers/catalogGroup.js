// Misma normalizacion que excelImport.js y el frontend (CatalogListPage/ApprovalsPage): sin
// acentos, sin espacios de mas, sin mayusculas - para que "Jose" y "José " cuenten como el
// mismo autor.
function normalizarTexto(valor) {
  return String(valor ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

// Misma regla en toda la app: dos registros son "copias" del mismo material si coinciden en
// todo - categoria, autor, titulo, idioma, anio, edicion, lugar, paginas y los atributos
// propios de la categoria (editorial, ISBN, etc.) - excepto el estado fisico y el ID de
// inventario, los dos unicos datos que de verdad cambian entre copias fisicas del mismo libro.
function claveDeGrupo(item) {
  const camposBase = [item.categoria, item.autor, item.titulo, item.idioma, item.anio, item.edicion, item.lugar, item.paginasImpresas];
  const atributos = item.atributos || {};
  const atributosOrdenados = Object.keys(atributos)
    .sort()
    .map((clave) => `${clave}:${atributos[clave]}`);
  return [...camposBase, ...atributosOrdenados].map(normalizarTexto).join('|');
}

// Agrupa documentos de Catalog que son copias del mismo material, preservando el orden en
// que aparecio cada grupo por primera vez - asi el sort/collation ya aplicado a la consulta
// no hay que repetirlo aqui, con que la lista de entrada ya venga ordenada basta.
function agruparPorCopias(items) {
  const grupos = new Map();
  for (const item of items) {
    const clave = claveDeGrupo(item);
    if (!grupos.has(clave)) grupos.set(clave, []);
    grupos.get(clave).push(item);
  }
  return [...grupos.values()];
}

module.exports = { normalizarTexto, claveDeGrupo, agruparPorCopias };
