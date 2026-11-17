import test from 'node:test';
import assert from 'node:assert/strict';
import { furnishInterior, furnishWith, CATALOG, FURNISHING_LIMITS, quadCost } from '../src/world/interiors/furnishings.js';
import { addFurnishingGeometry } from '../src/world/InteriorFurnishings.js';
import { toLocal } from '../src/world/interiors/layout.js';
import fs from 'node:fs';
import { World } from '../src/world/World.js';

const frame = { ox: 0, oz: 0, ux: 1, uz: 0, vx: 0, vz: 1, L: 12, W: 10 };
const room = { id: 0, kind: 'bedroom', label: 'Guest Bedroom', a0: 0, b0: 0, a1: 12, b1: 10, cx: 6, cz: 5 };
const level = { i: 0, y: 2, ceil: 5, rooms: [room], holes: [], doors: [{x: 6, z: 0, nx: 0, nz: 1, w: 1.7, roomA: 0, roomB: -1}] };
const plan = () => ({ id: 3, hash: 123, frame, levels: [level], stairs: [], lootSpots: [{x: 6,y: 2,z: 5,level: 0}], furniture: [], signs: [], doorH: 2.2 });
const shell = {floor: 2, inner: [0,0,12,0,12,10,0,10], doors: level.doors};

// A 30 x 20 room with one door on the b = 0 wall and the loot spot at the centre.
const bigFrame = { ox: 0, oz: 0, ux: 1, uz: 0, vx: 0, vz: 1, L: 30, W: 20 };
const bigShell = { floor: 0, inner: [0,0,30,0,30,20,0,20], doors: [] };
function bigPlan(kind, extra = {}) {
  const r = { id: 0, kind, label: kind, a0: 0, b0: 0, a1: 30, b1: 20, cx: 15, cz: 10, area: 600 };
  const L = { i: 0, y: 0, ceil: 4, rooms: [r], holes: [], doors: [{ x: 15, z: 0, nx: 0, nz: 1, w: 1.8, roomA: 0, roomB: -1 }] };
  return { id: 77, hash: 9, recipe: 'hall', frame: bigFrame, levels: [L], stairs: [], lootSpots: [{ x: 15, y: 0, z: 10, level: 0, room: 0 }], furniture: [], signs: [], doorH: 2.2, ...extra };
}

const KIT_KINDS = ['living','bedroom','kitchen','dining','bath','restroom','apartment','sales','stall','storage','office','vault','break',
  'garage','greenhouse','gallery','auditorium','library','classroom','cafe','bar','courtroom','cafeteria','studio','gym','brewhouse',
  'hall','lobby','open','unrecognised'];
const GRID_KINDS = ['classroom','auditorium','cafeteria','library','sales','office','gallery'];
const flat = p => p.height <= 0.05;
const mounted = p => !!CATALOG[p.kind].mount;
const totalQuads = out => out.furniture.reduce((n, p) => n + quadCost(p.kind), 0) + out.lights.length * quadCost('light');

/** True when a (padded) prop rect touches the segment (a0,b0)-(a1,b1). Liang-Barsky slab test. */
function segTouches(p, pad, sa, sb, ea, eb) {
  const r = { a0: p.a0 - pad, b0: p.b0 - pad, a1: p.a1 + pad, b1: p.b1 + pad };
  let t0 = 0, t1 = 1;
  const da = ea - sa, db = eb - sb;
  for (const [d, lo, hi, s] of [[da, r.a0, r.a1, sa], [db, r.b0, r.b1, sb]]) {
    if (Math.abs(d) < 1e-9) { if (s < lo || s > hi) return false; continue; }
    let u = (lo - s) / d, v = (hi - s) / d;
    if (u > v) [u, v] = [v, u];
    t0 = Math.max(t0, u); t1 = Math.min(t1, v);
    if (t0 > t1) return false;
  }
  return true;
}

