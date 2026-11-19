// Box Fights lobby screens: pure view models (src/ui/boxLobbyModel.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  sanitizeCodeInput, codeError, CODE_HINT, applyHostSettings, offlineBoxOpts, ruleLine, FFA_RULE, listRows, slotListView,
  startState, playerCount, filterRows, mergeMatchSlots, expectedGuestTokens, hostSessionOpts, lobbyReport, actorSlotMap, resultRows, countdownLabel,
  DEFAULT_HOST_SETTINGS,
} from '../src/ui/boxLobbyModel.js';
import { createLobby, joinLobby, startMatch, beginPlaying, matchStartPayload, publicLobby, reportResult, updateSettings } from '../party/lobbyRules.js';
import { boxMatchConfig, boxSlotPlan } from '../src/game/BoxFights.js';

const P = (n) => ({ id: 'p' + n, name: 'Player' + n, token: 'tok' + n, look: '' });
function lobbyWith(settings, n) {
  let { lobby } = createLobby({ code: 'BNTV42', settings, player: P(1) });
  for (let i = 2; i <= n; i++) lobby = joinLobby(lobby, P(i)).lobby;
  return lobby;
}

test('code input: upper case, lobby alphabet only, 6 max', () => {
  assert.equal(sanitizeCodeInput('bntv42'), 'BNTV42');
  assert.equal(sanitizeCodeInput('b-n t v 4 2 x y'), 'BNTV42');
  assert.equal(sanitizeCodeInput('O0I1L'), ''); // never in a code
  assert.equal(sanitizeCodeInput(null), '');
  assert.equal(sanitizeCodeInput('ABCDEFGH'), 'ABCDEF');
  assert.equal(codeError('BNTV42'), '');
  assert.equal(codeError('BNTV4'), CODE_HINT);
});

test('host settings: validated like the server, bad patches keep the old value', () => {
  let s = applyHostSettings(DEFAULT_HOST_SETTINGS, { mode: 'ffa' });
  assert.equal(s.mode, 'ffa');
  assert.equal(s.maxPlayers, 6);
  s = applyHostSettings(s, { maxPlayers: 3 });
  assert.equal(s.maxPlayers, 3);
  assert.equal(applyHostSettings(s, { maxPlayers: 9 }).maxPlayers, 3);
  assert.equal(applyHostSettings(s, { mode: '2v2' }).maxPlayers, 4);
  assert.equal(applyHostSettings(s, { roundsToWin: 0 }).roundsToWin, 5);
  assert.deepEqual(offlineBoxOpts({ mode: '3v3', roundsToWin: 3, botDifficulty: 'hard' }), { mode: 'trio', ffaPlayers: undefined, winRounds: 3, botDifficulty: 'hard' });
  assert.equal(offlineBoxOpts({ mode: 'ffa', maxPlayers: 4 }).ffaPlayers, 4);
  assert.equal(ruleLine({ mode: 'ffa' }), FFA_RULE);
  assert.match(ruleLine({ mode: '1v1', roundsToWin: 1 }), /1 round wins/);
});

test('public list: joinable first, full greyed, bad codes dropped', () => {
  const rows = listRows([
    { code: 'AAAAAA', name: 'Full', mode: '1v1', players: 2, max: 2, full: true, state: 'waiting' },
    { code: 'BBBBBB', name: 'Open', mode: 'ffa', players: 3, max: 6, state: 'waiting' },
    { code: 'bad', name: 'x', mode: '1v1', players: 1, max: 2 },
    { code: 'CCCCCC', name: 'Playing', mode: '2v2', players: 2, max: 4, state: 'playing' },
  ]);
  assert.deepEqual(rows.map((r) => r.code), ['BBBBBB', 'AAAAAA', 'CCCCCC']);
  assert.equal(rows[0].count, '3/6');
  assert.equal(rows[0].mode, 'FFA');
  assert.equal(rows[1].joinable, false);
  assert.equal(rows[1].status, 'FULL');
  assert.equal(rows[2].status, 'IN MATCH');
  assert.deepEqual(listRows(null), []);
  // browser mode filter (client-side)
  assert.deepEqual(filterRows(rows, 'ffa').map((r) => r.code), ['BBBBBB']);
  assert.equal(filterRows(rows, 'any').length, 3);
  assert.equal(filterRows(rows, 'bogus').length, 3);
  assert.deepEqual(filterRows(rows, '3v3'), []);
});

