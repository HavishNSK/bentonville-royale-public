// BENTONVILLE ROYALE — entry point: boot into the title screen, wire menus to the game.

import { Game } from './game/Game.js';
import { createMenus } from './ui/menus.js';
import { loadSettings, saveSettings } from './ui/settings.js';
import { sfx } from './audio/Sfx.js';
import { createGoogleTilesController, hasGoogleTilesKey } from './render/GoogleTiles.js';
import { inject as injectAnalytics } from '@vercel/analytics';
import { teamSize, normalizeMode } from './game/Teams.js';
import { createAccount } from './net/Account.js';
import { createMeta } from './ui/meta.js';
import { RANKED_NOTE } from './core/config.js';
import { lookString, parseLook } from './game/Cosmetics.js';

// Vercel Web Analytics: anonymous page views / visitors (no cookies). Only reports from the Vercel deployment.
try {
  injectAnalytics();
} catch (err) {
  /* analytics must never break the game */
}

const canvas = document.getElementById('game');
const uiRoot = document.getElementById('ui-root');
const bootError = document.getElementById('boot-error');

function showError(msg) {
  bootError.textContent = msg;
  bootError.style.display = 'block';
}

let settings = loadSettings();
sfx.autoUnlock(window);
sfx.setVolume(settings.volume);

// Optional local menu music, served only by the local dev/preview server from
// local-music/menu.mp3 (git-ignored, never built or deployed). Falls back to
// the synthesized theme when absent.
fetch('/local-music/menu.mp3', { method: 'HEAD' })
  .then((r) => {
    const type = r.headers.get('content-type') || '';
    if (r.ok && type.startsWith('audio/')) sfx.setCustomMusic('menu', '/local-music/menu.mp3');
  })
  .catch(() => {});

let game = null;

// Optional Google Photorealistic 3D Tiles view (off by default; inert without a key).
// The library is only imported when the toggle is on and a key is configured.
const googleTiles = createGoogleTilesController({
  getGame: () => game,
  onFail: () => {
    settings = { ...settings, googleTiles: false };
    saveSettings(settings);
    menus.setSettings(settings);
  },
});

const menus = createMenus(uiRoot, {
  settings,
  onClick: () => sfx.play('ui_click'),
  onHover: () => sfx.play('ui_hover', { volume: 0.4 }),
  onPlay: () => partyPlay(),
  onPartyReady: (on) => party && party.ready(on),
  onPartyCancel: () => party && party.cancel(),
  onPartyMode: (mode) => partySetMode(mode),
  onPartyFill: (on) => partySetFill(on),
  onPartyKick: (id) => party && party.kick(id),
  onPartyPromote: (id) => party && party.promote(id),
  onPartyJoin: (code) => joinParty(code),
  onPartyLeave: () => joinParty(null),
  onPartyRetry: () => joinParty(null),
  onNameChange: (name) => party && party.setName(name),
  onFreeBuild: async () => {
    try {
      closeMultiplayer();
      await ensureLoaded();
      game.startMatch(undefined, { freeBuild: true });
    } catch (err) {
      console.error(err);
      showError('Could not start free build: ' + (err && err.message ? err.message : err));
      menus.showTitle();
    }
  },
  onPlayAgain: () => playLocal(lastLocal.mode, lastLocal.fill),
  onResume: () => game && game.pause(false),
  onLeave: () => {
    if (game) game.leave();
    closeMultiplayer();
    sfx.playMusic('menu');
    renderParty();
  },
  onHost: (name) => hostMultiplayer(name),
  onJoin: (code, name) => joinMultiplayer(code, name),
  onLobbyStart: () => startHostedMatch(),
  onLobbyFill: (on) => mp && mp.room && mp.room.setFill(on),
  onLobbyMode: (mode) => {
    if (!mp || !mp.room) return;
    mp.room.setMode(normalizeMode(mode));
  },
  onLobbyReady: (on) => mp && mp.conn && mp.conn.setReady(on),
  onLobbyLeave: () => {
    closeMultiplayer();
    menus.showTitle();
  },
  googleTilesAvailable: hasGoogleTilesKey(),
  // menus.js settings → onSettings; sole boot-path googleTiles wiring; reads settings.performanceMode/googleTiles; user: Chromebook performance mode
  onSettings: (s) => {
    settings = s;
    saveSettings(s);
    googleTiles.setEnabled(!!s.googleTiles && !s.performanceMode);
    if (game) game.applySettings(s);
    else {
      // no Game yet (WebGL failed): still honour the audio sliders, as Game.applySettings does
      sfx.setVolume(s.volume);
      sfx.setSfxVolume(s.sfxVolume ?? 1);
      sfx.setUiVolume(s.uiVolume ?? 1);
      if (s.musicVolume != null) sfx.setMusicVolume(s.musicVolume);
    }
  },
});

