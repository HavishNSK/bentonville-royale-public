// BENTONVILLE ROYALE — Box Fights lobby screens: pure view models (no DOM, no network).
// Used by src/ui/boxLobby.js (screens) and src/ui/boxLobbyFlow.js (wiring); tested in
// tests/box-lobby-ui.test.mjs. Everything coming from the lobby server or other players is
// untrusted display data: names stay strings for textContent, numbers are clamped.

import {
  LOBBY_CODE_ALPHABET, LOBBY_CODE_LEN, LOBBY_MODES, LOBBY_DIFFICULTIES, MAX_LOBBY, ERR, lobbyCapacity, cleanSettings, validLobbyCode,
} from '../../party/lobbyRules.js';
import { isBoxBotName } from '../core/botProfile.js';
import { BOX_FIGHT, ffaWinner } from '../game/BoxFights.js';

export const BOT_TAG = '\u{1F916}'; // robot face, shown next to every bot name
export const MODE_LABEL = Object.freeze({ '1v1': '1V1', '2v2': '2V2', '3v3': '3V3', ffa: 'FFA' });
export const DIFF_LABEL = Object.freeze({ easy: 'EASY', normal: 'NORMAL', hard: 'HARD' });
/** Lobby mode -> Box Fights game mode (BoxFights.boxMatchConfig also accepts the lobby ids). */
export const LOBBY_TO_BOX = Object.freeze({ '1v1': 'solo', '2v2': 'duo', '3v3': 'trio', ffa: 'ffa' });
export const CODE_HINT = 'Lobby codes are 6 characters, like BNTV42.';
export const FFA_RULE = `FFA: ${BOX_FIGHT.ffa.rounds} rounds, or first to ${BOX_FIGHT.ffa.elimTarget} elims.`;
export const SERVER_ERRORS = Object.freeze([ERR.notFound, ERR.full, ERR.started]);

export { LOBBY_MODES, LOBBY_DIFFICULTIES, MAX_LOBBY };

const int = (v, lo, hi, d = lo) => (Number.isFinite(v) ? Math.max(lo, Math.min(hi, Math.round(v))) : d);
const str = (v, n = 16) => (typeof v === 'string' ? v : v == null ? '' : String(v)).slice(0, n);

// ------------------------------------------------------------------ Enter Code (screen D)

/** What the code box keeps of a keystroke / paste: upper case, only the lobby alphabet, 6 max. */
export function sanitizeCodeInput(s) {
  let out = '';
  for (const c of String(s == null ? '' : s).toUpperCase()) {
    if (LOBBY_CODE_ALPHABET.includes(c)) out += c;
    if (out.length >= LOBBY_CODE_LEN) break;
  }
  return out;
}

/** '' when the code can be sent, else the message to show under the box. */
export function codeError(code) {
  return validLobbyCode(code) ? '' : CODE_HINT;
}

// ------------------------------------------------------------------ Host Settings (screen B)

export const DEFAULT_HOST_SETTINGS = Object.freeze({ type: 'public', mode: '1v1', maxPlayers: 2, fillWithBots: true, botDifficulty: 'normal', roundsToWin: 5 });

/**
 * Host settings after a change: the lobby server's own validation (party/lobbyRules.js
 * cleanSettings) layered over `base`; a bad patch keeps `base`.
 */
export function applyHostSettings(base, patch) {
  const b = cleanSettings(base || {}, DEFAULT_HOST_SETTINGS);
  const start = b.settings || { ...DEFAULT_HOST_SETTINGS };
  const r = cleanSettings(patch || {}, start);
  return r.settings || start;
}

/** Offline "Play with Bots": the match options main.js playBoxFight / Game.startMatch take. */
export function offlineBoxOpts(settings) {
  const s = applyHostSettings(settings, {});
  return { mode: LOBBY_TO_BOX[s.mode], ffaPlayers: s.mode === 'ffa' ? s.maxPlayers : undefined, winRounds: s.roundsToWin, botDifficulty: s.botDifficulty };
}

