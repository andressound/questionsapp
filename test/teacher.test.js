const test = require('node:test');
const assert = require('node:assert/strict');
const { validateNewQuestion } = require('../src/controllers/teacher.controller');

const valid = { enunciado: '  ¿Qué es una pila?  ', opciones: ['LIFO', ' FIFO ', 'Árbol', 'Grafo'], correcta: 0 };

function assertInvalid(body) {
  assert.throws(() => validateNewQuestion(body), (error) => error.status === 400 && error.code === 'VALIDATION_ERROR');
}

test('acepta una pregunta con 4 opciones y limpia los espacios', () => {
  assert.deepEqual(validateNewQuestion(valid), {
    enunciado: '¿Qué es una pila?',
    opciones: ['LIFO', 'FIFO', 'Árbol', 'Grafo'],
    correcta: 0,
  });
});

test('rechaza enunciados vacíos o demasiado largos', () => {
  assertInvalid(undefined);
  assertInvalid({ ...valid, enunciado: '   ' });
  assertInvalid({ ...valid, enunciado: 'a'.repeat(501) });
});

test('exige exactamente 4 opciones distintas y no vacías', () => {
  assertInvalid({ ...valid, opciones: ['a', 'b', 'c'] });
  assertInvalid({ ...valid, opciones: ['a', 'b', 'c', 'd', 'e'] });
  assertInvalid({ ...valid, opciones: ['a', 'b', 'c', ' '] });
  assertInvalid({ ...valid, opciones: ['a', 'b', 'c', 4] });
  assertInvalid({ ...valid, opciones: ['Pila', 'pila', 'c', 'd'] });
});

test('exige el índice de la opción correcta', () => {
  assertInvalid({ ...valid, correcta: undefined });
  assertInvalid({ ...valid, correcta: 4 });
  assertInvalid({ ...valid, correcta: -1 });
  assertInvalid({ ...valid, correcta: '1' });
});

test('solo deja pasar a profesores y administradores', () => {
  const { requireTeacher } = require('../src/middleware/auth');
  for (const userRole of ['PROFESOR', 'ADMIN']) {
    let passed = false;
    requireTeacher({ userRole }, {}, () => { passed = true; });
    assert.ok(passed, userRole);
  }
  assert.throws(() => requireTeacher({ userRole: 'ESTUDIANTE' }, {}, () => {}), (error) => error.status === 403 && error.code === 'FORBIDDEN');
});