// One shared load, so a background preload in a lobby and a later start never load twice.
let loading = null;
function loadGame(onProgress) {
  if (game.loaded) return Promise.resolve();
  if (!loading) {
    const fns = new Set();
    loading = game.load((p, label) => fns.forEach((fn) => fn(p, label)));
    loading.fns = fns;
    loading.catch(() => (loading = null));
  }
  if (onProgress) loading.fns.add(onProgress);
  return loading;
}

async function ensureLoaded() {
  if (game.loaded) return;
  menus.showLoading(0, 'Warming up');
  await loadGame((p, label) => menus.setLoading(p, label));
}

// ---------------------------------------------------------------- multiplayer
// Net code (src/net) is imported only here, when the player hosts or joins.
// mp = { role: 'host', room, name } | { role: 'client', conn, name }
let mp = null;

function closeMultiplayer() {
  const cur = mp;
  mp = null;
  if (!cur) return;
  if (cur.room) cur.room.close();
  if (cur.conn) cur.conn.close();
}

function errText(err, fallback) {
  return err && err.message ? err.message : fallback;
}

function hostLobby(info, extra = {}) {
  const waiting = (info.players || []).filter((p) => !p.host && !p.ready).length;
  const status = waiting ? `Waiting for ${waiting} to ready up.` : 'Share the code. Start when everyone is in.';
  return { ...info, isHost: true, canStart: !waiting, status, ...extra };
}

function clientLobby(info, extra = {}) {
  const players = (info.players || []).map((p) => ({ ...p, you: p.id === info.you }));
  const me = players.find((p) => p.you);
  const status = me && me.ready ? 'Ready. Waiting for the host to start…' : 'Ready up when you are set.';
  return { ...info, players, isHost: false, canStart: false, ready: !!(me && me.ready), status, ...extra };
}

/** Private match: humans pack into teams in join order (host first). */
function joinOrderTeams(players, mode) {
  const size = teamSize(mode);
  const teams = [];
  for (let i = 0; i < players.length; i += size) teams.push({ ids: players.slice(i, i + size).map((p) => p.id), allowBots: true });
  return teams;
}

/** Preload the map while sitting in a lobby so the match starts fast. */
function preloadInLobby() {
  if (!game.loaded) loadGame().catch((err) => console.error(err));
}

async function hostMultiplayer(name) {
  closeMultiplayer();
  if (party && party.me && party.me.ready && !party.isLeader) party.ready(false);
  const me = { role: 'host', room: null, name };
  mp = me;
  menus.showLobby({ isHost: true, code: '', players: [{ id: 0, name, host: true }], max: 16, fill: true, status: 'Opening a room…', canStart: false });
  try {
    const { hostRoom } = await import('./net/Net.js');
    const room = await hostRoom({ name });
    if (mp !== me) return room.close(); // left while connecting
    me.room = room;
    room.onLobby((info) => {
      if (mp === me && menus.current === 'lobby') menus.showLobby(hostLobby(info));
    });
    room.onError = (text) => {
      if (mp !== me) return;
      if (menus.current === 'lobby') menus.showLobby(hostLobby(room.lobbyInfo(), { canStart: false, status: '', error: text }));
      else console.warn('[net]', text);
    };
    menus.showLobby(hostLobby(room.lobbyInfo()));
    preloadInLobby();
  } catch (err) {
    console.error(err);
    if (mp !== me) return;
    // stay in the lobby (mp keeps pointing at `me`, room null) so LEAVE goes back to the title
    menus.showLobby({ isHost: true, code: '', players: [{ id: 0, name, host: true }], max: 16, fill: true, status: '', canStart: false, error: errText(err, 'Could not open a room.') });
  }
}

