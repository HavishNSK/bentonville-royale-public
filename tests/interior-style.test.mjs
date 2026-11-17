// Landmark interior styles (src/world/interiors/landmarkStyle.js) as drawn by InteriorMeshes.js:
// overrides apply only to the styled landmark (Crystal Bridges, 8240824), unstyled buildings render
// identically, and beams / doorway thresholds are bounded and inside their rooms.
import test from 'node:test';
import assert from 'node:assert/strict';
import { LANDMARK_STYLE, styleFor } from '../src/world/interiors/landmarkStyle.js';
import { addInteriorGeometry, lineIntervals, NEUTRAL_LIT } from '../src/world/InteriorMeshes.js';
import { inPoly, toLocal } from '../src/world/interiors/layout.js';
import { FLOOR_THICKNESS } from '../src/world/interiors/storeys.js';
import { World } from '../src/world/World.js';
import * as THREE from 'three';

const CB = 8240824;

function buildShells() {
  const data = { meta: { bounds: { minX: -400, maxX: 400, minZ: -400, maxZ: 400 } }, buildings: [], roads: [], areas: [], pois: [] };
  const w = new World(data);
  w.addBuilding({ id: 123456, t: 'apartments', mat: 'brick', lv: 3, h: 11, p: [[0, 0], [25, 0], [25, 20], [0, 20]] });
  w.addBuilding({ id: 77, t: 'retail', mat: 'brick', lv: 1, h: 6, p: [[40, 0], [80, 0], [80, 30], [40, 30]] });
  w.addBuilding({ id: 896842916, t: 'museum', mat: 'concrete', lv: 2, h: 12, p: [[-300, -300], [-192, -300], [-192, -206.6], [-300, -206.6]] });
  w.addBuilding({ id: CB, t: 'museum', mat: 'concrete', lv: 3, h: 16, p: [[0, 100], [332.2, 100], [332.2, 218.1], [0, 218.1]] });
  w.finishBuildings();
  return new Map(w.buildingInteriors().map((b) => [b.collider.shell.plan.id, b.collider.shell]));
}
const SHELLS = buildShells();

/** Mock WorldMeshes api recording every quad / hcapFlat call (in order) plus the panel ranges. */
function render(shell, styles) {
  const calls = [];
  const chunk = { buf: { idx: [], n: 0 }, wall: [], bh: [], panelRanges: [] };
  const quad = (ch, ...a) => {
    calls.push(['q', ...a]);
    const i0 = ch.buf.n; ch.buf.n += 4;
    ch.buf.idx.push(i0, i0 + 1, i0 + 2, i0, i0 + 2, i0 + 3);
  };
  const hcapFlat = (ch, pts, ...a) => {
    calls.push(['h', [...pts], ...a]);
    const n = pts.length / 2, i0 = ch.buf.n; ch.buf.n += n;
    for (let k = 1; k + 1 < n; k++) ch.buf.idx.push(i0, i0 + k, i0 + k + 1);
  };
  if (styles === undefined) addInteriorGeometry(chunk, shell, 12, { quad, hcapFlat });
  else addInteriorGeometry(chunk, shell, 12, { quad, hcapFlat }, styles);
  return { calls, ranges: chunk.panelRanges };
}

test('styleFor: labels beat kinds, only the styled landmark id matches', () => {
  const gallery = { kind: 'gallery', label: 'Modern Art' };
  assert.equal(styleFor(CB, gallery).floor, 0x806144);
  assert.equal(styleFor(CB, gallery).beams.spacing, 2.4);
  assert.equal(styleFor(CB, { kind: 'lobby', label: 'Main Lobby' }).floor, 0xc5c0b5);
  assert.equal(styleFor(CB, { kind: 'open', label: 'Lobby Balcony' }).trim, 0xb3aa98);
  const bridge = styleFor(CB, { kind: 'gallery', label: 'Bridge Gallery' });
  assert.equal(bridge.floor, 0x806144);
  assert.notEqual(bridge.wall, styleFor(CB, gallery).wall, 'bridge label overrides the gallery kind');
  assert.equal(styleFor(CB, { kind: 'office', label: 'Guest Services' }), null);
  assert.equal(styleFor(123, gallery), null);
  assert.equal(styleFor(CB, null), null);
  assert.equal(styleFor(CB, gallery, {}), null);
  assert.ok(Object.isFrozen(LANDMARK_STYLE));
});

