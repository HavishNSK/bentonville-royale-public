// Box Fights: pure arena layout, spawns, round state machine and copy (src/game/BoxFights.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeBox } from '../src/world/boxColliders.js';
import { WEAPONS, CONSUMABLES, MATERIALS, AMMO, weaponRarities } from '../src/core/config.js';
import { Inventory } from '../src/game/Inventory.js';
import {
  BOX_FIGHT, BOX_LOADOUT_IDS, BOX_LOADOUTS, boxLoadoutId, normalizeBoxLoadout, pickBoxLoadout, boxLoadout, normalizeBoxSize, boxMode, boxSizeForMode, arenaLayout, spawnLayout,
  spawnBoxPieces, createBoxFightState, stepBoxFight, roundBanner, boxResultCopy, sideOfTeam,
} from '../src/game/BoxFights.js';

const deepFreeze = (o) => { if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); Object.values(o).forEach(deepFreeze); } return o; };
const near = (a, b) => Math.abs(a - b) < 1e-9;

test('BOX_FIGHT config is frozen and matches the plan', () => {
  assert.equal(BOX_FIGHT.winRounds, 3);
  assert.equal(BOX_FIGHT.firstWarmup, 5);
  assert.equal(BOX_FIGHT.warmup, 5);
  assert.deepEqual({ ...BOX_FIGHT.origin }, { x: -240, z: 160 });
  assert.deepEqual({ ...BOX_FIGHT.cells }, { 1: 6, 2: 8, 3: 10, 4: 10 });
  assert.equal(BOX_FIGHT.floorY, 300);
  assert.equal(BOX_FIGHT.levels, 2);
  assert.ok(Object.isFrozen(BOX_FIGHT) && Object.isFrozen(BOX_FIGHT.origin) && Object.isFrozen(BOX_FIGHT.cells));
});

test('boxLoadout is fresh, valid and accepted by Inventory.reset', () => {
  const a = boxLoadout();
  const b = boxLoadout();
  assert.notEqual(a, b);
  assert.notEqual(a.items, b.items);
  a.items[0].id = 'x';
  a.mats.wood = 1;
  assert.equal(b.items[0].id, 'shotgun');
  assert.equal(boxLoadout().mats.wood, 500);
  for (const it of boxLoadout().items) {
    if (it.type === 'weapon') assert.ok(WEAPONS[it.id]);
    else assert.ok(CONSUMABLES[it.id]);
  }
  for (const m of MATERIALS) assert.equal(boxLoadout().mats[m], 500);
  const inv = new Inventory(boxLoadout());
  assert.equal(inv.mats.wood, 500);
  assert.equal(inv.ammo.shells, 30);
});

test('normalizeBoxSize and mode mapping', () => {
  assert.equal(normalizeBoxSize(1), 1);
  assert.equal(normalizeBoxSize(2), 2);
  assert.equal(normalizeBoxSize(3), 3);
  assert.equal(normalizeBoxSize(4), 4);
  assert.equal(normalizeBoxSize('2'), 2);
  assert.equal(normalizeBoxSize('4'), 4);
  for (const bad of [0, 5, NaN, -1, 1.5, null, undefined, {}, [], 'abc', '', '5', Infinity]) assert.equal(normalizeBoxSize(bad), 1, String(bad));
  assert.deepEqual([1, 2, 3, 4].map(boxMode), ['solo', 'duo', 'trio', 'squad']);
  assert.equal(boxMode(9), 'solo');
  assert.equal(boxSizeForMode('solo'), 1);
  assert.equal(boxSizeForMode('duo'), 2);
  assert.equal(boxSizeForMode('trio'), 3);
  assert.equal(boxSizeForMode('squad'), 4);
  assert.equal(boxSizeForMode('nope'), null);
  assert.equal(boxSizeForMode(undefined), null);
});

const inWall = (L, x, z, y) => L.colliders.some((c) => x >= c.minX && x <= c.maxX && z >= c.minZ && z <= c.maxZ && y >= c.y0 && y <= c.y1);
const cover = (c, x, z) => x >= c.cx - c.hx && x <= c.cx + c.hx && z >= c.cz - c.hz && z <= c.cz + c.hz;

