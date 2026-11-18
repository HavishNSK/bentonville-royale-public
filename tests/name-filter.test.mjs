import test from 'node:test';
import assert from 'node:assert/strict';
import { nameIsClean } from '../src/net/chatFilter.js';

test('ordinary names are allowed', () => {
  for (const n of ['Player123', 'Ashton', 'Sexton', 'Dickson', 'SpicyTaco', 'Raccoon', 'GrapeJuice', 'Classic_Gamer', 'Hancock', 'Scraper', 'Thorny', 'Kyson', 'Skyscraper', 'Assassin']) {
    assert.equal(nameIsClean(n), true, n);
  }
});

test('names with swear words or slurs are refused', () => {
  for (const n of ['fuckboy', 'xX_sh1t_Xx', 'BigAss', 'big_ass', 'ass', 'B1tchy', 'f.u.c.k', 'Dick', 'dicks', 'kys', 'SexyGamer', 'cunt99', 'Hitler']) {
    assert.equal(nameIsClean(n), false, n);
  }
});

test('empty and odd input does not throw', () => {
  assert.equal(nameIsClean(''), true);
  assert.equal(nameIsClean(null), true);
  assert.equal(nameIsClean(undefined), true);
});
