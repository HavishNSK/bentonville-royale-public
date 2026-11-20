// BENTONVILLE ROYALE — Box Fights custom lobbies, end to end: screens (boxLobby.js) <-> lobby
// server (src/net/Lobby.js) <-> relay match (Net.js + HostSession / ClientSession) <-> Game.
//
//   const flow = createBoxLobbyFlow({ game, menus, sfx, deps });   (main.js)
//   flow.openHome()            Screen A+C: the public lobby browser (title: BOX FIGHTS LOBBIES)
//   flow.owns()                true while a lobby match or a Play with Bots match is ours to end
//   flow.leave()               results LEAVE / pause LEAVE MATCH: out of the match and the lobby -> A
//   flow.backToLobby()         results BACK TO LOBBY (host / offline)
//   flow.onGameMatchEnd(r)     Game.onMatchEnd: the host reports the result to the lobby
//   flow.busy()                in a lobby (matchmaking must not pull us out)
//
// Flow: A -> Host (B) -> createLobby -> room (E) ... host START -> server countdown 5..1 ->
// matchStart: the host opens the relay room (relayCode), waits for the guests' tokens (15 s
// max), then HostSession with the lobby slots (tokens merged) + game.startMatch(seed); guests
// joinRoom(relayCode, { token }) and start on the host's start message. Match end: the current
// host's browser calls reportResult(final); everyone sees Results (G); the host's BACK TO
// LOBBY -> lobby state 'waiting' -> every browser returns to the room. Offline Play with Bots
// never touches the network.
//
// Lobby codes are joining conveniences, not authentication; the host's browser runs the match.

import { lookString } from '../game/Cosmetics.js';
import { nameIsClean } from '../net/chatFilter.js';
import { sameWorld } from '../net/worldIdentity.js';
import { createBoxLobbyUI } from './boxLobby.js';
import {
  DEFAULT_HOST_SETTINGS, applyHostSettings, offlineBoxOpts, listRows, filterRows, slotListView, startState, playerCount, codeError, sanitizeCodeInput,
  hostSessionOpts, expectedGuestTokens, lobbyReport, actorSlotMap, SERVER_ERRORS,
} from './boxLobbyModel.js';

const LIST_REFRESH_MS = 3000;
const HOST_WAIT_MS = 15000; // the host starts with whoever reached the relay room by then
const CLOSE_TEXT = {
  kicked: 'The host removed you from the lobby.',
  lost: 'Lost the connection to the lobby.',
  replaced: 'This lobby was opened in another tab.',
};

/**
 * deps: { ensureLoaded(), loadGame(onProgress), closeMultiplayer(), unreadyForSolo(), playBoxFight(opts),
 *         account, onBack(), onClick(), onHover(), keyLabel(action), onCosmetics(equipped) }
 * (HostRoom.started: closed to joins; set only after the guests are in, as main.js does.)
 */