test('slot list: teams, open / bot-fill labels, kick and switch rights', () => {
  const l = publicLobby(lobbyWith({ mode: '3v3' }, 2));
  const host = slotListView(l, 'p1');
  assert.equal(host.isHost, true);
  assert.equal(host.groups.length, 2);
  assert.equal(host.groups[0].slots.length, 3);
  const all = host.groups.flatMap((g) => g.slots);
  assert.equal(all.length, 6);
  assert.equal(all.filter((r) => r.label === 'Bot (will fill)').length, 4);
  assert.ok(all.find((r) => r.id === 'p2').canKick);
  assert.ok(!all.find((r) => r.id === 'p1').canKick);
  // p2 joined team 2 (fewest humans): may switch to team 1, which has room
  const guest = slotListView(l, 'p2');
  assert.equal(guest.isHost, false);
  assert.ok(guest.groups[0].canJoin);
  assert.ok(!guest.groups[1].canJoin);
  assert.ok(guest.groups.flatMap((g) => g.slots).every((r) => !r.canKick));
  const noFill = publicLobby(updateSettings(lobbyWith({ mode: '2v2' }, 1), 'p1', { fillWithBots: false }).lobby);
  assert.equal(slotListView(noFill, 'p1').groups.flatMap((g) => g.slots).filter((r) => r.label === 'Open').length, 3);
  const ffa = slotListView(publicLobby(lobbyWith({ mode: 'ffa', maxPlayers: 6 }, 6)), 'p3');
  assert.equal(ffa.ffa, true);
  assert.equal(ffa.groups.length, 1);
  assert.equal(ffa.groups[0].slots.length, 6);
  assert.ok(ffa.groups[0].slots.find((r) => r.isYou && r.id === 'p3'));
});

test('start button: host only, needs a human and (all humans or fill on)', () => {
  const l = lobbyWith({ mode: '2v2', fillWithBots: true }, 1);
  assert.deepEqual(startState(publicLobby(l), 'p1'), { show: true, enabled: true, reason: '' });
  assert.equal(startState(publicLobby(l), 'p2').show, false);
  const off = publicLobby(updateSettings(l, 'p1', { fillWithBots: false }).lobby);
  const st = startState(off, 'p1');
  assert.equal(st.enabled, false);
  assert.match(st.reason, /3 open slots/);
  const full = publicLobby(updateSettings(lobbyWith({ mode: '1v1' }, 2), 'p1', { fillWithBots: false }).lobby);
  assert.equal(startState(full, 'p1').enabled, true);
  const counting = publicLobby(startMatch(l, 'p1').lobby);
  assert.equal(startState(counting, 'p1').enabled, false);
  assert.equal(playerCount(publicLobby(l)), '1/4');
});