/** Private-match START (host): only when every guest is ready. */
function startHostedMatch() {
  const me = mp;
  if (!me || me.role !== 'host' || !me.room || me.room.closed || me.room.started) return;
  if (!me.room.allReady()) return;
  const mode = normalizeMode(me.room.mode);
  return runHostedMatch(me, { fill: me.room.fill, mode, humanTeams: joinOrderTeams(me.room.players, mode) });
}

async function runHostedMatch(me, sessionOpts) {
  // Close the room to new joins now, not when the match is live: a guest joining
  // during the load / startMatch would get a welcome but never a start message.
  me.room.started = true;
  try {
    await ensureLoaded();
    if (mp !== me) return;
    const { HostSession } = await import('./net/HostSession.js');
    game.net = new HostSession(me.room, game, sessionOpts);
    game.startMatch((Math.random() * 1e9) | 0);
  } catch (err) {
    console.error(err);
    // tear the session down like Game.leave(), but keep the room so the host can retry
    const net = game.net;
    game.net = null;
    if (net) {
      try {
        net.dispose(game, { keepRoom: true });
      } catch (e) {
        console.error(e);
      }
      game.combat.authoritative = true;
    }
    if (game.state !== 'menu') game.leave(); // a half-started match goes back to the menu
    showError('Could not start the match: ' + errText(err, err));
    if (me.match) {
      // matchmade: there is no lobby to go back to
      closeMultiplayer();
      menus.showNotice('Could not start the match.');
      renderParty();
    } else if (mp === me && !me.room.closed) {
      me.room.started = false; // reopen the lobby to joins
      menus.showLobby(hostLobby(me.room.lobbyInfo()));
    }
  }
}

/**
 * Join a game room as a guest. Private match: shows the lobby. Matchmade (`match`
 * set): stays on the party screen, joins with the party token and retries while
 * the host is still opening the room.
 */
async function joinMultiplayer(code, name, match = null) {
  closeMultiplayer();
  if (!match && party && party.me && party.me.ready && !party.isLeader) party.ready(false);
  const me = { role: 'client', conn: null, name, match };
  mp = me;
  const shown = String(code || '').toUpperCase();
  if (!match) menus.showLobby({ isHost: false, code: shown, players: [], max: 16, fill: true, status: 'Joining…', canStart: false });
  try {
    const [{ joinRoom }, { ClientSession }] = await Promise.all([import('./net/Net.js'), import('./net/ClientSession.js')]);
    const conn = await joinRoom(code, match ? { name, token: match.token, retryMs: 10000 } : { name });
    if (mp !== me) return conn.close();
    me.conn = conn;
    if (match) setMatchStatus('Match found! Waiting for the match to start…');
    conn.onLobby = (info) => {
      if (mp === me && !match && menus.current === 'lobby') menus.showLobby(clientLobby(info));
    };
    conn.onClose = (reason) => {
      if (mp !== me) return;
      mp = null;
      matchStatus = '';
      if (game.state !== 'menu') game.leave();
      sfx.playMusic('menu');
      menus.showNotice(reason);
      renderParty();
    };
    conn.onStart = async (msg) => {
      if (mp !== me) return;
      let session = null;
      try {
        session = new ClientSession(conn, game); // queues match messages until begin()
        await ensureLoaded();
        if (mp !== me) return session.dispose(game);
        // the host plays a different map file (one of us has a stale build): don't play on it.
        // Hosts from before this check send no map id: allow.
        if (msg.map && game.mapId && msg.map !== game.mapId) {
          session.dispose(game);
          game.combat.authoritative = true;
          closeMultiplayer();
          menus.showNotice('Your game files are out of date \u2014 refresh the page.');
          return;
        }
        game.net = session;
        matchStatus = '';
        game.startClientMatch(msg);
      } catch (err) {
        console.error(err);
        if (game.net === session) game.net = null;
        if (session) {
          try {
            session.dispose(game);
          } catch (e) {
            console.error(e);
          }
          game.combat.authoritative = true;
        }
        if (game.state !== 'menu') game.leave();
        closeMultiplayer();
        menus.showNotice('Could not join the match: ' + errText(err, err));
      }
    };
    if (!match) menus.showLobby(clientLobby(conn.lobbyInfo()));
    preloadInLobby();
  } catch (err) {
    console.error(err);
    if (mp !== me) return;
    mp = null;
    matchStatus = '';
    menus.showNotice(errText(err, 'Could not join that room.'));
    renderParty();
  }
}

