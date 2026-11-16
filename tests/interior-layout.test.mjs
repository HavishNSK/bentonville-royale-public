import test from 'node:test';
import assert from 'node:assert/strict';
import { partition, cut, leaf, roomPoint, polyArea } from '../src/world/interiors/layout.js';
const F = { ox: 0, oz: 0, ux: 1, uz: 0, vx: 0, vz: 1, L: 12, W: 12 };
const P = [0, 0, 12, 0, 12, 12, 8, 12, 8, 1.5, 0, 1.5];
test('odd footprints do not turn narrow wings into separate sliver rooms', () => {
  const tree = cut('a', 6, leaf('office'), leaf('hall'));
  const result = partition(tree, P, F, []);
  assert.ok(result.rooms.every(r => roomPoint(r, P)[2] >= 1), 'each room needs a two-metre-wide standable area');
  assert.equal(result.rooms.reduce((sum,r) => sum + r.area, 0), Math.abs(polyArea(P)), 'collapsed cuts preserve floor coverage');
  assert.ok(result.pieces.every(p => p.ra >= 0 && p.rb >= 0 && p.ra !== p.rb), 'no walls facing dropped rooms');
});
test('nested recipe cuts retain coverage when an odd-footprint wing cannot hold rooms', () => {
  const tree = cut('a', 6, cut('b', '50%', leaf('bath'), leaf('storage')), cut('b', 6, leaf('hall'), leaf('office')));
  const result = partition(tree, P, F, []);
  assert.ok(result.rooms.length);
  assert.ok(result.rooms.every(r => roomPoint(r, P)[2] >= 1));
  assert.equal(result.rooms.reduce((sum,r) => sum + r.area, 0), Math.abs(polyArea(P)));
});
