// Misma normalizacion que el backend (helpers/excelImport.js, helpers/catalogGroup.js): sin
// acentos, sin espacios de mas, sin mayusculas - para que "Jose" y "José " cuenten como el
// mismo autor.
export function normalizarParaComparar(valor) {
  return String(valor ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

// Dos registros son "copias" del mismo material si TODO coincide - categoria, autor, titulo,
// idioma, anio, edicion, lugar, paginas y los atributos propios de la categoria (editorial,
// ISBN, etc.) - excepto el estado fisico y el ID de inventario, los dos unicos datos que de
// verdad cambian entre copias fisicas del mismo libro. Misma regla en Catalogo, Aprobaciones
// y el import de Excel.
export function claveDeGrupo(item) {
  const camposBase = [item.categoria, item.autor, item.titulo, item.idioma, item.anio, item.edicion, item.lugar, item.paginasImpresas];
  const atributos = item.atributos || {};
  const atributosOrdenados = Object.keys(atributos)
    .sort()
    .map((clave) => `${clave}:${atributos[clave]}`);
  return [...camposBase, ...atributosOrdenados].map(normalizarParaComparar).join('|');
}

export function agruparRegistros(registros) {
  const grupos = new Map();
  for (const item of registros) {
    const clave = claveDeGrupo(item);
    if (!grupos.has(clave)) grupos.set(clave, []);
    grupos.get(clave).push(item);
  }
  return [...grupos.values()].map((copias) => ({ ...copias[0], copias }));
}
