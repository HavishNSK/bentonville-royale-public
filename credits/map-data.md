# Map data

## OpenStreetMap (streets, buildings, land cover, points of interest)

The street, building, land-cover and point-of-interest data in
`public/data/bentonville-osm.json` is © OpenStreetMap contributors and is
made available under the Open Database License (ODbL) 1.0:
https://www.openstreetmap.org/copyright

- Source: OpenStreetMap API v0.6 map call (https://api.openstreetmap.org/api/0.6/map), downloaded as tiles
- Downloaded: 2026-11-14T19:44:30.306Z
- Bounding box (south, west, north, east): 36.355, -94.23, 36.4, -94.19
- Processed by `scripts/fetch-map-data.mjs` (projection to local meters, simplification, inferred heights/materials/roof shapes)

## Overture Maps Foundation (building heights)

Building heights (`h` where `hs` is "overture") come from the Overture Maps
buildings theme, release 2026-10-21.0, which is licensed under the
ODbL 1.0 (https://docs.overturemaps.org/attribution/). Most of these heights are
Overture's conflation of Microsoft Global ML Building Footprints (ODbL) onto the
OpenStreetMap footprints.
© OpenStreetMap contributors, Overture Maps Foundation, Microsoft.

- Source: s3://overturemaps-us-west-2/release/2026-10-21.0/theme=buildings (public GeoParquet), queried by `scripts/fetch-overture.py`
- Queried: 2026-11-14T21:12:02Z

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
