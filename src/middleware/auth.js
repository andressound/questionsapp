const { pool } = require('../config/database');
const HttpError = require('../utils/http-error');
const { SESSION_DAYS, hashToken } = require('../utils/session');

const BEARER = /^Bearer ([A-Za-z0-9_-]{20,200})$/;

// Exige `Authorization: Bearer <token>` de una sesión vigente y deja el usuario en request.userId.
async function requireAuth(request, _response, next) {
  const match = BEARER.exec(request.get('authorization') || '');
  if (!match) {
    throw new HttpError(401, 'UNAUTHORIZED', 'Sesión no válida o caducada');
  }

  // Renueva la caducidad como mucho una vez al día para no escribir en cada petición.
  const { rows } = await pool.query(
    `WITH found AS (
       SELECT s.id_sesion, s.id_usuario, s.expires_at, u.role
         FROM sesiones s
         INNER JOIN usuarios u ON u.id_usuario = s.id_usuario
        WHERE s.token_hash = $1 AND s.expires_at > CURRENT_TIMESTAMP
     ), renewed AS (
       UPDATE sesiones s
          SET expires_at = CURRENT_TIMESTAMP + make_interval(days => $2)
         FROM found
        WHERE s.id_sesion = found.id_sesion
          AND found.expires_at < CURRENT_TIMESTAMP + make_interval(days => $2 - 1)
     )
     SELECT id_sesion, id_usuario, role FROM found`,
    [hashToken(match[1]), SESSION_DAYS],
  );
  if (!rows[0]) {
    throw new HttpError(401, 'UNAUTHORIZED', 'Sesión no válida o caducada');
  }

  request.userId = rows[0].id_usuario;
  request.sessionId = rows[0].id_sesion;
  request.userRole = rows[0].role;
  return next();
}

// Va después de requireAuth: deja pasar solo a profesores (y administradores).
function requireTeacher(request, _response, next) {
  if (request.userRole !== 'PROFESOR' && request.userRole !== 'ADMIN') {
    throw new HttpError(403, 'FORBIDDEN', 'Solo para profesores');
  }
  return next();
}

module.exports = { requireAuth, requireTeacher };
