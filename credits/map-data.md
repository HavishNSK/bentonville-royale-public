# Map data

## OpenStreetMap (streets, buildings, land cover, points of interest)

The street, building, land-cover and point-of-interest data in
`public/data/bentonville-osm.json` is © OpenStreetMap contributors and is
made available under the Open Database License (ODbL) 1.0:
https://www.openstreetmap.org/copyright

- Source: OpenStreetMap API v0.6 map call (https://api.openstreetmap.org/api/0.6/map), downloaded as tiles
- Downloaded: 2026-11-15T06:00:40.536Z
- Bounding box (south, west, north, east): 36.346, -94.31, 36.4, -94.19
- Processed by `scripts/fetch-map-data.mjs` (projection to local meters, simplification, inferred heights/materials/roof shapes)

## Overture Maps Foundation (building heights)

Building heights (`h` where `hs` is "overture") come from the Overture Maps
buildings theme, release 2026-10-21.0, which is licensed under the
ODbL 1.0 (https://docs.overturemaps.org/attribution/). Most of these heights are
Overture's conflation of Microsoft Global ML Building Footprints (ODbL) onto the
OpenStreetMap footprints.
© OpenStreetMap contributors, Overture Maps Foundation, Microsoft.

- Source: s3://overturemaps-us-west-2/release/2026-10-21.0/theme=buildings (public GeoParquet), queried by `scripts/fetch-overture.py`
- Queried: 2026-11-15T06:04:23Z

## USGS 3D Elevation Program (terrain)

`public/data/bentonville-terrain.bin` / `.json` are resampled from the USGS 3DEP
best-available DEM (1 m lidar, AR Benton County 2015 project). USGS data is in
the public domain. Courtesy of the U.S. Geological Survey.

- Source: https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer (exportImage), via `scripts/fetch-terrain.mjs`
- Fetched: 2026-11-14T21:11:58.456Z

## USDA NAIP imagery via USGS The National Map (tree canopy, ground tint)

`public/data/bentonville-trees.json` (tree positions) and
`public/data/bentonville-ground.webp` (posterized ground colours) are derived
from National Agriculture Imagery Program (NAIP) aerial imagery, a USDA Farm
Service Agency product served by USGS The National Map. Public domain.
Imagery courtesy of USDA FSA and the U.S. Geological Survey.

- Source: https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPImagery/ImageServer (exportImage), via `scripts/fetch-imagery.mjs`
- Fetched: 2026-11-14T21:24:08.738Z

<!-- compose-map:start (written by scripts/compose-map.mjs) -->
## Map composition (positions are not geographic)

`public/data/bentonville-osm.json` is a compact, designed layout cut from the full
OpenStreetMap extract (`data-raw/bentonville-osm-full.json`) by `scripts/compose-map.mjs`.
Each POI below is a real-map cut-out moved into a 3 x 3 grid of tiles; no position on the
game map matches the real world. The 20 m streets between the tiles and around the
outside are invented, and everything else is left out.

- compton_gardens: source rectangle -69, -548.5, 261, -203.5 moved by (-406, 68.5) m
- crystal_bridges: source rectangle 344, -1245.5, 594, -900.5 moved by (-469, 765.5) m
- memorial_park: source rectangle 1329, -557.5, 1579, -212.5 moved by (-1184, 77.5) m
- market_8th: source rectangle 695, 730, 1025, 960 moved by (-1170, -845) m
- square: source rectangle -75, -105, 175, 125 moved by (-50, -10) m
- momentary: source rectangle 445, 575, 695, 805 moved by (-300, -690) m
- bentonville_west: source rectangle -8144, -672, -7814, -347 moved by (7669, 807) m
- bentonville_high: source rectangle 1098, 2235.5, 1348, 2560.5 moved by (-1223, -2100.5) m
- community_center: source rectangle -1624, 4488.5, -1374, 4813.5 moved by (1769, -4353.5) m
- Map bounds -499..419 x -504..484
<!-- compose-map:end -->
