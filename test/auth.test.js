const test = require('node:test');
const assert = require('node:assert/strict');
const { duplicateUserMessage, normalizeEmail, validCredentials, validEmail } = require('../src/utils/auth');

test('normaliza correos para el registro', () => {
  assert.equal(normalizeEmail('  Persona@Example.COM '), 'persona@example.com');
});

test('indica qué campo del usuario está repetido', () => {
  assert.equal(duplicateUserMessage({ constraint: 'usuarios_email_key' }), 'El correo ya está registrado');
  assert.equal(duplicateUserMessage({ constraint: 'usuarios_username_key' }), 'El nombre de usuario ya está en uso');
});

test('acepta credenciales de registro validas', () => {
  assert.equal(validEmail('persona@example.com'), true);
  assert.equal(validCredentials('persona@example.com', 'password123'), true);
});

test('rechaza correo invalido o contrasena corta', () => {
  assert.equal(validEmail('persona@example'), false);
  assert.equal(validCredentials('persona@example.com', 'corta'), false);
});
test('hashea y verifica contrasenas con scrypt', async () => {
  const { hashPassword, verifyPassword } = require('../src/utils/auth');
  const stored = await hashPassword('password123');
  assert.match(stored, /^scrypt\$16384\$8\$1\$/);
  assert.notEqual(await hashPassword('password123'), stored);
  assert.equal(await verifyPassword('password123', stored), true);
  assert.equal(await verifyPassword('otraClave123', stored), false);
  assert.equal(await verifyPassword('password123', 'formato-desconocido'), false);
});

test('verifica hashes bcrypt heredados', async () => {
  const bcrypt = require('bcryptjs');
  const { isLegacyHash, verifyPassword } = require('../src/utils/auth');
  const legacy = await bcrypt.hash('password123', 4);
  assert.equal(isLegacyHash(legacy), true);
  assert.equal(await verifyPassword('password123', legacy), true);
  assert.equal(await verifyPassword('otraClave123', legacy), false);
});

test('el usuario público incluye su racha', () => {
  const { publicUser } = require('../src/utils/auth');
  const user = { id_usuario: 1, username: 'ana', email: 'ana@example.com', puntos_totales: '12', retos_completados: '5' };
  const withStreak = publicUser(user, { racha_actual: '3', racha_maxima: '7' });
  assert.equal(withStreak.racha_actual, 3);
  assert.equal(withStreak.racha_maxima, 7);
  assert.equal(publicUser(user).racha_actual, 0);
  assert.equal(publicUser(user).racha_maxima, 0);
});

test('el usuario público lleva su rol en minúsculas', () => {
  const { publicUser } = require('../src/utils/auth');
  assert.equal(publicUser({ id_usuario: 1, username: 'ana', role: 'PROFESOR' }).rol, 'profesor');
  assert.equal(publicUser({ id_usuario: 2, username: 'leo', role: 'ESTUDIANTE' }).rol, 'estudiante');
  assert.equal(publicUser({ id_usuario: 3, username: 'sin-rol' }).rol, 'estudiante');
});
