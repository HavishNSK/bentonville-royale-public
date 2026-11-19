// Regression: Character.dispose() must free each skinned mesh's skeleton (its bone texture is a
// GPU texture). Before the fix every match leaked ~100 of them (one per bot / player character).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Character } from '../src/game/Character.js';

function tinyKit() {
  const root = new THREE.Bone();
  root.name = 'root';
  const child = new THREE.Bone();
  child.name = 'spine';
  root.add(child);
  const geo = new THREE.BoxGeometry(0.5, 1, 0.5);
  const n = geo.attributes.position.count;
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(new Array(n * 4).fill(0), 4));
  geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(new Array(n).fill([1, 0, 0, 0]).flat(), 4));
  const mesh = new THREE.SkinnedMesh(geo, new THREE.MeshStandardMaterial());
  mesh.name = 'Body';
  mesh.add(root);
  mesh.bind(new THREE.Skeleton([root, child]));
  const scene = new THREE.Group();
  scene.add(mesh);
  return { scene, scale: 1, hide: new Set(), lower: {}, upper: {}, over: {}, bones: {} };
}

test('Character.dispose frees every skeleton bone texture', () => {
  const ch = new Character(tinyKit(), { weapons: {} });
  const skeletons = [];
  ch.model.traverse((o) => {
    if (o.isSkinnedMesh) skeletons.push(o.skeleton);
  });
  assert.ok(skeletons.length > 0, 'the clone has a skinned mesh');
  let disposed = 0;
  for (const s of skeletons) {
    s.computeBoneTexture(); // what the renderer does on first draw
    s.boneTexture.addEventListener('dispose', () => disposed++);
  }
  ch.dispose();
  assert.equal(disposed, skeletons.length);
  for (const s of skeletons) assert.equal(s.boneTexture, null);
});
