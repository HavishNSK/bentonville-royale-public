import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { publicItem, addReply, removeReply, canModerateFeedback, sanitizeFeedbackText } from '../src/net/feedbackBoard.js';

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