test('matchStart: merged slots carry tokens so HostSession can seat the guests', () => {
  let l = lobbyWith({ mode: '2v2' }, 3);
  l = startMatch(l, 'p1').lobby;
  l = beginPlaying(l, { relayCode: 'WXYZ', seed: 7 }).lobby;
  const msg = matchStartPayload(l, {}, 'p1');
  const slots = mergeMatchSlots(msg);
  assert.equal(slots.length, 4);
  assert.equal(slots.filter((s) => s.kind === 'human').length, 3);
  assert.ok(slots.find((s) => s.host && s.token === 'tok1'));
  assert.ok(slots.find((s) => s.token === 'tok3'));
  assert.equal(slots.filter((s) => s.kind === 'bot').length, 1);
  assert.deepEqual([...expectedGuestTokens(msg)].sort(), ['tok2', 'tok3']);
  const opts = hostSessionOpts(msg);
  assert.equal(opts.mode, 'duo');
  assert.equal(opts.hostToken, 'tok1');
  // the real seating: host + both guests matched by token, the bot fills the last place
  const cfg = boxMatchConfig({ ...opts.boxFight, fill: opts.fill });
  const plan = boxSlotPlan(cfg, opts.slots, [{ id: 0, token: 'tok1' }, { id: 1, token: 'tok2' }, { id: 2, token: 'tok3' }]);
  assert.deepEqual(plan.kick, []);
  assert.equal(plan.humans.size, 3);
  assert.equal(plan.bots.length, 1);
  // a guest's copy has no tokens
  assert.equal(mergeMatchSlots(matchStartPayload(l, {}, 'p2')).some((s) => s.token), false);
});

test('result report: team scores by lobby team, FFA scores per slot (capped)', () => {
  let l = lobbyWith({ mode: '1v1' }, 2);
  l = beginPlaying(startMatch(l, 'p1').lobby, { relayCode: 'WXYZ', seed: 1 }).lobby;
  const team = lobbyReport({ score: [5, 2], won: true }, { mode: '1v1', roundsToWin: 5, myTeam: 1 });
  assert.deepEqual(team, { score: { team0: 2, team1: 5 }, final: true, winner: 1 });
  assert.equal(reportResult(l, 'p1', team).event, 'matchEnd');

  let f = lobbyWith({ mode: 'ffa', maxPlayers: 3 }, 2);
  f = beginPlaying(startMatch(f, 'p1').lobby, { relayCode: 'WXYZ', seed: 1 }).lobby;
  const msg = matchStartPayload(f, {}, 'p1');
  const players = [
    { id: 0, name: 'Player1', isBot: false, side: 0, elims: 15 },
    { id: 1, name: 'Player2', isBot: false, side: 1, elims: 3 },
    { id: 2, name: msg.slots[2].name, isBot: true, side: 2, elims: 1 },
  ];
  const map = actorSlotMap({ players, slots: msg.slots, tokens: msg.tokens, clientTokens: new Map([[1, 'tok2']]), hostSlotId: 'p1' });
  assert.equal(map.get(0), 'p1');
  assert.equal(map.get(1), 'p2');
  assert.equal(map.get(2), msg.slots[2].id);
  const ffa = lobbyReport({ ffa: true, score: [7, 1, 0], elims: [15, 3, 1], players }, { mode: 'ffa', roundsToWin: 5, slots: msg.slots, slotOfActor: map });
  assert.equal(ffa.score.p1, 5); // 7 rounds won, capped at roundsToWin for the server
  assert.equal(ffa.winner, 'p1');
  assert.equal(reportResult(f, 'p1', ffa).event, 'matchEnd');
});

test('results table: bot tags, winners first, FFA by elims', () => {
  const bf = {
    won: false,
    players: [
      { id: 0, name: 'Me', isBot: false, side: 0, team: 0, elims: 1, damage: 200, builds: 30 },
      { id: 5, name: 'Bot Alpha', isBot: false, side: 1, team: 1, elims: 4, damage: 500, builds: 50 },
      { id: 6, name: 'Pal', isBot: false, side: 1, team: 1, elims: 2, damage: 100, builds: 3 },
    ],
  };
  const rows = resultRows(bf, 0);
  assert.deepEqual(rows.map((r) => r.id), [5, 6, 0]);
  assert.equal(rows[0].isBot, true); // named like a bot
  assert.equal(rows[2].you, true);
  const ffa = resultRows({ ffa: true, players: [{ id: 1, name: 'A', elims: 1 }, { id: 2, name: 'B', elims: 9 }] });
  assert.deepEqual(ffa.map((r) => r.id), [2, 1]);
  assert.equal(resultRows(null).length, 0);
  assert.equal(countdownLabel(3), '3');
  assert.equal(countdownLabel(0), '');
});