/** One line describing how the match is won. */
export function ruleLine(settings) {
  const s = applyHostSettings(settings, {});
  return s.mode === 'ffa' ? FFA_RULE : `First team to ${s.roundsToWin} round${s.roundsToWin === 1 ? '' : 's'} wins.`;
}

// ------------------------------------------------------------------ Public list (screen C)

/** Rows for the public list: joinable first; full / started rows are shown greyed out. */
export function listRows(list) {
  const rows = (Array.isArray(list) ? list : []).filter((e) => e && validLobbyCode(e.code)).map((e) => {
    const max = int(e.max, 0, MAX_LOBBY, 0);
    const players = int(e.players, 0, max || MAX_LOBBY, 0);
    const waiting = !e.state || e.state === 'waiting';
    const full = !!e.full || (max > 0 && players >= max);
    return {
      code: e.code,
      name: str(e.name) || 'Player',
      mode: MODE_LABEL[e.mode] || '?',
      count: `${players}/${max || '?'}`,
      players,
      max,
      full,
      joinable: waiting && !full,
      status: full ? 'FULL' : waiting ? '' : 'IN MATCH',
    };
  });
  return rows.sort((a, b) => Number(b.joinable) - Number(a.joinable));
}

// ------------------------------------------------------------------ Lobby room (screen E)

const humansOf = (l) => (l && Array.isArray(l.slots) ? l.slots.filter((s) => s && s.kind === 'human') : []);

/**
 * Side panel model. lobby: the lobby as the server sends it; you: our player id.
 * -> { ffa, isHost, humans, max, groups: [{ team, label, slots: [row], canJoin, mine }] }
 *    row = { id, kind, label, isBot, isYou, isHost, canKick }
 */
export function slotListView(lobby, you) {
  const ffa = !!lobby && lobby.mode === 'ffa';
  const isHost = !!lobby && lobby.hostId === you;
  const waiting = !!lobby && lobby.state === 'waiting';
  const fill = !!(lobby && lobby.fillWithBots);
  const slots = lobby && Array.isArray(lobby.slots) ? lobby.slots.filter((s) => s && typeof s === 'object') : [];
  const row = (s) => {
    const kind = s.kind === 'human' || s.kind === 'bot' ? s.kind : 'open';
    const name = str(s.name);
    const isBot = kind === 'bot';
    const label = kind === 'human' ? name || 'Player' : isBot ? name || 'Bot' : fill ? 'Bot (will fill)' : 'Open';
    return {
      id: str(s.id, 40),
      kind,
      label,
      isBot: isBot || (kind === 'open' && fill),
      isYou: kind === 'human' && s.id === you,
      isHost: kind === 'human' && s.id === lobby.hostId,
      canKick: isHost && waiting && kind === 'human' && s.id !== you,
    };
  };
  const me = slots.find((s) => s.kind === 'human' && s.id === you);
  let groups;
  if (ffa) groups = [{ team: null, label: 'FREE FOR ALL', slots: slots.map(row), canJoin: false, mine: true }];
  else {
    groups = [0, 1].map((t) => {
      const list = slots.filter((s) => s.team === t);
      return {
        team: t,
        label: `TEAM ${t + 1}`,
        slots: list.map(row),
        mine: !!me && me.team === t,
        canJoin: waiting && !!me && me.team !== t && list.some((s) => s.kind === 'open' || s.kind === 'bot'),
      };
    });
  }
  return { ffa, isHost, humans: humansOf(lobby).length, max: slots.length, groups };
}

