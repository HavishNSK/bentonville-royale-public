// BENTONVILLE ROYALE — global chat and name rules, shared by the server (party/presence.js, the
// authority) and the client (instant feedback before sending). Players are mostly kids, so a
// message that breaks a rule is NOT sent at all (no "****" masking that still gets the point across).
//
//   const r = cleanChat(text)   -> { ok: true, text } | { ok: false, reason, category }
//   moderate(text)              -> null | 'slur' | 'selfharm' | 'threat' | 'sexual' | 'personal' | 'drugs' | 'profanity' | 'bully'
//   nameIsClean(name)           -> boolean
//
// What is checked, after seeing through disguises (see `fold` / `tokenForms`):
//   - swear words, sexual words, slurs and their acronyms ("stfu", "kys", "gtfo", "omfg", "fml" ...)
//   - phrases with no swear word that still aren't kid-friendly: self-harm ("go unalive urself"),
//     real-world threats, hate ("go back to your country"), sexual talk, "ur gay", drugs
//   - asking for or sharing personal info / moving to other apps ("whats ur snap", "where do u live")
//   - links, e-mail addresses, phone numbers
// Disguises seen through: leetspeak (sh1t, $h!t, 5hit), look-alike letters from other alphabets,
// fancy / fullwidth / circled letters, accents and "zalgo" marks, stretched letters (fuuuuck),
// symbols inside words (f*ck, f.u.c.k, f_u_c_k), spaced letters (f u c k, n i g g a),
// words split in two (nig ger), and a few reversed spellings.
//
// It is a word list, not a person: it will miss some new slang and occasionally block an innocent
// message. Extend the lists as evasions show up, with a test in tests/chat-filter.test.mjs.

export const CHAT_MAX = 120;

const REASONS = {
  slur: 'Slurs and hate speech are not allowed. Your message was not sent.',
  selfharm: 'Messages about hurting yourself or others are not allowed. If you are going through something hard, please talk to a trusted adult.',
  threat: 'Threats are not allowed, even as a joke. Your message was not sent.',
  sexual: 'That message is not kid-friendly. Your message was not sent.',
  personal: 'For your safety, don’t share or ask for personal info, ages, locations or other apps.',
  drugs: 'That message is not kid-friendly. Your message was not sent.',
  profanity: 'No swearing in chat. Your message was not sent.',
  bully: 'Be kind: insults like that are not allowed. Your message was not sent.',
};

