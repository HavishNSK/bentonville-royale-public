// Box Fights custom lobbies: pure rules (party/lobbyRules.js). The Durable Object shells
// (party/lobbyRoom.js, party/lobbyIndex.js) only call these.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LOBBY_CODE_ALPHABET, LOBBY_CODE_LEN, MAX_LOBBY, ERR,
  randomLobbyCode, normalizeLobbyCode, validLobbyCode, lobbyCapacity, cleanSettings,
  createLobby, joinLobby, leaveLobby, switchTeam, updateSettings, kickPlayer, canStart,
  startMatch, beginPlaying, matchStartPayload, reportResult, backToLobby, publicLobby,
  indexEntry, indexClaim, indexUpsert, indexRemove, indexList, cleanLookString, cleanLobbyName, hostMigratePayload,
} from '../party/lobbyRules.js';

const P = (n, extra = {}) => ({ id: 'p' + n, name: 'Player' + n, token: 'tok' + n, look: '', ...extra });

function lobbyWith(settings, n) {
  let { lobby } = createLobby({ code: 'BNTV42', settings, player: P(1) });
  for (let i = 2; i <= n; i++) {
    const r = joinLobby(lobby, P(i));
    assert.equal(r.error, undefined, `join ${i}: ${r.error}`);
    lobby = r.lobby;
  }
  return lobby;
}
const humans = (l) => l.slots.filter((s) => s.kind === 'human');
const team = (l, t) => l.slots.filter((s) => s.team === t);

// ------------------------------------------------------------------ codes

test('codes: 6 characters from an alphabet without 0 O 1 I L', () => {
  assert.equal(LOBBY_CODE_LEN, 6);
  for (const bad of '0O1IL') assert.ok(!LOBBY_CODE_ALPHABET.includes(bad), bad);
  for (let i = 0; i < 200; i++) {
    const c = randomLobbyCode();
    assert.equal(c.length, 6);
    assert.ok(validLobbyCode(c), c);
  }
  // deterministic source: byte -> alphabet index
  assert.equal(randomLobbyCode(() => new Uint8Array([0, 1, 2, 3, 4, 5])), LOBBY_CODE_ALPHABET.slice(0, 6));
});

test('codes: normalize upper-cases and strips junk; validation is exact', () => {
  assert.equal(normalizeLobbyCode(' bntv42 '), 'BNTV42');
  assert.equal(normalizeLobbyCode('bn-tv 42'), 'BNTV42');
  assert.equal(normalizeLobbyCode('bntv42xyz'), 'BNTV42');
  assert.ok(validLobbyCode('BNTV42'));
  assert.ok(!validLobbyCode('BNTV4'));
  assert.ok(!validLobbyCode('BNTV40')); // 0 is not in the alphabet
  assert.ok(!validLobbyCode('BNTVL2'));
  assert.ok(!validLobbyCode('ABCD')); // party / relay codes are 4 letters
  assert.ok(!validLobbyCode(null));
});

// ------------------------------------------------------------------ settings

test('capacity: 1v1/2v2/3v3 and ffa 2..6, never above 6', () => {
  assert.equal(MAX_LOBBY, 6);
  assert.equal(lobbyCapacity('1v1'), 2);
  assert.equal(lobbyCapacity('2v2'), 4);
  assert.equal(lobbyCapacity('3v3'), 6);
  assert.equal(lobbyCapacity('ffa', 4), 4);
  assert.equal(lobbyCapacity('ffa'), 6);
});

test('settings: defaults, bad enums and ranges refused, unknown fields ignored', () => {
  const d = cleanSettings({});
  assert.deepEqual(d.settings, { type: 'public', mode: '1v1', maxPlayers: 2, fillWithBots: true, botDifficulty: 'normal', roundsToWin: 5 });
  assert.equal(cleanSettings({ mode: 'ffa' }).settings.maxPlayers, 6);
  assert.equal(cleanSettings({ mode: 'ffa', maxPlayers: 3 }).settings.maxPlayers, 3);
  assert.equal(cleanSettings({ mode: '2v2', maxPlayers: 3 }).settings.maxPlayers, 4); // fixed by the mode
  for (const bad of [{ mode: '4v4' }, { type: 'secret' }, { botDifficulty: 'insane' }, { roundsToWin: 0 }, { roundsToWin: 10 }, { roundsToWin: 2.5 }, { roundsToWin: '5' }, { mode: 'ffa', maxPlayers: 7 }, { mode: 'ffa', maxPlayers: 1 }, { fillWithBots: 'yes' }, { mode: '__proto__' }]) {
    assert.ok(cleanSettings(bad).error, JSON.stringify(bad));
  }
  const r = cleanSettings({ type: 'private', roundsToWin: 9, hostId: 'evil', __proto__: { x: 1 }, extra: 1 });
  assert.equal(r.error, undefined);
  assert.deepEqual(Object.keys(r.settings).sort(), ['botDifficulty', 'fillWithBots', 'maxPlayers', 'mode', 'roundsToWin', 'type']);
  assert.equal(r.settings.type, 'private');
  assert.ok(cleanSettings(null).settings); // non-object = defaults
  assert.ok(cleanSettings('x').error);
});