test('room furnishings are deterministic, immutable, inside the footprint, and leave loot and doors clear', () => {
  const source = plan();
  const before = JSON.stringify(source);
  const out = furnishInterior(source, shell);
  assert.equal(JSON.stringify(source), before);
  assert.deepEqual(out, furnishInterior(plan(), shell));
  assert.ok(out.furniture.some(p => p.kind === 'bed'));
  assert.ok(out.furniture.length > 2, 'rooms get full kits, not one or two props');
  assert.notEqual(out.hash, source.hash);
  assert.equal('colliders' in out, false, 'plan.colliders is replaced by levels[i].props');
  for (const p of out.furniture) {
    assert.ok(p.a0 > 0 && p.b0 > 0 && p.a1 < 12 && p.b1 < 10, p.kind);
    assert.ok(p.a0 < p.a1 && p.b0 < p.b1);
    if (flat(p) || mounted(p)) continue;
    assert.ok(p.a1 < 5 || p.a0 > 7 || p.b0 > 6, p.kind + ' blocks the door lane or loot spot');
  }
  assert.equal(out.signs[0].text, 'GUEST BEDROOM');
});

test('prop records follow the shared schema', () => {
  const out = furnishInterior(plan(), shell);
  for (const p of out.furniture) {
    assert.ok(CATALOG[p.kind], p.kind);
    for (const k of ['level','room','a0','b0','a1','b1','y','lift','height','color','accent','tier']) assert.ok(Number.isFinite(p[k]), k);
    assert.ok(['a+','a-','b+','b-'].includes(p.face));
    assert.equal(typeof p.solid, 'boolean');
    assert.equal(typeof p.block, 'boolean');
    assert.ok(p.tier >= 0 && p.tier <= 3);
    if (mounted(p)) assert.ok(p.lift > 0.5, p.kind + ' is wall mounted');
  }
  assert.ok(out.lights.length > 0);
  for (const l of out.lights) {
    assert.equal(l.y, 5);
    assert.ok(l.a0 > 0 && l.b0 > 0 && l.a1 < 12 && l.b1 < 10);
  }
});

test('supports upper levels; circulation rooms get wall-hugging dressing; small stair rooms stay empty', () => {
  const p = plan();
  p.levels = [level, {...level, i: 1, y: 5, ceil: 8}];
  const out = furnishInterior(p, shell);
  assert.ok(out.furniture.some(p => p.level === 1 && p.y === 5));
  // A corridor is dressed, but only against its walls: the middle stays a clear walking spine.
  const corridorRoom = {...room, kind: 'corridor', label: 'Corridor', b0: 3, b1: 7, cz: 5};
  const corridor = {...level, rooms: [corridorRoom]};
  const cOut = furnishInterior({...p, levels: [corridor]}, shell);
  assert.ok(cOut.furniture.length > 0, 'corridors are dressed');
  for (const f of cOut.furniture) if (!flat(f)) assert.ok(f.b1 <= 4.35 || f.b0 >= 5.65, f.kind + ' sits in the corridor spine');
  // A tiny closet-sized circulation room stays empty.
  const tiny = {...level, rooms: [{...room, kind: 'hall', a0: 0, b0: 0, a1: 1.6, b1: 1.6, cx: 0.8, cz: 0.8}]};
  assert.equal(furnishInterior({...p, levels: [tiny], lootSpots: []}, shell).furniture.length, 0);
  const stairs = [{level: 0, room: 0, upperRoom: 0}];
  assert.equal(furnishInterior({...p, stairs}, shell).furniture.length, 0);
});

test('lobbies get a reception desk and school corridors get lockers', () => {
  const lobby = furnishInterior(bigPlan('lobby'), bigShell);
  assert.ok(lobby.furniture.some(p => p.kind === 'reception_desk'));
  const school = bigPlan('corridor');
  school.levels = [{...school.levels[0], rooms: [{...school.levels[0].rooms[0], b0: 6, b1: 11.5, cz: 8.75, label: 'Main corridor'}]}];
  school.lootSpots = [{ x: 15, y: 0, z: 8.75, level: 0, room: 0 }];
  const plain = furnishInterior(school, bigShell);
  assert.ok(!plain.furniture.some(p => p.kind === 'locker_bank'), 'no lockers outside schools');
  const hs = furnishInterior({...school, recipe: 'landmark', levels: [{...school.levels[0], rooms: [...school.levels[0].rooms, {id: 1, kind: 'classroom', label: 'Classroom 1', a0: 0, b0: 12, a1: 8, b1: 20, cx: 4, cz: 16}]}]}, bigShell);
  assert.ok(hs.furniture.some(p => p.kind === 'locker_bank' && p.room === 0), 'school corridors get lockers');
});

