// Interior prop / light / partition rendering (src/world/InteriorFurnishings.js, InteriorMeshes.js).
// Pure node: a mock quad() records geometry; no DOM, textures or scene objects.
import test from 'node:test';
import assert from 'node:assert/strict';
import { addFurnishingGeometry, addLightGeometry, VISUAL_TOP, RENDERED_KINDS, ART_STYLES } from '../src/world/InteriorFurnishings.js';
import { addInteriorGeometry } from '../src/world/InteriorMeshes.js';
import { World } from '../src/world/World.js';

// Catalog from the interior contract: kind -> [w, d, h, lift]. "sized" kinds use a room-ish size.
const CATALOG = {
  bed:[1.6,2.1,0.55], nightstand:[0.5,0.45,0.55], dresser:[1.2,0.5,0.95], wardrobe:[1.2,0.6,2.0],
  sofa:[2.0,0.85,0.8], armchair:[0.85,0.85,0.8], coffee_table:[1.1,0.6,0.42], tv_stand:[1.6,0.45,0.55],
  rug:[3.0,2.0,0.02], dining_table:[1.8,0.95,0.75], chair:[0.45,0.45,0.9], stool:[0.4,0.4,0.75],
  counter:[1.8,0.65,0.92], fridge:[0.8,0.75,1.85], stove:[0.75,0.65,0.92], kitchen_island:[2.0,1.0,0.92],
  toilet:[0.45,0.7,0.75], sink:[0.7,0.5,0.85], bathtub:[1.7,0.75,0.55], toilet_stall:[1.0,1.5,1.9],
  shelf:[1.6,0.6,1.6], checkout:[2.0,0.8,1.0], crate:[0.9,0.9,0.9], pallet_rack:[2.4,1.0,2.4],
  desk:[1.4,0.7,0.75], office_chair:[0.55,0.55,0.95], filing_cabinet:[0.5,0.6,1.3], bookcase:[1.2,0.4,2.1],
  plant:[0.5,0.5,1.2], bench:[1.6,0.5,0.45], reception_desk:[2.6,0.9,1.1], safe:[0.9,0.8,1.4],
  workbench:[1.8,0.7,0.9], car:[4.2,1.8,1.4], planter:[1.4,0.7,0.75], plinth:[0.8,0.8,1.0],
  display_case:[1.4,0.7,1.1], school_desk:[0.7,0.55,0.75], teacher_desk:[1.5,0.75,0.75], locker_bank:[2.4,0.5,1.9],
  seat_row:[4.0,0.8,0.9], stage:[8.0,4.0,0.9], bleachers:[6.0,2.4,1.6], hoop:[1.8,1.2,3.0],
  court_lines:[28.0,15.0,0.01], long_table:[3.0,0.9,0.75], serving_line:[3.0,0.8,1.0], pew:[3.0,0.6,0.9],
  judge_bench:[3.0,1.0,1.3], witness_stand:[1.2,1.0,1.1], jury_box:[3.6,1.6,1.0], railing:[3.0,0.1,0.9],
  bar_counter:[3.0,0.7,1.05], high_top:[0.7,0.7,1.05], cafe_table:[0.75,0.75,0.75], tank:[1.6,1.6,2.8],
  food_stall:[3.0,2.0,2.4], record_bin:[1.4,0.7,0.9], easel:[0.7,0.6,1.6], banquet_table:[1.6,1.6,0.75],
  podium:[0.6,0.5,1.15], installation:[4.0,3.0,2.5], gallery_bench:[1.8,0.6,0.45],
  painting:[1.2,0.05,0.9,1.3], painting_large:[3.0,0.06,2.0,1.1], whiteboard:[2.4,0.05,1.1,0.9],
  tv:[1.4,0.06,0.8,1.2], menu_board:[2.0,0.06,0.9,1.9], mirror:[0.6,0.04,0.8,1.1],
  cabinet_upper:[1.6,0.35,0.7,1.45], tap_board:[2.0,0.08,0.6,1.3], wall_label:[0.24,0.02,0.16,1.15],
};
const TINY = new Set(['wall_label']); // <= 4 quads
const SMALL = new Set(['chair','stool','plant','painting','mirror','cafe_table','rug','court_lines','tv','office_chair','school_desk','high_top','easel','podium']);
const FACES = ['a+','a-','b+','b-'];
const EPS = 1e-6;
const FLOOR = 2; // shell.floor
const frame = { ox: 10, oz: -4, ux: 0.8, uz: 0.6, vx: -0.6, vz: 0.8 }; // rotated frame

