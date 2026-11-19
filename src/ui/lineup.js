// BENTONVILLE ROYALE — title line-up formation (pure; used by Showcase.js, tested in node).
//
//   lineUpSpots(n)            -> [{ x, z }] for n members, member 0 (you) front and centre
//   lineUpHalfWidth(n)        -> metres from the middle to the outer edge of the row

export const LINEUP_MAX = 8; // line-up size cap (parties are 4; room for bigger lobbies)
export const LINEUP_GAP = 1.05; // metres between neighbours: shoulders never overlap
const BODY_HALF = 0.62; // a character's half-width plus a little air

/** You front and centre, the rest alternate right / left and step back; the row is centred. */
export function lineUpSpots(n) {
  const count = Math.max(0, Math.min(LINEUP_MAX, n | 0));
  const out = [];
  for (let i = 0; i < count; i++) {
    const rank = Math.ceil(i / 2); // 0, 1, 1, 2, 2, ...
    const side = i === 0 ? 0 : i % 2 ? 1 : -1;
    out.push({ x: side * rank * LINEUP_GAP, z: i === 0 ? 0.35 : -0.12 * rank });
  }
  // an even count leans to one side: centre the row on the camera
  if (out.length) {
    const xs = out.map((p) => p.x);
    const mid = (Math.min(...xs) + Math.max(...xs)) / 2;
    for (const p of out) p.x -= mid;
  }
  return out;
}

/** Framed for at least two: a solo character stands at a calm size, not a giant close-up. */
export function lineUpHalfWidth(n) {
  const count = Math.max(2, Math.min(LINEUP_MAX, n | 0));
  return ((count - 1) * LINEUP_GAP) / 2 + BODY_HALF;
}