test('larger stair rooms are furnished around a reserved stair footprint and endpoint lanes', () => {
  const p = bigPlan('living');
  const s = { level: 0, room0: 0, room1: 0, x0: 4, z0: 15, x1: 10, z1: 15, y0: 0, y1: 3.4, w: 1.4, a0: 4, b0: 14.3, a1: 10, b1: 15.7, axis: 'a' };
  p.stairs = [s];
  const out = furnishInterior(p, bigShell);
  assert.ok(out.furniture.length > 3);
  for (const f of out.furniture) {
    if (mounted(f)) continue;
    assert.ok(f.a1 <= s.a0 - 1.5 || f.a0 >= s.a1 + 1.5 || f.b1 <= s.b0 - 1.5 || f.b0 >= s.b1 + 1.5, f.kind + ' on the stairs');
    if (flat(f)) continue;
    assert.ok(!segTouches(f, 0.99, 4, 15, 15, 10), f.kind + ' blocks the lane from the stair foot');
  }
});

test('every room kind gets a kit; grid kinds fill big rooms', () => {
  for (const kind of KIT_KINDS) {
    const p = plan();
    p.levels = [{...level, rooms: [{...room, kind}]}];
    const out = furnishInterior(p, shell);
    assert.ok(out.furniture.length > 0, kind);
    const big = furnishInterior(bigPlan(kind), bigShell);
    assert.ok(big.furniture.length > 0, kind + ' (big)');
    assert.ok(totalQuads(big) <= FURNISHING_LIMITS.quads, kind + ' budget');
    for (const f of big.furniture) {
      assert.ok(f.a0 > 0 && f.b0 > 0 && f.a1 < 30 && f.b1 < 20, kind + ' ' + f.kind);
      if (flat(f) || mounted(f)) continue;
      assert.ok(!segTouches(f, 0.99, 15, 0, 15, 10), kind + ': ' + f.kind + ' blocks the door lane');
      assert.ok(f.a1 <= 14.1 || f.a0 >= 15.9 || f.b1 <= 9.1 || f.b0 >= 10.9, kind + ': ' + f.kind + ' on the loot spot');
    }
  }
  for (const kind of GRID_KINDS) {
    assert.ok(furnishInterior(bigPlan(kind), bigShell).furniture.length >= 8, kind);
  }
  const kits = { auditorium: 'seat_row', classroom: 'school_desk', gym: 'court_lines', courtroom: 'judge_bench', brewhouse: 'tank', kitchen: 'counter', restroom: 'toilet_stall' };
  for (const [kind, prop] of Object.entries(kits)) {
    assert.ok(furnishInterior(bigPlan(kind), bigShell).furniture.some(p => p.kind === prop), kind + ' has ' + prop);
  }
});

test('colliders mirror solid props: stride-7 capsules plus a block flag per capsule', () => {
  for (const kind of ['kitchen','sales','gym','courtroom']) {
    const out = furnishInterior(bigPlan(kind), bigShell);
    const L = out.levels[0];
    const solid = out.furniture.filter(p => p.solid && p.level === 0);
    assert.ok(solid.length > 0, kind);
    assert.ok(L.props instanceof Float32Array && L.propBlock instanceof Uint8Array);
    assert.equal(L.props.length, solid.length * 7);
    assert.equal(L.propBlock.length, solid.length);
    solid.forEach((p, i) => {
      const [ax, az, bx, bz, r, y0, y1] = L.props.slice(i * 7, i * 7 + 7);
      assert.equal(L.propBlock[i], p.block ? 1 : 0);
      assert.ok(Math.abs(r - Math.min(p.a1 - p.a0, p.b1 - p.b0) / 2) < 1e-4);
      assert.ok(Math.abs(y0 - (p.y + p.lift)) < 1e-4 && Math.abs(y1 - (p.y + p.lift + p.height)) < 1e-4);
      // capsules are in world space: map back to the plan frame before comparing with the footprint
      for (const [x, z] of [[ax, az], [bx, bz]]) { const [a, b] = toLocal(out.frame, x, z); assert.ok(a >= p.a0 - 1e-3 && a <= p.a1 + 1e-3 && b >= p.b0 - 1e-3 && b <= p.b1 + 1e-3); }
    });
  }
  const none = furnishInterior({...plan(), levels: [{...level, rooms: []}]}, shell);
  assert.equal(none.levels[0].props.length, 0);
});

