#!/usr/bin/env python3
"""Fetch Overture Maps buildings (heights) for the Bentonville map bbox.

    python3 scripts/fetch-overture.py            # cache-first
    python3 scripts/fetch-overture.py --refresh  # query again

Reads the public Overture GeoParquet release on S3 (anonymous, us-west-2)
with pyarrow, pushing the bbox filter down to row-group statistics so only a
few MB are transferred. Writes data-raw/overture/buildings.json:

    { release, fetchedAt, bbox, count,
      buildings: [ { id, h, floors, minH, roof, roofH, facade, roofColor, src, osm, hsrc,
                     rings: [ [[lon,lat],...] , ...] } ] }  (outer rings only)

scripts/fetch-map-data.mjs consumes it to fill building heights. Overture
buildings data is licensed ODbL 1.0 (it is derived from OSM plus other
sources); see credits/map-data.md.

Needs only pyarrow (no DuckDB on this machine). Run it with `python3 -I`.
"""
import json
import os
import struct
import sys
import time

import pyarrow.compute as pc
import pyarrow.dataset as ds
import pyarrow.fs as fs

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
OUT_DIR = os.path.join(ROOT, 'data-raw', 'overture')
OUT = os.path.join(OUT_DIR, 'buildings.json')
BBOX = (36.346, -94.31, 36.40, -94.19)  # south, west, north, east (keep in sync with fetch-map-data.mjs)
BUCKET = 'overturemaps-us-west-2'


def parse_wkb(b):
    """Outer rings of a WKB Polygon / MultiPolygon as [[lon,lat],...]."""
    rings = []

    def geom(off):
        bo = '<' if b[off] == 1 else '>'
        t = struct.unpack_from(bo + 'I', b, off + 1)[0] % 1000
        off += 5
        if t == 3:
            n = struct.unpack_from(bo + 'I', b, off)[0]
            off += 4
            for r in range(n):
                m = struct.unpack_from(bo + 'I', b, off)[0]
                off += 4
                pts = struct.unpack_from(bo + 'd' * (2 * m), b, off)
                off += 16 * m
                if r == 0:
                    rings.append([[round(pts[i], 7), round(pts[i + 1], 7)] for i in range(0, 2 * m, 2)])
            return off
        if t == 6:
            n = struct.unpack_from(bo + 'I', b, off)[0]
            off += 4
            for _ in range(n):
                off = geom(off)
            return off
        raise ValueError('unsupported WKB type %d' % t)

    geom(0)
    return rings


def main():
    if os.path.exists(OUT) and '--refresh' not in sys.argv:
        print('Using cached', os.path.relpath(OUT, ROOT))
        return
    s3 = fs.S3FileSystem(anonymous=True, region='us-west-2', connect_timeout=30, request_timeout=120,
                         retry_strategy=fs.AwsStandardS3RetryStrategy(max_attempts=10))
    rels = sorted(i.path.split('/')[-1] for i in s3.get_file_info(fs.FileSelector(BUCKET + '/release/')))
    release = rels[-1]
    path = '%s/release/%s/theme=buildings/type=building/' % (BUCKET, release)
    print('Overture release', release)
    t0 = time.time()
    dset = ds.dataset(path, filesystem=s3, format='parquet')
    s, w, n, e = BBOX
    bb = lambda k: pc.field(('bbox', k))  # noqa: E731
    flt = (bb('xmin') < e) & (bb('xmax') > w) & (bb('ymin') < n) & (bb('ymax') > s)
    want = ['id', 'geometry', 'height', 'num_floors', 'min_height', 'roof_shape', 'roof_height', 'facade_color', 'roof_color', 'sources']
    cols = [c for c in want if c in dset.schema.names]
    tbl = dset.to_table(columns=cols, filter=flt)
    print('rows', tbl.num_rows, 'in %.0fs' % (time.time() - t0))
    out = []
    for r in tbl.to_pylist():
        try:
            rings = parse_wkb(r['geometry'])
        except Exception as ex:  # noqa: BLE001
            print('skip', r['id'], ex)
            continue
        sources = [x for x in (r.get('sources') or []) if x]
        srcs = sorted({x.get('dataset') for x in sources} - {None})
        o = {'id': r['id'], 'rings': rings, 'src': srcs}
        for x in sources:
            if x.get('dataset') == 'OpenStreetMap' and x.get('record_id') and not x.get('property'):
                o['osm'] = x['record_id']  # e.g. "w123456789@4" or "r123@2"
            if (x.get('property') or '').endswith(('/height', '/num_floors')):
                o['hsrc'] = x.get('dataset')
        for k_in, k_out in (('height', 'h'), ('num_floors', 'floors'), ('min_height', 'minH'), ('roof_shape', 'roof'),
                            ('roof_height', 'roofH'), ('facade_color', 'facade'), ('roof_color', 'roofColor')):
            v = r.get(k_in)
            if v is not None:
                o[k_out] = round(v, 2) if isinstance(v, float) else v
        out.append(o)
    out.sort(key=lambda o: o['id'])
    os.makedirs(OUT_DIR, exist_ok=True)
    meta = {'release': release, 'source': 's3://' + path, 'fetchedAt': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
            'bbox': BBOX, 'count': len(out), 'buildings': out}
    with open(OUT + '.tmp', 'w') as f:
        json.dump(meta, f, separators=(',', ':'))
    os.replace(OUT + '.tmp', OUT)
    hs = sum(1 for o in out if 'h' in o)
    fl = sum(1 for o in out if 'floors' in o)
    print('wrote %s: %d buildings, %d with height, %d with num_floors' % (os.path.relpath(OUT, ROOT), len(out), hs, fl))


if __name__ == '__main__':
    main()