for (const size of [1, 2, 3, 4]) {
  test(`arenaLayout(${size}): grid, height, walls, floor and ceiling`, () => {
    const L0 = arenaLayout(size);
    const L = { ...L0, colliders: L0.colliders.map((d) => makeBox({ ...d, id: 0 })) };
    const N = BOX_FIGHT.cells[size];
    assert.equal(L.size, size);
    assert.equal(L.cells, N);
    const { rect } = L;
    assert.ok(rect.minX % 4 === 0);
    assert.ok(rect.minZ % 4 === 0);
    assert.equal(rect.maxX - rect.minX, N * 4);
    assert.equal(rect.maxZ - rect.minZ, N * 4);
    assert.ok(L.floorY % 3 === 0);
    assert.equal(L.ceilY - L.floorY, 6);
    assert.equal(L.killY, 280);
    assert.deepEqual({ ...L.center }, { x: (rect.minX + rect.maxX) / 2, z: (rect.minZ + rect.maxZ) / 2 });
    assert.equal(L.colliders.length, 6);
    assert.equal(L.buildArea.minY, L.floorY);
    assert.equal(L.buildArea.maxY, L.ceilY);
    assert.equal(L.bounds.minX, rect.minX - 1);
    assert.equal(L.bounds.maxZ, rect.maxZ + 1);
    const y = L.floorY + 1.5;
    const eps = 0.2;
    const xs = [rect.minX, (rect.minX + rect.maxX) / 2, rect.maxX];
    const zs = [rect.minZ, (rect.minZ + rect.maxZ) / 2, rect.maxZ];
    for (const m of xs) {
      assert.ok(inWall(L, m, rect.minZ - eps, y), 'north');
      assert.ok(inWall(L, m, rect.maxZ + eps, y), 'south');
    }
    for (const m of zs) {
      assert.ok(inWall(L, rect.minX - eps, m, y), 'west');
      assert.ok(inWall(L, rect.maxX + eps, m, y), 'east');
    }
    for (const [cx, cz] of [[rect.minX - 0.5, rect.minZ - 0.5], [rect.maxX + 0.5, rect.minZ - 0.5], [rect.minX - 0.5, rect.maxZ + 0.5], [rect.maxX + 0.5, rect.maxZ + 0.5]]) assert.ok(inWall(L, cx, cz, y), 'corner');
    // interior is open at standing height
    assert.ok(!inWall(L, L.center.x, L.center.z, y));
    // walls are outside the interior
    for (const c of L.colliders.slice(2)) {
      const overlapX = Math.min(c.maxX, rect.maxX) - Math.max(c.minX, rect.minX);
      const overlapZ = Math.min(c.maxZ, rect.maxZ) - Math.max(c.minZ, rect.minZ);
      assert.ok(overlapX <= 0 || overlapZ <= 0, 'wall intrudes into interior');
    }
    const [floor, ceil] = L.colliders;
    assert.equal(floor.y0, 299); assert.equal(floor.y1, 300);
    assert.equal(ceil.y0, 306); assert.equal(ceil.y1, 307);
    for (const c of [floor, ceil]) for (const [x, z] of [[rect.minX, rect.minZ], [rect.maxX, rect.maxZ], [rect.minX, rect.maxZ], [rect.maxX, rect.minZ], [L.center.x, L.center.z]]) assert.ok(cover(c, x, z));
    for (const c of L.colliders) { assert.equal(c.kind, 'arena'); assert.equal(c.mat, 'metal'); assert.ok(c.hx > 0 && c.hz > 0 && c.y1 > c.y0); }
    for (const c of L.colliders.slice(2)) { assert.equal(c.y0, 299); assert.equal(c.y1, 307); }
  });

  test(`arenaLayout(${size}) fits the map and avoids Crystal Bridges`, () => {
    const L = arenaLayout(size);
    const b = JSON.parse(readFileSync(new URL('../public/data/bentonville-osm.json', import.meta.url))).meta.bounds;
    assert.ok(L.bounds.minX - 5 >= b.minX && L.bounds.maxX + 5 <= b.maxX);
    assert.ok(L.bounds.minZ - 5 >= b.minZ && L.bounds.maxZ + 5 <= b.maxZ);
    const hitsSite = L.bounds.maxX > -75 && L.bounds.minX < 75 && L.bounds.maxZ > -470 && L.bounds.minZ < -150;
    assert.equal(hitsSite, false);
  });

  test(`spawnLayout(${size})`, () => {
    const L = arenaLayout(size);
    const N = L.cells;
    const sp = spawnLayout(L, size);
    assert.equal(sp.length, 2 * size);
    assert.deepEqual(sp.map((s) => s.side), [...Array(size).fill(0), ...Array(size).fill(1)]);
    assert.deepEqual(sp.slice(0, size).map((s) => s.slot), [...Array(size).keys()]);
    assert.equal(new Set(sp.map((s) => `${s.cell.i},${s.cell.j}`)).size, 2 * size);
    for (const s of sp) {
      assert.ok(s.cell.i >= 1 && s.cell.i <= N - 2 && s.cell.j >= 1 && s.cell.j <= N - 2);
      assert.ok(near(s.x, L.rect.minX + (s.cell.i + 0.5) * 4) && near(s.z, L.rect.minZ + (s.cell.j + 0.5) * 4));
      assert.equal(s.y, L.floorY);
      assert.equal(s.cell.j, s.side === 0 ? 1 : N - 2);
      assert.ok(near(s.heading, s.side === 0 ? Math.PI : 0));
      assert.ok(s.side === 0 ? s.z < L.center.z : s.z > L.center.z);
    }
    for (let a = 0; a < sp.length; a++) for (let b = a + 1; b < sp.length; b++) {
      assert.ok(Math.max(Math.abs(sp[a].cell.i - sp[b].cell.i), Math.abs(sp[a].cell.j - sp[b].cell.j)) >= 2);
    }
    sp.slice(0, size).forEach((s, k) => {
      const m = sp[size + k];
      assert.equal(m.cell.i, N - 1 - s.cell.i);
      assert.equal(m.cell.j, N - 1 - s.cell.j);
    });
    // side-0 columns: one empty cell between boxes
    const cols = sp.slice(0, size).map((s) => s.cell.i);
    assert.equal(cols[0], Math.floor(N / 2) - size);
    cols.forEach((c, k) => k && assert.equal(c - cols[k - 1], 2));
    // heading faces the opponent: forward = (sin h, -cos h)
    assert.ok(-Math.cos(sp[0].heading) > 0);
    assert.ok(-Math.cos(sp[size].heading) < 0);
  });
}