test('unstyled buildings render identically with and without the style table', () => {
  for (const id of [123456, 77, 896842916]) {
    const shell = SHELLS.get(id);
    assert.ok(shell, `building ${id} has a plan`);
    assert.deepEqual(render(shell), render(shell, {}), `building ${id} identical`);
  }
  const cb = SHELLS.get(CB);
  assert.notDeepEqual(render(cb).calls.length, render(cb, {}).calls.length, 'Crystal Bridges is restyled');
});

test('Crystal Bridges: styled floors, skirting trim, and partition panel ranges stay intact', () => {
  const cb = SHELLS.get(CB);
  const { calls, ranges } = render(cb);
  const floors = calls.filter((c) => c[0] === 'h').map((c) => c[3]);
  assert.ok(floors.includes(0x806144), 'gallery wood floor');
  assert.ok(floors.includes(0xc5c0b5), 'limestone floor');
  const hasColour = (hex) => { const c = new THREE.Color().setHex(hex); return calls.some((q) => q[0] === 'q' && q[8] === c.r && q[9] === c.g && q[10] === c.b); };
  assert.ok(hasColour(0x74553b), 'gallery timber skirting trim');
  assert.ok(hasColour(0xb3aa98), 'limestone stone trim');
  assert.ok(hasColour(0x555047), 'doorway threshold');
  // panel ranges are whole quads of vertical partition geometry only (no beams / thresholds)
  const base = render(cb, {}).ranges;
  assert.equal(ranges.length, base.length);
  for (let i = 0; i < ranges.length; i += 3) assert.equal(ranges[i + 2], base[i + 2], 'same per-panel quad count');
});

/** Beam quads: horizontal undersides (lit up) hanging ~depth below a level ceiling. */
test('Crystal Bridges: beams are bounded, under the ceiling and inside beamed rooms', () => {
  const cb = SHELLS.get(CB);
  const plan = cb.plan, F = plan.frame;
  const { calls } = render(cb);
  let beams = 0;
  for (const L of plan.levels) {
    const yB = L.ceil - cb.floor - 0.005 - 0.25;
    const under = calls.filter((c) => c[0] === 'q' && c[6] === -1 && c[13] && Math.abs(c[1][1] - yB) < 1e-6);
    const beamed = L.rooms.filter((r) => styleFor(CB, r)?.beams);
    let cap = 0;
    for (const r of beamed) cap += (Math.round(Math.max(r.a1 - r.a0, r.b1 - r.b0) / 2.4) + 1) * 8;
    assert.ok(under.length > 0 || beamed.length === 0, `level ${L.i} has beams`);
    assert.ok(under.length <= cap, `level ${L.i}: ${under.length} beam pieces <= ${cap}`);
    for (const c of under) {
      const pts = c.slice(1, 5).map((v) => toLocal(F, v[0], v[2]));
      const room = beamed.find((r) => pts.every(([a, b]) => a >= r.a0 - 1e-3 && a <= r.a1 + 1e-3 && b >= r.b0 - 1e-3 && b <= r.b1 + 1e-3));
      assert.ok(room, `beam piece inside a beamed room on level ${L.i}`);
    }
    beams += under.length;
  }
  assert.ok(beams > 100, `beams drawn: ${beams}`);
});

/** A Crystal Bridges shell with a 25 m outdoor notch cut into the Bridge Gallery (like the real concave bridge). */
function notchedShell() {
  const data = { meta: { bounds: { minX: -400, maxX: 400, minZ: -400, maxZ: 400 } }, buildings: [], roads: [], areas: [], pois: [] };
  const w = new World(data);
  w.addBuilding({ id: CB, t: 'museum', mat: 'concrete', lv: 3, h: 16, p: [[0, 100], [290, 100], [290, 170], [315, 170], [315, 100], [332.2, 100], [332.2, 218.1], [0, 218.1]] });
  w.finishBuildings();
  return w.buildingInteriors()[0].collider.shell;
}

