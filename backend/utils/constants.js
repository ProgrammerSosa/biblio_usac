const ROLES = Object.freeze({
  MANAGER: 'MANAGER',
  ADMIN: 'ADMIN',
  USER: 'USER',
});

const ESTADOS_REVISION = Object.freeze({
  PENDIENTE: 'PENDIENTE',
  APROBADO: 'APROBADO',
  RECHAZADO: 'RECHAZADO',
});

const ESTADOS_INVITACION = Object.freeze({
  PENDIENTE: 'PENDIENTE',
  ACEPTADA: 'ACEPTADA',
  EXPIRADA: 'EXPIRADA',
});

const ACCIONES_AUDITORIA = Object.freeze({
  CREAR: 'CREAR',
  EDITAR: 'EDITAR',
  ENVIAR: 'ENVIAR',
  APROBAR: 'APROBAR',
  RECHAZAR: 'RECHAZAR',
  ELIMINAR: 'ELIMINAR',
  INVITAR: 'INVITAR',
  EXPORTAR: 'EXPORTAR',
  DESACTIVAR_USUARIO: 'DESACTIVAR_USUARIO',
  ACTIVAR_USUARIO: 'ACTIVAR_USUARIO',
  DESACTIVAR_CATEGORIA: 'DESACTIVAR_CATEGORIA',
  ACTIVAR_CATEGORIA: 'ACTIVAR_CATEGORIA',
  RESTAURAR_RESPALDO: 'RESTAURAR_RESPALDO',
});

const PALABRAS_DANO = ['dañ', 'dani', 'humedad', 'mancha', 'rasgad', 'roto', 'rota', 'deteriorad', 'polilla', 'hongo'];

function tieneDanoFisico(estadoFisico) {
  if (!estadoFisico) return false;
  const texto = estadoFisico.toLowerCase();
  return PALABRAS_DANO.some((palabra) => texto.includes(palabra));
}

module.exports = {
  ROLES,
  ESTADOS_REVISION,
  ESTADOS_INVITACION,
  ACCIONES_AUDITORIA,
  tieneDanoFisico,
};
