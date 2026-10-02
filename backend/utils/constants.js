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
  DAR_DE_BAJA: 'DAR_DE_BAJA',
});

const PALABRAS_DANO = ['dañ', 'dani', 'humedad', 'mancha', 'rasgad', 'roto', 'rota', 'deteriorad', 'polilla', 'hongo'];

// Tamano maximo de un Excel subido (importar y restaurar respaldo). El servidor tiene poca
// memoria: un Excel muy pesado hace que se caiga al leerlo, asi que es mejor rechazarlo antes.
const LIMITE_ARCHIVO_MB = 20;

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
  LIMITE_ARCHIVO_MB,
  tieneDanoFisico,
};
