// The update flyer (v0.20.0 "BHS and Box Fights") matches the newest patch notes and package
// version, opens once per version, and every image it shows is shipped. Also kept from v0.17.0:
// the rocket launcher (whose fire path read an undefined variable) launches its rocket.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import * as THREE from 'three';
import { FLYER } from '../src/data/updateFlyer.js';
import { PATCH_NOTES, LATEST_VERSION } from '../src/data/patchNotes.js';
import { World } from '../src/world/World.js';
import { Combat } from '../src/game/Combat.js';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url)));
const lock = JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url)));

test('the flyer is for the newest released version, named BHS and Box Fights; package versions match', () => {
  // the flyer shows once per FLYER.version (updateFlyer.js), so a later patch without a flyer of
  // its own keeps showing it to players who have not seen it yet
  const notes = PATCH_NOTES.find((n) => n.version === FLYER.version);
  assert.ok(notes, 'flyer version has patch notes');
  // (0.20.1, a shop patch, has no flyer of its own: the 0.20.0 flyer stays, not re-shown)
  const idx = (v) => PATCH_NOTES.findIndex((n) => n.version === v);
  assert.ok(idx(FLYER.version) >= idx(LATEST_VERSION), 'the flyer is not ahead of the newest patch notes entry');
  assert.equal(notes.title, 'BHS and Box Fights');
  assert.equal(FLYER.title.join(' '), 'BHS and Box Fights');
  assert.equal(pkg.version, LATEST_VERSION);
  assert.equal(lock.version, LATEST_VERSION);
  assert.equal(lock.packages[''].version, LATEST_VERSION);
});

test('every flyer image is shipped in public/ and has alt text', () => {
  const srcs = [FLYER.hero.src];
  for (const s of FLYER.sections) {
    for (const it of s.items || []) {
      srcs.push(it.img);
      assert.ok(it.name && it.text, 'item card has a name and text');
    }
    for (const im of s.images || []) {
      srcs.push(im.src);
      assert.ok(im.alt && im.alt.length > 10, `alt text for ${im.src}`);
    }
  }
  assert.ok(FLYER.hero.alt.length > 10);
  for (const src of srcs) {
    assert.match(src, /^\/ui\/news\/[a-z0-9-]+\.(png|jpg)$/);
    assert.ok(existsSync(new URL('../public' + src, import.meta.url)), `${src} missing`);
  }
  // Bentonville High and Box Fights are both pictured
  for (const id of ['bhs', 'boxfights']) {
    const sec = FLYER.sections.find((s) => s.id === id);
    assert.ok(sec && sec.images && sec.images.length >= 1, `${id} section has images`);
  }
});

test('the flyer opens once per version', async () => {
  // updateFlyer.js imports its CSS (a browser bundle); the logic is mirrored here
  const src = readFileSync(new URL('../src/ui/updateFlyer.js', import.meta.url), 'utf8');
  assert.match(src, /export function shouldShowFlyer\(seen, version = FLYER\.version\) \{\n\s+return typeof version === 'string' && version\.length > 0 && seen !== version;/);
  assert.match(src, /function show\(\) \{\n\s+markSeen\(f\.version\);/, 'showing it marks this version seen');
  const shouldShowFlyer = (seen, version) => typeof version === 'string' && version.length > 0 && seen !== version;
  assert.equal(shouldShowFlyer('', '0.17.0'), true, 'first launch after the update');
  assert.equal(shouldShowFlyer('0.16.0', '0.17.0'), true, 'coming from the last version');
  assert.equal(shouldShowFlyer('0.17.0', '0.17.0'), false, 'already seen');
});

test('the rocket launcher launches its rocket (fire path used an undefined variable)', () => {
  const world = new World({ meta: { bounds: { minX: -80, maxX: 80, minZ: -80, maxZ: 80 } }, buildings: [], roads: [], areas: [], pois: [] });
  const combat = new Combat({ world });
  let launched = 0;
  combat.launchProjectile = () => launched++;
  const shooter = { id: 1, alive: true, pos: new THREE.Vector3(0, 0, 0), team: 0 };
  combat.register(shooter);
  assert.doesNotThrow(() => combat.fireWeapon(shooter, { type: 'weapon', id: 'rocket_launcher', rarity: 'epic', mag: 1 }, new THREE.Vector3(0, 1.6, 0), new THREE.Vector3(0, 0, -1)));
  assert.equal(launched, 1, 'one rocket launched');
});
