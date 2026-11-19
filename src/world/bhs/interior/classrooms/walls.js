// BENTONVILLE ROYALE — BHS classrooms: wall dressing (approximate, typical US high school).
// Boards, bulletin boards, generic posters (shapes and colour blocks only: no readable text, no
// copied art), a plain striped flag, a clock, a wall TV, coat hooks, blinds on the exterior windows
// and an accent wall. Wall decor depends on the wall panel behind it (hidden when it breaks).

import { C, PAPER, pick, range } from './util.js';
import { inPoly } from '../../kit/plan.js';
import { NORTH_COURT } from '../../north.js';

const OUTLINES = { north: { courts: [NORTH_COURT] }, south: { courts: [] } };

const STROKES = ['#2b3036', '#3c5f8f', '#b23a32', '#4f7d3f'];

/** Whiteboard on a wall: frame, white face, marker tray, a few abstract marker strokes. */
export function whiteboard(rc, wall, s, hs, { strokes = 6, y0 = 0.9, y1 = 2.15 } = {}) {
  const rnd = rc.rnd;
  rc.wdec(wall, s, hs + 0.03, y0 - 0.03, y1 + 0.03, C.boardFrame, 0, 0.025);
  rc.wdec(wall, s, hs, y0, y1, C.board, 0.025, 0.03);
  rc.wdec(wall, s, hs * 0.9, y0 - 0.06, y0 - 0.03, C.boardFrame, 0, 0.08);
  // marker strokes and doodles (wavy runs of short dashes: not text)
  const n = Math.round(strokes * (0.4 + rnd()));
  for (let k = 0; k < n; k++) {
    const col = pick(rnd, STROKES);
    const sy = range(rnd, y0 + 0.15, y1 - 0.12);
    const ss = s + range(rnd, -hs + 0.3, hs - 0.6);
    const len = range(rnd, 0.2, 0.7);
    rc.wdec(wall, ss + len / 2, len / 2, sy, sy + 0.012, col, 0.03, 0.033);
    if (rnd() < 0.4) rc.wdec(wall, ss + len * 0.3, len * 0.25, sy - 0.08, sy - 0.068, col, 0.03, 0.033);
  }
  // a couple of markers and an eraser on the tray
  for (let k = 0; k < 3; k++) rc.wdec(wall, s - hs * 0.5 + k * 0.12, 0.05, y0 - 0.03, y0 - 0.01, pick(rnd, STROKES), 0.03, 0.06);
  rc.wdec(wall, s + hs * 0.4, 0.07, y0 - 0.03, y0 + 0.01, C.charcoal, 0.03, 0.07);
}

/** Interactive smartboard (dark bezel, lit screen) with a short-throw projector arm. */
export function smartboard(rc, wall, s, hs = 0.95) {
  rc.wdec(wall, s, hs + 0.05, 0.95, 2.25, C.black, 0, 0.06);
  rc.wdec(wall, s, hs, 1.0, 2.2, rc.mood === 'dim' ? C.screen : C.screenLit, 0.06, 0.065);
  rc.wdec(wall, s, 0.06, 2.45, 2.55, C.charcoal, 0, 0.75);
  rc.wdec(wall, s, 0.16, 2.38, 2.5, C.white, 0.6, 0.85);
}

/** Pull-down projector screen (partly down). */
export function projectorScreen(rc, wall, s, hs, drop) {
  const top = rc.H - 0.15;
  rc.wdec(wall, s, hs + 0.08, top - 0.1, top, C.white, 0.02, 0.12);
  rc.wdec(wall, s, hs, top - 0.1 - drop, top - 0.1, C.white, 0.06, 0.07);
  rc.wdec(wall, s, hs, top - 0.13 - drop, top - 0.1 - drop, C.charcoal, 0.05, 0.08);
}

/** A generic poster: a coloured ground with 1-3 shape blocks (no text). */
export function poster(rc, wall, s, y, w = 0.45, h = 0.6) {
  const rnd = rc.rnd;
  const bg = pick(rnd, PAPER);
  rc.wdec(wall, s, w / 2, y, y + h, bg, 0, 0.006);
  const k = 1 + Math.floor(rnd() * 3);
  for (let i = 0; i < k; i++) {
    let col = pick(rnd, PAPER);
    if (col === bg) col = C.navy;
    const bw = range(rnd, 0.1, w * 0.4);
    const bh = range(rnd, 0.06, h * 0.35);
    rc.wdec(wall, s + range(rnd, -w / 2 + bw, w / 2 - bw), bw, y + range(rnd, 0.05, h - bh - 0.05), y + range(rnd, 0.05, h - bh - 0.05) + bh, col, 0.006, 0.009);
  }
}

