// BENTONVILLE ROYALE — landmark interiors + building classification (pure JS, no three.js).
//
// LANDMARK_RECIPES: building id -> recipe (f) => tree | { levels: [tree0, ...], stairs? }
// (same contract as archetypes.js RECIPES, plus the Phase 2 multi-level form). Each recipe is a
// recognisable APPROXIMATION of the real place: no real floor plans exist as data, so room
// arrangement comes from public descriptions (sources are listed per recipe) and is anchored on
// the real business POIs inside the footprint (f.pois). Cut positions are absolute local metres
// in the frame the planner derives for the current map (main exterior door on the low side);
// if a footprint no longer matches what a recipe was drawn for, it falls back to its generic
// archetype instead of producing a broken plan.
//
// classify(bd, pois) -> recipe name: 'landmark' (LANDMARK_RECIPES has the id), a landmark's
// fallback, the per-id table for the ordinary buildings, then rules on `t`, in-footprint
// POI kinds, area and storeys.
//
// Room kinds used here beyond the Phase 1 list: gallery auditorium classroom gym cafeteria
// library courtroom stall bar cafe studio brewhouse.

import { leaf, cut } from './layout.js';
import { RECIPES } from './archetypes.js';

// ------------------------------------------------------------------ helpers

const R = leaf;

/** Nested cuts along `axis` at absolute local coordinates: nodes[i] lies between at[i - 1] and at[i]. */
function rowAt(axis, at, nodes) {
  if (nodes.length !== at.length + 1) throw new Error('rowAt: nodes must be one more than cuts');
  let node = nodes[nodes.length - 1];
  for (let i = at.length - 1; i >= 0; i--) node = cut(axis, { abs: at[i] }, nodes[i], node);
  return node;
}

/** n - 1 evenly spaced cut positions splitting [a0, a1] into n parts. */
function evenAt(a0, a1, n) {
  const at = [];
  for (let i = 1; i < n; i++) at.push(a0 + ((a1 - a0) * i) / n);
  return at;
}

/** n rooms of `kind` evenly along `axis` over [a0, a1], labelled pre + (from + i). */
function roomsAt(axis, a0, a1, n, kind, pre, from) {
  const nodes = [];
  for (let i = 0; i < n; i++) nodes.push(R(kind, pre + (from + i)));
  return rowAt(axis, evenAt(a0, a1, n), nodes);
}

/** A stall placeholder: labelled later from the nearest unclaimed matching POI. */
const stall = (fallback) => ({ leaf: true, kind: 'stall', label: fallback, poi: true });

/**
 * Give every `poi: true` leaf the name of its nearest matching POI (greedy by distance from the
 * POI to the leaf's nominal rect, ties broken by leaf then POI index). Leaves without a POI keep
 * their fallback label. Works on the nominal cut positions (the planner may nudge cuts a little).
 */
function nameFromPois(tree, f, re) {
  const leaves = [];
  const walk = (node, a0, b0, a1, b1) => {
    if (!node) return;
    if (node.leaf) {
      if (node.poi) leaves.push({ node, a0, b0, a1, b1 });
      return;
    }
    const isA = node.axis === 'a';
    const lo = isA ? a0 : b0;
    const hi = isA ? a1 : b1;
    const at = node.at;
    let c = (lo + hi) / 2;
    if (typeof at === 'number') c = at >= 0 ? lo + at : hi + at;
    else if (typeof at === 'string' && at.endsWith('%')) c = lo + ((hi - lo) * parseFloat(at)) / 100;
    else if (at && typeof at.abs === 'number') c = at.abs;
    if (c < lo) c = lo;
    if (c > hi) c = hi;
    if (isA) {
      walk(node.A, a0, b0, c, b1);
      walk(node.B, c, b0, a1, b1);
    } else {
      walk(node.A, a0, b0, a1, c);
      walk(node.B, a0, c, a1, b1);
    }
  };
  walk(tree, 0, 0, f.L, f.W);
  const pois = (f.pois || []).filter((p) => p.n && re.test(p.k || ''));
  const pairs = [];
  for (let i = 0; i < leaves.length; i++) {
    const r = leaves[i];
    for (let j = 0; j < pois.length; j++) {
      const p = pois[j];
      const da = p.a < r.a0 ? r.a0 - p.a : p.a > r.a1 ? p.a - r.a1 : 0;
      const db = p.b < r.b0 ? r.b0 - p.b : p.b > r.b1 ? p.b - r.b1 : 0;
      const ca = p.a - (r.a0 + r.a1) / 2;
      const cb = p.b - (r.b0 + r.b1) / 2;
      pairs.push([(da * da + db * db) * 1000 + ca * ca + cb * cb, i, j]);
    }
  }
  pairs.sort((x, y) => x[0] - y[0] || x[1] - y[1] || x[2] - y[2]);
  const usedL = new Uint8Array(leaves.length);
  const usedP = new Uint8Array(pois.length);
  for (const [, i, j] of pairs) {
    if (usedL[i] || usedP[j]) continue;
    usedL[i] = 1;
    usedP[j] = 1;
    leaves[i].node.label = pois[j].n;
  }
  for (const r of leaves) delete r.node.poi;
  return tree;
}

