// Low-poly room props, ceiling light panels and readable room plaques. Everything shares the
// existing merged building material, chunk distance culling and frustum culling: no textures,
// per-prop meshes, scene lights or per-frame work. Shapes are built in a face-aware "item
// space" (u across the front, v from the back (0) to the front (d), y up) that is mapped into
// the prop's axis-aligned plan footprint, and every vertex is clamped to that footprint and to
// [lift, lift + height] so props never poke through walls or each other's reservations.
// Prop schema: see the plan.furniture doc in src/world/Interiors.js / furnishings.js.
import { toWorld } from './interiors/layout.js';

// Original 3x5 block alphabet: bit 14 is the top-left pixel. Unsupported characters are blank.
const GLYPHS = {
  A:'010101111101101', B:'110101110101110', C:'011100100100011', D:'110101101101110',
  E:'111100110100111', F:'111100110100100', G:'011100101101011', H:'101101111101101',
  I:'111010010010111', J:'001001001101010', K:'101101110101101', L:'100100100100111',
  M:'101111111101101', N:'101111111111101', O:'010101101101010', P:'110101110100100',
  Q:'010101101111011', R:'110101110101101', S:'011100010001110', T:'111010010010010',
  U:'101101101101111', V:'101101101101010', W:'101101111111101', X:'101101010101101',
  Y:'101101010010010', Z:'111001010100111', '0':'111101101101111', '1':'010110010010111',
  '2':'110001010100111', '3':'110001010001110', '4':'101101111001001', '5':'111100110001110',
  '6':'011100111101111', '7':'111001010010010', '8':'111101111101111', '9':'111101111001110',
  '-':'000000111000000', '&':'010101010101011',
};
const linear = v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
const rgb = hex => [linear((hex>>16 & 255)/255),linear((hex>>8 & 255)/255),linear((hex & 255)/255)];
const byte = v => v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
/** Multiply a hex colour's channels by k (k < 1 darkens). */
const shade = (hex, k) => (byte((hex>>16&255)*k)<<16) | (byte((hex>>8&255)*k)<<8) | byte((hex&255)*k);
/** Blend hex toward `to` by t (0..1). */
const blend = (hex, to, t) => {
  const m = (s) => byte(((hex>>s)&255) * (1-t) + ((to>>s)&255) * t);
  return (m(16)<<16) | (m(8)<<8) | m(0);
};

// Cartoon palette (AGENTS.md §21): violet/ink, sun-gold, cream, terracotta, sage, dusty blue, woods.
const INK = 0x3a2f4d, VIOLET = 0x5b3f8f, GOLD = 0xf2b33d, CREAM = 0xf4ead6, TERRA = 0xc8643f;
const SAGE = 0x86a17a, DUSTY = 0x6f8fb3, WOOD = 0x9a6e48, DARKWOOD = 0x5f4434, STEEL = 0xb4b8bc;
const ART = [VIOLET, GOLD, CREAM, TERRA, SAGE, DUSTY, INK, 0xe58f6a, 0x8f6fb8, 0x4f7f6a];
const GOODS = [TERRA, GOLD, DUSTY, SAGE, 0xe58f6a, 0x8f6fb8, 0xd9c27a, 0x7aa6b8, 0xc77f9b, CREAM];
const LEAF = [0x5f8a4a, 0x6f9a55, 0x4f7a44];
const LIGHT_PANEL = 0xfff3d6, LIGHT_RIM = 0xd8d0c0, POOL_TINT = 0xfff1cf;

// Item-space face bits, and plan-frame face bits used by boxPlan.
const FR = 1, BK = 2, RT = 4, LF = 8, TP = 16, DN = 32, SIDES = 15, ALL = 31;
const NOBK = ALL & ~BK;
const PB0 = 1, PA1 = 2, PB1 = 4, PA0 = 8;
// item [front, back, right(+u), left(-u)] -> plan face bits, per prop `face`
const SIDE_MAP = { 'b+': [PB1,PB0,PA1,PA0], 'b-': [PB0,PB1,PA0,PA1], 'a+': [PA1,PA0,PB0,PB1], 'a-': [PA0,PA1,PB1,PB0] };
// visual tops above the collision height (contract: TV on top of the stand, sculpture on a plinth)
export const VISUAL_TOP = Object.freeze({ tv_stand: 1.3, plinth: 1.9 });
/** Props that never get a contact shadow (they are flat, or fill their own footprint). */
const NO_SHADOW = new Set(['rug','court_lines','stage','bleachers','plant']);
const ALIASES = { table: 'dining_table', display: 'plinth', pedestal: 'plinth' };

/** Axis-aligned box in the plan frame. mask bits: PB0, PA1, PB1, PA0, top (16), bottom (32). */
function boxPlan(ctx,a0,b0,a1,b1,y0,y1,color,mask) {
  const {chunk,F,h,quad} = ctx;
  const tall = y1 - y0 > 1e-4, wa = a1 - a0 > 1e-4, wb = b1 - b0 > 1e-4;
  if (!wa && !wb) return;
  const P = (a,b,y) => { const [x,z] = toWorld(F,a,b); return [x,y,z]; };
  const A=P(a0,b0,y0), B=P(a1,b0,y0), C=P(a1,b1,y0), D=P(a0,b1,y0);
  const E=P(a0,b0,y1), G=P(a1,b0,y1), H=P(a1,b1,y1), I=P(a0,b1,y1);
  const [r,g,bl] = rgb(color);
  const Q = (p,n) => { quad(chunk,...p,...n,r,g,bl,null,h); ctx.n++; };
  if (tall && wa && (mask & PB0)) Q([A,B,G,E],[-F.vx,0,-F.vz]);
  if (tall && wb && (mask & PA1)) Q([B,C,H,G],[F.ux,0,F.uz]);
  if (tall && wa && (mask & PB1)) Q([C,D,I,H],[F.vx,0,F.vz]);
  if (tall && wb && (mask & PA0)) Q([D,A,E,I],[-F.ux,0,-F.uz]);
  if (wa && wb && (mask & TP)) Q([E,G,H,I],[0,1,0]);
  if (wa && wb && (mask & DN)) Q([A,B,C,D],[0,-1,0]);
}

/** Face-aware builder for one prop: item space -> clamped plan footprint -> world. */
function itemSpace(ctx,p,base,V) {
  const face = SIDE_MAP[p.face] ? p.face : 'b+';
  const {a0,b0,a1,b1} = p;
  const alongA = face[0] === 'b';
  const w = alongA ? a1 - a0 : b1 - b0, d = alongA ? b1 - b0 : a1 - a0;
  const sides = SIDE_MAP[face];
  const cl = (v,hi) => v < 0 ? 0 : v > hi ? hi : v;
  const map = (u,v) => face === 'b+' ? [a0+u,b0+v] : face === 'b-' ? [a1-u,b1-v] : face === 'a+' ? [a0+v,b1-u] : [a1-v,b0+u];
  const rot = (nu,nv) => face === 'b+' ? [nu,nv] : face === 'b-' ? [-nu,-nv] : face === 'a+' ? [nv,-nu] : [-nv,nu];
  const B = (u0,v0,u1,v1,y0,y1,col,mask=ALL) => {
    u0=cl(u0,w); u1=cl(u1,w); v0=cl(v0,d); v1=cl(v1,d); y0=cl(y0,V); y1=cl(y1,V);
    if (u1 < u0) [u0,u1] = [u1,u0];
    if (v1 < v0) [v0,v1] = [v1,v0];
    if (y1 < y0) [y0,y1] = [y1,y0];
    const [pa,pb] = map(u0,v0), [qa,qb] = map(u1,v1);
    let m = mask & (TP|DN);
    for (let i = 0; i < 4; i++) if (mask & (1<<i)) m |= sides[i];
    boxPlan(ctx,Math.min(pa,qa),Math.min(pb,qb),Math.max(pa,qa),Math.max(pb,qb),base+y0,base+y1,col,m);
  };
  /** Free quad: pts = 4 x [u, v, y] in order around the quad, n = [nu, nv, ny] item-space normal. */
  const Q = (pts,n,col) => {
    const [na,nb] = rot(n[0],n[1]);
    const F = ctx.F;
    let nx = na*F.ux + nb*F.vx, nz = na*F.uz + nb*F.vz, ny = n[2];
    const len = Math.sqrt(nx*nx + ny*ny + nz*nz) || 1;
    nx /= len; ny /= len; nz /= len;
    const W = pts.map(([u,v,y]) => { const [a,b] = map(cl(u,w),cl(v,d)); const [x,z] = toWorld(F,a,b); return [x,base+cl(y,V),z]; });
    const [r,g,bl] = rgb(col);
    ctx.quad(ctx.chunk,W[0],W[1],W[2],W[3],nx,ny,nz,r,g,bl,null,ctx.h);
    ctx.n++;
  };
  /** Octagonal prism around (cu, cv) with half sizes ru, rv and chamfer k; optional top cap. */
  const oct = (cu,cv,ru,rv,k,y0,y1,col,top=true) => {
    const R = ring(cu,cv,ru,rv,k);
    for (let i = 0; i < 8; i++) {
      const [u0,v0] = R[i], [u1,v1] = R[(i+1)%8];
      const mu = (u0+u1)/2 - cu, mv = (v0+v1)/2 - cv;
      let nu = v1 - v0, nv = u0 - u1;
      if (nu*mu + nv*mv < 0) { nu = -nu; nv = -nv; }
      Q([[u0,v0,y0],[u1,v1,y0],[u1,v1,y1],[u0,v0,y1]],[nu,nv,0],col);
    }
    if (top) octTop(cu,cv,ru,rv,k,y1,col);
  };
  const octTop = (cu,cv,ru,rv,k,y,col) => {
    Q([[cu-ru,cv-rv+k,y],[cu+ru,cv-rv+k,y],[cu+ru,cv+rv-k,y],[cu-ru,cv+rv-k,y]],[0,0,1],col);
    Q([[cu-ru+k,cv-rv,y],[cu+ru-k,cv-rv,y],[cu+ru,cv-rv+k,y],[cu-ru,cv-rv+k,y]],[0,0,1],col);
    Q([[cu-ru,cv+rv-k,y],[cu+ru,cv+rv-k,y],[cu+ru-k,cv+rv,y],[cu-ru+k,cv+rv,y]],[0,0,1],col);
  };
  /** Sloped octagonal band from (ru0, rv0) at y0 to (ru1, rv1) at y1. */
  const cone = (cu,cv,ru0,rv0,k0,ru1,rv1,k1,y0,y1,col) => {
    const A = ring(cu,cv,ru0,rv0,k0), Bq = ring(cu,cv,ru1,rv1,k1);
    for (let i = 0; i < 8; i++) {
      const j = (i+1)%8;
      const mu = (A[i][0]+A[j][0])/2 - cu, mv = (A[i][1]+A[j][1])/2 - cv;
      const ml = Math.sqrt(mu*mu + mv*mv) || 1;
      const drop = Math.max(ru0-ru1, rv0-rv1);
      Q([[A[i][0],A[i][1],y0],[A[j][0],A[j][1],y0],[Bq[j][0],Bq[j][1],y1],[Bq[i][0],Bq[i][1],y1]],[mu/ml*(y1-y0),mv/ml*(y1-y0),drop],col);
    }
  };
  /** Four legs at the corners of (u0, v0)-(u1, v1), t thick, from 0 to y1. */
  const legs = (u0,v0,u1,v1,y1,t,col,mask=SIDES) => {
    for (const u of [u0,u1-t]) for (const v of [v0,v1-t]) B(u,v,u+t,v+t,0,y1,col,mask);
  };
  return {w,d,H:V,B,Q,oct,octTop,cone,legs};
}

