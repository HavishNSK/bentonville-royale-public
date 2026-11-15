# Wave 2 / B: terrain and buildings in-game

Status: IN PROGRESS (this file is updated as work lands).

## Plan
- World.js: heightfield + bilinear `terrainHeight`, terrain-based `groundHeight`, heightfield ray march, prism/cylinder `y0` bases.
- WorldMeshes.js: chunked toon terrain with the NAIP tint, draped roads/areas, bridges, walls to `y0`, gable/hip roofs, OSM colours, NAIP trees with LOD, toon materials.
- Structures / Atmosphere / Effects / Bots: remove the y = 0 assumptions.
