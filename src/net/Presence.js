// BENTONVILLE ROYALE — client for the online list (server: party/presence.js).
//
//   const pr = openPresence({ token, name, status, mode })
//   pr.set({ name?, status?, mode? })   status: 'lobby' | 'queued' | 'match'
//   pr.onUpdate = (snap) => {}          snap: {count, searching:{solo,duo,trio,squad}, inMatch, players:[{name,status,mode}]}
//   pr.snap                             last snapshot, or null while offline
//   pr.sendChat(text) -> bool           global chat (false while offline); the server filters it
//   pr.reportBlocked(category)          our filter stopped a message: the server counts a strike (no text sent)
//   pr.onChat = (m) => {}               m: {id, name, text, at, dev, announce}; also for each history message
//   pr.onChatError = (reason) => {}     the server refused our message (rate limit, links, ...)
//   pr.onModResult = ({ok, lines}) => {} answer to our dev moderation command (only we see it)
//   pr.close()
//
// Reconnects on its own with backoff. Everything it receives is untrusted display text.

import { partyUrl, cleanName } from './Net.js';
import { cleanTitle } from './devs.js';

const ROOM = 'global';
const RETRY_MIN = 2000;
const RETRY_MAX = 30000;
const MODES = ['solo', 'duo', 'trio', 'squad'];
const STATUSES = ['lobby', 'queued', 'match'];

/** Server snapshot -> a well-formed one (drops anything unexpected). */
/** A verified account title ({ title, color, nameColor? }) off the wire, shape-checked; {} if none. */
function titleOf(o) {
  const t = o && cleanTitle(o.title, o.color);
  if (!t) return {};
  const out = { title: t.title, color: t.color };
  if (typeof o.nameColor === 'string' && /^#[0-9a-f]{6}$/i.test(o.nameColor)) out.nameColor = o.nameColor.toLowerCase();
  return out;
}

function cleanSnap(msg) {
  const n = (v) => (Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);
  const searching = {};
  for (const m of MODES) searching[m] = n(msg.searching && msg.searching[m]);
  const players = (Array.isArray(msg.players) ? msg.players : []).slice(0, 100).map((p) => ({
    name: cleanName(p && p.name),
    status: STATUSES.includes(p && p.status) ? p.status : 'lobby',
    mode: MODES.includes(p && p.mode) ? p.mode : 'solo',
    ...titleOf(p),
  }));
  return { count: n(msg.count), searching, inMatch: n(msg.inMatch), players };
}

export function openPresence({ token, accountToken = '', name, status = 'lobby', mode = 'solo' }) {
  const info = { name: cleanName(name), status, mode, acct: String(accountToken || '') };
  let ws = null;
  let closed = false;
  let retry = RETRY_MIN;
  let timer = null;

  const api = {
    snap: null,
    onUpdate: null,
    onChat: null,
    onChatError: null,
    onModResult: null,
    online: false,
    sendChat(text) {
      if (!ws || ws.readyState !== 1) return false;
      ws.send(JSON.stringify({ t: 'chat', text: String(text).slice(0, 300) }));
      return true;
    },
    reportBlocked(category) {
      if (ws && ws.readyState === 1) ws.send(JSON.stringify({ t: 'chatBlocked', c: String(category || '').slice(0, 16) }));
    },
    set(next) {
      const before = JSON.stringify(info);
      if (next.name != null) info.name = cleanName(next.name);
      if (next.status) info.status = next.status;
      if (next.mode) info.mode = next.mode;
      if (next.accountToken != null) info.acct = String(next.accountToken || '');
      if (JSON.stringify(info) === before) return;
      if (ws && ws.readyState === 1) ws.send(JSON.stringify({ t: 'status', name: info.name, status: info.status, mode: info.mode, acct: info.acct }));
    },
    close() {
      closed = true;
      clearTimeout(timer);
      if (ws) {
        ws.onclose = null;
        try {
          ws.close();
        } catch {
          /* ignore */
        }
      }
    },
  };

  // untrusted: shape-checked here, rendered as text (never HTML) by the chat UI
  const seen = new Set();
  const chat = (m) => {
    const key = m && m.id + ':' + m.at; // ids restart when the server room restarts
    if (!m || !Number.isFinite(m.id) || seen.has(key) || !api.onChat) return;
    seen.add(key);
    if (seen.size > 500) seen.delete(seen.values().next().value);
    api.onChat({
      id: m.id,
      name: cleanName(m.name),
      text: String(m.text || '').slice(0, 200),
      at: Number(m.at) || Date.now(),
      dev: m.dev === true,
      announce: m.announce === true,
      ...titleOf(m),
    });
  };

  const emit = (snap) => {
    api.snap = snap;
    if (api.onUpdate) api.onUpdate(snap);
  };

  function connect() {
    if (closed) return;
    try {
      ws = new WebSocket(partyUrl('presence', ROOM, { token, name: info.name, status: info.status, mode: info.mode, acct: info.acct }));
    } catch {
      return schedule();
    }
    ws.onopen = () => {
      retry = RETRY_MIN;
      api.online = true;
    };
    ws.onmessage = (ev) => {
      if (typeof ev.data !== 'string' || ev.data.length > 20000) return;
      let msg;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (msg && msg.t === 'online') emit(cleanSnap(msg));
      else if (msg && msg.t === 'chat') chat(msg.m);
      else if (msg && msg.t === 'chatHistory' && Array.isArray(msg.list)) msg.list.slice(-50).forEach(chat);
      else if (msg && msg.t === 'modResult' && api.onModResult) {
        const lines = (Array.isArray(msg.lines) ? msg.lines : []).slice(0, 12).map((l) => String(l).slice(0, 300));
        api.onModResult({ ok: msg.ok === true, lines });
      } else if (msg && msg.t === 'chatError' && api.onChatError) api.onChatError(String(msg.reason || 'Message not sent.').slice(0, 120));
    };
    ws.onclose = (ev) => {
      ws = null;
      api.online = false;
      if (api.snap) emit(null);
      if (ev && ev.code === 4004) return; // replaced by this tab's newer socket
      schedule();
    };
  }

  function schedule() {
    if (closed) return;
    clearTimeout(timer);
    timer = setTimeout(connect, retry);
    retry = Math.min(RETRY_MAX, retry * 2);
  }

  connect();
  return api;
}