function ring(cu,cv,ru,rv,k) {
  return [[cu-ru+k,cv-rv],[cu+ru-k,cv-rv],[cu+ru,cv-rv+k],[cu+ru,cv+rv-k],[cu+ru-k,cv+rv],[cu-ru+k,cv+rv],[cu-ru,cv+rv-k],[cu-ru,cv-rv+k]];
}

/** Deterministic integer stream from the prop's identity (no Math.random). */
function stream(p) {
  let s = (Math.imul(Math.round(p.a0*64)|0,0x9e3779b1) ^ Math.imul(Math.round(p.b0*64)|0,0x85ebca77)) >>> 0;
  for (const c of String(p.kind)) s = Math.imul(s ^ c.charCodeAt(0), 0x01000193) >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return (t ^ (t >>> 14)) >>> 0;
  };
}
const pick = (R,list) => list[R() % list.length];

// ------------------------------------------------------------------ shapes
// Each shape draws in item space: S.w across the front, S.d deep, S.H tall. c = colour, x = accent.

/** Thin front-facing panel detail (on a face that sits at v0 - ~0.01). */
const front = (S,u0,u1,y0,y1,v,col) => S.B(u0,v,u1,v,y0,y1,col,FR);
const topQ = (S,u0,v0,u1,v1,y,col) => S.B(u0,v0,u1,v1,y,y,col,TP);

function bed(S,c,x) {
  const {w,d,H,B} = S, wood = shade(c,0.62);
  const hb = Math.min(0.08,d*0.1);
  B(0,0,w,hb,0,H,wood,NOBK);                                  // headboard
  B(0.02,hb,w-0.02,d,0,0.26,wood,FR|LF|RT);                   // frame
  B(0.05,hb,w-0.05,d-0.03,0.26,0.4,CREAM,FR|LF|RT|TP);        // mattress
  B(0.03,d*0.38,w-0.03,d-0.01,0.3,0.43,c,FR|LF|RT|TP);        // blanket
  topQ(S,0.03,d*0.38,w-0.03,d*0.38+0.18,0.435,x);             // folded sheet band
  const pw = w/2 - 0.1;
  for (const u of [0.07, w/2+0.03]) B(u,hb+0.05,u+pw,hb+0.42,0.4,Math.min(H,0.52),blend(CREAM,0xffffff,0.3),FR|LF|RT|TP);
}

function nightstand(S,c,x) {
  const {w,d,H,B} = S;
  B(0.02,0,w-0.02,d-0.02,0,H-0.04,c,FR|LF|RT);
  B(0,0,w,d,H-0.04,H,shade(c,1.12),NOBK);
  front(S,0.06,w-0.06,H*0.45,H-0.09,d-0.015,shade(c,0.85));
  front(S,w/2-0.04,w/2+0.04,H*0.66,H*0.7,d-0.005,GOLD);
}

function dresser(S,c,x) {
  const {w,d,H,B} = S;
  B(0.02,0,w-0.02,d-0.02,0.06,H-0.04,c,FR|LF|RT);
  B(0.04,0,w-0.04,d-0.04,0,0.06,shade(c,0.55),FR|LF|RT);
  B(0,0,w,d,H-0.04,H,shade(c,1.12),NOBK);
  const n = 3, gap = 0.03, hh = (H-0.16-gap*n)/n;
  for (let i = 0; i < n; i++) {
    const y0 = 0.09 + i*(hh+gap);
    front(S,0.06,w-0.06,y0,y0+hh,d-0.015,shade(c,0.88));
    front(S,w/2-0.08,w/2+0.08,y0+hh*0.42,y0+hh*0.58,d-0.005,x||GOLD);
  }
}

function wardrobe(S,c,x) {
  const {w,d,H,B} = S;
  B(0.02,0,w-0.02,d-0.03,0,H-0.08,c,FR|LF|RT);
  B(0,0,w,d,H-0.08,H,shade(c,0.8),NOBK);                       // crown
  front(S,0.05,w/2-0.015,0.08,H-0.12,d-0.02,shade(c,1.08));
  front(S,w/2+0.015,w-0.05,0.08,H-0.12,d-0.02,shade(c,1.08));
  front(S,w/2-0.07,w/2-0.04,H*0.42,H*0.58,d-0.01,x||GOLD);
  front(S,w/2+0.04,w/2+0.07,H*0.42,H*0.58,d-0.01,x||GOLD);
}

function sofa(S,c,x,seats) {
  const {w,d,H,B} = S, arm = Math.min(0.18,w*0.2), back = Math.min(0.24,d*0.3);
  B(0.05,0.05,w-0.05,d-0.05,0,0.08,INK,SIDES);                 // plinth / feet
  B(0,0,w,back,0.08,H,c);                                      // back
  B(arm,back,w-arm,d,0.08,0.4,shade(c,0.85),FR|LF|RT);         // base
  B(0,0,arm,d,0.08,Math.min(H,0.62),c);                        // arms
  B(w-arm,0,w,d,0.08,Math.min(H,0.62),c);
  const n = seats, cw = (w-2*arm)/n;
  for (let i = 0; i < n; i++) {
    const u0 = arm + i*cw + 0.015, u1 = arm + (i+1)*cw - 0.015;
    B(u0,back,u1,d-0.02,0.4,0.5,shade(c,1.12),FR|LF|RT|TP);
    B(u0,back,u1,back+0.14,0.5,H-0.06,x ? blend(c,x,0.35) : shade(c,1.18),FR|TP);
  }
}

function coffeeTable(S,c,x) {
  const {w,d,H,B,legs} = S;
  B(0,0,w,d,H-0.05,H-0.004,c);
  legs(0.04,0.04,w-0.04,d-0.04,H-0.05,0.06,shade(c,0.6));
  B(0.1,0.1,w-0.1,d-0.1,0.1,0.13,shade(c,0.85),TP|FR|BK);
  topQ(S,w*0.55,d*0.3,w*0.8,d*0.65,H,x||TERRA);                // a book / tray
}

function tvStand(S,c,x) {
  const {w,d,H,B} = S, top = Math.min(0.55,H*0.45);
  B(0,0,w,d-0.02,0,top,c,FR|LF|RT|TP);
  front(S,0.05,w/2-0.02,0.06,top-0.06,d-0.01,shade(c,1.1));
  front(S,w/2+0.02,w-0.05,0.06,top-0.06,d-0.01,shade(c,1.1));
  B(w/2-0.12,d*0.3,w/2+0.12,d*0.55,top,top+0.03,INK,FR|LF|RT|TP);
  B(w/2-0.04,d*0.4,w/2+0.04,d*0.5,top+0.03,top+0.12,INK,FR|LF|RT);
  B(0.08,d*0.4,w-0.08,d*0.5,top+0.12,H,INK);                   // TV body
  front(S,0.12,w-0.12,top+0.16,H-0.04,d*0.5+0.004,blend(DUSTY,INK,0.35));
}

function rug(S,c,x) {
  const {w,d,H} = S, bw = Math.min(0.15,Math.min(w,d)*0.12);
  topQ(S,0,0,w,d,H*0.5,x||shade(c,0.7));
  topQ(S,bw,bw,w-bw,d-bw,H*0.75,c);
  if (w > 1 && d > 1) topQ(S,w*0.3,d*0.3,w*0.7,d*0.7,H,blend(c,x||CREAM,0.45));
}

function table(S,c,x) {
  const {w,d,H,B,legs} = S;
  B(0,0,w,d,H-0.05,H-0.004,c);
  B(0.06,0.06,w-0.06,d-0.06,H-0.13,H-0.05,shade(c,0.8),SIDES); // apron
  legs(0.06,0.06,w-0.06,d-0.06,H-0.13,0.07,shade(c,0.62));
  if (x) topQ(S,0.15,d*0.38,w-0.15,d*0.62,H,x);                 // runner
}

function chair(S,c,x) {
  const {w,d,H,B} = S, seat = Math.min(0.46,H*0.5), bt = Math.min(0.06,d*0.15);
  B(0.02,bt,w-0.02,d,seat-0.05,seat,c,FR|LF|RT|TP);
  B(0.02,0,w-0.02,bt,0,H,shade(c,0.85));                       // back slab + back legs
  for (const u of [0.03,w-0.07]) B(u,d-0.06,u+0.04,d-0.02,0,seat-0.05,shade(c,0.62),u < w/2 ? FR|LF : FR|RT);
}

function stool(S,c,x) {
  const {w,d,H,B} = S;
  B(0,0,w,d,H-0.06,H,c);
  B(w/2-0.03,d/2-0.03,w/2+0.03,d/2+0.03,0.04,H-0.06,STEEL,SIDES);
  B(w*0.15,d*0.15,w*0.85,d*0.85,0,0.04,shade(STEEL,0.7),TP|FR|RT);
}

function counter(S,c,x,island) {
  const {w,d,H,B} = S, top = blend(CREAM,c,0.15);
  B(0,island ? 0.03 : 0,w,d-0.03,0,H-0.04,c,island ? SIDES : FR|LF|RT);
  B(0,0,w,d,H-0.04,H-0.005,top,island ? ALL : NOBK);
  front(S,0,w,0,0.1,d-0.025,shade(c,0.5));                     // kick
  const n = Math.max(1,Math.min(5,Math.round(w/0.6))), dw = w/n;
  for (let i = 0; i < n; i++) {
    front(S,i*dw+0.03,(i+1)*dw-0.03,0.13,H-0.08,d-0.025,shade(c,1.1));
    front(S,(i+0.5)*dw-0.06,(i+0.5)*dw+0.06,H-0.17,H-0.15,d-0.015,x||STEEL);
  }
  if (island) for (let i = 0; i < Math.min(n,3); i++) S.B(i*dw+0.03,0.025,(i+1)*dw-0.03,0.025,0.13,H-0.08,shade(c,1.1),BK);
  if (!island && w > 1.2) topQ(S,w*0.55,d*0.2,w*0.85,d*0.75,H,shade(STEEL,0.8)); // sink
  else if (island) topQ(S,w*0.15,d*0.25,w*0.4,d*0.75,H,x||SAGE);  // fruit bowl
}

function fridge(S,c,x) {
  const {w,d,H,B} = S;
  B(0,0,w,d-0.03,0,H,c,FR|LF|RT|TP);
  front(S,0.02,w-0.02,H*0.66,H-0.03,d-0.02,shade(c,1.06));
  front(S,0.02,w-0.02,0.04,H*0.66-0.03,d-0.02,shade(c,1.06));
  front(S,w-0.1,w-0.06,H*0.72,H*0.9,d-0.01,STEEL);
  front(S,w-0.1,w-0.06,H*0.35,H*0.6,d-0.01,STEEL);
  front(S,0.08,0.3,H*0.45,H*0.56,d-0.01,x||TERRA);              // a magnet note
}

function stove(S,c,x) {
  const {w,d,H,B} = S;
  B(0,0,w,d-0.03,0,H-0.005,c,FR|LF|RT|TP);
  front(S,0.06,w-0.06,0.1,H*0.68,d-0.02,shade(c,0.85));          // oven door
  front(S,0.14,w-0.14,0.22,H*0.55,d-0.015,blend(INK,0x40506a,0.4)); // window
  front(S,0.1,w-0.1,H*0.71,H*0.74,d-0.015,STEEL);                // handle
  for (const u of [0.25,0.5,0.75]) front(S,w*u-0.025,w*u+0.025,H-0.08,H-0.04,d-0.015,INK); // knobs
  for (const [u,v] of [[0.28,0.3],[0.72,0.3],[0.28,0.72],[0.72,0.72]]) topQ(S,w*u-0.1,(d-0.03)*v-0.1,w*u+0.1,(d-0.03)*v+0.1,H,INK);
}

