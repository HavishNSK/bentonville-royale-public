// BENTONVILLE ROYALE — Box Fights custom lobby rules (pure: no partyserver / Cloudflare imports,
// so tests/lobby-rules.test.mjs loads it with node --test). party/lobbyRoom.js (one Durable
// Object per 6-character lobby code) and party/lobbyIndex.js (the public list) are thin shells
// around these functions. Every input here comes from an untrusted browser.
//
// Functions never mutate their input: they return { lobby, ... } with a fresh copy, or { error }.
// Error strings are user-facing copy.
//
// Internal lobby (publicLobby() strips token / seq / relayCode / seed before anything is sent):
//   { code, hostId, type, mode, maxPlayers, fillWithBots, botDifficulty, roundsToWin,
//     state: 'waiting'|'countdown'|'playing'|'results', score, relayCode, seed, nextSeq,
//     slots: [{ id, kind:'human'|'bot'|'open', name, team:0|1|null, look, token?, seq? }] }
// Slot count is the lobby capacity (2/4/6 for team modes; 2-6 for ffa). Team modes put the
// first half of the slots on team 0 and the rest on team 1, so teams are always equal.

import { nameIsClean } from '../src/net/chatFilter.js';
import { boxBotNames } from '../src/core/botProfile.js';

export const LOBBY_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0 O 1 I L
export const LOBBY_CODE_LEN = 6;
export const MAX_LOBBY = 6; // humans + bots
export const LOBBY_MODES = Object.freeze(['1v1', '2v2', '3v3', 'ffa']);
export const LOBBY_TYPES = Object.freeze(['public', 'private']);
export const LOBBY_DIFFICULTIES = Object.freeze(['easy', 'normal', 'hard']);
export const COUNTDOWN_SECONDS = 5;
export const INDEX_TTL_MS = 60000; // index entries not refreshed this long are dropped
export const MAX_LOBBIES_PER_OWNER = 4; // live lobbies one creator (IP hash) may hold
export const MAX_LISTED = 50;

export const ERR = Object.freeze({
  notFound: 'Lobby not found',
  full: 'Lobby is full',
  started: 'Match already started',
  notHost: 'Only the host can do that.',
  notWaiting: 'You can only do that in the lobby.',
  notPlaying: 'No match is running.',
  teamFull: 'That team is full.',
  noTeams: 'Free-for-all has no teams.',
  badTeam: 'Pick team 1 or team 2.',
  tooMany: 'Too many players for that mode.',
  badSettings: 'Invalid lobby settings.',
  badResult: 'Invalid match result.',
  needAll: 'Every slot needs a player when Fill with bots is off.',
  needOne: 'At least one player is needed.',
  kickSelf: 'You cannot kick yourself.',
  noPlayer: 'Player not found.',
});

const DEFAULTS = Object.freeze({ type: 'public', mode: '1v1', maxPlayers: 2, fillWithBots: true, botDifficulty: 'normal', roundsToWin: 5 });
const TEAM_SIZE = { '1v1': 2, '2v2': 4, '3v3': 6 };
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const copy = (l) => JSON.parse(JSON.stringify(l));
const isInt = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;

// ------------------------------------------------------------------ codes, names, looks

/** 6-character code. `bytes(n)` returns n random bytes (default crypto.getRandomValues). */
export function randomLobbyCode(bytes = (n) => crypto.getRandomValues(new Uint8Array(n))) {
  const b = bytes(LOBBY_CODE_LEN);
  let s = '';
  // 31 symbols: modulo bias is under 1% per character; codes are joining conveniences, not secrets
  for (let i = 0; i < LOBBY_CODE_LEN; i++) s += LOBBY_CODE_ALPHABET[b[i] % LOBBY_CODE_ALPHABET.length];
  return s;
}

export function normalizeLobbyCode(s) {
  return String(s || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, LOBBY_CODE_LEN);
}

export function validLobbyCode(s) {
  return typeof s === 'string' && s.length === LOBBY_CODE_LEN && [...s].every((c) => LOBBY_CODE_ALPHABET.includes(c));
}