/** Inverse of layout.toWorld for the rotated test frame. */
const toLocal = (x, z) => { const dx = x - frame.ox, dz = z - frame.oz; return [dx*frame.ux + dz*frame.uz, dx*frame.vx + dz*frame.vz]; };

function makeProp(kind, face, extra = {}) {
  const [w, d, h, lift = 0] = CATALOG[kind];
  const along = face[0] === 'b';
  const sa = along ? w : d, sb = along ? d : w;
  return { kind, level: 0, room: 0, a0: 3, b0: 4, a1: 3 + sa, b1: 4 + sb, y: 5, lift, height: h, face, color: 0xa0784c, accent: 0xf2b33d, solid: true, block: true, tier: 0, ...extra };
}

function render(props, api = {}) {
  const calls = [];
  const plan = { frame, furniture: props, signs: [], levels: [{ i: 0, y: 5, rooms: [] }] };
  addFurnishingGeometry({}, { floor: FLOOR, plan }, 12, { quad: (...a) => calls.push(a), ...api });
  return calls;
}

function checkBounds(calls, p) {
  const lift = p.lift || 0;
  const top = Math.max(p.height, VISUAL_TOP[p.kind] || 0);
  const lo = p.y - FLOOR + lift, hi = p.y - FLOOR + 0.06 + lift + top;
  for (const c of calls) {
    for (const v of c.slice(1, 5)) {
      for (const k of v) assert.ok(Number.isFinite(k), `${p.kind} ${p.face} finite`);
      const [a, b] = toLocal(v[0], v[2]);
      assert.ok(a >= p.a0 - 1e-4 && a <= p.a1 + 1e-4 && b >= p.b0 - 1e-4 && b <= p.b1 + 1e-4, `${p.kind} ${p.face} vertex inside footprint (${a.toFixed(3)}, ${b.toFixed(3)})`);
      assert.ok(v[1] >= lo - EPS && v[1] <= hi + 1e-4, `${p.kind} ${p.face} y ${v[1]} within [${lo}, ${hi}]`);
    }
    for (const k of c.slice(5, 8)) assert.ok(Number.isFinite(k));
    assert.ok(Math.abs(Math.hypot(c[5], c[6], c[7]) - 1) < 1e-6, `${p.kind} unit normal`);
    for (const k of c.slice(8, 11)) assert.ok(k >= 0 && k <= 1, `${p.kind} colour channel in range`);
    assert.equal(c[11], null);
    assert.equal(c[12], 12);
  }
}

const measured = {};
test('every catalog kind renders bounded, finite geometry within its cost ceiling for every face', () => {
  for (const kind of Object.keys(CATALOG)) {
    for (const face of FACES) {
      const p = makeProp(kind, face);
      const calls = render([p]);
      assert.ok(calls.length > 0, `${kind} draws something`);
      checkBounds(calls, p);
      const cap = TINY.has(kind) ? 4 : SMALL.has(kind) ? 14 : 60;
      assert.ok(calls.length <= cap, `${kind} ${face}: ${calls.length} quads > ${cap}`);
      measured[kind] = Math.max(measured[kind] || 0, calls.length);
    }
    assert.ok(RENDERED_KINDS.includes(kind), `${kind} has a dedicated shape`);
  }
});

