# Bentonville Square — source index

Snapshot target: **2026-11-19**. Frame: game metres, x east, z **south**, y up, 1 m = 1 m
(the Square tile is an unrotated real-map cut-out; `layout.json` `anchor`). Every source
below was actually opened unless marked otherwise.

| ID | Source | Date | Rights / use | Opened | What it proves |
|----|--------|------|--------------|--------|----------------|
| S01 | OpenStreetMap via Overpass API (bbox 36.3715,-94.2104,36.3742,-94.2068) | live, fetched 2026-11-19 | ODbL, attributed in `credits/map-data.md`; data already in the game | yes | Park polygon (way 493572832), all park walks incl. the fountain ring, street centrelines, kerbs, crossings, building footprints. Game data = live OSM to 0.1 m. |
| S02 | Esri World Imagery (Vantor GE01, "Vivid Advanced"), tile service z19 | **2025-09-27**, 0.46 m, stated accuracy 8.47 m | Reference viewing only. Not redistributed, not in the game, not in this repo. | yes | Fountain water ring position (agrees with OSM ring), park edge, angled parking N and S, north block building still standing, bare site east of it. |
| S03 | USDA NAIP via USGS The National Map ImageServer (exportImage) | year not returned by the service (catalog query empty) | Public domain (already credited) | yes | Tree crown positions/sizes, fountain basin/planter radii, brick vs grass. **Sits up to ~4 m south-east of S01/S02 here**: corrected before use (see accuracy-report). |
| S04 | City of Bentonville — City Square page | — | reference | **no** (not opened this pass) | Official name/address, bench count (6) to verify. |
| S05 | Benton County / City GIS portals | — | per portal terms | **no** | Survey-grade footprints — needed to settle the north block and building depths. |
| S06 | Google Street View / Mapillary (all four frontages) | — | reference viewing only | **no** | Facades, storefront bays, signs — needed for Phase C. |
| S07 | Wikimedia Commons courthouse / Walmart Museum photos | — | per-file licence | **no** | Facade detail. |

Links listed in the brief that were **not** opened in this pass: everything in brief §3.2–3.6
except OSM/Overpass. They are the work list for the facade pass (Phase C).

## Reference views (game renders, ours)

`docs/square/shots/` — produced by `node tools/qa/square-shots.mjs` from the cameras in
`public/data/bentonville-square/cameras.json`:

| View | Camera | Must reproduce | Status |
|------|--------|----------------|--------|
| A01 | north-up ortho-ish, 260 m up over (-15, 20) | block, park edges, streets, walks | park walks/fountain/trees match S01+S02; buildings are extrusions |
| A02 / A03 | SW→NE / NE→SW aerials | rooflines, landscaping | massing only |
| W01 | fountain → west | Walmart Museum, Main St frontage | **UNVERIFIED** facades |
| E01 | fountain → east | courthouse | **UNVERIFIED** facades |
| N01 | fountain → north | NE 2nd St frontage (Hart on Main site) | building shown standing per S02 (2025-09-27); 2026 state unverified |
| S01 | fountain → south | Central Ave storefronts | **UNVERIFIED** facades |
| `A01-before` | as A01, before this pass | — | for comparison |

Source imagery screenshots are **not** stored here (no redistribution rights for S02).
