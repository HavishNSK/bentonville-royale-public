import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  publicItem, addReply, removeReply, canModerateFeedback, sanitizeFeedbackText,
  feedbackKind, boardPosts, FEEDBACK_TAB_KIND, FEEDBACK_KINDS,
} from '../src/net/feedbackBoard.js';

test('legacy posts without replies still list in the public board', () => {
  const old = { id: '1700000000000abcd', kind: 'idea', text: 'Add more chests at the square', by: 'Player1', at: 1700000000000, votes: 4, voters: ['u:secret'] };
  const pub = publicItem(old);
  assert.equal(pub.text, old.text);
  assert.equal(pub.by, 'Player1');
  assert.equal(pub.votes, 4);
  assert.deepEqual(pub.replies, []);
  assert.equal('voters' in pub, false);
});

test('a reply is stored on the same post', () => {
  const post = { id: '1', kind: 'bug', text: 'Rockets do nothing', by: 'Guest', at: 1, votes: 1, replies: [] };
  const out = addReply(post, { id: 'r1', text: 'Same here on sandbox', by: 'Havish', at: 2 });
  assert.equal(out.item.replies.length, 1);
  assert.equal(out.item.replies[0].text, 'Same here on sandbox');
  assert.equal(out.item.text, post.text, 'original suggestion is kept');
});

test('removing a reply leaves the suggestion', () => {
  const post = {
    id: '1', kind: 'idea', text: 'Keep this', by: 'A', at: 1, votes: 2,
    replies: [{ id: 'r1', text: 'nope', by: 'B', at: 2 }],
  };
  const out = removeReply(post, 'r1');
  assert.equal(out.item.text, 'Keep this');
  assert.deepEqual(out.item.replies, []);
});

test('only DEV accounts can moderate the board', () => {
  assert.equal(canModerateFeedback('Shehryar'), true);
  assert.equal(canModerateFeedback('Havish'), true);
  assert.equal(canModerateFeedback('TheChosenOne'), false);
  assert.equal(canModerateFeedback('Player'), false);
  assert.equal(canModerateFeedback(''), false);
});

test('board text rejects empty and unkind posts', () => {
  assert.equal(sanitizeFeedbackText('hi').ok, false);
  assert.equal(sanitizeFeedbackText('please add a smoke crate').ok, true);
  assert.equal(sanitizeFeedbackText('this is shit').ok, false);
});

test('the accounts worker still lists the old fb: keys', () => {
  const src = readFileSync(new URL('../party/accounts.js', import.meta.url), 'utf8');
  assert.match(src, /prefix: 'fb:'/);
  assert.match(src, /feedbackReply/);
  assert.match(src, /feedbackDelete/);
  assert.match(src, /canModerateFeedback/);
});

// ---- separate SUGGEST / REPORT A BUG tabs

const stored = [
  { id: 'a', kind: 'idea', text: 'More chests', by: 'P1', at: 10, votes: 3, voters: ['a:x'] },
  { id: 'b', text: 'Old post saved before kinds existed', by: 'P2', at: 5, votes: 9 },
  { id: 'c', kind: 'bug', text: 'Fell through the bridge', by: 'P3', at: 20, votes: 2,
    replies: [{ id: 'r1', text: 'same', by: 'P4', at: 21 }] },
  { id: 'd', kind: 'weird', text: 'Unknown kind from a tampered client', by: 'P5', at: 1, votes: 0 },
];
const listed = stored.map(publicItem);

test('feedbackKind is a two-value enum; missing or unknown means suggestion', () => {
  assert.deepEqual([...FEEDBACK_KINDS], ['idea', 'bug']);
  assert.equal(feedbackKind('bug'), 'bug');
  assert.equal(feedbackKind('idea'), 'idea');
  for (const raw of [undefined, null, '', 'BUG', 'suggestion', 'weird', 1, {}, ['bug']]) {
    assert.equal(feedbackKind(raw), 'idea', String(raw));
  }
});

test('old posts without a kind still appear in SUGGEST', () => {
  const ideas = boardPosts(listed, FEEDBACK_TAB_KIND.feedback);
  assert.deepEqual(ideas.map((x) => x.id), ['b', 'a', 'd'], 'every non-bug post, most votes first');
  assert.equal(ideas.find((x) => x.id === 'b').text, 'Old post saved before kinds existed');
  // also works on raw rows that never went through publicItem
  assert.ok(boardPosts(stored, 'idea').some((x) => x.id === 'b'));
});

test('bug posts appear only in REPORT A BUG, with replies kept', () => {
  const bugs = boardPosts(listed, FEEDBACK_TAB_KIND.bugs);
  assert.deepEqual(bugs.map((x) => x.id), ['c']);
  assert.equal(bugs[0].replies.length, 1);
  assert.equal(boardPosts(listed, 'idea').some((x) => x.id === 'c'), false);
});

test('the two tabs together still show every stored post', () => {
  const ideas = boardPosts(listed, 'idea');
  const bugs = boardPosts(listed, 'bug');
  assert.equal(ideas.length + bugs.length, stored.length);
  assert.deepEqual(new Set([...ideas, ...bugs].map((x) => x.id)), new Set(stored.map((x) => x.id)));
});

test('boardPosts does not mutate the shared list and tolerates junk', () => {
  const copy = listed.slice();
  boardPosts(listed, 'bug');
  assert.deepEqual(listed, copy);
  assert.deepEqual(boardPosts(null, 'idea'), []);
  assert.deepEqual(boardPosts([null, undefined], 'idea'), []);
});

test('SUGGEST posts kind idea and REPORT A BUG posts kind bug', () => {
  assert.deepEqual({ ...FEEDBACK_TAB_KIND }, { feedback: 'idea', bugs: 'bug' });
  const acct = readFileSync(new URL('../src/net/Account.js', import.meta.url), 'utf8');
  assert.match(acct, /api\('feedback', \{ kind, text,/, 'client sends the kind field to the worker');
});

test('the worker validates kind with the shared enum and keeps its limits', () => {
  const src = readFileSync(new URL('../party/accounts.js', import.meta.url), 'utf8');
  assert.match(src, /const kind = feedbackKind\(m\.kind\)/);
  assert.match(src, /storage\.put\('fb:' \+ id, item\)/, 'new posts still land on fb: keys');
  assert.match(src, /Date\.now\(\) - last < 30000/, 'per-IP rate limit kept');
  assert.match(src, /sanitizeFeedbackText\(m\.text\)/, 'text moderation kept');
});