test('arenaLayout is memoised and frozen; invalid sizes fall back to 1', () => {
  assert.equal(arenaLayout(2), arenaLayout(2));
  assert.ok(Object.isFrozen(arenaLayout(2)));
  assert.equal(arenaLayout('x').size, 1);
});

test('spawnBoxPieces: four walls on the cell edges and a cone roof', () => {
  const L = arenaLayout(1);
  const [s] = spawnLayout(L, 1);
  const P = spawnBoxPieces(s, L.floorY);
  assert.equal(P.length, 5);
  const minX = s.x - 2, minZ = s.z - 2;
  const walls = P.filter((p) => p.kind === 'wall');
  assert.equal(walls.length, 4);
  const has = (x, z, rot) => walls.some((p) => near(p.x, x) && near(p.z, z) && near(p.rot, rot) && p.y === L.floorY);
  assert.ok(has(s.x, minZ, 0));
  assert.ok(has(s.x, minZ + 4, 0));
  assert.ok(has(minX, s.z, Math.PI / 2));
  assert.ok(has(minX + 4, s.z, Math.PI / 2));
  const cone = P.filter((p) => p.kind === 'cone');
  assert.equal(cone.length, 1);
  assert.ok(near(cone[0].x, s.x) && near(cone[0].z, s.z) && near(cone[0].y, L.floorY + 3));
});

