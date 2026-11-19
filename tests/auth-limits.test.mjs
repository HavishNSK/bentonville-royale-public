// Account-server hardening helpers (party/authLimits.js): login / sign-up throttles, password rules,
// dev re-auth freshness, origin allowlist, and security-log sanitizing.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LOGIN_FAILS,
  LOGIN_WINDOW_MS,
  SIGNUP_PER_HOUR,
  MOD_AUTH_MS,
  createLimiter,
  passwordProblem,
  modAuthFresh,
  originAllowed,
  secLogEntry,
} from '../party/authLimits.js';

const NOW = 1_800_000_000_000;

test('login: 5 failures in the window block, with a growing delay', () => {
  const lim = createLimiter();
  for (let i = 0; i < LOGIN_FAILS; i++) {
    assert.equal(lim.loginWait('acct:foo', NOW + i), 0);
    lim.loginFail('acct:foo', NOW + i);
  }
  const first = lim.loginWait('acct:foo', NOW + LOGIN_FAILS);
  assert.ok(first > 0, 'blocked after 5 failures');
  lim.loginFail('acct:foo', NOW + LOGIN_FAILS + first); // one more after waiting
  const second = lim.loginWait('acct:foo', NOW + LOGIN_FAILS + first);
  assert.ok(second > first, 'the delay grows');
  assert.ok(second <= LOGIN_WINDOW_MS, 'capped at the window');
});

test('login: failures expire after the window, and a success clears the account', () => {
  const lim = createLimiter();
  for (let i = 0; i < LOGIN_FAILS; i++) lim.loginFail('acct:foo', NOW);
  assert.ok(lim.loginWait('acct:foo', NOW) > 0);
  assert.equal(lim.loginWait('acct:foo', NOW + LOGIN_WINDOW_MS + 1), 0);
  for (let i = 0; i < LOGIN_FAILS; i++) lim.loginFail('acct:bar', NOW);
  lim.loginOk('acct:bar');
  assert.equal(lim.loginWait('acct:bar', NOW), 0);
});

test('login: keys are independent (one IP does not block another account)', () => {
  const lim = createLimiter();
  for (let i = 0; i < LOGIN_FAILS; i++) lim.loginFail('ip:1.2.3.4', NOW);
  assert.ok(lim.loginWait('ip:1.2.3.4', NOW) > 0);
  assert.equal(lim.loginWait('ip:5.6.7.8', NOW), 0);
});

test('sign-up: SIGNUP_PER_HOUR per IP', () => {
  const lim = createLimiter();
  for (let i = 0; i < SIGNUP_PER_HOUR; i++) assert.equal(lim.signupOk('1.2.3.4', NOW + i), true);
  assert.equal(lim.signupOk('1.2.3.4', NOW + 10), false);
  assert.equal(lim.signupOk('9.9.9.9', NOW + 10), true);
  assert.equal(lim.signupOk('1.2.3.4', NOW + 3600e3 + 10), true, 'resets after an hour');
});

test('the limiter prunes itself so memory stays bounded', () => {
  const lim = createLimiter({ maxKeys: 50 });
  for (let i = 0; i < 500; i++) lim.loginFail('ip:' + i, NOW);
  assert.ok(lim.size() <= 50);
});

test('password rules: 8-72 characters, not a common password, any characters allowed', () => {
  assert.match(passwordProblem('short'), /8/);
  assert.match(passwordProblem('x'.repeat(73)), /72/);
  assert.match(passwordProblem('password123'), /common/);
  assert.match(passwordProblem('Qwertyuiop'), /common/, 'case-insensitive');
  assert.equal(passwordProblem('blue tractor in bentonville'), null, 'spaces allowed');
  assert.equal(passwordProblem('ünïcødé-pass'), null);
  assert.match(passwordProblem(null), /8/);
});

test('dev re-auth: a session signed in within MOD_AUTH_MS is fresh', () => {
  assert.equal(modAuthFresh({ authAt: NOW - 1000 }, NOW), true);
  assert.equal(modAuthFresh({ authAt: NOW - MOD_AUTH_MS - 1 }, NOW), false);
  assert.equal(modAuthFresh({}, NOW), false, 'old sessions without authAt must sign in again');
  assert.equal(modAuthFresh(null, NOW), false);
});

test('origin allowlist', () => {
  for (const o of [
    'https://bentonvilleroyale.vercel.app',
    'https://bentonvilleroyale-git-main-team.vercel.app',
    'https://games.crazygames.com',
    'https://www.crazygames.com',
    'http://localhost:5173',
    'http://127.0.0.1:4173',
  ])
    assert.equal(originAllowed(o), true, o);
  for (const o of ['https://evil.com', 'https://crazygames.com.evil.com', 'http://bentonvilleroyale.vercel.app', 'https://evilbentonvilleroyale.vercel.app', 'null'])
    assert.equal(originAllowed(o), false, o);
  assert.equal(originAllowed(null), true, 'no Origin = not a browser page (Worker-to-Worker); CORS does not apply');
  assert.equal(originAllowed('https://staging.example.org', 'https://staging.example.org, https://x.y'), true, 'extra origins from config');
});

test('security log entries are sanitized and never carry secrets', () => {
  const e = secLogEntry('login_fail', { user: 'Foo\nINJECTED', ip: '1.2.3.4', token: 'abc', password: 'p' }, NOW);
  assert.equal(e.type, 'login_fail');
  assert.equal(e.at, NOW);
  assert.equal(e.user, 'Foo INJECTED');
  assert.equal(e.ip, '1.2.3.4');
  assert.equal('token' in e, false);
  assert.equal('password' in e, false);
});
