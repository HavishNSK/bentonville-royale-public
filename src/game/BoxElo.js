// BENTONVILLE ROYALE — Box Fights rating maths (pure, no imports). Used by the client (previews,
// bot ratings) and by party/boxRating.js (server). Ratings are client-reported results, so this
// is a ladder for fun, not a verified competitive rank.

export const ELO_START = 1000;
export const ELO_MIN = 100;
export const ELO_MAX = 3000;
export const BOT_ELO = Object.freeze({ easy: 800, normal: 1200, hard: 1600 });

export const TIERS = Object.freeze([
  Object.freeze({ id: 'bronze', name: 'Trail Rat', min: 0 }),
  Object.freeze({ id: 'silver', name: 'Creek Hopper', min: 900 }),
  Object.freeze({ id: 'gold', name: 'Square Regular', min: 1100 }),
  Object.freeze({ id: 'platinum', name: 'Bridge Walker', min: 1300 }),
  Object.freeze({ id: 'diamond', name: 'Ozark Legend', min: 1500 }),
  Object.freeze({ id: 'champion', name: 'Mayor of Bentonville', min: 1800 }),
]);

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/** Win probability of rating `r` against `opp`. */
export function expectedScore(r, opp) {
  return 1 / (1 + Math.pow(10, (opp - r) / 400));
}

export function kFactor(games, r) {
  if (games < 30) return 40;
  return r < 2400 ? 20 : 10;
}

/** Integer rating change for one result. */
export function eloChange({ rating, games, oppRating, won }) {
  const k = kFactor(games, rating);
  return Math.round(k * ((won ? 1 : 0) - expectedScore(rating, oppRating)));
}

/** Mean of the finite numbers in `list`; ELO_START when there are none. */
export function teamAverage(list) {
  const v = Array.isArray(list) ? list.filter(isNum) : [];
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : ELO_START;
}

export function clampElo(v) {
  if (!isNum(v)) return ELO_START;
  return Math.round(Math.min(ELO_MAX, Math.max(ELO_MIN, v)));
}

export function tierOf(elo) {
  const e = clampElo(elo);
  let t = TIERS[0];
  for (const tier of TIERS) if (e >= tier.min) t = tier;
  return { id: t.id, name: t.name };
}