/**
 * Wrap a landmark recipe: check the footprint still matches what it was drawn for (frame size
 * within `tol` m and the main door on the expected side), else use the generic fallback. The
 * recipe returns a tree or { levels, stairs }. Until the multi-level planner (Phase 2A) sets
 * f.levels, the planner only takes a single tree, so levels[0] is returned on its own.
 */
function landmark(id, L, W, front, build, tol = 2) {
  return (f) => {
    if (Math.abs(f.L - L) > tol || Math.abs(f.W - W) > tol || f.front !== front) {
      const fb = LANDMARK_IDS[id] ? LANDMARK_IDS[id].fallback : 'hall';
      return (RECIPES[fb] || RECIPES.hall)(f);
    }
    const out = build(f);
    if (!out || out.leaf || out.axis) return out;
    if (f.levels === undefined) return out.levels[0];
    const n = f.levels > 1 ? f.levels | 0 : 1;
    const res = { levels: out.levels.slice(0, n) };
    if (n > 1 && out.stairs) res.stairs = out.stairs;
    return res;
  };
}

// ------------------------------------------------------------------ the 16 landmarks

export const LANDMARK_RECIPES = {};
const def = (id, L, W, front, build, tol) => {
  LANDMARK_RECIPES[id] = landmark(id, L, W, front, build, tol);
};

// Crystal Bridges Museum of American Art (8240824; 332 x 118 m, main door on the north-west
// lobby side). Moshe Safdie's pavilions around the spring-fed ponds: galleries in a row on both
// sides of a gallery walk, main lobby by the entrance with the museum store and coffee bar, Eleven
// in the bridge pavilion by the lobby, the glass-walled Great Hall, library.
// Sources: crystalbridges.org/faq, crystalbridges.org/venue-rentals/venue-info-maps,
// en.wikipedia.org/wiki/Crystal_Bridges_Museum_of_American_Art, arkansas.com (Crystal Bridges).
def(8240824, 332.2, 118.1, 'b', () => {
  const ground = cut(
    'a',
    { abs: 222.5 },
    rowAt('b', [52, 60], [
      rowAt('a', [58, 100, 140, 172, 206], [
        R('library', 'Library'),
        R('gallery', 'Early 20th Century Art'),
        R('gallery', '19th Century Art'),
        R('gallery', 'Early American Art'),
        R('lobby', 'Main Lobby'),
        R('sales', 'Museum Store'),
      ]),
      R('corridor', 'Gallery Walk'),
      rowAt('a', [55, 105, 150, 196], [
        R('gallery', 'Modern Art'),
        R('gallery', 'Contemporary Art'),
        R('gallery', 'Temporary Exhibitions'),
        cut('b', { abs: 85 }, cut('a', '50%', R('classroom', 'Studio Classroom'), R('office', 'Guest Services')), cut('a', '50%', R('office', 'Meeting Room'), R('restroom', 'Restrooms'))),
        cut('b', { abs: 84 }, R('cafe', 'Coffee Bar'), R('dining', 'Eleven')),
      ]),
    ]),
    cut('a', { abs: 276 }, R('hall', 'Great Hall'), R('gallery', 'Bridge Gallery'))
  );
  const upper = (k) =>
    cut(
      'a',
      { abs: 222.5 },
      rowAt('b', [52, 60], [
        rowAt('a', [58, 120, 172], [
          R('library', k === 1 ? 'Library Reading Room' : 'Archives'),
          R('office', k === 1 ? 'Curatorial Offices' : 'Administration'),
          R('storage', 'Collection Storage'),
          R('open', 'Lobby Balcony'),
        ]),
        R('corridor', 'Upper Walkway'),
        rowAt('a', [55, 105, 150, 196], [
          R('studio', k === 1 ? 'Conservation Lab' : 'Photo Studio'),
          R('storage', k === 1 ? 'Art Handling' : 'Crate Storage'),
          R('office', k === 1 ? 'Education Offices' : 'Event Offices'),
          R('classroom', k === 1 ? 'Seminar Room' : 'Board Room'),
          R('break', k === 1 ? 'Staff Lounge' : 'Staff Kitchen'),
        ]),
      ]),
      cut('a', { abs: 276 }, R('open', 'Great Hall Balcony'), R('gallery', 'Bridge Gallery Upper'))
    );
  return { levels: [ground, upper(1), upper(2)], stairs: [{ a: 190, b: 30, dir: 'a' }, { a: 60, b: 56, dir: 'a' }] };
});

