const jwt = require('jsonwebtoken');
const User = require('../src/users/user_model');
const { unauthorized, forbidden } = require('../utils/httpResponse');

async function verifyJWT(req, res, next) {
  const authHeader = req.header('Authorization') || '';
  const [scheme, token] = authHeader.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return unauthorized(res, 'Token de sesion invalido o ausente');
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);

    // Se consulta la cuenta en cada peticion para que una desactivacion tenga efecto inmediato,
    // en vez de esperar a que el JWT expire por su cuenta (hasta 12h despues).
    const usuario = await User.findById(payload.userId).select('rol activo');

    if (!usuario || !usuario.activo) {
      return unauthorized(res, 'Tu cuenta ya no tiene acceso');
    }

    req.user = { userId: payload.userId, rol: usuario.rol };
    return next();
  } catch (err) {
    return unauthorized(res, 'Token de sesion invalido o expirado');
  }
}

function checkRole(...rolesPermitidos) {
  return (req, res, next) => {
    if (!req.user || !rolesPermitidos.includes(req.user.rol)) {
      return forbidden(res, 'No tienes permiso para realizar esta accion');
    }

    return next();
  };
}

module.exports = { verifyJWT, checkRole };
