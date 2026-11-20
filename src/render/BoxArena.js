// BoxArena - the Box Fights arena visuals: a solid indoor room in the game's cartoon style.
// Cream/ink checker floor, opaque walls (ink wainscot, violet upper panels, cream pilasters every
// 4 m, sun-gold trim at the floor, chair rail and ceiling line), a solid ink ceiling and cream
// light panels with thin gold frames. Colours follow the HUD tokens (--br-ink / --br-cream /
// --br-sun in hud.css). Original design; nothing is borrowed from any third-party map.
//
//   const arena = buildArenaMeshes(layout);   // layout from arenaLayout(): { rect, floorY, ceilY, ... }
//   scene.add(arena.group);  arena.update(dt);  arena.dispose();
//   arena.setDivider(up, { animate })   // the middle wall: down between rounds, slides up into the ceiling at FIGHT
//
// Pure presentation: the collision boxes live in World (addBox). Nothing here casts a shadow, and
// every position is in world metres (x east, z south, y up). Works headless (no canvas needed).
// Five merged meshes in total: floor, walls, ceiling, lights and the middle wall.
import * as THREE from 'three';
import { toonGradient } from './Toon.js';

const CELL = 4; // build grid, metres
const INK = 0x15103a;
const INK_LIGHT = 0x2c2370; // checker dark cell: lighter than the ink so the floor reads
const CREAM = 0xfff6dc;
const SUN = 0xffc21f;
const VIOLET = 0x6b3fd1; // upper wall panels (a deeper violet than the old barrier glow)
const INSET = 0.02; // walls sit just inside the interior rect (the collider is just outside it)
const LAYER = 0.03; // extra inset per decoration layer, against z-fighting
const WAINSCOT = 1.2; // ink band height
const RAIL = 0.2; // gold strip height (chair rail, floor and ceiling lines)
const PILASTER = 0.4; // cream strip width
const LIGHT_DROP = 0.02; // panels hang this far under the ceiling plane
const FRAME = 0.18; // gold frame width around a light panel

/** Accumulates non-indexed triangles with per-vertex colour. */
function builder() {
  const pos = [];
  const col = [];
  const c = new THREE.Color();
  return {
    quad(a, b, cc, d, hex) {
      pos.push(...a, ...b, ...cc, ...a, ...cc, ...d);
      c.setHex(hex);
      for (let k = 0; k < 6; k++) col.push(c.r, c.g, c.b);
    },
    build(withColor = true) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      if (withColor) g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      g.computeVertexNormals();
      return g;
    },
  };
}

const cells = (rect) => ({
  nx: Math.max(1, Math.round((rect.maxX - rect.minX) / CELL)),
  nz: Math.max(1, Math.round((rect.maxZ - rect.minZ) / CELL)),
});

function floorGeometry(rect, y) {
  const { nx, nz } = cells(rect);
  const b = builder();
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < nz; j++) {
      const x0 = rect.minX + i * CELL;
      const z0 = rect.minZ + j * CELL;
      // counter-clockwise seen from above (+y normal)
      b.quad([x0, y, z0], [x0, y, z0 + CELL], [x0 + CELL, y, z0 + CELL], [x0 + CELL, y, z0], (i + j) % 2 === 0 ? CREAM : INK_LIGHT);
    }
  }
  return b.build();
}

