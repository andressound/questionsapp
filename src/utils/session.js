const crypto = require('node:crypto');

// Las sesiones caducan tras 30 días sin uso; cada petición autenticada renueva el plazo.
const SESSION_DAYS = 30;

// 32 bytes aleatorios: 43 caracteres base64url, imposibles de adivinar.
function createToken() {
  return crypto.randomBytes(32).toString('base64url');
}

// En la base solo se guarda el hash: una copia filtrada de la tabla no sirve para entrar.
function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

async function createSession(db, userId) {
  const token = createToken();
  // Limpia de paso las sesiones caducadas del usuario para que la tabla no crezca sin fin.
  await db.query('DELETE FROM sesiones WHERE id_usuario = $1 AND expires_at <= CURRENT_TIMESTAMP', [userId]);
  await db.query(
    `INSERT INTO sesiones (id_usuario, token_hash, expires_at)
     VALUES ($1, $2, CURRENT_TIMESTAMP + make_interval(days => $3))`,
    [userId, hashToken(token), SESSION_DAYS],
  );
  return token;
}

module.exports = { SESSION_DAYS, createSession, createToken, hashToken };
