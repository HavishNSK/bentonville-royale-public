import test from 'node:test';
import assert from 'node:assert/strict';
import { isDevName, parseDevChat } from '../src/net/devs.js';

test('only allowlisted dev accounts match', () => {
  for (const n of ['Sumukh', 'havish', 'GECKO', 'Shehryar', 'Rakkart13']) assert.equal(isDevName(n), true);
  assert.equal(isDevName('Havishh'), false);
  assert.equal(isDevName('Player'), false);
});

test('announcements are dev-only and the command is stripped', () => {
  assert.deepEqual(parseDevChat('hello', false), { announce: false, text: 'hello' });
  assert.equal(parseDevChat('/announce the servers are up', false).error, 'Only developers can send announcements.');
  assert.equal(parseDevChat('/announce', true).error, 'Write an announcement after /announce.');
  assert.deepEqual(parseDevChat('/Announce  match is live', true), { announce: true, text: 'match is live' });
});
