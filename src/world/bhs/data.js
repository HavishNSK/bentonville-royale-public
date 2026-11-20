// BENTONVILLE ROYALE — Bentonville High School: map data overrides (pure, deterministic, no three.js).
//
// applyBhsOverrides(mapData) runs once in the World constructor, before anything reads the data,
// so the game, the multiplayer world hash, scripts/check-*.mjs and the tests all see the same map.
// It only touches BHS ids; if they are missing (a test map, another map) it does nothing.
// See docs/bhs/BHS_CONTRACT.md.

export const BHS_KEY = 'bentonville_high';
export const BHS_MAIN = 952075842; // south / main building (Arend Arts Center, Tiger Arena)
export const BHS_NORTH = 952075843; // North Building
export const BHS_IDS = Object.freeze([BHS_MAIN, BHS_NORTH]);

// Real storey counts (user, 2026-11-18): North Building 3 floors, main building 2 floors. The OSM /
// Overture tags in the composed map say 2 and 1. Heights give storeys.js / World._planShell a
// 4.4 m floor-to-floor (the planner's STOREY_MAX is 4.5 m).
export const BHS_STOREYS = Object.freeze({
  [BHS_MAIN]: Object.freeze({ lv: 2, h: 8.8 }),
  [BHS_NORTH]: Object.freeze({ lv: 3, h: 13.2 }),
});

// Tiger Stadium site in composed-world metres (x east, z south). The real stadium is ~280 m west
// across SE J St; like every landmark tile on this map it is moved, here into the tile's west
// strip (unmapped parking aisles), keeping its real north-south field and west home stand.
export const BHS_STADIUM_SITE = Object.freeze({ x0: -127, x1: -49, z0: 137, z1: 268 });

// HUD label / loot-area radius of the landmark (see applyBhsOverrides).
export const BHS_LABEL_R = 185;

// Unmapped parking aisles (service roads) inside the stadium site.
export const BHS_REMOVED_ROADS = Object.freeze([952078967, 952078968, 952078969, 952078970, 1281872772]);

/** Is the composed map's BHS tile where these overrides were drawn for? */
export function hasBhs(mapData) {
  const lm = mapData && mapData.landmarks && mapData.landmarks[BHS_KEY];
  if (!lm || !lm.found || !Array.isArray(lm.ids)) return false;
  return BHS_IDS.every((id) => lm.ids.includes(id)) && Array.isArray(mapData.buildings) && mapData.buildings.some((b) => b.id === BHS_MAIN);
}

/** Apply the BHS overrides in place (idempotent). Returns mapData. */
export function applyBhsOverrides(mapData) {
  if (!hasBhs(mapData) || mapData._bhsApplied) return mapData;
  for (const bd of mapData.buildings) {
    const s = BHS_STOREYS[bd.id];
    if (s) {
      bd.lv = s.lv;
      bd.h = s.h;
    }
  }
  if (Array.isArray(mapData.roads)) {
    const drop = new Set(BHS_REMOVED_ROADS);
    mapData.roads = mapData.roads.filter((r) => !drop.has(r.id));
  }
  // HUD place name / loot area radius: reach the stadium's far corner (the HUD shows a landmark's name
  // within r * 1.2 of its centre; the scoreboard is ~219 m away). The drop point (x, z) is unchanged.
  mapData.landmarks[BHS_KEY].r = Math.max(mapData.landmarks[BHS_KEY].r || 0, BHS_LABEL_R);
  Object.defineProperty(mapData, '_bhsApplied', { value: true, enumerable: false });
  return mapData;
}