/** Four inward-facing wall faces with layered colour bands, pilasters and gold trim. */
function wallGeometry(rect, y0, y1) {
  const { nx, nz } = cells(rect);
  const x0 = rect.minX + INSET;
  const x1 = rect.maxX - INSET;
  const z0 = rect.minZ + INSET;
  const z1 = rect.maxZ - INSET;
  // origin, unit direction along the wall, inward normal, length, grid line count
  const sides = [
    { a: [x0, z0], d: [1, 0], n: [0, 1], len: x1 - x0, lines: nx },
    { a: [x1, z0], d: [0, 1], n: [-1, 0], len: z1 - z0, lines: nz },
    { a: [x1, z1], d: [-1, 0], n: [0, -1], len: x1 - x0, lines: nx },
    { a: [x0, z1], d: [0, -1], n: [1, 0], len: z1 - z0, lines: nz },
  ];
  const b = builder();
  const wy1 = Math.max(y0 + WAINSCOT, y1);
  for (const { a, d, n, len, lines } of sides) {
    const pt = (s, y, layer) => [a[0] + d[0] * s + n[0] * layer * LAYER, y, a[1] + d[1] * s + n[1] * layer * LAYER];
    const strip = (s0, s1, h0, h1, layer, hex) => b.quad(pt(s0, h0, layer), pt(s1, h0, layer), pt(s1, h1, layer), pt(s0, h1, layer), hex);
    // layer 0: ink wainscot, violet upper panel
    strip(0, len, y0, y0 + WAINSCOT, 0, INK);
    strip(0, len, y0 + WAINSCOT, wy1, 0, VIOLET);
    // layer 1: cream pilasters on the interior grid lines
    for (let i = 1; i < lines; i++) {
      const s = (i / lines) * len;
      strip(s - PILASTER / 2, s + PILASTER / 2, y0 + RAIL, wy1 - RAIL, 1, CREAM);
    }
    // layer 2: gold trim at the floor, chair rail and ceiling line
    strip(0, len, y0, y0 + RAIL, 2, SUN);
    strip(0, len, y0 + WAINSCOT - RAIL / 2, y0 + WAINSCOT + RAIL / 2, 2, SUN);
    strip(0, len, wy1 - RAIL, wy1, 2, SUN);
  }
  return b.build();
}

/** Solid ceiling plane, normal facing down. */
function ceilingGeometry(rect, y) {
  const b = builder();
  b.quad([rect.minX, y, rect.minZ], [rect.maxX, y, rect.minZ], [rect.maxX, y, rect.maxZ], [rect.minX, y, rect.maxZ], INK);
  return b.build(false);
}

/** One cream panel per 2x2 cells with a thin gold frame, hanging just under the ceiling. */
function lightGeometry(rect, y) {
  const { nx, nz } = cells(rect);
  const py = y - LIGHT_DROP;
  const half = CELL * 0.8; // panel half size (6.4 m wide across a 8 m block)
  const b = builder();
  const down = (xa, za, xb, zb, hex) => b.quad([xa, py, za], [xb, py, za], [xb, py, zb], [xa, py, zb], hex); // faces down
  for (let i = 0; i + 2 <= nx; i += 2) {
    for (let j = 0; j + 2 <= nz; j += 2) {
      const cx = rect.minX + (i + 1) * CELL;
      const cz = rect.minZ + (j + 1) * CELL;
      const h = half - FRAME;
      down(cx - h, cz - h, cx + h, cz + h, CREAM);
      down(cx - half, cz - half, cx + half, cz - h, SUN); // north
      down(cx - half, cz + h, cx + half, cz + half, SUN); // south
      down(cx - half, cz - h, cx - h, cz + h, SUN); // west
      down(cx + h, cz - h, cx + half, cz + h, SUN); // east
    }
  }
  return b.build();
}

/**
 * @param {{ rect: {minX:number,maxX:number,minZ:number,maxZ:number}, floorY: number, ceilY: number }} layout
 * @returns {{ group: THREE.Group, update: (dt: number) => void, dispose: () => void }}
 */
/**
 * The middle wall (both faces): an ink panel with gold up-chevrons (it lifts) between violet bands.
 * Faces sit at the collider's surfaces (midZ +- half); x spans the interior.
 */
