// Tabla fija de valores permitidos para el parametro "sort" que mandan la
// lista de Catalogo, Aprobaciones y el export a PDF. Nunca se usa un nombre de
// campo que venga directo del query string (evitaria que alguien intente
// ordenar por un campo que no deberia, ej. passwordHash de otra coleccion).
const OPCIONES_ORDEN = {
  fecha_desc: { campo: 'createdAt', direccion: -1 },
  fecha_asc: { campo: 'createdAt', direccion: 1 },
  titulo_asc: { campo: 'titulo', direccion: 1 },
  titulo_desc: { campo: 'titulo', direccion: -1 },
  autor_asc: { campo: 'autor', direccion: 1 },
  autor_desc: { campo: 'autor', direccion: -1 },
  anio_desc: { campo: 'anio', direccion: -1 },
  anio_asc: { campo: 'anio', direccion: 1 },
};

// Por defecto los registros salen en el orden en que se ingresaron (el mas antiguo primero): al
// importar un Excel, eso es exactamente el orden de sus filas, que es como los quiere ver la
// biblioteca (lista, aprobaciones y reporte PDF). "fecha_desc" sigue disponible para quien
// prefiera ver lo mas reciente primero.
const ORDEN_POR_DEFECTO = 'fecha_asc';

// Mongo ordena texto por punto de codigo Unicode (mayusculas antes que
// minusculas, acentos fuera de orden). Con esta collation, "Título"/"autor"
// quedan alfabetizados como espera una persona (case e accent-insensitive).
const CAMPOS_CON_COLLATION = new Set(['titulo', 'autor']);
const COLLATION_ES = { locale: 'es', strength: 1 };

/**
 * Resuelve el parametro "sort" del query string contra la tabla de opciones
 * validas. Un valor desconocido o ausente cae al orden por defecto (el mismo
 * que ya se usaba antes de que existiera este parametro).
 */
function resolverOrden(sortParam) {
  const opcion = OPCIONES_ORDEN[sortParam] || OPCIONES_ORDEN[ORDEN_POR_DEFECTO];
  // El _id desempata (dos registros creados en el mismo milisegundo, o con el mismo titulo): los
  // _id de un mismo lote salen en el orden en que se crearon, asi el orden nunca queda al azar.
  return {
    sort: { [opcion.campo]: opcion.direccion, _id: opcion.campo === 'createdAt' ? opcion.direccion : 1 },
    collation: CAMPOS_CON_COLLATION.has(opcion.campo) ? COLLATION_ES : null,
  };
}

module.exports = { resolverOrden, ORDEN_POR_DEFECTO };
