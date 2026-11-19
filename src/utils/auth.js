const crypto = require('node:crypto');
const { promisify } = require('node:util');

const scrypt = promisify(crypto.scrypt);

// scrypt nativo de Node: corre en el threadpool de libuv y no bloquea el event loop,
// a diferencia de bcryptjs (JS puro). Formato: scrypt$N$r$p$salt$hash (base64).
const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1 };
const KEY_LENGTH = 64;

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(password, salt, KEY_LENGTH, SCRYPT_PARAMS);
  const { N, r, p } = SCRYPT_PARAMS;
  return `scrypt$${N}$${r}$${p}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

function isLegacyHash(stored) {
  return /^\$2[aby]\$/.test(String(stored));
}

async function verifyPassword(password, stored) {
  if (isLegacyHash(stored)) {
    // Hashes bcrypt creados antes del cambio a scrypt; se cargan solo si hacen falta.
    return require('bcryptjs').compare(password, stored);
  }
  const [algorithm, N, r, p, salt, hash] = String(stored).split('$');
  if (algorithm !== 'scrypt' || !salt || !hash) {
    return false;
  }
  const expected = Buffer.from(hash, 'base64');
  const actual = await scrypt(password, Buffer.from(salt, 'base64'), expected.length, {
    N: Number(N),
    r: Number(r),
    p: Number(p),
  });
  return crypto.timingSafeEqual(actual, expected);
}

function validCredentials(username, password) {
  return typeof username === 'string' && username.trim() !== ''
    && typeof password === 'string' && password.length >= 8;
}

function validEmail(email) {
  return typeof email === 'string'
    && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function publicUser(user, streak = {}) {
  return {
    id: user.id_usuario,
    username: user.username,
    email: user.email,
    puntos_totales: Number(user.puntos_totales || 0),
    retos_completados: Number(user.retos_completados || 0),
    racha_actual: Number(streak.racha_actual || 0),
    racha_maxima: Number(streak.racha_maxima || 0),
    // Enum de PostgreSQL en minúsculas: 'estudiante', 'profesor' o 'admin'.
    rol: String(user.role || 'ESTUDIANTE').toLowerCase(),
  };
}

function normalizeEmail(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

// Mensaje para un UNIQUE violado en usuarios: dice qué campo está repetido.
function duplicateUserMessage(error) {
  return error.constraint === 'usuarios_email_key'
    ? 'El correo ya está registrado'
    : 'El nombre de usuario ya está en uso';
}

// Código secreto que da el rol de profesor al registrarse (TEACHER_SIGNUP_CODE).
// Sin código configurado nadie se registra como profesor. Se comparan los SHA-256
// para que timingSafeEqual reciba la misma longitud y no se filtre nada por tiempos.
function validTeacherCode(code, expected) {
  if (typeof code !== 'string' || typeof expected !== 'string' || expected === '') {
    return false;
  }
  const digest = (value) => crypto.createHash('sha256').update(value).digest();
  return crypto.timingSafeEqual(digest(code), digest(expected));
}

module.exports = {
  duplicateUserMessage,
  hashPassword,
  isLegacyHash,
  normalizeEmail,
  publicUser,
  validCredentials,
  validEmail,
  validTeacherCode,
  verifyPassword,
};
