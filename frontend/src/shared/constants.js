export const ROLES = {
  MANAGER: 'MANAGER',
  ADMIN: 'ADMIN',
  USER: 'USER',
};

export const ROL_LABELS = {
  MANAGER: 'Manager',
  ADMIN: 'Admin',
  USER: 'Auxiliar',
};

export const ESTADOS_REVISION = {
  PENDIENTE: 'PENDIENTE',
  APROBADO: 'APROBADO',
  RECHAZADO: 'RECHAZADO',
};

export const ESTADO_REVISION_LABELS = {
  PENDIENTE: 'Pendiente',
  APROBADO: 'Aprobado',
  RECHAZADO: 'Rechazado',
};

export const ACCIONES_AUDITORIA = [
  'CREAR',
  'EDITAR',
  'ENVIAR',
  'APROBAR',
  'RECHAZAR',
  'ELIMINAR',
  'INVITAR',
  'EXPORTAR',
  'ACTIVAR_USUARIO',
  'DESACTIVAR_USUARIO',
  'ACTIVAR_CATEGORIA',
  'DESACTIVAR_CATEGORIA',
];

export const ACCION_LABELS = {
  CREAR: 'Creo',
  EDITAR: 'Edito',
  ENVIAR: 'Envio a revision',
  APROBAR: 'Aprobo',
  RECHAZAR: 'Rechazo',
  ELIMINAR: 'Elimino',
  INVITAR: 'Invito',
  EXPORTAR: 'Exporto',
  ACTIVAR_USUARIO: 'Activo un usuario',
  DESACTIVAR_USUARIO: 'Desactivo un usuario',
  ACTIVAR_CATEGORIA: 'Activo una categoria',
  DESACTIVAR_CATEGORIA: 'Desactivo una categoria',
};

export const ACCION_TONOS = {
  CREAR: 'primary',
  EDITAR: 'neutral',
  ENVIAR: 'primary',
  APROBAR: 'success',
  RECHAZAR: 'danger',
  ELIMINAR: 'danger',
  INVITAR: 'primary',
  EXPORTAR: 'neutral',
  ACTIVAR_USUARIO: 'success',
  DESACTIVAR_USUARIO: 'danger',
  ACTIVAR_CATEGORIA: 'success',
  DESACTIVAR_CATEGORIA: 'danger',
};

// Mismos 8 valores que resuelve el backend (helpers/catalogSort.js) - un valor
// desconocido o vacio cae al orden por defecto (fecha_asc), asi que el select
// siempre puede arrancar en 'fecha_asc' sin mandar nada especial. Ese orden es el de ingreso:
// al importar un Excel, el mismo orden de sus filas.
export const ORDEN_POR_DEFECTO = 'fecha_asc';

// Campos en los que busca el cuadro de busqueda del catalogo (mismos valores que resuelve el
// backend en helpers/catalogSearch.js). Se marcan en el panel de filtros: se puede buscar en uno,
// en dos o en los tres a la vez. Con "ID" marcado, escribir un sello o tipo (ej. SDE) trae todos
// los que lo llevan en su ID.
export const CAMPOS_BUSQUEDA = [
  { clave: 'id', label: 'ID', ayuda: 'Ej. 20F, SDE' },
  { clave: 'titulo', label: 'Titulo', ayuda: 'Nombre del material' },
  { clave: 'autor', label: 'Autor', ayuda: 'Quien lo escribio' },
];

// Estados que se pueden marcar en el filtro. "De baja" no es un estado de revision: es la marca
// de un registro dado de baja, pero para quien filtra se elige igual que los demas.
export const OPCIONES_ESTADO_FILTRO = [
  ...Object.values(ESTADOS_REVISION).map((estado) => ({ clave: estado, label: ESTADO_REVISION_LABELS[estado] })),
  { clave: 'DE_BAJA', label: 'De baja' },
];

export const OPCIONES_ORDEN_CATALOGO = [
  { value: 'fecha_asc', label: 'Orden de ingreso (como el Excel)' },
  { value: 'fecha_desc', label: 'Mas recientes primero' },
  { value: 'titulo_asc', label: 'Titulo (A-Z)' },
  { value: 'titulo_desc', label: 'Titulo (Z-A)' },
  { value: 'autor_asc', label: 'Autor (A-Z)' },
  { value: 'autor_desc', label: 'Autor (Z-A)' },
  { value: 'anio_desc', label: 'Año (mas nuevo)' },
  { value: 'anio_asc', label: 'Año (mas antiguo)' },
];

const PALABRAS_DANO = ['dañ', 'dani', 'humedad', 'mancha', 'rasgad', 'roto', 'rota', 'deteriorad', 'polilla', 'hongo'];

export function tieneDanoFisico(estadoFisico) {
  if (!estadoFisico) return false;
  const texto = estadoFisico.toLowerCase();
  return PALABRAS_DANO.some((palabra) => texto.includes(palabra));
}