// ------------------------------------------------------------------ word lists
// Whole words (after normalising; a trailing plural "s"/"es"/"z" also counts). Short or ambiguous
// words live here so innocent words that contain them ("class", "grape", "Dickens", "spicy",
// "raccoon", "therapist", "method", "cumulative", "Ashton") are never hit.
const EXACT = {
  profanity: [
    'ass', 'arse', 'azz', 'hell', 'piss', 'pissed', 'pissing', 'damn', 'dammit', 'damnit', 'crap', 'crappy',
    'wtf', 'wth', 'stfu', 'stfuu', 'gtfo', 'omfg', 'lmfao', 'ffs', 'fml', 'af', 'tf', 'fu', 'fk', 'fkn', 'fking',
    'fkin', 'fuq', 'mf', 'mfer', 'mofo', 'bs', 'pos', 'smd', 'gfy', 'foad', 'jfc', 'dafuq', 'wtff', 'bish', 'biatch',
    'prick', 'twat', 'bastard', 'douche', 'wanker', 'wank', 'bollocks', 'sht', 'shat', 'tit', 'titty', 'butthole',
    'bich', 'btch', 'hoe', 'thot', 'cuck', 'kcuf', 'tihs', 'hctib', 'tnuc', 'kys', 'kms',
  ],
  sexual: [
    'dick', 'cock', 'cum', 'cumming', 'sex', 'sexy', 'sexx', 'secks', 'seggs', 'nude', 'naked', 'rape', 'raped',
    'raping', 'rapist', 'porn', 'horny', 'boob', 'boobie', 'boobies', 'anal', 'anus', 'xxx', 'nsfw', 'milf',
    'dilf', 'boner', 'pedo', 'pp', 'thicc', 'hentai', 'rule34', 'onlyfans', 'bussy', 'gyat', 'gyatt', 'jizz',
    'semen', 'sperm', 'clit', 'vag', 'condom', 'erection', 'stripper', 'hooker', 'prostitute', 'nipple', 'testicle',
    'nutted', 'bj', 'hj', 'fap', 'fapping', 'coomer', 'gooning', 'gooner', 'thong', 'panties', 'lingerie', 'bdsm',
    'kinky', 'kink', 'orgy', 'incest',
  ],
  slur: [
    'spic', 'spick', 'coon', 'paki', 'homo', 'dyke', 'niga', 'niger', 'nigr', 'nig', 'negro', 'negroe', 'gook', 'kike',
    'chink', 'jap', 'tard', 'beaner', 'wetback', 'raghead', 'towelhead', 'kkk', 'nazi', 'heil', 'sieg', 'tranny',
    'trannie', 'shemale', 'fag', 'faggy', 'reggin', 'aggin', 'gypsy', 'redskin', 'squaw', 'chingchong', 'zipperhead',
    'cracka', 'honky', 'retard', 'retarded', 'autist', 'mongoloid', 'spaz', 'cripple',
  ],
  drugs: [
    'weed', 'cocaine', 'meth', 'heroin', 'vape', 'vaping', 'juul', 'xanax', 'perc', 'percs', 'lsd', 'shrooms',
    'edibles', 'bong', 'stoned', 'drunk', 'crackhead', 'fentanyl', 'oxy', 'kush',
  ],
  selfharm: ['suicide', 'suicidal', 'selfharm'],
  personal: ['snapchat', 'insta', 'instagram', 'tiktok', 'discord', 'whatsapp', 'telegram', 'kik', 'omegle', 'facebook'],
};
// numbers on their own (sexual / hate codes)
const BAD_NUMBERS = new Map([
  ['69', 'sexual'], ['6969', 'sexual'], ['420', 'drugs'], ['1488', 'slur'], ['80085', 'sexual'], ['8008', 'sexual'],
  ['58008', 'sexual'], ['177013', 'sexual'],
]);

