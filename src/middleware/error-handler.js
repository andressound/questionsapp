const HttpError = require('../utils/http-error');

function notFound(_request, response) {
  return response.status(404).json({ error: { code: 'NOT_FOUND', message: 'Ruta no encontrada' } });
}

function errorHandler(error, _request, response, _next) {
  if (error instanceof HttpError) {
    return response.status(error.status).json({ error: { code: error.code, message: error.message } });
  }

  if (error.type === 'entity.parse.failed') {
    return response.status(400).json({ error: { code: 'INVALID_JSON', message: 'El cuerpo JSON no es válido' } });
  }

  if (error.type === 'entity.too.large') {
    return response.status(413).json({ error: { code: 'PAYLOAD_TOO_LARGE', message: 'El cuerpo es demasiado grande' } });
  }

  console.error(error);
  return response.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Error inesperado' } });
}

module.exports = { errorHandler, notFound };
