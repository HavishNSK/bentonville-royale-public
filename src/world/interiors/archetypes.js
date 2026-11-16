// BENTONVILLE ROYALE — interior recipes per building archetype (pure JS, no three.js).
//
// A recipe is (f) => tree (see layout.js for the tree format). f = {
//   L, W        frame size (m): a = long axis [0, L], b = across [0, W]
//   area, lv    footprint area (m^2), storeys
//   front       'a' | 'b': the main exterior door sits on the low side of this axis
//   side        the other axis
//   door        { a, b } main door (local, on the inner face)
//   id, bd      building id / map record
//   pois        in-footprint POIs [{ n, k, x, z, a, b }]
// }
// Recipes are simple, plausible layouts; landmarks get hand-authored recipes in landmarks.js.

import { leaf, cut, row } from './layout.js';

/** n equal units of `kind` along `axis`, labelled `${label} ${i + 1}`. */
function units(axis, n, kind, label) {
  const parts = [];
  for (let i = 0; i < n; i++) parts.push([1, leaf(kind, n > 1 ? label + ' ' + (i + 1) : label)]);
  return row(axis, parts);
}

/** A 2.2 m corridor along a (centred on the main door's b when the door is on a short end), units on both sides. */
function corridorPlan(f, kind, label, unitLen, front) {
  const cw = 2.2;
  let cb = f.front === 'a' ? f.door.b : f.W / 2;
  if (cb < cw / 2 + 2.5) cb = cw / 2 + 2.5;
  if (cb > f.W - cw / 2 - 2.5) cb = f.W - cw / 2 - 2.5;
  const n = Math.max(1, Math.round(f.L / unitLen));
  const side = (s) => {
    const body = units('a', n, kind, label + ' ' + s);
    return front ? cut('a', front.len, leaf(front.kind, front.label), body) : body;
  };
  if (f.W < cw + 5.5) return cut('b', '50%', units('a', n, kind, label), leaf('corridor', 'Corridor'));
  return cut('b', { abs: cb - cw / 2 }, side('A'), cut('b', cw, leaf('corridor', 'Corridor'), side('B')));
}

export const RECIPES = {
  house(f) {
    const F = f.front;
    const S = f.side;
    if (f.area < 140) {
      return cut(F, '55%', leaf('living', 'Living room'), cut(S, '50%', leaf('bedroom', 'Bedroom'), cut(F, '50%', leaf('kitchen', 'Kitchen'), leaf('bath', 'Bathroom'))));
    }
    if (f.area < 280) {
      return cut(F, '50%', cut(S, '60%', leaf('living', 'Living room'), leaf('kitchen', 'Kitchen')), cut(S, '40%', leaf('bedroom', 'Bedroom'), cut(S, '40%', leaf('bath', 'Bathroom'), leaf('bedroom', 'Bedroom 2'))));
    }
    return cut(
      F,
      '45%',
      cut(S, '55%', leaf('living', 'Living room'), cut(F, '50%', leaf('dining', 'Dining room'), leaf('kitchen', 'Kitchen'))),
      row(S, [
        [1, leaf('bedroom', 'Bedroom')],
        [0.6, leaf('bath', 'Bathroom')],
        [1, leaf('bedroom', 'Bedroom 2')],
        [0.9, leaf('bedroom', 'Bedroom 3')],
      ])
    );
  },
  apartment(f) {
    return corridorPlan(f, 'apartment', 'Unit', 7);
  },
  shop(f) {
    const back = f.area > 250 ? cut(f.side, '50%', leaf('storage', 'Stock room'), leaf('office', 'Office')) : leaf('storage', 'Stock room');
    return cut(f.front, '70%', leaf('sales', 'Sales floor'), back);
  },
  storefront_2(f) {
    const shop = (n) => cut(f.front, '72%', leaf('sales', 'Shop ' + n), leaf('storage', 'Back room ' + n));
    return cut(f.side, '50%', shop('A'), shop('B'));
  },
  retail_block(f) {
    const n = Math.max(2, Math.min(5, Math.round((f.side === 'a' ? f.L : f.W) / 9)));
    const back = [];
    const names = [
      ['storage', 'Stock room'],
      ['office', 'Office'],
      ['restroom', 'Restrooms'],
      ['break', 'Break room'],
      ['storage', 'Receiving'],
    ];
    for (let i = 0; i < n; i++) back.push([1, leaf(names[i][0], names[i][1])]);
    return cut(f.front, '76%', leaf('sales', 'Sales floor'), row(f.side, back));
  },
  office_small(f) {
    if (f.area < 120) return cut(f.front, '50%', leaf('lobby', 'Reception'), leaf('office', 'Office'));
    return cut(f.front, '45%', leaf('lobby', 'Reception'), row(f.side, [[1, leaf('office', 'Office 1')], [1, leaf('office', 'Office 2')]]));
  },
  office_block(f) {
    return corridorPlan(f, 'office', 'Office', 5.5, f.L > 24 ? { len: 6, kind: 'lobby', label: 'Lobby' } : null);
  },
  bank(f) {
    return cut(
      f.front,
      '55%',
      leaf('lobby', 'Banking hall'),
      row(f.side, [
        [1, leaf('vault', 'Vault')],
        [1.2, leaf('office', "Manager's office")],
        [1, leaf('break', 'Break room')],
      ])
    );
  },
  greenhouse() {
    return cut('a', '82%', leaf('greenhouse', 'Growing house'), leaf('storage', 'Potting shed'));
  },
  garage() {
    return leaf('garage', 'Garage');
  },
  pavilion() {
    return leaf('open', 'Pavilion');
  },
  shelter() {
    return leaf('open', 'Shelter');
  },
  /** Generic large building: big halls plus a strip of side rooms along the back. */
  hall(f) {
    if (f.area < 1500) {
      const n = Math.max(2, Math.min(5, Math.round((f.side === 'a' ? f.L : f.W) / 8)));
      const rooms = [];
      for (let i = 0; i < n; i++) rooms.push([1, leaf(i === 0 ? 'restroom' : i === 1 ? 'office' : 'storage', i === 0 ? 'Restrooms' : i === 1 ? 'Office' : 'Storage ' + (i - 1))]);
      return cut(f.front, '75%', leaf('hall', 'Main hall'), row(f.side, rooms));
    }
    const nh = Math.max(1, Math.min(4, Math.round(f.L / 45)));
    const halls = [];
    for (let i = 0; i < nh; i++) halls.push([1, leaf('hall', nh > 1 ? 'Hall ' + (i + 1) : 'Main hall')]);
    const ns = Math.max(2, Math.min(10, Math.round(f.L / 12)));
    const side = [];
    for (let i = 0; i < ns; i++) side.push([1, leaf(i % 3 === 0 ? 'office' : i % 3 === 1 ? 'storage' : 'restroom', i % 3 === 0 ? 'Office' : i % 3 === 1 ? 'Storage' : 'Restrooms')]);
    const depth = Math.min(12, Math.max(6, f.W * 0.2));
    return cut('b', -depth, row('a', halls), row('a', side));
  },
};

export const RECIPE_NAMES = Object.keys(RECIPES);
