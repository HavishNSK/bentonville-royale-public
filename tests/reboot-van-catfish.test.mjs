// Catfish Ken's reboot van carries a catfish mascot on its roof (one cheap mesh that clears the
// beacon), and the van's marker on the minimap / full map is a catfish icon.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { buildRebootVan, REBOOT_VAN } from '../src/render/RebootVan.js';
import { catfishGeometry, CATFISH_COLORS } from '../src/render/CatfishMascot.js';
import { icon, hasIcon } from '../src/ui/icons.js';
import { CATFISH_ICON, drawCatfishMarker } from '../src/ui/catfishIcon.js';

test('the catfish mascot is one small vertex-coloured geometry', () => {
  const g = catfishGeometry();
  const tris = g.attributes.position.count / 3;
  assert.ok(tris < 1500, `${tris} triangles`);
  assert.ok(g.attributes.color, 'vertex colours');
  // violet back, cream belly, gold fins and ink whiskers are all in there
  const have = new Set();
  const c = new THREE.Color();
  for (let i = 0; i < g.attributes.color.count; i++) {
    c.fromBufferAttribute(g.attributes.color, i);
    have.add(c.getHex());
  }
  for (const k of ['back', 'belly', 'fin', 'ink', 'eye']) assert.ok(have.has(CATFISH_COLORS[k]), k);
});

test('every reboot van has the catfish on its roof, clear of the beacon ring', () => {
  for (let n = 0; n < 2; n++) {
    const van = buildRebootVan();
    const fish = van.getObjectByName('catfish_mascot');
    assert.ok(fish && fish.isMesh, 'catfish mesh');
    assert.equal(fish.parent, van, 'a child of the van, so hiding a far van hides it too');
    van.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(fish);
    assert.ok(box.min.y > REBOOT_VAN.height - 0.1, `sits on the roof (${box.min.y.toFixed(2)})`);
    assert.ok(box.max.y < REBOOT_VAN.height + 1.4, 'not a skyscraper');
    // the beacon ring is centred at z = 1.2 with radius up to 0.45 * 1.6 (+ tube) while busy
    assert.ok(box.max.z < 1.2 - 0.8, `tail clear of the beacon (${box.max.z.toFixed(2)})`);
    assert.ok(box.min.z > -REBOOT_VAN.halfLength, 'within the van length');
    // it sways in update() and stays its own (single) mesh
    van.userData.update(0.5, null);
    let fishMeshes = 0;
    van.traverse((o) => {
      if (o.isMesh && o.material.vertexColors) fishMeshes++;
    });
    assert.equal(fishMeshes, 1);
  }
});

test('the van marker icon is a catfish', () => {
  assert.ok(hasIcon('catfish'));
  const svg = icon('catfish');
  assert.match(svg, /^<svg [^>]*viewBox="0 0 48 48"/);
  assert.ok(svg.includes(CATFISH_ICON.body), 'the HUD icon uses the shared catfish outline');
});

test('the map draws reboot vans as a catfish in the state colour', () => {
  const calls = [];
  const fills = [];
  globalThis.Path2D ??= class {
    constructor(d) {
      this.d = d;
    }
  };
  const ctx = new Proxy(
    {},
    {
      get(t, k) {
        if (k in t) return t[k];
        return (...a) => {
          calls.push([k, a[0] && a[0].d]);
          if (k === 'fill') fills.push(t.fillStyle);
        };
      },
      set(t, k, v) {
        t[k] = v;
        return true;
      },
    }
  );
  drawCatfishMarker(ctx, 2, '#38e1ff');
  const paths = calls.filter(([k]) => k === 'fill' || k === 'stroke').map(([, d]) => d);
  assert.ok(paths.includes(CATFISH_ICON.body), 'traces the catfish body');
  assert.ok(paths.includes(CATFISH_ICON.whiskers), 'and its whiskers');
  assert.ok(fills.includes('#38e1ff'), 'filled in the state colour');
});

test('the minimap uses the catfish marker for every van state', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../src/ui/Minimap.js', import.meta.url), 'utf8');
  assert.match(src, /import \{ drawCatfishMarker \} from '\.\/catfishIcon\.js'/);
  const block = src.slice(src.indexOf("['van', '#38e1ff']"), src.indexOf('// reboot card'));
  assert.match(block, /drawCatfishMarker\(/);
  assert.ok(!block.includes("fillText('R'"), 'the old "R" badge is gone');
});