/** Display name: no control characters or angle brackets, 16 max, filtered like party names. */
export function cleanLobbyName(name) {
  const s = String(name || '')
    .replace(/[\u0000-\u001f\u007f<>]/g, '')
    .trim()
    .slice(0, 16);
  return s && nameIsClean(s) ? s : 'Player';
}

/** Look string "skin|pickaxe|backbling|glider" (Cosmetics.lookString); cosmetic only, unchecked ids. */
export function cleanLookString(s) {
  const v = String(s || '').replace(/[^a-z0-9_|]/g, '').slice(0, 96);
  return v.startsWith('skin_') ? v : null;
}

// ------------------------------------------------------------------ settings

export function lobbyCapacity(mode, maxPlayers) {
  if (mode === 'ffa') return isInt(maxPlayers, 2, MAX_LOBBY) ? maxPlayers : MAX_LOBBY;
  return TEAM_SIZE[mode] || 2;
}

/**
 * Validated settings from untrusted input layered over `base` (defaults on create, the current
 * lobby on update). Known keys with bad values -> { error }; unknown keys are ignored.
 */
export function cleanSettings(input, base = DEFAULTS) {
  if (input == null) input = {};
  if (typeof input !== 'object' || Array.isArray(input)) return { error: ERR.badSettings };
  const out = {
    type: base.type,
    mode: base.mode,
    maxPlayers: base.maxPlayers,
    fillWithBots: base.fillWithBots,
    botDifficulty: base.botDifficulty,
    roundsToWin: base.roundsToWin,
  };
  if (has(input, 'type')) {
    if (!LOBBY_TYPES.includes(input.type)) return { error: ERR.badSettings };
    out.type = input.type;
  }
  if (has(input, 'mode')) {
    if (!LOBBY_MODES.includes(input.mode)) return { error: ERR.badSettings };
    out.mode = input.mode;
  }
  if (has(input, 'fillWithBots')) {
    if (typeof input.fillWithBots !== 'boolean') return { error: ERR.badSettings };
    out.fillWithBots = input.fillWithBots;
  }
  if (has(input, 'botDifficulty')) {
    if (!LOBBY_DIFFICULTIES.includes(input.botDifficulty)) return { error: ERR.badSettings };
    out.botDifficulty = input.botDifficulty;
  }
  if (has(input, 'roundsToWin')) {
    if (!isInt(input.roundsToWin, 1, 9)) return { error: ERR.badSettings };
    out.roundsToWin = input.roundsToWin;
  }
  if (out.mode === 'ffa') {
    if (has(input, 'maxPlayers')) {
      if (!isInt(input.maxPlayers, 2, MAX_LOBBY)) return { error: ERR.badSettings };
      out.maxPlayers = input.maxPlayers;
    } else if (base.mode !== 'ffa') out.maxPlayers = MAX_LOBBY;
  } else out.maxPlayers = TEAM_SIZE[out.mode];
  return { settings: out };
}

// ------------------------------------------------------------------ slots

const teamOf = (mode, i, cap) => (mode === 'ffa' ? null : i < cap / 2 ? 0 : 1);
const openSlot = (mode, i, cap) => ({ id: `open-${i}`, kind: 'open', name: '', team: teamOf(mode, i, cap), look: null });
const humansOf = (l) => l.slots.filter((s) => s.kind === 'human');
const humanCount = (l, team) => l.slots.filter((s) => s.kind === 'human' && s.team === team).length;

/** Index of the slot a new human should take: open first, then a bot placeholder. -1 = none. */
function freeIndex(slots, team) {
  const inTeam = (s) => team === undefined || s.team === team;
  const open = slots.findIndex((s) => inTeam(s) && s.kind === 'open');
  return open >= 0 ? open : slots.findIndex((s) => inTeam(s) && s.kind === 'bot');
}