test('rejects clipped corners and keeps the quad budget even with many rooms', () => {
  const p = plan();
  p.levels = [{...level, rooms: Array.from({length: 500}, (_,id) => ({...room,id}))}];
  const out = furnishInterior(p, shell);
  assert.ok(totalQuads(out) <= FURNISHING_LIMITS.quads);
  assert.ok(out.furniture.length > 50);
  assert.ok(out.signs.length <= 32);
  assert.deepEqual(out, furnishInterior(p, shell));
  const noFloor = {...shell, inner: [5,4,7,4,7,6,5,6]};
  assert.equal(furnishInterior(plan(), noFloor).furniture.length, 0);
});

test('landmark directives are applied first and tolerate bad input', () => {
  const dressing = { 3: [
    { room: 'Guest Bedroom', place: 'at', kind: 'plinth', fa: 0.2, fb: 0.8 },
    { room: 'Guest Bedroom', place: 'wall_mount', kind: 'painting_large', sides: ['a1', 'zz'], max: 1 },
    { room: 'No such room', place: 'grid', kind: 'crate' },
    { room: 'Guest Bedroom', place: 'grid', kind: 'not_a_kind' },
    { room: 'Guest Bedroom', place: 'explode', kind: 'crate' },
    { room: 'Guest Bedroom', place: 'walls', kind: 'crate', max: 1e9, gap: NaN, sides: ['b1', 'nope'] },
    { room: 'Guest Bedroom', place: 'centre', kind: 'rug', w: -4, d: Infinity },
    null, 7, { place: 'at' },
  ], 4: 'garbage' };
  const out = furnishWith(plan(), shell, dressing);
  const plinth = out.furniture.find(p => p.kind === 'plinth');
  assert.ok(plinth, 'at directive placed');
  assert.ok(Math.abs((plinth.a0 + plinth.a1) / 2 - 2.4) < 0.6 && Math.abs((plinth.b0 + plinth.b1) / 2 - 8) < 0.6);
  assert.ok(out.furniture.some(p => p.kind === 'painting_large' && p.face === 'a-'));
  assert.ok(out.furniture.some(p => p.kind === 'bed'), 'kit fills the remaining space');
  assert.deepEqual(out, furnishWith(plan(), shell, dressing));
  assert.notEqual(out.hash, furnishInterior(plan(), shell).hash);
  for (const f of out.furniture) assert.ok(f.a0 > 0 && f.b0 > 0 && f.a1 < 12 && f.b1 < 10 && Number.isFinite(f.a0 + f.a1 + f.b0 + f.b1));
  assert.doesNotThrow(() => furnishWith(plan(), shell, { 3: [{ room: 'Guest Bedroom', place: 'grid', kind: 'school_desk', aisle: -1, margin: 1e6, max: -5 }] }));
  // Landmarks get the larger budget.
  const many = plan();
  many.levels = [{...level, rooms: Array.from({length: 500}, (_,id) => ({...room,id}))}];
  const lm = furnishWith({...many, recipe: 'landmark'}, shell, {});
  assert.ok(totalQuads(lm) > FURNISHING_LIMITS.quads && totalQuads(lm) <= FURNISHING_LIMITS.landmarkQuads);
});

