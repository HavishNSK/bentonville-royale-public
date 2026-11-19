// BENTONVILLE ROYALE — Tiger Stadium: colliders, plan and loot (pure, no three.js; runs in Node).
// Owned by the stadium agent, see docs/bhs/BHS_CONTRACT.md.
//
//   const { parts, loot, plan, stats } = buildStadium(world, { site, owner })
//   stadiumMeshes.js draws `parts` (parts.plan carries the field / pad layout)
//
// Layout (composed-world metres, x east, z south, y up, flat ground y = 0). The real stadium is
// moved into the BHS tile's west strip, keeping its orientation: field long axis north-south,
// home grandstand (two levels + press box) on the west, aluminium visitor bleachers on the east.
//
//   x: fence -126.6 | home stand -126.1..-115 | apron | field -111..-62.2 | apron | visitors
//      -59.2..-50.6 | fence -49.6        (North Building west wall: x -46.2)
//   z: fence 137.6 | scoreboard ~139.6 | field 146.3..256.0 (end zones incl.) | fence 262 |
//      ticket booth + plaza 263..266
//
// Gameplay: every collider is breakable and harvestable with finite hp (kind 'prop': bullets and
// explosives wear it down, the pickaxe harvests it for mats; glass is kind 'glass', breakable, no
// mats, like the Crystal Bridges panes). Nothing can be left floating:
//   - every stand row, wall, rail, fence panel, pole and post stands on the ground (y0 = 0), so
//     breaking a neighbour never leaves it hanging;
//   - pieces that rest on something breakable (press box walls / glass / roof / desks on the press
//     box base, aluminium planks on their frame posts, aisle half-steps on the row below, goal
//     crossbar and uprights on the gooseneck, the scoreboard face on its legs) are listed in their
//     support's `stadiumDeps`. collapseStadiumDeps() removes them with it (the mesh layer calls it
//     from hideCollider on every client, so multiplayer stays in step: one `cx` box event drives
//     the same deterministic cascade everywhere), and restoreStadiumDeps() puts them back.
// Box ids are sequential in a fixed build order (multiplayer names boxes by id).

export const YD = 0.9144;
/** Riser height of every stand row: under the 0.62 m player / World step, so rows are climbable. */
export const RISE = 0.42;
const HALF = RISE / 2; // aisle half step
const RAIL_H = 1.07; // guard rail height (42 in)

/** Hit points by piece (concrete 300-600, aluminium / steel 150-300, glass 70). */
export const STADIUM_HP = Object.freeze({
  row: 450, // concrete stand row
  base: 600, // press box base (solid concrete block)
  wall: 500, // stand back wall / end wall
  press: 350, // press box brick walls
  roof: 300,
  booth: 400,
  step: 300, // concrete aisle half step
  plank: 200, // aluminium bleacher plank
  aluStep: 160,
  post: 250, // steel frame post
  rail: 150,
  fence: 150,
  bench: 150,
  pole: 300, // light tower
  goal: 200,
  goalBar: 150,
  leg: 300,
  board: 250,
  glass: 70,
  desk: 120,
});