// Stems: anywhere inside a word. Only spellings that no common innocent word contains.
const STEMS = {
  profanity: [
    /f+[uv]+c+k+/, /f+[uv]+k+(?!u)/, /f+c+k+/, /ph+u+c*k+/, /fcuk/, /fuxk/, /f+u+q+/, /motherf/, /muthaf/, /mothaf/,
    /sh+[iy]+t+/, /shyt/, /bullsh/, /b+[iy]+a*t+c+h+/, /c+u+n+t+/, /a+s+s+h+o+l+e/, /a+s+s+h+a+t/, /assclown/, /asswipe/,
    /arsehole/, /dumba+s+/, /jacka+s+/, /smarta+s+/, /fata+s+/, /bada+s+/, /kicka+s+/, /lamea+s+/, /dipsh/, /douchebag/,
    /wanker/, /bollock/, /bastard/, /pissoff/, /goddam/, /bullcrap/, /dickhead/, /dickface/, /dickwad/, /cocksuck/,
    /screwyou/,
  ],
  sexual: [
    /porn/, /pussy/, /pussi/, /penis/, /vagina/, /dildo/, /blowjob/, /handjob/, /orgasm/, /masturb/, /jerkoff/,
    /jackoff/, /jerkingoff/, /erotic/, /hentai/, /onlyfan/, /cumshot/, /titties/, /tittie/, /boobs/, /slut/, /whore/,
    /molest/, /pedophil/, /paedo/, /sexting/, /sextape/, /stepsis/, /stepbro/, /stepmom/, /horni/, /nudes/,
    /deepthroat/, /threesome/, /rimjob/, /cameltoe/, /blueball/, /bigdick/, /smalldick/, /suckmy/, /lickmy/,
  ],
  slur: [
    /n+[iy]+g+g+/, /n+[iy]+b+b+a/, /n+[iy]+q+q+/, /n+[iy]+g+(?:a|ah|uh)$/, /n+[iy]+g+l+e*t/, /^n+[iy]+g+[ae]+r+s?$/,
    /negga/, /kneegrow/, /nygga/, /fagg/, /fagot/, /fagit/, /f+a+g+o+t/, /retard/, /rtard/, /tranny/, /trannie/,
    /sandnig/, /junglebunn/, /porchmonk/, /jigaboo/, /coonass/, /beaner/, /wetback/, /raghead/, /towelhead/,
    /chingchong/, /hitler/, /swastika/, /whitepower/, /siegheil/, /heilhitler/, /gasthejews/,
  ],
  selfharm: [/killyour?self/, /killurself/, /killyoself/, /hangyour?self/, /hangurself/, /unaliveyour?self/, /unaliveurself/, /suicid/, /slityourwrist/, /drinkbleach/],
  drugs: [/cocaine/, /methhead/, /crackhead/, /fentanyl/, /marijuana/, /smokeweed/, /getstoned/],
};
// Words split by spaces ("nig ger", "fu ck") are glued and tested only against spellings that are
// never innocent across a word gap (not shit / whore / penis: "this hit", "who really", "the pen is").
const SEVERE_GLUE = [
  [/n+[iy]+g+g+/, 'slur'], [/^n+[iy]+g+a+$/, 'slur'], [/fagg/, 'slur'], [/retard/, 'slur'],
  [/f+[uv]+c+k+/, 'profanity'], [/c+u+n+t+/, 'profanity'], [/b+[iy]+t+c+h+/, 'profanity'], [/pussy/, 'sexual'],
];

