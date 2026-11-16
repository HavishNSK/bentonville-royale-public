// Deterministic decorative dressing. Props intentionally have no collision: room navigation,
// loot and combat retain their existing contracts. All detail shares building-chunk culling.
import { q, inPoly, toLocal, toWorld } from './layout.js';

export const FURNISHING_LIMITS = Object.freeze({ furniture: 96, signs: 32, label: 18 });
const CIRCULATION = new Set(['corridor', 'hall', 'lobby', 'open']);
// kind, width, depth, height, colour. Keep props low enough to see combatants over most pieces.
const DRESSING = {
  bedroom: ['bed', 1.5, 2, 0.55, 0x7a91a5], apartment: ['bed', 1.5, 2, 0.55, 0x7a91a5],
  living: ['sofa', 2, 0.8, 0.8, 0xa66f4d], dining: ['table', 1.6, 0.9, 0.75, 0x997449],
  kitchen: ['counter', 1.8, 0.65, 0.9, 0xc8c1af], bath: ['sink', 0.7, 0.5, 0.85, 0xd4e1df],
  restroom: ['sink', 0.7, 0.5, 0.85, 0xd4e1df], sales: ['shelf', 1.5, 0.55, 1.35, 0xa68757],
  stall: ['counter', 1.8, 0.65, 0.9, 0xc8c1af], storage: ['crate', 0.8, 0.8, 0.8, 0x98774e],
  office: ['desk', 1.4, 0.7, 0.75, 0x9d8062], break: ['table', 1.6, 0.9, 0.75, 0x997449],
  vault: ['safe', 0.8, 0.7, 1.2, 0x66717c], garage: ['workbench', 1.6, 0.65, 0.85, 0x8d8270],
  greenhouse: ['planter', 1.2, 0.6, 0.7, 0x618653], gallery: ['display', 0.75, 0.75, 1, 0xd4c7b0],
};
const DEFAULT = ['bench', 1.4, 0.55, 0.5, 0x9c805b];
const mix = (h, n) => Math.imul(h ^ (n | 0), 0x01000193) >>> 0;
const contains = (r, a, b) => a >= r.a0 && a <= r.a1 && b >= r.b0 && b <= r.b1;
const overlaps = (a, b, pad = 0) => a.a0 - pad < b.a1 && a.a1 + pad > b.a0 && a.b0 - pad < b.b1 && a.b1 + pad > b.b0;

function stairRoom(plan, L, r) {
  for (const s of plan.stairs || []) {
    if (s.level !== L.i && s.level + 1 !== L.i) continue;
    const ri = s.level === L.i ? s.room0 ?? s.room : s.room1 ?? s.upperRoom;
    if (ri === r.id) return true;
    for (const k of ['0', '1']) {
      const [a,b] = toLocal(plan.frame, s['x' + k], s['z' + k]);
      if (contains(r,a,b)) return true;
    }
  }
  return false;
}

function blocked(p, plan, shell, L, r) {
  const F = plan.frame;
  // Footprint corners and edges must be inside even on clipped/concave rooms.
  for (const a of [p.a0, (p.a0+p.a1)/2, p.a1]) for (const b of [p.b0, (p.b0+p.b1)/2, p.b1]) {
    const [x,z] = toWorld(F,a,b);
    if (!inPoly(shell.inner,x,z)) return true;
  }
  const doors = [...L.doors, ...(L.i === 0 ? shell.doors || [] : [])];
  for (const d of doors) {
    if (d.roomA != null && d.roomA !== r.id && d.roomB !== r.id) continue;
    const [a,b] = toLocal(F,d.x,d.z);
    const [ca,cb] = toLocal(F,r.cx,r.cz);
    // Reserve the entire rectangle swept by the door-to-room-centre navigation leg.
    if (overlaps(p,{a0:Math.min(a,ca)-0.8,a1:Math.max(a,ca)+0.8,b0:Math.min(b,cb)-0.8,b1:Math.max(b,cb)+0.8})) return true;
  }
  for (const spot of plan.lootSpots || []) {
    if (spot.level !== L.i) continue;
    const [a,b] = toLocal(F,spot.x,spot.z);
    if (overlaps(p,{a0:a-0.9,a1:a+0.9,b0:b-0.9,b1:b+0.9})) return true;
  }
  return false;
}

function roomProps(plan,shell,L,r) {
  if (CIRCULATION.has(r.kind) || stairRoom(plan,L,r)) return [];
  const [kind,w,d,height,color] = DRESSING[r.kind] || DEFAULT;
  if (r.a1-r.a0 < w+0.8 || r.b1-r.b0 < d+0.8) return [];
  const out = [];
  for (const [a,b] of [[r.a0+0.35,r.b0+0.35],[r.a1-w-0.35,r.b1-d-0.35],[r.a1-w-0.35,r.b0+0.35],[r.a0+0.35,r.b1-d-0.35]]) {
    const p = {kind,level:L.i,room:r.id,a0:q(a),b0:q(b),a1:q(a+w),b1:q(b+d),y:L.y,height,color};
    if (blocked(p,plan,shell,L,r) || out.some(o => overlaps(p,o,0.4))) continue;
    out.push(p);
    if (out.length === 2) break;
  }
  return out;
}

function roomSign(plan,L,r) {
  const d = L.doors.find(d => !d.open && (d.roomA === r.id || d.roomB === r.id));
  if (!d || L.ceil - L.y < plan.doorH + 0.3) return null;
  const text = String(r.label || r.kind || 'ROOM').normalize('NFKD').replace(/[^a-zA-Z0-9 &-]/g,'').toUpperCase().slice(0,FURNISHING_LIMITS.label);
  if (!text) return null;
  const side = (r.cx-d.x)*d.nx+(r.cz-d.z)*d.nz >= 0 ? 1 : -1;
  return {level:L.i,room:r.id,text,x:q(d.x+d.nx*side*0.13),z:q(d.z+d.nz*side*0.13),y:q(L.y+plan.doorH+0.16),nx:d.nx*side,nz:d.nz*side,width:q(Math.min(1.8,Math.max(0.6,text.length*0.085))),height:0.28};
}

/** Pure plan postprocessor; call once after floors, stairs, walls and loot spots exist. */
export function furnishInterior(plan,shell) {
  const furniture = [], signs = [];
  for (const L of plan.levels) for (const r of L.rooms) {
    if (furniture.length < FURNISHING_LIMITS.furniture) furniture.push(...roomProps(plan,shell,L,r).slice(0,FURNISHING_LIMITS.furniture-furniture.length));
    if (signs.length < FURNISHING_LIMITS.signs) {
      const s = roomSign(plan,L,r);
      if (s) signs.push(s);
    }
  }
  let hash = mix(plan.hash,2); // furnishing schema revision
  for (const p of furniture) {
    for (const n of [p.level,p.room,p.a0*64,p.b0*64,p.a1*64,p.b1*64,p.y*64,p.height*64,p.color]) hash=mix(hash,n);
    for (const c of p.kind) hash=mix(hash,c.charCodeAt(0));
  }
  for (const s of signs) {
    for (const n of [s.level,s.room,s.x*64,s.z*64,s.y*64,s.width*64,Math.round(s.nx*65536),Math.round(s.nz*65536)]) hash=mix(hash,n);
    for (const c of s.text) hash=mix(hash,c.charCodeAt(0));
  }
  return {...plan,furniture,signs,colliders:[...(plan.colliders || [])],hash};
}
