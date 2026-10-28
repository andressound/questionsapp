const test = require('node:test');
const assert = require('node:assert/strict');
const { MAX_STREAK_BONUS, streakBonus } = require('../src/utils/streak');

test('el bonus de racha es un punto por día con tope', () => {
  assert.equal(streakBonus(0), 0);
  assert.equal(streakBonus(1), 1);
  assert.equal(streakBonus(MAX_STREAK_BONUS), MAX_STREAK_BONUS);
  assert.equal(streakBonus(25), MAX_STREAK_BONUS);
});
