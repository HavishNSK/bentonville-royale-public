import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

test('lobby water-tower art is in public', () => {
  assert.equal(existsSync(join(root, 'public/ui/lobby-bg.jpg')), true);
});

test('menus load the water-tower backdrop', () => {
  const css = readFileSync(join(root, 'src/ui/menus.css'), 'utf8');
  assert.match(css, /\/ui\/lobby-bg\.jpg/);
  assert.match(css, /background-size:[^;]*cover/);
});