/** Bulletin board: cork, accent border, coloured paper sheets and a poster. */
export function bulletin(rc, wall, s, hs, { y0 = 1.0, y1 = 2.1, papers = 7 } = {}) {
  const rnd = rc.rnd;
  const A = rc.accent;
  rc.wdec(wall, s, hs, y0, y1, C.cork, 0, 0.02);
  // scalloped-style border: accent strips
  rc.wdec(wall, s, hs + 0.04, y1, y1 + 0.06, A.base, 0, 0.025);
  rc.wdec(wall, s, hs + 0.04, y0 - 0.06, y0, A.base, 0, 0.025);
  rc.wdec(wall, s - hs - 0.02, 0.02, y0, y1, A.base, 0, 0.025);
  rc.wdec(wall, s + hs + 0.02, 0.02, y0, y1, A.base, 0, 0.025);
  // backing paper (a big sheet) in a second colour
  if (rnd() < 0.6) rc.wdec(wall, s, hs - 0.06, y0 + 0.06, y1 - 0.06, A.paper, 0.02, 0.022);
  const n = Math.round(papers * (0.5 + rnd()));
  for (let k = 0; k < n; k++) {
    const pw = range(rnd, 0.1, 0.16);
    const ph = range(rnd, 0.14, 0.22);
    const ps = s + range(rnd, -hs + pw + 0.05, hs - pw - 0.05);
    const py = range(rnd, y0 + 0.08, y1 - ph - 0.08);
    rc.wdec(wall, ps, pw, py, py + ph, pick(rnd, PAPER), 0.022, 0.026);
    // a "line" block on white sheets (illegible)
    if (rnd() < 0.5) rc.wdec(wall, ps, pw * 0.7, py + ph * 0.6, py + ph * 0.66, C.navy, 0.026, 0.028);
  }
  // a letter-free "title" banner strip in the accent colour
  if (rnd() < 0.7) rc.wdec(wall, s, hs * 0.5, y1 - 0.18, y1 - 0.08, A.light, 0.026, 0.03);
}

/** Plain striped flag (stripes + a blank canton: no real flag graphic) on a short angled staff. */
export function flag(rc, wall, s, y = 2.05) {
  rc.wdec(wall, s, 0.36, y, y + 0.46, C.white, 0.04, 0.05);
  for (let k = 0; k < 4; k++) rc.wdec(wall, s, 0.36, y + k * 0.12, y + k * 0.12 + 0.06, C.red, 0.05, 0.053);
  rc.wdec(wall, s - 0.2, 0.16, y + 0.22, y + 0.46, C.navy, 0.053, 0.056);
  rc.wdec(wall, s - 0.4, 0.015, y - 0.1, y + 0.55, C.chrome, 0.02, 0.05);
}

/** Wall clock (rim, face, two hands). */
export function clock(rc, wall, s, y = 2.5) {
  const rnd = rc.rnd;
  rc.wdec(wall, s, 0.17, y - 0.17, y + 0.17, C.charcoal, 0, 0.04);
  rc.wdec(wall, s, 0.145, y - 0.145, y + 0.145, C.white, 0.04, 0.045);
  const t = rnd();
  rc.wdec(wall, s + 0.04 * Math.cos(t * 6.28), 0.05, y - 0.01, y + 0.01, C.black, 0.045, 0.05);
  rc.wdec(wall, s, 0.01, y, y + 0.11, C.black, 0.045, 0.05);
}

/** Wall-mounted TV (on a bracket, high). */
export function wallTv(rc, wall, s, y = 2.1, on = false) {
  rc.wdec(wall, s, 0.12, y + 0.1, y + 0.3, C.charcoal, 0, 0.12);
  rc.wdec(wall, s, 0.6, y - 0.05, y + 0.62, C.black, 0.12, 0.18);
  rc.wdec(wall, s, 0.56, y - 0.01, y + 0.58, on ? C.screenLit : C.screen, 0.18, 0.183);
}

/** Coat hooks rail with a few hanging coats / hoodies. */
export function coatHooks(rc, wall, s, hs, bagCols) {
  const rnd = rc.rnd;
  rc.wdec(wall, s, hs, 1.55, 1.65, C.woodMid, 0, 0.025);
  const n = Math.max(3, Math.round((hs * 2) / 0.3));
  for (let k = 0; k < n; k++) {
    const hsK = s - hs + 0.15 + (k * (hs * 2 - 0.3)) / Math.max(1, n - 1);
    rc.wdec(wall, hsK, 0.012, 1.58, 1.6, C.chrome, 0.025, 0.09);
    if (rnd() < 0.35) {
      const col = pick(rnd, bagCols);
      rc.wdec(wall, hsK, 0.2, 0.85, 1.58, col, 0.04, 0.16);
      rc.wdec(wall, hsK, 0.07, 1.4, 1.58, col, 0.16, 0.2);
    }
  }
}