function dividerGeometry(rect, floorY, ceilY, midZ, half) {
  const b = builder();
  const x0 = rect.minX + INSET;
  const x1 = rect.maxX - INSET;
  const h = ceilY - floorY;
  for (const [z, s] of [[midZ - half, -1], [midZ + half, 1]]) {
    const zz = z + s * 0.001;
    const face = (xa, xb, ya, yb, hex) => b.quad([xa, ya, zz], [xb, ya, zz], [xb, yb, zz], [xa, yb, zz], hex);
    const off = s * LAYER; // decoration slightly proud of the panel, on its own side
    const deco = (xa, xb, ya, yb, hex) => b.quad([xa, ya, zz + off], [xb, ya, zz + off], [xb, yb, zz + off], [xa, yb, zz + off], hex);
    face(x0, x1, floorY, ceilY, INK);
    // violet bands top and bottom, gold edges
    deco(x0, x1, floorY, floorY + 0.5, VIOLET);
    deco(x0, x1, ceilY - 0.5, ceilY, VIOLET);
    deco(x0, x1, floorY + 0.5, floorY + 0.5 + RAIL, SUN);
    deco(x0, x1, ceilY - 0.5 - RAIL, ceilY - 0.5, SUN);
    // a gold up-chevron per build cell, centred: the wall goes UP at FIGHT
    const cy = floorY + h * 0.5;
    const arm = 0.35;
    for (let x = rect.minX; x + CELL <= rect.maxX + 1e-6; x += CELL) {
      const cx = x + CELL / 2;
      for (const dy of [-0.7, 0.5]) {
        const y = cy + dy;
        // left arm and right arm of a "^" as two slanted quads
        const zc = zz + off * 2;
        b.quad([cx - 1.1, y, zc], [cx - 1.1 + arm, y, zc], [cx + arm * 0.5, y + 1.0, zc], [cx - arm * 0.5, y + 1.0, zc], SUN);
        b.quad([cx + 1.1 - arm, y, zc], [cx + 1.1, y, zc], [cx + arm * 0.5, y + 1.0, zc], [cx - arm * 0.5, y + 1.0, zc], SUN);
      }
    }
  }
  return b.build();
}

const LIFT_TIME = 0.35; // s: the middle wall slides up into the ceiling

const prefersReducedMotion = () => {
  try {
    return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
};

export function buildArenaMeshes(layout) {
  const { rect, floorY, ceilY } = layout;
  const group = new THREE.Group();
  group.name = 'BoxArena';
  const geometries = [];
  const materials = [];
  const add = (name, geo, mat, receiveShadow = false) => {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = name;
    mesh.castShadow = false;
    mesh.receiveShadow = receiveShadow;
    geometries.push(geo);
    materials.push(mat);
    group.add(mesh);
    return mesh;
  };
  const toon = (opts) => new THREE.MeshToonMaterial({ gradientMap: toonGradient(), ...opts });

  add('BoxArenaFloor', floorGeometry(rect, floorY), toon({ vertexColors: true }), true);
  add(
    'BoxArenaWalls',
    wallGeometry(rect, floorY, ceilY),
    toon({ vertexColors: true, side: THREE.FrontSide, transparent: false, depthWrite: true }),
  );
  add('BoxArenaCeiling', ceilingGeometry(rect, ceilY), toon({ color: INK, side: THREE.FrontSide }));
  add('BoxArenaLights', lightGeometry(rect, ceilY), new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.FrontSide }));
  // the middle wall: same footprint as layout.divider (when the layout has one)
  const midZ = (rect.minZ + rect.maxZ) / 2;
  const half = layout.divider && Number.isFinite(layout.divider.hz) ? layout.divider.hz : 0.25;
  const divider = add('BoxArenaDivider', dividerGeometry(rect, floorY, ceilY, midZ, half), toon({ vertexColors: true, side: THREE.DoubleSide }));
  const rise = ceilY - floorY;
  let lift = null; // seconds into the lift animation, or null when still

  let disposed = false;
  return {
    group,
    /** Middle wall down (up = true) or lifted. animate: slide up into the ceiling instead of vanishing. */
    setDivider(up, { animate = false } = {}) {
      if (up) {
        lift = null;
        divider.position.y = 0;
        divider.visible = true;
      } else if (animate && divider.visible && !prefersReducedMotion()) {
        lift = 0;
      } else {
        lift = null;
        divider.visible = false;
      }
    },
    get dividerUp() {
      return divider.visible && lift === null;
    },
    update(dt) {
      if (lift === null) return;
      lift += Math.max(0, dt || 0);
      const k = Math.min(1, lift / LIFT_TIME);
      divider.position.y = rise * k * k; // eases in: a heavy wall pulled up
      if (k >= 1) {
        lift = null;
        divider.visible = false;
        divider.position.y = 0;
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (group.parent) group.parent.remove(group);
      for (const g of geometries) g.dispose();
      for (const m of materials) m.dispose(); // the toon gradient is shared and left alone
      group.clear();
    },
  };
}