/** Host's Start button: { show, enabled, reason } (reason = why it is disabled, or a guest's status). */
export function startState(lobby, you) {
  if (!lobby) return { show: false, enabled: false, reason: '' };
  const isHost = lobby.hostId === you;
  if (lobby.state === 'countdown') return { show: isHost, enabled: false, reason: 'Starting…' };
  if (lobby.state !== 'waiting') return { show: isHost, enabled: false, reason: 'A match is running.' };
  if (!isHost) return { show: false, enabled: false, reason: 'Waiting for the host to start.' };
  const humans = humansOf(lobby).length;
  const total = Array.isArray(lobby.slots) ? lobby.slots.length : 0;
  if (humans < 1) return { show: true, enabled: false, reason: ERR.needOne };
  if (!lobby.fillWithBots && humans < total) {
    const open = total - humans;
    return { show: true, enabled: false, reason: `${open} open slot${open === 1 ? '' : 's'}. Turn on Fill with bots or wait for players.` };
  }
  return { show: true, enabled: true, reason: '' };
}

/** "3/6" humans over slots, for the top bar. */
export function playerCount(lobby) {
  const max = lobby && Array.isArray(lobby.slots) ? lobby.slots.length : 0;
  return `${humansOf(lobby).length}/${max}`;
}

// ------------------------------------------------------------------ Match hand-off (matchStart)

/**
 * HostSession `slots` from the lobby's matchStart (host only). The server's slot list has no
 * tokens: they come in msg.tokens (slot id -> token) and msg.hostToken; without them the host
 * could not match the guests that join its relay room.
 */
export function mergeMatchSlots(msg) {
  const tokens = msg && msg.tokens && typeof msg.tokens === 'object' ? msg.tokens : {};
  const slots = msg && Array.isArray(msg.slots) ? msg.slots.slice(0, MAX_LOBBY) : [];
  return slots.map((s) => {
    const kind = s && (s.kind === 'human' || s.kind === 'bot') ? s.kind : 'open';
    const out = { kind, name: str(s && s.name), team: s && (s.team === 0 || s.team === 1) ? s.team : null };
    if (kind === 'human') {
      const tok = Object.prototype.hasOwnProperty.call(tokens, s.id) ? tokens[s.id] : '';
      if (typeof tok === 'string' && tok) out.token = tok;
      if (s.id === msg.hostId) out.host = true;
    }
    return out;
  });
}

/** Tokens of the guests the host waits for (every human but the host). */
export function expectedGuestTokens(msg) {
  const tokens = msg && msg.tokens && typeof msg.tokens === 'object' ? msg.tokens : {};
  const out = new Set();
  for (const [id, tok] of Object.entries(tokens)) if (id !== msg.hostId && typeof tok === 'string' && tok) out.add(tok);
  return out;
}

/** HostSession options for a lobby match (matchStart message). */
export function hostSessionOpts(msg) {
  const mode = LOBBY_TO_BOX[msg && msg.mode] || 'solo';
  const ffa = mode === 'ffa';
  return {
    game: 'boxfights',
    mode,
    fill: true, // the server already turned every non-human slot into a named bot
    boxFight: { mode, ffaPlayers: ffa ? int(msg.maxPlayers, 2, MAX_LOBBY, MAX_LOBBY) : undefined, winRounds: int(msg.roundsToWin, 1, 9, 5), botDifficulty: msg.botDifficulty },
    slots: mergeMatchSlots(msg),
    hostToken: typeof msg.hostToken === 'string' ? msg.hostToken : null,
  };
}

// ------------------------------------------------------------------ Result report (host -> lobby)

/**
 * The host's reportResult({ score, final, winner }) from Game's result.boxFight.
 * Team modes: myTeam is the host's lobby team (0|1; HostSession seats lobby team = game team).
 * FFA: slotOfActor maps game actor id -> lobby slot id; the server caps every score at roundsToWin.
 */
