// The browser must still send a match result when it has no match ticket (for example when the
// account server was deployed before `matchStart` existed and answers "Unknown request.").
// The server decides whether a result without a ticket counts (party/matchStats.js settleMatch).
import test from 'node:test';
import assert from 'node:assert/strict';

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
globalThis.WebSocket = class {
  constructor() {
    this.readyState = 0;
  }
  send() {}
  close() {}
};
if (!globalThis.location) globalThis.location = { hostname: 'localhost', host: 'localhost:5173', protocol: 'http:', search: '' };

const calls = [];
let matchStartReply = { status: 400, body: { error: 'Unknown request.' } };
const profile = { name: 'tester', coins: 0, owned: [], equipped: {}, friends: [], incoming: [], outgoing: [], stats: { matches: 0, wins: 0, kills: 0 } };
globalThis.fetch = async (_url, opts) => {
  const body = JSON.parse(opts.body);
  calls.push(body);
  let status = 200;
  let out = { profile };
  if (body.op === 'login') out = { token: 'a'.repeat(48), profile };
  if (body.op === 'matchStart') ({ status, body: out } = matchStartReply);
  if (body.op === 'reward') out = { profile, earned: 10, ranked: true };
  return { ok: status < 400, status, json: async () => out };
};

const { createAccount } = await import('../src/net/Account.js');

async function signedIn() {
  const acct = createAccount();
  await acct.login('tester', 'password123');
  assert.equal(acct.signedIn, true);
  return acct;
}

test('an old server that rejects matchStart still gets the result', async () => {
  calls.length = 0;
  matchStartReply = { status: 400, body: { error: 'Unknown request.' } };
  const acct = await signedIn();
  acct.matchStart();
  const out = await acct.reward({ kills: 3, placement: 5, players: 50, won: false, ranked: true });
  assert.equal(out.saved, true, out.error);
  const sent = calls.find((c) => c.op === 'reward');
  assert.ok(sent, 'reward was sent');
  assert.equal('matchId' in sent, false);
});

test('the ticket from matchStart is sent with the result, once', async () => {
  calls.length = 0;
  matchStartReply = { status: 200, body: { matchId: 'abc123' } };
  const acct = await signedIn();
  acct.matchStart();
  await acct.reward({ kills: 1, placement: 9, players: 50, ranked: true });
  await acct.reward({ kills: 1, placement: 9, players: 50, ranked: true });
  const sent = calls.filter((c) => c.op === 'reward');
  assert.equal(sent[0].matchId, 'abc123');
  assert.equal('matchId' in sent[1], false, 'a ticket is used once');
});
