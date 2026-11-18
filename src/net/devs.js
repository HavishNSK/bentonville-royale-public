// Developer accounts. The presence server checks the signed-in account (not the
// nickname) against this list before it grants the chat title or announcements.

export const DEV_NAMES = ['sumukh', 'havish', 'gecko', 'shehryar'];

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
