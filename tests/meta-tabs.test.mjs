import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(join(root, 'src/ui/meta.js'), 'utf8');
const css = readFileSync(join(root, 'src/ui/meta.css'), 'utf8');

test('suggest / report bug is its own title tab, not inside PATCH NOTES', () => {
  assert.match(src, /tab\('PATCH NOTES', 'news'\)/);
  assert.match(src, /tab\('SUGGEST', 'feedback'\)/);
  assert.match(src, /open === 'feedback'/);
  assert.doesNotMatch(src, /newsTab/);
  assert.doesNotMatch(src, /\['board', 'SUGGEST \/ REPORT A BUG'\]/);
});

test('party invite toasts sit at the top, not over the loadout', () => {
  const block = css.match(/\.mt-toasts \{[^}]+\}/)[0];
  assert.match(block, /\btop:/);
  assert.doesNotMatch(block, /\bbottom: calc/);
});
