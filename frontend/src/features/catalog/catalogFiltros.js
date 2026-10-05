import { CAMPOS_BUSQUEDA, OPCIONES_ESTADO_FILTRO, OPCIONES_ORDEN_CATALOGO, ORDEN_POR_DEFECTO } from '../../shared/constants';

// Todo lo que se puede marcar en el panel de filtros del catalogo, en un solo objeto:
//  - campos / idExacto: en que campos busca el texto escrito (ver CAMPOS_BUSQUEDA).
//  - categorias / estados: listas de claves marcadas; sin marcar nada = no se filtra por eso.
//  - anioRegistro, sort, soloMios: como siempre.
const TODOS_LOS_CAMPOS = CAMPOS_BUSQUEDA.map((campo) => campo.clave);

export function filtrosIniciales({ soloMios = false } = {}) {
  return {
    campos: [...TODOS_LOS_CAMPOS],
    idExacto: false,
    categorias: [],
    estados: [],
    anioRegistro: '',
    sort: ORDEN_POR_DEFECTO,
    soloMios,
  };
}

function buscaEnTodo({ campos, idExacto }) {
  return campos.length === TODOS_LOS_CAMPOS.length && !idExacto;
}

// Lo que se manda al backend como "buscarEn": "id,titulo", "id_exacto,autor"... en el orden fijo
// de CAMPOS_BUSQUEDA. El ID exacto solo cuenta si ID esta marcado.
export function valorBuscarEn({ campos, idExacto }) {
  return TODOS_LOS_CAMPOS.filter((clave) => campos.includes(clave))
    .map((clave) => (clave === 'id' && idExacto ? 'id_exacto' : clave))
    .join(',');
}

// Parametros de la consulta del listado y del PDF: los dos usan exactamente los mismos filtros.
export function parametrosDeFiltros(filtros, { buscar = '', userId } = {}) {
  const params = { sort: filtros.sort };
  if (filtros.categorias.length > 0) params.categoria = filtros.categorias.join(',');
  if (filtros.estados.length > 0) params.estadoRevision = filtros.estados.join(',');
  if (filtros.anioRegistro) params.anioRegistro = filtros.anioRegistro;
  if (filtros.soloMios) params.registradoPor = userId;
  const texto = buscar.trim();
  if (texto) {
    params.buscar = texto;
    params.buscarEn = valorBuscarEn(filtros);
  }
  return params;
}

function unir(nombres) {
  if (nombres.length <= 1) return nombres.join('');
  return `${nombres.slice(0, -1).join(', ')} o ${nombres[nombres.length - 1]}`;
}

// Texto de ayuda del cuadro de busqueda: dice en que campos se esta buscando.
export function placeholderBusqueda(filtros) {
  const nombres = TODOS_LOS_CAMPOS.filter((clave) => filtros.campos.includes(clave)).map((clave) => {
    if (clave === 'id') return filtros.idExacto ? 'ID exacto' : 'ID';
    return CAMPOS_BUSQUEDA.find((campo) => campo.clave === clave).label.toLowerCase();
  });
  return `Buscar por ${unir(nombres)}...`;
}

/**
 * Una "pastilla" por cada filtro activo, para mostrarlas debajo de la barra y poder quitar cada una
 * con su X. Cada pastilla trae "quitar": los cambios que la dejan sin efecto.
 */
export function resumenDeFiltros(filtros, { nombreDeCategoria, esUsuarioAuxiliar }) {
  const pastillas = [];

  if (!buscaEnTodo(filtros)) {
    const nombres = TODOS_LOS_CAMPOS.filter((clave) => filtros.campos.includes(clave)).map((clave) =>
      clave === 'id' && filtros.idExacto ? 'ID exacto' : CAMPOS_BUSQUEDA.find((campo) => campo.clave === clave).label
    );
    pastillas.push({
      id: 'buscarEn',
      grupo: 'Buscar en',
      texto: nombres.join(', '),
      quitar: { campos: [...TODOS_LOS_CAMPOS], idExacto: false },
    });
  }

  filtros.categorias.forEach((clave) => {
    pastillas.push({
      id: `categoria-${clave}`,
      grupo: 'Categoria',
      texto: nombreDeCategoria(clave),
      quitar: { categorias: filtros.categorias.filter((c) => c !== clave) },
    });
  });

  filtros.estados.forEach((clave) => {
    pastillas.push({
      id: `estado-${clave}`,
      grupo: 'Estado',
      texto: OPCIONES_ESTADO_FILTRO.find((estado) => estado.clave === clave)?.label || clave,
      quitar: { estados: filtros.estados.filter((e) => e !== clave) },
    });
  });

  if (filtros.anioRegistro) {
    pastillas.push({ id: 'anio', grupo: 'Registrado en', texto: filtros.anioRegistro, quitar: { anioRegistro: '' } });
  }

  if (filtros.sort !== ORDEN_POR_DEFECTO) {
    const orden = OPCIONES_ORDEN_CATALOGO.find((opcion) => opcion.value === filtros.sort);
    pastillas.push({ id: 'orden', grupo: 'Orden', texto: orden?.label || filtros.sort, quitar: { sort: ORDEN_POR_DEFECTO } });
  }

  if (esUsuarioAuxiliar && filtros.soloMios) {
    pastillas.push({ id: 'soloMios', grupo: null, texto: 'Solo mis registros', quitar: { soloMios: false } });
  }

  return pastillas;
}