test('names and looks are cleaned like the party room', () => {
  assert.equal(cleanLobbyName('  Sam<script>  '), 'Samscript');
  assert.equal(cleanLobbyName(''), 'Player');
  assert.equal(cleanLobbyName('x'.repeat(40)).length, 16);
  assert.equal(cleanLookString('skin_a|pick_b|bb|gl'), 'skin_a|pick_b|bb|gl');
  assert.equal(cleanLookString('<img>'), null);
  assert.equal(cleanLookString('skin_' + 'a'.repeat(200)).length, 96);
});

// ------------------------------------------------------------------ create / join / leave

test('create: creator is host in the first slot; lobby shape', () => {
  const { lobby } = createLobby({ code: 'BNTV42', settings: { mode: '2v2', type: 'private' }, player: P(1) });
  assert.equal(lobby.hostId, 'p1');
  assert.equal(lobby.state, 'waiting');
  assert.equal(lobby.slots.length, 4);
  assert.deepEqual(lobby.slots.map((s) => s.team), [0, 0, 1, 1]);
  assert.equal(lobby.slots[0].kind, 'human');
  const pub = publicLobby(lobby);
  assert.deepEqual(Object.keys(pub).sort(), ['botDifficulty', 'code', 'fillWithBots', 'hostId', 'maxPlayers', 'mode', 'name', 'roundsToWin', 'score', 'slots', 'state', 'type'].sort());
  assert.equal(pub.name, 'Player1');
  assert.deepEqual(pub.score, { team0: 0, team1: 0 });
  for (const s of pub.slots) assert.deepEqual(Object.keys(s).sort(), ['id', 'kind', 'look', 'name', 'team']);
  assert.ok(!JSON.stringify(pub).includes('tok1')); // tokens never go to clients
  assert.ok(createLobby({ code: 'BNTV42', settings: { mode: 'nope' }, player: P(1) }).error);
});

test('join: "Lobby not found" with no lobby; 7th person is refused; "Match already started"', () => {
  assert.equal(joinLobby(null, P(1)).error, ERR.notFound);
  assert.equal(ERR.notFound, 'Lobby not found');
  assert.equal(ERR.full, 'Lobby is full');
  assert.equal(ERR.started, 'Match already started');
  const full = lobbyWith({ mode: 'ffa' }, 6);
  assert.equal(humans(full).length, 6);
  assert.equal(joinLobby(full, P(7)).error, ERR.full);
  const duel = lobbyWith({ mode: '1v1' }, 2);
  assert.equal(joinLobby(duel, P(3)).error, ERR.full);
  const l = lobbyWith({ mode: '2v2' }, 2);
  const started = startMatch(l, 'p1').lobby;
  assert.equal(joinLobby(started, P(3)).error, ERR.started);
  assert.equal(joinLobby(beginPlaying(started).lobby, P(3)).error, ERR.started);
});

test('join with a token already in the lobby reclaims that slot (refresh)', () => {
  const l = lobbyWith({ mode: '2v2' }, 2);
  const r = joinLobby(l, { id: 'pNEW', name: 'Again', token: 'tok2', look: '' });
  assert.equal(r.reclaimed, true);
  assert.equal(r.id, 'p2'); // stable player id
  assert.equal(humans(r.lobby).length, 2);
});