test('createBoxFightState defaults', () => {
  assert.deepEqual(createBoxFightState(), { phase: 'warmup', t: 5, round: 1, score: [0, 0], winner: null, winRounds: 3 });
  assert.equal(createBoxFightState({ winRounds: 2 }).winRounds, 2);
});

test('warmup counts down then fires "fight" once', () => {
  const s0 = deepFreeze(createBoxFightState());
  let r = stepBoxFight(s0, 2, [1, 1]);
  assert.equal(r.state.phase, 'warmup');
  assert.ok(near(r.state.t, 3));
  assert.deepEqual(r.events, []);
  r = stepBoxFight(r.state, 3, [1, 1]);
  assert.equal(r.state.phase, 'fight');
  assert.deepEqual(r.events, [{ type: 'fight', round: 1 }]);
  r = stepBoxFight(r.state, 1, [1, 1]);
  assert.equal(r.state.phase, 'fight');
  assert.deepEqual(r.events, []);
});

const fight = (over = {}) => ({ ...createBoxFightState(), phase: 'fight', t: 0, ...over });

test('fight: a side wiping the other scores, then roundEnd -> next warmup', () => {
  const s0 = deepFreeze(fight());
  let r = stepBoxFight(s0, 0.1, [2, 0]);
  assert.equal(r.state.phase, 'roundEnd');
  assert.deepEqual(r.state.score, [1, 0]);
  assert.equal(r.state.t, BOX_FIGHT.roundEndDelay);
  assert.deepEqual(r.events, [{ type: 'roundEnd', round: 1, winnerSide: 0, score: [1, 0] }]);
  r = stepBoxFight(r.state, 1, [2, 0]);
  assert.deepEqual(r.events, []);
  assert.equal(r.state.phase, 'roundEnd');
  r = stepBoxFight(r.state, 2, [2, 0]);
  assert.equal(r.state.phase, 'warmup');
  assert.equal(r.state.round, 2);
  assert.equal(r.state.t, BOX_FIGHT.warmup);
  assert.deepEqual(r.events, [{ type: 'roundStart', round: 2 }]);
  const r2 = stepBoxFight(fight({ round: 2 }), 0.1, [0, 3]);
  assert.deepEqual(r2.state.score, [0, 1]);
  assert.equal(r2.events[0].winnerSide, 1);
});

test('fight: both sides dead is a draw (score unchanged, round still advances)', () => {
  let r = stepBoxFight(deepFreeze(fight({ score: [1, 1] })), 0.1, [0, 0]);
  assert.deepEqual(r.state.score, [1, 1]);
  assert.equal(r.state.phase, 'roundEnd');
  assert.deepEqual(r.events, [{ type: 'roundEnd', round: 1, winnerSide: null, score: [1, 1] }]);
  r = stepBoxFight(r.state, 5, [0, 0]);
  assert.equal(r.state.round, 2);
  assert.equal(r.state.phase, 'warmup');
});

test('first to winRounds ends the match; matchOver fires exactly once', () => {
  let r = stepBoxFight(deepFreeze(fight({ score: [2, 1], round: 4 })), 0.1, [1, 0]);
  assert.equal(r.state.phase, 'matchEnd');
  assert.equal(r.state.winner, 0);
  assert.deepEqual(r.state.score, [3, 1]);
  assert.equal(r.state.t, BOX_FIGHT.matchEndDelay);
  assert.deepEqual(r.events.map((e) => e.type), ['roundEnd', 'matchEnd']);
  assert.deepEqual(r.events[1], { type: 'matchEnd', winnerSide: 0, score: [3, 1] });
  const types = [];
  for (let i = 0; i < 10; i++) { r = stepBoxFight(r.state, 1, [1, 0]); types.push(...r.events.map((e) => e.type)); }
  assert.deepEqual(types, ['matchOver']);
  assert.equal(r.state.t, 0);
  assert.equal(r.state.phase, 'matchEnd');
  // side 1 can win too, with a custom winRounds
  const r1 = stepBoxFight(fight({ score: [0, 1], winRounds: 2 }), 0.1, [0, 1]);
  assert.equal(r1.state.winner, 1);
});

