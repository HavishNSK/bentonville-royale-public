import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

test('lobby dusk backdrop is in public and is a plain SVG', () => {
  const file = join(root, 'public/ui/lobby-dusk.svg');
  assert.equal(existsSync(file), true);
  const svg = readFileSync(file, 'utf8');
  assert.match(svg, /^<svg[^>]+viewBox="0 0 1600 900"/);
  // a static image: no scripts, no external references
  assert.doesNotMatch(svg, /<script|href=|url\(/i);
});

test('menus load the dusk backdrop', () => {
  const css = readFileSync(join(root, 'src/ui/menus.css'), 'utf8');
  assert.match(css, /\/ui\/lobby-dusk\.svg/);
  assert.match(css, /background-size:[^;]*cover/);
});