// ---------------------------------------------------------------- party
// Everyone on the title screen is in a party (src/net/Party.js; a party of one
// by default). The leader's PLAY goes to the matchmaker; the plan names a game
// room code and which member hosts it. Without the party server, PLAY starts a
// local match with bots in the chosen mode.
let party = null; // PartyConn | null (offline)
let partyMod = null;
let partyGen = 0;
let partyConnecting = false;
let matchStatus = ''; // "Match found! ..." while handing off to the game room
const lastLocal = { mode: 'solo', fill: true }; // offline mode / fill, and what the next party starts with
// Who's online (src/net/Presence.js): every title screen reports its name and what it is doing,
// so players can see each other and queue in the same mode at the same time.
let presence = null;
let presenceInMatch = false;
let chat = null; // global chat (src/ui/chat.js), fed by the presence socket

function partyMode() {
  return party && party.party ? party.party.mode : lastLocal.mode;
}

function presenceStatus() {
  if (presenceInMatch) return 'match';
  return party && party.party && party.party.state === 'queued' ? 'queued' : 'lobby';
}

function syncPresence() {
  if (presence) presence.set({ name: menus.playerName(), status: presenceStatus(), mode: partyMode(), accountToken: account.sessionToken });
  if (chat) {
    chat.setMe(menus.playerName());
    chat.setMode(presenceInMatch ? 'match' : 'lobby');
  }
}

/** Players searching in our mode right now, not counting our own party. */
function othersSearching() {
  const snap = presence && presence.snap;
  if (!snap) return 0;
  const n = snap.searching[partyMode()] || 0;
  const mine = presenceStatus() === 'queued' ? (party && party.party ? party.party.members.length : 1) : 0;
  return Math.max(0, n - mine);
}

async function startPresence() {
  try {
    const [{ partyToken }, { openPresence }, { createChat }] = await Promise.all([import('./net/Party.js'), import('./net/Presence.js'), import('./ui/chat.js')]);
    chat = createChat({
      onSend: (text) => presence && presence.sendChat(text),
      onBlocked: (category) => presence && presence.reportBlocked && presence.reportBlocked(category),
      onTypingChange: (on) => game && game.setChatTyping && game.setChatTyping(on),
    });
    presence = openPresence({ token: partyToken(), accountToken: account.sessionToken, name: menus.playerName(), status: presenceStatus(), mode: partyMode() });
    chat.setMe(menus.playerName());
    chat.setMode(presenceInMatch ? 'match' : 'lobby');
    presence.onChat = (m) => chat.add(m);
    presence.onChatError = (reason) => chat.error(reason);
    presence.onUpdate = (snap) => {
      if (meta) meta.setOnline(snap);
      if (chat) chat.setOnline(!!snap);
      renderParty();
    };
  } catch (err) {
    console.warn('[presence]', errText(err, err));
  }
}

