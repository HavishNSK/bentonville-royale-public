import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CHAT_ENABLED, chatOffReason } from '../src/net/chatFilter.js';

test('global chat is switched off', () => {
  assert.equal(CHAT_ENABLED, false);
  assert.equal(chatOffReason(), 'Chat is currently turned off.');
});

test('the title screen does not mount the chat panel while chat is off', () => {
  const src = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  assert.match(src, /CHAT_ENABLED/);
  assert.match(src, /if\s*\(\s*CHAT_ENABLED\s*&&\s*chatMod\s*\)/);
});

test('the presence server refuses chat messages while chat is off', () => {
  const src = readFileSync(new URL('../party/presence.js', import.meta.url), 'utf8');
  assert.match(src, /chatOffReason/);
});
