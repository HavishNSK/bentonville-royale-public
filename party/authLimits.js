// BENTONVILLE ROYALE — account-server hardening helpers (pure; tested in tests/auth-limits.test.mjs).
//
// - createLimiter(): in-memory login-failure and sign-up throttles for the single "global" Accounts
//   Durable Object. In memory on purpose (no storage write per attempt); the counters reset if the
//   object is evicted, which an attacker can't trigger on demand.
//   SECURITY TODO: no CAPTCHA after repeated failures yet (OWASP Authentication Cheat Sheet).
// - passwordProblem(): length 8-72, any characters, rejects a small list of very common passwords.
//   SECURITY TODO: a full breached-password check (HaveIBeenPwned k-anonymity) is not wired up.
// - modAuthFresh(): dev commands need a session that was signed in recently (no TOTP yet).
// - originAllowed(): browser Origin allowlist for the HTTP API and WebSockets.
// - secLogEntry(): one sanitized security-log row (no tokens or passwords, no control characters).

export const LOGIN_FAILS = 5; // failures per key inside the window before a wait is enforced
export const LOGIN_WINDOW_MS = 15 * 60e3;
export const LOGIN_BASE_WAIT_MS = 30e3; // first wait; doubles with each further failure
export const SIGNUP_PER_HOUR = 3; // new accounts per IP per hour
export const MOD_AUTH_MS = 12 * 3600e3; // a dev must have signed in this recently to use dev commands

/** In-memory throttles. `maxKeys` bounds memory (oldest keys are dropped first). */
export function createLimiter({ maxKeys = 5000 } = {}) {
  const fails = new Map(); // key -> [ms, ...] recent failures
  const signups = new Map(); // ip -> [ms, ...]

  const recent = (arr, now, win) => (arr || []).filter((t) => now - t < win);
  const bound = (map) => {
    while (map.size > maxKeys) map.delete(map.keys().next().value);
  };

  return {
    /** Milliseconds this key must wait before another login attempt (0 = go ahead). */
    loginWait(key, now) {
      const list = recent(fails.get(key), now, LOGIN_WINDOW_MS);
      if (list.length) fails.set(key, list);
      else fails.delete(key);
      if (list.length < LOGIN_FAILS) return 0;
      const wait = Math.min(LOGIN_WINDOW_MS, LOGIN_BASE_WAIT_MS * 2 ** (list.length - LOGIN_FAILS));
      return Math.max(0, list[list.length - 1] + wait - now);
    },
    loginFail(key, now) {
      const list = recent(fails.get(key), now, LOGIN_WINDOW_MS);
      list.push(now);
      fails.delete(key); // re-insert so the newest keys survive pruning
      fails.set(key, list);
      bound(fails);
    },
    loginOk(key) {
      fails.delete(key);
    },
    /** Counts one sign-up for this IP when allowed. */
    signupOk(ip, now) {
      const list = recent(signups.get(ip), now, 3600e3);
      if (list.length >= SIGNUP_PER_HOUR) return false;
      list.push(now);
      signups.delete(ip);
      signups.set(ip, list);
      bound(signups);
      return true;
    },
    size() {
      return fails.size + signups.size;
    },
  };
}

// The most common passwords from public breach corpora (lowercase). Small on purpose: it ships in
// the Worker. Not a substitute for a full breached-password check.
const COMMON = new Set(
  (
    'password password1 password12 password123 password1234 passw0rd p@ssword p@ssw0rd 12345678 123456789 1234567890 ' +
    '11111111 00000000 12341234 87654321 qwertyui qwertyuiop qwerty123 qwerty12 1q2w3e4r 1q2w3e4r5t asdfghjk asdfasdf ' +
    'iloveyou iloveyou1 sunshine princess football football1 baseball basketball superman batman123 starwars dragon123 ' +
    'letmein1 welcome1 welcome123 monkey123 abc12345 abcd1234 abcdefgh trustno1 whatever master123 shadow123 ' +
    'fortnite fortnite1 fortnite123 minecraft minecraft1 roblox123 pokemon1 charlie1 jordan23 michael1 computer ' +
    'bentonville royale123 battleroyale gamer123 videogames'
  ).split(' ')
);

/** Why a new password is not allowed, or null when it is fine. */
export function passwordProblem(pw) {
  const s = typeof pw === 'string' ? pw : '';
  if (s.length < 8) return 'Passwords need at least 8 characters.';
  if (s.length > 72) return 'Passwords can be at most 72 characters.';
  if (COMMON.has(s.toLowerCase())) return 'That password is too common. Pick something harder to guess.';
  return null;
}

/** Was this session signed in recently enough for dev commands? */
export function modAuthFresh(sess, now) {
  return !!sess && Number.isFinite(sess.authAt) && now - sess.authAt < MOD_AUTH_MS;
}

const ORIGIN_RULES = [
  /^https:\/\/bentonvilleroyale\.vercel\.app$/,
  /^https:\/\/bentonvilleroyale-[a-z0-9-]+\.vercel\.app$/, // Vercel preview deployments
  /^https:\/\/([a-z0-9-]+\.)*crazygames\.com$/, // the CrazyGames portal build
  /^http:\/\/(localhost|127\.0\.0\.1)(:\d{1,5})?$/, // local dev / preview
];

/**
 * Is a browser Origin allowed? `extra` is a comma-separated list from the ALLOWED_ORIGINS Worker var.
 * A missing Origin is allowed: it is not a browser page (Worker-to-Worker calls), and CORS does not
 * apply to it. This blocks other websites from using a player's browser against the API; it does
 * not stop a script that calls the API directly (rate limits and sessions cover that).
 */
export function originAllowed(origin, extra = '') {
  if (origin == null || origin === '') return true;
  const o = String(origin);
  if (ORIGIN_RULES.some((r) => r.test(o))) return true;
  return String(extra || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .includes(o);
}

const LOG_FIELDS = ['user', 'ip', 'target', 'by', 'reason', 'detail'];

/** One security-log row: allowlisted fields only, control characters removed, lengths capped. */
export function secLogEntry(type, fields = {}, now = Date.now()) {
  const row = { type: String(type).replace(/[^a-z_]/g, '').slice(0, 32), at: now };
  for (const k of LOG_FIELDS) {
    if (fields[k] == null) continue;
    row[k] = String(fields[k])
      .replace(/[\u0000-\u001f\u007f]+/g, ' ')
      .slice(0, 120);
  }
  return row;
}
