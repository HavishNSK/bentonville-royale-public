import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { World } from '../src/world/World.js';
import { appendBuildingGeometry, Scatter, addRibbon, addPolygon } from '../src/world/WorldMeshes.js';

function chunk() {
  return { wall: [], bh: [], panelRanges: [], buf: {
    pos: [], nor: [], col: [], idx: [], n: 0,
    v(x, y, z, nx, ny, nz, r, g, b) {
      this.pos.push(x, y, z); this.nor.push(nx, ny, nz); this.col.push(r, g, b);
      return this.n++;
    },
  } };
}

for (const elevation of [-12, 0, 8]) {
  test(`building walls, interiors and roof share collider elevation ${elevation}`, () => {
    const bd = { id: 42, p: [[-10, -10], [10, -10], [10, 10], [-10, 10]], h: 8, lv: 2, a: 400, mat: 'brick' };
    const world = new World({ meta: { bounds: { minX: -30, minZ: -30, maxX: 30, maxZ: 30 } }, buildings: [bd], pois: [] });
    world.setTerrain({ minX: -30, minZ: -30, cell: 60, cols: 2, rows: 2 }, new Float32Array(4).fill(elevation));
    const collider = world.addBuilding(bd);
    world.finishBuildings();
    const c = chunk();
    appendBuildingGeometry(c, bd, null, collider);
    const ys = c.buf.pos.filter((_, i) => i % 3 === 1);
    // Stair slab undersides may extend below the ground-floor finish.
    assert.ok(Math.min(...ys) >= collider.y0 - 0.4);
    assert.ok(ys.some(y => Math.abs(y - collider.y0) < 0.001));
    assert.ok(Math.abs(Math.max(...ys) - collider.h) < 0.001);
    assert.ok(ys.some(y => Math.abs(y - (collider.shell.floor + 0.05)) < 0.001));
    assert.equal(c.wall.length / 4, c.buf.n);
    for (const i of c.buf.idx) assert.ok(i >= 0 && i < c.buf.n);
  });
}

test('instance placement samples terrain and lifts model origin to its feet', () => {
  const root = new THREE.Group();
  const scatter = new Scatter(root, true, (x, z) => x * 0.1 + z * 0.2);
  const model = new THREE.Group();
  model.add(new THREE.Mesh(new THREE.BoxGeometry(1, 4, 1), new THREE.MeshLambertMaterial()));
  assert.equal(scatter.define('tree', { scene: model }, 2), true);
  const rec = scatter.add('tree', 10, 20, 0, 1.5);
  // Scaled mesh minimum Y is -6; move its origin to 11 so its feet touch the surface at 5.
  assert.equal(rec.y, 11);
  scatter.build();
  const matrix = new THREE.Matrix4();
  rec.mesh.getMatrixAt(rec.index, matrix);
  assert.equal(matrix.elements[13], 11);
  scatter.hide(rec);
  scatter.show(rec);
  rec.mesh.getMatrixAt(rec.index, matrix);
  assert.equal(matrix.elements[13], 11);
});

test('explicit instance elevation remains authoritative', () => {
  const scatter = new Scatter(new THREE.Group(), false, () => 99);
  const model = new THREE.Group();
  model.add(new THREE.Mesh(new THREE.BoxGeometry(1, 2, 1), new THREE.MeshLambertMaterial()));
  scatter.define('prop', { scene: model }, 1);
  assert.equal(scatter.add('prop', 0, 0, 0, 1, null, 7).y, 8);
  assert.equal(scatter.add('missing', 0, 0, 0), null);
});

test('road ribbons sample both edges and subdivide long terrain spans', () => {
  const c = chunk();
  const height = (x, z) => x * 0.2 + z * 0.3;
  addRibbon(c.buf, [[0, 0], [20, 0]], 4, height, 0x777777);
  assert.ok(c.buf.n >= 12, 'a long road needs intermediate vertices to follow hills');
  for (let i = 0; i < c.buf.pos.length; i += 3) {
    const [x, y, z] = c.buf.pos.slice(i, i + 3);
    assert.ok(Math.abs(y - height(x, z)) < 1e-6, 'cross-slope road edge matches its ground');
  }
  for (let i = 6; i < c.buf.pos.length; i += 6) {
    assert.ok(Math.hypot(c.buf.pos[i] - c.buf.pos[i - 6], c.buf.pos[i + 2] - c.buf.pos[i - 4]) <= 4.001);
  }
});

test('large landcover polygons have interior height samples instead of spanning hills', () => {
  const c = chunk();
  const height = (x, z) => 4 * Math.sin(x / 15) * Math.sin(z / 15);
  addPolygon(c.buf, [[0, 0], [60, 0], [60, 60], [0, 60]], height, 0x667755);
  assert.ok(c.buf.n > 4, 'landcover follows hills within the polygon');
  for (let i = 0; i < c.buf.pos.length; i += 3) {
    const [x, y, z] = c.buf.pos.slice(i, i + 3);
    assert.ok(Math.abs(y - height(x, z)) < 1e-6);
  }
});