export function createBoxLobbyFlow({ game, menus, sfx, deps }) {
  let lobbyMod = null;
  let lb = null; // LobbyConn
  let relay = null; // { role:'host', room } | { role:'client', conn }
  let phase = null; // 'home'|'settings'|'code'|'room'|'match'|'results'
  let offline = false; // Play with Bots flow active (no lobby)
  let hostSettings = { ...DEFAULT_HOST_SETTINGS };
  let botSettings = { ...DEFAULT_HOST_SETTINGS, type: 'private' };
  let settingsView = { offline: false, editing: false, busy: false, error: '' };
  let homeNotice = { text: '', error: false };
  let list = { loading: false, error: '', rows: [], joining: null, joinError: '' };
  let filter = 'any';
  let privateOpen = false;
  let listTimer = 0;
  let listGen = 0;
  let code = { value: '', error: '', busy: false };
  let room = { countdown: 0, notice: '', noticeError: false, loading: '', in3D: false };
  let matchMsg = null; // last matchStart (host: tokens)
  let gen = 0; // bumps on every leave: stale async work checks it

  const ui = createBoxLobbyUI(menus, {
    onClick: deps.onClick,
    onHover: deps.onHover,
    keyLabel: deps.keyLabel,
    on: {
      // A+C: home = public lobby browser
      hostPublic: () => openSettings({ offline: false, type: 'public' }),
      privateOpen: () => {
        privateOpen = true;
        renderHome();
      },
      privateClose: () => {
        privateOpen = false;
        renderHome();
        focusLater('private');
      },
      private: () => {
        privateOpen = false;
        openCode();
      },
      hostPrivate: () => {
        privateOpen = false;
        openSettings({ offline: false, type: 'private' });
      },
      bots: () => openSettings({ offline: true }),
      back: () => exitToTitle(),
      filter: (f) => {
        filter = f;
        renderHome();
      },
      refresh: () => refreshList(),
      join: (c) => joinByCode(c, 'home'),
      // B
      change: (patch) => {
        if (settingsView.offline) botSettings = applyHostSettings(botSettings, patch);
        else hostSettings = applyHostSettings(hostSettings, patch);
        settingsView.error = '';
        renderSettings();
      },
      submit: () => submitSettings(),
      settingsBack: () => (settingsView.editing ? openRoom() : openHome()),
      // D
      codeInput: (v) => {
        code.value = v;
        if (code.error) {
          code.error = '';
          ui.showCode(code);
        }
      },
      code: (c) => joinByCode(c, 'code'),
      codeBack: () => openHome(),
      // E
      copy: () => {
        if (lb && navigator.clipboard) navigator.clipboard.writeText(lb.code).catch(() => {});
      },
      roomSettings: () => lb && lb.isHost && openSettings({ offline: false, editing: true }),
      start: () => {
        if (!lb || !startState(lb.lobby, lb.you).enabled) return;
        lb.start();
      },
      leave: () => leave(),
      kick: (id) => lb && lb.kick(id),
      team: (t) => lb && lb.switchTeam(t),
    },
  });

  // ---------------------------------------------------------------- A: home
  /** '' when the name can play, else the reason (shown on Home). */
  function nameProblem() {
    const n = menus.playerName();
    return nameIsClean(n) ? '' : 'Your name is not allowed. Change it on the title screen first.';
  }

  function renderHome() {
    if (phase !== 'home') return;
    ui.showHome({
      notice: homeNotice.text,
      noticeError: homeNotice.error,
      filter,
      ...list,
      rows: filterRows(list.rows, filter),
      privateOpen,
    });
  }

  function focusLater(key) {
    requestAnimationFrame(() => {
      const el = document.querySelector(`.mn-bf-home [data-key="${key}"]`);
      if (el) el.focus({ preventScroll: true });
    });
  }

  /** Box Fights home: the public lobby browser (refreshes every 3 s while it is on screen). */
  function openHome(notice = '', isError = false) {
    stopList();
    phase = 'home';
    privateOpen = false;
    homeNotice = { text: notice || '', error: !!isError };
    list = { loading: true, error: '', rows: list.rows || [], joining: null, joinError: '' };
    renderHome();
    refreshList();
    listTimer = setInterval(() => {
      if (phase !== 'home') return stopList();
      if (!document.hidden && !list.loading && !list.joining) refreshList();
    }, LIST_REFRESH_MS);
  }

  function exitToTitle() {
    stopList();
    phase = null;
    offline = false;
    menus.setResultLobby(null);
    deps.onBack();
  }

  // ---------------------------------------------------------------- B: settings
  function renderSettings() {
    ui.showSettings({ ...settingsView, settings: settingsView.offline ? botSettings : hostSettings });
  }

  function openSettings({ offline: off = false, editing = false, type = null } = {}) {
    if (!off && !editing && nameProblem()) return openHome(nameProblem(), true);
    stopList();
    phase = 'settings';
    if (!off && !editing && type) hostSettings = applyHostSettings(hostSettings, { type }); // PRIVATE LOBBY -> private, HOST -> public
    if (editing && lb && lb.lobby) {
      const l = lb.lobby;
      hostSettings = applyHostSettings(hostSettings, { type: l.type, mode: l.mode, maxPlayers: l.maxPlayers, fillWithBots: l.fillWithBots, botDifficulty: l.botDifficulty, roundsToWin: l.roundsToWin });
    }
    settingsView = { offline: off, editing, busy: false, error: '' };
    renderSettings();
  }

  async function submitSettings() {
    if (settingsView.offline) return startOffline();
    if (settingsView.editing) {
      if (!lb) return openHome();
      const s = hostSettings;
      const l = lb.lobby || {};
      const patch = {};
      for (const k of ['type', 'mode', 'fillWithBots', 'botDifficulty', 'roundsToWin']) if (s[k] !== l[k]) patch[k] = s[k];
      if (s.mode === 'ffa' && (s.maxPlayers !== l.maxPlayers || l.mode !== 'ffa')) patch.maxPlayers = s.maxPlayers;
      if (Object.keys(patch).length) lb.updateSettings(patch);
      return openRoom();
    }
    // create
    const g = ++gen;
    settingsView = { ...settingsView, busy: true, error: '' };
    renderSettings();
    try {
      lobbyMod = lobbyMod || (await import('../net/Lobby.js'));
      const conn = await lobbyMod.createLobby({ name: menus.playerName(), look: lookString(deps.account.profile.equipped), settings: hostSettings });
      if (g !== gen || phase !== 'settings') return conn.leave();
      attach(conn);
      openRoom();
    } catch (err) {
      if (g !== gen) return;
      settingsView = { ...settingsView, busy: false, error: err && err.message ? err.message : 'Could not create the lobby.' };
      if (phase === 'settings') renderSettings();
    }
  }

  async function startOffline() {
    offline = true;
    phase = 'match';
    menus.setResultLobby({ offline: true, host: true, meId: game.player ? game.player.id : 0 });
    await deps.playBoxFight(offlineBoxOpts(botSettings));
  }

  // ---------------------------------------------------------------- public list (on home)
  const renderList = () => renderHome();

  async function refreshList() {
    const g = ++listGen;
    list = { ...list, loading: true };
    renderList();
    try {
      lobbyMod = lobbyMod || (await import('../net/Lobby.js'));
      const rows = listRows(await lobbyMod.listLobbies());
      if (g !== listGen) return;
      list = { ...list, loading: false, error: '', rows };
    } catch (err) {
      if (g !== listGen) return;
      list = { ...list, loading: false, error: (err && err.message) || 'Could not reach the lobby server.' };
    }
    renderList();
  }

  function stopList() {
    clearInterval(listTimer);
    listTimer = 0;
    listGen++;
  }

  // ---------------------------------------------------------------- D: code
  function openCode() {
    if (nameProblem()) return openHome(nameProblem(), true);
    stopList();
    phase = 'code';
    code = { value: code.value || '', error: '', busy: false };
    ui.showCode(code);
  }

  async function joinByCode(raw, from) {
    if (nameProblem()) return openHome(nameProblem(), true);
    const c = sanitizeCodeInput(raw);
    const bad = codeError(c);
    if (from === 'code' && bad) {
      code = { value: c, error: bad, busy: false };
      return ui.showCode(code);
    }
    const g = ++gen;
    if (from === 'code') {
      code = { value: c, error: '', busy: true };
      ui.showCode(code);
    } else {
      list = { ...list, joining: c, joinError: '' };
      renderList();
    }
    try {
      lobbyMod = lobbyMod || (await import('../net/Lobby.js'));
      const conn = await lobbyMod.joinLobby(c, { name: menus.playerName(), look: lookString(deps.account.profile.equipped) });
      if (g !== gen || phase !== from) return conn.leave();
      stopList();
      attach(conn);
      openRoom();
    } catch (err) {
      if (g !== gen) return;
      const msg = err && err.message ? err.message : 'Could not join that lobby.';
      // the server's exact copy ("Lobby not found" / "Lobby is full" / "Match already started")
      const text = SERVER_ERRORS.includes(msg) ? `${msg}.` : msg;
      if (from === 'code' && phase === 'code') {
        code = { value: c, error: text, busy: false };
        ui.showCode(code);
      } else if (phase === 'home') {
        list = { ...list, joining: null, joinError: text };
        refreshList();
      }
    }
  }

  // ---------------------------------------------------------------- E: lobby room
  function attach(conn) {
    lb = conn;
    offline = false;
    room = { countdown: 0, notice: '', noticeError: false, loading: '', in3D: false };
    conn.onUpdate = (l) => lb === conn && onLobbyUpdate(l);
    conn.onError = (m) => {
      if (lb !== conn) return;
      room.notice = m;
      room.noticeError = true;
      if (phase === 'room') renderRoom();
    };
    conn.onCountdown = (n) => {
      if (lb !== conn) return;
      room.countdown = n;
      if (phase === 'room') ui.setCountdown(n);
      if (sfx) sfx.play(n > 1 ? 'ui_click' : 'ui_hover');
    };
    conn.onMatchStart = (msg) => lb === conn && startRelay(msg);
    conn.onHostMigrate = (msg) => {
      if (lb !== conn) return;
      // the in-match takeover runs over the relay (ClientSession / Game.takeOverAsHost); here only
      // the lobby's idea of the host changes (Start, Settings, kick, result report)
      if (msg && msg.hostToken && matchMsg) matchMsg = { ...matchMsg, hostId: msg.newHostId, hostToken: msg.hostToken, tokens: msg.tokens || matchMsg.tokens, slots: msg.slots || matchMsg.slots };
      if (phase === 'results') menus.setResultLobby({ host: conn.isHost, meId: resultMeId() });
      if (phase === 'room') renderRoom();
    };
    conn.onMatchEnd = () => {};
    conn.onClose = (reason) => {
      if (lb !== conn) return;
      lb = null;
      dropMatch({ connectionLost: true });
      openHome(CLOSE_TEXT[reason] || CLOSE_TEXT.lost, true);
    };
  }

  function onLobbyUpdate(l) {
    if (l.state !== 'countdown') room.countdown = 0;
    if (l.state === 'waiting' && (phase === 'match' || phase === 'results')) return returnToRoom();
    if (phase === 'results' || menus.current === 'result') menus.setResultLobby({ host: lb.isHost, meId: resultMeId() });
    if (phase === 'room') renderRoom();
  }

  function roomView() {
    const l = lb && lb.lobby;
    const st = startState(l, lb && lb.you);
    return {
      code: lb ? lb.code : '',
      type: l ? l.type : 'public',
      mode: l ? l.mode : '1v1',
      count: playerCount(l),
      hostName: l ? l.name : '',
      waiting: !!l && l.state === 'waiting',
      list: slotListView(l, lb && lb.you),
      start: st,
      countdown: room.countdown,
      loading: room.loading,
      notice: room.notice,
      noticeError: room.noticeError,
      in3D: room.in3D && game.inWaitingRoom,
    };
  }

  function renderRoom() {
    if (phase === 'room' && lb) ui.showRoom(roomView());
  }

  function openRoom() {
    if (!lb) return openHome();
    phase = 'room';
    renderRoom();
    enterRoom3D();
  }

  /** Walkable room: load the map in the background, then the empty arena (see Game waiting room). */
  function enterRoom3D() {
    if (!game || game.inWaitingRoom) {
      room.in3D = !!(game && game.inWaitingRoom);
      return renderRoom();
    }
    const g = gen;
    const done = () => {
      if (g !== gen || phase !== 'room' || !lb) return;
      if (game.state === 'menu' && !game.net) room.in3D = game.enterWaitingRoom();
      room.loading = '';
      renderRoom();
    };
    if (game.loaded) return done();
    deps
      .loadGame((p) => {
        if (g !== gen || phase !== 'room') return;
        const t = `Warming up the arena… ${Math.round((p || 0) * 100)}%`;
        if (t !== room.loading) {
          room.loading = t;
          renderRoom();
        }
      })
      .then(done)
      .catch((err) => {
        console.error(err);
        room.loading = 'The 3D room could not load. The lobby still works.';
        renderRoom();
      });
  }

  function leaveRoom3D() {
    if (game && game.inWaitingRoom) game.exitWaitingRoom();
    room.in3D = false;
  }

  // ---------------------------------------------------------------- match hand-off
  function setRoomStatus(text, isError = false) {
    room.notice = text;
    room.noticeError = isError;
    renderRoom();
  }

  async function startRelay(msg) {
    const conn = lb;
    const g = gen;
    matchMsg = msg;
    room.countdown = 0;
    ui.setCountdown(0);
    deps.unreadyForSolo();
    deps.closeMultiplayer();
    const isHost = typeof msg.hostToken === 'string' && msg.hostToken !== '';
    setRoomStatus(isHost ? 'Opening the match…' : 'Joining the match…');
    try {
      const net = await import('../net/Net.js');
      if (g !== gen || lb !== conn) return;
      if (isHost) await hostRelay(net, msg, conn, g);
      else await joinRelay(net, msg, conn, g);
    } catch (err) {
      console.error(err);
      if (g !== gen || lb !== conn) return;
      dropMatch({ connectionLost: true });
      phase = 'room';
      openRoom();
      setRoomStatus('Could not start the match: ' + (err && err.message ? err.message : err), true);
    }
  }

  async function hostRelay(net, msg, conn, g) {
    const name = menus.playerName();
    const r = await net.hostRoom({ name, code: msg.relayCode });
    if (g !== gen || lb !== conn) return r.close();
    relay = { role: 'host', room: r };
    r.game = 'boxfights';
    const opts = hostSessionOpts(msg);
    r.mode = opts.mode;
    r.onError = (text) => console.warn('[net]', text);
    // wait for every guest (or HOST_WAIT_MS); strangers are sent away
    const expected = expectedGuestTokens(msg);
    const deadline = Date.now() + HOST_WAIT_MS;
    await new Promise((resolve) => {
      const tick = () => {
        if (g !== gen || lb !== conn) return finish();
        const have = [...r.clients.values()].filter((c) => expected.has(c.token)).length;
        if (have >= expected.size || Date.now() >= deadline) return finish();
        setRoomStatus(`Waiting for players ${have + 1}/${expected.size + 1} · ${Math.max(0, Math.ceil((deadline - Date.now()) / 1000))}s`);
      };
      const timer = setInterval(tick, 500);
      function finish() {
        clearInterval(timer);
        resolve();
      }
      r.onLobby(tick);
      tick();
    });
    if (g !== gen || lb !== conn) return;
    const seen = new Set();
    for (const c of [...r.clients.values()]) {
      if (!expected.has(c.token) || seen.has(c.token)) r.kick(c.id, 'started');
      else seen.add(c.token);
    }
    r.started = true; // closed to joins from here (as main.js runHostedMatch)
    leaveRoom3D();
    await deps.ensureLoaded();
    if (g !== gen || lb !== conn) return;
    const { HostSession } = await import('../net/HostSession.js');
    phase = 'match';
    menus.setResultLobby({ host: true, meId: 0 });
    game.net = new HostSession(r, game, opts);
    game.startMatch(Number.isInteger(msg.seed) ? msg.seed : (Math.random() * 1e9) | 0);
  }

  async function joinRelay(net, msg, conn, g) {
    const { ClientSession } = await import('../net/ClientSession.js');
    const c = await net.joinRoom(msg.relayCode, { name: menus.playerName(), token: conn.token, retryMs: HOST_WAIT_MS });
    if (g !== gen || lb !== conn) return c.close();
    relay = { role: 'client', conn: c };
    setRoomStatus('Waiting for the host to start…');
    c.onClose = (reason) => {
      if (!relay || relay.conn !== c) return;
      relay = null;
      if (game.state !== 'menu' && !game.inWaitingRoom) game.leave({ connectionLost: true });
      if (lb === conn) {
        phase = 'room';
        openRoom();
        setRoomStatus(reason || 'Lost the match connection.', true);
      }
    };
    c.onStart = async (start) => {
      if (!relay || relay.conn !== c || lb !== conn) return;
      let session = null;
      try {
        session = new ClientSession(c, game); // queues match messages until begin()
        leaveRoom3D();
        await deps.ensureLoaded();
        if (!relay || relay.conn !== c) return session.dispose(game);
        if (!sameWorld(game.mapId, start.map)) {
          session.dispose(game);
          game.combat.authoritative = true;
          throw new Error('Your map differs from the host. Both players should refresh and try again.');
        }
        phase = 'match';
        menus.setResultLobby({ host: false, meId: c.id });
        game.net = session;
        game.startClientMatch(start);
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
        if (game.state !== 'menu') game.leave({ connectionLost: true });
        dropRelay();
        phase = 'room';
        openRoom();
        setRoomStatus('Could not join the match: ' + (err && err.message ? err.message : err), true);
      }
    };
  }

  function dropRelay() {
    const r = relay;
    relay = null;
    if (!r) return;
    try {
      if (r.room && !r.room.closed) r.room.close();
      if (r.conn) r.conn.close();
    } catch (err) {
      console.error(err);
    }
  }

  /** Out of the match / relay / waiting room (the lobby connection stays). */
  function dropMatch({ connectionLost = false } = {}) {
    leaveRoom3D();
    if (game && game.state !== 'menu') game.leave({ connectionLost }); // disposes game.net (closes its room)
    dropRelay();
    menus.setResultLobby(null);
  }

  function returnToRoom() {
    dropMatch({ connectionLost: true });
    if (sfx) sfx.playMusic('menu');
    phase = 'room';
    room.notice = '';
    openRoom();
  }

  function resultMeId() {
    if (relay && relay.role === 'client' && relay.conn) return relay.conn.id;
    return 0;
  }

  // ---------------------------------------------------------------- public API
  /** Leave everything: the match, the relay and the lobby -> Box Fights home. */
  function leave() {
    gen++;
    const conn = lb;
    lb = null;
    matchMsg = null;
    offline = false;
    dropMatch();
    if (conn) conn.leave();
    if (sfx) sfx.playMusic('menu');
    openHome();
  }

  /** Results: BACK TO LOBBY. Host -> server; offline -> the same Play with Bots settings. */
  function backToLobby() {
    if (offline) {
      offline = false;
      if (game.state !== 'menu') game.leave();
      menus.setResultLobby(null);
      if (sfx) sfx.playMusic('menu');
      openSettings({ offline: true });
      return;
    }
    if (lb && lb.isHost) lb.backToLobby();
  }

  /** Game.onMatchEnd: the current host's browser reports the final score to the lobby. */
  function onGameMatchEnd(r) {
    if (!r || !r.boxFight) return;
    if (offline && !game.net) {
      phase = 'results';
      menus.setResultLobby({ offline: true, host: true, meId: game.player ? game.player.id : 0 });
      return;
    }
    if (!lb || phase !== 'match') return;
    phase = 'results';
    menus.setResultLobby({ host: lb.isHost, meId: resultMeId() });
    const net = game.net;
    if (!lb.isHost || !net || !net.isHost) return;
    const l = lb.lobby || {};
    const msg = matchMsg || {};
    const clientTokens = new Map();
    const hostRoom = net.room || (relay && relay.room);
    if (hostRoom && hostRoom.clients) for (const c of hostRoom.clients.values()) clientTokens.set(c.id, c.token);
    const slots = Array.isArray(l.slots) ? l.slots : msg.slots || [];
    const slotOfActor = actorSlotMap({ players: r.boxFight.players || [], slots, tokens: msg.tokens || {}, clientTokens, hostSlotId: lb.you });
    const mySlot = slots.find((s) => s.id === lb.you);
    const report = lobbyReport(r.boxFight, { mode: l.mode, roundsToWin: l.roundsToWin, myTeam: mySlot ? mySlot.team : game.player.team, slots, slotOfActor });
    if (report) lb.reportResult(report);
  }

  // A guest promoted to host mid-match (relay migration, the other agent's ClientSession /
  // Game.takeOverAsHost) reports the result at match end: nothing else to do here, onGameMatchEnd
  // checks game.net.isHost. Kept as a hook for the room the new host owns.
  if (game) {
    const prev = game.onHostTakeover;
    game.onHostTakeover = (info) => {
      if (typeof prev === 'function') prev(info);
      if (lb && info && info.room) relay = { role: 'host', room: info.room };
    };
  }

  return {
    openHome: () => {
      offline = false;
      if (lb) return openRoom(); // still in a lobby: back to its room
      openHome();
    },
    owns: () => (!!lb && (phase === 'match' || phase === 'results')) || (offline && !!game && !!game.boxFight && !game.net),
    busy: () => !!lb,
    leave,
    backToLobby,
    onGameMatchEnd,
    /** Account / name changed while a Box Fights screen is up. */
    refresh: () => {
      if (phase === 'home' && menus.current === 'bf-home') renderHome();
    },
  };
}