export function lobbyReport(bf, { mode, roundsToWin = 5, myTeam = 0, slots = [], slotOfActor = new Map() } = {}) {
  const R = int(roundsToWin, 1, 9, 5);
  const cap = (v) => int(v, 0, R, 0);
  if (!bf) return null;
  if (mode !== 'ffa') {
    const t = myTeam === 1 ? 1 : 0;
    const mine = cap(bf.score && bf.score[0]);
    const theirs = cap(bf.score && bf.score[1]);
    const score = t === 0 ? { team0: mine, team1: theirs } : { team0: theirs, team1: mine };
    const winner = bf.draw ? null : bf.won ? t : 1 - t;
    return { score, final: true, winner };
  }
  const score = {};
  for (const s of slots) if (s && s.kind !== 'open') score[s.id] = 0;
  const players = Array.isArray(bf.players) ? bf.players : [];
  const sideSlot = new Map();
  for (const p of players) {
    const sid = slotOfActor.get(p.id);
    if (sid != null && Object.prototype.hasOwnProperty.call(score, sid)) sideSlot.set(p.side, sid);
  }
  const rounds = Array.isArray(bf.score) ? bf.score : [];
  for (const [side, sid] of sideSlot) score[sid] = cap(rounds[side]);
  let winner = null;
  if (!bf.draw && Array.isArray(bf.elims)) {
    const top = ffaWinner(bf.elims, rounds);
    if (top != null && sideSlot.has(top)) winner = sideSlot.get(top);
  }
  return { score, final: true, winner };
}

/**
 * FFA: game actor id -> lobby slot id. Host = actor 0; guests by their relay token
 * (clientTokens: actor id -> token; tokens: slot id -> token); bots by their lobby name.
 */
export function actorSlotMap({ players = [], slots = [], tokens = {}, clientTokens = new Map(), hostSlotId = null } = {}) {
  const out = new Map();
  const byToken = new Map(Object.entries(tokens || {}).map(([id, t]) => [t, id]));
  const usedBots = new Set();
  for (const p of players) {
    if (p.id === 0 && hostSlotId) out.set(0, hostSlotId);
    else if (!p.isBot || p.replaced) {
      const sid = byToken.get(clientTokens.get(p.id));
      if (sid) out.set(p.id, sid);
    }
    if (out.has(p.id)) continue;
    const bot = slots.find((s) => s && s.kind === 'bot' && !usedBots.has(s.id) && s.name === p.name);
    if (bot) {
      usedBots.add(bot.id);
      out.set(p.id, bot.id);
    }
  }
  return out;
}

// ------------------------------------------------------------------ Results (screen G)

/**
 * Stats table rows from result.boxFight.players (+ optional my actor id). Team modes: winning
 * team first; each team by elims, then damage. FFA: by elims.
 */
export function resultRows(bf, meId = null) {
  const players = bf && Array.isArray(bf.players) ? bf.players : [];
  const rows = players.map((p) => {
    const name = str(p && p.name) || 'Player';
    return {
      id: p.id,
      name,
      isBot: !!(p && p.isBot) || isBoxBotName(name),
      replaced: p && p.replaced ? str(p.replaced) : '',
      team: Number.isInteger(p && p.team) ? p.team : null,
      side: Number.isInteger(p && p.side) ? p.side : 0,
      elims: int(p && p.elims, 0, 999, 0),
      damage: int(p && p.damage, 0, 99999, 0),
      builds: int(p && p.builds, 0, 99999, 0),
      you: meId != null && p.id === meId,
    };
  });
  const byStats = (a, b) => b.elims - a.elims || b.damage - a.damage || a.name.localeCompare(b.name);
  if (bf && bf.ffa) return rows.sort(byStats);
  const mySide = (rows.find((r) => r.you) || { side: 0 }).side;
  const winSide = bf && bf.won != null ? (bf.won ? mySide : 1 - mySide) : 0;
  return rows.sort((a, b) => Number(b.side === winSide) - Number(a.side === winSide) || a.side - b.side || byStats(a, b));
}

/** "3", "2", "1" for the countdown overlay ('' hides it). */
export function countdownLabel(seconds) {
  const n = Math.round(Number(seconds) || 0);
  return n > 0 && n <= 9 ? String(n) : '';
}

/** Lobby browser mode filter ('any' | a lobby mode); rows from listRows keep their order. */
export function filterRows(rows, filter) {
  const list = Array.isArray(rows) ? rows : [];
  if (!filter || filter === 'any' || !MODE_LABEL[filter]) return list;
  return list.filter((r) => r.mode === MODE_LABEL[filter]);
}