test('leave: host passes to the next human in join order; last leave closes', () => {
  let l = lobbyWith({ mode: 'ffa' }, 4);
  l = leaveLobby(l, 'p3').lobby;
  let r = leaveLobby(l, 'p1');
  assert.equal(r.hostChanged, true);
  assert.equal(r.lobby.hostId, 'p2');
  assert.equal(r.lobby.slots.find((s) => s.id === 'p1'), undefined);
  r = leaveLobby(r.lobby, 'p2');
  assert.equal(r.lobby.hostId, 'p4');
  r = leaveLobby(r.lobby, 'p4');
  assert.equal(r.closed, true);
  assert.equal(r.lobby, null);
  // unknown id: nothing changes
  const same = leaveLobby(lobbyWith({}, 1), 'nobody');
  assert.equal(same.changed, false);
});

// ------------------------------------------------------------------ teams

test('team balance: joiners go to the team with fewest humans', () => {
  const l = lobbyWith({ mode: '3v3' }, 4);
  assert.equal(team(l, 0).filter((s) => s.kind === 'human').length, 2);
  assert.equal(team(l, 1).filter((s) => s.kind === 'human').length, 2);
  const ffa = lobbyWith({ mode: 'ffa' }, 3);
  assert.ok(ffa.slots.every((s) => s.team === null));
});

test('switchTeam: allowed when the other team has room, refused when full or in ffa', () => {
  let l = lobbyWith({ mode: '2v2' }, 2); // p1 team0, p2 team1
  let r = switchTeam(l, 'p2', 0);
  assert.equal(r.error, undefined);
  l = r.lobby;
  assert.equal(l.slots.find((s) => s.id === 'p2').team, 0);
  l = joinLobby(l, P(3)).lobby; // team1 (fewest humans)
  assert.equal(l.slots.find((s) => s.id === 'p3').team, 1);
  r = switchTeam(l, 'p3', 0);
  assert.equal(r.error, ERR.teamFull);
  assert.equal(switchTeam(l, 'p3', 1).changed, false); // already there
  assert.ok(switchTeam(l, 'p3', 2).error);
  assert.ok(switchTeam(lobbyWith({ mode: 'ffa' }, 2), 'p2', 0).error);
});

// ------------------------------------------------------------------ start / bots

for (const [mode, max, n] of [['1v1', undefined, 1], ['2v2', undefined, 1], ['2v2', undefined, 3], ['3v3', undefined, 2], ['ffa', 2, 1], ['ffa', 3, 2], ['ffa', 4, 1], ['ffa', 5, 3], ['ffa', 6, 1]]) {
  test(`fill on: start fills open slots with bots (${mode} max ${max ?? '-'}, ${n} humans)`, () => {
    const l = lobbyWith({ mode, maxPlayers: max }, n);
    assert.equal(canStart(l).ok, true);
    assert.equal(startMatch(l, 'p2').error, n >= 2 ? ERR.notHost : ERR.notHost);
    const r = startMatch(l, 'p1');
    assert.equal(r.error, undefined);
    const s = r.lobby;
    assert.equal(s.state, 'countdown');
    assert.equal(s.slots.length, lobbyCapacity(mode, max));
    assert.ok(s.slots.every((x) => x.kind !== 'open'));
    assert.equal(humans(s).length, n);
    const bots = s.slots.filter((x) => x.kind === 'bot');
    assert.deepEqual(bots.map((b) => b.name), ['Bot Alpha', 'Bot Bravo', 'Bot Charlie', 'Bot Delta', 'Bot Echo', 'Bot Foxtrot'].slice(0, bots.length));
    if (mode !== 'ffa') assert.equal(team(s, 0).length, team(s, 1).length);
  });
}

test('fill off: start requires every slot to be human', () => {
  let l = lobbyWith({ mode: '2v2', fillWithBots: false }, 3);
  assert.equal(canStart(l).ok, false);
  assert.ok(startMatch(l, 'p1').error);
  l = joinLobby(l, P(4)).lobby;
  assert.equal(canStart(l).ok, true);
  const s = startMatch(l, 'p1').lobby;
  assert.ok(s.slots.every((x) => x.kind === 'human'));
});

test('a human joining before the match takes a bot placeholder slot', () => {
  let l = lobbyWith({ mode: '1v1' }, 1);
  l = beginPlaying(startMatch(l, 'p1').lobby).lobby;
  l = reportResult(l, 'p1', { final: true, winner: 0, score: { team0: 5, team1: 2 } }).lobby;
  l = backToLobby(l, 'p1').lobby;
  assert.equal(l.state, 'waiting');
  // the bot is still shown as a placeholder or open; either way a joiner gets that slot
  const r = joinLobby(l, P(2));
  assert.equal(r.error, undefined);
  assert.equal(humans(r.lobby).length, 2);
  assert.equal(r.lobby.slots.length, 2);
});