test('renders finite bounded merged geometry without DOM, textures, or scene meshes', () => {
  const out = furnishInterior(plan(), shell);
  const calls = [];
  addFurnishingGeometry({}, {...shell,plan:out}, 12, {quad: (...args) => calls.push(args)});
  assert.ok(calls.length > 12 && calls.length <= FURNISHING_LIMITS.quads);
  for (const call of calls) {
    for (const vertex of call.slice(1,5)) for (const v of vertex) assert.ok(Number.isFinite(v));
    assert.equal(call.at(-1), 12);
    assert.equal(call.at(-2), null);
  }
});

test('every furniture recipe emits bounded geometry and upper stair endpoint excludes its room', () => {
  for (const kind of KIT_KINDS) {
    const p=plan();
    p.levels=[{...level,rooms:[{...room,kind}]}];
    const out=furnishInterior(p,shell);
    assert.ok(out.furniture.length > 0, kind);
    const calls=[];
    addFurnishingGeometry({}, {...shell,plan:out},12,{quad:(...args)=>calls.push(args)});
    assert.ok(calls.length > 0 && calls.length <= FURNISHING_LIMITS.quads,kind);
  }
  const p=plan();
  p.levels=[{...level,i:1,y:5,ceil:8}];
  p.stairs=[{level:0,room0:10,room1:0,x0:6,z0:5,x1:6,z1:7}];
  assert.equal(furnishInterior(p,shell).furniture.length,0);
  p.stairs=[{level:1,room0:10,room1:11,x0:6,z0:5,x1:6,z1:7}];
  assert.equal(furnishInterior(p,shell).furniture.length,0);
});

test('tiny rooms skip furniture, labels are plain bounded characters, and plaques need a lintel', () => {
  const p=plan();
  p.levels=[{...level,rooms:[{...room,a1:1,b1:1,label:'<script>é</script> & A very long room name'}]}];
  const out=furnishInterior(p,shell);
  assert.equal(out.furniture.length,0);
  assert.ok(out.signs[0].text.length <= 18);
  assert.match(out.signs[0].text,/^[A-Z0-9 &-]+$/);
  p.levels=[{...level,ceil:4.3}];
  assert.equal(furnishInterior(p,shell).signs.length,0);
  p.levels=[{...level,doors:[{...level.doors[0],open:true}]}];
  assert.equal(furnishInterior(p,shell).signs.length,0);
  assert.doesNotThrow(()=>addFurnishingGeometry({}, {},12,{quad:()=>assert.fail()}));
});

test('exterior doors keep a deep clear mouth on the ground floor for every room it reaches', () => {
  // Exterior door on the a = 0 wall (outward normal -a), shell wall 0.4 m thick.
  const ext = { x: 0, z: 10, nx: -1, nz: 0, u0: 0, u1: 1.8, e: 3, f0: 0.4, f1: 0.5, main: true };
  for (const kind of ['sales', 'office', 'kitchen', 'library', 'storage', 'living']) {
    const p = bigPlan(kind);
    // a second, unrelated room id so the door has no roomA/roomB tie to the furnished room
    p.levels = [{ ...p.levels[0], doors: [] }];
    const out = furnishInterior(p, { ...bigShell, t: 0.4, doors: [ext] });
    for (const f of out.furniture) {
      if (flat(f) || mounted(f)) continue;
      // depth 0.4 + 1.9 = 2.3 m inside, half width 0.9 + 0.8 = 1.7 m around z = 10
      assert.ok(f.a0 >= 2.3 || f.b1 <= 8.3 || f.b0 >= 11.7, kind + ': ' + f.kind + ' blocks the exterior door mouth');
    }
  }
});