function toilet(S,c,x) {
  const {w,d,H,B} = S;
  B(0.06,0,w-0.06,0.18,0.35,H-0.01,c,FR|LF|RT|TP);              // tank
  B(0.07,0.16,w-0.07,d-0.06,0,0.38,c,FR|LF|RT);                 // bowl
  B(0.05,0.18,w-0.05,d-0.03,0.38,0.42,shade(c,1.08),FR|LF|RT|TP); // seat
  topQ(S,w*0.35,0.04,w*0.65,0.1,H,STEEL);                 // flush
}

function sink(S,c,x) {
  const {w,d,H,B} = S;
  B(0.02,0,w-0.02,d-0.04,0,H-0.06,shade(c,0.92),FR|LF|RT);
  B(0,0,w,d,H-0.06,H-0.01,CREAM,NOBK);
  topQ(S,w*0.2,d*0.3,w*0.8,d*0.85,H-0.006,blend(DUSTY,CREAM,0.5));
  B(w/2-0.03,0.05,w/2+0.03,0.12,H-0.01,H,STEEL,FR|LF|RT|TP);
  front(S,0.06,w/2-0.02,0.06,H-0.12,d-0.035,shade(c,1.05));
  front(S,w/2+0.02,w-0.06,0.06,H-0.12,d-0.035,shade(c,1.05));
}

function bathtub(S,c,x) {
  const {w,d,H,B} = S, rim = 0.08;
  B(0,0,w,d,0,H-0.02,c,FR|LF|RT);
  B(0,0,w,rim,H-0.04,H,c,FR|TP);
  B(0,d-rim,w,d,H-0.04,H,c,FR|BK|TP);
  B(0,rim,rim,d-rim,H-0.04,H,c,RT|TP);
  B(w-rim,rim,w,d-rim,H-0.04,H,c,LF|TP);
  topQ(S,rim,rim,w-rim,d-rim,H-0.06,blend(DUSTY,CREAM,0.55));    // water
  B(0.02,d/2-0.05,0.12,d/2+0.05,H-0.04,H,STEEL,FR|RT|TP);        // tap
}

function toiletStall(S,c,x) {
  const {w,d,H,B} = S, t = 0.04;
  B(0,0,t,d-t,0.15,H,c,LF|RT|TP|FR);
  B(w-t,0,w,d-t,0.15,H,c,LF|RT|TP|FR);
  B(t,d-t,w-t,d-0.01,0.15,H-0.05,shade(c,1.08),FR|BK|TP);        // door
  front(S,w-0.2,w-0.12,1.0,1.06,d,TERRA);                    // lock indicator
  for (const u of [0,w-t]) B(u,d-t,u+t,d,0,0.15,STEEL,FR|LF|RT);
  B(w/2-0.2,0,w/2+0.2,0.18,0.35,0.75,CREAM,FR|LF|RT|TP);         // toilet tank
  B(w/2-0.18,0.18,w/2+0.18,0.68,0,0.42,CREAM,FR|LF|RT|TP);       // bowl
}

function shelf(S,c,x,R) {
  const {w,d,H,B} = S, end = 0.04;
  B(0,0,w,d,0,0.12,shade(c,0.55),SIDES);
  B(0,0,end,d,0,H,c); B(w-end,0,w,d,0,H,c);
  B(end,d/2-0.02,w-end,d/2+0.02,0.12,H,shade(c,0.75),FR|BK|TP);  // spine
  const levels = [0.12,H*0.4,H*0.72];
  for (let i = 0; i < levels.length; i++) {
    const y = levels[i];
    B(end,0,w-end,d,y,y+0.03,blend(c,CREAM,0.35),FR|BK|TP);
    const top = i+1 < levels.length ? levels[i+1]-0.04 : H-0.1;
    for (const [v0,v1,m] of [[0.02,d/2-0.04,BK|TP],[d/2+0.04,d-0.02,FR|TP]]) {
      const u0 = end+0.03, span = (w-2*end-0.06)/2;
      for (let k = 0; k < 2; k++) B(u0+k*span+0.02,v0,u0+(k+1)*span-0.02,v1,y+0.03,y+0.03+(top-y-0.03)*(0.6+(R()%4)*0.1),pick(R,GOODS),m);
    }
  }
}

function checkout(S,c,x) {
  const {w,d,H,B} = S, belt = Math.min(0.85,H*0.85);
  B(0,0,w,d-0.01,0,belt,c,SIDES);
  B(0,0,w,d,belt,belt+0.03,shade(c,1.15),ALL);
  topQ(S,0.1,d*0.2,w*0.6,d*0.8,belt+0.035,INK);                // belt
  front(S,0.05,w-0.05,0.05,0.12,d,shade(c,0.5));
  front(S,w*0.1,w*0.5,belt*0.5,belt*0.65,d,x||GOLD);
  B(w*0.7,d*0.25,w*0.92,d*0.7,belt+0.03,H-0.12,INK,ALL&~DN);   // register
  B(w*0.72,d*0.4,w*0.9,d*0.5,H-0.12,H,shade(DUSTY,0.8),FR|BK|TP);
}

function crate(S,c,x) {
  const {w,d,H,B} = S;
  B(0.02,0.02,w-0.02,d-0.02,0,H-0.005,c);
  for (const y of [0.06,H-0.14]) B(0,0,w,d,y,y+0.08,shade(c,0.78),SIDES); // straps, slightly proud
  topQ(S,0,d/2-0.06,w,d/2+0.06,H,shade(c,0.78));
}

function palletRack(S,c,x,R) {
  const {w,d,H,B} = S, t = 0.08, rack = x || TERRA;
  for (const u of [0,w-t]) for (const v of [0,d-t]) B(u,v,u+t,v+t,0,H,c,SIDES);
  const levels = [0.15,H*0.38,H*0.7];
  for (let i = 0; i < levels.length; i++) {
    const y = levels[i];
    B(t,0,w-t,d,y,y+0.08,rack,FR|BK|TP);
    const top = i+1 < levels.length ? levels[i+1]-0.1 : H-0.05;
    const span = (w-2*t)/2;
    for (let k = 0; k < 2; k++) B(t+k*span+0.06,0.08,t+(k+1)*span-0.06,d-0.08,y+0.08,y+0.08+(top-y-0.08)*(0.55+(R()%4)*0.12),pick(R,[0xc9a06a,0xb88a55,0xd8b884,CREAM]),FR|BK|TP);
  }
}

function desk(S,c,x,R) {
  const {w,d,H,B} = S, ped = Math.min(0.42,w*0.3);
  B(0,0,w,d,H-0.04,H-0.005,c);
  B(w-ped,0.02,w-0.02,d-0.04,0,H-0.04,shade(c,0.85),FR|BK|LF|RT);
  front(S,w-ped+0.03,w-0.05,H*0.55,H-0.08,d-0.035,shade(c,1.08));
  front(S,w-ped+0.03,w-0.05,0.06,H*0.5,d-0.035,shade(c,1.08));
  B(0.03,0.03,0.09,d-0.03,0,H-0.04,shade(c,0.7),SIDES);          // end panel
  B(0.09,0.02,w-ped,0.05,0.25,H-0.04,shade(c,0.75),FR|BK);         // modesty panel
  topQ(S,w*0.25,d*0.35,w*0.48,d*0.8,H,blend(CREAM,0xffffff,0.4)); // papers
  topQ(S,w*0.55,d*0.15,w*0.75,d*0.45,H,x||pick(R,[TERRA,DUSTY,SAGE])); // folder
}

function officeChair(S,c,x) {
  const {w,d,H,B} = S, seat = Math.min(0.5,H*0.5);
  B(0.04,0.06,w-0.04,d-0.02,seat-0.07,seat,c);
  B(0.07,0,w-0.07,0.06,seat+0.05,H,c,FR|BK|TP);
  B(w/2-0.03,d/2-0.03,w/2+0.03,d/2+0.03,0.05,seat-0.07,STEEL,SIDES);
  topQ(S,0.06,0.06,w-0.06,d-0.06,0.05,INK);                     // star base (flat)
}

function filingCabinet(S,c,x) {
  const {w,d,H,B} = S, n = 4, gh = (H-0.08)/n;
  B(0,0,w,d-0.02,0,H,c,FR|LF|RT|TP);
  for (let i = 0; i < n; i++) {
    const y = 0.04 + i*gh;
    front(S,0.03,w-0.03,y+0.02,y+gh-0.02,d-0.012,shade(c,1.08));
    front(S,w/2-0.07,w/2+0.07,y+gh*0.62,y+gh*0.72,d-0.004,STEEL);
  }
}

function bookcase(S,c,x,R) {
  const {w,d,H,B} = S, t = 0.04;
  B(0,0,t,d,0,H,c,ALL&~BK); B(w-t,0,w,d,0,H,c,ALL&~BK);
  B(t,0,w-t,d,H-t,H,c,FR|TP);
  front(S,t,w-t,0,H-t,0.02,shade(c,0.55));                      // back panel
  const n = 4, gh = (H-0.1-t)/n;
  for (let i = 0; i < n; i++) {
    const y = 0.1 + i*gh;
    B(t,0.02,w-t,d,y-0.03,y,shade(c,1.08),FR|TP);
    let u = t + 0.03;
    for (let k = 0; k < 3 && u < w-t-0.1; k++) {
      const bw = Math.min((w-2*t)*(0.18+(R()%4)*0.05), w-t-0.03-u);
      const bh = gh*(0.55+(R()%4)*0.08);
      B(u,0.04,u+bw,d-0.04,y,y+bh,pick(R,GOODS),FR|TP);
      u += bw + 0.03 + (R()%3)*0.02;
    }
  }
  B(t,0.02,w-t,d,0,0.07,shade(c,0.8),FR);                       // kick
}

function plant(S,c,x) {
  const {w,d,H,B} = S, pot = Math.min(0.42,H*0.35);
  B(w*0.2,d*0.2,w*0.8,d*0.8,0,pot,x||TERRA,SIDES);
  B(w*0.04,d*0.04,w*0.96,d*0.96,pot,H*0.72,c||LEAF[0]);
  B(w*0.18,d*0.18,w*0.82,d*0.82,H*0.68,H,shade(c||LEAF[0],1.15));
}

function bench(S,c,x) {
  const {w,d,H,B} = S;
  B(0,0,w,d,H-0.06,H-0.004,c);
  for (const u of [0.08,w-0.14]) B(u,0.04,u+0.06,d-0.04,0,H-0.06,shade(c,0.6),SIDES);
  if (w > 1) topQ(S,0.04,d/2-0.01,w-0.04,d/2+0.01,H,shade(c,0.75));
}

function receptionDesk(S,c,x) {
  const {w,d,H,B} = S, work = Math.min(0.75,H*0.7);
  B(0,d-0.12,w,d-0.015,0,H-0.05,c,FR|BK|LF|RT);                   // tall front
  B(0,d-0.2,w,d,H-0.05,H,blend(CREAM,c,0.2));                      // ledge
  front(S,0,w,H*0.35,H*0.48,d-0.005,x||GOLD);                       // accent band
  B(0,0,w,d-0.12,work-0.04,work,shade(c,1.1),BK|LF|RT|TP);         // worktop
  B(0.05,0.05,w*0.3,d-0.12,0,work-0.04,shade(c,0.8),BK|RT);         // pedestal
  B(w*0.55,0.12,w*0.75,0.18,work,work+0.35,INK,FR|BK|LF|RT|TP);      // monitor
}