// The Momentary (896842916; 108 x 93 m, main door on the west side). Contemporary art space in
// the former Kraft cheese plant: white-box galleries, Fermentation Hall (black box in the old
// fermentation room), RØDE House (350-seat space in the old milk intake room), the Tower with
// Tower Bar, Onyx Coffee Lab, The Breakroom (former employee lunch room).
// Sources: themomentary.org/former-cheese-factory-becomes-an-innovative-new-contemporary-art-space,
// talkbusiness.net/2020/02/momentary-ready-to-take-its-place-in-regional-art-scene,
// archpaper.com/2020/01/the-momentary-contemporary-art-space-arkansas-former-kraft-cheese-factory.
def(896842916, 108, 93.4, 'a', () =>
  cut(
    'a',
    { abs: 21 },
    cut('b', { abs: 60 }, R('lobby', 'Lobby'), R('lobby', 'Box Office')),
    cut(
      'b',
      { abs: 56 },
      cut(
        'b',
        { abs: 40.2 },
        cut(
          'b',
          { abs: 21.2 },
          cut('a', { abs: 80 }, R('gallery', 'Gallery 4'), R('storage', 'Loading Dock')),
          cut('a', { abs: 58 }, R('gallery', 'Gallery 2'), R('gallery', 'Gallery 3'))
        ),
        R('corridor', 'Gallery Corridor')
      ),
      rowAt('a', [44, 72, 88], [
        R('auditorium', 'Fermentation Hall'),
        cut('b', { abs: 75 }, R('gallery', 'Gallery 1'), R('dining', 'The Breakroom')),
        cut('b', { abs: 72 }, R('bar', 'Tower Bar'), R('cafe', 'Onyx Coffee Lab')),
        R('auditorium', 'RØDE House'),
      ])
    )
  )
);

// 8th Street Market (896842909; 139 x 63 m, main door on the 8th Street (south) side). Former
// Tyson plant turned food/retail market: shops along the street front, a central market hall,
// Brightwater (NWACC culinary school) kitchens in the north wing, HomeGrown at the east end.
// Shop names come from the map POIs (Hillfolk, Two Friends Books, Markham & Fitz, Yeyo's,
// Co-Op Ramen). Sources: downtownbentonville.org/explore/8th-street-market,
// destinationrogers.com/listings/8th-street-market/560, talkbusiness.net/?p=67583.
def(896842909, 138.8, 63.3, 'b', () =>
  cut(
    'a',
    { abs: 78.1 },
    rowAt('b', [11, 36], [
      rowAt('a', [12, 19, 25, 35, 50, 66], [
        R('sales', 'Hillfolk'),
        R('sales', 'Two Friends Books'),
        R('lobby', 'South Entrance'),
        R('sales', 'Markham & Fitz'),
        R('stall', "Yeyo's El Alma de Mexico"),
        R('stall', 'Co-Op Ramen'),
        R('restroom', 'Restrooms'),
      ]),
      R('hall', 'Market Hall'),
      rowAt('a', [25, 39, 52.7, 64.4], [
        R('kitchen', 'Brightwater Kitchen 1'),
        R('kitchen', 'Brightwater Kitchen 2'),
        R('classroom', 'Brightwater Classroom'),
        R('lobby', 'Brightwater Entrance'),
        R('storage', 'Brightwater Pantry'),
      ]),
    ]),
    cut('a', { abs: 120 }, cut('b', { abs: 20 }, R('hall', 'Event Hall'), R('storage', 'Loading Dock')), R('dining', 'HomeGrown'))
  )
);

