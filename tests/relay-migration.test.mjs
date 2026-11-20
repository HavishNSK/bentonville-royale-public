// Relay host migration for lobby matches (party/relayMigration.js, used by party/server.js Main).
import test from 'node:test';
import assert from 'node:assert/strict';
import { HOST_GRACE_MS, hostClosedDecision, promoteDecision, rosterAfterPromotion, cleanRelayToken } from '../party/relayMigration.js';

const guests = new Map([
  [1, { token: 'aaa', name: 'Ann' }],
  [2, { token: 'bbb', name: 'Bo' }],
]);

test('rooms without a lobby keep the old behaviour: host gone -> bye', () => {
  assert.deepEqual(hostClosedDecision({ lobbyManaged: false, pendingToken: 'aaa', guests }), { action: 'bye' });
});

test('lobby room, no guests -> bye', () => {
  assert.deepEqual(hostClosedDecision({ lobbyManaged: true, pendingToken: 'aaa', guests: new Map() }), { action: 'bye' });
});

test('lobby room with an already-named successor who is connected -> promote now', () => {
  assert.deepEqual(hostClosedDecision({ lobbyManaged: true, pendingToken: 'bbb', guests }), { action: 'promote', slot: 2 });
});

test('lobby room, successor not named yet -> wait for the grace window', () => {
  assert.equal(HOST_GRACE_MS, 10000);
  assert.deepEqual(hostClosedDecision({ lobbyManaged: true, pendingToken: '', guests }), { action: 'wait' });
  assert.deepEqual(hostClosedDecision({ lobbyManaged: true, pendingToken: 'zzz', guests }), { action: 'wait' });
});

test('promote from the lobby server: stored while the host is still here, applied while waiting', () => {
  assert.deepEqual(promoteDecision({ hostConnected: true, waiting: false, token: 'aaa', guests }), { action: 'pending' });
  assert.deepEqual(promoteDecision({ hostConnected: false, waiting: true, token: 'aaa', guests }), { action: 'promote', slot: 1 });
  assert.deepEqual(promoteDecision({ hostConnected: false, waiting: true, token: 'nobody', guests }), { action: 'pending' });
  assert.deepEqual(promoteDecision({ hostConnected: false, waiting: false, token: 'aaa', guests }), { action: 'ignore' });
  assert.deepEqual(promoteDecision({ hostConnected: false, waiting: true, token: '', guests }), { action: 'ignore' });
});

test('roster for the new host: the other guests with their tokens', () => {
  assert.deepEqual(rosterAfterPromotion(guests, 1), [{ id: 2, name: 'Bo', token: 'bbb' }]);
});

test('relay tokens are cleaned like party tokens', () => {
  assert.equal(cleanRelayToken('ab<c>-_9'), 'abc-_9');
  assert.equal(cleanRelayToken('x'.repeat(60)).length, 40);
  assert.equal(cleanRelayToken(undefined), '');
});
