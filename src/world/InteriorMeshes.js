// BENTONVILLE ROYALE — interior geometry for a hollow building's plan (Interiors.js): partition
// walls (both faces, end caps, lintel undersides) coloured per room kind, and per-room floor
// colour overlays. Everything goes into the building chunk's merged geometry (WorldMeshes.js,
// same material; aWall.z = -1 so the window shader leaves it alone). Each breakable inner
// panel's quads are consecutive and their index range is recorded in chunk.panelRanges so
// view.hidePanel / showPanel can blank / restore them.

import * as THREE from 'three';
import { FLOOR_THICKNESS } from './interiors/storeys.js';
import { addStairGeometry } from './InteriorStairs.js';
import { addFurnishingGeometry } from './InteriorFurnishings.js';
import { clipRect, toLocal, toWorld } from './interiors/layout.js';

// [wall, floor] per room kind
const ROOM_COLORS = {
  living: [0xeee4d0, 0xa47b52],
  bedroom: [0xdfe6ee, 0xb08d68],
  kitchen: [0xf3eedf, 0xc9c2b3],
  dining: [0xeadccb, 0x9c7650],
  bath: [0xdcefef, 0xd8dcdc],
  corridor: [0xe8e4dc, 0x8f8a82],
  hall: [0xf1efe9, 0x9a958c],
  lobby: [0xece6da, 0xb9aa92],
  sales: [0xf5f3ee, 0xbdb8ae],
  storage: [0xd6d1c4, 0x80796f],
  office: [0xe4e8ea, 0x7d8a96],
  vault: [0xc9cdd1, 0x6f747a],
  break: [0xf0e6cf, 0xb5a17e],
  restroom: [0xe2eef0, 0xcfd6d8],
  apartment: [0xeee6d6, 0xa8845e],
  greenhouse: [0xe6efe0, 0x8a7a5e],
  garage: [0xcfcfcb, 0x77777a],
  open: [0xe9e4d8, 0x9b917f],
};
const DEFAULT_COLORS = [0xe9e1cf, 0x9b917f];
const _col = new THREE.Color();
const rgb = (hex) => {
  _col.setHex(hex);
  return [_col.r, _col.g, _col.b];
};

/**
 * shell: World collider.shell with .plan; h: building height (aH attribute);
 * api: { quad, hcapFlat } from WorldMeshes.
 */
export function addInteriorGeometry(chunk, shell, h, api) {
  const plan = shell.plan;
  const { quad, hcapFlat } = api;
  const F = plan.frame;
  const inner = shell.inner;
  // inner polygon in the plan frame (room floors are clipped to it)
  const P = new Array(inner.length);
  for (let i = 0; i < inner.length; i += 2) {
    const [a, b] = toLocal(F, inner[i], inner[i + 1]);
    P[i] = a;
    P[i + 1] = b;
  }
  for (const L of plan.levels) {
    const base = L.y - shell.floor;
    const kindOf = (r) => (r >= 0 && L.rooms[r] ? L.rooms[r].kind : null);
    const wallRgb = (r) => rgb((ROOM_COLORS[kindOf(r)] || DEFAULT_COLORS)[0]);

    // ---- room floors (+0.02 over the interior floor)
    for (const r of L.rooms) {
      let rects = [{a0:r.a0,b0:r.b0,a1:r.a1,b1:r.b1}];
      for (const hole of L.holes) {
        const next=[];
        for(const R of rects) {
          const a0=Math.max(R.a0,hole.a0),a1=Math.min(R.a1,hole.a1),b0=Math.max(R.b0,hole.b0),b1=Math.min(R.b1,hole.b1);
          if(a0>=a1||b0>=b1){next.push(R);continue;}
          next.push({a0:R.a0,b0:R.b0,a1:a0,b1:R.b1},{a0:a1,b0:R.b0,a1:R.a1,b1:R.b1},{a0,b0:R.b0,a1,b1:b0},{a0,b0:b1,a1,b1:R.b1});
        }
        rects=next.filter(R=>R.a1-R.a0>.01&&R.b1-R.b0>.01);
      }
      for(const R of rects) {
        const poly=clipRect(P,R.a0,R.b0,R.a1,R.b1);
        if(poly.length<6)continue;
        const pts=[];
        for(let i=0;i<poly.length;i+=2)pts.push(...toWorld(F,poly[i],poly[i+1]));
        hcapFlat(chunk,pts,base+0.05,(ROOM_COLORS[r.kind]||DEFAULT_COLORS)[1],h);
        if(L.i>0)hcapFlat(chunk,pts,base-FLOOR_THICKNESS,0xd7d0c3,h,-1);
      }
    }

    // ---- partitions
    const W = L.walls;
    for (let k = 0, w = 0; k < W.length; k += 7, w++) {
      const meta = L.wallMeta[w];
      let ax = W[k];
      let az = W[k + 1];
      let bx = W[k + 2];
      let bz = W[k + 3];
      const r = W[k + 4];
      const y0 = W[k + 5] - shell.floor;
      const y1 = W[k + 6] - shell.floor;
      const ex = bx - ax;
      const ez = bz - az;
      const len = Math.hypot(ex, ez);
      if (len < 1e-4) continue;
      const tx = ex / len;
      const tz = ez / len;
      const solid = meta.kind === 'wall';
      if (solid) {
        // a solid run is drawn out to its capsule's reach (r past each end)
        ax -= tx * r;
        az -= tz * r;
        bx += tx * r;
        bz += tz * r;
      }
      // side normal of the wall direction; meta (nx, nz) points toward room rb
      const sx = -tz;
      const sz = tx;
      const flip = sx * meta.nx + sz * meta.nz < 0; // +s side is ra's side when flipped
      const [pr, pg, pb] = wallRgb(flip ? meta.ra : meta.rb);
      const [mr, mg, mb] = wallRgb(flip ? meta.rb : meta.ra);
      const A = (s, y) => [ax + sx * r * s, y, az + sz * r * s];
      const B = (s, y) => [bx + sx * r * s, y, bz + sz * r * s];
      const i0 = chunk.buf.idx.length;
      quad(chunk, A(1, y0), B(1, y0), B(1, y1), A(1, y1), sx, 0, sz, pr, pg, pb, null, h);
      quad(chunk, A(-1, y0), B(-1, y0), B(-1, y1), A(-1, y1), -sx, 0, -sz, mr, mg, mb, null, h);
      if (solid) {
        // end caps (door jambs, or the cut end beside a broken neighbour)
        // (inset from both faces so their edges never show through the seam beside a neighbour)
        quad(chunk, A(-0.75, y0), A(0.75, y0), A(0.75, y1), A(-0.75, y1), -tx, 0, -tz, mr, mg, mb, null, h);
        quad(chunk, B(-0.75, y0), B(0.75, y0), B(0.75, y1), B(-0.75, y1), tx, 0, tz, pr, pg, pb, null, h);
        const pn = meta.panel >= 0 ? plan.panels[meta.panel] : null;
        if (pn) chunk.panelRanges.push(pn, i0, chunk.buf.idx.length - i0);
      } else {
        // lintel underside
        quad(chunk, A(-1, y0), B(-1, y0), B(1, y0), A(1, y0), 0, -1, 0, mr, mg, mb, null, h);
      }
    }
  }
  addStairGeometry(chunk,shell,h,api);
  addFurnishingGeometry(chunk,shell,h,api);
}
