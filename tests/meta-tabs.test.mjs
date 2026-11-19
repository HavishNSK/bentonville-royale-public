import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(join(root, 'src/ui/meta.js'), 'utf8');
const css = readFileSync(join(root, 'src/ui/meta.css'), 'utf8');

test('suggestions and bug reports share one FEEDBACK title tab, not inside PATCH NOTES', () => {
  assert.match(src, /tab\('PATCH NOTES', 'news'\)/);
  assert.match(src, /tab\('FEEDBACK', 'feedback'\)/);
  assert.doesNotMatch(src, /tab\('SUGGEST'/);
  assert.doesNotMatch(src, /tab\('REPORT A BUG'/);
  assert.match(src, /bNews, bFeedback\)/);
  assert.match(src, /open === 'feedback'\) renderFeedback\(\)/);
  // the form picks what it posts; the list filters all / ideas / bugs
  assert.match(src, /\['idea', 'SUGGESTION'\], \['bug', 'BUG REPORT'\]/);
  assert.match(src, /\['all', 'ALL'\], \['idea', 'IDEAS'\], \['bug', 'BUGS'\]/);
  assert.match(src, /account\.feedback\(kind, text\.value\)/);
  assert.match(src, /boardPosts\(board, listFilter\)/);
  assert.doesNotMatch(src, /newsTab/);
});

test('party invite toasts sit at the top, not over the loadout', () => {
  const block = css.match(/\.mt-toasts \{[^}]+\}/)[0];
  assert.match(block, /\btop:/);
  assert.doesNotMatch(block, /\bbottom: calc/);
});
