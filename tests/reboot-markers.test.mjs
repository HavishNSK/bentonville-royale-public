import test from 'node:test';
import assert from 'node:assert/strict';
import { screenAnchor } from '../src/game/Pings.js';
import { rebootMarkerTargets, cleanName } from '../src/game/RebootMarkers.js';

const W = 1280;
const H = 720;
const viewer = { x: 0, z: 0, heading: 0 };
const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

test('screenAnchor: on-screen point stays put', () => {
  const a = screenAnchor({ x: 400, y: 300 }, { x: 0, z: -10 }, viewer, W, H, 40);
  assert.equal(a.edge, false);
  assert.equal(a.x, 400);
  assert.equal(a.y, 300);
});

test('screenAnchor: off-screen right clamps to the right edge, arrow points right', () => {
  const a = screenAnchor({ x: 3000, y: H / 2 }, { x: 50, z: 0 }, viewer, W, H, 40);
  assert.equal(a.edge, true);
  near(a.x, W - 40);
  near(a.y, H / 2);
  near(a.angle, Math.PI / 2);
});

test('screenAnchor: off-screen up-left keeps its direction and stays inside the pad', () => {
  const a = screenAnchor({ x: -2000, y: -2000 }, { x: 0, z: 0 }, viewer, W, H, 40);
  assert.equal(a.edge, true);
  assert.ok(a.x >= 40 - 1e-6 && a.x <= W - 40 + 1e-6);
  assert.ok(a.y >= 40 - 1e-6 && a.y <= H - 40 + 1e-6);
  // touches one edge
  assert.ok(Math.abs(a.x - 40) < 1e-6 || Math.abs(a.y - 40) < 1e-6);
  assert.ok(a.angle < 0 && a.angle > -Math.PI / 2); // up-left quadrant
});

test('screenAnchor: behind the camera pins to the bottom edge on the correct side', () => {
  // facing north (heading 0); the target is south-east (behind, to the right)
  const right = screenAnchor(null, { x: 30, z: 40 }, viewer, W, H, 40);
  assert.equal(right.edge, true);
  near(right.y, H - 40);
  assert.ok(right.x > W / 2);
  assert.ok(Math.abs(right.angle) > Math.PI / 2); // pointing downward
  const left = screenAnchor(null, { x: -30, z: 40 }, viewer, W, H, 40);
  assert.ok(left.x < W / 2);
  // straight behind: bottom centre
  const back = screenAnchor(null, { x: 0, z: 40 }, viewer, W, H, 40);
  near(back.x, W / 2, 1e-3);
  near(back.y, H - 40);
});

test('screenAnchor: inside-the-pad band counts as edge', () => {
  const a = screenAnchor({ x: 10, y: 300 }, { x: 0, z: 0 }, viewer, W, H, 40);
  assert.equal(a.edge, true);
  near(a.x, 40);
});

const card = (v, team, extra = {}) => ({ v, name: 'P' + v, team, x: v * 10, y: 2, z: 5, until: 60, holder: null, ...extra });
const base = { teamMode: true, team: 1, selfId: 7, alive: true, time: 20, self: { x: 0, z: 0 } };

test('rebootMarkerTargets: only your team, ground cards, not your own', () => {
  const cards = [card(1, 1), card(2, 2), card(3, 1, { holder: 4 }), card(7, 1)];
  const t = rebootMarkerTargets({ ...base, cards });
  assert.deepEqual(t.map((m) => m.key), ['c1']);
  assert.equal(t[0].kind, 'card');
  assert.equal(t[0].label, 'P1');
  assert.equal(t[0].secs, 40);
  assert.ok(t[0].y > 2); // above the card
});

test('rebootMarkerTargets: nothing in solo, without a team, or while you are out', () => {
  const cards = [card(1, 1)];
  assert.equal(rebootMarkerTargets({ ...base, cards, teamMode: false }).length, 0);
  assert.equal(rebootMarkerTargets({ ...base, cards, team: null }).length, 0);
  assert.equal(rebootMarkerTargets({ ...base, cards, alive: false }).length, 0);
  assert.equal(rebootMarkerTargets({ teamMode: false }).length, 0);
});

test('rebootMarkerTargets: picked-up / gone cards drop out of the list', () => {
  const cards = new Map([[1, card(1, 1)]]);
  const out = [];
  assert.equal(rebootMarkerTargets({ ...base, cards: cards.values() }, out).length, 1);
  cards.get(1).holder = 9;
  assert.equal(rebootMarkerTargets({ ...base, cards: cards.values() }, out).length, 0);
  cards.delete(1);
  assert.equal(rebootMarkerTargets({ ...base, cards: cards.values() }, out).length, 0);
});

test('rebootMarkerTargets: carrying a card marks the nearest ready van, else the soonest ready', () => {
  const vans = [
    { i: 0, x: 500, y: 0, z: 0, cooldownUntil: 0 },
    { i: 1, x: 100, y: 0, z: 0, cooldownUntil: 50 }, // nearer but recharging
    { i: 2, x: 300, y: 0, z: 0, cooldownUntil: 0 },
  ];
  assert.equal(rebootMarkerTargets({ ...base, cards: [], vans, carrying: 0 }).length, 0);
  const t = rebootMarkerTargets({ ...base, cards: [], vans, carrying: 1 });
  assert.equal(t.length, 1);
  assert.equal(t[0].key, 'v2');
  assert.equal(t[0].cd, false);
  assert.equal(t[0].label, 'REBOOT VAN');
  const allCd = vans.map((v, k) => ({ ...v, cooldownUntil: 40 + k * 10 }));
  const c = rebootMarkerTargets({ ...base, cards: [], vans: allCd, carrying: 2 });
  assert.equal(c[0].key, 'v0');
  assert.equal(c[0].cd, true);
  assert.equal(c[0].label, 'REBOOT 20s');
});

test('cleanName: trims, strips control characters, caps length, falls back', () => {
  assert.equal(cleanName('  Ann  '), 'Ann');
  assert.equal(cleanName('a\u0000b\nc'), 'abc');
  assert.equal(cleanName(''), 'Teammate');
  assert.equal(cleanName(null), 'Teammate');
  const long = cleanName('x'.repeat(40));
  assert.equal(long.length, 16);
  assert.ok(long.endsWith('…'));
  // markup stays literal text (rendered with textContent)
  assert.equal(cleanName('<b>hi</b>'), '<b>hi</b>');
});

test('a card behind you is pinned above the bottom HUD band, not on the health bar', async () => {
  const { keepAboveHud, BOTTOM_HUD } = await import('../src/game/RebootMarkers.js');
  const W = 1470, H = 779;
  const viewer = { x: 0, z: 0, heading: 0 };
  // behind and to the left (project() returns null behind the camera)
  const a = keepAboveHud(screenAnchor(null, { x: -10, z: 30 }, viewer, W, H, 40, {}), H);
  assert.ok(a.edge);
  assert.ok(a.y <= H * (1 - BOTTOM_HUD) + 1e-9, `y ${a.y}`);
  assert.ok(a.x < W / 2, 'still on the left');
  // on-screen markers are left where they are
  const on = keepAboveHud(screenAnchor({ x: 700, y: 700 }, { x: 0, z: -5 }, viewer, W, H, 40, {}), H);
  assert.equal(on.y, 700);
});