test('human joining a lobby whose slots are all bot placeholders replaces one', () => {
  let l = lobbyWith({ mode: '2v2' }, 1);
  l = { ...l, slots: l.slots.map((s, i) => (i === 0 ? s : { ...s, id: 'b' + i, kind: 'bot', name: 'Bot X' })) };
  const r = joinLobby(l, P(2));
  assert.equal(r.error, undefined);
  assert.equal(r.lobby.slots.find((s) => s.id === 'p2').team, 1);
  assert.equal(r.lobby.slots.filter((s) => s.kind === 'bot').length, 2); // 3 placeholders, one taken
});

test('countdown -> playing; matchStart payload: host token only to the host', () => {
  const l = beginPlaying(startMatch(lobbyWith({ mode: '2v2', botDifficulty: 'hard', roundsToWin: 3 }, 2), 'p1').lobby).lobby;
  assert.equal(l.state, 'playing');
  const ctx = { relayCode: 'WXYZ', seed: 1234 };
  const forHost = matchStartPayload(l, ctx, 'p1');
  const forGuest = matchStartPayload(l, ctx, 'p2');
  assert.equal(forHost.t, 'matchStart');
  assert.equal(forHost.relayCode, 'WXYZ');
  assert.equal(forHost.hostId, 'p1');
  assert.equal(forHost.hostToken, 'tok1');
  assert.equal(forGuest.hostToken, undefined);
  assert.deepEqual(forHost.tokens, { p1: 'tok1', p2: 'tok2' });
  assert.equal(forGuest.tokens, undefined);
  assert.equal(forGuest.you, 'p2');
  assert.equal(forHost.mode, '2v2');
  assert.equal(forHost.roundsToWin, 3);
  assert.equal(forHost.botDifficulty, 'hard');
  assert.equal(forHost.maxPlayers, 4);
  assert.equal(forHost.seed, 1234);
  assert.equal(forHost.slots.length, 4);
  assert.ok(!JSON.stringify(forGuest).includes('tok'));
  assert.ok(beginPlaying(lobbyWith({}, 1)).error); // only from countdown
});

test('mid-match: a human who drops becomes a bot on the same team', () => {
  let l = beginPlaying(startMatch(lobbyWith({ mode: '3v3' }, 3), 'p1').lobby).lobby;
  const before = l.slots.find((s) => s.id === 'p2');
  const r = leaveLobby(l, 'p2');
  const after = r.lobby.slots.find((s) => s.id === 'p2');
  assert.equal(after.kind, 'bot');
  assert.equal(after.team, before.team);
  assert.match(after.name, /^Bot /);
  assert.equal(new Set(r.lobby.slots.map((s) => s.name)).size, 6); // bot names stay unique
  assert.equal(r.lobby.state, 'playing');
});

test('mid-match: the host leaving migrates host (join order), old host slot -> bot, still playing', () => {
  const l = beginPlaying(startMatch(lobbyWith({ mode: '2v2' }, 3), 'p1').lobby, { relayCode: 'WXYZ', seed: 7 }).lobby;
  const r = leaveLobby(l, 'p1');
  assert.equal(r.hostMigrated, true);
  assert.equal(r.hostChanged, true);
  assert.equal(r.lobby.state, 'playing');
  assert.equal(r.lobby.hostId, 'p2');
  const old = r.lobby.slots.find((s) => s.id === 'p1');
  assert.equal(old.kind, 'bot');
  assert.equal(old.team, 0);
  assert.equal(humans(r.lobby).length, 2);
  const forNew = hostMigratePayload(r.lobby, 'p2');
  const forOther = hostMigratePayload(r.lobby, 'p3');
  assert.equal(forNew.t, 'hostMigrate');
  assert.equal(forNew.newHostId, 'p2');
  assert.equal(forNew.relayCode, 'WXYZ');
  assert.equal(forNew.hostToken, 'tok2');
  assert.deepEqual(forNew.tokens, { p2: 'tok2', p3: 'tok3' });
  assert.equal(forOther.hostToken, undefined);
  assert.ok(!JSON.stringify(forOther).includes('tok'));
  assert.equal(forOther.slots.length, 4);
  // last humans leave -> closes
  const r2 = leaveLobby(leaveLobby(r.lobby, 'p2').lobby, 'p3');
  assert.equal(r2.closed, true);
});

