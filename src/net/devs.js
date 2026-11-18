// Developer accounts. The presence server checks the signed-in account (not the
// nickname) against this list before it grants the chat title or announcements.

export const DEV_NAMES = ['sumukh', 'havish', 'gecko', 'shehryar', 'rakkart13'];

const DEV_SET = new Set(DEV_NAMES);

export function isDevName(name) {
  return DEV_SET.has(String(name || '').trim().toLowerCase());
}

// Dev moderation commands, typed in global chat. Parsing is shared; the presence server only
// forwards them for a verified dev, and the account server checks the dev account again.
const MOD_USAGE = {
  ban: '/ban <username> [1h|1d|1w|1mo|perm] <reason>',
  warn: '/warn <username> <reason>',
  unban: '/unban <username>',
  history: '/history <username>',
  resetstats: '/resetstats <username>',
  flags: '/flags',
  reports: '/reports',
  dismiss: '/dismiss <username>',
  title: '/title <username> <TITLE> [#rrggbb]',
  untitle: '/untitle <username>',
};
const MOD_DURATIONS = { '1h': '1h', '1d': '1d', '1w': '1w', '1mo': '1mo', perm: 'perm', permanent: 'perm' };
const NEEDS_REASON = new Set(['ban', 'warn']);

/**
 * `/ban`, `/warn`, `/unban`, `/history`, `/resetstats`, `/flags`.
 * Returns null for normal chat, {error} for a malformed command, or {cmd, name, duration, reason}.
 * This decides nothing about permission.
 */
export function parseModCommand(text) {
  const m = String(text || '').trim().match(/^\/(\w+)(?:\s+([\s\S]*))?$/);
  if (!m) return null;
  const cmd = m[1].toLowerCase();
  if (!MOD_USAGE[cmd]) return null;
  const usage = `Usage: ${MOD_USAGE[cmd]}`;
  if (cmd === 'flags' || cmd === 'reports') return { cmd, name: '', duration: null, reason: '' };
  const words = (m[2] || '').trim().split(/\s+/).filter(Boolean);
  const name = words.shift();
  if (!name) return { error: usage };
  if (!/^[A-Za-z0-9_-]{3,16}$/.test(name)) return { error: `That is not a valid username. ${usage}` };
  let duration = null;
  if (cmd === 'ban' && words.length && MOD_DURATIONS[words[0].toLowerCase()]) duration = MOD_DURATIONS[words.shift().toLowerCase()];
  if (cmd === 'title') {
    // the title (stored in `reason`) is upper-cased; an optional #rrggbb colour can end the command
    const color = words.length && /^#[0-9a-f]{6}$/i.test(words[words.length - 1]) ? words.pop().toLowerCase() : null;
    const title = words.join(' ').toUpperCase();
    if (!title) return { error: `Add a title. ${usage}` };
    return { cmd, name, duration: null, reason: title, color };
  }
  const reason = NEEDS_REASON.has(cmd) ? words.join(' ').slice(0, 100) : '';
  if (NEEDS_REASON.has(cmd) && !reason) return { error: `Add a reason. ${usage}` };
  return { cmd, name, duration, reason };
}

// Titles that would look like staff; a dev-made title can never use them (only real dev accounts
// get [DEV], from DEV_NAMES).
const STAFF_WORDS = /\b(DEV|DEVS|DEVELOPER|ADMIN|ADMINISTRATOR|MOD|MODS|MODERATOR|STAFF|OWNER)\b/;

/** Why a dev-made title is not allowed, or null. (The account server also runs the swear filter.) */
export function customTitleProblem(title) {
  const t = typeof title === 'string' ? title.trim() : '';
  if (t.length > 14) return 'Titles are at most 14 characters.';
  if (!/^[A-Z0-9][A-Z0-9 ]{0,13}$/.test(t)) return 'Titles use letters, numbers and spaces only.';
  if (STAFF_WORDS.test(t)) return 'That looks like a staff title. Pick something else.';
  return null;
}

/**
 * `/announce ...` is a server-wide announcement. Only a verified dev account may send one.
 * Anything else is a normal chat line. `dev` must already be verified by the server.
 */
export function parseDevChat(text, dev) {
  const raw = String(text || '');
  const m = raw.match(/^\/announce(?:\s+([\s\S]*))?$/i);
  if (!m) return { announce: false, text: raw };
  if (!dev) return { error: 'Only developers can send announcements.' };
  const body = (m[1] || '').trim();
  if (!body) return { error: 'Write an announcement after /announce.' };
  return { announce: true, text: body };
}

/**
 * Special titles for verified accounts (by account username, like DEV_NAMES): shown before the
 * name in global chat and the online list, with the name in `color`. The presence server
 * grants them from the signed-in account, never from a typed nickname.
 */
export const PLAYER_TITLES = Object.freeze({
  thechosenone: Object.freeze({ title: 'CHULDE', color: '#facece' }),
});

export function titleForName(name) {
  return PLAYER_TITLES[String(name || '').trim().toLowerCase()] || null;
}

/** A title from the network, shape-checked: { title, color } or null (rendered as text only). */
export function cleanTitle(title, color) {
  const t = typeof title === 'string' ? title.trim() : '';
  if (!/^[A-Z0-9][A-Z0-9 ]{0,13}$/.test(t)) return null;
  const c = typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color) ? color.toLowerCase() : null;
  return { title: t, color: c };
}

/**
 * What a verified account name grants (presence server, after the Accounts lookup): dev rights,
 * a title, and the name shown in chat (`shown`: '' = keep the player's typed nickname).
 * `custom` is a dev-made title stored on the account ({title, color}); titles never grant dev rights.
 */
export function accountGrants(name, custom = null) {
  if (typeof name !== 'string' || !name) return { dev: false, shown: '', title: '', titleColor: '' };
  const dev = isDevName(name);
  // a title in the code wins; otherwise a dev-made title stored on the account (re-checked here)
  const stored = custom && !customTitleProblem(custom.title) ? cleanTitle(custom.title, custom.color) : null;
  const tt = titleForName(name) || stored;
  return { dev, shown: dev || tt ? name.slice(0, 16) : '', title: tt ? tt.title : '', titleColor: tt ? tt.color : '' };
}
