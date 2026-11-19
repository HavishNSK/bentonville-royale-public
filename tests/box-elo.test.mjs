import test from 'node:test';
import assert from 'node:assert/strict';
import { ELO_START, ELO_MIN, ELO_MAX, BOT_ELO, expectedScore, kFactor, eloChange, teamAverage, clampElo, TIERS, tierOf } from '../src/game/BoxElo.js';

test('constants and frozen tables', () => {
  assert.equal(ELO_START, 1000);
  assert.equal(ELO_MIN, 100);
  assert.equal(ELO_MAX, 3000);
  assert.deepEqual({ ...BOT_ELO }, { easy: 800, normal: 1200, hard: 1600 });
  assert.ok(Object.isFrozen(BOT_ELO));
  assert.ok(Object.isFrozen(TIERS));
});

test('expectedScore', () => {
  assert.equal(expectedScore(1000, 1000), 0.5);
  assert.ok(Math.abs(expectedScore(1200, 1000) - 0.76) < 0.01);
  assert.ok(Math.abs(expectedScore(1400, 1000) - 0.909) < 0.01);
  assert.ok(Math.abs(expectedScore(1000, 1200) + expectedScore(1200, 1000) - 1) < 1e-9);
});

test('kFactor tiers', () => {
  assert.equal(kFactor(0, 1000), 40);
  assert.equal(kFactor(29, 3000), 40);
  assert.equal(kFactor(30, 1000), 20);
  assert.equal(kFactor(30, 2399), 20);
  assert.equal(kFactor(30, 2400), 10);
});

test('eloChange values', () => {
  assert.equal(eloChange({ rating: 1000, games: 0, oppRating: 1200, won: true }), 30);
  assert.equal(eloChange({ rating: 1000, games: 0, oppRating: 1200, won: false }), -10);
  assert.equal(eloChange({ rating: 1000, games: 50, oppRating: 1000, won: true }), 10);
  assert.ok(Number.isInteger(eloChange({ rating: 1013, games: 7, oppRating: 1111, won: true })));
});

test('equal K is zero-sum at equal ratings', () => {
  const w = eloChange({ rating: 1100, games: 40, oppRating: 1100, won: true });
  const l = eloChange({ rating: 1100, games: 40, oppRating: 1100, won: false });
  assert.equal(w + l, 0);
});

test('teamAverage', () => {
  assert.equal(teamAverage([1000, 1200]), 1100);
  assert.equal(teamAverage([]), ELO_START);
  assert.equal(teamAverage(undefined), ELO_START);
  assert.equal(teamAverage([NaN, Infinity, '5', 1400]), 1400);
  assert.equal(teamAverage([NaN]), ELO_START);
});

test('clampElo', () => {
  assert.equal(clampElo(NaN), 1000);
  assert.equal(clampElo('1500'), 1000);
  assert.equal(clampElo(undefined), 1000);
  assert.equal(clampElo(1e12), 3000);
  assert.equal(clampElo(-5), 100);
  assert.equal(clampElo(Infinity), 1000);
  assert.equal(clampElo(1000.6), 1001);
});

test('tierOf boundaries', () => {
  const id = (n) => tierOf(n).id;
  assert.equal(id(100), 'bronze');
  assert.equal(id(899), 'bronze');
  assert.equal(id(900), 'silver');
  assert.equal(id(1099), 'silver');
  assert.equal(id(1100), 'gold');
  assert.equal(id(1300), 'platinum');
  assert.equal(id(1500), 'diamond');
  assert.equal(id(1799), 'diamond');
  assert.equal(id(1800), 'champion');
  assert.equal(id(NaN), 'silver'); // non-finite counts as the 1000 start rating
  assert.deepEqual(Object.keys(tierOf(1000)).sort(), ['id', 'name']);
});

test('tiers are named around Bentonville', () => {
  assert.deepEqual(TIERS.map((t) => t.name), ['Trail Rat', 'Creek Hopper', 'Square Regular', 'Bridge Walker', 'Ozark Legend', 'Mayor of Bentonville']);
  assert.equal(tierOf(899).name, 'Trail Rat');
  assert.equal(tierOf(1000).name, 'Creek Hopper');
  assert.equal(tierOf(1800).name, 'Mayor of Bentonville');
});
