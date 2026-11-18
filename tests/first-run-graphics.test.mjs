import test from 'node:test';
import assert from 'node:assert/strict';
import { firstRunGraphics, sanitizeSettings } from '../src/ui/settings.js';

test('Chromebooks and software renderers start in performance mode', () => {
  assert.equal(firstRunGraphics({ ua: 'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36' }).performanceMode, true);
  assert.equal(firstRunGraphics({ gpu: 'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device), SwiftShader driver)' }).performanceMode, true);
  assert.equal(firstRunGraphics({ gpu: 'Mali-G52' }).performanceMode, true);
});

test('older integrated graphics and small machines start on low', () => {
  assert.deepEqual(firstRunGraphics({ gpu: 'ANGLE (Intel, Intel(R) HD Graphics 520 Direct3D11)' }), { quality: 'low' });
  assert.deepEqual(firstRunGraphics({ gpu: 'ANGLE (Intel, Intel(R) UHD Graphics 600)' }), { quality: 'low' });
  assert.deepEqual(firstRunGraphics({ cores: 4, memory: 4, gpu: 'something unknown' }), { quality: 'low' });
});

test('capable or unknown devices keep the medium default', () => {
  assert.deepEqual(firstRunGraphics({ gpu: 'ANGLE (Apple, ANGLE Metal Renderer: Apple M3, Unspecified Version)', cores: 8, memory: 8 }), {});
  assert.deepEqual(firstRunGraphics({ gpu: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11)', cores: 12, memory: 8 }), {});
  assert.deepEqual(firstRunGraphics({ gpu: 'ANGLE (Intel, Intel(R) Iris(R) Xe Graphics)', cores: 8, memory: 8 }), {});
  assert.deepEqual(firstRunGraphics({}), {});
  assert.equal(sanitizeSettings(firstRunGraphics({})).quality, 'medium');
  assert.equal(sanitizeSettings(firstRunGraphics({ ua: 'CrOS' })).performanceMode, true);
});