/** Slot for a joiner: team with fewest humans (ties -> team 0), else the other team. */
function joinIndex(l) {
  if (l.mode === 'ffa') return freeIndex(l.slots);
  const order = humanCount(l, 1) < humanCount(l, 0) ? [1, 0] : [0, 1];
  for (const t of order) {
    const i = freeIndex(l.slots, t);
    if (i >= 0) return i;
  }
  return -1;
}

/** Fresh slots for a mode, re-seating `humans` (join order) on their old team where it has room. */
function layout(mode, maxPlayers, humans) {
  const cap = lobbyCapacity(mode, maxPlayers);
  const l = { mode, slots: Array.from({ length: cap }, (_, i) => openSlot(mode, i, cap)) };
  for (const h of [...humans].sort((a, b) => a.seq - b.seq)) {
    let i = -1;
    if (mode !== 'ffa' && (h.team === 0 || h.team === 1)) i = l.slots.findIndex((s) => s.team === h.team && s.kind === 'open');
    if (i < 0) i = joinIndex(l);
    l.slots[i] = { ...h, team: l.slots[i].team };
  }
  return l.slots;
}

function nextBotName(slots) {
  const used = new Set(slots.map((s) => s.name));
  return boxBotNames(MAX_LOBBY * 2).find((n) => !used.has(n)) || 'Bot';
}

function freshScore(l) {
  if (l.mode !== 'ffa') return { team0: 0, team1: 0 };
  const s = {};
  for (const slot of l.slots) if (slot.kind !== 'open') s[slot.id] = 0;
  return s;
}

function nextHost(l, leavingId) {
  const rest = humansOf(l).filter((s) => s.id !== leavingId);
  rest.sort((a, b) => a.seq - b.seq);
  return rest.length ? rest[0].id : null;
}

// ------------------------------------------------------------------ lifecycle

/** player: { id, name, token, look } — id is server-generated, token is the tab's party token. */
export function createLobby({ code, settings, player }) {
  if (!validLobbyCode(code)) return { error: ERR.notFound };
  const r = cleanSettings(settings);
  if (r.error) return r;
  const s = r.settings;
  const cap = lobbyCapacity(s.mode, s.maxPlayers);
  const slots = Array.from({ length: cap }, (_, i) => openSlot(s.mode, i, cap));
  slots[0] = { id: player.id, kind: 'human', name: cleanLobbyName(player.name), team: slots[0].team, look: cleanLookString(player.look), token: player.token || '', seq: 0 };
  const lobby = { code, hostId: player.id, ...s, state: 'waiting', slots, score: null, relayCode: null, seed: 0, nextSeq: 1 };
  lobby.score = freshScore(lobby);
  return { lobby };
}

/** A human joins. A token already seated reclaims its slot (page refresh) in any state. */
export function joinLobby(lobby, player) {
  if (!lobby) return { error: ERR.notFound };
  const l = copy(lobby);
  const name = cleanLobbyName(player.name);
  const look = cleanLookString(player.look);
  if (player.token) {
    const mine = l.slots.find((s) => s.kind === 'human' && s.token === player.token);
    if (mine) {
      mine.name = name;
      mine.look = look;
      return { lobby: l, id: mine.id, reclaimed: true };
    }
  }
  if (l.state !== 'waiting') return { error: ERR.started };
  const i = joinIndex(l);
  if (i < 0) return { error: ERR.full };
  l.slots[i] = { id: player.id, kind: 'human', name, team: l.slots[i].team, look, token: player.token || '', seq: l.nextSeq++ };
  if (l.mode === 'ffa') l.score = freshScore(l);
  return { lobby: l, id: player.id };
}

/**
 * A human leaves (or disconnects, or is kicked).
 *   waiting/results: slot opens.   countdown: slot becomes a bot (fill on) or the countdown stops.
 *   playing: slot becomes a bot on the same team (same id, so the host's game can swap it).
 * Host leaving -> next human in join order. If that happens while playing, hostMigrated is set
 * (the relay room must move to the new host). Last human -> { lobby: null, closed: true }.
 */