test('colliders stay inside their footprints on a rotated building frame', () => {
  // frame rotated 90 degrees: world = (20 - b, a); a in [0, 30], b in [0, 20]
  const frame = { ox: 20, oz: 0, ux: 0, uz: 1, vx: -1, vz: 0, L: 30, W: 20 };
  const W = (a, b) => [20 - b, a];
  const [cx, cz] = W(15, 10);
  const [dx, dz] = W(0, 10);
  const inner = [...W(0, 0), ...W(30, 0), ...W(30, 20), ...W(0, 20)];
  const shellR = { floor: 0, inner, doors: [] };
  for (const kind of ['kitchen', 'sales', 'courtroom', 'library']) {
    const r = { id: 0, kind, label: kind, a0: 0, b0: 0, a1: 30, b1: 20, cx, cz, area: 600 };
    const L = { i: 0, y: 0, ceil: 4, rooms: [r], holes: [], doors: [{ x: dx, z: dz, nx: 0, nz: 1, w: 1.8, roomA: 0, roomB: -1 }] };
    const p = { id: 78, hash: 9, recipe: 'hall', frame, levels: [L], stairs: [], lootSpots: [{ x: cx, y: 0, z: cz, level: 0, room: 0 }], furniture: [], signs: [], doorH: 2.2 };
    const out = furnishInterior(p, shellR);
    const solid = out.furniture.filter((f) => f.solid && f.level === 0);
    assert.ok(solid.length > 0, kind);
    assert.equal(out.levels[0].props.length, solid.length * 7);
    solid.forEach((f, i) => {
      const P = out.levels[0].props;
      for (const [x, z] of [[P[i * 7], P[i * 7 + 1]], [P[i * 7 + 2], P[i * 7 + 3]]]) {
        const [a, b] = toLocal(frame, x, z);
        assert.ok(a >= f.a0 - 1e-3 && a <= f.a1 + 1e-3 && b >= f.b0 - 1e-3 && b <= f.b1 + 1e-3, `${kind} capsule ${i} outside its footprint`);
      }
    });
  }
});

// ------------------------------------------------------------------ gallery hang (addendum v2)
const ART = new Set(['painting', 'painting_large']);
const FRAMES = new Set([0x74553b, 0xb08a3e, 0x2e2838]);
const STYLES = new Set(['landscape', 'portrait', 'abstract', 'still_life']);
/** 30 x 20 gallery, ceiling 4 m: exterior door on b0 at a = 15 (1.8 m), interior door on a1 at b = 10 (1.6 m). */
function hangPlan() {
  const p = bigPlan('gallery');
  p.levels = [{ ...p.levels[0], doors: [...p.levels[0].doors, { x: 30, z: 10, nx: 1, nz: 0, w: 1.6, roomA: 0, roomB: 1 }] }];
  return p;
}
const HANG = { 77: [
  { room: 'gallery', place: 'reserve', spine: 3, kit: false },
  { room: 'gallery', place: 'hang', kind: 'mixed' },
  { room: 'gallery', place: 'at', kind: 'plinth', fa: 0.5, fb: 0.5 }, // dead centre: must be refused by the spine
  { room: 'gallery', place: 'at', kind: 'gallery_bench', fa: 0.25, fb: 0.25, face: 'b-' },
] };
/** Along-wall interval of a wall item and the wall it hangs on. */
const along = (p) => (p.face[0] === 'a' ? [p.b0, p.b1] : [p.a0, p.a1]);
const wallOf = (p) => ({ 'a+': 'a0', 'a-': 'a1', 'b+': 'b0', 'b-': 'b1' })[p.face];

