// BENTONVILLE ROYALE — global chat text rules, shared by the server (party/presence.js, the
// authority) and the client (instant feedback before sending).
//
//   const r = cleanChat(text)   -> { ok: true, text } | { ok: false, reason }
//
// - one line, at most CHAT_MAX characters, control characters removed, spaces collapsed
// - no links, e-mail addresses or phone numbers (players are mostly students)
// - swear words and slurs are masked with * (leetspeak and s.p.a.c.i.n.g are seen through)
// - shouting (all caps) is lowered; long repeated characters are shortened

export const CHAT_MAX = 120;

// Word stems: a word containing one of these (after normalising) is masked. Kept short and
// generic on purpose; extend as needed.
const BLOCKED = [
  'fuck', 'fuk', 'fck', 'shit', 'sht', 'bitch', 'btch', 'cunt', 'dick', 'cock', 'pussy', 'asshole', 'bastard',
  'whore', 'slut', 'porn', 'penis', 'vagina', 'boob', 'tits', 'nude', 'sex', 'rape', 'molest', 'horny', 'cum',
  'nigg', 'nigga', 'fag', 'retard', 'tranny', 'spic', 'chink', 'kike', 'wetback', 'coon',
  'kys', 'killyourself', 'kill yourself', 'suicide', 'nazi', 'hitler', 'damn', 'crap', 'wtf', 'stfu', 'dumbass',
];
// Exact whole words only (would hit innocent words as stems: "class", "assist", "Scunthorpe").
const BLOCKED_WORDS = new Set(['ass', 'arse', 'hell', 'piss', 'twat', 'prick', 'hoe', 'thot', 'simp']);

const LEET = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', 8: 'b', '@': 'a', $: 's', '!': 'i', '|': 'i', '+': 't' };

function norm(s) {
  let out = '';
  for (const ch of s.toLowerCase()) out += LEET[ch] || ch;
  return out.replace(/[^a-z]/g, '').replace(/(.)\1{2,}/g, '$1$1');
}

function badWord(word) {
  const n = norm(word);
  if (!n) return false;
  if (BLOCKED_WORDS.has(n)) return true;
  for (const b of BLOCKED) if (n.includes(b.replace(/ /g, ''))) return true;
  return false;
}

// Usernames: stems that are also common inside innocent names ("Sexton", "Dickson", "spicy",
// "raccoon", "grape", "thorny", "Ashton", "scrape"...) only count when a whole name part is the word
// (optionally plural). Everything else in BLOCKED counts anywhere in the name.
const NAME_EXACT = new Set(['kys', 'cum', 'spic', 'coon', 'sex', 'dick', 'cock', 'crap', 'damn', 'nude', 'boob', 'tits', 'sht', 'rape', 'horny', 'sexy']);
const NAME_STEMS = BLOCKED.map((b) => b.replace(/ /g, '')).filter((b) => !NAME_EXACT.has(b));

function badNamePart(part) {
  const n = norm(part);
  if (!n) return false;
  const base = n.replace(/(s|z)$/, '');
  if (BLOCKED_WORDS.has(n) || BLOCKED_WORDS.has(base) || NAME_EXACT.has(n) || NAME_EXACT.has(base)) return true;
  return NAME_STEMS.some((b) => n.includes(b));
}

/**
 * True when a player / account name has no swear words or slurs. Checks the whole name and its
 * parts split on spaces, _ - . and camelCase ("xX_Ass_Xx", "BigAss"). Leetspeak is seen through.
 */
export function nameIsClean(name) {
  const s = String(name == null ? '' : name);
  if (badNamePart(s)) return false;
  for (const part of s.split(/[\s_.-]+|(?<=[a-z])(?=[A-Z])/)) if (badNamePart(part)) return false;
  return true;
}

const LINK =/(https?:\/\/|www\.|discord\.gg|\b[a-z0-9-]{2,}\s*(\.|\(dot\)|\[dot\])\s*(com|net|org|gg|io|xyz|ly|me|co|tv|app|link|site|us|info|dev)\b)/i;
const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/;
const PHONE = /(\d[\s.-]?){7,}/;

export function cleanChat(raw) {
  let text = String(raw == null ? '' : raw)
    .replace(/[\u0000-\u001f\u007f\u200b-\u200f\u2028-\u202e\u2060-\u206f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return { ok: false, reason: 'empty' };
  if (text.length > CHAT_MAX) text = text.slice(0, CHAT_MAX).trim();
  if (LINK.test(text)) return { ok: false, reason: 'No links in chat.' };
  if (EMAIL.test(text)) return { ok: false, reason: 'No e-mail addresses in chat.' };
  if (PHONE.test(text)) return { ok: false, reason: 'No phone numbers in chat.' };
  // shouting: mostly capitals in a longer message -> lower case
  const letters = text.replace(/[^A-Za-z]/g, '');
  if (letters.length >= 8 && letters.replace(/[^A-Z]/g, '').length / letters.length > 0.7) text = text.toLowerCase();
  text = text.replace(/(.)\1{4,}/g, '$1$1$1');
  // mask bad words (also when split up: "f u c k", "s.h.i.t")
  const words = text.split(' ');
  for (let i = 0; i < words.length; i++) if (badWord(words[i])) words[i] = '*'.repeat(Math.min(8, words[i].length));
  // runs of 1-2 letter pieces glued back together ("f u c k")
  for (let i = 0; i < words.length; i++) {
    let j = i;
    let glued = '';
    while (j < words.length && norm(words[j]).length > 0 && norm(words[j]).length <= 2 && j - i < 12) {
      glued += words[j];
      j++;
      if (j - i >= 3 && badWord(glued)) {
        for (let k = i; k < j; k++) words[k] = '*';
        break;
      }
    }
  }
  text = words.join(' ');
  if (!text.replace(/[\s*]/g, '')) return { ok: false, reason: 'Keep chat friendly.' };
  return { ok: true, text };
}