export function leaveLobby(lobby, id) {
  const i = lobby ? lobby.slots.findIndex((s) => s.kind === 'human' && s.id === id) : -1;
  if (i < 0) return { lobby, changed: false };
  const newHost = nextHost(lobby, id);
  if (!newHost) return { lobby: null, closed: true, changed: true };
  const l = copy(lobby);
  const out = { lobby: l, changed: true, hostChanged: false, hostMigrated: false, countdownCancelled: false };
  const toBot = () => {
    const s = l.slots[i];
    l.slots[i] = { id: s.id, kind: 'bot', name: nextBotName(l.slots), team: s.team, look: s.look };
  };
  if (l.state === 'playing') toBot();
  else if (l.state === 'countdown' && l.fillWithBots) toBot();
  else {
    l.slots[i] = openSlot(l.mode, i, l.slots.length);
    if (l.state === 'countdown') {
      l.state = 'waiting';
      out.countdownCancelled = true;
    }
    if (l.mode === 'ffa' && l.state === 'waiting') l.score = freshScore(l);
  }
  if (l.hostId === id) {
    l.hostId = newHost;
    out.hostChanged = true;
    out.hostMigrated = l.state === 'playing';
  }
  return out;
}

export function switchTeam(lobby, id, team) {
  if (lobby.state !== 'waiting') return { error: ERR.notWaiting };
  if (lobby.mode === 'ffa') return { error: ERR.noTeams };
  if (team !== 0 && team !== 1) return { error: ERR.badTeam };
  const from = lobby.slots.findIndex((s) => s.kind === 'human' && s.id === id);
  if (from < 0) return { error: ERR.noPlayer };
  if (lobby.slots[from].team === team) return { lobby, changed: false };
  const to = freeIndex(lobby.slots, team);
  if (to < 0) return { error: ERR.teamFull };
  const l = copy(lobby);
  l.slots[to] = { ...l.slots[from], team };
  l.slots[from] = openSlot(l.mode, from, l.slots.length);
  return { lobby: l, changed: true };
}

export function updateSettings(lobby, id, input) {
  if (lobby.hostId !== id) return { error: ERR.notHost };
  if (lobby.state !== 'waiting') return { error: ERR.notWaiting };
  const r = cleanSettings(input, lobby);
  if (r.error) return r;
  const s = r.settings;
  const humans = humansOf(lobby);
  if (lobbyCapacity(s.mode, s.maxPlayers) < humans.length) return { error: ERR.tooMany };
  const l = copy(lobby);
  const relayout = s.mode !== l.mode || s.maxPlayers !== l.maxPlayers;
  Object.assign(l, s);
  if (relayout) {
    l.slots = layout(s.mode, s.maxPlayers, copy(humans));
    l.score = freshScore(l);
  }
  return { lobby: l, changed: true };
}

export function kickPlayer(lobby, id, target) {
  if (lobby.hostId !== id) return { error: ERR.notHost };
  if (target === id) return { error: ERR.kickSelf };
  if (!lobby.slots.some((s) => s.kind === 'human' && s.id === target)) return { error: ERR.noPlayer };
  return { ...leaveLobby(lobby, target), kicked: target };
}

/** { ok, reason } — host's Start button. */
export function canStart(lobby) {
  if (lobby.state !== 'waiting') return { ok: false, reason: ERR.started };
  const humans = humansOf(lobby).length;
  if (humans < 1) return { ok: false, reason: ERR.needOne };
  if (!lobby.fillWithBots && humans < lobby.slots.length) return { ok: false, reason: ERR.needAll };
  return { ok: true };
}

/** Host's Start: every non-human slot becomes a named bot, then the countdown runs. */
export function startMatch(lobby, id) {
  if (lobby.hostId !== id) return { error: ERR.notHost };
  const c = canStart(lobby);
  if (!c.ok) return { error: c.reason };
  const l = copy(lobby);
  const botIdx = l.slots.map((s, i) => (s.kind === 'human' ? -1 : i)).filter((i) => i >= 0);
  const names = boxBotNames(botIdx.length);
  botIdx.forEach((i, n) => {
    const s = l.slots[i];
    l.slots[i] = { id: s.kind === 'bot' ? s.id : `bot-${i}`, kind: 'bot', name: names[n], team: s.team, look: s.kind === 'bot' ? s.look : null };
  });
  l.state = 'countdown';
  l.score = freshScore(l);
  return { lobby: l };
}