// 8th & Plate (949466253; 101 x 100 m, 2 storeys). Walmart Home Office associate food hall:
// twelve eateries (one labelled stall per map POI), central seating, a mezzanine above; the
// main kitchen is below ground in reality. Sources:
// corporate.walmart.com/about/newhomeoffice/explore-the-new-campus/food-hall,
// mbl-arch.com/commercial/8th-plate-food-hall.
def(949466253, 100.8, 99.8, 'a', (f) => {
  const ground = cut(
    'a',
    { abs: 28 },
    cut(
      'a',
      { abs: 8 },
      rowAt('b', [50, 62, 78], [stall('Stall 1'), R('lobby', 'West Entrance'), stall('Stall 2'), R('restroom', 'Restrooms')]),
      cut(
        'b',
        { abs: 24 },
        cut('a', { abs: 20 }, stall('Stall 3'), R('restroom', 'Restrooms 2')),
        cut('b', { abs: 62 }, cut('a', { abs: 22 }, R('dining', 'West Seating'), rowAt('b', [43], [stall('Stall 4'), stall('Stall 5')])), R('dining', 'North Seating'))
      )
    ),
    cut(
      'b',
      { abs: 34.8 },
      rowAt('b', [13, 28], [
        rowAt('a', [34, 41.5, 56, 72], [stall('Stall 6'), R('lobby', 'South Entrance'), stall('Stall 7'), stall('Stall 8'), R('kitchen', 'Service Kitchen')]),
        R('dining', 'East Seating'),
        rowAt('a', [38, 48, 58, 76, 90], [stall('Stall 9'), stall('Stall 10'), stall('Stall 11'), R('storage', 'Tray Return'), stall('Stall 12'), R('restroom', 'Restrooms 3')]),
      ]),
      cut('b', { abs: 53 }, R('dining', 'Central Seating'), R('storage', 'Mezzanine Stair'))
    )
  );
  nameFromPois(ground, f, /amenity=(fast_food|restaurant|cafe)/);
  const upper = cut(
    'a',
    { abs: 28 },
    cut('b', { abs: 62 }, R('dining', 'Mezzanine Seating'), R('dining', 'Private Dining')),
    cut('b', { abs: 34.8 }, cut('a', { abs: 60 }, R('hall', 'Event Room'), R('office', 'Food Service Offices')), R('open', 'Mezzanine Overlook'))
  );
  return { levels: [ground, upper], stairs: [{ a: 32, b: 44, dir: 'a' }] };
});

// Walmart Museum (211198877; 28 x 26 m, main door on the square). Three parts: Walton's 5&10
// storefront (working retro store), the exhibit gallery, the Spark Café soda fountain; plus a
// recreation of Sam Walton's office. Sources: corporate.walmart.com/about/walmart-museum/plan-your-visit.html,
// downtownbentonville.org/explore/the-walton-5-10, theclio.com/entry/151,
// visitbentonville.com/blog/stories/post/the-new-walmart-museum-experience.
def(211198877, 28.3, 25.9, 'b', () =>
  cut(
    'b',
    { abs: 9 },
    R('sales', "Walton's 5&10"),
    cut('a', { abs: 19 }, R('gallery', 'Exhibit Gallery'), cut('b', { abs: 19 }, R('cafe', 'Spark Café'), R('office', "Sam Walton's Office")))
  )
);

// Sam Walton Hall (949466246; 126 x 84 m, 4 storeys). Meetings-and-events hub of the new Home
// Office: reception at the main entry, a tall skylit central hall beside the two-storey,
// 1,500-seat auditorium, meeting rooms and a boardroom; the map's Walmart Radio studio POI sits
// in the north-west corner. Upper floors are team workspace (cubicles: a guess).
// Sources: corporate.walmart.com/about/newhomeoffice/explore-the-new-campus/sam-walton-hall,
// mbl-arch.com/commercial/samwaltonhall, architecturalrecord.com/articles/17318-walmart-debuts-new-home-office-campus-in-northwest-arkansas.
def(949466246, 126.1, 84.1, 'b', () => {
  const ground = rowAt('b', [29, 38], [
    rowAt('a', [21, 36, 56, 76, 96], [
      cut('b', { abs: 14 }, R('storage', 'Coat Room'), R('restroom', 'Restrooms')),
      R('lobby', 'West Lobby'),
      cut('b', { abs: 14 }, R('office', 'Boardroom'), R('office', 'Meeting Room 1')),
      cut('b', { abs: 14 }, R('office', 'Meeting Room 2'), R('office', 'Meeting Room 3')),
      cut('b', { abs: 14 }, R('office', 'Meeting Room 4'), R('office', 'Meeting Room 5')),
      R('lobby', 'Reception'),
    ]),
    R('hall', 'Central Hall'),
    cut(
      'a',
      { abs: 22 },
      cut('b', { abs: 62 }, R('break', 'Green Room'), R('studio', 'Walmart Radio')),
      cut('a', { abs: 84 }, R('auditorium', 'Auditorium'), cut('b', { abs: 52 }, R('storage', 'Backstage'), R('break', 'Associate Lounge')))
    ),
  ]);
  const work = (k) =>
    rowAt('b', [29, 38], [
      rowAt('a', [36, 66, 96], [R('office', 'Team Room ' + k + 'A'), R('office', 'Cubicles ' + k + 'A'), R('office', 'Cubicles ' + k + 'B'), R('office', 'Team Room ' + k + 'B')]),
      R('corridor', 'Hall ' + k),
      cut('a', { abs: 22 }, R('break', 'Break Room ' + k), cut('a', { abs: 84 }, k === 1 ? R('auditorium', 'Auditorium Balcony') : R('office', 'Cubicles ' + k + 'C'), R('office', 'Cubicles ' + k + 'D'))),
    ]);
  return { levels: [ground, work(1), work(2), work(3)], stairs: [{ a: 100, b: 33.5, dir: 'a' }] };
});

