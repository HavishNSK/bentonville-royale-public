// BENTONVILLE ROYALE — Bentonville High School: the Arend Arts Center hero interior (lobby, house,
// stage). Owned by the arend subagent (docs/bhs/BHS_CONTRACT.md). Called by src/world/bhs/south.js
// with the kit K and ctx (hero rects, plan, storey height). Builds only inside the hero rects, with
// kit pieces and kit looks. Reference: the AAC photo (docs/bhs/STYLE_BIBLE.md §1, §4).
//
//   house.js  fan of continental rows, side aisles, rear cross-aisle + door wells, balcony, booth,
//             acoustic panels, ceiling bulkheads
//   stage.js  apron + pit rail, proscenium, red traveler + gold valance, concert shell, fly loft
//   lobby.js  terrazzo lobby, ticket counter, gallery wall, upper-lobby deck at level 1
//
// The proscenium opening (x = 84) and the upper-lobby door into the balcony well (x = 40, level 1)
// are cut in the plan's partition walls. Until south.js lists them as plan doors (see the report),
// carveOpening() splits the plan wall pieces around them; once the plan has the openings it finds
// nothing to cut and does nothing.

import { PROS, BAL_DOOR_Z, Y_BAL_REAR } from './layout.js';
import { buildHouse } from './house.js';
import { buildStage } from './stage.js';
import { buildLobby } from './lobby.js';

const NONE = Object.freeze({ pu: 'none', nu: 'none', pv: 'none', nv: 'none', top: 'none', bottom: 'none' });

/**
 * Cut an opening z0..z1, y0..y1 through the plan's wall pieces on the line x = X (walls run along z).
 * Each overlapping piece is removed (collider out of the world, drawn with no faces) and the parts
 * of it outside the opening are rebuilt as new wall pieces with the same looks. Returns the count cut.
 */
export function carveOpening(K, X, z0, z1, y0, y1) {
  const hits = K.parts.filter((p) => p.role === 'wall' && p.collider && p.collider.alive !== false && Math.abs(p.cx - X) < 0.25 && Math.abs(Math.abs(Math.sin(p.yaw)) - 1) < 1e-3 && p.hz < 0.3 && p.cz + p.hx > z0 + 0.01 && p.cz - p.hx < z1 - 0.01 && p.y1 > y0 + 0.01 && p.y0 < y1 - 0.01);
  for (const p of hits) {
    K.world.remove(p.collider);
    const faces = p.faces;
    const look = p.look;
    p.look = 'none';
    p.faces = NONE;
    const pa = p.cz - p.hx;
    const pb = p.cz + p.hx;
    const keep = [];
    if (pa < z0) keep.push([pa, z0, p.y0, p.y1]);
    if (pb > z1) keep.push([z1, pb, p.y0, p.y1]);
    const ma = Math.max(pa, z0);
    const mb = Math.min(pb, z1);
    if (p.y0 < y0 - 0.01) keep.push([ma, mb, p.y0, y0]);
    if (p.y1 > y1 + 0.01) keep.push([ma, mb, y1, p.y1]);
    for (const [a, b, ya, yb] of keep) {
      if (b - a < 0.02) continue;
      K.box({ cx: p.cx, cz: (a + b) / 2, hx: (b - a) / 2, hz: p.hz, yaw: p.yaw, y0: ya, y1: yb }, { mat: 'block', look, faces, role: 'wall', group: p.group });
    }
  }
  return hits.length;
}

/** @param {ReturnType<import('../../kit/builder.js').createKit>} K @param {object} ctx */
export function buildArend(K, ctx) {
  void ctx;
  const p0 = K.parts.length;
  const d0 = K.decors.length;
  const l0 = K.lootSpots.length;
  const prevGroup = K.group;
  // openings in the plan walls (no-ops once the plan lists them)
  const carved = carveOpening(K, 84, PROS.z0, PROS.z1, 0, PROS.top) + carveOpening(K, 40, BAL_DOOR_Z - 1.0, BAL_DOOR_Z + 1.0, 4.4, Math.min(4.4 + 2.4, Y_BAL_REAR));
  const { seats, balconySeats } = buildHouse(K);
  buildStage(K);
  buildLobby(K);
  K.setGroup(prevGroup);
  // stats for tests / the match loop (not used by the game)
  K.arendInfo = { parts: [p0, K.parts.length], decors: [d0, K.decors.length], loot: [l0, K.lootSpots.length], seats: seats + balconySeats, mainSeats: seats, balconySeats, carved };
}