/** Pure layout numbers for the stadium inside `site` ({ x0, x1, z0, z1 }). */
export function stadiumPlan(site) {
  const fieldW = (160 / 3) * YD; // 53 1/3 yd
  const fieldL = 120 * YD; // 100 yd + two 10 yd end zones
  const x0 = site.x0 + 16;
  const z0 = site.z0 + 9.3;
  const field = { x0, x1: x0 + fieldW, z0, z1: z0 + fieldL, cx: x0 + fieldW / 2, cz: z0 + fieldL / 2 };
  field.goalN = field.z0 + 10 * YD;
  field.goalS = field.z1 - 10 * YD;

  // home grandstand: 7 lower rows, a cross aisle (the second level's walkway), 5 upper rows and
  // a top walkway; the press box sits on a solid base over the upper rows of the middle sections
  const treads = [0.7, 0.7, 0.7, 0.7, 0.7, 0.7, 0.7, 1.4, 0.7, 0.7, 0.7, 0.7, 0.7, 1.0];
  const front = field.x0 - 4;
  let a = front;
  const levels = treads.map((t, i) => {
    const L = { k: i + 1, a, b: a - t, top: RISE * (i + 1), walk: t > 0.9 };
    a -= t;
    return L;
  });
  const homeLen = 76;
  const hz0 = field.cz - homeLen / 2;
  const nSec = 6;
  const secLen = homeLen / nSec;
  const sections = Array.from({ length: nSec }, (_, i) => {
    const s0 = hz0 + i * secLen;
    return { i, z0: s0, z1: s0 + secLen, aisle: s0 + secLen / 2, press: i === 2 || i === 3 };
  });
  const back = levels[levels.length - 1].b; // west edge of the top walkway
  const home = { front, back, wallX0: back - 0.3, wallX1: back, z0: hz0, z1: hz0 + homeLen, levels, sections, aisleW: 1.2, upperFrom: 9 };
  home.walkTop = levels[levels.length - 1].top;

  const pz0 = sections[2].z0;
  const pz1 = sections[3].z1;
  const nSeg = 4;
  const press = {
    x0: back, // base / interior west edge (the stand's back wall is behind it)
    x1: levels[home.upperFrom - 1].a, // front: over the cross aisle's back edge
    z0: pz0,
    z1: pz1,
    floor: RISE * (levels.length + 1),
    segs: Array.from({ length: nSeg }, (_, i) => ({ i, z0: pz0 + ((pz1 - pz0) * i) / nSeg, z1: pz0 + ((pz1 - pz0) * (i + 1)) / nSeg })),
    doorW: 1.4,
  };
  press.ceil = press.floor + 2.7;
  press.roofTop = press.ceil + 0.3;
  press.sill = press.floor + 1.0;
  press.head = press.ceil - 0.25;

  // visitor stand: aluminium bleachers on a steel frame (open underneath), 4 bays
  const vFront = field.x1 + 3;
  const vLen = 45;
  const vz0 = field.cz - vLen / 2;
  const nBay = 4;
  const vTread = 0.75;
  const vRows = Array.from({ length: 10 }, (_, i) => {
    const a0 = vFront + 1.0 + vTread * i;
    return { r: i + 1, a: a0, b: a0 + vTread, top: RISE * (i + 1) };
  });
  const visitor = {
    front: vFront,
    padX1: vFront + 1.0,
    back: vRows[vRows.length - 1].b,
    z0: vz0,
    z1: vz0 + vLen,
    rows: vRows,
    bents: Array.from({ length: nBay + 1 }, (_, j) => vz0 + (vLen * j) / nBay),
    postRows: [4, 7, 10], // rows with a post under them on every bent line
    solidRows: 3, // rows 1-3 are closed (ground-up) low steps
    aisleW: 1.0,
  };

  // East fence 4.2 m off the field: there are no visitor bleachers (user, 2026-11-18). The strip east
  // of it is the North Building main-entrance plaza (the real entry faces west onto this side).
  const fence = { x0: site.x0 + 0.4, x1: field.x1 + 4.2, z0: site.z0 + 0.6, z1: 262, h: 2.0 };
  const gates = {
    north: [[field.cx + 6.6, field.cx + 12.6]],
    south: [[field.x0 + 1, field.x0 + 9], [field.x1 - 4, field.x1 + 2]],
    east: [[244, 248]],
    westN: [],
    westS: [[250, 254]],
  };
  const towers = [
    { x: front - 5.5, z: home.z0 - 10.7 },
    { x: front - 5.5, z: home.z1 + 10.3 },
    { x: field.x1 + 2.6, z: visitor.z0 - 12.7 },
    { x: field.x1 + 2.6, z: visitor.z1 + 12.3 },
  ].map((t) => ({ ...t, h: 24 }));
  const booth = { x0: field.x0 - 3.5, x1: field.x0 - 0.5, z0: fence.z1 + 1.2, z1: fence.z1 + 3.6, h: 2.7 };
  const scoreboard = { cx: field.cx, cz: site.z0 + 2.6, w: 9.8, legY: 4.4, top: 8.4, legDx: 3.2 };
  const pads = [
    { x0: field.x0 - 8, x1: field.x0 + 12, z0: fence.z1 + 0.05, z1: site.z1 - 0.2 }, // gate plaza
  ];
  // the visitor stand plan stays (its numbers place the east towers) but is not built
  return { site, field, home, press, visitor: { ...visitor, built: false }, fence, gates, towers, booth, scoreboard, pads };
}

/**
 * Register Tiger Stadium. world: a World (addBox / reserve / fixedLoot). Returns
 * { parts, loot, plan, stats }; `parts` (each { role, look, cx, cz, hx, hz, y0, y1, collider,
 * decor }) also carries `parts.plan` for the mesh layer.
 */
