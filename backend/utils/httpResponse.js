function ok(res, data, message, status = 200) {
  return res.status(status).json({ success: true, data, message });
}

function created(res, data, message = 'Creado correctamente') {
  return ok(res, data, message, 201);
}

function fail(res, error, status = 400) {
  return res.status(status).json({ success: false, error });
}

function notFound(res, error = 'Recurso no encontrado') {
  return fail(res, error, 404);
}

function unauthorized(res, error = 'No autorizado') {
  return fail(res, error, 401);
}

function forbidden(res, error = 'Acceso denegado') {
  return fail(res, error, 403);
}

module.exports = { ok, created, fail, notFound, unauthorized, forbidden };