test('hang: evenly spaced works centred at 1.48 m with label cards, clear of corners and doorways', () => {
  const out = furnishWith(hangPlan(), bigShell, HANG);
  const works = out.furniture.filter((p) => ART.has(p.kind));
  const labels = out.furniture.filter((p) => p.kind === 'wall_label');
  assert.ok(works.length >= 20, `only ${works.length} works hung`);
  assert.equal(labels.length, works.length, 'one label per work');
  assert.ok(works.some((p) => p.kind === 'painting_large') && works.some((p) => p.kind === 'painting'), 'mixed sizes');
  const doors = { b0: [[14.1, 15.9]], a1: [[9.2, 10.8]], a0: [], b1: [] };
  const span = { a0: 20, a1: 20, b0: 30, b1: 30 };
  const Q = 1 / 64 + 1e-9;
  for (const p of works) {
    const centre = p.lift + p.height / 2;
    if (p.lift > 0.6 + Q) assert.ok(Math.abs(centre - 1.48) <= Q, `${p.kind} centre ${centre}`);
    else assert.ok(p.lift >= 0.6 - Q && centre >= 1.48 - Q, `${p.kind} lift clamp`);
    assert.ok(p.lift + p.height <= 4 - 0.3 + Q, 'below the ceiling margin');
    assert.ok(Number.isInteger(p.art) && p.art >= 0 && p.art <= 0xffffffff, 'art seed');
    assert.ok(STYLES.has(p.artStyle) && FRAMES.has(p.frame), 'style and frame');
    assert.equal(p.tier, 1);
    // its label: same wall and face, 0.18 m off the frame's right edge (viewer's right)
    const right = { 'a+': -1, 'a-': 1, 'b+': 1, 'b-': -1 }[p.face];
    const [s0, s1] = along(p);
    const l = labels.find((x) => x.face === p.face && Math.abs((right > 0 ? along(x)[0] - s1 : s0 - along(x)[1]) - 0.18) <= 2 * Q);
    assert.ok(l, `${p.kind} at ${s0}..${s1} has an adjacent label`);
    assert.equal(l.tier, 2);
    assert.ok(Math.abs(l.lift - 1.15) <= Q && Math.abs(l.height - 0.16) <= Q, 'label height');
    // the work + label unit stays 0.4 m from the corners and from every doorway edge on its wall
    const lo = Math.min(s0, along(l)[0]), hi = Math.max(s1, along(l)[1]), side = wallOf(p);
    assert.ok(lo >= 0.4 - Q && hi <= span[side] - 0.4 + Q, `${p.kind} too close to a corner`);
    for (const [d0, d1] of doors[side]) assert.ok(hi <= d0 - 0.4 + Q || lo >= d1 + 0.4 + Q, `${p.kind} too close to a doorway on ${side}`);
  }
  // b1 has no doorway: run [0.4, 29.6], n = floor(29.2 / 3.6) = 8 works at the interval midpoints.
  const b1 = works.filter((p) => p.face === 'b-').map((p) => (p.a0 + p.a1) / 2).sort((x, y) => x - y);
  assert.equal(b1.length, 8);
  b1.forEach((c, i) => assert.ok(Math.abs(c - (0.4 + 3.65 * (i + 0.5))) <= Q, `b1 work ${i} at ${c}`));
  // 'mixed': every third work (indices 2, 5, ...) is large when the 3.65 m interval has room for it
  const b1Kinds = works.filter((p) => p.face === 'b-').sort((x, y) => x.a0 - y.a0).map((p) => p.kind);
  b1Kinds.forEach((k, i) => assert.equal(k, i % 3 === 2 ? 'painting_large' : 'painting', `b1 work ${i}`));
  // b0 is split by the 1.8 m doorway into two runs of equal length with the same count each
  const b0 = works.filter((p) => p.face === 'b+');
  assert.equal(b0.filter((p) => p.a1 < 15).length, b0.filter((p) => p.a0 > 15).length);
  // spine: no floor item in the central 3 m band along the long (a) axis; the centre plinth was refused
  for (const p of out.furniture) if (!ART.has(p.kind) && !CATALOG[p.kind].mount && !flat(p)) assert.ok(p.b1 <= 8.5 + Q || p.b0 >= 11.5 - Q, `${p.kind} in the spine`);
  assert.ok(!out.furniture.some((p) => p.kind === 'plinth'), 'spine refuses the centre plinth');
  assert.ok(out.furniture.some((p) => p.kind === 'gallery_bench'), 'bench off the spine');
  // kit skipped: every painting carries the hang fields
  for (const p of works) assert.ok(p.art !== undefined, 'no unlabelled kit art');
  assert.deepEqual(out, furnishWith(hangPlan(), bigShell, HANG), 'deterministic');
  assert.notEqual(out.hash, furnishWith(hangPlan(), bigShell, { 77: [{ ...HANG[77][1], styles: ['abstract'] }] }).hash);
});

