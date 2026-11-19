import test from 'node:test';
import assert from 'node:assert/strict';
import { DynamicResolution } from '../src/render/DynamicResolution.js';
import { sanitizeSettings } from '../src/ui/settings.js';

const run = (dyn, ms, seconds, cpu = 2) => {
  for (let t = 0; t < seconds * 1000; t += ms) dyn.update(ms, cpu);
};

test('60 fps on a 60 Hz screen keeps full resolution', () => {
  const d = new DynamicResolution();
  run(d, 1000 / 60, 30);
  assert.equal(d.scale, 1);
});

test('a GPU-bound drop to 20 fps lowers the resolution', () => {
  const d = new DynamicResolution();
  run(d, 1000 / 60, 3);
  run(d, 50, 3);
  assert.ok(d.scale < 1, `scale ${d.scale}`);
  assert.ok(d.scale >= d.min);
});

test('a CPU-bound slowdown leaves the resolution alone', () => {
  const d = new DynamicResolution();
  run(d, 1000 / 60, 3);
  run(d, 50, 5, 45);
  assert.equal(d.scale, 1);
});

test('resolution comes back once there is headroom', () => {
  const d = new DynamicResolution();
  run(d, 1000 / 60, 3);
  run(d, 50, 3);
  assert.ok(d.scale < 1);
  run(d, 1000 / 60, 60);
  assert.equal(d.scale, 1);
});

test('never goes below the minimum, and 144 Hz screens are not punished', () => {
  const d = new DynamicResolution();
  run(d, 80, 30);
  assert.equal(d.scale, d.min);
  const hi = new DynamicResolution();
  run(hi, 1000 / 144, 5);
  run(hi, 1000 / 100, 10); // 100 fps is still smooth
  assert.equal(hi.scale, 1);
});

test('dynamic resolution is on by default and can be turned off', () => {
  assert.equal(sanitizeSettings({}).dynamicResolution, true);
  assert.equal(sanitizeSettings({ dynamicResolution: false }).dynamicResolution, false);
});

test('FPS limit and raw mouse settings are sanitized', () => {
  const d = sanitizeSettings({});
  assert.equal(d.fpsCap, 250);
  assert.equal(d.rawMouse, false);
  assert.equal(sanitizeSettings({ fpsCap: 5 }).fpsCap, 30);
  assert.equal(sanitizeSettings({ fpsCap: 9999 }).fpsCap, 250);
  assert.equal(sanitizeSettings({ fpsCap: '144' }).fpsCap, 144);
  assert.equal(sanitizeSettings({ rawMouse: true }).rawMouse, true);
});