function safe(S,c,x) {
  const {w,d,H,B} = S;
  B(0,0,w,d-0.03,0,H,c,ALL);
  front(S,0.07,w-0.07,0.07,H-0.07,d-0.02,shade(c,1.12));
  front(S,w*0.5-0.09,w*0.5+0.09,H*0.55,H*0.69,d-0.01,shade(STEEL,1.05));
  front(S,w*0.5-0.03,w*0.5+0.03,H*0.38,H*0.5,d-0.01,GOLD);
  front(S,0.03,0.06,H*0.2,H*0.8,d-0.01,STEEL);
}

function workbench(S,c,x) {
  const {w,d,H,B,legs} = S;
  B(0,0,w,d,H-0.06,H-0.01,c);
  legs(0.04,0.04,w-0.04,d-0.04,H-0.06,0.08,shade(c,0.6));
  B(0.1,0.1,w-0.1,d-0.1,0.18,0.22,shade(c,0.8),FR|TP);
  B(w*0.08,d*0.25,w*0.22,d*0.6,H-0.01,H,STEEL,FR|LF|RT|TP);         // vice
  B(w*0.55,d*0.2,w*0.85,d*0.55,H-0.01,H,x||TERRA,FR|LF|RT|TP);      // toolbox (flat lid)
}

function car(S,c,x) {
  const {w,d,H,B} = S, wh = Math.min(0.62,H*0.45), body = Math.min(0.95,H*0.66);
  const bl = shade(c,0.5);
  B(0.06,0.12,w-0.06,d-0.12,0.28,body,c,ALL&~DN);
  B(0,0.15,0.08,d-0.15,0.22,0.55,INK,LF|TP|FR|BK);
  B(w-0.08,0.15,w,d-0.15,0.22,0.55,INK,RT|TP|FR|BK);
  B(w*0.3,0.22,w*0.72,d-0.22,body,H,shade(c,1.08),ALL&~DN);         // cabin
  front(S,w*0.33,w*0.69,body+0.08,H-0.08,d-0.215,blend(DUSTY,INK,0.3));
  S.B(w*0.33,0.215,w*0.69,0.215,body+0.08,H-0.08,blend(DUSTY,INK,0.3),BK);
  S.B(w*0.3-0.005,0.3,w*0.3-0.005,d-0.3,body+0.08,H-0.08,blend(DUSTY,INK,0.2),LF);
  S.B(w*0.72+0.005,0.3,w*0.72+0.005,d-0.3,body+0.08,H-0.08,blend(DUSTY,INK,0.2),RT);
  for (const u of [w*0.18,w*0.8]) for (const [v0,v1,m] of [[0.01,0.26,BK],[d-0.26,d-0.01,FR]]) {
    B(u-0.32,v0,u+0.32,v1,0,wh,bl,m|LF|RT|TP);
    S.B(u-0.14,m===FR?d:0,u+0.14,m===FR?d:0,wh*0.3,wh*0.7,STEEL,m);
  }
  S.B(0,0.25,0,0.5,0.6,0.75,CREAM,LF); S.B(0,d-0.5,0,d-0.25,0.6,0.75,CREAM,LF);
  S.B(w,0.25,w,0.5,0.6,0.75,TERRA,RT); S.B(w,d-0.5,w,d-0.25,0.6,0.75,TERRA,RT);
}

function planter(S,c,x) {
  const {w,d,H,B} = S, box = Math.min(0.45,H*0.6);
  B(0.03,0.03,w-0.03,d-0.03,0,box,c,SIDES);
  B(0,0,w,d,box,box+0.05,shade(c,0.75));
  topQ(S,0.06,0.06,w-0.06,d-0.06,box+0.04,0x5a4232);                // never seen fully: soil
  const n = Math.max(1,Math.min(3,Math.round(w/0.5)));
  for (let i = 0; i < n; i++) B(0.08+i*(w-0.16)/n,0.1,0.08+(i+1)*(w-0.16)/n-0.04,d-0.1,box+0.05,H*(0.85+0.15*(i%2)),LEAF[i%3]);
}

function plinth(S,c,x,R) {
  const {w,d,H,B} = S, top = Math.min(1,H*0.53);
  B(0.03,0.03,w-0.03,d-0.03,0.06,top-0.05,c,SIDES);
  B(0,0,w,d,0,0.06,shade(c,0.8),SIDES|TP);
  B(0,0,w,d,top-0.05,top,shade(c,1.05));
  if (H - top < 0.2) return;
  const a = x || pick(R,[VIOLET,TERRA,GOLD,DUSTY]), b = pick(R,[INK,SAGE,GOLD,TERRA]);
  const s = H - top;
  B(w*0.3,d*0.3,w*0.7,d*0.7,top,top+s*0.4,a);
  B(w*0.18,d*0.38,w*0.62,d*0.62,top+s*0.4,top+s*0.7,b);
  B(w*0.42,d*0.25,w*0.7,d*0.55,top+s*0.7,H,blend(a,CREAM,0.35));
}

function displayCase(S,c,x,R) {
  const {w,d,H,B} = S, base = Math.min(0.75,H*0.68), t = 0.03;
  B(0,0,w,d,0,base,c,ALL&~DN);
  for (const u of [0,w-t]) for (const v of [0,d-t]) B(u,v,u+t,v+t,base,H-0.03,STEEL,(u?RT:LF)|(v?FR:BK));
  B(0,0,w,d,H-0.03,H,blend(DUSTY,CREAM,0.6),ALL);                 // glass lid (opaque, pale)
  B(w*0.15,d*0.3,w*0.4,d*0.7,base,base+(H-base)*0.45,pick(R,[GOLD,TERRA,VIOLET]));
  B(w*0.58,d*0.35,w*0.82,d*0.65,base,base+(H-base)*0.3,x||pick(R,[SAGE,DUSTY,CREAM]));
}

function schoolDesk(S,c,x) {
  const {w,d,H,B} = S;
  B(0,0,w,d,H-0.03,H,c);
  B(0.06,0.04,w-0.06,d*0.7,H-0.18,H-0.03,shade(STEEL,0.8),FR|LF|RT);
  for (const u of [0.04,w-0.07]) B(u,0.06,u+0.03,d-0.06,0,H-0.18,shade(STEEL,0.6),LF|RT);
}

function lockerBank(S,c,x) {
  const {w,d,H,B} = S, n = Math.max(1,Math.min(8,Math.round(w/0.4))), dw = w/n;
  B(0,0,w,d-0.02,0,H,c,FR|LF|RT|TP);
  front(S,0,w,0,0.1,d-0.015,shade(c,0.5));
  for (let i = 0; i < n; i++) {
    const u0 = i*dw + 0.02, u1 = (i+1)*dw - 0.02;
    front(S,u0,u1,0.12,H-0.04,d-0.012,shade(c,i%2 ? 1.06 : 1.12));
    front(S,u0+dw*0.2,u1-dw*0.2,H-0.3,H-0.27,d-0.006,shade(c,0.6));
    front(S,u0+dw*0.2,u1-dw*0.2,H-0.38,H-0.35,d-0.006,shade(c,0.6));
    front(S,u1-0.08,u1-0.04,H*0.45,H*0.55,d-0.006,STEEL);
  }
}

function seatRow(S,c,x) {
  const {w,d,H,B} = S, n = Math.max(1,Math.min(9,Math.floor(w/0.55))), sw = w/n;
  const seat = Math.min(0.45,H*0.5), arm = 0.06, ink = shade(x||INK,0.9);
  B(0,d*0.25,w,d*0.6,0,seat-0.08,ink,SIDES);                         // beam / base
  B(0,0,w,0.12,0.1,H,ink);                                          // back shell
  for (let i = 0; i < n; i++) {
    const u0 = i*sw + arm, u1 = (i+1)*sw - arm*0.2;
    B(u0,0.12,u1,d-0.04,seat-0.1,seat,c,FR|TP);
    B(u0,0.12,u1,0.2,seat,H-0.06,shade(c,1.1),FR|TP);
  }
  for (let i = 0; i <= n; i++) {
    const u = Math.min(w-arm,Math.max(0,i*sw));
    B(u,0.12,u+arm,d-0.08,0,seat+0.18,ink,FR|TP);
  }
}

function stage(S,c,x) {
  const {w,d,H,B} = S;
  B(0,0,w,d-0.1,0,H-0.006,c,ALL);
  B(0,d-0.1,w,d,H-0.08,H,x||GOLD,FR|LF|RT|TP);                     // front lip
  front(S,0,w,0,H-0.08,d-0.02,shade(c,0.45));                       // apron (dark)
  B(0,d-0.1,w,d-0.02,0,H-0.08,shade(c,0.45),LF|RT);
  const n = Math.max(1,Math.min(6,Math.floor(w/1.4)));
  for (let i = 1; i <= n; i++) topQ(S,i*w/(n+1)-0.01,0,i*w/(n+1)+0.01,d-0.1,H-0.003,shade(c,0.82));
}

function bleachers(S,c,x) {
  const {w,d,H,B} = S, n = 4, td = d/n, plank = x || shade(c,1.25);
  for (let k = 0; k < n; k++) {
    const v1 = d - k*td, v0 = v1 - td, y1 = (k+1)*H/n;
    B(0,v0,w,v1,0,y1-0.06,c,FR|LF|RT|TP|(k===n-1?BK:0));
    B(0,v1-td*0.5,w,v1,y1-0.06,y1,plank,FR|TP|LF|RT);
  }
}

function hoop(S,c,x) {
  const {w,d,H,B} = S, cu = w/2;
  B(cu-0.25,0,cu+0.25,0.5,0,0.15,shade(c,0.7),ALL);                 // base pad
  B(cu-0.06,0.12,cu+0.06,0.24,0.15,H-0.55,c,SIDES);                 // pole
  B(cu-0.05,0.12,cu+0.05,d*0.7,H-0.75,H-0.65,c,SIDES|TP);           // arm
  B(cu-0.9,d*0.7,cu+0.9,d*0.7+0.05,H-1.05,H,blend(CREAM,0xffffff,0.4),ALL&~DN); // backboard
  S.B(cu-0.3,d*0.7+0.06,cu+0.3,d*0.7+0.06,H-0.75,H-0.71,TERRA,FR);
  S.B(cu-0.3,d*0.7+0.06,cu-0.26,d*0.7+0.06,H-0.75,H-0.38,TERRA,FR);
  S.B(cu+0.26,d*0.7+0.06,cu+0.3,d*0.7+0.06,H-0.75,H-0.38,TERRA,FR);
  S.B(cu-0.3,d*0.7+0.06,cu+0.3,d*0.7+0.06,H-0.42,H-0.38,TERRA,FR);
  const rv0 = d*0.7+0.06, rv1 = d;
  B(cu-0.23,rv0,cu+0.23,rv0+0.03,H-0.82,H-0.8,0xe0663a,FR|TP);       // rim
  B(cu-0.23,rv1-0.03,cu+0.23,rv1,H-0.82,H-0.8,0xe0663a,FR|BK|TP);
  B(cu-0.23,rv0,cu-0.2,rv1,H-0.82,H-0.8,0xe0663a,LF|RT|TP);
  B(cu+0.2,rv0,cu+0.23,rv1,H-0.82,H-0.8,0xe0663a,LF|RT|TP);
  B(cu-0.18,rv0+0.03,cu+0.18,rv1-0.03,H-1.1,H-0.82,blend(CREAM,0xffffff,0.5),FR|LF|RT); // net
}

