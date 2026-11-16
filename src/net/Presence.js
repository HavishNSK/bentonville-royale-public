// BENTONVILLE ROYALE — client for the online list (server: party/presence.js).
//
//   const pr = openPresence({ token, name, status, mode })
//   pr.set({ name?, status?, mode? })   status: 'lobby' | 'queued' | 'match'
//   pr.onUpdate = (snap) => {}          snap: {count, searching:{solo,duo,trio,squad}, inMatch, players:[{name,status,mode}]}
//   pr.snap                             last snapshot, or null while offline
//   pr.close()
//
// Reconnects on its own with backoff. Everything it receives is untrusted display text.

import { partyUrl, cleanName } from './Net.js';

const ROOM = 'global';
const RETRY_MIN = 2000;
const RETRY_MAX = 30000;
const MODES = ['solo', 'duo', 'trio', 'squad'];
const STATUSES = ['lobby', 'queued', 'match'];

/** Server snapshot -> a well-formed one (drops anything unexpected). */
function cleanSnap(msg) {
  const n = (v) => (Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);
  const searching = {};
  for (const m of MODES) searching[m] = n(msg.searching && msg.searching[m]);
  const players = (Array.isArray(msg.players) ? msg.players : []).slice(0, 100).map((p) => ({
    name: cleanName(p && p.name),
    status: STATUSES.includes(p && p.status) ? p.status : 'lobby',
    mode: MODES.includes(p && p.mode) ? p.mode : 'solo',
  }));
  return { count: n(msg.count), searching, inMatch: n(msg.inMatch), players };
}

export function openPresence({ token, name, status = 'lobby', mode = 'solo' }) {
  const info = { name: cleanName(name), status, mode };
  let ws = null;
  let closed = false;
  let retry = RETRY_MIN;
  let timer = null;

  const api = {
    snap: null,
    onUpdate: null,
    set(next) {
      const before = JSON.stringify(info);
      if (next.name != null) info.name = cleanName(next.name);
      if (next.status) info.status = next.status;
      if (next.mode) info.mode = next.mode;
      if (JSON.stringify(info) === before) return;
      if (ws && ws.readyState === 1) ws.send(JSON.stringify({ t: 'status', ...info }));
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

  const emit = (snap) => {
    api.snap = snap;
    if (api.onUpdate) api.onUpdate(snap);
  };

  function connect() {
    if (closed) return;
    try {
      ws = new WebSocket(partyUrl('presence', ROOM, { token, ...info }));
    } catch {
      return schedule();
    }
    ws.onopen = () => {
      retry = RETRY_MIN;
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
    };
    ws.onclose = (ev) => {
      ws = null;
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
