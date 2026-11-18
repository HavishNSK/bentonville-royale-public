import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lineUpSpots, lineUpHalfWidth, LINEUP_GAP, LINEUP_MAX } from '../src/ui/lineup.js';

const near = (a, b) => Math.abs(a - b) < 1e-9;

test('one member stands front and centre', () => {
  const s = lineUpSpots(1);
  assert.equal(s.length, 1);
  assert.ok(near(s[0].x, 0));
  assert.ok(s[0].z > 0);
});

test('every party size up to the cap is centred, with no two members overlapping', () => {
  for (let n = 1; n <= LINEUP_MAX; n++) {
    const s = lineUpSpots(n);
    assert.equal(s.length, n);
    const xs = s.map((p) => p.x).sort((a, b) => a - b);
    assert.ok(near(xs[0] + xs[xs.length - 1], 0), `n=${n} is not centred`);
    for (let i = 1; i < xs.length; i++) assert.ok(xs[i] - xs[i - 1] >= LINEUP_GAP - 1e-9, `n=${n} overlaps`);
    // the camera fits half-width: every member is inside it
    const half = lineUpHalfWidth(n);
    for (const p of s) assert.ok(Math.abs(p.x) < half, `n=${n} member outside the frame`);
  }
});

test('you are always the front-most member', () => {
  for (let n = 2; n <= LINEUP_MAX; n++) {
    const s = lineUpSpots(n);
    for (let i = 1; i < n; i++) assert.ok(s[0].z > s[i].z);
  }
});

test('sizes are clamped to 0..cap', () => {
  assert.equal(lineUpSpots(-3).length, 0);
  assert.equal(lineUpSpots(50).length, LINEUP_MAX);
  assert.ok(lineUpHalfWidth(0) > 0);
});