function setMatchStatus(text) {
  matchStatus = text;
  renderParty();
}

function partyView() {
  if (!party || !party.party) {
    return {
      online: false,
      connecting: partyConnecting,
      isLeader: true,
      mode: lastLocal.mode,
      fill: lastLocal.fill,
      state: 'idle',
      members: [{ id: 'me', name: menus.playerName(), ready: true, leader: true, you: true }],
      match: matchStatus,
      searching: 0,
    };
  }
  const p = party.party;
  return {
    online: true,
    code: p.code,
    link: partyMod.inviteLink(p.code),
    isLeader: party.isLeader,
    mode: p.mode,
    fill: p.fill,
    state: p.state,
    queuedSince: p.queuedSince,
    members: p.members.map((m) => ({ ...m, you: m.id === party.you })),
    match: matchStatus,
    searching: othersSearching(),
  };
}

function renderParty() {
  syncPresence();
  menus.setParty(partyView());
  if (meta) meta.refresh();
  // friends see which party we are in (and that we are back in the lobby)
  if (account && (!game || game.state === 'menu')) account.setStatus('lobby', party && party.party ? party.party.code : null);
}

// ---------------------------------------------------------------- account, shop, locker, friends
// Signed in: profile on the account server (party/accounts.js). Otherwise a guest profile in
// localStorage. Equipped outfit / emotes go to the Game and to the party line-up.
const account = createAccount();
let meta = null;

// The party this tab is in survives a page refresh: rejoined with the same tab token, the
// party server hands back our old slot (party/partyRoom.js keeps it ~20 s).
const PARTY_CODE_KEY = 'bentonville-royale.partyCode';
function savedPartyCode() {
  try {
    return sessionStorage.getItem(PARTY_CODE_KEY) || '';
  } catch {
    return '';
  }
}
function savePartyCode(code) {
  try {
    if (code) sessionStorage.setItem(PARTY_CODE_KEY, code);
    else sessionStorage.removeItem(PARTY_CODE_KEY);
  } catch {
    /* private mode */
  }
}

async function joinParty(code = null, quiet = false) {
  const gen = ++partyGen;
  const prev = party;
  party = null;
  if (prev) prev.leave();
  partyConnecting = true;
  renderParty();
  try {
    partyMod = partyMod || (await import('./net/Party.js'));
    const p = await partyMod.openParty({ name: menus.playerName(), code, mode: lastLocal.mode, fill: lastLocal.fill, skin: lookString(account.profile.equipped) });
    if (gen !== partyGen) return p.leave();
    partyConnecting = false;
    party = p;
    savePartyCode(p.code);
    // the account may have loaded while we were connecting: make sure the party shows our
    // real name and outfit, not what we had when the connection started
    p.setName(menus.playerName());
    if (p.setSkin) p.setSkin(lookString(account.profile.equipped));
    p.onState = (st) => {
      if (party !== p) return;
      lastLocal.mode = st.mode;
      lastLocal.fill = st.fill;
      renderParty();
    };
    p.onNotice = (text, isError) => party === p && menus.partyNotice(text, isError);
    p.onMatch = (plan) => party === p && onMatchFound(plan);
    p.onClose = (reason) => {
      if (party !== p) return;
      party = null;
      if (reason === 'kicked') {
        menus.partyNotice(partyMod.PARTY_MSG.kicked, true);
        joinParty(null);
      } else {
        // lost the socket: try the same party again, else start a new one
        setTimeout(() => party === null && gen === partyGen && joinParty(p.code), 1000);
      }
    };
    renderParty();
  } catch (err) {
    if (gen !== partyGen) return;
    partyConnecting = false;
    if (code) {
      // a refresh into a party that has since ended just starts a new one, no error
      if (!quiet) menus.partyNotice(errText(err, 'Could not join that party.'), true);
      return joinParty(null);
    }
    console.warn('[party]', errText(err, err));
    renderParty(); // offline: PLAY runs locally
  }
}

