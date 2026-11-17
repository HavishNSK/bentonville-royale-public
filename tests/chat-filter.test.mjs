import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanChat, CHAT_MAX } from '../src/net/chatFilter.js';

const blocked = (t) => cleanChat(t).ok === false;

test('friendly game chat passes unchanged', () => {
  for (const t of [
    'gg nice shot', 'class assist hello', 'see you at 3', 'I got 200 kills', 'i will kill you lol', 'shoot him',
    '45s left', 'i have 100hp', '1v1 me', 'nice clap', 'lets smash their walls', 'who really cares', 'the pen is here',
    'this hit was crazy', 'that was so sus', 'pass me ammo', 'my pass is maxed', 'build my house', 'bus is leaving',
    'grape juice', 'therapist', 'scrape', 'assassin', 'Dickens', 'Hancock', 'raccoon', 'spicy', 'analysis', 'method',
    'cumulative', 'bigger', 'digging', 'flagging', 'nigeria', 'finger', 'i hate this storm', 'where r u', 'lmao', 'omg',
  ]) {
    assert.deepEqual(cleanChat(t), { ok: true, text: t }, t);
  }
});

test('swearing and its acronyms are blocked, not masked', () => {
  for (const t of ['what the fuck', 'stfu noob', 'gtfo', 'omfg', 'lmfao', 'fml', 'wtf bro', 'wth', 'damn it', 'hell no', 'you are an ass', 'dumbass', 'bitch', 'cunt']) {
    const r = cleanChat(t);
    assert.equal(r.ok, false, t);
    assert.equal(r.text, undefined, t);
  }
});

test('disguised spellings are seen through', () => {
  for (const t of [
    'sh1t bro', '$h!t', '5hit', 'f*ck this', 'f.u.c.k', 'f u c k you', 'fu ck', 'fuuuuuck', 'fvck', 'phuck', 'b!tch', 'a$$',
    'c u n t', 'k y s', '𝐟𝐮𝐜𝐤', 'ｆｕｃｋ', 'ⓕⓤⓒⓚ', 'fuсk' /* Cyrillic с */, 'fùçk', 'p u s s y', 'tr4nny',
  ]) {
    assert.ok(blocked(t), t);
  }
});

test('slurs, their spellings and hate phrases are blocked', () => {
  for (const t of ['nigga', 'n1gga', 'niqqa', 'nibba', 'n i g g a', 'nig ger', 'reggin', 'faggot', 'f4g', 'retard', 'chink', 'heil hitler', 'white power', 'go back to your country', 'ur so gay', 'thats gay', 'u r gay']) {
    assert.ok(blocked(t), t);
  }
  assert.equal(cleanChat('nigga').category, 'slur');
});

test('inappropriate phrases without swear words are blocked', () => {
  for (const t of [
    'kill yourself', 'kill urself', 'go unalive urself', 'hope u die', 'go die', 'you should die', 'nobody likes you',
    'send nudes', 's e n d n u d e s', 'suck my balls', 'deez nuts', 'wanna smash', 'take off your clothes', 'step sis',
    'smoke weed', 'get high', 'im gonna shoot up the school', 'i know where you live', 'ur mom is hot', '🖕', '🍆', '69',
  ]) {
    assert.ok(blocked(t), t);
  }
  assert.equal(cleanChat('kill yourself').category, 'selfharm');
});

test('personal info and moving to other apps are blocked', () => {
  for (const t of ['whats ur snap', 'add me on insta', 'what school do u go to', 'where do you live', 'how old r u', 'are u alone', 'im 12 years old', 'dm me', 'dont tell your parents', 'our secret', 'come to my house', 'meet up irl', 'free vbucks']) {
    const r = cleanChat(t);
    assert.equal(r.ok, false, t);
    assert.equal(r.category, 'personal', t);
  }
});

test('links, e-mails and phone numbers are refused', () => {
  for (const t of ['go to www.example.com', 'join discord.gg/abc', 'mail me a@b.co', 'call 479 555 1234']) assert.ok(blocked(t), t);
});

test('length, shouting, spam letters and empty messages', () => {
  assert.equal(cleanChat('x'.repeat(500)).ok, true);
  assert.ok(cleanChat('a b '.repeat(200)).text.length <= CHAT_MAX);
  assert.equal(cleanChat('ASSIST ME PLEASE GUYS').text, 'assist me please guys');
  assert.equal(cleanChat('nooooooooo').text, 'nooo');
  assert.equal(cleanChat('   ').ok, false);
  assert.equal(cleanChat('kys').ok, false);
});