/** Countdown finished: ctx = { relayCode, seed } chosen by the Durable Object. */
export function beginPlaying(lobby, ctx = {}) {
  if (lobby.state !== 'countdown') return { error: ERR.notWaiting };
  const l = copy(lobby);
  l.state = 'playing';
  l.relayCode = typeof ctx.relayCode === 'string' ? ctx.relayCode : null;
  l.seed = Number.isInteger(ctx.seed) ? ctx.seed : 0;
  return { lobby: l };
}

function tokensOf(l) {
  const t = {};
  for (const s of humansOf(l)) t[s.id] = s.token || '';
  return t;
}

/** {t:'matchStart'} for one player; the host also gets hostToken and every human's token. */
export function matchStartPayload(lobby, ctx, forId) {
  const msg = {
    t: 'matchStart',
    you: forId,
    relayCode: ctx.relayCode != null ? ctx.relayCode : lobby.relayCode,
    hostId: lobby.hostId,
    mode: lobby.mode,
    maxPlayers: lobby.slots.length,
    roundsToWin: lobby.roundsToWin,
    botDifficulty: lobby.botDifficulty,
    seed: ctx.seed != null ? ctx.seed : lobby.seed,
    slots: publicLobby(lobby).slots,
  };
  if (forId === lobby.hostId) {
    const host = lobby.slots.find((s) => s.id === lobby.hostId);
    msg.hostToken = (host && host.token) || '';
    msg.tokens = tokensOf(lobby);
  }
  return msg;
}

/** {t:'hostMigrate'} after the host left mid-match; the new host also gets the tokens. */
export function hostMigratePayload(lobby, forId) {
  const msg = { t: 'hostMigrate', you: forId, newHostId: lobby.hostId, relayCode: lobby.relayCode, slots: publicLobby(lobby).slots };
  if (forId === lobby.hostId) {
    const host = lobby.slots.find((s) => s.id === lobby.hostId);
    msg.hostToken = (host && host.token) || '';
    msg.tokens = tokensOf(lobby);
  }
  return msg;
}

function cleanScore(l, raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const R = l.roundsToWin;
  if (l.mode !== 'ffa') return isInt(raw.team0, 0, R) && isInt(raw.team1, 0, R) ? { team0: raw.team0, team1: raw.team1 } : null;
  const out = {};
  for (const s of l.slots) {
    if (s.kind === 'open') continue;
    const v = has(raw, s.id) ? raw[s.id] : 0;
    if (!isInt(v, 0, R)) return null;
    out[s.id] = v;
  }
  return out;
}

/**
 * From the host's browser (checked against hostId here, never a client flag).
 * input: { score, final?: boolean (default true), winner?: 0|1|null (teams) or slot id|null (ffa) }
 * -> { lobby, event: 'roundEnd'|'matchEnd', payload }
 */
export function reportResult(lobby, id, input) {
  if (lobby.hostId !== id) return { error: ERR.notHost };
  if (lobby.state !== 'playing') return { error: ERR.notPlaying };
  if (!input || typeof input !== 'object') return { error: ERR.badResult };
  const score = cleanScore(lobby, input.score);
  if (!score) return { error: ERR.badResult };
  const l = copy(lobby);
  l.score = score;
  if (input.final === false) return { lobby: l, event: 'roundEnd', payload: { score } };
  let winner = input.winner == null ? null : input.winner;
  if (winner !== null) {
    const ok = l.mode === 'ffa' ? typeof winner === 'string' && l.slots.some((s) => s.kind !== 'open' && s.id === winner) : winner === 0 || winner === 1;
    if (!ok) return { error: ERR.badResult };
  }
  l.state = 'results';
  return { lobby: l, event: 'matchEnd', payload: { winner, score } };
}

