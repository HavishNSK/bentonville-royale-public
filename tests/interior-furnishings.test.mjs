import test from 'node:test';
import assert from 'node:assert/strict';
import { furnishInterior } from '../src/world/interiors/furnishings.js';
import { addFurnishingGeometry } from '../src/world/InteriorFurnishings.js';

const frame = { ox: 0, oz: 0, ux: 1, uz: 0, vx: 0, vz: 1, L: 12, W: 10 };
const room = { id: 0, kind: 'bedroom', label: 'Guest Bedroom', a0: 0, b0: 0, a1: 12, b1: 10, cx: 6, cz: 5 };
const level = { i: 0, y: 2, ceil: 5, rooms: [room], holes: [], doors: [{x: 6, z: 0, nx: 0, nz: 1, w: 1.7, roomA: 0, roomB: -1}] };
const plan = () => ({ id: 3, hash: 123, frame, levels: [level], stairs: [], lootSpots: [{x: 6,y: 2,z: 5,level: 0}], furniture: [], signs: [], colliders: [], doorH: 2.2 });
const shell = {floor: 2, inner: [0,0,12,0,12,10,0,10], doors: level.doors};

test('room furnishings are deterministic, immutable, inside the footprint, and leave loot and doors clear', () => {
  const source = plan();
  const before = JSON.stringify(source);
  const out = furnishInterior(source, shell);
  assert.equal(JSON.stringify(source), before);
  assert.deepEqual(out, furnishInterior(plan(), shell));
  assert.ok(out.furniture.some(p => p.kind === 'bed'));
  assert.notEqual(out.hash, source.hash);
  assert.deepEqual(out.colliders, []);
  for (const p of out.furniture) {
    assert.ok(p.a0 > 0 && p.b0 > 0 && p.a1 < 12 && p.b1 < 10);
    assert.ok(p.a1 < 5 || p.a0 > 7 || p.b0 > 6);
  }
  assert.equal(out.signs[0].text, 'GUEST BEDROOM');
});

test('supports upper levels and does not decorate circulation or stair rooms', () => {
  const p = plan();
  p.levels = [level, {...level, i: 1, y: 5, ceil: 8}];
  const out = furnishInterior(p, shell);
  assert.ok(out.furniture.some(p => p.level === 1 && p.y === 5));
  const corridor = {...level, rooms: [{...room, kind: 'corridor'}]};
  assert.equal(furnishInterior({...p, levels: [corridor]}, shell).furniture.length, 0);
  const stairs = [{level: 0, room: 0, upperRoom: 0}];
  assert.equal(furnishInterior({...p, stairs}, shell).furniture.length, 0);
});

test('rejects clipped corners and bounds work even with many rooms', () => {
  const p = plan();
  p.levels = [{...level, rooms: Array.from({length: 500}, (_,id) => ({...room,id}))}];
  const out = furnishInterior(p, shell);
  assert.ok(out.furniture.length <= 96);
  assert.ok(out.signs.length <= 32);
  const noFloor = {...shell, inner: [5,4,7,4,7,6,5,6]};
  assert.equal(furnishInterior(plan(), noFloor).furniture.length, 0);
});

test('renders finite bounded merged geometry without DOM, textures, or scene meshes', () => {
  const out = furnishInterior(plan(), shell);
  const calls = [];
  addFurnishingGeometry({}, {...shell,plan:out}, 12, {quad: (...args) => calls.push(args)});
  assert.ok(calls.length > 12 && calls.length < 1000);
  for (const call of calls) {
    for (const vertex of call.slice(1,5)) for (const v of vertex) assert.ok(Number.isFinite(v));
    assert.equal(call.at(-1), 12);
    assert.equal(call.at(-2), null);
  }
});

test('every furniture recipe emits bounded geometry and upper stair endpoint excludes its room', () => {
  for (const kind of ['bedroom','apartment','living','dining','kitchen','bath','restroom','sales','stall','storage','office','break','vault','garage','greenhouse','gallery','unrecognised']) {
    const p=plan();
    p.levels=[{...level,rooms:[{...room,kind}]}];
    const out=furnishInterior(p,shell);
    assert.ok(out.furniture.length > 0, kind);
    const calls=[];
    addFurnishingGeometry({}, {...shell,plan:out},12,{quad:(...args)=>calls.push(args)});
    assert.ok(calls.length > 0 && calls.length < 1000,kind);
  }
  const p=plan();
  p.levels=[{...level,i:1,y:5,ceil:8}];
  p.stairs=[{level:0,room0:10,room1:0,x0:6,z0:5,x1:6,z1:7}];
  assert.equal(furnishInterior(p,shell).furniture.length,0);
  p.stairs=[{level:1,room0:10,room1:11,x0:6,z0:5,x1:6,z1:7}];
  assert.equal(furnishInterior(p,shell).furniture.length,0);
});

test('tiny rooms skip furniture, labels are plain bounded characters, and plaques need a lintel', () => {
  const p=plan();
  p.levels=[{...level,rooms:[{...room,a1:1,b1:1,label:'<script>é</script> & A very long room name'}]}];
  const out=furnishInterior(p,shell);
  assert.equal(out.furniture.length,0);
  assert.ok(out.signs[0].text.length <= 18);
  assert.match(out.signs[0].text,/^[A-Z0-9 &-]+$/);
  p.levels=[{...level,ceil:4.3}];
  assert.equal(furnishInterior(p,shell).signs.length,0);
  p.levels=[{...level,doors:[{...level.doors[0],open:true}]}];
  assert.equal(furnishInterior(p,shell).signs.length,0);
  assert.doesNotThrow(()=>addFurnishingGeometry({}, {},12,{quad:()=>assert.fail()}));
});
