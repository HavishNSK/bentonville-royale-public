// BENTONVILLE ROYALE — landmark interiors + building classification (pure JS, no three.js).
//
// LANDMARK_RECIPES: building id -> recipe (f) => tree (same contract as archetypes.js RECIPES).
// Phase 1 ships it empty; Phase 2C fills in the 16 hand-authored landmark layouts. Until a
// landmark has a recipe here it falls back to the generic recipe in LANDMARK_IDS.
//
// classify(bd, pois) -> recipe name: 'landmark' (LANDMARK_RECIPES has the id), a landmark's
// fallback, the per-id table for the ordinary buildings, then rules on `t`, in-footprint
// POI kinds, area and storeys.

export const LANDMARK_RECIPES = {};

// TODO(Phase 2C): hand-authored recipe for each of these (approximations anchored on real POIs).
export const LANDMARK_IDS = {
  8240824: { key: 'crystal_bridges', fallback: 'hall' }, // galleries in a row, Great Hall, Eleven, store
  896842916: { key: 'momentary', fallback: 'hall' }, // white-box galleries, Tower Bar, Fermentation Hall
  896842909: { key: 'market_8th', fallback: 'hall' }, // market hall + named stalls, Brightwater kitchens
  949466253: { key: 'eighth_and_plate', fallback: 'hall' }, // 12 stall counters, central seating, mezzanine
  211198877: { key: 'walmart_museum', fallback: 'retail_block' }, // 5&10 storefront, gallery, Sam's office, cafe
  949466246: { key: 'sam_walton_hall', fallback: 'office_block' }, // reception, auditorium, cubicles, boardroom
  952075842: { key: 'bentonville_high', fallback: 'hall' }, // corridor + lockers, classrooms, cafeteria, library
  952075843: { key: 'bentonville_high_2', fallback: 'hall' }, // gym with bleachers (guess)
  651787776: { key: 'west_high', fallback: 'hall' }, // main street, arena, commons, classroom wing
  577226262: { key: 'courthouse', fallback: 'hall' }, // courtroom, clerk counter
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
