// Filtros de categoria y estado del catalogo, compartidos por el listado y el reporte PDF.
// Cada uno acepta uno o varios valores separados por coma ("LIBRO,REVISTA"): el panel de filtros
// del catalogo deja marcar varias casillas a la vez.

/**
 * Valores de un parametro del query string como lista de textos, sin vacios ni repetidos. Acepta
 * "A,B", ["A", "B"] o un solo valor. Todo lo que no sea texto (por ejemplo un objeto armado con
 * "categoria[$ne]=x") se descarta: nunca llega a Mongo como operador.
 */
function listaDeValores(valor) {
  const crudos = Array.isArray(valor) ? valor : [valor];
  const textos = crudos
    .filter((v) => typeof v === 'string')
    .flatMap((v) => v.split(','))
    .map((v) => v.trim())
    .filter(Boolean);
  return [...new Set(textos)];
}

function igualOEn(valores) {
  return valores.length === 1 ? valores[0] : { $in: valores };
}

/**
 * Agrega a "filtro" las condiciones de categoria y estado.
 *  - categoria: cualquiera de las claves indicadas.
 *  - estadoRevision: Pendiente, Aprobado y Rechazado miran el estado de revision; "DE_BAJA" mira
 *    la marca de baja (un registro dado de baja puede seguir figurando como Aprobado). Si vienen
 *    ambos tipos, basta que cumpla uno.
 */
function aplicarFiltrosDeCategoriaYEstado(filtro, { categoria, estadoRevision }) {
  const categorias = listaDeValores(categoria);
  if (categorias.length > 0) filtro.categoria = igualOEn(categorias);

  const estados = listaDeValores(estadoRevision);
  const deBaja = estados.includes('DE_BAJA');
  const revision = estados.filter((estado) => estado !== 'DE_BAJA');

  if (deBaja && revision.length > 0) {
    filtro.$or = [{ deBaja: true }, { estadoRevision: igualOEn(revision) }];
  } else if (deBaja) {
    filtro.deBaja = true;
  } else if (revision.length > 0) {
    filtro.estadoRevision = igualOEn(revision);
  }
  return filtro;
}

module.exports = { listaDeValores, aplicarFiltrosDeCategoriaYEstado };