/** Pencil sharpener (wall-mounted, by the door). */
export function sharpener(rc, wall, s) {
  rc.wdec(wall, s, 0.05, 1.0, 1.1, C.chrome, 0, 0.12);
  rc.wdec(wall, s, 0.035, 0.94, 1.0, C.charcoal, 0.03, 0.1);
}

/** A generic periodic-table-style poster: coloured cell columns in the classic silhouette. */
export function periodicChart(rc, wall, s, y = 1.35) {
  const cell = 0.075;
  const w = 18 * cell;
  rc.wdec(wall, s, w / 2 + 0.06, y - 0.06, y + 10 * cell + 0.06, C.white, 0, 0.006);
  const heights = [7, 6, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 6, 6, 6, 6, 6, 7];
  const cols = ['#d4553f', '#e58f3c', '#e9c44a', '#e9c44a', '#e9c44a', '#e9c44a', '#e9c44a', '#e9c44a', '#e9c44a', '#e9c44a', '#e9c44a', '#e9c44a', '#5aa469', '#5aa469', '#4bb0b0', '#4bb0b0', '#4f86c6', '#8e6bb8'];
  const top = y + 10 * cell;
  for (let c = 0; c < 18; c++) {
    let hgt = heights[c];
    if (c === 0) hgt = 7;
    const cs = s - w / 2 + (c + 0.5) * cell;
    const y1 = c === 0 || c === 17 ? top : top - (c === 1 || c >= 12 ? 1 : 3) * cell;
    rc.wdec(wall, cs, cell / 2 - 0.006, y1 - hgt * cell, y1, cols[c], 0.006, 0.009);
  }
  // row lines
  for (let r = 1; r < 7; r++) rc.wdec(wall, s, w / 2, top - r * cell - 0.004, top - r * cell + 0.004, C.white, 0.009, 0.011);
  // the f-block rows below
  rc.wdec(wall, s + cell, 7 * cell, y + 0.02, y + 0.02 + cell - 0.01, '#b98bd0', 0.006, 0.009);
  rc.wdec(wall, s + cell, 7 * cell, y + 0.02 + cell, y + 0.02 + 2 * cell - 0.01, '#d48bb0', 0.006, 0.009);
}

/** Pegboard tool wall with tool silhouettes (blocks). */
export function toolWall(rc, wall, s, hs) {
  const rnd = rc.rnd;
  rc.wdec(wall, s, hs, 1.0, 2.2, '#c8a97e', 0, 0.02);
  const n = Math.round(hs * 7);
  for (let k = 0; k < n; k++) {
    const ts = s - hs + 0.15 + rnd() * (hs * 2 - 0.3);
    const ty = range(rnd, 1.15, 1.95);
    const long = rnd() < 0.5;
    rc.wdec(wall, ts, long ? 0.02 : 0.08, ty, ty + (long ? 0.28 : 0.04), pick(rnd, [C.red, C.charcoal, C.steel, '#e9c44a']), 0.02, 0.05);
  }
}

/** Accent wall: a paint film over every wall panel of a wall (split per panel, so it breaks with it). */
export function accentWall(rc, wall, look) {
  const w = rc.walls[wall];
  const step = 0.6;
  // sample along the wall, grouping consecutive samples on the same wall panel
  let cur = null;
  const runs = [];
  for (let s = w.s0 + 0.02; s <= w.s1 - 0.02 + 1e-6; s += step / 4) {
    const p = rc.wallPartAt(wall, s, 1.2);
    if (cur && cur.p === p) cur.s1 = s;
    else {
      cur = { p, s0: s, s1: s };
      runs.push(cur);
    }
  }
  for (const r of runs) {
    if (!r.p) continue;
    const a = r.s0 - step / 8;
    const b = r.s1 + step / 8;
    const s0 = Math.max(w.s0, a);
    const s1 = Math.min(w.s1, b);
    rc.wdec(wall, (s0 + s1) / 2, (s1 - s0) / 2, 0, Math.min(rc.H, r.p.y1 - rc.y), look, 0, 0.008, { dep: r.p });
  }
  // over the doors: lintel panels above the door head
  for (const d of w.doors) {
    const p = rc.wallPartAt(wall, d.s, 2.6);
    if (p) rc.wdec(wall, d.s, d.w / 2 + 0.01, p.y0 - rc.y, Math.min(rc.H, p.y1 - rc.y), look, 0, 0.008, { dep: p });
  }
}

/**
 * Blinds on the room's exterior windows (each pane), drawn down to a per-window height around the
 * room's blind level (0 = fully up, 1 = closed). Plants on some sills.
 */