// Phrases, tested on the cleaned, spaced text: no swear word needed to be inappropriate.
// In a battle royale "i will kill you" / "shoot him" is normal; real-world threats are not.
const YOU = '(?:you|u|ya|yu|ur|your|yo|youre|ure|yall)';
const YOURSELF = '(?:yourself|urself|yoself|youself|yourselves|urselves|ur self|your self|yo self|u self|yaself)';
const PHRASES = [
  // self-harm / telling someone to die
  ['selfharm', new RegExp(`\\b(?:kill|hang|end|unalive|off|neck|shoot|stab|delete|cut|hurt|drown|starve)\\s*${YOURSELF}\\b`)],
  ['selfharm', /\bgo\s+(?:die|unalive|jump\s+off|play\s+in\s+traffic|drink\s+bleach|hang)\b/],
  ['selfharm', new RegExp(`\\b(?:hope|wish|pray)\\s+(?:that\\s+)?${YOU}\\s+(?:die|dies|get\\s+cancer|get\\s+hit|get\\s+run\\s+over|choke|drown|burn)`)],
  ['selfharm', /\b(?:drink|eat)\s+bleach\b/],
  ['selfharm', /\bslit\s+(?:your|ur|my|his|her)\s+(?:wrist|wrists|throat)\b/],
  ['selfharm', /\b(?:im|i\s+m|i\s+am|i\s+want\s+to|i\s+wanna|gonna)\s+(?:kill\s+myself|unalive\s+myself|end\s+it\s+all|end\s+my\s+life|cut\s+myself|hurt\s+myself)\b/],
  ['selfharm', /\bnobody\s+would\s+(?:care|miss\s+you|miss\s+u)\s+if\s+(?:you|u)\s+died\b/],
  ['selfharm', /\b(?:you|u)\s+should\s+(?:die|not\s+exist|not\s+be\s+alive|be\s+dead)\b/],
  // real-world threats
  ['threat', /\b(?:bomb|blow\s+up|burn\s+down|shoot\s+up|shooting\s+up)\s+(?:the\s+|a\s+|my\s+|our\s+|ur\s+|your\s+|this\s+)?(?:school|class|classroom|church|mosque|synagogue|temple)\b/],
  ['threat', /\bschool\s+shoot/],
  ['threat', /\bbring\s+(?:a\s+|my\s+)?(?:gun|knife|bomb|weapon)\s+to\s+(?:school|class)\b/],
  ['threat', new RegExp(`\\b(?:kill|hurt|stab|shoot|find|beat\\s+up|jump|rape|kidnap)\\s+${YOU}\\s+(?:irl|in\\s+real\\s+life|after\\s+school|at\\s+school|tomorrow)\\b`)],
  ['threat', new RegExp(`\\bknow\\s+where\\s+${YOU}\\s+live`)],
  ['threat', new RegExp(`\\b(?:im|i\\s+m|ill|i\\s+will|imma|gonna)\\s+(?:find|dox|doxx|swat|leak)\\s+${YOU}\\b`)],
  ['threat', /\b(?:dox|doxx|doxxed|doxing|doxxing|swatting)\b/],
  // hate
  ['slur', /\bheil\b/],
  ['slur', /\bwhite\s+(?:power|pride|supremacy)\b/],
  ['slur', /\bgas\s+the\s+\w+/],
  ['slur', /\b(?:go\s+back\s+to|get\s+out\s+of)\s+(?:your|ur)\s+(?:own\s+)?country\b/],
  ['slur', /\bgo\s+back\s+to\s+(?:africa|mexico|china|india|the\s+jungle)\b/],
  ['slur', /\b(?:hate|kill\s+all|ban\s+all|deport\s+all|deport|gas\s+all)\s+(?:the\s+)?(?:blacks|whites|asians|jews|muslims|mexicans|gays|immigrants|indians|arabs|christians|hindus|(?:black|white|asian|jewish|muslim|mexican|gay|trans|indian|arab|chinese)\s+(?:people|kids|guys))\b/],
  ['slur', /\bi\s+hate\s+(?:black|white|asian|jewish|muslim|mexican|gay|trans|indian|arab|chinese|jews|blacks|gays)\b/],
  ['slur', /\b(?:blacks|jews|muslims|mexicans|asians|gays|immigrants|arabs|whites|indians)\s+(?:are|r|should)\b/],
  ['slur', /\b(?:monkey|ape|gorilla)\s+(?:boy|girl|man|people)\b/],
  ['slur', /\bthe\s+holocaust\s+(?:was\s+fake|didnt\s+happen|never\s+happened|was\s+good)\b/],
  // bullying
  ['bully', new RegExp(`\\b(?:so|thats|that\\s+s|its|it\\s+s|is|ur|youre|your|you\\s+are|you\\s+r|u\\s+r|u\\s+are|ure|hes|shes|he\\s+s|she\\s+s|ya)\\s+(?:so\\s+)?(?:gay|autistic|retarded|special\\s+ed|a\\s+fag|a\\s+homo|a\\s+tranny)\\b`)],
  ['bully', /\bgay\s*(?:ass|boy|wad|lord|bitch)\b/],
  ['bully', /\bno\s+homo\b/],
  ['bully', /\b(?:nobody|no\s+one)\s+(?:likes|loves|cares\s+about)\s+(?:you|u)\b/],
  ['bully', new RegExp(`\\b${YOU}\\s+(?:are\\s+|r\\s+)?(?:so\\s+)?(?:fat|ugly)\\s+(?:and|ass|pig|loser|cow|whale|freak)`)],
  ['bully', new RegExp(`\\b(?:ur|your|yo)\\s+(?:mom|mum|mama|momma|mother|dad|sister|sis)\\s+(?:is\\s+|s\\s+)?(?:hot|fat|sexy|gay|ugly|naked|a\\s+hoe|easy|thick|thicc)`)],
  ['bully', /\b(?:ur|your|yo)\s+(?:mom|mum|mama|momma|mother)\s+(?:last\s+night|in\s+bed)\b/],
  // sexual talk
  ['sexual', /\bsend\s+(?:me\s+)?(?:nudes|noods|pics|pictures|feet|feet\s+pics|a\s+pic\s+of\s+(?:you|u|ur|your))\b/],
  ['sexual', /\b(?:suck|lick|touch|grab|rub|squeeze|kiss|smell|eat)\s+(?:on\s+)?(?:my|ur|your|his|her|their|deez|these|them)\s+(?:d|dk|balls|ass|butt|booty|toes|feet|body|chest|privates|private\s+parts|nuts|pp|meat|tongue|lips|thighs|banana|lollipop|weiner|wiener|willy|sausage|hotdog|hot\s+dog)\b/],
  ['sexual', /\b(?:suck|lick)\s+(?:my|ur|your|deez|these|it|this|on\s+it)\b/],
  ['sexual', /\b(?:deez|these|my|suck|lick|bite|grab)\s+nuts\b/],
  ['sexual', /\btake\s+(?:off|of)\s+(?:your|ur|my|his|her)\s+(?:clothes|shirt|pants|dress|bra|underwear)\b/],
  ['sexual', /\b(?:get|got|getting)\s+(?:naked|laid|nude|freaky|frisky)\b/],
  ['sexual', /\b(?:have|had|having)\s+(?:sex|it\s+on)\b/],
  ['sexual', /\b(?:hook|hooking)\s+up\s+(?:with|w)\b/],
  ['sexual', /\bmake\s+out\s+(?:with|w)\b/],
  ['sexual', /\b(?:would|wanna|want\s+to|i\s+d|id|i\s+would)\s+(?:smash|hit\s+that|tap\s+that|smesh|do\s+(?:you|u|her|him))\b/],
  ['sexual', /\b(?:sit|sitting)\s+on\s+(?:my|ur|your)\s+(?:face|lap)\b/],
  ['sexual', /\b(?:big|small|tiny|huge|long|hard)\s+(?:d|dk|pp|weiner|wiener|willy|balls|nuts|cock|dick)\b/],
  ['sexual', /\bstep\s*(?:sis|sister|bro|brother|mom|mommy|daddy)\b/],
  ['sexual', /\bwhat\s+are\s+(?:you|u)\s+wearing\b/],
  ['sexual', /\b(?:body\s+count|friends\s+with\s+benefits|fwb|netflix\s+and\s+chill)\b/],
  // personal info / moving to a private app (kid safety)
  ['personal', /\b(?:add|follow|dm|message|msg|text|call|snap|ft|facetime|friend)\s+me\s+(?:on|at)\b/],
  ['personal', /\b(?:dm|text|call|facetime|snap)\s+me\b/],
  ['personal', /\b(?:my|ur|your|whats\s+ur|whats\s+your|what\s+is\s+your|what\s+s\s+your|wats\s+ur|give\s+me\s+your|give\s+me\s+ur|send\s+me\s+your|send\s+me\s+ur)\s+(?:snap|snapchat|insta|instagram|ig|discord|tiktok|number|num|digits|phone|cell|address|addy|email|gmail|age|real\s+name|last\s+name|full\s+name|password|location|zip|zipcode)\b/],
  ['personal', new RegExp(`\\bwhere\\s+(?:do\\s+|does\\s+)?${YOU}\\s+(?:live|go\\s+to\\s+school|stay)\\b`)],
  ['personal', new RegExp(`\\bwhat\\s+(?:school|grade|town|city|street)\\s+(?:do\\s+|does\\s+|are\\s+|r\\s+)?${YOU}\\b`)],
  ['personal', new RegExp(`\\bhow\\s+old\\s+(?:are|r|is)\\s+${YOU}\\b`)],
  ['personal', new RegExp(`\\b(?:are|r)\\s+${YOU}\\s+(?:alone|home\\s+alone|by\\s+yourself|a\\s+girl|a\\s+boy|single|cute|hot)\\b`)],
  ['personal', new RegExp(`\\bwhat\\s+do\\s+${YOU}\\s+look\\s+like\\b`)],
  ['personal', /\b(?:meet|meetup|meet\s+up|hang\s+out|link\s+up)\s+(?:irl|in\s+real\s+life|in\s+person|at\s+my|after\s+school)\b/],
  ['personal', /\b(?:come|go)\s+(?:to|over\s+to)\s+my\s+(?:house|place|room|home|car)\b/],
  ['personal', /\bmy\s+(?:address|house\s+is\s+(?:on|at)|number\s+is|phone\s+is|password\s+is)\b/],
  ['personal', /\bi\s*(?:m|am)\s+(?:\d{1,2}|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen)\s*(?:yo|years?\s+old|yrs?\s+old)\b/],
  ['personal', /\b(?:dont|do\s+not|don\s+t)\s+tell\s+(?:your|ur)\s+(?:parents|mom|dad|teacher|mum)\b/],
  ['personal', /\bour\s+(?:little\s+)?secret\b/],
  ['personal', /\bfree\s+(?:robux|vbucks|v\s+bucks|coins|skins)\b/],
  // drugs / alcohol
  ['drugs', /\b(?:get|getting|got|gettin)\s+(?:high|stoned|drunk|wasted|faded)\b/],
  ['drugs', /\bsmok(?:e|ing|ed)\s+(?:weed|pot|a\s+blunt|crack|meth|a\s+joint|dope|cigs?|cigarettes?)\b/],
  ['drugs', /\b(?:do|doing|did|sell|selling)\s+(?:drugs|coke|crack|meth|weed|lines)\b/],
];