test('lineIntervals: inside spans of a concave polygon, clamped', () => {
  const U = [0, 0, 10, 0, 10, 10, 7, 10, 7, 3, 3, 3, 3, 10, 0, 10]; // U open at the top (b = 10)
  assert.deepEqual(lineIntervals(U, false, 5, 0, 10), [[0, 3], [7, 10]], 'b = 5 crosses both arms');
  assert.deepEqual(lineIntervals(U, false, 1, 0, 10), [[0, 10]], 'b = 1 crosses the base');
  assert.deepEqual(lineIntervals(U, true, 5, 0, 10), [[0, 3]], 'a = 5 only the base');
  assert.deepEqual(lineIntervals(U, false, 5, 1, 8), [[1, 3], [7, 8]], 'clamped');
  assert.deepEqual(lineIntervals(U, false, 20, 0, 10), []);
});

test('Crystal Bridges: beams never span an outdoor notch of a concave shell (Bridge Gallery)', () => {
  const cb = notchedShell();
  const plan = cb.plan, F = plan.frame;
  const P = [];
  for (let i = 0; i < cb.inner.length; i += 2) P.push(...toLocal(F, cb.inner[i], cb.inner[i + 1]));
  const { calls } = render(cb);
  const bridge = plan.levels[0].rooms.find((r) => r.label === 'Bridge Gallery');
  assert.ok(bridge, 'notched plan still has the Bridge Gallery');
  const inward = (v, c) => v + Math.sign(c - v) * 0.01;
  let checked = 0, inBridge = 0;
  for (const L of plan.levels) {
    const yB = L.ceil - cb.floor - 0.005 - 0.25;
    for (const c of calls) {
      if (c[0] !== 'q' || c[6] !== -1 || !c[13] || Math.abs(c[1][1] - yB) > 1e-6) continue;
      const pts = c.slice(1, 5).map((v) => toLocal(F, v[0], v[2]));
      const ca = pts.reduce((s, p) => s + p[0], 0) / 4, cbm = pts.reduce((s, p) => s + p[1], 0) / 4;
      // centre, corners and edge midpoints (pulled 1 cm toward the centre): all indoors
      const samples = [[ca, cbm]];
      for (let k = 0; k < 4; k++) {
        const [a0, b0] = pts[k], [a1, b1] = pts[(k + 1) % 4];
        samples.push([inward(a0, ca), inward(b0, cbm)], [inward((a0 + a1) / 2, ca), inward((b0 + b1) / 2, cbm)]);
      }
      for (const [a, b] of samples) assert.ok(inPoly(P, a, b), `beam point (${a.toFixed(2)}, ${b.toFixed(2)}) on level ${L.i} is inside the shell`);
      checked++;
      if (ca > bridge.a0 && cbm < 70) inBridge++;
    }
  }
  assert.ok(checked > 100, `beams checked: ${checked}`);
  assert.ok(inBridge > 0, 'the Bridge Gallery still has beams beside the notch');
});

