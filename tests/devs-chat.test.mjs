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

// ---- verified account titles (CHULDE)
import { titleForName, cleanTitle, PLAYER_TITLES } from '../src/net/devs.js';

test('TheChosenOne has the CHULDE title in #facece; nobody else does', () => {
  assert.deepEqual(titleForName('TheChosenOne'), { title: 'CHULDE', color: '#facece' });
  assert.deepEqual(titleForName('thechosenone'), { title: 'CHULDE', color: '#facece' });
  assert.equal(titleForName('TheChosenOne2'), null);
  assert.equal(titleForName('havish'), null);
  for (const t of Object.values(PLAYER_TITLES)) assert.ok(cleanTitle(t.title, t.color), 'table entries pass the wire check');
});

test('titles off the wire are shape-checked (no markup, only #rrggbb colours)', () => {
  assert.deepEqual(cleanTitle('CHULDE', '#FACECE'), { title: 'CHULDE', color: '#facece' });
  assert.equal(cleanTitle('<b>X</b>', '#facece'), null);
  assert.equal(cleanTitle('', '#facece'), null);
  assert.deepEqual(cleanTitle('CHULDE', 'red;background:url(x)'), { title: 'CHULDE', color: null });
});

test('a verified account grants CHULDE; a typed nickname or a guest does not', async () => {
  const { accountGrants } = await import('../src/net/devs.js');
  // the presence server applies exactly these grants after its Accounts lookup
  const src = (await import('node:fs')).readFileSync(new URL('../party/presence.js', import.meta.url), 'utf8');
  assert.match(src, /const g = accountGrants\(name(, info\.title)?\);/); // + a dev-made title from the account
  assert.match(src, /p\.title = g\.title;/);
  assert.match(src, /m\.title = p\.title;\n\s+m\.color = p\.titleColor;/, 'chat lines carry the title and colour');
  assert.deepEqual(accountGrants('TheChosenOne'), { dev: false, shown: 'TheChosenOne', title: 'CHULDE', titleColor: '#facece' });
  assert.deepEqual(accountGrants('SomeoneElse'), { dev: false, shown: '', title: '', titleColor: '' }, 'typing the name gives nothing: grants follow the account');
  assert.deepEqual(accountGrants(null), { dev: false, shown: '', title: '', titleColor: '' });
  assert.equal(accountGrants('havish').dev, true);
  assert.equal(accountGrants('havish').title, '');
});