export function buildStadium(world, { site, owner = 'bhs' } = {}) {
  if (world.reserve) world.reserve([[site.x0, site.z0], [site.x1, site.z0], [site.x1, site.z1], [site.x0, site.z1]]);
  const plan = stadiumPlan(site);
  const parts = [];
  const stats = { boxes: 0, glass: 0, byRole: {} };

  /** Axis-aligned extents -> box fields (any order of the bounds). */
  const ext = (xa, xb, za, zb, y0, y1) => {
    const x0 = Math.min(xa, xb), x1 = Math.max(xa, xb), z0 = Math.min(za, zb), z1 = Math.max(za, zb);
    return { cx: (x0 + x1) / 2, cz: (z0 + z1) / 2, hx: (x1 - x0) / 2, hz: (z1 - z0) / 2, y0, y1 };
  };
  /** One collider (+ its drawn part). o: { role, look, mat, hp, walkable, ...ext } */
  const add = (o) => {
    const glass = o.mat === 'glass';
    const c = world.addBox({
      cx: o.cx, cz: o.cz, hx: o.hx, hz: o.hz, yaw: 0, y0: o.y0, y1: o.y1,
      kind: glass ? 'glass' : 'prop', // 'prop': harvestable, and explosives smash it
      mat: o.mat,
      hp: o.hp,
      ref: glass ? null : [], // an array: Combat harvests it (mats); glass gives none
    });
    c.owner = owner;
    c.stadium = o.role;
    if (glass) c.breakable = true;
    if (o.walkable) c.walkable = true; // a floor: World.blockedAt (A*, spawns) treats it as open ground
    const part = { role: o.role, look: o.look, cx: o.cx, cz: o.cz, hx: o.hx, hz: o.hz, y0: o.y0, y1: o.y1, collider: c, decor: [], draw: o.draw !== false };
    c.part = part;
    parts.push(part);
    stats.boxes++;
    if (glass) stats.glass++;
    stats.byRole[o.role] = (stats.byRole[o.role] || 0) + 1;
    return part;
  };
  const dep = (support, piece) => {
    if (!support || !piece) return;
    const s = support.collider;
    (s.stadiumDeps || (s.stadiumDeps = [])).push(piece.collider);
    (piece.collider.supports || (piece.collider.supports = [])).push(s.id);
  };
  // decor (visual only, drawn and hidden with its collider)
  const dbox = (p, look, xa, xb, za, zb, y0, y1) => p.decor.push({ t: 'box', look, ...ext(xa, xb, za, zb, y0, y1) });
  const dbeam = (p, look, a, b, w) => p.decor.push({ t: 'beam', look, a, b, w });
  const dpost = (p, look, x, z, y0, y1, w = 0.06) => p.decor.push({ t: 'inst', look, cx: x, cz: z, hx: w / 2, hz: w / 2, y0, y1 });

  const { field, home, press, visitor, fence } = plan;

  // ---------------------------------------------------------------- home grandstand (west)
  const H = home;
  const rowOf = new Map(); // `${section}:${k}` -> row part (k = 0: none)
  const baseSegs = [];
  for (const sec of H.sections) {
    for (const L of H.levels) {
      if (sec.press && L.k >= H.upperFrom) continue; // under the press box: its solid base
      const p = add({ role: 'row', look: 'concrete', mat: 'brick', hp: STADIUM_HP.row, walkable: true, ...ext(L.b, L.a, sec.z0, sec.z1, 0, L.top) });
      rowOf.set(sec.i + ':' + L.k, p);
      if (!L.walk) {
        // aluminium bench seat on the front edge of the step, broken by the aisle
        const za = sec.aisle - H.aisleW / 2 - 0.1;
        const zb = sec.aisle + H.aisleW / 2 + 0.1;
        dbox(p, 'alu', L.a - 0.34, L.a - 0.04, sec.z0 + 0.12, za, L.top, L.top + 0.05);
        dbox(p, 'alu', L.a - 0.34, L.a - 0.04, zb, sec.z1 - 0.12, L.top, L.top + 0.05);
      }
    }
  }
  // press box base: a solid concrete block (one per press segment) whose top is the press floor
  for (const sg of press.segs) {
    baseSegs.push(add({ role: 'pressBase', look: 'concrete', mat: 'brick', hp: STADIUM_HP.base, walkable: true, ...ext(press.x0, press.x1, sg.z0, sg.z1, 0, press.floor) }));
  }
  // aisle half steps (concrete), each resting on the row below it
  for (const sec of H.sections) {
    const za = sec.aisle - H.aisleW / 2;
    const zb = sec.aisle + H.aisleW / 2;
    for (const L of H.levels) {
      if (sec.press && L.k >= H.upperFrom) break;
      const below = L.k > 1 ? H.levels[L.k - 2] : null;
      const y0 = below ? below.top : 0;
      const p = add({ role: 'aisleStep', look: 'concrete', mat: 'brick', hp: STADIUM_HP.step, walkable: true, ...ext(L.a, L.a + 0.35, za, zb, y0, y0 + HALF) });
      if (below) dep(rowOf.get(sec.i + ':' + below.k), p);
      // centre handrail post on every row (the sloped rail is drawn piecewise between them)
      if (!L.walk && L.k % 2 === 1) {
        const n = H.levels[L.k];
        const x1 = n ? n.a - 0.2 : L.b + 0.2;
        dpost(p, 'rail', L.a - 0.2, sec.aisle, L.top, L.top + 0.95, 0.05);
        dbeam(p, 'rail', [L.a - 0.2, L.top + 0.92, sec.aisle], [x1, (n ? n.top : L.top) + 0.92, sec.aisle], 0.045);
      }
    }
  }
  // front rail along the field side (gaps at the aisles), on the ground in front of row 1
  const railX = H.front + 0.4;
  for (const sec of H.sections) {
    for (const [za, zb] of [[sec.z0, sec.aisle - H.aisleW / 2 - 0.1], [sec.aisle + H.aisleW / 2 + 0.1, sec.z1]]) {
      const p = add({ role: 'rail', look: null, mat: 'metal', hp: STADIUM_HP.rail, draw: false, ...ext(railX, railX + 0.08, za, zb, 0, RAIL_H) });
      railDecor(p, railX + 0.04, za, zb, 0);
    }
  }
  // back wall (also the press box's back wall in the middle sections) and the guard rail on it
  for (const sec of H.sections) {
    if (sec.press) continue;
    // a solid parapet 1 m over the top walkway (too high to step onto)
    add({ role: 'backWall', look: 'concrete', mat: 'brick', hp: STADIUM_HP.wall, ...ext(H.wallX0, H.wallX1, sec.z0, sec.z1, 0, H.walkTop + 1.0) });
  }
  for (const sg of press.segs) add({ role: 'backWall', look: 'brick', mat: 'brick', hp: STADIUM_HP.wall, ...ext(H.wallX0, H.wallX1, sg.z0, sg.z1, 0, press.ceil) });
  // stepped end walls at both ends of the stand (guard 1 m above each row)
  for (const [za, zb] of [[H.z0 - 0.25, H.z0], [H.z1, H.z1 + 0.25]]) {
    for (const L of H.levels) add({ role: 'endWall', look: 'concrete', mat: 'brick', hp: STADIUM_HP.wall, ...ext(L.b, L.a, za, zb, 0, L.top + 1.0) });
  }

  // ---------------------------------------------------------------- press box (on its base)
  const P = press;
  const T = 0.2; // wall thickness
  P.desks = [];
  for (const sg of P.segs) {
    const base = baseSegs[sg.i];
    const on = (o) => {
      const p = add(o);
      dep(base, p);
      return p;
    };
    on({ role: 'pressWall', look: 'brick', mat: 'brick', hp: STADIUM_HP.press, ...ext(P.x1 - T, P.x1, sg.z0, sg.z1, P.floor, P.sill) });
    const mid = (sg.z0 + sg.z1) / 2;
    for (const [za, zb] of [[sg.z0 + 0.06, mid - 0.03], [mid + 0.03, sg.z1 - 0.06]]) {
      on({ role: 'glass', look: 'glass', mat: 'glass', hp: STADIUM_HP.glass, ...ext(P.x1 - 0.14, P.x1 - 0.06, za, zb, P.sill, P.head) });
    }
    const head = on({ role: 'pressWall', look: 'brick', mat: 'brick', hp: STADIUM_HP.press, ...ext(P.x1 - T, P.x1, sg.z0, sg.z1, P.head, P.ceil) });
    // window frame: mullions at the pane joints and a sill ledge (visual)
    for (const z of [sg.z0, mid, sg.z1]) dbox(head, 'frame', P.x1 - 0.16, P.x1 - 0.04, z - 0.05, z + 0.05, P.sill, P.head);
    dbox(head, 'frame', P.x1 - 0.18, P.x1 + 0.06, sg.z0, sg.z1, P.sill - 0.06, P.sill);
    const roof = on({ role: 'roof', look: 'roof', mat: 'metal', hp: STADIUM_HP.roof, ...ext(H.wallX0 - 0.1, P.x1 + 0.35, sg.z0 - 0.01, sg.z1 + 0.01, P.ceil, P.roofTop) });
    dbox(roof, 'frame', P.x1 + 0.2, P.x1 + 0.4, sg.z0, sg.z1, P.ceil - 0.15, P.roofTop + 0.05); // fascia
    if (sg.i === 0 || sg.i === P.segs.length - 1) {
      // end wall with the door from the top walkway
      const [za, zb] = sg.i === 0 ? [sg.z0, sg.z0 + T] : [sg.z1 - T, sg.z1];
      const doorX = P.x0 + P.doorW;
      on({ role: 'pressWall', look: 'brick', mat: 'brick', hp: STADIUM_HP.press, ...ext(doorX, P.x1, za, zb, P.floor, P.ceil) });
      const lintel = on({ role: 'pressWall', look: 'brick', mat: 'brick', hp: STADIUM_HP.press, ...ext(P.x0, doorX, za, zb, P.floor + 2.1, P.ceil) });
      dbox(lintel, 'frame', doorX - 0.06, doorX, za - 0.02, zb + 0.02, P.floor, P.floor + 2.1);
    } else {
      // broadcast / scouting desk along the window (the two middle segments)
      const d = on({ role: 'desk', look: 'wood', mat: 'wood', hp: STADIUM_HP.desk, ...ext(P.x1 - T - 0.7, P.x1 - T - 0.05, sg.z0 + 0.5, sg.z1 - 0.5, P.floor, P.floor + 0.76) });
      P.desks.push(d);
    }
  }

  // ---------------------------------------------------------------- visitor bleachers (east): NOT BUILT
  // (user, 2026-11-18: they stood in front of the North Building main entrance). The builder is kept
  // behind plan.visitor.built so the layout can be restored.
  const V = visitor;
  if (V.built !== false) {
  const posts = []; // [bent][postRowIndex] -> part
  V.bents.forEach((bz, j) => {
    const z = j === 0 ? bz + 0.1 : j === V.bents.length - 1 ? bz - 0.1 : bz;
    posts.push(
      V.postRows.map((r) => {
        const R = V.rows[r - 1];
        const x = (R.a + R.b) / 2;
        const p = add({ role: 'post', look: 'steel', mat: 'metal', hp: STADIUM_HP.post, ...ext(x - 0.08, x + 0.08, z - 0.08, z + 0.08, 0, R.top - 0.1) });
        return p;
      }),
    );
  });
  // frame decor: a raked stringer along each bent and braces down to the posts
  V.bents.forEach((bz, j) => {
    const z = j === 0 ? bz + 0.1 : j === V.bents.length - 1 ? bz - 0.1 : bz;
    const top = posts[j][posts[j].length - 1];
    const R1 = V.rows[0];
    const RN = V.rows[V.rows.length - 1];
    dbeam(top, 'steel', [R1.a, R1.top - 0.16, z], [RN.b, RN.top - 0.16, z], 0.12);
    for (let i = 0; i + 1 < posts[j].length; i++) {
      const pa = posts[j][i];
      const pb = posts[j][i + 1];
      dbeam(pa, 'steel', [pa.cx, 0.2, z], [pb.cx, pb.y1 - 0.3, z], 0.07);
    }
  });
  const tributary = (r) => {
    // which post row carries row r: 4-5 -> 4, 6-8 -> 7, 9-10 -> 10
    if (r <= 5) return 0;
    if (r <= 8) return 1;
    return 2;
  };
  const planks = new Map(); // `${bay}:${r}` -> part
  const nBay = V.bents.length - 1;
  for (let b = 0; b < nBay; b++) {
    const z0 = V.bents[b];
    const z1 = V.bents[b + 1];
    for (const R of V.rows) {
      const solid = R.r <= V.solidRows;
      const p = add({
        role: solid ? 'aluStep' : 'plank',
        look: 'alu',
        mat: 'metal',
        hp: solid ? STADIUM_HP.plank + 50 : STADIUM_HP.plank,
        walkable: true,
        ...ext(R.a, R.b, z0, z1, solid ? 0 : R.top - 0.1, R.top),
      });
      planks.set(b + ':' + R.r, p);
      if (!solid) {
        const t = tributary(R.r);
        dep(posts[b][t], p);
        dep(posts[b + 1][t], p);
      }
      // end guard rails on the two end bays (visual, hidden with the row)
      if (b === 0) railDecor(p, null, R.a, R.b, R.top, 0.9, z0 + 0.04);
      if (b === nBay - 1) railDecor(p, null, R.a, R.b, R.top, 0.9, z1 - 0.04);
    }
    // aisle half steps at the bay centre, each on the row below
    const zc = (z0 + z1) / 2;
    for (const R of V.rows) {
      const below = R.r > 1 ? V.rows[R.r - 2] : null;
      const y0 = below ? below.top : 0;
      const p = add({ role: 'aluStep', look: 'alu', mat: 'metal', hp: STADIUM_HP.aluStep, walkable: true, ...ext(R.a - 0.35, R.a, zc - V.aisleW / 2, zc + V.aisleW / 2, y0, y0 + HALF) });
      if (below) dep(planks.get(b + ':' + below.r), p);
    }
    // back guard (aluminium panel over the top row), on the bay's back posts
    const RN = V.rows[V.rows.length - 1];
    const g = add({ role: 'rail', look: 'alu', mat: 'metal', hp: STADIUM_HP.rail, ...ext(V.back, V.back + 0.08, z0, z1, RN.top - 0.6, RN.top + RAIL_H) });
    dep(posts[b][2], g);
    dep(posts[b + 1][2], g);
    railDecor(g, V.back + 0.04, z0, z1, RN.top + 0.5, 0.57);
  }

  }

  // ---------------------------------------------------------------- team benches
  const benchZ = [[field.cz - 15, field.cz - 5.5], [field.cz - 4.75, field.cz + 4.75], [field.cz + 5.5, field.cz + 15]];
  for (const xc of [field.x0 - 2.4, field.x1 + 1.6]) {
    for (const [za, zb] of benchZ) {
      // ground-up collider (a bench stands on its own legs); drawn as seat + legs
      const p = add({ role: 'bench', look: null, draw: false, mat: 'metal', hp: STADIUM_HP.bench, walkable: true, ...ext(xc - 0.2, xc + 0.2, za, zb, 0, 0.46) });
      dbox(p, 'alu', xc - 0.2, xc + 0.2, za, zb, 0.4, 0.46);
      for (let z = za + 0.3; z < zb; z += 2.2) dbox(p, 'steel', xc - 0.17, xc + 0.17, z, z + 0.06, 0, 0.4);
    }
  }

  // ---------------------------------------------------------------- goalposts (gooseneck, HS width)
  const goals = [];
  for (const [endZ, sgn] of [[field.z0, -1], [field.z1, 1]]) {
    const baseZ = endZ + sgn * 1.83;
    const cx = field.cx;
    const base = add({ role: 'goal', look: 'yellow', mat: 'metal', hp: STADIUM_HP.goal, ...ext(cx - 0.15, cx + 0.15, baseZ - 0.15, baseZ + 0.15, 0, 3.05) });
    dbox(base, 'pad', cx - 0.26, cx + 0.26, baseZ - 0.26, baseZ + 0.26, 0, 1.8); // post padding
    dbeam(base, 'yellow', [cx, 2.95, baseZ], [cx, 2.95, endZ], 0.16); // gooseneck arm
    const half = (23 + 4 / 12) * 0.3048 * 0.5;
    const bar = add({ role: 'goalBar', look: 'yellow', mat: 'metal', hp: STADIUM_HP.goalBar, ...ext(cx - half, cx + half, endZ - 0.06, endZ + 0.06, 2.95, 3.07) });
    dep(base, bar);
    for (const ux of [cx - half, cx + half]) {
      const up = add({ role: 'goalBar', look: 'yellow', mat: 'metal', hp: STADIUM_HP.goalBar, ...ext(ux - 0.05, ux + 0.05, endZ - 0.05, endZ + 0.05, 3.07, 3.07 + 6.1) });
      dep(bar, up);
    }
    goals.push(base);
  }

  // ---------------------------------------------------------------- light towers
  for (const t of plan.towers) {
    const p = add({ role: 'pole', look: 'steel', mat: 'metal', hp: STADIUM_HP.pole, ...ext(t.x - 0.35, t.x + 0.35, t.z - 0.35, t.z + 0.35, 0, t.h) });
    // lamp rack facing the field centre (visual, falls with the pole)
    const dx = field.cx - t.x;
    const dz = field.cz - t.z;
    const d = Math.hypot(dx, dz);
    const nx = dx / d, nz = dz / d; // towards the field
    const ux = -nz, uz = nx; // along the rack
    const rx = t.x + nx * 0.6, rz = t.z + nz * 0.6;
    p.decor.push({ t: 'rack', look: 'steel', x: rx, z: rz, ux, uz, nx, nz, y0: t.h - 2.6, y1: t.h + 0.6, w: 6.4 });
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 5; col++) {
        const s = (col - 2) * 1.25;
        const y = t.h - 2.2 + row * 1.0;
        p.decor.push({ t: 'lamp', look: 'lamp', x: rx + ux * s + nx * 0.35, z: rz + uz * s + nz * 0.35, y, nx, nz });
      }
    }
    dbeam(p, 'steel', [t.x, 0.9, t.z], [t.x, t.h - 2.6, t.z], 0.04); // ladder cage (thin line)
  }

  // ---------------------------------------------------------------- scoreboard (blank)
  const SB = plan.scoreboard;
  const legs = [-SB.legDx, SB.legDx].map((dx) =>
    add({ role: 'leg', look: 'steel', mat: 'metal', hp: STADIUM_HP.leg, ...ext(SB.cx + dx - 0.2, SB.cx + dx + 0.2, SB.cz - 0.2, SB.cz + 0.2, 0, SB.legY) }),
  );
  const board = add({ role: 'board', look: 'board', mat: 'metal', hp: STADIUM_HP.board, ...ext(SB.cx - SB.w / 2, SB.cx + SB.w / 2, SB.cz - 0.3, SB.cz + 0.3, SB.legY, SB.top) });
  for (const l of legs) dep(l, board);
  board.face = { z: SB.cz + 0.3 }; // the field-facing side (+z): blank panels drawn on it

  // ---------------------------------------------------------------- perimeter fence + gates
  const F = fence;
  const runs = [
    { axis: 'x', at: F.z0, a: F.x0, b: F.x1, gates: plan.gates.north },
    { axis: 'x', at: F.z1, a: F.x0, b: F.x1, gates: plan.gates.south },
    { axis: 'z', at: F.x1, a: F.z0, b: F.z1, gates: plan.gates.east },
    { axis: 'z', at: F.x0, a: F.z0, b: H.z0 - 0.25, gates: plan.gates.westN },
    { axis: 'z', at: F.x0, a: H.z1 + 0.25, b: F.z1, gates: plan.gates.westS },
  ];
  plan.gateLeaves = [];
  for (const run of runs) {
    const spans = [];
    let at = run.a;
    for (const [ga, gb] of run.gates.slice().sort((p, q) => p[0] - q[0])) {
      if (ga > at) spans.push([at, ga]);
      plan.gateLeaves.push({ axis: run.axis, at: run.at, a: ga, b: gb });
      at = gb;
    }
    if (run.b > at) spans.push([at, run.b]);
    for (const [sa, sb] of spans) {
      const n = Math.max(1, Math.ceil((sb - sa) / 6));
      for (let i = 0; i < n; i++) {
        const u0 = sa + ((sb - sa) * i) / n;
        const u1 = sa + ((sb - sa) * (i + 1)) / n;
        const e = run.axis === 'x' ? ext(u0, u1, run.at - 0.03, run.at + 0.03, 0, F.h) : ext(run.at - 0.03, run.at + 0.03, u0, u1, 0, F.h);
        const p = add({ role: 'fence', look: 'fence', mat: 'metal', hp: STADIUM_HP.fence, ...e });
        p.axis = run.axis;
        // posts at both ends and a top rail
        for (const u of i === 0 ? [u0, u1] : [u1]) {
          const [x, z] = run.axis === 'x' ? [u, run.at] : [run.at, u];
          dpost(p, 'post', x, z, 0, F.h + 0.05, 0.07);
        }
        const [ax, az, bx, bz] = run.axis === 'x' ? [u0, run.at, u1, run.at] : [run.at, u0, run.at, u1];
        dbeam(p, 'post', [ax, F.h, az], [bx, F.h, bz], 0.045);
      }
    }
  }

  // ---------------------------------------------------------------- ticket booth (outside the main gate)
  const B = plan.booth;
  const booth = add({ role: 'booth', look: 'brick', mat: 'brick', hp: STADIUM_HP.booth, ...ext(B.x0, B.x1, B.z0, B.z1, 0, B.h) });
  dbox(booth, 'roof', B.x0 - 0.45, B.x1 + 0.45, B.z0 - 0.45, B.z1 + 0.45, B.h, B.h + 0.22);
  dbox(booth, 'glassDecor', B.x0 + 0.5, B.x1 - 0.5, B.z1, B.z1 + 0.03, 1.1, 2.1); // ticket window
  dbox(booth, 'frame', B.x0 + 0.4, B.x1 - 0.4, B.z1, B.z1 + 0.3, 1.0, 1.06); // counter ledge
  dbox(booth, 'frame', B.x0 - 0.02, B.x1 + 0.02, B.z0 - 0.02, B.z1 + 0.02, 0, 0.3); // plinth

  // ---------------------------------------------------------------- loot
  const seg1 = P.segs[1];
  const loot = [
    // high-tier chest in the press box, between the desk and the back wall
    { kind: 'chest', tier: 'high', x: P.x0 + 1.5, z: (seg1.z0 + seg1.z1) / 2, y: P.floor, yaw: Math.PI / 2, at: 'pressBox' },
    // under the visitor bleachers (open frame, ~3.6 m headroom there)
    // behind the north end zone, by the scoreboard legs
    { kind: 'chest', x: field.cx - 8, z: field.z0 - 3.5, y: 0, yaw: 0, at: 'northEnd' },
    // behind the south end of the home stand
    { kind: 'chest', x: H.front - 6, z: H.z1 + 4.5, y: 0, yaw: 0, at: 'homeSouthEnd' },
    { kind: 'ammoBox', x: field.x0 - 2.4, z: benchZ[0][0] - 1.6, y: 0, yaw: 0, at: 'homeBench' },
    { kind: 'ammoBox', x: field.x1 + 1.6, z: benchZ[2][1] + 1.6, y: 0, yaw: Math.PI, at: 'visitorBench' },
    { kind: 'item', x: SB.cx, z: SB.cz + 1.2, y: 0, yaw: 0, at: 'scoreboard' },
  ];
  world.fixedLoot = (world.fixedLoot || []).concat(loot);

  parts.plan = plan;
  plan.goals = goals;
  return { parts, loot, plan, stats };

  /** Guard rail decor: posts every ~2 m and a top + mid tube, from y0 (rail top y0 + h). */
  function railDecor(p, x, za, zb, y0, h = RAIL_H, zFixed = null) {
    if (zFixed != null) {
      // a rail running along x (stand ends): from x = za to x = zb at z = zFixed
      const n = Math.max(1, Math.round(Math.abs(zb - za) / 1.6));
      for (let i = 0; i <= n; i++) dpost(p, 'rail', za + ((zb - za) * i) / n, zFixed, y0, y0 + h, 0.045);
      dbeam(p, 'rail', [za, y0 + h, zFixed], [zb, y0 + h, zFixed], 0.045);
      return;
    }
    const n = Math.max(1, Math.round((zb - za) / 2));
    for (let i = 0; i <= n; i++) dpost(p, 'rail', x, za + ((zb - za) * i) / n, y0, y0 + h, 0.05);
    dbeam(p, 'rail', [x, y0 + h, za], [x, y0 + h, zb], 0.05);
    dbeam(p, 'rail', [x, y0 + h * 0.5, za], [x, y0 + h * 0.5, zb], 0.035);
  }
}

/**
 * A stadium collider broke: remove everything that rested on it (recursively) from the world.
 * Deterministic (fixed dependency order). Calls onGone(c) for each removed dependent. Returns
 * the removed colliders. Dependents already gone (broken on their own) are left alone.
 */
export function collapseStadiumDeps(world, c, onGone) {
  const out = [];
  const walk = (s) => {
    const deps = s && s.stadiumDeps;
    if (!deps) return;
    for (const d of deps) {
      if (!d.alive) continue;
      world.remove(d);
      d.cascadeFrom = s.id;
      out.push(d);
      if (onGone) onGone(d);
      walk(d);
    }
  };
  walk(c);
  return out;
}

/** The support came back (match restart): restore what collapseStadiumDeps removed with it. */
export function restoreStadiumDeps(world, c, onBack) {
  const out = [];
  const walk = (s) => {
    const deps = s && s.stadiumDeps;
    if (!deps) return;
    for (const d of deps) {
      if (d.alive || d.cascadeFrom !== s.id) continue;
      world.restore(d);
      d.cascadeFrom = undefined;
      out.push(d);
      if (onBack) onBack(d);
      walk(d);
    }
  };
  walk(c);
  return out;
}
