# Bentonville Square — accuracy report

Pass 1 (2026-11-19/20): survey + park. Honest status: **the park is surveyed; the four street
walls are not.** Nothing here is "1:1 complete".

## What was built

| Part | Status | Basis |
|------|--------|-------|
| Streets, block, park outline, all park walks | **verified** (OSM = Esri 2025 within ~1 m around the park) | S01, S02 |
| Brick walks + brick plaza (r 7.8 m) around the fountain | colour from imagery; geometry = OSM ways | S01, S02, S03 |
| Fountain: basin r 5.1, rim 0.55 h, water, raised planter r 2.4, spray ring | position **verified**; radii estimated (±0.5 m); heights estimated | S02, S03 |
| 15 shade trees (T01–T15) | **estimated** crown centres, corrected NAIP → OSM frame; 9 trunks nudged ≤ 2.5 m off walks | S03 |
| North block building (NE 2nd St, x -42.5..4, z -66..-26.5, 2 storeys) | **estimated**; present 2025-09-27, missing from OSM | S02, S03 |
| Generic scatter in the park (random trees, rocks, benches, market stalls, reboot vans, cars, loot) | removed: the park is reserved | — |
| Square loot: 2 chests, 4 floor items | game-only (layout.json `loot`) | — |
| Facades of all four frontages | **missing** (generic OSM/Overture extrusions) | — |
| Benches, lamps, bins, planters in the park | **missing** — not resolvable at 0.46–0.6 m | needs S04/S06 |

Old Confederate monument: not modelled (removed 2020); the centre is a planter, as in 2025 imagery.

## Discrepancies found

1. **NAIP vs OSM/Esri offset** — NAIP puts the fountain 1.6 m W / 3.6 m N of the OSM ring and
   the south park walk ~5 m off; it agrees at NE 2nd St. OSM and Esri 2025 agree with each
   other, so NAIP is the outlier. Correction applied to NAIP-derived trees:
   `x += 0.1 (z + 2)`, `z += 0.22 (z + 2)` (linear fit through the 2nd St edge and the fountain).
2. **North block depth** — north wall at z -61 (NAIP) vs -72 (Esri); mean -66 used. ±6 m.
3. **North block 2026 status** — Hart on Main (announced 2026-02, planning 2026-07) is on this
   block. The newest dated evidence opened (2025-09-27) shows the building standing and the
   east part of the block cleared. A dated 2026 photo is needed; if it shows demolition, delete
   `buildings.list[0]` in `layout.json`.

## Needs field / better-source confirmation

- Fountain basin outer radius, rim height, planter height, jets (photos).
- Tree trunk positions and species (leaf-off aerial or site visit).
- Bench (6 per City), lamp, bin positions.
- All storefront widths, heights, bays (Street View panoramas, county footprints).
- Courthouse and Walmart Museum footprints vs OSM (the museum footprint is a 5.1 m-tall box).

## Rubric (self-score, project QA target, not survey proof)

| Category | Weight | Score | Why |
|----------|--------|-------|-----|
| Streets and block geometry | 25 | 21 | OSM-verified, unrotated, 1:1; kerbs/parking bays not modelled as geometry |
| Park / fountain / paths | 25 | 18 | layout right; tree/fountain dims estimated; no furniture |
| Four-sided building geometry | 25 | 8 | footprints from OSM; north block estimated; no facade bays |
| Facade identity and materials | 15 | 1 | not started |
| Gameplay and performance | 10 | 8 | playable, collidable, tests pass; FPS not measured on a laptop |
| **Total** | 100 | **56** | below the 90 release threshold |

## Five biggest fixes this pass

1. Fountain, plaza and centre planter built at the surveyed spot (was an empty grass circle).
2. Park walks drawn as brick (were generic concrete).
3. Random trees/benches/market stalls replaced by 15 surveyed trees.
4. North block building restored across NE 2nd St (OSM had dropped it).
5. Reboot vans no longer park inside reserved landmark grounds.
