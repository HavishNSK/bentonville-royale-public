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
## Map composition (positions outside downtown are not geographic)

`public/data/bentonville-osm.json` is a compact, designed layout cut from the full
OpenStreetMap extract (`data-raw/bentonville-osm-full.json`) by `scripts/compose-map.mjs`.
Only the downtown core (game metres x -250..1723, z -1400..1450) is at its real position.
The school campuses below are real-map cut-outs moved next to it; the countryside and
connector roads in the gaps between them are invented, and everything else is left out.

- bentonville_west: source rectangle -8410, -1080, -7700, -240 moved by (7050, 646) m
- bentonville_high: source rectangle 880, 2060, 1560, 2730 moved by (23, -210) m
- Gap between each island and downtown: 400 m; map bounds -1480..1843 x -1520..2640
<!-- compose-map:end -->