/** Host: results -> waiting with the same people; bots go back to open placeholders. */
export function backToLobby(lobby, id) {
  if (lobby.hostId !== id) return { error: ERR.notHost };
  if (lobby.state !== 'results') return { error: ERR.notWaiting };
  const l = copy(lobby);
  l.slots = l.slots.map((s, i) => (s.kind === 'human' ? s : openSlot(l.mode, i, l.slots.length)));
  l.state = 'waiting';
  l.relayCode = null;
  l.seed = 0;
  l.score = freshScore(l);
  return { lobby: l };
}

/** The exact shape clients get (no tokens). */
export function publicLobby(l) {
  const host = l.slots.find((s) => s.id === l.hostId);
  return {
    code: l.code,
    hostId: l.hostId,
    type: l.type,
    mode: l.mode,
    maxPlayers: l.slots.length,
    fillWithBots: l.fillWithBots,
    botDifficulty: l.botDifficulty,
    roundsToWin: l.roundsToWin,
    state: l.state,
    slots: l.slots.map((s) => ({ id: s.id, kind: s.kind, name: s.name, team: s.team, look: s.look || null })),
    score: { ...l.score },
    name: host ? host.name : '',
  };
}

// ------------------------------------------------------------------ index (party/lobbyIndex.js)
// index: Map<code, { at, owner, entry }>; owner is an opaque key (hashed IP), never sent out.

/** Public-list row for a lobby. */
export function indexEntry(l) {
  return {
    code: l.code,
    name: (publicLobby(l).name || '').slice(0, 16),
    mode: l.mode,
    players: humansOf(l).length,
    max: l.slots.length,
    state: l.state,
    public: l.type === 'public',
  };
}

function prune(index, now) {
  for (const [code, e] of index) if (now - e.at > INDEX_TTL_MS) index.delete(code);
}

/** Reserve a code for a new lobby: refused if in use or the owner holds too many. */
export function indexClaim(index, code, owner, now) {
  if (!validLobbyCode(code)) return { ok: false, error: 'bad' };
  prune(index, now);
  if (index.has(code)) return { ok: false, error: 'taken' };
  let mine = 0;
  for (const e of index.values()) if (owner && e.owner === owner) mine++;
  if (mine >= MAX_LOBBIES_PER_OWNER) return { ok: false, error: 'limit' };
  index.set(code, { at: now, owner: String(owner || ''), entry: null });
  return { ok: true };
}

/** Refresh a lobby's row (sent by the lobby room on every change and on a heartbeat). */
export function indexUpsert(index, raw, now) {
  if (!raw || !validLobbyCode(raw.code)) return { ok: false };
  const entry = {
    code: raw.code,
    name: cleanLobbyName(raw.name),
    mode: LOBBY_MODES.includes(raw.mode) ? raw.mode : '1v1',
    players: isInt(raw.players, 0, MAX_LOBBY) ? raw.players : 0,
    max: isInt(raw.max, 2, MAX_LOBBY) ? raw.max : MAX_LOBBY,
    state: ['waiting', 'countdown', 'playing', 'results'].includes(raw.state) ? raw.state : 'waiting',
    public: raw.public === true,
  };
  const old = index.get(raw.code);
  index.set(raw.code, { at: now, owner: old ? old.owner : '', entry });
  return { ok: true };
}

export function indexRemove(index, code) {
  index.delete(code);
}

/** Public lobbies: joinable waiting ones first, then full waiting ones, then running ones. */
export function indexList(index, now) {
  prune(index, now);
  const rank = (e) => (e.state !== 'waiting' ? 2 : e.full ? 1 : 0);
  const rows = [];
  for (const { entry } of index.values()) {
    if (!entry || !entry.public) continue;
    rows.push({ code: entry.code, name: entry.name, mode: entry.mode, players: entry.players, max: entry.max, state: entry.state, full: entry.players >= entry.max });
  }
  return rows
    .map((r, i) => [r, i])
    .sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1])
    .slice(0, MAX_LISTED)
    .map(([r]) => r);
}
