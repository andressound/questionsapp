const { pool } = require('../config/database');
const HttpError = require('../utils/http-error');
const { duplicateUserMessage, normalizeEmail, validEmail, verifyPassword } = require('../utils/auth');
const { pointsSql } = require('../utils/progress');

const UNIQUE_VIOLATION = '23505';
const MAX_FIELD_LENGTH = 100;

// Todos los estudiantes (los profesores no compiten) con sus puntos y su puesto: más puntos primero y, a igualdad, por nombre.
const RANKED_USERS = `
  WITH puntos AS (
    SELECT u.id_usuario AS id,
           u.username,
           ${pointsSql('u.id_usuario')} AS puntos_totales
      FROM usuarios u
     WHERE u.role = 'ESTUDIANTE'
  )
  SELECT ROW_NUMBER() OVER (ORDER BY puntos_totales DESC, username ASC) AS posicion,
         id, username, puntos_totales
    FROM puntos`;

function rankingEntry(row) {
  return {
    posicion: Number(row.posicion),
    id: row.id,
    username: row.username,
    puntos_totales: Number(row.puntos_totales),
  };
}

async function ranking(request, response) {
  const requestedLimit = Number.parseInt(request.query.limit, 10);
  const limit = Number.isInteger(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 50) : 5;
  const { rows } = await pool.query(`${RANKED_USERS} ORDER BY posicion LIMIT $1`, [limit]);
  return response.json(rows.map(rankingEntry));
}

// Puesto del usuario de la sesión, aunque quede fuera de la lista que muestra la app.
async function myRanking(request, response) {
  const { rows } = await pool.query(`SELECT * FROM (${RANKED_USERS}) AS ranked WHERE id = $1`, [request.userId]);
  if (!rows[0]) {
    throw new HttpError(404, 'USER_NOT_FOUND', 'Usuario no encontrado');
  }
  return response.json(rankingEntry(rows[0]));
}

// Solo el dueño de la sesión puede editar su cuenta, y confirma el cambio con la contraseña actual.
async function updateProfile(request, response) {
  const userId = Number(request.params.id);
  const { username, email, password } = request.body || {};
  const newUsername = username === undefined ? undefined : normalizeEmail(username);
  const newEmail = email === undefined ? undefined : normalizeEmail(email);

  if (!Number.isInteger(userId) || userId <= 0) {
    throw new HttpError(400, 'VALIDATION_ERROR', 'Usuario inválido');
  }
  if (userId !== request.userId) {
    throw new HttpError(403, 'FORBIDDEN', 'No puedes editar otra cuenta');
  }
  if (newUsername === undefined && newEmail === undefined) {
    throw new HttpError(400, 'VALIDATION_ERROR', 'No hay cambios que guardar');
  }
  if (newUsername !== undefined && (newUsername === '' || newUsername.length > MAX_FIELD_LENGTH)) {
    throw new HttpError(400, 'VALIDATION_ERROR', 'Nombre de usuario inválido');
  }
  if (newEmail !== undefined && (!validEmail(newEmail) || newEmail.length > MAX_FIELD_LENGTH)) {
    throw new HttpError(400, 'VALIDATION_ERROR', 'Correo electrónico inválido');
  }
  if (typeof password !== 'string' || password === '') {
    throw new HttpError(401, 'INVALID_CREDENTIALS', 'Contraseña incorrecta');
  }

  const { rows } = await pool.query('SELECT password_hash FROM usuarios WHERE id_usuario = $1', [userId]);
  if (!rows[0]) {
    throw new HttpError(404, 'USER_NOT_FOUND', 'Usuario no encontrado');
  }
  if (!(await verifyPassword(password, rows[0].password_hash))) {
    throw new HttpError(401, 'INVALID_CREDENTIALS', 'Contraseña incorrecta');
  }

  try {
    const { rows: updated } = await pool.query(
      `UPDATE usuarios
          SET username = COALESCE($1, username),
              email = COALESCE($2, email)
        WHERE id_usuario = $3
        RETURNING id_usuario AS id, username, email`,
      [newUsername ?? null, newEmail ?? null, userId],
    );
    return response.json(updated[0]);
  } catch (error) {
    if (error.code === UNIQUE_VIOLATION) {
      throw new HttpError(409, 'DUPLICATE_USER', duplicateUserMessage(error));
    }
    throw error;
  }
}

module.exports = { myRanking, ranking, updateProfile };