function partySetMode(mode) {
  mode = normalizeMode(mode);
  if (party) party.setMode(mode);
  else {
    lastLocal.mode = mode;
    if (mode === 'solo') lastLocal.fill = true;
    renderParty();
  }
}

function partySetFill(on) {
  if (party) party.setFill(on);
  else {
    lastLocal.fill = lastLocal.mode === 'solo' ? true : !!on;
    renderParty();
  }
}

/** The big button for the leader: matchmaking online, a local match offline. */
function partyPlay() {
  if (matchStatus) return;
  if (party && party.party) {
    if (party.isLeader) party.play();
    return;
  }
  playLocal(lastLocal.mode, lastLocal.fill);
}

function onMatchFound(plan) {
  // busy in a private lobby or a match: skip this one
  if (mp || game.state !== 'menu') return;
  const token = party.token;
  const name = menus.playerName();
  if (plan.hostToken === token) hostMatch(plan, name, token);
  else joinMultiplayer(plan.code, name, { ...plan, token });
}

async function hostMatch(plan, name, token) {
  closeMultiplayer();
  const me = { role: 'host', room: null, name, match: plan };
  mp = me;
  const expected = new Set();
  for (const t of plan.teams) for (const tok of t.tokens) if (tok !== token) expected.add(tok);
  const total = expected.size + 1;
  setMatchStatus(`Match found! Setting up the match…`);
  try {
    const { hostRoom } = await import('./net/Net.js');
    const room = await hostRoom({ name, code: plan.code });
    if (mp !== me) return room.close();
    me.room = room;
    room.mode = normalizeMode(plan.mode);
    preloadInLobby();
    room.onError = (text) => mp === me && console.warn('[net]', text);
    // wait for every expected player (or 20 s; late joiners are turned away)
    await new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve();
      };
      const check = () => {
        if (done) return;
        if (mp !== me) return finish();
        const have = [...room.clients.values()].filter((c) => expected.has(c.token)).length;
        setMatchStatus(`Match found! Waiting for players ${have + 1}/${total}`);
        if (have >= expected.size) finish();
      };
      const timer = setTimeout(finish, 20000);
      room.onLobby(check);
      check();
    });
    if (mp !== me) return;
    // strangers and duplicate tokens don't belong in this match
    const slotOf = new Map([[token, 0]]);
    for (const c of [...room.clients.values()]) {
      if (!expected.has(c.token) || slotOf.has(c.token)) room.kick(c.id, 'started');
      else slotOf.set(c.token, c.id);
    }
    const humanTeams = plan.teams
      .map((t) => ({ ids: t.tokens.filter((tok) => slotOf.has(tok)).map((tok) => slotOf.get(tok)), allowBots: !!t.allowBots }))
      .filter((t) => t.ids.length);
    matchStatus = '';
    await runHostedMatch(me, { fill: true, mode: room.mode, humanTeams });
  } catch (err) {
    console.error(err);
    if (mp !== me) return;
    closeMultiplayer();
    matchStatus = '';
    menus.partyNotice('Could not set up the match: ' + errText(err, err), true);
    renderParty();
  }
}

/** Local match with bots (offline, Free Build aside, and PLAY AGAIN after one). */
async function playLocal(mode = 'solo', fill = true) {
  lastLocal.mode = normalizeMode(mode);
  lastLocal.fill = fill;
  try {
    closeMultiplayer();
    await ensureLoaded();
    game.startMatch(undefined, { mode: lastLocal.mode, fill: lastLocal.fill });
  } catch (err) {
    console.error(err);
    showError('Could not start the match: ' + (err && err.message ? err.message : err));
    menus.showTitle();
  }
}

