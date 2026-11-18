// BENTONVILLE ROYALE — Crystal Bridges galleries: where every work hangs (pure; no three.js).
//
//   placeArt(hangLines, wings, artIndex, obstacles) -> [{ work, wing, pv, x, y, z, nx, nz, w, h, plaque: { x, y, z } }]
//
// Sizing follows musewalk (src/hall.js, MIT): h = maxH (2.35 m); w = h * aspect; if w > maxW
// (2.7, or 3.9 for `wide` works) then w = maxW and h = w / aspect. Hung with the centre at
// floor + 2.42 m (musewalk HANG_Y) unless the ceiling is low. Each label plaque sits 0.46 m to
// the viewer's right of the frame at floor + 1.42 m. Works fill each wing's longest walls first.

import { PAVILIONS } from '../site.js';
import { sidePoint, sideNormal, WALL_T } from '../build.js';

export const HANG_Y = 2.42;
export const PLAQUE_Y = 1.42;
const MAX_H = 2.35;
const GAP = 1.6; // free wall between neighbouring frames (plaque included separately)
const PLAQUE_W = 1.2;
const PLAQUE_GAP = 0.46;
const EDGE = 1.0; // keep this far from a wall's ends (corners, door jambs)

/** musewalk's painting size rule. */
export function paintingSize(aspect, wide = false) {
  const a = aspect > 0 ? aspect : 1;
  let h = MAX_H;
  let w = h * a;
  const maxW = wide ? 3.9 : 2.7;
  if (w > maxW) {
    w = maxW;
    h = w / a;
  }
  return { w, h };
}

/** Position / inward normal along a hang line at distance s from its start; null when off the line. */
function lineAt(L, s) {
  if (L.type === 'line') {
    const len = Math.hypot(L.bx - L.ax, L.bz - L.az);
    if (s < 0 || s > len) return null;
    const t = s / len;
    return { x: L.ax + (L.bx - L.ax) * t, z: L.az + (L.bz - L.az) * t, nx: L.nx, nz: L.nz };
  }
  const pv = PAVILIONS.find((p) => p.id === L.pv);
  const u = L.a + s;
  if (u < L.a || u > L.b) return null;
  const [x, z] = sidePoint(pv, L.side, u);
  // inward normal of a (possibly bowed) wall: perpendicular to the local tangent, toward the room
  const [x2, z2] = sidePoint(pv, L.side, Math.min(L.b, u + 0.05));
  const [x1, z1] = sidePoint(pv, L.side, Math.max(L.a, u - 0.05));
  const tx = x2 - x1;
  const tz = z2 - z1;
  const tl = Math.hypot(tx, tz) || 1;
  let nx = -tz / tl;
  let nz = tx / tl;
  const [sx, sz] = sideNormal(L.side);
  if (nx * sx + nz * sz < 0) {
    nx = -nx;
    nz = -nz;
  }
  // the wall face, not its centre line
  return { x: x + nx * (WALL_T / 2), z: z + nz * (WALL_T / 2), nx, nz };
}

export function lineLength(L) {
  return L.type === 'line' ? Math.hypot(L.bx - L.ax, L.bz - L.az) : L.b - L.a;
}

function blocked(obstacles, x, z, nx, nz, w) {
  // the strip in front of the frame: from the wall 1.3 m into the room, frame width + 0.6
  const rx = nz;
  const rz = -nx;
  for (let k = -1; k <= 1; k++) {
    for (const d of [0.4, 1.2]) {
      const px = x + nx * d + rx * k * (w / 2 + 0.3);
      const pz = z + nz * d + rz * k * (w / 2 + 0.3);
      for (const o of obstacles) if (px > o.x0 && px < o.x1 && pz > o.z0 && pz < o.z1) return true;
    }
  }
  return false;
}

/**
 * wings: config wings ({ id, works: [{ art?, placeholder?, aspect?, wide? }] });
 * artIndex: workId -> manifest entry ({ width, height, ... }) for the files that exist.
 * obstacles: axis-aligned rects { x0, x1, z0, z1 } that must stay clear in front of art.
 */
export function placeArt(hangLines, wings, artIndex, obstacles = []) {
  const out = [];
  for (const wing of wings) {
    const lines = hangLines.filter((L) => L.wing === wing.id).sort((p, q) => lineLength(q) - lineLength(p));
    if (!lines.length) continue;
    let li = 0;
    let cursor = EDGE;
    for (const work of wing.works || []) {
      const entry = work.art ? artIndex[work.art] : null;
      const aspect = entry ? entry.width / entry.height : work.aspect || 0.8;
      let placed = false;
      while (li < lines.length && !placed) {
        const L = lines[li];
        const len = lineLength(L);
        const roomH = L.top - L.floor;
        const size = paintingSize(aspect, !!work.wide);
        let { w, h } = size;
        if (h > roomH - 1.3) {
          h = Math.max(0.8, roomH - 1.3);
          w = h * aspect;
        }
        const need = w + PLAQUE_GAP + PLAQUE_W;
        if (cursor + need + EDGE > len) {
          li++;
          cursor = EDGE;
          continue;
        }
        const c = lineAt(L, cursor + w / 2);
        if (!c || blocked(obstacles, c.x, c.z, c.nx, c.nz, need)) {
          cursor += 1;
          continue;
        }
        const y = Math.min(L.floor + HANG_Y, L.top - h / 2 - 0.4);
        // the viewer faces the wall (-n); their right is (n.z, -n.x)
        const pr = lineAt(L, cursor + w + PLAQUE_GAP + PLAQUE_W / 2) || c;
        out.push({
          work, wing: wing.id, pv: L.pv, entry, aspect,
          x: c.x, y, z: c.z, nx: c.nx, nz: c.nz, w, h,
          plaque: { x: pr.x, y: L.floor + PLAQUE_Y, z: pr.z, nx: pr.nx, nz: pr.nz },
          floor: L.floor,
        });
        cursor += need + GAP;
        placed = true;
      }
    }
  }
  return out;
}

/** Obstacle rects from build.js parts (stairs, landings, small rooms) and tall props (shelves, cases). */
export function obstaclesFrom(site) {
  const out = [];
  const rectOf = (p) => {
    const ex = Math.abs(Math.cos(p.yaw || 0)) * p.hx + Math.abs(Math.sin(p.yaw || 0)) * p.hz;
    const ez = Math.abs(Math.sin(p.yaw || 0)) * p.hx + Math.abs(Math.cos(p.yaw || 0)) * p.hz;
    return { x0: p.cx - ex, x1: p.cx + ex, z0: p.cz - ez, z1: p.cz + ez };
  };
  for (const p of site.parts) if (p.stair || p.room || p.threshold || p.plinth || p.statue) out.push(rectOf(p));
  for (const p of site.props) if (p.type === 'shelf' || p.type === 'case' || p.type === 'counter') out.push(rectOf(p));
  return out;
}