test('stepBoxFight never mutates its input', () => {
  for (const s of [createBoxFightState(), fight(), fight({ phase: 'roundEnd', t: 1 }), fight({ phase: 'matchEnd', t: 1, winner: 0 })]) {
    const frozen = deepFreeze(JSON.parse(JSON.stringify(s)));
    const alive = deepFreeze([0, 0]);
    assert.doesNotThrow(() => stepBoxFight(frozen, 10, alive));
  }
});

test('roundBanner and boxResultCopy', () => {
  const s = { ...createBoxFightState(), round: 2, score: [1, 0] };
  assert.equal(roundBanner(s, 0), 'ROUND 2 · 1–0');
  assert.equal(roundBanner(s, 1), 'ROUND 2 · 0–1');
  assert.equal(roundBanner(s, 7), 'ROUND 2 · 1–0');
  assert.deepEqual(boxResultCopy({ victory: true, size: 2, score: [3, 1] }), { title: 'BOX FIGHT WON', sub: 'You won 3–1 in 2V2 Box Fights.', tile: '3–1' });
  assert.deepEqual(boxResultCopy({ victory: false, size: 3, score: [1, 3] }), { title: 'BOX FIGHT LOST', sub: 'You lost 1–3 in 3V3 Box Fights.', tile: '1–3' });
  assert.match(boxResultCopy({ victory: true, size: 4, score: [3, 0] }).sub, /4V4/);
  assert.match(boxResultCopy({ victory: true, size: 9, score: [3, 0] }).sub, /1V1/);
});

test('sideOfTeam', () => {
  assert.equal(sideOfTeam(['a', 'b'], 'a'), 0);
  assert.equal(sideOfTeam(['a', 'b'], 'b'), 1);
  assert.equal(sideOfTeam(['a', 'b'], 'c'), -1);
  assert.equal(sideOfTeam(null, 'a'), -1);
});

test('loadout ids are frozen and the whitelist rejects hostile input', () => {
  assert.deepEqual([...BOX_LOADOUT_IDS], ['standard'], 'one kit for everyone');
  assert.ok(Object.isFrozen(BOX_LOADOUT_IDS));
  for (const id of BOX_LOADOUT_IDS) { assert.equal(boxLoadoutId(id), id); assert.equal(normalizeBoxLoadout(id), id); }
  for (const bad of ['tactical', 'heavy', '__proto__', 'constructor', 'toString', 'STANDARD', ' standard', 'pump', null, undefined, 5, {}, [], ['standard']]) {
    assert.equal(boxLoadoutId(bad), null, String(bad));
    assert.equal(normalizeBoxLoadout(bad), 'standard', String(bad));
  }
});

test('every loadout preset is valid and fully accepted by Inventory', () => {
  assert.ok(Object.isFrozen(BOX_LOADOUTS));
  for (const id of BOX_LOADOUT_IDS) {
    const L = BOX_LOADOUTS[id];
    assert.ok(Object.isFrozen(L) && Object.isFrozen(L.items) && Object.isFrozen(L.items[0]) && Object.isFrozen(L.ammo) && Object.isFrozen(L.mats), id);
    assert.ok(L.items.length <= 5);
    assert.equal(L.selected, 0);
    for (const it of L.items) {
      if (it.type === 'weapon') {
        assert.ok(WEAPONS[it.id], it.id);
        assert.ok(weaponRarities(it.id).includes(it.rarity), `${id}: ${it.id} ${it.rarity}`);
      } else {
        assert.equal(it.type, 'consumable');
        assert.ok(CONSUMABLES[it.id]);
        assert.ok(it.count >= 1 && it.count <= CONSUMABLES[it.id].stack);
      }
    }
    for (const [k, n] of Object.entries(L.ammo)) { assert.ok(AMMO[k], k); assert.ok(n > 0 && n <= (AMMO[k].cap || 300), k); }
    for (const m of MATERIALS) assert.equal(L.mats[m], 500);
    const inv = new Inventory(boxLoadout(id));
    assert.equal(inv.slots.filter(Boolean).length, L.items.length, id);
    for (const [k, n] of Object.entries(L.ammo)) assert.equal(inv.ammo[k], n, `${id} ${k}`);
    for (const m of MATERIALS) assert.equal(inv.mats[m], 500);
  }
  assert.equal(BOX_LOADOUTS.standard.ammo.shells, 30);
  assert.deepEqual(BOX_LOADOUTS.standard.items.map((it) => it.id), ['shotgun', 'rifle', 'smg', 'tonic']);
  assert.equal(BOX_LOADOUTS.tactical, undefined);
  assert.equal(BOX_LOADOUTS.heavy, undefined);
});

