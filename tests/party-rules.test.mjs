import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cleanToken, coerceMode, createSettings, joinReject, joinMode,
  setGameDecision, setModeDecision, ticketMembers, ticketTime, modeLabel,
} from '../party/partyRules.js';

test('cleanToken strips unsafe characters and caps length', () => {
  assert.equal(cleanToken('ab<c>-_9'), 'abc-_9');
  assert.equal(cleanToken('x'.repeat(60)).length, 40);
  assert.equal(cleanToken(null), '');
  assert.equal(cleanToken({ toString: () => 'ok' }), 'ok');
});

test('modeLabel names the team sizes', () => {
  assert.equal(modeLabel('duo'), 'Duos');
  assert.equal(modeLabel('squad'), 'Squads');
  assert.equal(modeLabel('ffa'), 'Free-for-all');
  assert.equal(modeLabel('__proto__'), 'Solos');
});

test('coerceMode: no squad in Box Fights; invalid falls back to a fitting mode', () => {
  assert.equal(coerceMode('boxfights', 'squad', 1), 'solo');
  assert.equal(coerceMode('boxfights', 'ffa', 3), 'ffa');
  assert.equal(coerceMode('boxfights', 'duo', 3), 'trio');
  assert.equal(coerceMode('br', 'squad', 1), 'squad');
  assert.equal(coerceMode('br', 'nonsense', 1), 'solo');
  assert.equal(coerceMode('br', '__proto__', 2), 'duo');
  assert.equal(coerceMode('boxfights', 'solo', 4), 'ffa');
  assert.equal(coerceMode('boxfights', 'solo', 7), null);
  assert.equal(coerceMode('br', 'ffa', 1), 'solo');
});

test('createSettings reads game/mode/fill from the create query', () => {
  const q = (o) => ({ get: (k) => (k in o ? o[k] : null) });
  assert.deepEqual(createSettings(q({})), { game: 'br', mode: 'solo', fill: true });
  assert.deepEqual(createSettings(q({ game: 'boxfights', mode: 'squad', fill: '0' })), { game: 'boxfights', mode: 'solo', fill: false });
  assert.deepEqual(createSettings(q({ game: 'boxfights', mode: 'ffa' })), { game: 'boxfights', mode: 'ffa', fill: true });
  assert.deepEqual(createSettings(q({ game: 'evil', mode: 'duo' })), { game: 'br', mode: 'duo', fill: true });
  assert.deepEqual(createSettings(q({ game: 'boxfights', mode: 'constructor' })), { game: 'boxfights', mode: 'solo', fill: true });
});

test('joinReject: taken / notFound / full / fullBox / busy', () => {
  const base = { create: false, members: 1, state: 'idle', game: 'br' };
  assert.equal(joinReject(base), null);
  assert.equal(joinReject({ ...base, create: true }), 'taken');
  assert.equal(joinReject({ ...base, create: true, members: 0 }), null);
  assert.equal(joinReject({ ...base, members: 0 }), 'notFound');
  assert.equal(joinReject({ ...base, members: 3 }), null);
  assert.equal(joinReject({ ...base, members: 4 }), 'full');
  assert.equal(joinReject({ ...base, game: 'boxfights', members: 2 }), null);
  assert.equal(joinReject({ ...base, game: 'boxfights', members: 3 }), null);
  assert.equal(joinReject({ ...base, game: 'boxfights', members: 4 }), 'fullBox');
  assert.equal(joinReject({ ...base, state: 'queued' }), 'busy');
});

test('joinMode bumps the mode within the game', () => {
  assert.equal(joinMode('br', 'solo', 2), 'duo');
  assert.equal(joinMode('br', 'trio', 4), 'squad');
  assert.equal(joinMode('br', 'squad', 2), 'squad');
  assert.equal(joinMode('boxfights', 'solo', 3), 'trio');
  assert.equal(joinMode('boxfights', 'duo', 2), 'duo');
  // never leaves the game's modes; keeps the current mode if nothing fits
  assert.equal(joinMode('boxfights', 'trio', 4), 'ffa');
  assert.equal(joinMode('boxfights', 'trio', 7), 'trio');
});

test('setGameDecision: validates, refuses >4, squad becomes a Box Fights mode that fits', () => {
  assert.equal(setGameDecision({ game: 'br', mode: 'solo', members: 1, next: 'chess' }), null);
  assert.equal(setGameDecision({ game: 'br', mode: 'solo', members: 1, next: '__proto__' }), null);
  assert.equal(setGameDecision({ game: 'br', mode: 'solo', members: 1, next: 'br' }), null);
  assert.deepEqual(setGameDecision({ game: 'br', mode: 'squad', members: 5, next: 'boxfights' }), { error: 'Parties are up to 4 players' });
  assert.deepEqual(setGameDecision({ game: 'br', mode: 'squad', members: 4, next: 'boxfights' }), { game: 'boxfights', mode: 'ffa', modeChanged: true });
  assert.deepEqual(setGameDecision({ game: 'br', mode: 'squad', members: 2, next: 'boxfights' }), { game: 'boxfights', mode: 'duo', modeChanged: true });
  assert.deepEqual(setGameDecision({ game: 'boxfights', mode: 'ffa', members: 2, next: 'br' }), { game: 'br', mode: 'duo', modeChanged: true });
  assert.deepEqual(setGameDecision({ game: 'br', mode: 'duo', members: 2, next: 'boxfights' }), { game: 'boxfights', mode: 'duo', modeChanged: false });
  assert.deepEqual(setGameDecision({ game: 'boxfights', mode: 'trio', members: 3, next: 'br' }), { game: 'br', mode: 'trio', modeChanged: false });
});

test('setModeDecision validates the mode for the game and party size', () => {
  assert.equal(setModeDecision({ game: 'boxfights', members: 1, next: 'squad' }), null);
  assert.deepEqual(setModeDecision({ game: 'boxfights', members: 4, next: 'ffa' }), { mode: 'ffa' });
  assert.equal(setModeDecision({ game: 'br', members: 1, next: 'ffa' }), null);
  assert.equal(setModeDecision({ game: 'br', members: 1, next: 'hasOwnProperty' }), null);
  assert.deepEqual(setModeDecision({ game: 'br', members: 1, next: 'squad' }), { mode: 'squad' });
  assert.deepEqual(setModeDecision({ game: 'boxfights', members: 3, next: 'duo' }), { error: 'Your party has 3 players. That mode fits 2.' });
  assert.deepEqual(setModeDecision({ game: 'boxfights', members: 2, next: 'duo' }), { mode: 'duo' });
});

test('ticketMembers: caps, drops junk, cleans tokens', () => {
  const ms = ticketMembers([{ token: 'a<b', name: 'x', leader: 1 }, null, 'str', { token: '!!!' }, { token: 'c' }, { token: 'd' }], 2);
  assert.deepEqual(ms, [{ token: 'ab', name: 'x', leader: true }, { token: 'c', name: '', leader: false }]);
  assert.deepEqual(ticketMembers('nope', 3), []);
});

test('ticketTime clamps untrusted timestamps', () => {
  const now = 1_000_000;
  assert.equal(ticketTime(undefined, now), now);
  assert.equal(ticketTime('5', now), now);
  assert.equal(ticketTime(now + 5000, now), now);
  assert.equal(ticketTime(now - 3000, now), now - 3000);
  assert.equal(ticketTime(1, now), now - 600000);
  assert.equal(ticketTime(NaN, now), now);
});
