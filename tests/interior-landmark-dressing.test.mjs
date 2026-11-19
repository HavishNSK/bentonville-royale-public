import test from 'node:test';
import assert from 'node:assert/strict';
import { LANDMARK_DRESSING } from '../src/world/interiors/landmarkDressing.js';
import { LANDMARK_IDS, LANDMARK_RECIPES } from '../src/world/interiors/landmarks.js';
import { CATALOG } from '../src/world/interiors/furnishings.js';

// Catalog kinds from the interior contract (floor + wall).
const KINDS = new Set(Object.keys(CATALOG));
const PLACES = new Set(['grid', 'walls', 'centre', 'at', 'wall_mount', 'hang', 'reserve']);
const HANG_KINDS = new Set(['painting', 'painting_large', 'mixed']);
const ART_STYLES = new Set(['landscape', 'portrait', 'abstract', 'still_life']);
const SIDES = new Set(['a0', 'a1', 'b0', 'b1']);
const FACES = new Set(['a+', 'a-', 'b+', 'b-']);
const ALLOWED = new Set(['room', 'level', 'place', 'kind', 'aisle', 'margin', 'face', 'max', 'w', 'd', 'sides', 'gap', 'fa', 'fb',
  'spacing', 'centre', 'clear', 'label', 'styles', 'spine', 'kit']);
const HANG_ONLY = ['spacing', 'centre', 'clear', 'label', 'styles'];
const RESERVE_ONLY = ['spine', 'kit'];

// Frame sizes / front each recipe was drawn for (see def(id, L, W, front, ...) in landmarks.js).
const FRAMES = {
  8240824: [332.2, 118.1, 'b'], 896842916: [108, 93.4, 'a'], 896842909: [138.8, 63.3, 'b'], 949466253: [100.8, 99.8, 'a'],
  211198877: [28.3, 25.9, 'b'], 949466246: [126.1, 84.1, 'b'], 952075842: [228.2, 137.2, 'b'], 952075843: [111.8, 103, 'b'],
  651787776: [308.9, 200, 'a'], 577226262: [55.2, 47.6, 'b'], 577262580: [24.1, 19.9, 'a'], 896842915: [47.5, 19.9, 'b'],
  1578366349: [36, 15, 'b'], 912573722: [22, 12.5, 'a'], 799259120: [26.5, 21.2, 'b'], 799259121: [26.3, 21.9, 'a'],
};

/** Leaf labels per level for a landmark, from its authored recipe (max 4 levels, no POIs). */
function labelsByLevel(id) {
  const [L, W, front] = FRAMES[id];
  const out = LANDMARK_RECIPES[id]({ L, W, front, side: front === 'a' ? 'b' : 'a', levels: 4, area: L * W, door: { a: 0, b: 0 }, id: Number(id), pois: [] });
  const trees = out.levels || [out];
  return trees.map((t) => {
    const set = new Set();
    const walk = (n) => {
      if (!n) return;
      if (n.leaf) set.add(n.label);
      else {
        walk(n.A);
        walk(n.B);
      }
    };
    walk(t);
    return set;
  });
}

test('all 16 landmarks are dressed and every key is a landmark id', () => {
  const keys = Object.keys(LANDMARK_DRESSING);
  for (const k of keys) assert.ok(LANDMARK_IDS[k], `unknown landmark id ${k}`);
  for (const id of Object.keys(LANDMARK_IDS)) {
    assert.ok(Array.isArray(LANDMARK_DRESSING[id]), `missing dressing for ${id}`);
    assert.ok(LANDMARK_DRESSING[id].length >= 8, `too little dressing for ${id}`);
    assert.ok(FRAMES[id], `test frame table missing ${id}`);
  }
  assert.equal(keys.length, 16);
});

test('directives use catalog kinds, valid places and in-range options', () => {
  const num = (v, lo, hi, what) => assert.ok(Number.isFinite(v) && v >= lo && v <= hi, `${what}=${v}`);
  for (const [id, list] of Object.entries(LANDMARK_DRESSING)) {
    for (const x of list) {
      const tag = `${id} ${x.room} ${x.kind}`;
      assert.equal(typeof x.room, 'string', tag);
      assert.ok(PLACES.has(x.place), `${tag}: place ${x.place}`);
      if (x.place === 'hang') assert.ok(x.kind === undefined || HANG_KINDS.has(x.kind), `${tag}: hang kind`);
      else if (x.place === 'reserve') assert.equal(x.kind, undefined, `${tag}: reserve takes no kind`);
      else assert.ok(KINDS.has(x.kind), `${tag}: kind`);
      if (x.place !== 'hang') for (const k of HANG_ONLY) assert.equal(x[k], undefined, `${tag}: ${k} only for hang`);
      if (x.place !== 'reserve') for (const k of RESERVE_ONLY) assert.equal(x[k], undefined, `${tag}: ${k} only for reserve`);
      if (x.spacing !== undefined) num(x.spacing, 1, 30, `${tag} spacing`);
      if (x.centre !== undefined) num(x.centre, 0.8, 3, `${tag} centre`);
      if (x.clear !== undefined) num(x.clear, 0, 3, `${tag} clear`);
      if (x.spine !== undefined) num(x.spine, 0, 20, `${tag} spine`);
      if (x.label !== undefined) assert.equal(typeof x.label, 'boolean', `${tag}: label`);
      if (x.kit !== undefined) assert.equal(x.kit, false, `${tag}: kit`);
      if (x.styles !== undefined) for (const st of x.styles) assert.ok(ART_STYLES.has(st), `${tag}: style ${st}`);
      for (const k of Object.keys(x)) assert.ok(ALLOWED.has(k), `${tag}: unexpected option ${k}`);
      if (x.level !== undefined) assert.ok(Number.isInteger(x.level) && x.level >= 0 && x.level < 4, `${tag}: level`);
      if (x.place === 'at') {
        num(x.fa, 0, 1, `${tag} fa`);
        num(x.fb, 0, 1, `${tag} fb`);
      } else {
        assert.equal(x.fa, undefined, `${tag}: fa only for at`);
        assert.equal(x.fb, undefined, `${tag}: fb only for at`);
      }
      for (const k of ['w', 'd']) if (x[k] !== undefined) num(x[k], 1e-6, 119.999, `${tag} ${k}`);
      for (const k of ['aisle', 'margin', 'gap']) if (x[k] !== undefined) num(x[k], 0, 119.999, `${tag} ${k}`);
      if (x.max !== undefined) assert.ok(Number.isInteger(x.max) && x.max > 0 && x.max <= 200, `${tag}: max`);
      if (x.face !== undefined) assert.ok(FACES.has(x.face), `${tag}: face`);
      if (x.sides !== undefined) {
        assert.ok(Array.isArray(x.sides) && x.sides.length > 0, `${tag}: sides`);
        for (const s of x.sides) assert.ok(SIDES.has(s), `${tag}: side ${s}`);
      }
    }
  }
});