// Bentonville High School, main building (952075842; 228 x 137 m). A long main corridor
// (lockers) from the main lobby; classrooms either side; library and cafeteria in the west
// block; the Tiger Arena gym; the Arend Arts Center (1,100+ seat auditorium, opened 2003) in
// the south-east block where the map's Arend Arts Center POI is.
// Sources: bentonvillek12.org/o/bhs/page/history, bentonvillek12.org/page/arend-arts-center,
// talkbusiness.net/2012/02/arend-arts-center-celebrates-10-years, en.wikipedia.org (Bentonville High School).
def(952075842, 228.2, 137.2, 'b', () => {
  return cut(
    'b',
    { abs: 39 },
    cut(
      'a',
      { abs: 92 },
      roomsAt('a', 5.8, 90.4, 6, 'classroom', 'Room ', 101),
      rowAt('a', [129, 155], [R('lobby', 'Main Lobby'), R('office', 'Main Office'), R('gym', 'Tiger Arena')])
    ),
    cut(
      'b',
      { abs: 45.5 },
      R('corridor', 'Main Corridor'),
      cut(
        'a',
        { abs: 91 },
        cut('b', { abs: 82 }, rowAt('a', [45, 78], [R('library', 'Library'), R('cafeteria', 'Cafeteria'), R('kitchen', 'Kitchen')]), rowAt('b', [96, 102], [roomsAt('a', 4, 90.6, 6, 'classroom', 'Room ', 201), R('corridor', 'West Corridor'), roomsAt('a', 4, 90.6, 6, 'classroom', 'Room ', 207)])),
        cut(
          'b',
          { abs: 93.3 },
          cut('a', { abs: 130 }, R('hall', 'Commons'), cut('b', { abs: 70 }, roomsAt('a', 130, 211.6, 8, 'classroom', 'Room ', 110), roomsAt('a', 130, 211.6, 4, 'classroom', 'Science Lab ', 1))),
          rowAt('a', [140, 200], [R('lobby', 'Arts Center Lobby'), R('auditorium', 'Arend Arts Center'), R('open', 'Stage')])
        )
      )
    )
  );
});

// Bentonville High School, second building (952075843; 112 x 103 m, 2 storeys). The plan note
// guessed a gym; research says the north building is the 2006 academic "North Building": a
// commons opening onto a central courtyard, a multi-storey media center, science labs, a
// 200-seat lecture hall on the main level and a main stair tower at the entry (no gym listed).
// Sources: schooldesigns.com/Projects/bentonville-high-school-north-building,
// bentonvillek12.org/o/bhs/page/history.
def(952075843, 111.8, 103, 'b', () => {
  const ground = cut(
    'a',
    { abs: 95 },
    cut(
      'b',
      { abs: 40 },
      cut('a', { abs: 30 }, R('auditorium', 'Lecture Hall'), cut('b', { abs: 22 }, roomsAt('a', 30, 95, 4, 'classroom', 'Room N', 101), roomsAt('a', 30, 95, 4, 'classroom', 'Science Lab ', 1))),
      cut('a', { abs: 50 }, cut('b', { abs: 80 }, R('hall', 'Commons'), R('cafeteria', 'Commons Dining')), cut('b', { abs: 65 }, R('library', 'Media Center'), R('open', 'Courtyard')))
    ),
    cut('b', { abs: 19 }, R('lobby', 'Stair Tower'), R('corridor', 'East Corridor'))
  );
  const upper = cut(
    'a',
    { abs: 95 },
    rowAt('b', [34, 41], [
      cut('b', { abs: 20 }, roomsAt('a', 8.3, 95, 5, 'classroom', 'Room N', 201), roomsAt('a', 8.3, 95, 5, 'classroom', 'Room N', 206)),
      R('corridor', 'Upper Corridor'),
      cut('a', { abs: 50 }, cut('a', { abs: 25 }, roomsAt('b', 41, 103, 3, 'classroom', 'Room N', 211), roomsAt('b', 41, 103, 3, 'classroom', 'Room N', 214)), cut('b', { abs: 65 }, R('library', 'Media Center Upper'), R('open', 'Courtyard Balcony'))),
    ]),
    cut('b', { abs: 19 }, R('lobby', 'Stair Tower Landing'), R('office', 'Department Offices'))
  );
  return { levels: [ground, upper], stairs: [{ a: 99, b: 8, dir: 'b' }, { a: 30, b: 58, dir: 'a' }] };
});

