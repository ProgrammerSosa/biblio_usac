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

const PALABRAS_DANO = ['dañ', 'dani', 'humedad', 'mancha', 'rasgad', 'roto', 'rota', 'deteriorad', 'polilla', 'hongo'];

export function tieneDanoFisico(estadoFisico) {
  if (!estadoFisico) return false;
  const texto = estadoFisico.toLowerCase();
  return PALABRAS_DANO.some((palabra) => texto.includes(palabra));
}
