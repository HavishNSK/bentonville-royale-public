// Crystal Bridges fixes: no lower roof's eave pokes into a taller room, every painting has a clear
// view in front of it (statues, the Infinity Room), a push can never carry a body through a thin
// wall, and the third-person camera never starts its boom inside a wall on the shoulder side.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { World } from '../src/world/World.js';
import { Player, placeOrbitCamera } from '../src/game/Player.js';
import { buildSite, roofNeighborSides } from '../src/world/crystal-bridges/build.js';
import { PAVILIONS } from '../src/world/crystal-bridges/site.js';
import { placeArt, obstaclesFrom, VIEW_CLEAR } from '../src/world/crystal-bridges/gallery/hang.js';

const mapData = JSON.parse(readFileSync(new URL('../public/data/bentonville-osm.json', import.meta.url)));
const config = JSON.parse(readFileSync(new URL('../public/data/crystal-bridges.config.json', import.meta.url)));
const site = () => {
  const world = new World({ ...mapData, buildings: [], roads: [] });
  return { world, out: buildSite(world, mapData) };
};

test('roof eaves are dropped on sides that butt against another pavilion', () => {
  const byId = Object.fromEntries(PAVILIONS.map((p) => [p.id, p]));
  assert.equal(roofNeighborSides(byId['great-hall']).s, true, 'great hall meets the south lobby');
  assert.equal(roofNeighborSides(byId['south-lobby']).n, true, 'south lobby meets the great hall');
  // a free-standing side keeps its eave
  for (const pv of PAVILIONS) {
    const s = roofNeighborSides(pv);
    assert.ok(!(s.n && s.s && s.w && s.e) || pv.id === 'lobby', `${pv.id} is not boxed in on all sides`);
  }
});

test('no statue, plinth or small room stands in front of a painting', () => {
  const { out } = site();
  const artIndex = {};
  for (const w of config.wings) for (const x of w.works) if (x.art) artIndex[x.art] = { width: 1000, height: 760 };
  const placements = placeArt(out.hangLines, config.wings, artIndex, obstaclesFrom(out));
  const blockers = [
    ...out.parts.filter((p) => p.statue || p.plinth).map((p) => ({ x: p.cx, z: p.cz, r: Math.max(p.hx, p.hz) })),
    ...PAVILIONS.flatMap((pv) => (pv.rooms || []).map((rm) => ({ x: (rm.x0 + rm.x1) / 2, z: (rm.z0 + rm.z1) / 2, r: Math.max(rm.x1 - rm.x0, rm.z1 - rm.z0) / 2 }))),
  ];
  let checked = 0;
  for (const pl of placements) {
    // the straight view from a viewer 3 m back to the canvas centre
    for (let d = 0.3; d <= VIEW_CLEAR - 0.4; d += 0.25) {
      const x = pl.x + pl.nx * d;
      const z = pl.z + pl.nz * d;
      for (const b of blockers) assert.ok(Math.hypot(x - b.x, z - b.z) > b.r, `"${pl.work.title || pl.work.art}" (${pl.pv}) is hidden ${d.toFixed(1)} m out`);
    }
    checked++;
  }
  assert.ok(checked >= 50, `checked ${checked}`);
});

function fixture() {
  const bounds = { minX: -100, maxX: 100, minZ: -100, maxZ: 100 };
  const world = new World({ meta: { bounds }, buildings: [], roads: [], areas: [], pois: [] });
  const player = new Player({ inventory: { current: () => null } });
  player._handleLoadoutKeys = () => {};
  player._actions = () => {};
  const game = { world, settings: {}, hud: { prompt() {} }, sfx: { play() {} }, fx: { dustPuff() {} }, combat: { applyDamage() {} } };
  return { world, player, game };
}

test('a push out of a box beside a thin wall never carries the body through the wall', () => {
  // the North Tower case: a stair block 0.2 m from a 0.4 m wall; a body caught in the block's
  // side was pushed out its nearest face (into the wall) and then out through the wall
  const { world, player, game } = fixture();
  world.addBox({ cx: 0.2, cz: 0, hx: 0.2, hz: 6, y0: 0, y1: 4, kind: 'museum', mat: 'brick', hp: 1e9 }); // wall x 0..0.4
  world.addBox({ cx: 2.6, cz: 0, hx: 2, hz: 6, y0: 0, y1: 2.5, kind: 'museum', mat: 'brick', hp: 1e9 }); // block x 0.6..4.6
  const input = { dx: 0, dy: 0, action: (k) => k === 'moveLeft', actionHit: () => false };
  player.pos.set(1.0, 0, 0); // inside the block's west side, below its top
  for (let i = 0; i < 90; i++) {
    player.update(1 / 60, input, game);
    assert.ok(player.pos.x > 0.4 - 1e-6, `pushed through the wall to x=${player.pos.x.toFixed(2)}`);
  }
});

test('walking into a thin museum wall at speed never crosses it', () => {
  const { world, player, game } = fixture();
  world.addBox({ cx: 0.2, cz: 0, hx: 0.2, hz: 6, y0: 0, y1: 4, kind: 'museum', mat: 'brick', hp: 1e9 });
  const input = { dx: 0, dy: 0, action: (k) => k === 'moveRight', actionHit: () => false };
  player.pos.set(-2, 0, 0);
  for (let i = 0; i < 120; i++) player.update(1 / 30, input, game);
  assert.ok(player.pos.x < 0, `crossed to ${player.pos.x}`);
});

test('the camera boom never starts inside a wall on the shoulder side', () => {
  const { world } = fixture();
  // wall to the player's right (heading 0 faces -z, right is +x), 0.5 m from the pivot
  world.addBox({ cx: 0.7, cz: 0, hx: 0.2, hz: 8, y0: 0, y1: 5, kind: 'museum', mat: 'brick', hp: 1e9 });
  const cam = new THREE.PerspectiveCamera(68, 16 / 9, 0.3, 3000);
  const pivot = new THREE.Vector3(0, 1.55, 0);
  for (const heading of [0, 0.3, -0.3]) {
    placeOrbitCamera(cam, world, pivot, heading, 0, 4.4, 0.75);
    assert.ok(cam.position.x < 0.5 - 0.3, `camera at x=${cam.position.x.toFixed(2)} sits in / behind the wall (heading ${heading})`);
  }
});