test('face changes orientation but not cost; output is deterministic', () => {
  for (const kind of ['bed','sofa','car','painting','shelf']) {
    const counts = FACES.map((f) => render([makeProp(kind, f)]).length);
    assert.ok(counts.every((n) => n === counts[0]), `${kind} same cost on every face`);
    assert.deepEqual(render([makeProp(kind, 'a+')]), render([makeProp(kind, 'a+')]));
  }
});

test('old-schema props (no face / lift / accent / height) and unknown kinds still render', () => {
  const legacy = [
    { kind: 'bed', a0: 1, b0: 1, a1: 2.5, b1: 3, y: 5, height: 0.55, color: 0x7a91a5 },
    { kind: 'table', a0: 1, b0: 1, a1: 2.6, b1: 1.9, y: 5, height: 0.75, color: 0x997449 },
    { kind: 'display', a0: 1, b0: 1, a1: 1.75, b1: 1.75, y: 5, height: 1, color: 0xd4c7b0 },
    { kind: 'mystery_kind', a0: 1, b0: 1, a1: 2, b1: 2, y: 5, height: 0.8, color: 0x123456 },
    { kind: 'sofa', a0: 1, b0: 1, a1: 3, b1: 1.8, y: 5 },
  ];
  for (const p of legacy) {
    const calls = render([p]);
    assert.ok(calls.length > 0, p.kind);
    for (const c of calls) for (const v of c.slice(1, 5)) for (const k of v) assert.ok(Number.isFinite(k));
  }
  assert.ok(render([legacy[3]]).length <= 6, 'unknown kind is a simple box (+ shadow)');
  assert.doesNotThrow(() => render([null, { kind: 'bed', a0: 2, b0: 2, a1: 1, b1: 1, y: 5 }]));
  assert.equal(render([{ kind: 'bed', a0: 2, b0: 2, a1: 1, b1: 1, y: 5 }]).length, 0, 'inverted footprint skipped');
});

test('contact shadows use the floor colour and sit on the floor; wall items get none', () => {
  const asked = [];
  const floorAt = (level, a, b) => { asked.push([level, a, b]); return 0x808080; };
  const floorCalls = render([makeProp('desk', 'b+')], { floorAt });
  assert.equal(asked.length, 1);
  const shadow = floorCalls[0];
  assert.equal(shadow[6], 1, 'shadow faces up');
  assert.ok(Math.abs(shadow[1][1] - (5 - FLOOR + 0.059)) < 1e-9);
  asked.length = 0;
  render([makeProp('painting', 'b+')], { floorAt });
  assert.equal(asked.length, 0);
});

test('light panels render <= 3 quads: a down-wound bright panel lit with an up normal, and a floor pool', () => {
  const plan = { frame, levels: [{ i: 0, y: 5, rooms: [] }, { i: 1, y: 8.5, rooms: [] }],
    lights: [{ level: 0, a0: 2, b0: 2, a1: 3.2, b1: 2.6, y: 8 }, { level: 1, a0: 4, b0: 4, a1: 5, b1: 5, y: 11.5 }, { level: 7, a0: 1, b0: 1, a1: 2, b1: 2, y: 4 }, { level: 0, a0: 2, b0: 2, a1: 1, b1: 1, y: 8 }] };
  const calls = [];
  addLightGeometry({}, { floor: FLOOR, plan }, 12, { quad: (...a) => calls.push(a), floorAt: () => 0x9b7a55 });
  assert.equal(calls.length, 3 + 3 + 2, 'two full lights, one with no level (no pool), inverted skipped');
  const [rim, panel, pool] = calls;
  assert.deepEqual(rim.slice(5, 8), [0, -1, 0]);
  assert.deepEqual(panel.slice(5, 8), [0, -1, 0], 'wound to face down');
  assert.deepEqual(panel[13], [0, 1, 0], 'lit as if facing up');
  assert.ok(panel[1][1] < 8 - FLOOR && panel[1][1] > 8 - FLOOR - 0.1, 'just below the ceiling');
  assert.ok(panel[8] > 0.9 && panel[9] > 0.8 && panel[10] > 0.6, 'panel is bright warm white');
  assert.deepEqual(pool.slice(5, 8), [0, 1, 0]);
  assert.ok(Math.abs(pool[1][1] - (5 - FLOOR + 0.056)) < 1e-9, 'pool just above the 0.05 room floor overlay');
  for (const c of calls) for (const v of c.slice(1, 5)) for (const k of v) assert.ok(Number.isFinite(k));
  assert.doesNotThrow(() => addLightGeometry({}, { floor: 0, plan: { frame } }, 1, { quad: () => assert.fail() }));
});

