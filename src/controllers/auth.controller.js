const { pool } = require('../config/database');
const { teacherSignupCode } = require('../config/env');
const HttpError = require('../utils/http-error');
const {
  duplicateUserMessage,
  hashPassword,
  isLegacyHash,
  normalizeEmail,
  publicUser,
  validCredentials,
  validEmail,
  validTeacherCode,
  verifyPassword,
} = require('../utils/auth');
const { createSession } = require('../utils/session');
const { answeredSql, pointsSql } = require('../utils/progress');
const { getStreak } = require('../utils/streak');

const UNIQUE_VIOLATION = '23505';

async function register(request, response) {
  const { username, email, password, codigoProfesor } = request.body || {};
  const normalizedEmail = normalizeEmail(email);
  const normalizedUsername = normalizeEmail(username) || normalizedEmail;

  if (!validEmail(normalizedEmail)
    || !validCredentials(normalizedUsername, password)) {
    throw new HttpError(400, 'VALIDATION_ERROR', 'Correo y contraseña inválidos');
  }
  // El rol no se elige: solo quien conoce el código del servidor se registra como profesor.
  const asTeacher = codigoProfesor !== undefined && codigoProfesor !== null && codigoProfesor !== '';
  if (asTeacher && !validTeacherCode(codigoProfesor, teacherSignupCode)) {
    throw new HttpError(403, 'INVALID_TEACHER_CODE', 'Código de profesor inválido');
  }
  const role = asTeacher ? 'PROFESOR' : 'ESTUDIANTE';

  try {
    const passwordHash = await hashPassword(password);
    const { rows } = await pool.query(
      'INSERT INTO usuarios (username, email, password_hash, role) VALUES ($1, $2, $3, $4) RETURNING id_usuario',
      [normalizedUsername, normalizedEmail, passwordHash, role],
    );
    const token = await createSession(pool, rows[0].id_usuario);
    return response.status(201).json({
      id: rows[0].id_usuario,
      username: normalizedUsername,
      email: normalizedEmail,
      puntos_totales: 0,
      retos_completados: 0,
      racha_actual: 0,
      racha_maxima: 0,
      rol: role.toLowerCase(),
      token,
    });
  } catch (error) {
    if (error.code === UNIQUE_VIOLATION) {
      throw new HttpError(409, 'DUPLICATE_USER', duplicateUserMessage(error));
    }
    throw error;
  }
}

async function login(request, response) {
  const { username, password } = request.body || {};
  const normalizedUsername = normalizeEmail(username);

  if (!validCredentials(normalizedUsername, password)) {
    throw new HttpError(401, 'INVALID_CREDENTIALS', 'Credenciales inválidas');
  }

  const user = await findUserWithProgress('u.username = $1 OR u.email = $1', normalizedUsername);
  if (!user || !(await verifyPassword(password, user.password_hash))) {
    throw new HttpError(401, 'INVALID_CREDENTIALS', 'Credenciales inválidas');
  }
  if (isLegacyHash(user.password_hash)) {
    await pool.query(
      'UPDATE usuarios SET password_hash = $1 WHERE id_usuario = $2',
      [await hashPassword(password), user.id_usuario],
    );
  }
  const token = await createSession(pool, user.id_usuario);
  const streak = await getStreak(pool, user.id_usuario);
  return response.json({ ...publicUser(user, streak), token });
}

// Datos del usuario de la sesión; la app lo pide al arrancar para restaurar la sesión.
async function me(request, response) {
  const user = await findUserWithProgress('u.id_usuario = $1', request.userId);
  if (!user) {
    throw new HttpError(401, 'UNAUTHORIZED', 'Sesión no válida o caducada');
  }
  return response.json(publicUser(user, await getStreak(pool, user.id_usuario)));
}

async function logout(request, response) {
  await pool.query('DELETE FROM sesiones WHERE id_sesion = $1', [request.sessionId]);
  return response.status(204).end();
}

// Usuario con sus puntos (incluido el bonus de racha) y retos respondidos.
// `where` es un fragmento fijo de este archivo.
async function findUserWithProgress(where, value) {
  const { rows } = await pool.query(
    `SELECT u.id_usuario, u.username, u.email, u.password_hash, u.role,
            ${pointsSql('u.id_usuario')} AS puntos_totales,
            ${answeredSql('u.id_usuario')} AS retos_completados
       FROM usuarios u
      WHERE ${where}
      LIMIT 1`,
    [value],
  );
  return rows[0];
}

module.exports = { login, logout, me, register };