// ------------------------------------------------------------------ normalising
const HOMOGLYPH = {
  а: 'a', в: 'b', с: 'c', е: 'e', ё: 'e', һ: 'h', і: 'i', ї: 'i', ј: 'j', к: 'k', м: 'm', н: 'h', о: 'o', р: 'p', ѕ: 's',
  т: 't', у: 'y', х: 'x', ԁ: 'd', ɡ: 'g', ԛ: 'q', ԝ: 'w', ү: 'y', и: 'n', п: 'n', г: 'r', л: 'n', ц: 'u', ч: 'y', ш: 'w',
  щ: 'w', ь: 'b', ъ: 'b', я: 'r', д: 'd', ж: 'x',
  α: 'a', β: 'b', γ: 'y', δ: 'd', ε: 'e', ζ: 'z', η: 'n', θ: 'o', ι: 'i', κ: 'k', λ: 'l', μ: 'u', ν: 'v', ξ: 'e',
  ο: 'o', π: 'n', ρ: 'p', σ: 'o', ς: 's', τ: 't', υ: 'u', φ: 'o', χ: 'x', ψ: 'y', ω: 'w',
  ß: 'ss', æ: 'ae', œ: 'oe', ø: 'o', đ: 'd', ł: 'l', ı: 'i', ɪ: 'i', ʏ: 'y', ᴀ: 'a', ʙ: 'b', ᴄ: 'c', ᴅ: 'd', ᴇ: 'e',
  ꜰ: 'f', ɢ: 'g', ʜ: 'h', ᴊ: 'j', ᴋ: 'k', ʟ: 'l', ᴍ: 'm', ɴ: 'n', ᴏ: 'o', ᴘ: 'p', ʀ: 'r', ꜱ: 's', ᴛ: 't', ᴜ: 'u',
  ᴠ: 'v', ᴡ: 'w', ᴢ: 'z', '€': 'e', '£': 'l', '¥': 'y', '¢': 'c', '©': 'c', '®': 'r', '¡': 'i', ǝ: 'e',
};
// leetspeak: two readings for 1 | ! (i or l)
const LEET_I = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 6: 'g', 7: 't', 8: 'b', 9: 'g', '@': 'a', $: 's', '!': 'i', '|': 'i', '+': 't', '(': 'c', '#': 'h' };
const LEET_L = { ...LEET_I, 1: 'l', '|': 'l', '!': 'l' };
const LEET_CHARS = /[^a-z0-9@$!|+(#]+/;

/** Lower case, compatibility forms (fullwidth, bold, circled...), no accents, look-alikes mapped. */
function fold(s) {
  let out = '';
  for (let ch of String(s).normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase()) {
    const cp = ch.codePointAt(0);
    if (cp >= 0x1f1e6 && cp <= 0x1f1ff) ch = String.fromCharCode(97 + cp - 0x1f1e6); // 🇦 regional indicator letters
    out += HOMOGLYPH[ch] || ch;
  }
  return out;
}

/** One token -> letters only, leet read with `map`, stretched letters cut to two. */
function letters(token, map) {
  let out = '';
  for (const ch of token) out += map[ch] || ch;
  return out.replace(/[^a-z]/g, '').replace(/(.)\1{2,}/g, '$1$1');
}

/** The spellings to test for one token: each leet reading, plus every double letter made single. */
function tokenForms(token) {
  // "45s", "100hp", "2nd", "3v3": numbers, not leetspeak ("45s" is not "ass")
  if (/^\d+(?:s|m|k|x|p|hp|st|nd|rd|th|ms|fps|min|sec|v\d+)?$/.test(token)) return [];
  const forms = new Set();
  for (const map of [LEET_I, LEET_L]) {
    const t = letters(token, map);
    if (!t) continue;
    forms.add(t);
    forms.add(t.replace(/(.)\1+/g, '$1'));
  }
  return [...forms];
}

const EXACT_SET = new Map();
for (const [cat, words] of Object.entries(EXACT)) for (const w of words) if (!EXACT_SET.has(w)) EXACT_SET.set(w, cat);
// app names and drug words only matter in chat; a username can be "Snapper" or "Weedle"
const NAME_SKIP = new Set(['personal', 'drugs']);

/** Category of one bad word form, or null. */
function wordCategory(form, forName = false) {
  for (const f of [form, form.replace(/(?:es|s|z)$/, '')]) {
    const cat = EXACT_SET.get(f);
    if (cat && !(forName && NAME_SKIP.has(cat))) return cat;
  }
  for (const [cat, list] of Object.entries(STEMS)) {
    if (forName && NAME_SKIP.has(cat)) continue;
    for (const re of list) if (re.test(form)) return cat;
  }
  return null;
}

function tokenCategory(token, forName = false) {
  if (/^who['’]re$/.test(token)) return null; // "who're" is not "whore"
  for (const f of tokenForms(token)) {
    const cat = wordCategory(f, forName);
    if (cat) return cat;
  }
  return null;
}

// 🍆 🖕 🔞 卐 卍, or 🍑 together with 💦 / 👅
const BAD_EMOJI = /[\u{1F346}\u{1F595}\u{1F51E}\u5350\u534D]|\u{1F351}.*[\u{1F4A6}\u{1F445}]|[\u{1F4A6}\u{1F445}].*\u{1F351}/u;

/** Why `text` (one cleaned line) is not kid-friendly, as a category name, or null when it is fine. */
export function moderate(text) {
  if (BAD_EMOJI.test(text)) return /[\u5350\u534D]/.test(text) ? 'slur' : 'sexual';
  const folded = fold(text);
  for (const num of folded.match(/\d+/g) || []) if (BAD_NUMBERS.has(num)) return BAD_NUMBERS.get(num);
  const raw = folded.split(/\s+/).filter(Boolean);

  // 1) every word on its own, and its pieces between symbols ("big_ass", "fuck.you")
  for (const t of raw) {
    const cat = tokenCategory(t);
    if (cat) return cat;
    for (const part of t.split(LEET_CHARS)) {
      const pc = part && part !== t ? tokenCategory(part) : null;
      if (pc) return pc;
    }
  }

  // 2) words split up: runs of short pieces glued ("f u c k", "fu ck") and neighbouring pairs ("nig ger")
  const forms = raw.map((t) => letters(t, LEET_I)).filter(Boolean);
  for (let i = 0; i < forms.length; i++) {
    let glued = forms[i];
    for (let j = i + 1; j < forms.length && j - i < 14; j++) {
      glued += forms[j];
      const shortRun = forms.slice(i, j + 1).every((f) => f.length <= 2);
      if (!shortRun && j > i + 1) break;
      const once = glued.replace(/(.)\1+/g, '$1');
      if (shortRun && j - i >= 2) {
        const cat = wordCategory(glued) || wordCategory(once);
        if (cat) return cat;
      }
      for (const [re, cat] of SEVERE_GLUE) if (re.test(glued) || re.test(once)) return cat;
    }
  }

  // 3) phrases: on the words as typed, and with single letters joined ("s e n d n u d e s")
  const joined = [];
  let run = '';
  for (const f of forms) {
    if (f.length === 1) run += f;
    else {
      if (run) joined.push(run);
      run = '';
      joined.push(f);
    }
  }
  if (run) joined.push(run);
  const typed = ' ' + folded.replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ') + ' '; // keeps numbers ("im 12 yo")
  const lines = [' ' + forms.join(' ') + ' ', ' ' + joined.join(' ') + ' ', typed];
  for (const [cat, re] of PHRASES) if (lines.some((l) => re.test(l))) return cat;
  // written with no spaces at all ("killurself", "sendnudes")
  const glued = joined.join('');
  for (const re of STEMS.selfharm) if (re.test(glued)) return 'selfharm';
  if (/sendnudes|sendnoods|deeznuts/.test(glued)) return 'sexual';
  return null;
}

// ------------------------------------------------------------------ chat
const LINK = /(https?:\/\/|www\.|discord\.gg|\b[a-z0-9-]{2,}\s*(\.|\(dot\)|\[dot\])\s*(com|net|org|gg|io|xyz|ly|me|co|tv|app|link|site|us|info|dev)\b)/i;
const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/;
const PHONE = /(\d[\s.-]?){7,}/;

export function cleanChat(raw) {
  let text = String(raw == null ? '' : raw)
    .replace(/[\u0000-\u001f\u007f\u00ad\u034f\u180e\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return { ok: false, reason: 'empty' };
  if (text.length > CHAT_MAX) text = text.slice(0, CHAT_MAX).trim();
  if (LINK.test(text) || LINK.test(fold(text))) return { ok: false, reason: 'No links in chat.', category: 'personal' };
  if (EMAIL.test(text)) return { ok: false, reason: 'No e-mail addresses in chat.', category: 'personal' };
  if (PHONE.test(text)) return { ok: false, reason: 'No phone numbers in chat.', category: 'personal' };
  // shouting: mostly capitals in a longer message -> lower case
  const caps = text.replace(/[^A-Za-z]/g, '');
  if (caps.length >= 8 && caps.replace(/[^A-Z]/g, '').length / caps.length > 0.7) text = text.toLowerCase();
  text = text.replace(/(.)\1{4,}/gu, '$1$1$1');
  const category = moderate(text);
  if (category) return { ok: false, reason: REASONS[category], category };
  return { ok: true, text };
}

// ------------------------------------------------------------------ names
/**
 * True when a player / account name is kid-friendly. Checks the whole name and its parts split
 * on spaces, _ - . and camelCase ("xX_Ass_Xx", "BigAss").
 */
export function nameIsClean(name) {
  const s = String(name == null ? '' : name);
  if (!s) return true;
  if (BAD_EMOJI.test(s)) return false;
  for (const num of s.match(/\d+/g) || []) if (BAD_NUMBERS.has(num) && num !== '420') return false;
  const parts = [s, ...s.split(/[\s_.-]+|(?<=[a-z])(?=[A-Z])/)];
  for (const p of parts) if (p && tokenCategory(fold(p), true)) return false;
  return true;
}