test('partition panels keep contiguous, non-overlapping index ranges that include the baked shading quads', () => {
  const data = { meta: { bounds: { minX: -50, maxX: 50, minZ: -50, maxZ: 50 } }, buildings: [], roads: [], areas: [], pois: [] };
  const w = new World(data);
  w.addBuilding({ id: 123456, t: 'apartments', mat: 'brick', lv: 3, h: 11, p: [[0,0],[25,0],[25,20],[0,20]] });
  w.finishBuildings();
  const shell = w.buildingInteriors()[0].collider.shell;
  const chunk = { buf: { idx: [], n: 0 }, wall: [], bh: [], panelRanges: [] };
  const quadsAt = new Map(); // index offset -> quad args
  const quad = (ch, a, b, c, d, nx, ny, nz, ...rest) => {
    const i0 = ch.buf.n; ch.buf.n += 4;
    quadsAt.set(ch.buf.idx.length, [a, b, c, d, nx, ny, nz, ...rest]);
    ch.buf.idx.push(i0, i0 + 1, i0 + 2, i0, i0 + 2, i0 + 3);
  };
  const hcapFlat = (ch, pts) => { const n = pts.length / 2, i0 = ch.buf.n; ch.buf.n += n; for (let k = 1; k + 1 < n; k++) ch.buf.idx.push(i0, i0 + k, i0 + k + 1); };
  addInteriorGeometry(chunk, shell, 11, { quad, hcapFlat });
  const R = chunk.panelRanges;
  assert.ok(R.length >= 3, 'building has breakable panels');
  const spans = [];
  assert.ok(R.some((p, i) => i % 3 === 0 && p.kind === 'roof'), 'top storey ceiling carries breakable roof tile ranges');
  for (let i = 0; i < R.length; i += 3) {
    const start = R[i + 1], count = R[i + 2];
    assert.ok(count > 0 && count % 6 === 0 && start % 3 === 0, 'whole quads');
    if (R[i].kind !== 'inner') continue; // roof tiles (shellPanels.js) carry their own ceiling quads
    const quads = count / 6;
    assert.ok(quads >= 7 && quads <= 8, `faces + caps + skirting (+ top bands): ${quads}`);
    // every quad in the range is a recorded quad and lies along one wall (all vertical)
    for (let k = start; k < start + count; k += 6) {
      const q = quadsAt.get(k);
      assert.ok(q, 'range starts on quad boundaries');
      assert.equal(q[5], 0, 'partition quads are vertical');
    }
    spans.push([start, start + count]);
  }
  spans.sort((x, y) => x[0] - y[0]);
  for (let i = 1; i < spans.length; i++) assert.ok(spans[i][0] >= spans[i - 1][1], 'ranges do not overlap');
  assert.ok(spans.at(-1)[1] <= chunk.buf.idx.length);
  // the furnished plan's props and lights are drawn after the partitions (outside every range)
});

