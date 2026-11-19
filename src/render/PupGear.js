// BENTONVILLE ROYALE — Scruff's gear, built in code like the pickleball paddle (Paddle.js):
//
//   buildPawPickaxe(mat)  the "Paw Pounder" pickaxe: a fuzzy pink paw on a handle
//   buildGecko(mat)       the "Sticky Buddy" back bling: a chubby gecko plush clinging on
//
// mat: (color) -> material, so the game passes toon materials and the preview page plain ones.
// Low-poly primitives only (house style of SkinAddons.js). Sizes are in the frame of the
// node they hang from, in metres before the character's kit scale.

import * as THREE from 'three';

const DEG = Math.PI / 180;

function part(group, geo, material, pos, rot = [0, 0, 0], scale = [1, 1, 1]) {
  const m = new THREE.Mesh(geo, material);
  m.position.set(...pos);
  m.rotation.set(rot[0] * DEG, rot[1] * DEG, rot[2] * DEG);
  m.scale.set(...scale);
  m.castShadow = true;
  group.add(m);
  return m;
}

const PAW = { fur: 0xff9cc8, furDark: 0xf27fb3, bean: 0xd9487f, handle: 0x463a58, wrap: 0xfff1d6 };

/**
 * Handle along +Y from the grip at the origin (like the classic pickaxe in handslot.r);
 * the paw's pads face +Z, so a chop lands pads first.
 */
export function buildPawPickaxe(mat) {
  const g = new THREE.Group();
  g.name = 'PawPounder';
  const fur = mat(PAW.fur);
  const furDark = mat(PAW.furDark);
  const bean = mat(PAW.bean);
  const handle = mat(PAW.handle);
  const wrap = mat(PAW.wrap);

  const cyl = new THREE.CylinderGeometry(0.5, 0.5, 1, 10);
  const ball = new THREE.SphereGeometry(0.5, 12, 8);
  const cone = new THREE.ConeGeometry(0.5, 1, 6);

  // handle with a cream grip wrap and a fuzzy cuff where it meets the paw
  part(g, cyl, handle, [0, 0.28, 0], [0, 0, 0], [0.07, 0.95, 0.07]);
  for (const y of [-0.08, 0.02, 0.12]) part(g, cyl, wrap, [0, y, 0], [0, 0, 0], [0.085, 0.05, 0.085]);
  part(g, ball, furDark, [0, 0.74, 0], [0, 0, 0], [0.22, 0.14, 0.22]);

  // the paw: a big puffy mitt
  const pawY = 0.95;
  part(g, ball, fur, [0, pawY, 0], [0, 0, 0], [0.46, 0.42, 0.34]);
  // fur tufts around the rim
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    const x = Math.cos(a) * 0.22;
    const y = pawY + Math.sin(a) * 0.2;
    part(g, cone, i % 2 ? furDark : fur, [x, y, -0.02], [0, 0, a / DEG - 90], [0.09, 0.12, 0.09]);
  }
  // toe beans and the big heart-ish pad on the front (+Z)
  part(g, ball, bean, [0, pawY - 0.05, 0.16], [0, 0, 0], [0.2, 0.16, 0.06]);
  part(g, ball, bean, [0.055, pawY - 0.08, 0.16], [0, 0, 0], [0.12, 0.12, 0.06]);
  part(g, ball, bean, [-0.055, pawY - 0.08, 0.16], [0, 0, 0], [0.12, 0.12, 0.06]);
  const toes = [
    [-0.15, 0.08],
    [-0.055, 0.14],
    [0.055, 0.14],
    [0.15, 0.08],
  ];
  for (const [x, dy] of toes) part(g, ball, bean, [x, pawY + dy, 0.145], [0, 0, 0], [0.085, 0.1, 0.05]);
  return g;
}

const GECKO = { body: 0xffd84d, belly: 0xfff1d6, eye: 0x1b1d24, shine: 0xffffff, blush: 0xff7fa8 };
// rainbow plush: red head, ROYGBV stripes down the back, a colour per leg, violet tail
const RAINBOW = [0xff5a64, 0xff9a3d, 0xffd84d, 0x5fd27a, 0x4fa3ff, 0xa77bff];

/**
 * The gecko lies in its XY plane, head up (+Y), belly on -Z and back on +Z. Character turns it
 * to face away from the chest (rotation.y = PI) and pushes it onto the wearer's back.
 */
export function buildGecko(mat) {
  const g = new THREE.Group();
  g.name = 'StickyBuddy';
  const body = mat(GECKO.body);
  const belly = mat(GECKO.belly);
  const bow = RAINBOW.map((c) => mat(c));
  const eye = mat(GECKO.eye);
  const shine = mat(GECKO.shine);
  const blush = mat(GECKO.blush);

  const ball = new THREE.SphereGeometry(0.5, 12, 8);
  const cap = new THREE.CapsuleGeometry(0.25, 0.5, 3, 10);
  const cone = new THREE.ConeGeometry(0.5, 1, 8);

  // chubby body and belly patch (belly on -Z: against the wearer's back)
  part(g, cap, body, [0, 0, 0], [0, 0, 0], [0.62, 0.52, 0.5]);
  part(g, ball, belly, [0, -0.01, -0.05], [0, 0, 0], [0.24, 0.36, 0.14]);
  // rainbow stripes across the back (+Z), red at the shoulders to violet at the hips
  for (let i = 0; i < bow.length; i++) {
    const y = 0.14 - i * 0.056;
    const w = 0.27 - Math.abs(y + 0.0) * 0.35; // narrower toward the rounded ends
    part(g, ball, bow[i], [0, y, 0.105], [0, 0, 0], [w, 0.062, 0.05]);
  }

  // big round head with huge eyes and a smile-blush
  const hy = 0.3;
  part(g, ball, bow[0], [0, hy, 0.02], [0, 0, 0], [0.34, 0.27, 0.27]);
  for (const s of [1, -1]) {
    part(g, ball, eye, [0.12 * s, hy + 0.06, 0.1], [0, 0, 0], [0.1, 0.11, 0.08]);
    part(g, ball, shine, [0.135 * s, hy + 0.09, 0.14], [0, 0, 0], [0.035, 0.035, 0.02]);
    part(g, ball, blush, [0.13 * s, hy - 0.04, 0.12], [0, 0, 0], [0.06, 0.03, 0.02]);
  }

  // four splayed legs hugging the back, each ending in a sticky toe pad
  const legs = [
    [0.15, 0.13, -40],
    [-0.15, 0.13, 40],
    [0.15, -0.14, -140],
    [-0.15, -0.14, 140],
  ];
  const legColors = [bow[1], bow[3], bow[4], bow[5]];
  for (let li = 0; li < legs.length; li++) {
    const [x, y, rz] = legs[li];
    const leg = part(g, cap, legColors[li], [x, y, -0.02], [0, 0, rz], [0.22, 0.34, 0.22]);
    const dir = new THREE.Vector3(0, 1, 0).applyEuler(leg.rotation);
    const tip = leg.position.clone().addScaledVector(dir, 0.13);
    part(g, ball, belly, [tip.x, tip.y, -0.05], [0, 0, 0], [0.09, 0.09, 0.04]);
  }

  // curly tail
  part(g, cone, bow[5], [0.05, -0.32, 0], [0, 0, 160], [0.14, 0.24, 0.12]);
  part(g, ball, bow[4], [0.09, -0.43, 0.01], [0, 0, 0], [0.07, 0.07, 0.07]);
  return g;
}