try {
  game = new Game({ canvas, uiRoot, menus, settings });
  game.setCosmetics(account.profile.equipped);
  meta = createMeta(menus, account, {
    onClick: () => sfx.play('ui_click'),
    partyCode: () => (party && party.party ? party.party.code : null),
    partyMembers: () => (party && party.party ? party.party.members.map((m) => ({ name: m.name, ...parseLook(m.skin), you: m.id === party.you })) : []),
    onJoinParty: (code) => {
      if (game.state !== 'menu') return;
      joinParty(code);
    },
    onCosmetics: (c) => {
      game.setCosmetics(c);
      if (party && party.setSkin) party.setSkin(lookString(c));
    },
    onName: (name) => {
      menus.setAccountName(name);
      if (party) party.setName(name);
    },
  });
  account.on('change', (p) => {
    if (p.guest) menus.setAccountName(null);
    syncPresence();
  });
  // QA (dev builds): the party as this tab sees it
  if (import.meta.env && import.meta.env.DEV) window.__party = () => (party && party.party ? JSON.parse(JSON.stringify(party.party)) : null);
  menus.onScreen = (s) => {
    meta.setActive(s === 'title');
    if (s === 'title') presenceInMatch = false;
    else if (s === null) presenceInMatch = true;
    syncPresence();
    const code = party && party.party ? party.party.code : null;
    if (s === 'title') account.setStatus('lobby', code);
    else if (s === null) account.setStatus('match', code); // the HUD took over: in a match
  };
  // Clever OAuth returns ?br_auth=<ticket>; redeem once then strip from the URL.
  const authTicket = new URLSearchParams(location.search).get('br_auth');
  const afterAuth = (p) => {
    if (!p.guest) menus.setAccountName(p.name);
  };
  if (authTicket) {
    account
      .redeemAuthTicket(authTicket)
      .then((p) => {
        afterAuth(p);
        try {
          const u = new URL(location.href);
          u.searchParams.delete('br_auth');
          history.replaceState({}, '', u.pathname + u.search + u.hash);
        } catch {
          /* ignore */
        }
      })
      .catch(() => account.init().then(afterAuth));
  } else {
    account.init().then(afterAuth);
  }
  // coins + leaderboard stats for every finished match
  game.onMatchEnd = async (r) => {
    const players = r.mode && r.mode !== 'solo' ? r.teams : r.total;
    const ranked = !!r.ranked;
    const out = await account.reward({ kills: r.kills | 0, placement: r.placement | 0, players: players | 0, won: !!r.victory, ranked });
    if (out.saved && out.earned > 0) menus.showReward(out.earned);
    if (!meta) return;
    if (out.guest) meta.matchReward(0, 'Sign in to save eliminations and coins.');
    else if (out.saved && out.earned > 0) meta.matchReward(out.earned);
    else if (out.saved && !ranked) meta.matchReward(0, `Not ranked. ${RANKED_NOTE}`);
    else if (out.saved && (r.kills | 0) > 0) meta.matchReward(0, `Saved ${r.kills | 0} elim${(r.kills | 0) === 1 ? '' : 's'} to the ranks.`);
    else if (!out.saved && out.error) meta.matchReward(0, out.error);
  };
  menus.showTitle();
  // share links look like ?room=ABCD: prefill the private-match join code
  const roomParam = new URLSearchParams(location.search).get('room');
  if (roomParam) menus.setJoinCode(roomParam);
  // party invite links look like ?p=ABCD
  const invite = (() => {
    const q = new URLSearchParams(location.search);
    return (q.get('p') || q.get('invite') || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
  })();
  const rejoin = savedPartyCode();
  if (invite.length === 4) joinParty(invite);
  else joinParty(/^[A-Z]{4}$/.test(rejoin) ? rejoin : null, true);
  startPresence();
  sfx.playMusic('menu');
  googleTiles.setEnabled(settings.googleTiles);
} catch (err) {
  console.error(err);
  showError('Bentonville Royale needs WebGL: ' + (err && err.message ? err.message : err));
}
