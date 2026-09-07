const User = require('./user_model');
const Invitation = require('../auth/invitation_model');
const Category = require('../catalog/category_model');
const { registrarAuditoria } = require('../audit/audit_service');
const { generateInvitationToken, buildInvitationLink } = require('../../helpers/tokens');
const { sendInvitationEmail } = require('../../helpers/emailService');
const { ROLES, ACCIONES_AUDITORIA } = require('../../utils/constants');
const { ok, created, fail, notFound, forbidden } = require('../../utils/httpResponse');

async function createInvitation(req, res, next) {
  try {
    const { email, rol, allowedCategories = [] } = req.body;

    if (!email || !rol) {
      return fail(res, 'Correo y rol son obligatorios');
    }

    if (!Object.values(ROLES).includes(rol)) {
      return fail(res, `Rol invalido, debe ser uno de: ${Object.values(ROLES).join(', ')}`);
    }

    if (allowedCategories.length > 0) {
      const clavesValidas = (await Category.find({ activo: true }).select('clave')).map((c) => c.clave);
      const categoriasInvalidas = allowedCategories
        .map((c) => c.toUpperCase().trim())
        .filter((c) => !clavesValidas.includes(c));
      if (categoriasInvalidas.length > 0) {
        return fail(res, `Categorias invalidas: ${categoriasInvalidas.join(', ')}`);
      }
    }

    const token = generateInvitationToken();

    const invitation = await Invitation.create({
      email: email.toLowerCase().trim(),
      rol,
      allowedCategories: rol === ROLES.USER ? allowedCategories : [],
      token,
      invitadoPor: req.user.userId,
    });

    await registrarAuditoria({
      accion: ACCIONES_AUDITORIA.INVITAR,
      entidad: 'Invitation',
      entidadId: invitation._id,
      usuario: req.user.userId,
      detalles: { email: invitation.email, rol: invitation.rol },
    });

    const invitationLink = buildInvitationLink(token);

    // El enlace directo siempre se devuelve, aunque el correo falle o no este configurado.
    const resultadoEnvio = await sendInvitationEmail({ email: invitation.email, rol: invitation.rol, invitationLink });

    return created(res, {
      invitation,
      invitationLink,
      emailEnviado: resultadoEnvio.enviado,
    });
  } catch (err) {
    return next(err);
  }
}

async function listInvitations(req, res, next) {
  try {
    const invitations = await Invitation.find().populate('invitadoPor', 'nombre email').sort({ createdAt: -1 });

    const conEnlace = invitations.map((inv) => ({
      ...inv.toObject(),
      invitationLink: buildInvitationLink(inv.token),
    }));

    return ok(res, conEnlace);
  } catch (err) {
    return next(err);
  }
}

async function listUsers(req, res, next) {
  try {
    const users = await User.find().select('-passwordHash').sort({ createdAt: -1 });
    return ok(res, users);
  } catch (err) {
    return next(err);
  }
}

async function setUserStatus(req, res, next) {
  try {
    const { activo } = req.body;

    if (typeof activo !== 'boolean') {
      return fail(res, "El campo 'activo' debe ser true o false");
    }

    const usuario = await User.findById(req.params.id);
    if (!usuario) {
      return notFound(res, 'Usuario no encontrado');
    }

    if (!activo && usuario._id.toString() === req.user.userId) {
      return forbidden(res, 'No puedes desactivar tu propia cuenta');
    }

    usuario.activo = activo;
    await usuario.save();

    await registrarAuditoria({
      accion: activo ? ACCIONES_AUDITORIA.ACTIVAR_USUARIO : ACCIONES_AUDITORIA.DESACTIVAR_USUARIO,
      entidad: 'User',
      entidadId: usuario._id,
      usuario: req.user.userId,
      detalles: { email: usuario.email },
    });

    return ok(res, { id: usuario._id, activo: usuario.activo }, 'Estado actualizado correctamente');
  } catch (err) {
    return next(err);
  }
}

module.exports = { createInvitation, listInvitations, listUsers, setUserStatus };
