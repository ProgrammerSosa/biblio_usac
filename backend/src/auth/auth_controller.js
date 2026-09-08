const User = require('../users/user_model');
const Invitation = require('./invitation_model');
const { hashPassword, comparePassword } = require('../../helpers/password');
const { generateJWT } = require('../../helpers/tokens');
const { ESTADOS_INVITACION } = require('../../utils/constants');
const { escapeRegExp } = require('../../helpers/regex');
const { ok, created, fail, unauthorized, notFound, forbidden } = require('../../utils/httpResponse');

function toPublicUser(user) {
  return {
    id: user._id,
    nombre: user.nombre,
    email: user.email,
    rol: user.rol,
    allowedCategories: user.allowedCategories,
  };
}

async function login(req, res, next) {
  try {
    const identificador = (req.body.identificador ?? req.body.email ?? '').trim();
    const { password } = req.body;

    if (!identificador || !password) {
      return fail(res, 'Correo (o nombre) y Contraseña son obligatorios');
    }

    const user = await User.findOne({
      $or: [
        { email: identificador.toLowerCase() },
        { nombre: { $regex: `^${escapeRegExp(identificador)}$`, $options: 'i' } },
      ],
    });
    if (!user) {
      return unauthorized(res, 'Credenciales invalidas');
    }

    const passwordValida = await comparePassword(password, user.passwordHash);
    if (!passwordValida) {
      return unauthorized(res, 'Credenciales invalidas');
    }

    if (!user.activo) {
      return forbidden(res, 'Esta cuenta fue desactivada, contacta a la Manager');
    }

    const token = generateJWT(user);
    return ok(res, { token, user: toPublicUser(user) }, 'Sesion iniciada correctamente');
  } catch (err) {
    return next(err);
  }
}

async function checkInvitation(req, res, next) {
  try {
    const invitation = await Invitation.findOne({ token: req.params.token });

    if (!invitation) {
      return ok(res, { valido: false, motivo: 'Este enlace de invitacion no existe' });
    }

    if (invitation.estado === ESTADOS_INVITACION.ACEPTADA) {
      return ok(res, { valido: false, motivo: 'Esta invitacion ya fue utilizada para crear una cuenta' });
    }

    if (invitation.estado === ESTADOS_INVITACION.EXPIRADA || invitation.expiresAt < new Date()) {
      return ok(res, { valido: false, motivo: 'Esta invitacion ya expiro, pide una nueva' });
    }

    return ok(res, { valido: true, email: invitation.email, rol: invitation.rol });
  } catch (err) {
    return next(err);
  }
}

async function registerFromInvitation(req, res, next) {
  try {
    const { token, nombre, password } = req.body;

    if (!token || !nombre || !password) {
      return fail(res, 'Token, nombre y Contraseña son obligatorios');
    }

    const invitation = await Invitation.findOne({ token });
    if (!invitation) {
      return notFound(res, 'Invitacion no encontrada');
    }

    if (invitation.estado !== ESTADOS_INVITACION.PENDIENTE) {
      return fail(res, 'Esta invitacion ya fue utilizada o ya no es valida', 409);
    }

    if (invitation.expiresAt < new Date()) {
      invitation.estado = ESTADOS_INVITACION.EXPIRADA;
      await invitation.save();
      return fail(res, 'Esta invitacion ha expirado', 409);
    }

    const passwordHash = await hashPassword(password);

    const user = await User.create({
      nombre,
      email: invitation.email,
      passwordHash,
      rol: invitation.rol,
      allowedCategories: invitation.allowedCategories,
    });

    invitation.estado = ESTADOS_INVITACION.ACEPTADA;
    await invitation.save();

    return created(res, toPublicUser(user), 'Cuenta creada correctamente, ya puedes iniciar sesion');
  } catch (err) {
    return next(err);
  }
}

module.exports = { login, checkInvitation, registerFromInvitation, toPublicUser };
