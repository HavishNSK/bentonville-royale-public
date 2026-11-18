import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(join(root, 'src/ui/meta.js'), 'utf8');
const css = readFileSync(join(root, 'src/ui/meta.css'), 'utf8');

test('suggest and report-a-bug are separate title tabs, not inside PATCH NOTES', () => {
  assert.match(src, /tab\('PATCH NOTES', 'news'\)/);
  assert.match(src, /tab\('SUGGEST', 'feedback'\)/);
  assert.match(src, /tab\('REPORT A BUG', 'bugs'\)/);
  assert.match(src, /bNews, bFeedback, bBugs\)/);
  assert.match(src, /open === 'feedback' \|\| open === 'bugs'/);
  // each tab posts its own kind and lists only its own kind
  assert.match(src, /account\.feedback\(kind, text\.value\)/);
  assert.match(src, /boardPosts\(board, kind\)/);
  assert.doesNotMatch(src, /boardKind/, 'no shared SUGGESTION / BUG REPORT toggle left');
  assert.doesNotMatch(src, /newsTab/);
  assert.doesNotMatch(src, /\['board', 'SUGGEST \/ REPORT A BUG'\]/);
});

test('party invite toasts sit at the top, not over the loadout', () => {
  const block = css.match(/\.mt-toasts \{[^}]+\}/)[0];
  assert.match(block, /\btop:/);
  assert.doesNotMatch(block, /\bbottom: calc/);
});
