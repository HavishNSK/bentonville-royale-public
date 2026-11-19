# Bentonville High School landmark credits

This file credits the code and art used by the Bentonville High School point of interest (`src/world/bhs/`). The project-wide index is [`ASSET_CREDITS.md`](../ASSET_CREDITS.md). Each owner appends its own section.

## Tiger Stadium (stadium.js, stadiumMeshes.js)

- **Code:** original to this project. `GeoBuf`, `addBox` and `canvasTex` in `stadiumMeshes.js` are small local versions of the unexported helpers in `src/world/crystal-bridges/meshes.js` (same project, same licence). The glass colour comes from `GLASS_PANE`, imported from that file. No third-party code.
- **Textures:** all procedural canvas textures drawn at runtime (concrete, aluminium boards, brick, chain-link, turf). No image files.
- **Layout reference:** footprint sizes and orientation (pitch 63 x 128 m long axis north-south, west home grandstand about 76 m with a press box, east visitor stand about 45 m) come from OpenStreetMap data, © OpenStreetMap contributors, ODbL (see [`map-data.md`](map-data.md)). Field markings follow the public high school football field dimensions (53 1/3 x 120 yd, hash marks 53 ft 4 in from the sidelines, 23 ft 4 in goalposts).
- **Not included (by design):** no logos, mascot art, lettering, signage text, real names or photos. The end zones are a plain colour and the scoreboard is blank.

## School buildings (kit/, north.js, south.js, fill.js, interior/)

- **Code:** original to this project.
  - `kit/meshes.js` and `kit/materials.js` follow the patterns of the unexported helpers in `src/world/crystal-bridges/meshes.js` (same project, same licence).
  - The BHS glass starts from `GLASS_PANE`, imported from that file, with a bluer tint, and uses the same streaked pane texture.
  - No third-party code.
- **Textures:** all procedural canvas textures drawn at runtime: brick, block, ribbed and flat metal panels, glass, terrazzo, wood banding, wood plank floor, VCT, carpet, acoustic tile, lockers, paving, roof membrane, the sign band and the tiger emblem. No image files.
- **Colours:** sampled from the user's private reference photos by `tools/bhs/palette.mjs`. Only hex values are in the repo (`docs/bhs/STYLE_BIBLE.md`).
- **Reference photos:** reference only. They stay outside the repo (a pre-commit hook enforces it) and are never used as textures.
- **Tiger emblem:** an original drawing made for this project (`kit/materials.js` `emblemTex`). It is **not** the school's logo artwork.
- **Not included:** no school logo artwork, mascot art, real names, room numbers, cameras or access-control hardware, and no official floor plans. Spaces without photos are approximate (`HACKATHON_NOTES.md`).