test('every directive references a room label that exists on its level in landmarks.js', () => {
  for (const [id, list] of Object.entries(LANDMARK_DRESSING)) {
    const levels = labelsByLevel(id);
    for (const x of list) {
      if (x.level !== undefined) assert.ok(levels[x.level]?.has(x.room), `${id}: "${x.room}" not on level ${x.level}`);
      else assert.ok(levels.some((s) => s.has(x.room)), `${id}: "${x.room}" not in recipe`);
    }
  }
});

test('seats and desks face the stage or board in their own room', () => {
  // Convention: `face` = direction the item's front looks, so a seat looking at a stage/board on
  // side s faces toward s (b0 -> 'b-', b1 -> 'b+', a0 -> 'a-', a1 -> 'a+').
  const TOWARD = { a0: 'a-', a1: 'a+', b0: 'b-', b1: 'b+' };
  const SEATS = new Set(['seat_row', 'school_desk', 'chair', 'pew']);
  let checked = 0;
  for (const [id, list] of Object.entries(LANDMARK_DRESSING)) {
    const focus = new Map();
    for (const x of list) {
      const key = x.room + '@' + (x.level ?? '*');
      if (x.kind === 'whiteboard' && x.place === 'wall_mount' && x.sides?.length === 1 && !focus.has(key)) focus.set(key, x.sides[0]);
      if ((x.kind === 'stage' || x.kind === 'judge_bench') && x.place === 'at') {
        const off = [['a0', x.fa], ['a1', 1 - x.fa], ['b0', x.fb], ['b1', 1 - x.fb]].sort((p, q) => p[1] - q[1])[0];
        focus.set(key, off[0]);
      }
    }
    for (const x of list) {
      const side = focus.get(x.room + '@' + (x.level ?? '*'));
      if (!side || !SEATS.has(x.kind) || x.place !== 'grid' && x.kind !== 'pew') continue;
      assert.equal(x.face, TOWARD[side], `${id} ${x.room} ${x.kind} should face ${side}`);
      checked++;
    }
  }
  assert.ok(checked > 100, `only ${checked} seat directives checked`);
});

test('dressing is plain deterministic data', () => {
  const a = JSON.stringify(LANDMARK_DRESSING);
  assert.equal(a, JSON.stringify(JSON.parse(a)));
  for (const list of Object.values(LANDMARK_DRESSING)) for (const x of list) for (const v of Object.values(x)) assert.notEqual(typeof v, 'function');
});

test('Crystal Bridges galleries follow the AskRosie tour language: hung works, clear spine, art-free bridge', () => {
  const list = LANDMARK_DRESSING[8240824];
  const GALLERIES = ['Early 20th Century Art', '19th Century Art', 'Early American Art', 'Modern Art', 'Contemporary Art', 'Temporary Exhibitions'];
  for (const room of GALLERIES) {
    const mine = list.filter((x) => x.room === room);
    assert.ok(mine.some((x) => x.place === 'hang' && (x.kind ?? 'mixed') === 'mixed' && x.label !== false), `${room} is hung`);
    const res = mine.find((x) => x.place === 'reserve');
    assert.ok(res && (res.spine ?? 3) >= 3, `${room} keeps a >= 3 m spine`);
    assert.ok(mine.filter((x) => x.kind === 'gallery_bench').length >= 2, `${room} has benches`);
    assert.ok(mine.filter((x) => x.kind === 'plinth' || x.kind === 'installation').length <= 4, `${room}: at most a few plinths`);
    assert.ok(!mine.some((x) => x.place === 'grid'), `${room}: no plinth grids`);
  }
  for (const room of ['Bridge Gallery', 'Bridge Gallery Upper']) {
    const mine = list.filter((x) => x.room === room);
    assert.ok(mine.some((x) => x.place === 'reserve' && x.kit === false), `${room} skips the kit`);
    for (const x of mine) assert.ok(x.place !== 'hang' && !/painting/.test(x.kind || ''), `${room} stays art-free`);
  }
});