test('countdown: the host leaving passes host on and keeps the countdown (fill on)', () => {
  const l = startMatch(lobbyWith({ mode: '2v2' }, 2), 'p1').lobby;
  const r = leaveLobby(l, 'p1');
  assert.equal(r.lobby.hostId, 'p2');
  assert.equal(r.lobby.state, 'countdown');
  assert.equal(r.lobby.slots.find((s) => s.id === 'p1').kind, 'bot');
});

test('countdown: a leave with fill off cancels the countdown', () => {
  const l = startMatch(lobbyWith({ mode: '1v1', fillWithBots: false }, 2), 'p1').lobby;
  const r = leaveLobby(l, 'p2');
  assert.equal(r.countdownCancelled, true);
  assert.equal(r.lobby.state, 'waiting');
});

// ------------------------------------------------------------------ host actions

test('kick: host only, not yourself, frees the slot', () => {
  const l = lobbyWith({ mode: 'ffa' }, 3);
  assert.equal(kickPlayer(l, 'p2', 'p3').error, ERR.notHost);
  assert.ok(kickPlayer(l, 'p1', 'p1').error);
  assert.ok(kickPlayer(l, 'p1', 'nobody').error);
  const r = kickPlayer(l, 'p1', 'p3');
  assert.equal(r.kicked, 'p3');
  assert.equal(humans(r.lobby).length, 2);
});

test('updateSettings: host only, waiting only, rebuilds slots and keeps people', () => {
  let l = lobbyWith({ mode: '2v2' }, 3);
  assert.equal(updateSettings(l, 'p2', { mode: '3v3' }).error, ERR.notHost);
  let r = updateSettings(l, 'p1', { mode: '3v3', roundsToWin: 7, botDifficulty: 'easy', bogus: true });
  assert.equal(r.error, undefined);
  l = r.lobby;
  assert.equal(l.slots.length, 6);
  assert.equal(l.roundsToWin, 7);
  assert.equal(humans(l).length, 3);
  assert.ok(Math.abs(team(l, 0).filter((s) => s.kind === 'human').length - team(l, 1).filter((s) => s.kind === 'human').length) <= 1);
  assert.equal(updateSettings(l, 'p1', { mode: '1v1' }).error, ERR.tooMany);
  assert.ok(updateSettings(l, 'p1', { roundsToWin: 99 }).error);
  r = updateSettings(l, 'p1', { mode: 'ffa', maxPlayers: 3 });
  assert.equal(r.lobby.slots.length, 3);
  assert.ok(r.lobby.slots.every((s) => s.team === null));
  assert.equal(r.lobby.hostId, 'p1');
  // partial update keeps the other settings
  assert.equal(updateSettings(l, 'p1', { type: 'private' }).lobby.mode, '3v3');
  const started = startMatch(l, 'p1').lobby;
  assert.equal(updateSettings(started, 'p1', { roundsToWin: 3 }).error, ERR.notWaiting);
});

test('reportResult: host only while playing; round updates then match end', () => {
  let l = beginPlaying(startMatch(lobbyWith({ mode: '1v1', roundsToWin: 3 }, 2), 'p1').lobby).lobby;
  assert.equal(reportResult(l, 'p2', { final: true, winner: 1, score: { team0: 0, team1: 3 } }).error, ERR.notHost);
  let r = reportResult(l, 'p1', { final: false, score: { team0: 1, team1: 0 } });
  assert.equal(r.event, 'roundEnd');
  assert.deepEqual(r.lobby.score, { team0: 1, team1: 0 });
  assert.equal(r.lobby.state, 'playing');
  assert.ok(reportResult(r.lobby, 'p1', { score: { team0: 9, team1: 0 } }).error); // above roundsToWin
  assert.ok(reportResult(r.lobby, 'p1', { score: { team0: -1, team1: 0 } }).error);
  assert.ok(reportResult(r.lobby, 'p1', { winner: 5, score: { team0: 3, team1: 0 } }).error);
  r = reportResult(r.lobby, 'p1', { winner: 0, score: { team0: 3, team1: 1 } });
  assert.equal(r.event, 'matchEnd');
  assert.equal(r.lobby.state, 'results');
  assert.deepEqual(r.payload, { winner: 0, score: { team0: 3, team1: 1 } });
  assert.ok(reportResult(r.lobby, 'p1', { winner: 0, score: { team0: 3, team1: 1 } }).error); // not playing
  // ffa: per-player score keyed by slot id; unknown ids dropped
  const f = beginPlaying(startMatch(lobbyWith({ mode: 'ffa', maxPlayers: 3, roundsToWin: 2 }, 2), 'p1').lobby).lobby;
  const fr = reportResult(f, 'p1', { winner: 'p2', score: { p1: 1, p2: 2, ghost: 2 } });
  assert.equal(fr.error, undefined);
  assert.equal(fr.lobby.score.ghost, undefined);
  assert.equal(fr.lobby.score.p2, 2);
  assert.ok(reportResult(f, 'p1', { winner: 'ghost', score: {} }).error);
});

