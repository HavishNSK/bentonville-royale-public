import test from 'node:test';
import assert from 'node:assert/strict';
import { Bots } from '../src/game/Bots.js';

function exitRoute(y) {
  const c = { shell: { floor: 0, plan: { levels: [{ y: 0 }, { y: 3 }] } } };
  let roomCalls = 0;
  const bots = Object.create(Bots.prototype);
  bots.time = 0;
  bots.navStats = { doorRoutes: 0 };
  bots._pickDoor = () => ({ x: 0, z: 0, nx: 1, nz: 0 });
  bots._walkClear = () => false;
  bots._roomRoute = () => { roomCalls++; return 0; };
  const b = { actor: { pos: { x: 0, y, z: 0 } }, inB: c, path: new Float32Array(100), pathK: new Uint8Array(50), doorRoutes: 0 };
  assert.equal(bots._doorRoute(b, 10, 0, null, 0), true);
  return roomCalls;
}
test('upstairs bot above exterior door still requests descending room route', () => assert.equal(exitRoute(3), 1));
test('ground-floor bot in exterior doorway keeps short exit route', () => assert.equal(exitRoute(0), 0));
