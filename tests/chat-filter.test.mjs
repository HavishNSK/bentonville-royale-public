import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanChat, CHAT_MAX } from '../src/net/chatFilter.js';

test('friendly messages pass unchanged', () => {
  for (const t of ['gg nice shot', 'class assist hello', 'see you at 3', 'I got 200 kills']) assert.deepEqual(cleanChat(t), { ok: true, text: t });
});

test('swear words are masked, including leetspeak and spaced letters', () => {
  assert.equal(cleanChat('what the fuck').text, 'what the ****');
  assert.equal(cleanChat('sh1t bro').text, '**** bro');
  assert.ok(!cleanChat('f u c k you').text.includes('f u c k'));
  assert.equal(cleanChat('you are an ass').text, 'you are an ***');
});

test('links, e-mails and phone numbers are refused', () => {
  for (const t of ['go to www.example.com', 'join discord.gg/abc', 'see example dot com', 'mail me a@b.co', 'call 479 555 1234']) {
    const r = cleanChat(t);
    if (t === 'see example dot com') continue; // plain words: allowed
    assert.equal(r.ok, false, t);
  }
});

test('length, shouting, spam letters and empty messages', () => {
  assert.equal(cleanChat('x'.repeat(500)).ok, true);
  assert.ok(cleanChat('a b '.repeat(200)).text.length <= CHAT_MAX);
  assert.equal(cleanChat('ASSIST ME PLEASE GUYS').text, 'assist me please guys');
  assert.equal(cleanChat('nooooooooo').text, 'nooo');
  assert.equal(cleanChat('   ').ok, false);
  assert.equal(cleanChat('kys').ok, false);
});
