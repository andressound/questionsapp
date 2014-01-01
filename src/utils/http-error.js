// Error de negocio con estado HTTP; el middleware de errores lo convierte en

class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

module.exports = HttpError;
