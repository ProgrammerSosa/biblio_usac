const User = require('./user_model');
const Catalog = require('../catalog/catalog_model');
const { usuariosVisiblesPara, puedeVerPerfilDe } = require('../../helpers/alcanceEquipo');
const { ESTADOS_REVISION } = require('../../utils/constants');
const { ok, notFound, forbidden } = require('../../utils/httpResponse');

function inicioDeHoy() {
  const fecha = new Date();
  fecha.setHours(0, 0, 0, 0);
  return fecha;
}

function estadoVacio() {
  return {
    [ESTADOS_REVISION.PENDIENTE_ADMIN]: 0,
    [ESTADOS_REVISION.PENDIENTE_MANAGER]: 0,
    [ESTADOS_REVISION.APROBADO]: 0,
    [ESTADOS_REVISION.RECHAZADO]: 0,
  };
}

async function calcularResumen(usuarioId) {
  const filtroBase = { registradoPor: usuarioId, eliminado: false };

  const [total, porEstadoRaw, hoy] = await Promise.all([
    Catalog.countDocuments(filtroBase),
    Catalog.aggregate([
      { $match: filtroBase },
      { $group: { _id: '$estadoRevision', cantidad: { $sum: 1 } } },
    ]),
    Catalog.countDocuments({ ...filtroBase, createdAt: { $gte: inicioDeHoy() } }),
  ]);

  const porEstado = estadoVacio();
  porEstadoRaw.forEach((fila) => {
    porEstado[fila._id] = fila.cantidad;
  });

  return { total, porEstado, hoy };
}

async function calcularMejorDia(usuarioId) {
  const resultado = await Catalog.aggregate([
    { $match: { registradoPor: usuarioId, eliminado: false } },
    {
      $group: {
        _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
        cantidad: { $sum: 1 },
      },
    },
    { $sort: { cantidad: -1, _id: 1 } },
    { $limit: 1 },
  ]);

  return resultado.length > 0 ? { fecha: resultado[0]._id, cantidad: resultado[0].cantidad } : null;
}

async function listEstadisticasEquipo(req, res, next) {
  try {
    const visibles = await usuariosVisiblesPara(req.user.rol);

    const conEstadisticas = await Promise.all(
      visibles.map(async (usuario) => ({
        usuario: { id: usuario._id, nombre: usuario.nombre, email: usuario.email, rol: usuario.rol, activo: usuario.activo },
        ...(await calcularResumen(usuario._id)),
      }))
    );

    conEstadisticas.sort((a, b) => b.total - a.total);

    return ok(res, conEstadisticas);
  } catch (err) {
    return next(err);
  }
}

async function getPerfilUsuario(req, res, next) {
  try {
    const usuario = await User.findById(req.params.id).select('nombre email rol activo');
    if (!usuario) {
      return notFound(res, 'Usuario no encontrado');
    }

    if (!puedeVerPerfilDe(req.user, usuario)) {
      return forbidden(res, 'No tienes permiso para ver este perfil');
    }

    const [resumen, mejorDia] = await Promise.all([calcularResumen(usuario._id), calcularMejorDia(usuario._id)]);

    return ok(res, {
      usuario: { id: usuario._id, nombre: usuario.nombre, email: usuario.email, rol: usuario.rol, activo: usuario.activo },
      ...resumen,
      mejorDia,
    });
  } catch (err) {
    return next(err);
  }
}

module.exports = { listEstadisticasEquipo, getPerfilUsuario };