test('hang options: painting-only, sides, spacing, no labels; bad input is tolerated', () => {
  const only = furnishWith(hangPlan(), bigShell, { 77: [{ room: 'gallery', place: 'reserve', kit: false },
    { room: 'gallery', place: 'hang', kind: 'painting', sides: ['b1'], spacing: 6, label: false, styles: ['abstract', 'nope'] }] });
  const works = only.furniture.filter((p) => ART.has(p.kind));
  assert.equal(works.length, Math.floor(29.2 / 6));
  assert.ok(works.every((p) => p.kind === 'painting' && p.face === 'b-' && p.artStyle !== undefined));
  // only the allowed style (portrait-shaped canvases may fall back to 'portrait' only when it is allowed)
  assert.ok(works.every((p) => p.artStyle === 'abstract'));
  assert.ok(!only.furniture.some((p) => p.kind === 'wall_label'));
  assert.doesNotThrow(() => furnishWith(hangPlan(), bigShell, { 77: [{ room: 'gallery', place: 'hang', kind: 'statue', spacing: -3, clear: 1e9, centre: NaN, sides: 'x', styles: 5, max: -1 },
    { room: 'gallery', place: 'reserve', spine: Infinity, kit: 'maybe' }] }));
  // A hung room keeps out the kit's unlabelled wall art even when the kit runs.
  const withKit = furnishWith(hangPlan(), bigShell, { 77: [{ room: 'gallery', place: 'hang' }] });
  assert.ok(withKit.furniture.filter((p) => ART.has(p.kind)).every((p) => p.art !== undefined));
  assert.ok(withKit.furniture.some((p) => p.kind === 'plinth'), 'the kit still fills the floor');
});

test('art-free pause: a reserve without hang gets no wall art at all', () => {
  const out = furnishWith(hangPlan(), bigShell, { 77: [{ room: 'gallery', place: 'reserve', kit: false },
    { room: 'gallery', place: 'walls', kind: 'gallery_bench', sides: ['a0'], gap: 4, max: 4 }] });
  assert.ok(out.furniture.some((p) => p.kind === 'gallery_bench'));
  assert.ok(!out.furniture.some((p) => ART.has(p.kind) || p.kind === 'wall_label'));
});

test('Crystal Bridges on the real map: hung galleries with labels, clear spines, art-free bridge, within budget', () => {
  const data = JSON.parse(fs.readFileSync(new URL('../public/data/bentonville-osm.json', import.meta.url), 'utf8'));
  const w = new World(data);
  w.addBuilding(data.buildings.find((b) => b.id === 8240824));
  w.finishBuildings();
  const plan = w.buildingInteriors().map((b) => b.collider.shell.plan).find((p) => p && p.id === 8240824);
  assert.ok(plan, 'Crystal Bridges interior');
  assert.ok(totalQuads(plan) <= FURNISHING_LIMITS.landmarkQuads);
  const GALLERIES = ['Early 20th Century Art', '19th Century Art', 'Early American Art', 'Modern Art', 'Contemporary Art', 'Temporary Exhibitions'];
  let galleries = 0;
  for (const L of plan.levels) for (const r of L.rooms) {
    if (r.kind !== 'gallery') continue;
    galleries++;
    const mine = plan.furniture.filter((p) => p.level === L.i && p.room === r.id);
    const works = mine.filter((p) => ART.has(p.kind));
    if (GALLERIES.includes(r.label)) {
      assert.ok(works.length >= 15, `${r.label}: ${works.length} hung works`);
      assert.equal(mine.filter((p) => p.kind === 'wall_label').length, works.length, `${r.label}: labels`);
      assert.ok(works.every((p) => p.art !== undefined), `${r.label}: only hung (labelled) works`);
    }
    if (/^Bridge Gallery/.test(r.label)) assert.equal(works.length, 0, `${r.label} is an art-free pause`);
    // a >= 3 m clear spine along the room's long axis: no non-flat floor prop in the central band
    const longA = r.a1 - r.a0 >= r.b1 - r.b0, c = longA ? (r.b0 + r.b1) / 2 : (r.a0 + r.a1) / 2;
    for (const p of mine) {
      if (CATALOG[p.kind].mount || flat(p)) continue;
      const [lo, hi] = longA ? [p.b0, p.b1] : [p.a0, p.a1];
      assert.ok(hi <= c - 1.5 + 1e-6 || lo >= c + 1.5 - 1e-6, `${r.label}: ${p.kind} in the spine`);
    }
  }
  assert.equal(galleries, 9, 'six galleries plus the bridge gallery on three levels');
});
