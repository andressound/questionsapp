const test = require('node:test');
const assert = require('node:assert/strict');
const { createToken, hashToken } = require('../src/utils/session');

test('genera tokens base64url de 43 caracteres y distintos', () => {
  const first = createToken();
  const second = createToken();
  assert.match(first, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(first, second);
});

test('el hash del token es sha256 en hex y determinista', () => {
  const token = createToken();
  assert.match(hashToken(token), /^[0-9a-f]{64}$/);
  assert.equal(hashToken(token), hashToken(token));
  assert.notEqual(hashToken(token), hashToken(createToken()));
});