// Bentonville West High School (651787776; 309 x 200 m, 4 storeys in the map). Opened 2016 in
// Centerton: 900-seat performing arts center, a competition arena for 2,000+ (state-championship
// capable), media center, coffee bar, 100+ classrooms. Layout here: a long main corridor through
// the four pods of the south band, commons/cafeteria in the west pod, classroom pods, the arena
// in the east pod; the west wing holds the main entrance, media center and performing arts.
// "Main street" and the 4 classroom levels could not be confirmed from sources (the map's level
// count is an estimate). Sources: asumag.com/planning-design/new-construction/article/20853314/new-high-school-opens-in-centerton-ark,
// bentonvillek12.org/o/bwhs/page/our-story, en.wikipedia.org/wiki/Bentonville_West_High_School.
def(651787776, 308.9, 200, 'a', () => {
  const band = (k) => {
    const fl = String(k + 1);
    const c = (p, i) => R('classroom', 'Room ' + p + fl + String(i).padStart(2, '0'));
    const podRooms = (p, a0, a1, n, from) => {
      const nodes = [];
      for (let i = 0; i < n; i++) nodes.push(c(p, from + i));
      return rowAt('a', evenAt(a0, a1, n), nodes);
    };
    const north = rowAt('a', [97, 106.7, 155.7, 165.3, 214.3, 226.2], [
      k ? podRooms('A', 10, 97, 8, 1) : cut('a', { abs: 58 }, R('cafeteria', 'Cafeteria'), R('kitchen', 'Kitchen')),
      R('restroom', 'Restrooms ' + fl + 'A'),
      podRooms('B', 106.7, 155.7, 6, 1),
      R('restroom', 'Restrooms ' + fl + 'B'),
      podRooms('C', 165.3, 214.3, 6, 1),
      R('storage', 'Storage ' + fl),
      k === 0 ? R('lobby', 'Arena Lobby') : k === 1 ? R('open', 'Arena Concourse') : R('storage', 'Mechanical ' + fl + 'E'),
    ]);
    const south = rowAt('a', [97, 106.7, 155.7, 165.3, 214.3, 226.2], [
      k ? podRooms('A', 0.4, 97, 8, 9) : R('hall', 'Commons'),
      k ? R('break', 'Teacher Workroom ' + fl) : R('cafe', 'Coffee Bar'),
      podRooms('B', 106.7, 155.7, 6, 7),
      R('office', 'Pod Office ' + fl),
      podRooms('C', 165.3, 214.3, 6, 7),
      R('storage', 'Custodial ' + fl),
      k === 0 ? R('gym', 'Arena') : k === 1 ? R('open', 'Arena Upper Bowl') : R('storage', 'Arena Roof Space'),
    ]);
    const wing = cut(
      'b',
      { abs: 58 },
      cut('a', { abs: 42 }, k === 0 ? R('auditorium', 'Performing Arts Center') : k === 1 ? R('open', 'Performing Arts Balcony') : R('storage', 'Fly Loft'), rowAt('b', [20, 40], [k ? c('D', 1) : R('classroom', 'Band Room'), k ? c('D', 2) : R('classroom', 'Choir Room'), R('storage', k ? 'Storage D' + fl : 'Scene Shop')])),
      cut(
        'a',
        { abs: 30 },
        cut('b', { abs: 92 }, k ? R('office', 'Counseling ' + fl) : R('lobby', 'Main Entrance'), R('library', k ? 'Media Center Upper' : 'Media Center')),
        cut('a', { abs: 37 }, R('corridor', 'West Corridor' + (k ? ' ' + fl : '')), rowAt('b', [77, 96, 116], [c('W', 1), c('W', 2), c('W', 3), c('W', 4)]))
      )
    );
    return cut('b', { abs: 135.3 }, wing, rowAt('b', [154, 162], [north, R('corridor', k ? 'Corridor ' + fl : 'Main Corridor'), south]));
  };
  return { levels: [band(0), band(1), band(2), band(3)], stairs: [{ a: 33.5, b: 100, dir: 'b' }, { a: 120, b: 158, dir: 'a' }, { a: 180, b: 158, dir: 'a' }] };
});

