// Interior ceilings are solid from below: a body lifted to just under an upper floor (a built
// ramp, a prop, a jump off a wall) or under a one-storey roof is never snapped up through it
// onto the floor / roof above. World.builtAbove is the "something is over my head" cap the
// player and bots pass to groundHeight.
import test from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/world/World.js';
import { inHole, FLOOR_THICKNESS } from '../src/world/interiors/storeys.js';

const data = { meta: { bounds: { minX: -100, maxX: 100, minZ: -100, maxZ: 100 } }, buildings: [], roads: [], areas: [], pois: [] };
const STEP = 0.62;

function fixture() {
  const w = new World(data);
  w.addBuilding({ id: 123456, t: 'apartments', mat: 'brick', lv: 3, h: 11, p: [[0, 0], [25, 0], [25, 20], [0, 20]] });
  w.addBuilding({ id: 77, t: 'retail', mat: 'brick', lv: 1, h: 6, p: [[40, 0], [80, 0], [80, 30], [40, 30]] });
  w.finishBuildings();
  const byId = new Map(w.buildingInteriors().map((b) => [b.collider.ref.id, b.collider]));
  return { w, multi: byId.get(123456), single: byId.get(77) };
}

/** Grid points inside the shell's inner polygon, away from stair holes on every upper level. */
function samplePoints(c) {
  const s = c.shell, plan = s.plan, out = [];
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (let i = 0; i < s.inner.length; i += 2) { x0 = Math.min(x0, s.inner[i]); x1 = Math.max(x1, s.inner[i]); z0 = Math.min(z0, s.inner[i + 1]); z1 = Math.max(z1, s.inner[i + 1]); }
  for (let x = x0 + 0.6; x < x1 - 0.6; x += 1.7) for (let z = z0 + 0.6; z < z1 - 0.6; z += 1.7) {
    if (plan.levels.some((L) => L.i > 0 && inHole(plan, L, x, z, 0.3))) continue;
    out.push([x, z]);
  }
  return out;
}

test('an upper floor is not a step from just under it (multi-storey)', () => {
  const { w, multi } = fixture();
  const plan = multi.shell.plan;
  assert.ok(plan.levels.length >= 2);
  let checked = 0;
  for (const L of plan.levels.slice(0, -1)) {
    const next = plan.levels.find((l) => l.i === L.i + 1);
    const under = next.y - FLOOR_THICKNESS;
    for (const [x, z] of samplePoints(multi)) {
      for (const feet of [under - STEP - 0.01, under - 0.4, under - 0.1]) {
        const cap = w.builtAbove(x, z, feet);
        assert.ok(cap <= next.y + 1e-6, `cap over level ${L.i} at (${x.toFixed(1)}, ${z.toFixed(1)}) feet ${feet.toFixed(2)}: ${cap}`);
        const g = w.groundHeight(x, z, feet, STEP, cap);
        assert.ok(g < under, `snapped through the floor of level ${next.i}: ground ${g} from feet ${feet.toFixed(2)}`);
        checked++;
      }
    }
  }
  assert.ok(checked > 100, `points checked: ${checked}`);
});

test('the roof is not a step from just under a one-storey ceiling', () => {
  const { w, single } = fixture();
  const s = single.shell;
  assert.equal(s.plan.levels.length, 1);
  for (const [x, z] of samplePoints(single)) {
    for (const feet of [s.ceil - 0.5, s.ceil - 0.2, s.ceil - 0.06]) {
      const g = w.groundHeight(x, z, feet, STEP, w.builtAbove(x, z, feet));
      assert.ok(g < s.ceil, `snapped onto the roof: ground ${g} from feet ${feet.toFixed(2)} (ceil ${s.ceil})`);
    }
  }
});

test('stairs and normal floors still work: the cap never hides a reachable surface', () => {
  const { w, multi } = fixture();
  const plan = multi.shell.plan;
  // standing on a floor: that floor is found and nothing caps it
  for (const L of plan.levels) for (const [x, z] of samplePoints(multi).slice(0, 20)) {
    const g = w.groundHeight(x, z, L.y + 0.01, STEP, w.builtAbove(x, z, L.y + 0.01));
    assert.ok(Math.abs(g - L.y) < 1e-6 || g > L.y, `floor ${L.i} found`);
  }
  // climbing a flight: every step's surface is reachable with the cap taken from where we stand
  for (const s of plan.stairs) {
    let y = s.y0;
    for (let k = 0; k <= 60; k++) {
      const t = k / 60, x = s.x0 + (s.x1 - s.x0) * t, z = s.z0 + (s.z1 - s.z0) * t;
      y = w.groundHeight(x, z, y, 0.5, w.builtAbove(x, z, y));
      assert.ok(Math.abs(y - (s.y0 + (s.y1 - s.y0) * t)) < 0.08, `stair ${s.level} t ${t}: ${y}`);
    }
  }
  // outside the footprint nothing is capped
  assert.equal(w.builtAbove(-20, -20, 0), Infinity);
});

test('build pieces inside a multi-storey building must fit under their own storey ceiling', async () => {
  const { Structures } = await import('../src/game/Structures.js');
  const { w, multi } = fixture();
  const plan = multi.shell.plan;
  const S = { world: w, _buried: () => false };
  const fits = (pl) => Structures.prototype.fits.call({ ...S, _fitsInside: Structures.prototype._fitsInside.bind(S) }, pl);
  // a clear ground-floor spot away from the stairs and partitions
  const L0 = plan.levels[0], L1 = plan.levels[1];
  let spot = null;
  for (const [x, z] of samplePoints(multi)) {
    if (fits({ kind: 'wall', x, y: L0.y, z, rot: 0 }) && fits({ kind: 'ramp', x, y: L0.y, z, rot: 0 })) { spot = [x, z]; break; }
  }
  assert.ok(spot, 'a buildable ground-floor spot exists');
  const [x, z] = spot;
  assert.ok(fits({ kind: 'floor', x, y: L0.y + 3, z, rot: 0 }), 'a floor tile at 3 m still fits under the 1st-floor slab');
  for (const kind of ['wall', 'ramp', 'cone']) {
    assert.equal(fits({ kind, x, y: L0.y + 3, z, rot: 0 }), false, `a ${kind} stacked at 3 m pokes through the floor above (${L1.y})`);
  }
});