/** Is (x, z) inside one of the building's open-air courtyards? */
function courtOutside(building, x, z) {
  const B = OUTLINES[building];
  return !!B && B.courts.some((c) => inPoly(c, x, z));
}

export function blinds(rc, level, look, plants) {
  const K = rc.K;
  const rnd = rc.rnd;
  for (const w of Object.values(rc.walls))
    for (const g of w.windows) {
      let f = Math.max(0, Math.min(1, level + range(rnd, -0.25, 0.25) * (rnd() < 0.5 ? 1 : 0)));
      // windows onto the North Building's outdoor commons stay open (user: classroom glass looks out
      // onto the green courtyard; QA saw lowered blinds read as opaque panels from the court)
      if (courtOutside(rc.building, g.cx - g.nx * 0.9, g.cz - g.nz * 0.9)) f = Math.min(f, 0.2);
      const top = g.y1 + 0.04;
      const bot = top - 0.08 - (g.y1 - g.y0 - 0.06) * f;
      const off = 0.3;
      const cx = g.cx + g.nx * off;
      const cz = g.cz + g.nz * off;
      const dep = g.part;
      K.decor({ cx, cz, hx: g.hx + 0.03, hz: 0.035, yaw: g.yaw, y0: top - 0.08, y1: top }, look, { dep });
      if (f > 0.05) {
        K.decor({ cx, cz, hx: g.hx + 0.02, hz: 0.008, yaw: g.yaw, y0: bot, y1: top - 0.08 }, look, { dep });
        // slat shadow lines
        const n = Math.min(6, Math.floor((top - bot) / 0.25));
        for (let k = 1; k <= n; k++) {
          const yy = top - 0.08 - k * ((top - 0.08 - bot) / (n + 1));
          K.decor({ cx: cx + g.nx * 0.01, cz: cz + g.nz * 0.01, hx: g.hx + 0.02, hz: 0.004, yaw: g.yaw, y0: yy - 0.006, y1: yy }, C.blindGrey, { dep });
        }
      }
      K.decor({ cx: cx + g.nx * 0.01, cz: cz + g.nz * 0.01, hx: g.hx + 0.02, hz: 0.014, yaw: g.yaw, y0: bot - 0.03, y1: bot }, C.greyLight, { dep });
      rc.stats.decor += 3;
      // a plant on the sill
      if (plants && rnd() < plants) {
        const t = range(rnd, -g.hx * 0.6, g.hx * 0.6);
        const px = g.cx + g.nx * 0.29 + Math.cos(g.yaw) * t;
        const pz = g.cz + g.nz * 0.29 + Math.sin(g.yaw) * t;
        const y = g.y0 - 0.01;
        const s = range(rnd, 0.6, 0.9);
        K.decor({ cx: px, cz: pz, hx: 0.08 * s, hz: 0.08 * s, yaw: 0, y0: y, y1: y + 0.13 * s }, C.pot, { shape: 'cyl' });
        K.decor({ cx: px, cz: pz, hx: 0.12 * s, hz: 0.12 * s, yaw: 0, y0: y + 0.13 * s, y1: y + 0.3 * s }, rnd() < 0.5 ? C.green : C.greenDark, { shape: 'cyl' });
        rc.stats.decor += 2;
      }
    }
}

/** A pennant string (bunting) high on a wall: a cord and alternating flags (accent + paper colours). */
export function bunting(rc, wall, s0, s1, y) {
  const rnd = rc.rnd;
  const cols = [rc.accent.base, rc.accent.light, pick(rnd, PAPER), pick(rnd, PAPER)];
  rc.wdec(wall, (s0 + s1) / 2, (s1 - s0) / 2, y, y + 0.012, C.charcoal, 0.01, 0.02);
  let k = 0;
  for (let s = s0 + 0.15; s < s1 - 0.1; s += 0.34) {
    const col = cols[k++ % cols.length];
    rc.wdec(wall, s, 0.1, y - 0.12, y, col, 0.015, 0.02);
    rc.wdec(wall, s, 0.05, y - 0.22, y - 0.12, col, 0.015, 0.02);
  }
}

/** A row of student work (sheets) along the upper wall. */
export function workRow(rc, wall, s0, s1, y) {
  const rnd = rc.rnd;
  for (let s = s0 + 0.25; s < s1 - 0.25; s += range(rnd, 0.32, 0.45)) {
    const h = range(rnd, 0.26, 0.34);
    rc.wdec(wall, s, 0.11, y, y + h, rnd() < 0.5 ? C.white : pick(rnd, PAPER), 0, 0.006);
    if (rnd() < 0.6) rc.wdec(wall, s + range(rnd, -0.04, 0.04), 0.06, y + h * 0.3, y + h * 0.6, pick(rnd, PAPER), 0.006, 0.009);
  }
}
