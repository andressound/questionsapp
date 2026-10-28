// Error de negocio con estado HTTP; el middleware de errores lo convierte en
// `{ error: { code, message } }`. Lanzarlo dentro de `withTransaction` hace rollback.
class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

module.exports = HttpError;