// ---- original procedural artworks (contract addendum v2: art / artStyle / frame)
const HANG_SIZES = { painting: [[0.9,0.7],[1.2,0.9],[0.8,1.1],[1.5,1.1]], painting_large: [[2.4,1.6],[3.0,2.0]] };
const SEEDS = [1, 7, 42, 0x9e3779b9, 123456789, 0xffffffff];
function artProp(kind, face, [w, h], extra) {
  const d = CATALOG[kind][1];
  const along = face[0] === 'b';
  const sa = along ? w : d, sb = along ? d : w;
  return { kind, level: 0, room: 0, a0: 3, b0: 4, a1: 3 + sa, b1: 4 + sb, y: 5, lift: 1.48 - h / 2, height: h, face, color: 0xa0784c, solid: false, block: false, tier: 1, ...extra };
}
const artCost = {};
test('every artStyle renders bounded, deterministic, seed-dependent compositions within the cost ceilings', () => {
  for (const kind of ['painting', 'painting_large']) {
    const cap = kind === 'painting' ? 14 : 60;
    for (const artStyle of ART_STYLES) {
      for (const size of HANG_SIZES[kind]) {
        const outs = new Set();
        for (const art of SEEDS) {
          for (const face of FACES) {
            const p = artProp(kind, face, size, { art, artStyle, frame: 0x74553b });
            const calls = render([p]);
            checkBounds(calls, p);
            assert.ok(calls.length >= 8 && calls.length <= cap, `${kind} ${artStyle} ${size} seed ${art}: ${calls.length} quads (cap ${cap})`);
            artCost[`${kind}/${artStyle}`] = Math.max(artCost[`${kind}/${artStyle}`] || 0, calls.length);
            assert.deepEqual(render([artProp(kind, face, size, { art, artStyle })]), render([artProp(kind, face, size, { art, artStyle })]), 'deterministic');
          }
          outs.add(JSON.stringify(render([artProp(kind, 'b+', size, { art, artStyle })])));
        }
        assert.ok(outs.size >= SEEDS.length - 1, `${kind} ${artStyle} ${size}: seeds give different compositions (${outs.size}/${SEEDS.length})`);
      }
    }
  }
  console.log('artwork quad cost (max): ' + Object.entries(artCost).map(([k, n]) => `${k}:${n}`).join(' '));
});

test('artwork composition depends only on art/artStyle/frame, not on where the work hangs', () => {
  const at = (shift, extra) => {
    const p = artProp('painting_large', 'b+', [2.4, 1.6], { art: 99, artStyle: 'landscape', ...extra });
    p.a0 += shift; p.a1 += shift;
    return render([p]).map((c) => c.slice(8, 11));
  };
  assert.deepEqual(at(0), at(5), 'same colours at another position');
  assert.notDeepEqual(at(0), at(0, { frame: 0x2b2b2b }), 'frame colour is used');
  assert.notDeepEqual(at(0), at(0, { artStyle: 'abstract' }), 'style changes the composition');
  // art seed alone (no artStyle) picks a style deterministically; unknown styles fall back to the seed
  assert.deepEqual(render([artProp('painting', 'a+', [1.2, 0.9], { art: 5 })]), render([artProp('painting', 'a+', [1.2, 0.9], { art: 5, artStyle: 'bogus' })]));
});

test('old paintings without art fields render exactly as before (legacy path)', () => {
  for (const kind of ['painting', 'painting_large']) {
    const legacy = render([makeProp(kind, 'b+')]);
    assert.deepEqual(render([makeProp(kind, 'b+', { art: undefined, artStyle: undefined })]), legacy);
    assert.notDeepEqual(render([makeProp(kind, 'b+', { art: 3, artStyle: 'portrait' })]), legacy);
  }
});

test('wall_label is a cream card with three ink stripes', () => {
  for (const face of FACES) {
    const calls = render([makeProp('wall_label', face)]);
    assert.equal(calls.length, 4);
    const [card, ...lines] = calls;
    assert.ok(card[8] > 0.8 && card[9] > 0.75 && card[10] > 0.6, 'cream card');
    for (const l of lines) assert.ok(l[8] < 0.1 && l[10] < 0.2, 'ink stripe');
  }
});

test('report measured quad cost per kind', () => {
  const rows = Object.entries(measured).map(([k, n]) => `${k}:${n}`);
  console.log('quad cost (max over faces, incl. contact shadow): ' + rows.join(' '));
  assert.ok(rows.length === Object.keys(CATALOG).length);
});