test('Crystal Bridges: styled ceilings are cream, neutral-lit, and never overlap the up-lit ceiling', () => {
  const cb = SHELLS.get(CB);
  const plan = cb.plan, F = plan.frame;
  const { calls } = render(cb);
  const cream = new THREE.Color().setHex(0xe9e4d8);
  const isCream = (c) => c[8] === cream.r && c[9] === cream.g && c[10] === cream.b;
  // the neutral light normal is unit, not up-facing (no full sky tint) and gets no direct sun
  // (render/Atmosphere.js SUN_DIRECTION)
  const sun = new THREE.Vector3(-0.42, 0.74, 0.52).normalize();
  assert.ok(Math.abs(Math.hypot(...NEUTRAL_LIT) - 1) < 1e-9);
  assert.ok(NEUTRAL_LIT[1] <= 0 && NEUTRAL_LIT[1] > -0.5, 'mostly horizontal, slightly down');
  assert.ok(NEUTRAL_LIT[0] * sun.x + NEUTRAL_LIT[1] * sun.y + NEUTRAL_LIT[2] * sun.z <= 0, 'faces away from the sun');
  assert.equal(calls.filter((c) => c[0] === 'h' && c[3] === 0xe9e4d8).length, 0, 'no up-lit cream ceiling');
  for (const L of plan.levels) {
    const y = L.ceil - cb.floor - 0.01;
    const ceil = calls.filter((c) => c[0] === 'q' && c[6] === -1 && isCream(c) && c.slice(1, 5).every((v) => Math.abs(v[1] - y) < 1e-9));
    assert.ok(ceil.length > 0, `level ${L.i} has styled ceilings`);
    for (const c of ceil) assert.equal(c[13], NEUTRAL_LIT, 'ceiling lit neutral, not as up');
    // no up-lit underside of the floor above over a styled room of this level
    const above = plan.levels.find((l) => l.i === L.i + 1);
    if (!above) continue;
    const yU = above.y - cb.floor - FLOOR_THICKNESS;
    const styled = L.rooms.filter((r) => styleFor(CB, r)?.ceiling !== undefined);
    for (const c of calls) {
      if (c[0] !== 'h' || c[4] !== -1 || Math.abs(c[2] - yU) > 1e-9) continue;
      const pts = c[1];
      let a = 0, b = 0;
      for (let i = 0; i < pts.length; i += 2) { const [la, lb] = toLocal(F, pts[i], pts[i + 1]); a += la; b += lb; }
      a /= pts.length / 2; b /= pts.length / 2;
      assert.ok(!styled.some((r) => a > r.a0 + 1e-6 && a < r.a1 - 1e-6 && b > r.b0 + 1e-6 && b < r.b1 - 1e-6), `up-lit underside over a styled room on level ${L.i}`);
    }
  }
  // beam undersides (0.25 m below the beam tops) are neutral-lit too
  const beamUnders = calls.filter((c) => c[0] === 'q' && c[6] === -1 && plan.levels.some((L) => Math.abs(c[1][1] - (L.ceil - cb.floor - 0.005 - 0.25)) < 1e-6));
  assert.ok(beamUnders.length > 0 && beamUnders.every((c) => c[13] === NEUTRAL_LIT));
});

test('Crystal Bridges: one threshold band per styled doorway, door-wide and on the floor', () => {
  const cb = SHELLS.get(CB);
  const plan = cb.plan;
  const { calls } = render(cb);
  for (const L of plan.levels) {
    const y = L.y - cb.floor + 0.0545;
    const bands = calls.filter((c) => c[0] === 'q' && c[6] === 1 && c.slice(1, 5).every((v) => Math.abs(v[1] - y) < 1e-9));
    const styled = (L.doors || []).filter((d) => styleFor(CB, L.rooms[d.roomA])?.threshold !== undefined || styleFor(CB, L.rooms[d.roomB])?.threshold !== undefined);
    assert.equal(bands.length, styled.length, `level ${L.i} threshold count`);
    for (const [i, d] of styled.entries()) {
      const q = bands[i];
      const cx = (q[1][0] + q[3][0]) / 2, cz = (q[1][2] + q[3][2]) / 2;
      assert.ok(Math.hypot(cx - d.x, cz - d.z) < 1e-6, 'centred on the doorway');
      assert.ok(Math.abs(Math.hypot(q[2][0] - q[1][0], q[2][2] - q[1][2]) - d.w) < 1e-6, 'door width');
      assert.ok(Math.abs(Math.hypot(q[4][0] - q[1][0], q[4][2] - q[1][2]) - 0.5) < 1e-6, '0.5 m deep');
    }
  }
  // unstyled buildings never get threshold bands
  const apt = SHELLS.get(123456);
  assert.equal(render(apt).calls.filter((c) => c[0] === 'q' && c[6] === 1 && Math.abs(c[1][1] % 1 - 0.0545) < 1e-9).length, 0);
});