function courtLines(S,c,x) {
  // wide ink lines: thin cream lines on a maple floor vanish at gameplay distances
  const {w,d,H} = S, t = 0.16, line = 0x3a2d5c, y = H; // x (accent) intentionally unused for lines
  const long = w >= d;
  topQ(S,0,0,w,t,y,line); topQ(S,0,d-t,w,d,y,line);
  topQ(S,0,t,t,d-t,y,line); topQ(S,w-t,t,w,d-t,y,line);
  const cs = Math.min(w,d)*0.18;
  topQ(S,w/2-cs,d/2-cs,w/2+cs,d/2+cs,y*0.9,c||TERRA);              // centre spot
  if (long) {
    topQ(S,w/2-t/2,t,w/2+t/2,d-t,y,line);
    const kw = Math.min(w*0.2,5.8), kh = Math.min(d*0.25,2.45);
    for (const [u0,u1] of [[t,t+kw],[w-t-kw,w-t]]) {
      topQ(S,u0,d/2-kh-t/2,u1,d/2-kh+t/2,y,line); topQ(S,u0,d/2+kh-t/2,u1,d/2+kh+t/2,y,line);
      const ue = u0 === t ? u1 - t : u0;
      topQ(S,ue,d/2-kh,ue+t,d/2+kh,y,line);
    }
  } else {
    topQ(S,t,d/2-t/2,w-t,d/2+t/2,y,line);
    const kd = Math.min(d*0.2,5.8), kw = Math.min(w*0.25,2.45);
    for (const [v0,v1] of [[t,t+kd],[d-t-kd,d-t]]) {
      topQ(S,w/2-kw-t/2,v0,w/2-kw+t/2,v1,y,line); topQ(S,w/2+kw-t/2,v0,w/2+kw+t/2,v1,y,line);
      const ve = v0 === t ? v1 - t : v0;
      topQ(S,w/2-kw,ve,w/2+kw,ve+t,y,line);
    }
  }
}

function longTable(S,c,x) {
  const {w,d,H,B} = S;
  B(0,0,w,d,H-0.05,H-0.004,c);
  for (const u of [0.25,w-0.33]) B(u,0.08,u+0.08,d-0.08,0,H-0.05,shade(c,0.6),SIDES);
  B(0.33,d/2-0.04,w-0.33,d/2+0.04,0.25,0.33,shade(c,0.6),FR|BK|TP);
  if (x) topQ(S,0.2,d*0.4,w-0.2,d*0.6,H,x);
}

function servingLine(S,c,x,R) {
  const {w,d,H,B} = S, top = Math.min(0.9,H*0.88);
  B(0,0.15,w,d-0.01,0,top-0.04,c,SIDES);
  B(0,0.15,w,d,top-0.04,top,STEEL,ALL&~DN);
  B(0,0,w,0.15,top-0.15,top-0.1,shade(STEEL,0.85),FR|BK|TP|LF|RT);  // tray rail
  const n = Math.max(1,Math.min(5,Math.floor(w/0.6)));
  for (let i = 0; i < n; i++) topQ(S,0.1+i*(w-0.2)/n,d*0.35,0.1+(i+1)*(w-0.2)/n-0.06,d*0.8,top+0.004,pick(R,[GOLD,TERRA,SAGE,CREAM,0xe58f6a]));
  for (const u of [0.05,w-0.08]) B(u,d*0.55,u+0.03,d*0.58,top,H,STEEL,FR|LF|RT);
  B(0,d*0.4,w,d*0.6,H-0.02,H,blend(DUSTY,CREAM,0.65),TP|FR|BK|DN); // sneeze guard
  front(S,0,w,0.1,0.2,d,x||GOLD);
}

function pew(S,c,x) {
  const {w,d,H,B} = S, seat = Math.min(0.45,H*0.5);
  B(0.06,0.08,w-0.06,d,seat-0.05,seat,c,ALL&~BK);
  B(0.06,0,w-0.06,0.08,0.2,H,shade(c,0.9));
  for (const u of [0,w-0.06]) B(u,0,u+0.06,d,0,H-0.05,shade(c,0.75),ALL&~DN);
  B(0.06,0.02,w-0.06,0.14,0.08,0.14,shade(c,0.6),FR|TP);              // kneeler
  if (x) topQ(S,0.1,0.1,w-0.1,0.3,seat+0.003,x);                      // cushion runner
}

function judgeBench(S,c,x) {
  const {w,d,H,B} = S, plat = 0.3;
  B(0,0,w,d*0.45,0,plat,shade(c,0.8),FR|BK|LF|RT|TP);              // judge platform
  B(0,d*0.45,w,d-0.03,0,H-0.06,c,FR|LF|RT|BK);
  B(0,d*0.4,w,d,H-0.06,H,shade(c,1.15));                             // desk top
  const n = 3, pw = w/n;
  for (let i = 0; i < n; i++) front(S,i*pw+0.1,(i+1)*pw-0.1,0.15,H-0.2,d-0.02,shade(c,0.82));
  front(S,w/2-0.16,w/2+0.16,H*0.5,H*0.5+0.32,d-0.01,x||GOLD);         // seal
  B(w/2-0.3,0.05,w/2+0.3,0.2,plat,H,INK,FR|BK|LF|RT|TP);              // chair back
}

function witnessStand(S,c,x) {
  const {w,d,H,B} = S, t = 0.08;
  B(0,0,w,d,0,0.2,shade(c,0.8),FR|BK|LF|RT|TP);
  B(0,d-t,w,d-0.01,0.2,H-0.04,c);
  for (const u of [0,w-t]) B(u,0,u+t,d-t,0.2,H,c,BK|LF|RT|TP);
  front(S,0.1,w-0.1,0.35,H-0.15,d,shade(c,0.82));
  B(0,d-t-0.02,w,d,H-0.04,H,x||GOLD,TP|FR);
}

function juryBox(S,c,x) {
  const {w,d,H,B} = S, t = 0.08;
  B(0,d-t,w,d,0,H,c);
  for (const u of [0,w-t]) B(u,0,u+t,d-t,0,H,c,BK|LF|RT|TP);
  B(t,0,w-t,d*0.48,0,0.25,shade(c,0.8),FR|BK|TP);                    // back tier
  const n = Math.max(1,Math.min(6,Math.floor((w-2*t)/0.6))), sw = (w-2*t)/n;
  for (const [v0,y0] of [[0.05,0.25],[d*0.52,0]]) for (let i = 0; i < n; i++) {
    const u0 = t + i*sw + 0.06, u1 = t + (i+1)*sw - 0.06;
    B(u0,v0+0.06,u1,v0+0.48,y0+0.4,y0+0.45,x||VIOLET,FR|TP);
    B(u0,v0,u1,v0+0.06,y0,Math.min(H-0.02,y0+0.85),shade(x||VIOLET,0.8),FR|TP);
  }
}

function railing(S,c,x) {
  const {w,d,H,B} = S, n = Math.max(2,Math.min(8,Math.ceil(w/0.6)+1)), pw = 0.05;
  B(0,0,w,d,H-0.06,H,shade(c,1.1));
  B(0,0,w,d,0.12,0.17,c,SIDES|TP);
  for (let i = 0; i < n; i++) { const u = i*(w-pw)/(n-1); B(u,0,u+pw,d,0,H-0.06,c,SIDES); }
}

function barCounter(S,c,x,R) {
  const {w,d,H,B} = S;
  B(0,0.1,w,d-0.04,0,H-0.05,c,SIDES);
  B(0,0,w,d,H-0.05,H-0.005,shade(c,0.7));                             // top
  B(0,d-0.04,w,d,0.15,0.19,x||GOLD,FR|TP|LF|RT);                     // foot rail
  const n = Math.max(1,Math.min(6,Math.round(w/0.6)));
  for (let i = 0; i < n; i++) front(S,i*w/n+0.05,(i+1)*w/n-0.05,0.25,H-0.15,d-0.035,shade(c,1.12));
  for (let i = 0; i < 4; i++) B(0.2+i*(w-0.4)/4,0.0,0.2+i*(w-0.4)/4+0.08,0.08,H,H,pick(R,[SAGE,GOLD,TERRA]),TP);
}

function postTable(S,c,x) {
  const {w,d,H,B} = S;
  B(0,0,w,d,H-0.04,H,c);
  B(w/2-0.035,d/2-0.035,w/2+0.035,d/2+0.035,0.04,H-0.04,shade(c,0.55),SIDES);
  B(w*0.22,d*0.22,w*0.78,d*0.78,0,0.04,shade(c,0.45),TP|FR|BK);
}

// A single reserved footprint keeps the chairs paired with their table even in clipped rooms.
function commonsTable({ w, d, H, oct, B }) {
  const u = w / 2, v = d / 2;
  const metal = 0x898d8c, seat = 0x303335;
  oct(u, v, 0.58, 0.58, 0.34, 0.70, 0.75, 0xae977d);
  B(u - 0.055, v - 0.055, u + 0.055, v + 0.055, 0.04, 0.70, metal, SIDES);
  B(u - 0.27, v - 0.27, u + 0.27, v + 0.27, 0, 0.04, seat);
  for (const side of [-1, 1]) {
    const center = v + side * 0.78, back = center + side * 0.19;
    B(u - 0.22, center - 0.20, u + 0.22, center + 0.20, 0.42, 0.46, seat);
    B(u - 0.21, back - 0.025, u + 0.21, back + 0.025, 0.46, H, seat);
    for (const offset of [-0.17, 0.17]) {
      B(u + offset - 0.015, center - 0.12, u + offset + 0.015, center + 0.12, 0, 0.42, metal, SIDES);
    }
  }
}

function tank(S,c,x) {
  const {w,d,H,oct,cone,B,legs} = S;
  const cu = w/2, cv = d/2, ru = w/2-0.04, rv = d/2-0.04, k = Math.min(ru,rv)*0.6;
  legs(cu-ru*0.7,cv-rv*0.7,cu+ru*0.7,cv+rv*0.7,0.32,0.08,STEEL);
  cone(cu,cv,ru*0.55,rv*0.55,k*0.55,ru,rv,k,0.3,0.55,shade(c,0.85));   // bottom cone
  oct(cu,cv,ru,rv,k,0.55,H-0.55,c,false);
  cone(cu,cv,ru,rv,k,ru*0.35,rv*0.35,k*0.35,H-0.55,H-0.1,shade(c,1.08)); // top dome
  B(cu-0.12,cv-0.12,cu+0.12,cv+0.12,H-0.1,H,STEEL,SIDES|TP);
  front(S,cu-0.18,cu+0.18,0.9,1.3,cv+rv+0.005,x||GOLD);               // manway
}

function foodStall(S,c,x,R) {
  const {w,d,H,B,Q} = S, cnt = Math.min(1.05,H*0.45), cd = Math.min(0.6,d*0.35);
  const cano = x || TERRA, post = 0.08, low = H-0.45, high = H;
  B(0,d-cd,w,d,0,cnt-0.04,c,ALL&~DN);
  B(0,d-cd,w,d,cnt-0.04,cnt,blend(CREAM,c,0.2),TP|FR|BK);
  B(0,0,w,0.1,0,low,shade(c,0.9),FR|TP);                               // back wall
  front(S,w*0.2,w*0.8,low-0.7,low-0.15,0.11,INK);                      // menu board
  for (let i = 0; i < 3; i++) front(S,w*0.25,w*(0.45+0.1*(i%2)),low-0.62+i*0.15,low-0.56+i*0.15,0.115,CREAM);
  for (const u of [0,w-post]) B(u,d-post,u+post,d,cnt,low,shade(c,0.7),SIDES);
  const n = Math.max(2,Math.min(8,Math.round(w/0.5))), sw = w/n;
  for (let i = 0; i < n; i++) {
    const col = i%2 ? CREAM : cano, u0 = i*sw, u1 = (i+1)*sw;
    Q([[u0,0,high],[u1,0,high],[u1,d,low],[u0,d,low]],[0,high-low,d],col);   // sloped stripe
    front(S,u0,u1,low-0.22,low,d,col);                                         // valance
  }
  Q([[0,0,high-0.02],[w,0,high-0.02],[w,d,low-0.02],[0,d,low-0.02]],[0,-(high-low),-d],shade(cano,0.6)); // underside
  for (let i = 0; i < 3; i++) B(w*(0.15+0.25*i),d-cd*0.75,w*(0.15+0.25*i)+0.3,d-cd*0.3,cnt,cnt+0.12,pick(R,[GOLD,SAGE,0xe58f6a]),FR|TP);
}