// Benton County Courthouse (577226262; 55 x 48 m). The map footprint carries the courthouse POI;
// the real 1928 courthouse (plus addition) houses three circuit judges, the circuit and probate
// clerks and the prosecuting attorney, with the main entrance through the judicial tower.
// Sources: en.wikipedia.org/wiki/Benton_County_Courthouse_(Arkansas),
// encyclopediaofarkansas.net/entries/Benton-County-Courthouse-3312.
def(577226262, 55.2, 47.6, 'b', () =>
  cut(
    'a',
    { abs: 28.1 },
    cut('b', { abs: 13 }, R('corridor', 'West Hall'), cut('a', { abs: 18 }, R('courtroom', 'Courtroom 1'), cut('b', { abs: 26.5 }, R('office', "Judge's Chambers"), R('break', 'Jury Room')))),
    cut(
      'b',
      { abs: 12 },
      R('lobby', 'Judicial Tower Lobby'),
      cut('a', { abs: 40 }, rowAt('b', [24, 36], [R('office', 'Circuit Clerk'), R('office', 'Probate Clerk'), R('storage', 'Records Room')]), cut('b', { abs: 36 }, R('courtroom', 'Courtroom 2'), R('office', "Prosecuting Attorney")))
    )
  )
);

// Benton County Court House Annex (577262580; 24 x 20 m, 2 storeys). County offices beside the
// courthouse; the interior is not documented, so this is a plain office layout.
// Sources: map name only (no interior description found).
def(577262580, 24.1, 19.9, 'a', () => {
  const ground = cut('a', { abs: 7 }, R('lobby', 'Annex Lobby'), cut('a', { abs: 17.5 }, cut('b', '50%', R('office', 'County Clerk'), R('office', 'Assessor')), R('lobby', 'Rear Entrance')));
  const upper = cut('b', { abs: 8 }, cut('a', '50%', R('office', 'Office 201'), R('office', 'Office 202')), cut('a', { abs: 10 }, R('courtroom', 'Hearing Room'), R('storage', 'Records')));
  return { levels: [ground, upper], stairs: [{ a: 3, b: 4, dir: 'b' }] };
});

// Bike Rack Brewing Co. (896842915; 47 x 20 m). Taproom (16 taps) at 8th Street Market with the
// production brewhouse alongside and food trucks / patio outside.
// Sources: downtownbentonville.org/explore/bike-rack-brewing-co-2,
// fayettevilleflyer.com/2017/05/04/benton-county-breweries-on-the-move.
def(896842915, 47.5, 19.9, 'b', () =>
  cut('a', { abs: 30.3 }, cut('b', { abs: 14 }, R('bar', 'Taproom'), rowAt('a', [10, 20], [R('restroom', 'Restrooms'), R('storage', 'Cold Room'), R('storage', 'Barrel Room')])), R('brewhouse', 'Brewhouse'))
);

// Field Notes (1578366349; 36 x 15 m). All-day café on the downtown square (inside The Compton):
// coffee counter, seating, bar, kitchen; the two map POIs sit in the counter and seating rooms.
// Sources: joe.coffee/locations/ar/bentonville/field-notes-bentonville-0728e6f9-7cbf-4dc4-8fb0-94a2967d3ffd.
def(1578366349, 36, 15, 'b', () =>
  cut('a', { abs: 26 }, cut('b', { abs: 9 }, cut('a', { abs: 10 }, R('cafe', 'Coffee Counter'), R('dining', 'Café Seating')), cut('a', '50%', R('kitchen', 'Kitchen'), R('bar', 'Bar'))), R('lobby', 'Lobby'))
);

// Wright's Barbecue (912573722; 22 x 12 m). Texas-style barbecue on the Home Office campus:
// dining room with expansive seating, a dedicated takeout counter, kitchen and pit.
// Sources: talkbusiness.net/2024/04/walmarts-new-corporate-campus-in-bentonville-will-include-wrights-barbecue-restaurant,
// nwatravelguide.com/new-restaurants-bars-stores-in-bentonville.
def(912573722, 22, 12.5, 'a', () =>
  cut('a', { abs: 8.2 }, R('lobby', 'Takeout Counter'), cut('a', { abs: 16 }, R('dining', 'Dining Room'), cut('b', '50%', R('kitchen', 'Kitchen'), R('kitchen', 'Smoker Pit'))))
);

// Bentoville Food Theater (799259120; 27 x 21 m). One big open room with three chef "stages"
// (rotating menus, ticketed shows), sharing the former Pressroom space with Onyx Coffee Lab.
// Sources: axios.com/local/nw-arkansas/2026/03/05/bentonville-food-theater-to-spotlight-diverse-cuisine,
// axios.com/local/nw-arkansas/2026/09/21/bentoville-ramen-food-theater-monday-munchies.
def(799259120, 26.5, 21.2, 'b', () =>
  cut('b', { abs: 15 }, cut('a', { abs: 20 }, R('dining', 'Theater Floor'), cut('b', { abs: 7 }, R('kitchen', 'Kitchen'), R('restroom', 'Restrooms'))), rowAt('a', [8.8, 17.6], [R('stall', 'Stage 1'), R('stall', 'Stage 2'), R('stall', 'Stage 3')]))
);