test('backToLobby: host only from results; same people, bots back to placeholders', () => {
  let l = beginPlaying(startMatch(lobbyWith({ mode: '3v3' }, 3), 'p1').lobby).lobby;
  l = reportResult(l, 'p1', { winner: 1, score: { team0: 2, team1: 5 } }).lobby;
  assert.equal(backToLobby(l, 'p2').error, ERR.notHost);
  const r = backToLobby(l, 'p1');
  assert.equal(r.lobby.state, 'waiting');
  assert.deepEqual(humans(r.lobby).map((s) => s.id).sort(), ['p1', 'p2', 'p3']);
  assert.equal(humans(r.lobby).length, 3);
  assert.ok(r.lobby.slots.every((s) => s.kind !== 'bot'));
  assert.deepEqual(r.lobby.score, { team0: 0, team1: 0 });
  assert.ok(backToLobby(lobbyWith({}, 1), 'p1').error);
});

// ------------------------------------------------------------------ index

test('index: claim is collision-checked and capped per owner; entries expire', () => {
  const idx = new Map();
  assert.equal(indexClaim(idx, 'BNTV42', 'ipA', 1000).ok, true);
  assert.equal(indexClaim(idx, 'BNTV42', 'ipB', 1000).ok, false); // taken
  assert.equal(indexClaim(idx, 'bad', 'ipB', 1000).ok, false);
  for (const c of ['AAAAA2', 'AAAAA3', 'AAAAA4']) assert.equal(indexClaim(idx, c, 'ipA', 1000).ok, true);
  assert.equal(indexClaim(idx, 'AAAAA5', 'ipA', 1000).ok, false); // 4 live lobbies per owner
  assert.equal(indexClaim(idx, 'BNTV42', 'ipB', 1000 + 61000).ok, true); // expired claim frees the code
});

test('index: list shows public waiting lobbies first, full flagged, private hidden', () => {
  const idx = new Map();
  const mk = (code, settings, n) => {
    const l = lobbyWith(settings, n);
    return indexEntry({ ...l, code });
  };
  indexUpsert(idx, mk('AAAAA2', { mode: '1v1' }, 2), 0); // full
  indexUpsert(idx, mk('AAAAA3', { mode: '3v3' }, 1), 0);
  indexUpsert(idx, mk('AAAAA4', { mode: '2v2', type: 'private' }, 1), 0);
  indexUpsert(idx, { ...mk('AAAAA5', { mode: 'ffa' }, 2), state: 'playing' }, 0);
  const list = indexList(idx, 1000);
  assert.deepEqual(list.map((e) => e.code), ['AAAAA3', 'AAAAA2', 'AAAAA5']);
  assert.equal(list[1].full, true);
  assert.equal(list[0].full, false);
  assert.deepEqual(Object.keys(list[0]).sort(), ['code', 'full', 'max', 'mode', 'name', 'players', 'state']);
  assert.deepEqual(indexList(idx, 61001), []); // not refreshed -> gone
  indexRemove(idx, 'AAAAA3');
  assert.equal(idx.has('AAAAA3'), false);
  assert.equal(indexUpsert(idx, { code: 'nope' }, 0).ok, false);
});

test('client module src/net/Lobby.js loads in Node and refuses bad codes before connecting', async () => {
  const m = await import('../src/net/Lobby.js');
  for (const fn of ['listLobbies', 'createLobby', 'joinLobby']) assert.equal(typeof m[fn], 'function');
  await assert.rejects(m.joinLobby('ABC', { name: 'x' }), /6 characters/);
  await assert.rejects(m.joinLobby('BNTV40', { name: 'x' }), /6 characters/);
});
