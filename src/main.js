// BENTONVILLE ROYALE — entry point: boot into the title screen, wire menus to the game.

import { Game } from './game/Game.js';
import { createMenus } from './ui/menus.js';
import { loadSettings, saveSettings } from './ui/settings.js';
import { sfx } from './audio/Sfx.js';
import { createGoogleTilesController, hasGoogleTilesKey } from './render/GoogleTiles.js';

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
  onPlay: () => play(),
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
  onPlayAgain: () => play(),
  onResume: () => game && game.pause(false),
  onLeave: () => {
    if (game) game.leave();
    closeMultiplayer();
    sfx.playMusic('menu');
  },
  onHost: (name) => hostMultiplayer(name),
  onJoin: (code, name) => joinMultiplayer(code, name),
  onLobbyStart: () => startHostedMatch(),
  onLobbyFill: (on) => mp && mp.room && mp.room.setFill(on),
  onLobbyLeave: () => {
    closeMultiplayer();
    menus.showTitle();
  },
  googleTilesAvailable: hasGoogleTilesKey(),
  onSettings: (s) => {
    settings = s;
    saveSettings(s);
    googleTiles.setEnabled(s.googleTiles);
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
  return { ...info, isHost: true, canStart: true, status: 'Share the code. Start when everyone is in.', ...extra };
}

function clientLobby(info, extra = {}) {
  const players = (info.players || []).map((p) => ({ ...p, you: p.id === info.you }));
  return { ...info, players, isHost: false, canStart: false, status: 'Waiting for the host to start…', ...extra };
}

/** Preload the map while sitting in a lobby so the match starts fast. */
function preloadInLobby() {
  if (!game.loaded) loadGame().catch((err) => console.error(err));
}

async function hostMultiplayer(name) {
  closeMultiplayer();
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

async function startHostedMatch() {
  const me = mp;
  if (!me || me.role !== 'host' || !me.room || me.room.closed || me.room.started) return;
  // Close the room to new joins now, not when the match is live: a guest joining
  // during the load / startMatch would get a welcome but never a start message.
  me.room.started = true;
  try {
    await ensureLoaded();
    if (mp !== me) return;
    const { HostSession } = await import('./net/HostSession.js');
    game.net = new HostSession(me.room, game, { fill: me.room.fill });
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
    if (mp === me && !me.room.closed) {
      me.room.started = false; // reopen the lobby to joins
      menus.showLobby(hostLobby(me.room.lobbyInfo()));
    }
  }
}

async function joinMultiplayer(code, name) {
  closeMultiplayer();
  const me = { role: 'client', conn: null, name };
  mp = me;
  const shown = String(code || '').toUpperCase();
  menus.showLobby({ isHost: false, code: shown, players: [], max: 16, fill: true, status: 'Joining…', canStart: false });
  try {
    const [{ joinRoom }, { ClientSession }] = await Promise.all([import('./net/Net.js'), import('./net/ClientSession.js')]);
    const conn = await joinRoom(code, { name });
    if (mp !== me) return conn.close();
    me.conn = conn;
    conn.onLobby = (info) => {
      if (mp === me && menus.current === 'lobby') menus.showLobby(clientLobby(info));
    };
    conn.onClose = (reason) => {
      if (mp !== me) return;
      mp = null;
      if (game.state !== 'menu') game.leave();
      sfx.playMusic('menu');
      menus.showNotice(reason);
    };
    conn.onStart = async (msg) => {
      if (mp !== me) return;
      let session = null;
      try {
        session = new ClientSession(conn, game); // queues match messages until begin()
        await ensureLoaded();
        if (mp !== me) return session.dispose(game);
        game.net = session;
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
    menus.showLobby(clientLobby(conn.lobbyInfo()));
    preloadInLobby();
  } catch (err) {
    console.error(err);
    if (mp !== me) return;
    mp = null;
    menus.showNotice(errText(err, 'Could not join that room.'));
  }
}

async function play() {
  try {
    closeMultiplayer();
    await ensureLoaded();
    game.startMatch();
  } catch (err) {
    console.error(err);
    showError('Could not start the match: ' + (err && err.message ? err.message : err));
    menus.showTitle();
  }
}

try {
  game = new Game({ canvas, uiRoot, menus, settings });
  menus.showTitle();
  // share links look like ?room=ABCD: prefill the join code
  const roomParam = new URLSearchParams(location.search).get('room');
  if (roomParam) menus.setJoinCode(roomParam);
  sfx.playMusic('menu');
  googleTiles.setEnabled(settings.googleTiles);
} catch (err) {
  console.error(err);
  showError('Bentonville Royale needs WebGL: ' + (err && err.message ? err.message : err));
}
