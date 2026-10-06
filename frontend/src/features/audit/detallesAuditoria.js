import { ESTADO_REVISION_LABELS, ROL_LABELS } from '../../shared/constants';

// Convierte los "detalles" que guarda cada accion de auditoria (datos tecnicos como
// { estadoNuevo: 'APROBADO' } o { filtro: {...}, totalRegistros: 120 }) en una frase que se pueda
// leer: "Estado: Aprobado", "Sin filtros · 120 registros"...

function humanizar(clave) {
  const separado = String(clave).replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
  return separado.charAt(0).toUpperCase() + separado.slice(1);
}

function etiquetaEstado(estado) {
  return estado === 'DE_BAJA' ? 'De baja' : ESTADO_REVISION_LABELS[estado] || estado;
}

// Una condicion de Mongo guardada en el filtro de una exportacion: un valor suelto o { $in: [...] }.
function valoresDe(condicion) {
  if (condicion === undefined || condicion === null) return [];
  if (typeof condicion === 'object') return Array.isArray(condicion.$in) ? condicion.$in : [];
  return [condicion];
}

/**
 * Descripcion del filtro con el que se genero un PDF. Entiende tanto los filtros simples de antes
 * (categoria: 'LIBRO') como los de varias casillas ({ $in: [...] }, o estado mezclado con "De baja").
 */
function describirFiltro(filtro, nombreDeCategoria) {
  if (!filtro || typeof filtro !== 'object') return 'Sin filtros';
  const partes = [];

  const categorias = valoresDe(filtro.categoria);
  if (categorias.length > 0) partes.push(`categoría ${categorias.map(nombreDeCategoria).join(', ')}`);

  const estados = valoresDe(filtro.estadoRevision);
  if (filtro.deBaja) estados.push('DE_BAJA');
  if (Array.isArray(filtro.$or)) {
    filtro.$or.forEach((condicion) => {
      if (condicion?.deBaja) estados.push('DE_BAJA');
      estados.push(...valoresDe(condicion?.estadoRevision));
    });
  }
  if (estados.length > 0) partes.push(`estado ${[...new Set(estados)].map(etiquetaEstado).join(', ')}`);

  const desde = filtro.createdAt?.$gte;
  if (desde) partes.push(`año de registro ${new Date(desde).getUTCFullYear()}`);

  if (filtro.registradoPor) partes.push('registros de una sola persona');

  return partes.length > 0 ? partes.join(', ') : 'Sin filtros';
}

function describir(clave, valor, detalles, nombreDeCategoria) {
  switch (clave) {
    case 'estadoNuevo':
      return `Estado: ${etiquetaEstado(valor)}`;
    case 'estadoAnterior':
      return `Antes: ${etiquetaEstado(valor)}`;
    case 'categoria':
    case 'clave':
      return `Categoría: ${nombreDeCategoria(valor)}`;
    case 'nombre':
      return detalles.clave ? null : `Nombre: ${valor}`;
    case 'activo':
      return valor ? 'Activada' : 'Desactivada';
    case 'idInventario':
      return `ID ${valor}`;
    case 'motivo':
      return `Motivo: ${valor}`;
    case 'email':
      return `Correo: ${valor}`;
    case 'rol':
      return `Rol: ${ROL_LABELS[valor] || valor}`;
    case 'archivoOrigen':
      return `Archivo: ${valor}`;
    case 'creados':
      return `${valor} creados`;
    case 'categorias':
      return typeof valor === 'number'
        ? `${valor} categorías`
        : `Categorías: ${String(valor).split(', ').map(nombreDeCategoria).join(', ')}`;
    case 'registros':
    case 'totalRegistros':
      return `${valor} registros`;
    case 'filtro':
      return describirFiltro(valor, nombreDeCategoria);
    default:
      // Un dato que esta pantalla no conoce: se muestra con su nombre legible, sin romperse con objetos.
      if (typeof valor === 'object') return null;
      return `${humanizar(clave)}: ${typeof valor === 'boolean' ? (valor ? 'sí' : 'no') : valor}`;
  }
}

export function resumenDetalles(detalles, { nombreDeCategoria = (clave) => clave } = {}) {
  if (!detalles || typeof detalles !== 'object' || Object.keys(detalles).length === 0) return '-';

  const partes = [];
  if (detalles.importado) partes.push('Importado desde Excel');
  else if (detalles.lote) partes.push('En lote');

  for (const [clave, valor] of Object.entries(detalles)) {
    if (clave === 'importado' || clave === 'lote' || valor === null || valor === undefined || valor === '') continue;
    const texto = describir(clave, valor, detalles, nombreDeCategoria);
    if (texto) partes.push(texto);
  }
  return partes.length > 0 ? partes.join(' · ') : '-';
}
