function errorHandler(err, req, res, next) { // eslint-disable-line no-unused-vars
  if (err.name === 'ValidationError') {
    const detalles = Object.values(err.errors).map((e) => e.message);
    return res.status(400).json({ success: false, error: detalles.join('; ') });
  }

  if (err.code === 11000) {
    const campo = Object.keys(err.keyValue || {})[0] || 'campo';
    return res.status(409).json({
      success: false,
      error: `Ya existe un registro con ese valor en '${campo}'`,
    });
  }

  if (err.name === 'CastError') {
    return res.status(400).json({ success: false, error: `Identificador invalido: ${err.value}` });
  }

  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ success: false, error: 'El cuerpo de la peticion no es un JSON valido' });
  }

  if (err.name === 'MulterError') {
    const mensaje = err.code === 'LIMIT_FILE_SIZE' ? 'El archivo no puede pesar mas de 10 MB' : err.message;
    return res.status(400).json({ success: false, error: mensaje });
  }

  if (err.message === 'El archivo debe ser un Excel (.xlsx o .xls)') {
    return res.status(400).json({ success: false, error: err.message });
  }

  console.error(err);
  return res.status(500).json({ success: false, error: 'Error interno del servidor' });
}

module.exports = errorHandler;
