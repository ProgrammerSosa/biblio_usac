const User = require('../src/users/user_model');
const { ROLES } = require('../utils/constants');

/**
 * Un Manager supervisa a todo el personal. Un Admin solo supervisa a los Auxiliares.
 * Se usa tanto para el filtro de auditoria como para el panel de actividad del equipo,
 * para que las dos vistas respeten exactamente la misma jerarquia.
 */
async function usuariosVisiblesPara(rolSolicitante) {
  const filtro = rolSolicitante === ROLES.MANAGER ? {} : { rol: ROLES.USER };
  return User.find(filtro).select('nombre email rol activo');
}

function puedeVerPerfilDe(solicitante, usuarioObjetivo) {
  if (solicitante.userId === usuarioObjetivo._id.toString()) return true;
  if (solicitante.rol === ROLES.MANAGER) return true;
  if (solicitante.rol === ROLES.ADMIN) return usuarioObjetivo.rol === ROLES.USER;
  return false;
}

module.exports = { usuariosVisiblesPara, puedeVerPerfilDe };