// Onyx Coffee Lab + Block Street Records (799259121; 26 x 22 m). Onyx's downtown café (coffee
// bar) and the record shop next door, per the map POIs. Sources: downtownbentonville.org/explore/onyx-coffee-lab,
// onyxcoffeelab.com/pages/locations.
def(799259121, 26.3, 21.9, 'a', () =>
  cut('b', { abs: 8 }, cut('a', { abs: 13 }, R('sales', 'Block Street Records'), R('storage', 'Record Stock Room')), cut('a', { abs: 18.5 }, R('cafe', 'Onyx Coffee Lab'), cut('b', { abs: 15 }, R('lobby', 'Side Entrance'), R('bar', 'Coffee Bar'))))
);

// Ids of the landmark buildings and the generic recipe each falls back to.
export const LANDMARK_IDS = {
  8240824: { key: 'crystal_bridges', fallback: 'hall' },
  896842916: { key: 'momentary', fallback: 'hall' },
  896842909: { key: 'market_8th', fallback: 'hall' },
  949466253: { key: 'eighth_and_plate', fallback: 'hall' },
  211198877: { key: 'walmart_museum', fallback: 'retail_block' },
  949466246: { key: 'sam_walton_hall', fallback: 'office_block' },
  952075842: { key: 'bentonville_high', fallback: 'hall' },
  952075843: { key: 'bentonville_high_north', fallback: 'hall' },
  651787776: { key: 'west_high', fallback: 'hall' },
  577226262: { key: 'courthouse', fallback: 'hall' },
  577262580: { key: 'courthouse_annex', fallback: 'office_small' },
  896842915: { key: 'bike_rack_brewery', fallback: 'hall' },
  1578366349: { key: 'field_notes', fallback: 'shop' },
  912573722: { key: 'wrights_barbecue', fallback: 'shop' },
  799259120: { key: 'food_theater', fallback: 'shop' },
  799259121: { key: 'onyx_block_street_records', fallback: 'storefront_2' },
};

// The ordinary buildings of the current map (by OSM id).
const ID_RECIPES = {};
const put = (name, ids) => {
  for (const id of ids) ID_RECIPES[id] = name;
};
put('house', [
  912478099, 912573723, 912573724, 912841354, 912841355, 912841356, 912841359, 912841361, 912841362, 912841363, 912841365, 912960036, 912514432,
  912514433, 912514434, 912514435, 912514439,
]);
put('apartment', [912575608, 912575609, 912575610, 912575611]);
put('shop', [912573726, 912478086, 642707241, 912514438]);
put('storefront_2', [799257711, 799257712]);
put('retail_block', [912478085, 912478090]);
put('office_small', [912841357, 799496326, 912841351]);
put('office_block', [1427720556, 912841368]);
put('bank', [912573732]);
put('greenhouse', [896842910]);
put('garage', [912478100]);
put('pavilion', [912514431]);
put('shelter', [583054984]);

/** pois: the POIs inside this building's footprint ({ k, ... }). area: footprint m^2. */
export function classify(bd, pois, area = bd.a || 0) {
  const id = bd.id;
  if (LANDMARK_RECIPES[id]) return 'landmark';
  if (LANDMARK_IDS[id]) return LANDMARK_IDS[id].fallback;
  if (ID_RECIPES[id]) return ID_RECIPES[id];
  const t = bd.t || 'yes';
  const lv = bd.lv || 1;
  const ks = (pois || []).map((p) => p.k || '');
  const has = (re) => ks.some((k) => re.test(k));
  if (area > 2000 || t === 'school' || has(/amenity=(school|theatre|arts_centre)|tourism=museum/)) return 'hall';
  if (t === 'house' || t === 'detached' || t === 'residential') return 'house';
  if (t === 'apartments' || (t === 'yes' && lv >= 2 && area < 400 && !ks.length)) return 'apartment';
  if (t === 'greenhouse') return 'greenhouse';
  if (t === 'garage' || t === 'garages' || area < 70) return 'garage';
  if (t === 'roof' || has(/amenity=shelter/)) return 'shelter';
  if (t === 'hut' || t === 'pavilion') return 'pavilion';
  if (has(/amenity=bank/)) return 'bank';
  if (t === 'office' || has(/^office=/)) return lv >= 2 || area > 400 ? 'office_block' : 'office_small';
  if (area > 1000) return area > 1500 ? 'hall' : 'retail_block';
  if (lv >= 2 && area < 240) return 'storefront_2';
  return 'shop';
}