test('boxLoadout returns fresh copies and defaults to standard', () => {
  assert.deepEqual(boxLoadout(), boxLoadout('standard'));
  assert.deepEqual(boxLoadout('nope'), boxLoadout('standard'));
  assert.deepEqual(boxLoadout('__proto__'), boxLoadout('standard'));
  for (const id of BOX_LOADOUT_IDS) {
    const a = boxLoadout(id);
    a.items[0].id = 'x'; a.ammo.shells = 1; a.mats.wood = 1;
    const b = boxLoadout(id);
    assert.notEqual(b.items[0].id, 'x');
    assert.equal(b.mats.wood, 500);
    assert.equal(Object.isFrozen(b), false);
    assert.equal(BOX_LOADOUTS[id].mats.wood, 500);
  }
});

test('pickBoxLoadout is deterministic, covers all ids and survives bad rng', () => {
  let seed = 7;
  const rng = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  const seen = new Set();
  for (let i = 0; i < 200; i++) { const id = pickBoxLoadout(rng); assert.ok(BOX_LOADOUT_IDS.includes(id)); seen.add(id); }
  assert.equal(seen.size, 1);
  const run = () => { let s = 3; const r = () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; }; return Array.from({ length: 10 }, () => pickBoxLoadout(r)); };
  assert.deepEqual(run(), run());
  for (const bad of [() => 1, () => NaN, () => 5, () => -1, () => Infinity, () => undefined]) assert.ok(BOX_LOADOUT_IDS.includes(pickBoxLoadout(bad)));
  assert.ok(BOX_LOADOUT_IDS.includes(pickBoxLoadout()));
});

test('arenaLayout divider: full-width, floor-to-ceiling wall across the middle, between the spawn rows', () => {
  for (const size of [1, 2, 3, 4]) {
    const L = arenaLayout(size);
    const d = makeBox(L.divider);
    const mid = L.rect.minZ + L.cells * 2;
    assert.equal(L.divider.kind, 'arena');
    // covers the whole width (no gap to the side walls) and the full height
    assert.ok(d.minX <= L.rect.minX && d.maxX >= L.rect.maxX, `size ${size}: divider spans the width`);
    assert.ok(d.y0 <= L.floorY && d.y1 >= L.ceilY, `size ${size}: divider spans floor to ceiling`);
    assert.ok(d.minZ < mid && d.maxZ > mid, `size ${size}: divider sits on the midline`);
    assert.ok(d.maxZ - d.minZ <= 1, `size ${size}: divider is thin`);
    // every spawn is on its own side of it
    for (const sp of spawnLayout(L, size)) {
      if (sp.side === 0) assert.ok(sp.z < d.minZ - 1, `size ${size}: side 0 spawn north of the wall`);
      else assert.ok(sp.z > d.maxZ + 1, `size ${size}: side 1 spawn south of the wall`);
    }
    // the no-build zone covers the midline across the full width
    const b = L.dividerBlock;
    assert.ok(b.minX <= L.rect.minX && b.maxX >= L.rect.maxX);
    assert.ok(b.minZ < mid && b.maxZ > mid && b.maxZ - b.minZ <= 1.5);
  }
});