function recordBin(S,c,x,R) {
  const {w,d,H,B} = S, bin = H*0.62;
  B(0,0,w,d,0,bin,c,SIDES);
  topQ(S,0,0,w,d,bin*0.5,shade(c,0.5));
  for (const [v0,v1] of [[0.05,d/2-0.03],[d/2+0.03,d-0.05]]) {
    const n = 4, sw = (w-0.1)/n;
    for (let i = 0; i < n; i++) B(0.05+i*sw+0.01,v0,0.05+(i+1)*sw-0.01,v1,bin*0.5,H,pick(R,GOODS),FR|TP|LF|RT);
  }
}

function easel(S,c,x,R) {
  const {w,d,H,B} = S, wood = shade(c||WOOD,0.85);
  for (const u of [0.05,w-0.09]) B(u,d*0.45,u+0.04,d*0.5,0,H,wood,FR|(u < w/2 ? LF : RT));
  B(w/2-0.02,0,w/2+0.02,0.04,0,H*0.9,wood,BK|LF);
  B(0.03,d*0.5,w-0.03,d*0.62,H*0.36,H*0.39,wood,FR|TP);               // tray
  B(0.06,d*0.4,w-0.06,d*0.45,H*0.39,H*0.88,CREAM,FR|BK);              // canvas
  front(S,0.1,w*0.55,H*0.45,H*0.7,d*0.455,x||pick(R,ART));
  front(S,w*0.4,w-0.1,H*0.6,H*0.84,d*0.456,pick(R,ART));
}

function banquetTable(S,c,x,R) {
  const {w,d,H,oct,B} = S, cu = w/2, cv = d/2, k = Math.min(w,d)*0.29;
  oct(cu,cv,w/2,d/2,k,0.3,H-0.005,c||CREAM,true);                            // cloth
  B(cu-0.1,cv-0.1,cu+0.1,cv+0.1,0,0.3,shade(c||CREAM,0.75),SIDES);    // pedestal
  B(cu-0.09,cv-0.09,cu+0.09,cv+0.09,H,H,x||GOLD,TP);
  for (const [u,v] of [[0.5,0.18],[0.5,0.82],[0.18,0.5],[0.82,0.5]]) topQ(S,w*u-0.1,d*v-0.1,w*u+0.1,d*v+0.1,H-0.002,blend(CREAM,0xffffff,0.5));
}

function podium(S,c,x) {
  const {w,d,H,B,Q} = S, lt = H-0.14;
  B(0,0,w,d,0,0.06,shade(c,0.7),FR|LF|RT);
  B(0.06,0.04,w-0.06,d-0.06,0.06,lt,c,SIDES);
  B(0,0,w,d,lt,lt+0.06,shade(c,1.1),SIDES);
  Q([[0,0,H],[w,0,H],[w,d,lt+0.06],[0,d,lt+0.06]],[0,H-lt-0.06,d],shade(c,1.15)); // sloped top
  front(S,w/2-0.1,w/2+0.1,lt*0.55,lt*0.75,d-0.055,x||GOLD);
}

function installation(S,c,x,R) {
  const {w,d,H,B} = S, a = c || pick(R,[VIOLET,TERRA,DUSTY]), b = x || pick(R,[GOLD,SAGE,CREAM]);
  const t = Math.min(0.5,Math.min(w,d)*0.2);
  B(0,0,w,d,0,0.08,shade(CREAM,0.92),ALL&~DN);                        // floor platform
  B(w*0.1,d*0.35,w*0.1+t,d*0.35+t,0.08,H*0.85,a);                     // pillars
  B(w*0.9-t,d*0.35,w*0.9,d*0.35+t,0.08,H*0.85,a);
  B(w*0.1,d*0.35,w*0.9,d*0.35+t,H*0.85,H,shade(a,1.12),ALL);          // lintel
  B(w*0.4,d*0.6,w*0.4+t*1.4,d*0.6+t*1.4,0.08,0.08+t*1.4,b);           // block
  B(w*0.62,d*0.12,w*0.62+t,d*0.12+t,0.08,H*0.5,blend(a,b,0.5));
  B(w*0.45,d*0.35+t*0.25,w*0.55,d*0.35+t*0.75,H*0.45,H*0.7,b,ALL);    // floating cube
}

function galleryBench(S,c,x) {
  const {w,d,H,B} = S;
  B(0.08,0.08,w-0.08,d-0.08,0,H-0.12,INK,SIDES);
  B(0,0,w,d,H-0.12,H-0.004,c||shade(INK,1.4));
  topQ(S,0.06,d/2-0.01,w-0.06,d/2+0.01,H,shade(c||INK,0.8));
}

// ---- wall-mounted (back against the wall, seen from below too)
function painting(S,c,x,R,large) {
  const {w,d,H,B} = S, fr = Math.min(0.08,Math.min(w,H)*0.08);
  B(0,0,w,d-0.012,0,H,c||GOLD,FR|LF|RT|TP|DN);                         // frame
  front(S,fr,w-fr,fr,H-fr,d-0.009,CREAM);                              // mat
  const m = fr*1.6, iw = w-2*m, ih = H-2*m, v = d-0.006;
  const base = pick(R,ART);
  front(S,m,w-m,m,H-m,v,base);
  const n = large ? 4 : 2;
  for (let i = 0; i < n; i++) {
    const col = pick(R,ART.filter(k => k !== base));
    const u0 = m + iw*((R()%60)/100), v0 = m + ih*((R()%60)/100);
    front(S,u0,Math.min(w-m,u0+iw*(0.2+(R()%30)/100)),v0,Math.min(H-m,v0+ih*(0.2+(R()%30)/100)),v+0.0015*(i+1),col);
  }
}

// ---------------------------------------------------------- original procedural artworks
// painting / painting_large with `art` (uint32 seed) and/or `artStyle` draw an ORIGINAL composition
// (no reproduction of any real artwork): a moulding in a darker tone of `frame`, an inner liner in
// `frame`, a cream mat (large only) and a canvas built from flat colour blocks on <= 4 thin depth
// layers in front of the canvas ground. Budgets: painting 7 fixed + <= 7 composition = <= 14 quads,
// painting_large 8 fixed + <= 52 composition = <= 60 quads (the blk() budget guard enforces it).
export const ART_STYLES = Object.freeze(['landscape','portrait','abstract','still_life']);
const FRAME_DEFAULT = 0x74553b, MAT = 0xf4efe4, CARD = 0xefe6d2, CARD_INK = 0x3a2d5c;
// muted museum oils: ochres, umbers, sage, slate blue, cream
const OIL = {
  ochre:0xc19a4b, umber:0x6b4a2f, burnt:0x8a4b2c, sienna:0xa8603a, sage:0x8d9a74, olive:0x6d6f43,
  slate:0x5c6f82, sky:0xa9bcc4, cream:0xe9dfc6, bone:0xd8cdb2, deep:0x2f2a26, rose:0xb88a7a,
  teal:0x4f6f68, haze:0xc9c6b6, moss:0x58613f, plum:0x5a4250,
};
const SKIES = [[OIL.sky,OIL.cream],[OIL.haze,OIL.bone],[0xb7a98c,OIL.cream],[0x9fb0b3,0xd9cfb4]];
const HILLS = [[OIL.slate,0x7d8a8c],[0x6e7b86,OIL.sage],[0x8a8f86,OIL.olive]];
const GROUNDS = [[OIL.olive,OIL.moss,OIL.ochre],[OIL.sage,OIL.olive,0xb39a62],[0x7e7448,OIL.umber,OIL.ochre]];
const PORTRAIT_GROUNDS = [OIL.deep,0x3a3128,0x2c3230,OIL.plum];
const SKIN = [0xd9b48f,0xc89a76,0xa8775a,0xe0c2a0,0x8a5e44];
const GARB = [OIL.deep,OIL.slate,OIL.burnt,OIL.teal,OIL.plum,OIL.umber];
const FIELDS = [OIL.ochre,OIL.burnt,OIL.sienna,OIL.slate,OIL.teal,OIL.rose,OIL.cream,OIL.plum,OIL.sage,OIL.umber];
const VESSELS = [OIL.slate,OIL.cream,OIL.ochre,OIL.teal,OIL.umber,OIL.rose,0x9a8a6a];

/** mulberry32 over the art seed: the composition depends only on (art, artStyle, size). */
function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function artwork(S,R,p,large) {
  const {w,d,H,B} = S;
  const frameCol = typeof p.frame === 'number' && p.frame >= 0 && p.frame <= 0xffffff ? p.frame : FRAME_DEFAULT;
  const seed = typeof p.art === 'number' && Number.isFinite(p.art) ? p.art >>> 0 : R();
  const rnd = seeded(seed);
  const pk = list => list[Math.floor(rnd() * list.length) % list.length];
  const style = ART_STYLES.includes(p.artStyle) ? p.artStyle : ART_STYLES[Math.floor(rnd() * 4) % 4];
  const fr = Math.min(0.08,Math.min(w,H)*0.08), lw = fr*0.45, mw = large ? fr*0.9 : 0;
  B(0,0,w,d-0.012,0,H,shade(frameCol,0.66),FR|LF|RT|TP|DN);            // moulding (5)
  front(S,fr,w-fr,fr,H-fr,d-0.0105,frameCol);                           // liner
  if (large) front(S,fr+lw,w-fr-lw,fr+lw,H-fr-lw,d-0.0095,MAT);          // mat
  const cu0 = fr+lw+mw, cu1 = w-fr-lw-mw, cy0 = fr+lw+mw, cy1 = H-fr-lw-mw;
  const cw = cu1-cu0, ch = cy1-cy0;
  if (!(cw > 0.02 && ch > 0.02)) return;
  let budget = large ? 52 : 7;
  // canvas block in normalised canvas coords (x right, y up), layer 0 = ground .. 4 = front
  const blk = (x0,y0,x1,y1,col,layer) => {
    if (budget <= 0) return;
    const c = v => v < 0 ? 0 : v > 1 ? 1 : v;
    x0=c(x0); x1=c(x1); y0=c(y0); y1=c(y1);
    if (x1-x0 < 1e-3 || y1-y0 < 1e-3) return;
    budget--;
    front(S,cu0+cw*x0,cu0+cw*x1,cy0+ch*y0,cy0+ch*y1,d-0.008+0.0015*layer,col);
  };
  front(S,cu0,cu1,cy0,cy1,d-0.008,BG[style](rnd,pk));                   // canvas ground
  COMPOSE[style](blk,rnd,pk,large,cw/ch);
}

const BG = {
  landscape: (rnd,pk) => pk(SKIES)[0],
  portrait: (rnd,pk) => pk(PORTRAIT_GROUNDS),
  abstract: (rnd,pk) => pk([OIL.cream,OIL.bone,OIL.ochre,OIL.burnt,OIL.slate,OIL.deep]),
  still_life: (rnd,pk) => pk([0x4a3f33,OIL.deep,0x5b5446,0x3d4238]),
};

