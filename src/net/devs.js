// Developer accounts. The presence server checks the signed-in account (not the
// nickname) against this list before it grants the chat title or announcements.

export const DEV_NAMES = ['sumukh', 'havish', 'gecko', 'shehryar', 'rakkart13'];

const DEV_SET = new Set(DEV_NAMES);

export function isDevName(name) {
  return DEV_SET.has(String(name || '').trim().toLowerCase());
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

/** Local nameplate for a username we already trust (signed-in account, or you in the party). */
export function nameplate(name) {
  const n = String(name || '').trim().slice(0, 16);
  const t = titleForName(n);
  if (!t) return { name: n, title: '', color: '', label: n };
  return { name: n, title: t.title, color: t.color, label: `[${t.title}] ${n}` };
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
 */
export function accountGrants(name) {
  if (typeof name !== 'string' || !name) return { dev: false, shown: '', title: '', titleColor: '' };
  const dev = isDevName(name);
  const tt = titleForName(name);
  return { dev, shown: dev || tt ? name.slice(0, 16) : '', title: tt ? tt.title : '', titleColor: tt ? tt.color : '' };
}
