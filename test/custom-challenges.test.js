const test = require('node:test');
const assert = require('node:assert/strict');
const {
  CODE_ALPHABET,
  generateCode,
  parseCode,
  validateNewChallenge,
} = require('../src/controllers/custom-challenges.controller');

const valid = { titulo: '  Repaso de pilas ', preguntas: [3, 1, 7], segundosPregunta: 20, daPuntos: false, duracionHoras: 24 };

function assertInvalid(body) {
  assert.throws(() => validateNewChallenge(body), (error) => error.status === 400 && error.code === 'VALIDATION_ERROR');
}

test('acepta un reto válido y conserva el orden de las preguntas', () => {
  assert.deepEqual(validateNewChallenge(valid), { ...valid, titulo: 'Repaso de pilas' });
});

test('rechaza títulos vacíos o largos', () => {
  assertInvalid(undefined);
  assertInvalid({ ...valid, titulo: ' ' });
  assertInvalid({ ...valid, titulo: 'a'.repeat(151) });
});

test('exige entre 1 y 20 preguntas distintas', () => {
  assertInvalid({ ...valid, preguntas: [] });
  assertInvalid({ ...valid, preguntas: [1, 1] });
  assertInvalid({ ...valid, preguntas: [1, '2'] });
  assertInvalid({ ...valid, preguntas: [0] });
  assertInvalid({ ...valid, preguntas: Array.from({ length: 21 }, (_, i) => i + 1) });
});

test('solo acepta los cronómetros y duraciones de la app', () => {
  assertInvalid({ ...valid, segundosPregunta: 25 });
  assertInvalid({ ...valid, duracionHoras: 5 });
  assertInvalid({ ...valid, daPuntos: 'si' });
  for (const segundosPregunta of [10, 15, 20, 30, 45, 60]) {
    assert.equal(validateNewChallenge({ ...valid, segundosPregunta }).segundosPregunta, segundosPregunta);
  }
});

test('genera códigos de 6 caracteres sin letras ambiguas', () => {
  for (let i = 0; i < 200; i++) {
    const code = generateCode();
    assert.equal(code.length, 6);
    assert.ok([...code].every((char) => CODE_ALPHABET.includes(char)), code);
    assert.equal(parseCode(code), code);
  }
});

test('normaliza el código escrito por el estudiante', () => {
  assert.equal(parseCode(' abc234 '), 'ABC234');
  assert.equal(parseCode('ABC10O'), null);
  assert.equal(parseCode('ABC'), null);
  assert.equal(parseCode(undefined), null);
});