const COMPOSE = {
  landscape(blk,rnd,pk,large) {
    const [, glow] = pk(SKIES), [far,near] = pk(HILLS), [g1,g2,g3] = pk(GROUNDS);
    const hy = 0.42 + rnd()*0.16, water = rnd() < 0.55 ? pk([OIL.sky,0x8fa3a6,OIL.haze]) : null;
    if (large) {
      for (let i = 0; i < 3; i++) blk(0,hy+0.12+i*0.13,1,hy+0.18+i*0.13,blend(glow,0xffffff,0.1*i),0.5); // sky bands
      const sx = 0.1 + rnd()*0.7; blk(sx,0.78,sx+0.09,0.86,blend(glow,OIL.cream,0.6),1);             // sun / cloud
    } else blk(0,hy+0.1,1,hy+0.2,glow,0.5);
    // distant hills: stepped blocks approximate rounded ridges
    const hills = large ? 3 : 1;
    for (let k = 0; k < hills; k++) {
      const cx = rnd(), rw = 0.25 + rnd()*0.3, top = hy + 0.08 + rnd()*0.12, col = k % 2 ? near : far;
      const steps = large ? 3 : 1;
      for (let s = 0; s < steps; s++) {
        const f = (s+1)/steps;
        blk(cx-rw*(1-0.3*s),hy-0.02,cx+rw*(1-0.3*s),hy+(top-hy)*f,col,1.3+0.3*k);
      }
    }
    if (!large) blk(rnd()*0.4,hy-0.02,0.6+rnd()*0.4,hy+0.06+rnd()*0.06,near,1.6);
    blk(0,0,1,hy,g1,2.5);                                                // mid ground
    if (large) {
      blk(0,0,1,hy*0.45,g2,3);                                           // foreground
      for (let i = 0; i < 3; i++) { const fy = hy*(0.55+i*0.12); blk(rnd()*0.3,fy,0.5+rnd()*0.5,fy+0.025,blend(g1,g3,0.5),3); } // field strips
    }
    if (water) {                                                         // river
      const wy = hy*(0.25+rnd()*0.3);
      if (large) for (let i = 0; i < 3; i++) blk(0.1*i+rnd()*0.1,wy+i*0.04,0.55+0.15*i+rnd()*0.1,wy+i*0.04+0.04,blend(water,0xffffff,0.08*i),3.5);
      else blk(0,wy,1,wy+0.07,water,3.5);
    } else if (!large) blk(0,hy*0.4,1,hy*0.55,g3,3.5);                    // field band
    const trees = large ? 3 : 1;
    for (let t = 0; t < trees; t++) {
      const tx = large ? 0.12 + t*0.3 + rnd()*0.12 : 0.1 + rnd()*0.8, th = 0.18 + rnd()*0.15, tw = 0.025;
      blk(tx-tw,0.06,tx+tw,0.06+th,OIL.umber,4);                         // trunk
      blk(tx-0.09,0.06+th,tx+0.09,0.06+th+0.16,g2 === OIL.olive ? OIL.moss : OIL.olive,4); // canopy
      if (large) blk(tx-0.06,0.06+th+0.16,tx+0.06,0.06+th+0.24,blend(OIL.moss,OIL.sage,0.4),4);
    }
  },
  portrait(blk,rnd,pk,large) {
    const skin = pk(SKIN), garb = pk(GARB), hair = pk([OIL.deep,OIL.umber,0x4a3a2a,0x8a6a4a,0xb8b0a0]);
    const cx = 0.44 + rnd()*0.12, hw = 0.13 + rnd()*0.04, hb = 0.5 + rnd()*0.06, ht = hb + 0.26 + rnd()*0.04;
    blk(0.08,0.06,0.92,0.94,blend(pk(PORTRAIT_GROUNDS),OIL.umber,0.35),1);    // soft vignette
    if (large) {
      blk(cx-0.36,0,cx+0.36,0.5,shade(OIL.burnt,0.7),1.5);                   // chair back
      blk(0,0,0.07,1,blend(OIL.plum,OIL.burnt,0.4),1);                       // drape
    }
    blk(cx-0.34,0,cx+0.34,hb-0.08,garb,2);                                    // shoulders / torso
    blk(cx-hw*0.45,hb-0.08,cx+hw*0.45,hb,shade(skin,0.88),3);                 // neck
    blk(cx-hw,hb,cx+hw,ht,skin,3);                                            // head
    blk(cx-hw-0.02,ht-0.05,cx+hw+0.02,ht+0.06,hair,4);                        // hair
    blk(cx-0.1,hb-0.11,cx+0.1,hb-0.07,blend(OIL.cream,garb,0.15),3.5);        // collar
    if (large) {
      blk(cx-hw-0.02,hb+0.06,cx-hw+0.02,ht-0.05,hair,4);                      // hair sides
      blk(cx+hw-0.02,hb+0.06,cx+hw+0.02,ht-0.05,hair,4);
      blk(cx-hw*0.55,hb+0.15,cx-hw*0.2,hb+0.17,OIL.deep,4);                   // eyes
      blk(cx+hw*0.2,hb+0.15,cx+hw*0.55,hb+0.17,OIL.deep,4);
      blk(cx-hw*0.3,hb+0.05,cx+hw*0.3,hb+0.065,shade(OIL.rose,0.8),4);        // mouth
      blk(cx+hw*0.1,hb+0.08,cx+hw*0.5,ht-0.08,blend(skin,0xffffff,0.18),3.5); // light on the cheek
      blk(cx-0.02,0.05,cx+0.02,hb-0.12,shade(garb,0.75),3);                   // placket
      for (let i = 0; i < 3; i++) blk(cx-0.012,0.12+i*0.09,cx+0.012,0.14+i*0.09,OIL.ochre,4); // buttons
      blk(cx-0.3,0.02,cx-0.12,0.1,skin,4);                                    // hands
      blk(cx+0.12,0.02,cx+0.3,0.1,shade(skin,0.92),4);
    } else blk(cx+hw*0.15,hb+0.06,cx+hw*0.6,ht-0.08,blend(skin,0xffffff,0.18),3.5);
  },
  abstract(blk,rnd,pk,large,aspect) {
    const mode = Math.floor(rnd()*3) % 3;
    const cols = [pk(FIELDS),pk(FIELDS),pk(FIELDS),pk(FIELDS)];
    if (mode === 0) {                                                       // stacked soft colour fields
      const n = large ? 3 : 2, m = 0.07, gap = 0.05, fh = (1-2*m-gap*(n-1))/n;
      for (let i = 0; i < n; i++) {
        const y0 = m + i*(fh+gap);
        blk(m-0.02,y0-0.02,1-m+0.02,y0+fh+0.02,blend(cols[i],cols[3],0.4),1); // halo edge
        blk(m,y0,1-m,y0+fh,cols[i],2);
        if (large) blk(m+0.04,y0+fh*0.3,1-m-0.04,y0+fh*0.45,blend(cols[i],0xffffff,0.12),3);
      }
    } else if (mode === 1) {                                                // nested squares, low-centred
      const n = large ? 4 : 3;
      for (let i = 0; i < n; i++) {
        const s = 0.9 - i*(large ? 0.2 : 0.25), hx = s/2, hy = s/2*Math.min(1.6,Math.max(0.6,aspect));
        const cy = 0.5 - i*0.04;
        blk(0.5-hx,cy-hy,0.5+hx,cy+hy,cols[i],1+i);
      }
    } else {                                                                // vertical colour bands
      const n = large ? 10 : 6;
      let x = 0.04;
      for (let i = 0; i < n && x < 0.96; i++) {
        const bw = (0.92/n)*(0.6+rnd()*0.8), col = cols[i%4];
        blk(x,0.06+rnd()*0.06,Math.min(0.96,x+bw),0.88+rnd()*0.06,i%2 ? blend(col,OIL.cream,0.15) : col,1+(i%2));
        x += bw + 0.01;
      }
      if (large) for (let i = 0; i < 3; i++) { const y = 0.2+i*0.25; blk(0.04,y,0.96,y+0.02,shade(cols[(i+1)%4],0.7),3); }
    }
  },
  still_life(blk,rnd,pk,large) {
    const wood = pk([OIL.umber,0x7a5536,OIL.burnt,0x5e4630]), cloth = pk([OIL.cream,OIL.bone,OIL.rose,OIL.slate]);
    const ty = 0.26 + rnd()*0.08;
    if (large) blk(0.55+rnd()*0.2,ty,1,0.95,blend(pk([OIL.plum,OIL.teal,OIL.burnt]),OIL.deep,0.35),1); // drapery behind
    blk(0,0,1,ty-0.06,shade(wood,0.75),1);                                  // table front
    blk(0,ty-0.06,1,ty,wood,1);                                             // table top edge
    if (large) {
      blk(0.05,ty-0.08,0.7,ty,cloth,2);                                     // cloth over the edge
      blk(0.1,ty-0.22,0.3,ty-0.08,shade(cloth,0.9),2);                      // hanging fold
      blk(0,ty-0.075,1,ty-0.06,shade(wood,0.5),1.5);                        // edge shadow
    }
    const n = large ? 4 : 3;
    let x = 0.12 + rnd()*0.08;
    for (let i = 0; i < n; i++) {
      const vw = 0.08 + rnd()*0.08, vh = 0.15 + rnd()*0.3, col = pk(VESSELS), y0 = ty - 0.01;
      blk(x,y0,x+vw,y0+vh,col,3);                                           // vessel body
      if (large || i === 0) blk(x+vw*0.3,y0+vh,x+vw*0.7,y0+vh+0.07,shade(col,0.85),3); // neck
      if (large) {
        blk(x+vw*0.15,y0+vh*0.4,x+vw*0.32,y0+vh*0.85,blend(col,0xffffff,0.35),3.5); // highlight
        blk(x+vw*0.22,y0+vh+0.07,x+vw*0.78,y0+vh+0.085,shade(col,0.7),3.5); // rim
      }
      x += vw + 0.05 + rnd()*0.05;
      if (x > 0.85) break;
    }
    const fruit = large ? 3 : 1;
    for (let i = 0; i < fruit; i++) {
      const fx = 0.5 + rnd()*0.35;
      blk(fx,ty-0.01,fx+0.06,ty+0.05,pk([OIL.ochre,OIL.sienna,OIL.rose,OIL.sage]),4);
    }
  },
};

/** wall_label: cream card with 3 short ink text-line stripes (4 quads). */
function wallLabel(S,c,x,R) {
  const {w,d,H} = S, m = Math.min(0.025,w*0.12);
  front(S,0,w,0,H,d-0.004,CARD);
  const lines = [[0.68,0.9],[0.45,0.55+((R()%20)/100)],[0.25,0.45+((R()%25)/100)]];
  for (const [y,len] of lines) front(S,m,m+(w-2*m)*len,H*y,H*(y+0.1),d-0.001,CARD_INK);
}

function whiteboard(S,c,x,R) {
  const {w,d,H,B} = S;
  B(0,0,w,d-0.008,0.06,H,STEEL,FR|LF|RT|TP|DN);
  front(S,0.04,w-0.04,0.1,H-0.04,d-0.004,blend(CREAM,0xffffff,0.6));
  B(0.1,0,w-0.1,d,0,0.06,shade(STEEL,0.8),FR|TP|DN);
  for (let i = 0; i < 3; i++) front(S,0.2,0.2+(w-0.4)*(0.4+(R()%5)/10),H-0.25-i*0.18,H-0.23-i*0.18,d,pick(R,[DUSTY,TERRA,VIOLET]));
}

