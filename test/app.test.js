const test = require('node:test');
const assert = require('node:assert/strict');
const app = require('../src/app');
const { pool } = require('../src/config/database');

let server;
let baseUrl;

test.before(async () => {
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await pool.end();
});

async function postJson(path, body) {
  return fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
  });
}

test('responde 404 en JSON para rutas desconocidas', async () => {
  const response = await fetch(`${baseUrl}/no-existe`);
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: { code: 'NOT_FOUND', message: 'Ruta no encontrada' } });
});

test('rechaza JSON mal formado', async () => {
  const response = await postJson('/api/auth/login', '{"username":');
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, 'INVALID_JSON');
});

test('rechaza cuerpos demasiado grandes', async () => {
  const response = await postJson('/api/auth/login', JSON.stringify({ username: 'x'.repeat(20_000) }));
  assert.equal(response.status, 413);
});

test('valida el registro sin tocar la base', async () => {
  const response = await postJson('/api/auth/register', JSON.stringify({ email: 'invalido', password: 'corta' }));
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, 'VALIDATION_ERROR');
});

test('exige sesión en las rutas protegidas sin tocar la base', async () => {
  for (const path of ['/api/preguntas/diarias', '/api/preguntas/semanales', '/api/usuarios/ranking', '/api/usuarios/ranking/me', '/api/auth/me', '/api/profesor/preguntas', '/api/profesor/retos', '/api/profesor/retos/1/estadisticas', '/api/retos-personalizados/ABC234']) {
    const response = await fetch(`${baseUrl}${path}`);
    assert.equal(response.status, 401, path);
    assert.equal((await response.json()).error.code, 'UNAUTHORIZED');
  }
  const answer = await postJson('/api/preguntas/semanales/1/responder', JSON.stringify({ opcionId: 1 }));
  assert.equal(answer.status, 401);
  const newQuestion = await postJson('/api/profesor/preguntas', JSON.stringify({ enunciado: 'x' }));
  assert.equal(newQuestion.status, 401);
  const customAnswer = await postJson('/api/retos-personalizados/ABC234/preguntas/1/responder', JSON.stringify({ opcionId: 1 }));
  assert.equal(customAnswer.status, 401);
});

test('rechaza cabeceras Authorization mal formadas sin tocar la base', async () => {
  for (const authorization of ['Bearer ', 'Bearer corto', 'Basic abcdefghijklmnopqrstuvwxyz', 'Bearer token con espacios largo']) {
    const response = await fetch(`${baseUrl}/api/auth/me`, { headers: { authorization } });
    assert.equal(response.status, 401, authorization);
  }
});

test('no expone la cabecera X-Powered-By', async () => {
  const response = await fetch(`${baseUrl}/no-existe`);
  assert.equal(response.headers.get('x-powered-by'), null);
});