function tv(S,c,x) {
  const {w,d,H,B} = S;
  B(0,0,w,d-0.008,0,H,INK,FR|LF|RT|TP|DN);
  front(S,0.04,w-0.04,0.04,H-0.04,d-0.004,blend(DUSTY,VIOLET,0.35));
  front(S,0.1,w*0.55,0.1,H*0.5,d-0.002,blend(SAGE,CREAM,0.3));
  front(S,w*0.5,w-0.1,H*0.35,H-0.1,d,blend(GOLD,CREAM,0.25));
}

function menuBoard(S,c,x) {
  const {w,d,H,B} = S;
  B(0,0,w,d-0.006,0,H,c||INK,FR|LF|RT|TP|DN);
  front(S,0.06,w-0.06,H-0.2,H-0.06,d,x||GOLD);                     // header band
  for (let i = 0; i < 4; i++) {
    const y = H-0.32-i*0.15;
    front(S,0.1,w*0.55-(i%2)*0.15,y,y+0.05,d,CREAM);               // item line
    front(S,w*0.78,w-0.1,y,y+0.05,d,blend(CREAM,GOLD,0.4));         // price line
  }
}

function mirror(S,c,x) {
  const {w,d,H,B} = S;
  B(0,0,w,d-0.008,0,H,c||GOLD,FR|LF|RT|TP|DN);
  front(S,0.05,w-0.05,0.05,H-0.05,d-0.004,blend(DUSTY,CREAM,0.7));
  front(S,w*0.2,w*0.3,H*0.45,H*0.85,d,blend(CREAM,0xffffff,0.6));
}

function cabinetUpper(S,c,x) {
  const {w,d,H,B} = S, n = Math.max(1,Math.min(4,Math.round(w/0.5))), dw = w/n;
  B(0,0,w,d-0.02,0,H,c,FR|LF|RT|TP|DN);
  for (let i = 0; i < n; i++) {
    front(S,i*dw+0.02,(i+1)*dw-0.02,0.03,H-0.03,d-0.012,shade(c,1.1));
    front(S,(i+0.5)*dw-0.015,(i+0.5)*dw+0.015,0.06,0.18,d-0.004,x||STEEL);
  }
}

function tapBoard(S,c,x,R) {
  const {w,d,H,B} = S, n = Math.max(1,Math.min(6,Math.floor(w/0.3))), sw = w/n;
  B(0,0,w,d*0.4,0,H,c||DARKWOOD,FR|LF|RT|TP|DN);
  B(0.05,0,w-0.05,d,0,0.06,STEEL,FR|TP|DN);                              // drip tray
  for (let i = 0; i < n; i++) {
    const u = (i+0.5)*sw;
    B(u-0.03,d*0.4,u+0.03,d,0.18,0.45+(i%2)*0.08,pick(R,[GOLD,TERRA,SAGE,CREAM,DUSTY]),FR|LF|RT);
  }
}

function fallbackBox(S,c) { S.B(0,0,S.w,S.d,0,S.H,c); }

const SHAPES = {
  bed, nightstand, dresser, wardrobe,
  sofa: (S,c,x) => sofa(S,c,x,Math.max(1,Math.min(3,Math.round(S.w/0.7)))),
  armchair: (S,c,x) => sofa(S,c,x,1),
  coffee_table: coffeeTable, tv_stand: tvStand, rug, dining_table: table, chair, stool,
  counter: (S,c,x) => counter(S,c,x,false), kitchen_island: (S,c,x) => counter(S,c,x,true),
  fridge, stove, toilet, sink, bathtub, toilet_stall: toiletStall, shelf, checkout, crate,
  pallet_rack: palletRack, desk, teacher_desk: desk, office_chair: officeChair,
  filing_cabinet: filingCabinet, bookcase, plant, bench, reception_desk: receptionDesk, safe,
  workbench, car, planter, plinth, display_case: displayCase, school_desk: schoolDesk,
  locker_bank: lockerBank, seat_row: seatRow, stage, bleachers, hoop, court_lines: courtLines,
  long_table: longTable, serving_line: servingLine, pew, judge_bench: judgeBench,
  witness_stand: witnessStand, jury_box: juryBox, railing, bar_counter: barCounter,
  high_top: postTable, cafe_table: postTable, commons_table: commonsTable, tank, food_stall: foodStall, record_bin: recordBin,
  easel, banquet_table: banquetTable, podium, installation, gallery_bench: galleryBench,
  painting: (S,c,x,R,p) => hasArt(p) ? artwork(S,R,p,false) : painting(S,c,x,R,false),
  painting_large: (S,c,x,R,p) => hasArt(p) ? artwork(S,R,p,true) : painting(S,c,x,R,true),
  wall_label: wallLabel,
  whiteboard, tv, menu_board: menuBoard, mirror, cabinet_upper: cabinetUpper, tap_board: tapBoard,
};
/** New-schema artwork (contract addendum v2): an `art` seed or a known `artStyle`. */
function hasArt(p) { return (typeof p.art === 'number' && Number.isFinite(p.art)) || ART_STYLES.includes(p.artStyle); }
/** Every kind with a dedicated shape (catalog + legacy aliases). */
export const RENDERED_KINDS = Object.freeze([...Object.keys(SHAPES), ...Object.keys(ALIASES)]);

const num = (v, fb) => typeof v === 'number' && Number.isFinite(v) ? v : fb;

/** Render one prop record. Returns the number of quads emitted. */
function prop(ctx,shell,p) {
  if (!p || !(p.a1 > p.a0) || !(p.b1 > p.b0)) return 0;
  const start = ctx.n;
  const kind = ALIASES[p.kind] || p.kind;
  const lift = Math.max(0,num(p.lift,0));
  const floorY = num(p.y,shell.floor) - shell.floor;
  const H = Math.max(0.01,num(p.height,1));
  const V = Math.max(H,VISUAL_TOP[kind] || 0);
  const color = num(p.color,0x9c805b), accent = typeof p.accent === 'number' ? p.accent : undefined;
  // contact shadow: a darker quad on the room floor under floor-standing props
  if (lift <= 0.01 && !NO_SHADOW.has(kind)) {
    const floor = ctx.floorAt ? ctx.floorAt(p.level,(p.a0+p.a1)/2,(p.b0+p.b1)/2) : null;
    const col = shade(typeof floor === 'number' ? floor : 0x9b917f,0.62);
    boxPlan(ctx,p.a0,p.b0,p.a1,p.b1,floorY+0.059,floorY+0.059,col,TP);
  }
  const S = itemSpace(ctx,p,floorY+0.06+lift,V);
  (SHAPES[kind] || fallbackBox)(S,color,accent,stream(p),p);
  return ctx.n - start;
}

function plaque(chunk,shell,s,h,quad) {
  const tx=s.nz,tz=-s.nx, y=s.y-shell.floor;
  const P=(u,v,offset) => [s.x+tx*u+s.nx*offset,y+v,s.z+tz*u+s.nz*offset];
  const Q=(u0,v0,u1,v1,col,offset) => quad(chunk,P(u0,v0,offset),P(u1,v0,offset),P(u1,v1,offset),P(u0,v1,offset),s.nx,0,s.nz,...rgb(col),null,h);
  Q(-s.width/2,-s.height/2,s.width/2,s.height/2,0x332c42,0);
  const unit=Math.min((s.width-0.1)/(s.text.length*4),0.034);
  const left=-s.text.length*4*unit/2;
  for (let c=0;c<s.text.length;c++) {
    const glyph=GLYPHS[s.text[c]];
    if (!glyph) continue;
    for (let row=0;row<5;row++) for (let col=0;col<3;col++) {
      if (glyph[row*3+col] !== '1') continue;
      const u=left+(c*4+col)*unit, v=(1.5-row)*unit;
      Q(u,v,u+unit*0.88,v+unit*0.88,0xffe4a1,0.008);
    }
  }
}

/**
 * api is the existing {quad} WorldMeshes builder (plus optional floorAt(level, a, b) -> floor
 * hex for contact shadows); all y values are relative to shell.floor.
 */
export function addFurnishingGeometry(chunk,shell,h,{quad,floorAt}) {
  const plan=shell.plan;
  if (!plan) return;
  const ctx = {chunk,F:plan.frame,h,quad,floorAt,n:0};
  for (const p of plan.furniture || []) prop(ctx,shell,p);
  for (const s of plan.signs || []) {
    const i0 = chunk.buf ? chunk.buf.idx.length : 0;
    plaque(chunk,shell,s,h,quad);
    // a room sign hangs on its door's lintel: it goes when the lintel breaks
    const lintel = (plan.panels || []).find(pn => pn.kind === 'lintel' && pn.level === s.level && pn.e === undefined &&
      Math.hypot(pn.x - s.x, pn.z - s.z) < 0.3 && s.y > pn.y0 && s.y < pn.y1 + 0.2);
    if (lintel && chunk.panelRanges && chunk.buf) chunk.panelRanges.push(lintel, i0, chunk.buf.idx.length - i0);
  }
}

const UP = Object.freeze([0,1,0]);
/**
 * Ceiling light panels (plan.lights): a trim rect and a bright warm-white panel just under the
 * ceiling (wound to face down but given an up normal via quad's lightNormal so the sky fill
 * lights it brightly), plus a brighter "pool" rect on the room floor below. <= 3 quads each.
 */
export function addLightGeometry(chunk,shell,h,{quad,floorAt}) {
  const plan = shell.plan;
  if (!plan || !plan.lights) return;
  const F = plan.frame;
  const P = (a,b,y) => { const [x,z] = toWorld(F,a,b); return [x,y,z]; };
  for (let li = 0; li < plan.lights.length; li++) {
    const L = plan.lights[li];
    if (!L || !(L.a1 > L.a0) || !(L.b1 > L.b0) || !Number.isFinite(L.y)) continue;
    const {a0,b0,a1,b1} = L, y = L.y - shell.floor;
    const ins = Math.min(0.06,(a1-a0)/4,(b1-b0)/4);
    const i0 = chunk.buf ? chunk.buf.idx.length : 0;
    quad(chunk,P(a0,b0,y-0.02),P(a1,b0,y-0.02),P(a1,b1,y-0.02),P(a0,b1,y-0.02),0,-1,0,...rgb(LIGHT_RIM),null,h);
    quad(chunk,P(a0+ins,b0+ins,y-0.03),P(a1-ins,b0+ins,y-0.03),P(a1-ins,b1-ins,y-0.03),P(a0+ins,b1-ins,y-0.03),0,-1,0,...rgb(LIGHT_PANEL),null,h,UP);
    // a light hanging under a breakable roof tile goes with the tile (interiors/shellPanels.js)
    const tile = plan.roofLights ? plan.roofLights[li] : -1;
    if (tile >= 0 && chunk.panelRanges && chunk.buf && plan.panels[tile]) chunk.panelRanges.push(plan.panels[tile], i0, chunk.buf.idx.length - i0);
    const lv = (plan.levels || []).find(l => l.i === L.level);
    if (!lv || !Number.isFinite(lv.y)) continue;
    const floor = floorAt ? floorAt(L.level,(a0+a1)/2,(b0+b1)/2) : null;
    const base = typeof floor === 'number' ? floor : 0x9b917f;
    const col = shade(blend(base,POOL_TINT,0.1),1.04); // subtle: strong pools read as floor markings
    const fy = lv.y - shell.floor + 0.056;
    quad(chunk,P(a0,b0,fy),P(a1,b0,fy),P(a1,b1,fy),P(a0,b1,fy),0,1,0,...rgb(col),null,h);
  }
}
