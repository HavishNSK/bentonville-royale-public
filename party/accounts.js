// BENTONVILLE ROYALE — account server (PartyServer on Cloudflare Workers, bound as `Accounts`
// in wrangler.jsonc). One Durable Object room ("global") holds every account.
//
// Accounts live in the room's durable storage:
//   user:<lowercase name>  -> { name, salt?, hash?, googleSub?, coins, owned:[ids], equipped:{skin, emotes:[6]},
//                               friends:[lower], incoming:[lower], outgoing:[lower],
//                               stats:{matches, wins, kills}, created, lastReward }
//   google:<sub>           -> lowercase username (Google GIS identity index; never reuse email as id)
//   sess:<token>           -> { u: lower, exp }
// Passwords are PBKDF2-SHA256 hashed (100k rounds, random 16-byte salt). OAuth accounts may omit salt/hash.
//
// HTTP:  POST /parties/accounts/global  {op, ...}  -> JSON
//   register {name, password} / login {name, password}   -> {token, profile}
//   googleLogin {idToken}                                 -> {token, profile}
//   leaderboard {}                                        -> {online, wins:[{name,wins,kills}], kills:[...]}
//   me {token}  logout {token}
//   rename {token, name}  only while profile.mustRename (the current name has a swear word / slur)
//   buy {token, item}   equip {token, skin?, emotes?}
//   reward {token, kills, placement, players, won, ranked} -> {profile, earned, ranked}
//   boxResult {token, size, won, score:[us,them], oppElo, forfeit?} -> {ok, elo, delta, tier, games} (429 {ok:false, rateLimited:true} when under 30 s apart)
//   adReward {token}                                      -> {profile, earned}  (rewarded ad; AD_REWARD_DAILY a day)
//     (wins/kills reach the boards only when ranked === true: a HARD match that includes bots)
//   friendAdd {token, name}  friendAccept {token, name}  friendDecline {token, name}  friendRemove {token, name}
//   invite {token, name, code}                            (delivered over the socket)
//   ackWarning {token}                                    clears a moderator warning once it was shown
// Moderation (party/moderation.js; moderation, not anti-cheat):
//   `reward` flags suspicious results for review (flags on the account + index key flagged:<lower>).
//   A banned account (profile.banned) gets 403 on everything but me / logout / ackWarning,
//   earns nothing and is hidden from the boards. Timed bans lift on their own.
//   Dev only (isDevName on the SESSION account, re-checked here):  -> {lines:[...]}
//     modBan {token, name, duration?, reason}  modWarn {token, name, reason}  modUnban {token, name}
//     modHistory {token, name}  modResetStats {token, name}  modFlags {token}
//     modReports {token}  modDismiss {token, name}   (player reports; a ban also clears them)
//     modTitle {token, name, title, color?, nameColor?}  modUntitle {token, name}   (dev-made titles; no powers)
//   report {token, name, reason, note}  any signed-in, unbanned player -> {ok}. Private: only devs see
//     reports (reports:<lower>). One per reporter per player per day, REPORTS_PER_DAY per reporter.
//   Every dev action is logged as modlog:<time> -> {by, cmd, target, reason?, duration?, at}.
// Suggestion / bug board (no account needed; signed-in posts carry the account name).
// Posts stay on fb:<id> so existing suggestions keep showing. Replies are an array on that record.
//   feedback {kind: 'idea'|'bug', text, token?, anon?}   -> {item}   (one post per IP per 30 s)
//   feedbackList {}                                       -> {items: newest first, max 60}
//   feedbackVote {id, token?, anon}                       -> {item}   (one vote per voter)
//   feedbackReply {id, text, token?, anon?}               -> {item}
//   feedbackDelete {id, replyId?, token}                  -> {ok} or {item}  (DEV accounts only)
// WebSocket: /parties/accounts/global?token=   presence + live friend updates
//   client -> server  {t:'status', s:'lobby'|'match', party?:CODE, skin?}
//   server -> client  {t:'friends', list:[{name, online, status, skin}], incoming:[names], outgoing:[names]}
//                     {t:'invite', from, code}  {t:'request', from}  {t:'profile', profile}
// The shop catalog's prices are mirrored here (PRICES) so a client cannot buy for free.

import { Server, getServerByName } from 'partyserver';
import { PRICES, DEFAULT_OWNED, DEFAULT_EQUIPPED, EMOTE_SLOTS, PICKAXES, BACKBLINGS } from '../src/game/Cosmetics.js';
import { verifyGoogleIdToken } from './googleIdToken.js';
import { applyMatchStats } from './matchStats.js';
import { boxStats, validateBoxResult, applyBoxResult, boxRateLimited, boxFlags } from './boxRating.js';
import { tierOf } from '../src/game/BoxElo.js';
import { nameIsClean } from '../src/net/chatFilter.js';
import { publicItem, sanitizeFeedbackText, addReply, removeReply, canModerateFeedback, feedbackKind } from '../src/net/feedbackBoard.js';
import { isDevName, customTitleProblem } from '../src/net/devs.js';
import { createLimiter, passwordProblem, modAuthFresh, originAllowed, secLogEntry } from './authLimits.js';
import {
  BAN_LABEL,
  rewardFlags,
  trackRanked,
  addFlag,
  applyBan,
  liftBan,
  applyWarn,
  isBanned,
  banInfo,
  PERMA_BANNED,
  REPORT_REASONS,
  cleanReport,
  addReport,
  reporterAllowance,
} from './moderation.js';

const START_COINS = 1500;
const SESSION_DAYS = 30;
// SECURITY TODO: OWASP asks for Argon2id (or PBKDF2-SHA256 at 600k rounds). Cloudflare Workers' Web
// Crypto caps PBKDF2 at 100,000 iterations, so this is the platform maximum. Moving to Argon2id needs
// a vetted WASM library (a new dependency to review) plus rehash-on-login. Login rate limits
// (authLimits.js) are the compensating control.
const PBKDF2_ROUNDS = 100000;
const MAX_SESSIONS = 10; // per account; the oldest is signed out when an 11th device signs in
const SECLOG_KEEP = 500; // newest security-log rows kept (seclog:<time>)
const MAX_FRIENDS = 100;
const BOX_BOARD_TOP = 25;
const BOX_BOARD_MIN_GAMES = 10; // games needed to be listed on the Box Fights board
const REWARD_GAP_MS = 60 * 1000; // at most one match reward per minute per account
// Rewarded ads (src/net/Ads.js): coins for watching an ad to the end. The server can't see the
// ad itself, so it caps how often the client may claim: AD_REWARD_DAILY per UTC day, one per gap.
export const AD_REWARD_COINS = 100;
export const AD_REWARD_DAILY = 5;
const AD_REWARD_GAP_MS = 20 * 1000;

/** Rewarded-ad claims left today for `acc` (resets at UTC midnight). */
function adRewardsLeft(acc, now = Date.now()) {
  const day = new Date(now).toISOString().slice(0, 10);
  return acc.adDay === day ? Math.max(0, AD_REWARD_DAILY - (acc.adCount | 0)) : AD_REWARD_DAILY;
}
const LEADERBOARD_TOP = 25;
// Display pad for "players online" (real signed-in sockets + this). Product request for traction.
const ONLINE_DISPLAY_PAD = 5;

const enc = new TextEncoder();
const hex = (buf) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
const randHex = (n) => hex(crypto.getRandomValues(new Uint8Array(n)));

async function hashPassword(password, saltHex) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const salt = new Uint8Array(saltHex.match(/../g).map((h) => parseInt(h, 16)));
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: PBKDF2_ROUNDS }, key, 256);
  return hex(bits);
}

/** Constant-time string compare. */
function same(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

/** 3-16 letters, digits, _ or - */
export function validName(name) {
  return typeof name === 'string' && /^[A-Za-z0-9_-]{3,16}$/.test(name);
}

function err(text, status = 400) {
  return json({ error: text }, status);
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      'access-control-allow-origin': '*',
      'access-control-allow-headers': 'content-type',
      'access-control-allow-methods': 'POST, GET, OPTIONS',
    },
  });
}

/**
 * Accounts made before a cosmetic slot existed: give them the free defaults (new free items,
 * the default pickaxe / back bling). Mutates `acc`; saved with the next write.
 */
function upgradeAccount(acc) {
  for (const id of DEFAULT_OWNED) if (!acc.owned.includes(id)) acc.owned.push(id);
  const eq = (acc.equipped = acc.equipped || {});
  if (!eq.skin) eq.skin = DEFAULT_EQUIPPED.skin;
  if (!Array.isArray(eq.emotes)) eq.emotes = DEFAULT_EQUIPPED.emotes.slice();
  if (!PICKAXES[eq.pickaxe] || !acc.owned.includes(eq.pickaxe)) eq.pickaxe = DEFAULT_EQUIPPED.pickaxe;
  if (!BACKBLINGS[eq.backbling] || !acc.owned.includes(eq.backbling)) eq.backbling = DEFAULT_EQUIPPED.backbling;
  return acc;
}

/** Box Fights ladder numbers shown to the owner (defaults for accounts that never played). */
function boxPublic(acc) {
  const b = boxStats(acc);
  return { elo: b.elo, games: b.games, wins: b.wins, peak: b.peak, tier: tierOf(b.elo) };
}

/** What the owner sees about their own account. */
function profileOf(acc) {
  upgradeAccount(acc);
  return {
    name: acc.name,
    coins: acc.coins,
    owned: acc.owned,
    equipped: acc.equipped,
    friends: acc.friends.slice(),
    incoming: acc.incoming.slice(),
    outgoing: acc.outgoing.slice(),
    stats: acc.stats,
    box: boxPublic(acc),
    adRewardsLeft: adRewardsLeft(acc),
    // a name made before the username filter: the client blocks play until it is renamed
    mustRename: !nameIsClean(acc.name),
    // moderation: {reason, until, permanent, label} while banned; a one-time warning {reason, at}
    banned: banInfo(acc, Date.now()),
    warning: acc.warning ? { reason: acc.warning.reason, at: acc.warning.at } : null,
    // dev-made title (public; presence re-checks it before showing it)
    title: acc.title ? { title: acc.title.title, color: acc.title.color || null, nameColor: acc.title.nameColor || null } : null,
  };
}

const MOD_OPS = new Set(['modBan', 'modWarn', 'modUnban', 'modHistory', 'modResetStats', 'modFlags', 'modReports', 'modDismiss', 'modTitle', 'modUntitle']);
const MOD_FLAGS_LISTED = 10;

/** "3 h", "2 d", "15 min" until `until`. */
function timeLeft(until, now) {
  const min = Math.max(1, Math.ceil((until - now) / 60e3));
  if (min < 60) return `${min} min`;
  const h = Math.ceil(min / 60);
  return h < 48 ? `${h} h` : `${Math.ceil(h / 24)} d`;
}

const day = (ms) => new Date(ms).toISOString().slice(0, 10);

export class Accounts extends Server {
  constructor(ctx, env) {
    super(ctx, env);
    this.online = new Map(); // lower name -> Set(connection id)
    this.status = new Map(); // lower name -> { s, party, skin }
    this.limiter = createLimiter(); // login-failure + sign-up throttles (in memory)
    this.secLogWrites = 0;
  }

  /** One security-log row (sanitized, no tokens/passwords); keeps the newest SECLOG_KEEP. */
  async _secLog(type, fields) {
    const now = Date.now();
    await this.ctx.storage.put('seclog:' + String(now).padStart(14, '0') + randHex(2), secLogEntry(type, fields, now));
    if (++this.secLogWrites % 50 !== 0) return;
    const keys = [...(await this.ctx.storage.list({ prefix: 'seclog:' })).keys()];
    if (keys.length > SECLOG_KEEP) await this.ctx.storage.delete(keys.slice(0, keys.length - SECLOG_KEEP));
  }

  // ---------------------------------------------------------------- storage

  async _acc(lower) {
    return lower ? (await this.ctx.storage.get('user:' + lower)) || null : null;
  }

  async _save(acc) {
    await this.ctx.storage.put('user:' + acc.name.toLowerCase(), acc);
  }

  async _session(token) {
    if (typeof token !== 'string' || !/^[a-f0-9]{48}$/.test(token)) return null;
    const s = await this.ctx.storage.get('sess:' + token);
    if (!s || s.exp < Date.now()) return null;
    const acc = await this._acc(s.u);
    if (acc) return acc;
    // the account was renamed (forced rename of a bad name): follow it and fix this session
    const to = await this.ctx.storage.get('renamed:' + s.u);
    const moved = to ? await this._acc(to) : null;
    if (moved) await this.ctx.storage.put('sess:' + token, { ...s, u: to });
    return moved;
  }

  /** A new session after a real sign-in (authAt: dev commands need a recent one). */
  async _newSession(acc) {
    const token = randHex(24);
    const lower = acc.name.toLowerCase();
    const now = Date.now();
    await this.ctx.storage.put('sess:' + token, { u: lower, exp: now + SESSION_DAYS * 864e5, authAt: now });
    // per-account session index: lets "sign out everywhere" work and caps devices per account
    const list = ((await this.ctx.storage.get('sessions:' + lower)) || []).concat(token);
    const drop = list.length > MAX_SESSIONS ? list.splice(0, list.length - MAX_SESSIONS) : [];
    if (drop.length) await this.ctx.storage.delete(drop.map((t) => 'sess:' + t));
    await this.ctx.storage.put('sessions:' + lower, list);
    return token;
  }

  /** Sign this account out on every device. */
  async _endAllSessions(lower) {
    const list = (await this.ctx.storage.get('sessions:' + lower)) || [];
    if (list.length) await this.ctx.storage.delete(list.map((t) => 'sess:' + t));
    await this.ctx.storage.delete('sessions:' + lower);
    return list.length;
  }

  /** Pick a free username from a Google display name / email local-part. */
  async _uniqueGoogleName(claims) {
    const raw = String(claims.given_name || claims.name || (claims.email && claims.email.split('@')[0]) || 'Player');
    let base = raw.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 12);
    if (!validName(base) || !nameIsClean(base)) base = 'Player';
    if (!(await this._acc(base.toLowerCase()))) return base;
    for (let i = 0; i < 8; i++) {
      const cand = (base.slice(0, 12) + randHex(2)).slice(0, 16);
      if (validName(cand) && nameIsClean(cand) && !(await this._acc(cand.toLowerCase()))) return cand;
    }
    const fallback = ('Player' + randHex(4)).slice(0, 16);
    return validName(fallback) ? fallback : 'Player' + randHex(3).slice(0, 3);
  }

  _googleRateOk() {
    const now = Date.now();
    if (!this._googleHits) this._googleHits = [];
    this._googleHits = this._googleHits.filter((t) => now - t < 60_000);
    if (this._googleHits.length >= 30) return false;
    this._googleHits.push(now);
    return true;
  }

  async _googleLogin(m) {
    const clientId = this.env && this.env.GOOGLE_CLIENT_ID;
    if (!clientId) return err('Google sign-in is not configured on the server.', 503);
    if (!this._googleRateOk()) return err('Too many Google sign-in attempts. Wait a minute.', 429);
    let claims;
    try {
      claims = await verifyGoogleIdToken(String(m.idToken || ''), clientId);
    } catch {
      return err('Google sign-in failed. Try again.', 401);
    }
    // Only treat Google as authoritative when email is verified (or absent — still bind on sub).
    if (claims.email && claims.email_verified !== true) {
      return err('Verify your Google email, then try again.', 401);
    }
    const gKey = 'google:' + claims.sub;
    const linked = await this.ctx.storage.get(gKey);
    let acc = linked ? await this._acc(linked) : null;
    if (linked && !acc) {
      await this.ctx.storage.delete(gKey);
    }
    if (!acc) {
      const name = await this._uniqueGoogleName(claims);
      if (!validName(name)) return err('Could not create a username from your Google account.', 500);
      acc = {
        name,
        salt: null,
        hash: null,
        googleSub: claims.sub,
        coins: START_COINS,
        owned: DEFAULT_OWNED.slice(),
        equipped: { ...DEFAULT_EQUIPPED, emotes: DEFAULT_EQUIPPED.emotes.slice() },
        friends: [],
        incoming: [],
        outgoing: [],
        stats: { matches: 0, wins: 0, kills: 0 },
        created: Date.now(),
        lastReward: 0,
      };
      await this._save(acc);
      await this.ctx.storage.put(gKey, acc.name.toLowerCase());
    } else if (acc.googleSub && acc.googleSub !== claims.sub) {
      return err('Google sign-in failed. Try again.', 401);
    } else if (!acc.googleSub) {
      // Index pointed at a password account without googleSub — refuse auto-link (takeover risk).
      await this.ctx.storage.delete(gKey);
      return err('Google sign-in failed. Try again.', 401);
    }
    return json({ token: await this._newSession(acc), profile: profileOf(acc) });
  }

  /** Public boards for signed-in accounts only (guests never appear). */
  // ---------------------------------------------------------------- moderation

  /** Dev moderation ops. `dev` is the session account; dev rights are checked here, not trusted from presence. */
  async _mod(dev, m, ip = 'local') {
    if (!isDevName(dev.name)) {
      await this._secLog('mod_denied', { user: dev.name, ip, detail: m.op });
      return err('Only developers can use that.', 403);
    }
    const now = Date.now();
    // SECURITY TODO: no MFA for dev accounts yet; a recent real sign-in is required instead.
    if (!modAuthFresh(await this.ctx.storage.get('sess:' + m.token), now)) {
      return err('For safety, sign out and sign in again to use dev commands (needed every 12 hours).', 403);
    }
    const reply = (lines, extra = {}) => json({ lines: [].concat(lines), ...extra });

    if (m.op === 'modFlags') return reply(await this._flagLines());
    if (m.op === 'modReports') return reply(await this._reportLines());
    if (m.op === 'modDismiss') {
      const key = 'reports:' + String(m.name || '').trim().toLowerCase();
      const rec = await this.ctx.storage.get(key);
      if (!rec) return reply(`No reports for ${String(m.name || '').slice(0, 16)}.`);
      await this.ctx.storage.delete(key);
      await this.ctx.storage.put('modlog:' + String(now).padStart(14, '0') + randHex(2), { by: dev.name, cmd: 'dismiss', target: rec.name, at: now });
      return reply(`Dismissed ${rec.total | 0} report(s) for ${rec.name}.`);
    }

    const target = await this._acc(String(m.name || '').trim().toLowerCase());
    if (!target) return err('No player with that username.', 404);
    const lower = target.name.toLowerCase();
    const reason = String(m.reason || '').trim().slice(0, 100);
    const log = (cmd, extra = {}) =>
      this.ctx.storage.put('modlog:' + String(now).padStart(14, '0') + randHex(2), { by: dev.name, cmd, target: target.name, at: now, ...extra });

    switch (m.op) {
      case 'modBan': {
        if (!reason) return err('Add a reason.');
        if (isDevName(target.name)) return err('Developer accounts cannot be banned here.');
        let next;
        try {
          next = applyBan(target, { by: dev.name, reason, duration: m.duration || undefined, now });
        } catch {
          return err('Durations are 1h, 1d, 1w, 1mo or perm.');
        }
        await this._save(next);
        await log('ban', { reason, duration: next.ban.duration });
        await this._secLog('ban', { by: dev.name, target: target.name, reason, detail: next.ban.duration });
        await this.ctx.storage.delete('reports:' + lower); // handled
        this._push(lower, { t: 'profile', profile: profileOf(next) });
        await this._notifyPresence({ target: lower, banned: true });
        const span = next.ban.until == null ? 'permanently' : `for ${BAN_LABEL[next.ban.duration]}`;
        return reply(`Banned ${target.name} ${span} (offence ${next.offences}): ${reason}`, { target: lower, banned: true });
      }
      case 'modWarn': {
        if (!reason) return err('Add a reason.');
        const next = applyWarn(target, { by: dev.name, reason, now });
        await this._save(next);
        await log('warn', { reason });
        this._push(lower, { t: 'profile', profile: profileOf(next) });
        return reply(`Warned ${target.name}: ${reason}`, { target: lower });
      }
      case 'modUnban': {
        if (PERMA_BANNED[lower]) return err(`${target.name} is permanently banned in the code (party/moderation.js PERMA_BANNED) and cannot be unbanned from chat.`);
        if (!isBanned(target, now)) return reply(`${target.name} is not banned.`, { target: lower, banned: false });
        const next = liftBan(target, { by: dev.name, now });
        await this._save(next);
        await log('unban');
        await this._secLog('unban', { by: dev.name, target: target.name });
        this._push(lower, { t: 'profile', profile: profileOf(next) });
        await this._notifyPresence({ target: lower, banned: false });
        return reply(`Unbanned ${target.name}. Their next ban still escalates (offences: ${next.offences | 0}).`, { target: lower, banned: false });
      }
      case 'modResetStats': {
        const next = { ...target, stats: { ...target.stats, wins: 0, kills: 0 }, modTrack: undefined, box: undefined };
        await this._save(next);
        await log('resetstats');
        return reply(`Reset ${target.name}'s ranked wins and kills to 0.`, { target: lower });
      }
      case 'modHistory':
        return reply(await this._historyWithReports(target, now), { target: lower });
      case 'modTitle': {
        const title = String(m.title || '').trim().toUpperCase();
        const bad = customTitleProblem(title);
        if (bad) return err(bad);
        if (!nameIsClean(title)) return err('That title is not allowed.');
        const hex = (c) => (typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c) ? c.toLowerCase() : null);
        const color = hex(m.color);
        const nameColor = hex(m.nameColor); // optional separate username colour
        const next = { ...target, title: { title, color, nameColor, by: dev.name, at: now } };
        await this._save(next);
        await log('title', { reason: title });
        this._push(lower, { t: 'profile', profile: profileOf(next) });
        await this._notifyPresence({ target: lower, title: { title, color, nameColor } });
        const tints = [color && `title ${color}`, nameColor && `name ${nameColor}`].filter(Boolean).join(', ');
        return reply(`${target.name} now has the title [${title}]${tints ? ` (${tints})` : ''}.`, { target: lower, title: { title, color, nameColor } });
      }
      case 'modUntitle': {
        if (!target.title) return reply(`${target.name} has no custom title.`);
        const next = { ...target, title: null };
        await this._save(next);
        await log('untitle');
        this._push(lower, { t: 'profile', profile: profileOf(next) });
        await this._notifyPresence({ target: lower, title: null });
        return reply(`Removed ${target.name}'s title.`, { target: lower, title: null });
      }
    }
    return err('Unknown request.');
  }

  /** Tell the presence server (chat + online list) about a ban or title change, so it shows at once. */
  async _notifyPresence(update) {
    try {
      if (!this.env || !this.env.Presence) return;
      const stub = await getServerByName(this.env.Presence, 'global');
      await stub.fetch(
        new Request('https://presence/global', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ t: 'account', ...update }),
        })
      );
    } catch (e) {
      console.warn('[accounts] presence update failed', e && e.message); // it catches up on reconnect
    }
  }

  _historyLines(acc, now) {
    const b = banInfo(acc, now);
    const s = acc.stats || {};
    const lines = [
      `${acc.name}: ${b ? `BANNED (${b.permanent ? 'permanent' : `${timeLeft(b.until, now)} left`})` : 'not banned'}, ` +
        `offences ${acc.offences | 0}, flags ${acc.flagCount | 0}, ranked ${s.wins | 0} wins / ${s.kills | 0} kills, box ${boxStats(acc).elo} elo / ${boxStats(acc).games} games`,
    ];
    for (const h of (acc.banHistory || []).slice(-5)) {
      const what = h.type === 'ban' ? `ban ${BAN_LABEL[h.duration] || ''}` : h.type;
      lines.push(`${day(h.at)} ${what} by ${h.by}${h.reason ? `: ${h.reason}` : ''}`);
    }
    for (const f of (acc.flags || []).slice(-5)) lines.push(`${day(f.at)} flag: ${f.why}`);
    return lines;
  }

  /** History lines plus the player's open reports. */
  async _historyWithReports(acc, now) {
    const lines = this._historyLines(acc, now);
    const rec = await this.ctx.storage.get('reports:' + acc.name.toLowerCase());
    if (rec) {
      lines.push(`${rec.total | 0} open report(s):`);
      for (const r of rec.list.slice(-5)) lines.push(`${day(r.at)} ${REPORT_REASONS[r.reason] || r.reason} (by ${r.by})${r.note ? `: ${r.note}` : ''}`);
    }
    return lines;
  }

  async _reportLines() {
    const listed = await this.ctx.storage.list({ prefix: 'reports:' });
    const rows = [...listed.values()].filter((r) => r && Array.isArray(r.list) && r.list.length);
    if (!rows.length) return ['No open reports.'];
    rows.sort((a, b) => b.list.at(-1).at - a.list.at(-1).at);
    return rows.slice(0, MOD_FLAGS_LISTED).map((r) => {
      const counts = {};
      for (const x of r.list) counts[x.reason] = (counts[x.reason] | 0) + 1;
      const why = Object.entries(counts)
        .map(([k, n]) => `${REPORT_REASONS[k] || k}${n > 1 ? ` x${n}` : ''}`)
        .join(', ');
      const last = r.list.at(-1);
      return `${r.name}${r.known ? '' : ' [no account with this name]'}: ${r.total | 0} report(s) (${why})${last.note ? `, latest: "${last.note}"` : ''}`;
    });
  }

  /** A player report (private: only devs read it). */
  async _report(acc, m) {
    const r = cleanReport(m);
    if (r.error) return err(r.error);
    const lower = acc.name.toLowerCase();
    const targetLower = r.name.toLowerCase();
    if (targetLower === lower) return err('You can’t report yourself.');
    const now = Date.now();
    const allow = reporterAllowance(acc, now);
    if (!allow.ok) return err('You’ve sent a lot of reports today. Try again tomorrow.', 429);
    const target = await this._acc(targetLower);
    const key = 'reports:' + targetLower;
    const rec = addReport(await this.ctx.storage.get(key), {
      target: target ? target.name : r.name,
      known: !!target,
      by: lower,
      reason: r.reason,
      note: r.note,
      now,
    });
    if (rec.error) return err(rec.error, 429);
    await this.ctx.storage.put(key, rec);
    await this._save(allow.acc);
    return json({ ok: true, text: `Thanks. Your report on ${rec.name} was sent to the developers.` });
  }

  async _flagLines() {
    const keys = await this.ctx.storage.list({ prefix: 'flagged:' });
    const rows = [];
    for (const key of keys.keys()) {
      const acc = await this._acc(key.slice('flagged:'.length));
      if (!acc || !Array.isArray(acc.flags) || !acc.flags.length) continue;
      rows.push(acc);
    }
    rows.sort((a, b) => b.flags.at(-1).at - a.flags.at(-1).at);
    if (!rows.length) return ['No flagged accounts.'];
    const now = Date.now();
    return rows.slice(0, MOD_FLAGS_LISTED).map((a) => {
      const f = a.flags.at(-1);
      return `${a.name}${isBanned(a, now) ? ' [banned]' : ''}: ${a.flagCount | 0} flags, latest ${day(f.at)} ${f.why}`;
    });
  }

  async _leaderboard() {
    const listed = await this.ctx.storage.list({ prefix: 'user:' });
    const rows = [];
    const boxRows = [];
    const now = Date.now();
    for (const acc of listed.values()) {
      if (!acc || typeof acc !== 'object' || !acc.name || !acc.stats) continue;
      const wins = Math.max(0, acc.stats.wins | 0);
      const kills = Math.max(0, acc.stats.kills | 0);
      if (!nameIsClean(acc.name)) continue; // hidden from the boards until renamed
      if (isBanned(acc, now)) continue; // banned accounts are hidden while the ban lasts
      rows.push({ name: String(acc.name).slice(0, 16), wins, kills });
      const bx = boxStats(acc);
      if (bx.games >= BOX_BOARD_MIN_GAMES) boxRows.push({ name: String(acc.name).slice(0, 16), elo: bx.elo, games: bx.games, tier: tierOf(bx.elo) });
    }
    const byElo = boxRows.sort((a, b) => b.elo - a.elo || b.games - a.games || a.name.localeCompare(b.name)).slice(0, BOX_BOARD_TOP);
    const byWins = rows
      .slice()
      .sort((a, b) => b.wins - a.wins || b.kills - a.kills || a.name.localeCompare(b.name))
      .slice(0, LEADERBOARD_TOP);
    const byKills = rows
      .slice()
      .sort((a, b) => b.kills - a.kills || b.wins - a.wins || a.name.localeCompare(b.name))
      .slice(0, LEADERBOARD_TOP);
    return json({
      online: this.online.size + ONLINE_DISPLAY_PAD,
      wins: byWins,
      kills: byKills,
      box: byElo,
    });
  }

  // ---------------------------------------------------------------- HTTP API

  async onRequest(req) {
    const origin = req.headers.get('origin');
    const allowed = originAllowed(origin, this.env && this.env.ALLOWED_ORIGINS);
    const res = await this._handle(req, allowed);
    // CORS: echo only an allowed Origin (never *)
    res.headers.delete('access-control-allow-origin');
    if (origin && allowed) {
      res.headers.set('access-control-allow-origin', origin);
      res.headers.set('vary', 'Origin');
    }
    return res;
  }

  async _handle(req, allowed) {
    if (!allowed) return err('Forbidden.', 403);
    if (req.method === 'OPTIONS') return json({});
    if (req.method !== 'POST') return json({ ok: true, online: this.online.size });
    const len = Number(req.headers.get('content-length') || 0);
    if (len > 8192) return err('Request too large.', 413);
    let m;
    try {
      m = await req.json();
    } catch {
      return err('Bad request.');
    }
    if (!m || typeof m !== 'object' || Array.isArray(m)) return err('Bad request.');
    const ip = (req.headers.get('cf-connecting-ip') || 'local').slice(0, 64);
    try {
      if (typeof m.op === 'string' && m.op.startsWith('feedback')) return await this._feedback(m, req);
      return await this._op(m, { ip });
    } catch (e) {
      console.error(e);
      return err('Server error.', 500);
    }
  }

  // ---------------------------------------------------------------- suggestions / bugs board

  async _feedback(m, req) {
    const voterOf = async () => {
      const acc = m.token ? await this._session(m.token) : null;
      if (acc) return { id: 'u:' + acc.name.toLowerCase(), name: acc.name, acc };
      const anon = String(m.anon || '').replace(/[^a-z0-9]/gi, '').slice(0, 32);
      return anon.length >= 8 ? { id: 'a:' + anon, name: null, acc: null } : null;
    };
    const fbKey = (id) => 'fb:' + String(id || '').replace(/[^a-z0-9]/gi, '').slice(0, 24);
    if (m.op === 'feedbackList') {
      const rows = await this.ctx.storage.list({ prefix: 'fb:', reverse: true, limit: 60 });
      const items = [...rows.values()].map((row) => publicItem(row)).filter(Boolean);
      return json({ items });
    }
    if (m.op === 'feedback') {
      const clean = sanitizeFeedbackText(m.text);
      if (!clean.ok) return err(clean.reason);
      const kind = feedbackKind(m.kind); // enum: 'bug' or 'idea' (missing/unknown = suggestion)
      const ip = (req.headers.get('cf-connecting-ip') || 'local').slice(0, 64);
      const last = (await this.ctx.storage.get('fbip:' + ip)) || 0;
      if (Date.now() - last < 30000) return err('Thanks! Give it 30 seconds before posting again.', 429);
      await this.ctx.storage.put('fbip:' + ip, Date.now());
      const who = await voterOf();
      const at = Date.now();
      const id = String(at).padStart(14, '0') + Math.random().toString(36).slice(2, 6);
      const item = { id, kind, text: clean.text, by: who && who.name ? who.name : 'Guest', at, votes: 1, voters: who ? [who.id] : [], replies: [] };
      await this.ctx.storage.put('fb:' + id, item);
      return json({ item: publicItem(item) });
    }
    if (m.op === 'feedbackVote') {
      const item = await this.ctx.storage.get(fbKey(m.id));
      if (!item) return err('That post is gone.', 404);
      const who = await voterOf();
      if (!who) return err('Could not count that vote.');
      if (!Array.isArray(item.voters)) item.voters = [];
      if (!item.voters.includes(who.id)) {
        if (item.voters.length < 5000) item.voters.push(who.id);
        item.votes = item.voters.length;
        await this.ctx.storage.put('fb:' + item.id, item);
      }
      return json({ item: publicItem(item) });
    }
    if (m.op === 'feedbackReply') {
      const item = await this.ctx.storage.get(fbKey(m.id));
      if (!item) return err('That post is gone.', 404);
      const clean = sanitizeFeedbackText(m.text);
      if (!clean.ok) return err(clean.reason);
      const ip = (req.headers.get('cf-connecting-ip') || 'local').slice(0, 64);
      const last = (await this.ctx.storage.get('fbip:' + ip)) || 0;
      if (Date.now() - last < 30000) return err('Thanks! Give it 30 seconds before posting again.', 429);
      await this.ctx.storage.put('fbip:' + ip, Date.now());
      const who = await voterOf();
      const at = Date.now();
      const rid = ('r' + String(at).slice(-10) + Math.random().toString(36).slice(2, 6)).replace(/[^a-z0-9]/gi, '').slice(0, 24);
      const out = addReply(item, { id: rid, text: clean.text, by: who && who.name ? who.name : 'Guest', at });
      if (out.error) return err(out.error);
      await this.ctx.storage.put('fb:' + item.id, out.item);
      return json({ item: publicItem(out.item) });
    }
    if (m.op === 'feedbackDelete') {
      const who = await voterOf();
      if (!who || !who.acc || !canModerateFeedback(who.acc.name)) return err('Only developers can delete posts.', 403);
      const item = await this.ctx.storage.get(fbKey(m.id));
      if (!item) return err('That post is gone.', 404);
      const replyId = String(m.replyId || '').replace(/[^a-z0-9]/gi, '').slice(0, 24);
      if (replyId) {
        const out = removeReply(item, replyId);
        if (out.error) return err(out.error, 404);
        await this.ctx.storage.put('fb:' + item.id, out.item);
        return json({ item: publicItem(out.item) });
      }
      await this.ctx.storage.delete('fb:' + item.id);
      return json({ ok: true, id: item.id });
    }
    return err('Unknown request.');
  }

  async _op(m, { ip = 'local' } = {}) {
    switch (m.op) {
      case 'register': {
        const name = String(m.name || '').trim();
        const password = String(m.password || '');
        if (!validName(name)) return err('Usernames are 3-16 letters, numbers, _ or -.');
        if (!nameIsClean(name)) return err('That username is not allowed. Pick one without swear words.');
        const weak = passwordProblem(password);
        if (weak) return err(weak);
        const lower = name.toLowerCase();
        // (usernames are public, so "taken" is not a secret; the sign-up cap limits probing and alt farms)
        if (await this._acc(lower)) return err('That username is taken.', 409);
        if (!this.limiter.signupOk(ip, Date.now())) {
          await this._secLog('signup_limited', { ip });
          return err('Too many new accounts from this network. Try again later.', 429);
        }
        const salt = randHex(16);
        const acc = {
          name,
          salt,
          hash: await hashPassword(password, salt),
          coins: START_COINS,
          owned: DEFAULT_OWNED.slice(),
          equipped: { ...DEFAULT_EQUIPPED, emotes: DEFAULT_EQUIPPED.emotes.slice() },
          friends: [],
          incoming: [],
          outgoing: [],
          stats: { matches: 0, wins: 0, kills: 0 },
          created: Date.now(),
          lastReward: 0,
        };
        await this._save(acc);
        await this._secLog('signup', { user: name, ip });
        return json({ token: await this._newSession(acc), profile: profileOf(acc) });
      }
      case 'login': {
        const lower = String(m.name || '').trim().toLowerCase().slice(0, 32);
        const password = String(m.password || '').slice(0, 128); // cap: long inputs can't slow the hash
        const now = Date.now();
        const wait = Math.max(this.limiter.loginWait('ip:' + ip, now), this.limiter.loginWait('acct:' + lower, now));
        if (wait > 0) {
          await this._secLog('login_limited', { user: lower, ip });
          return err(`Too many sign-in attempts. Try again in ${Math.ceil(wait / 60e3)} min.`, 429);
        }
        const acc = await this._acc(lower);
        // hash even when the account doesn't exist, so timing doesn't reveal which usernames exist
        const digest = await hashPassword(password, acc && acc.salt ? acc.salt : '00'.repeat(16));
        const ok = !!(acc && acc.salt && acc.hash && same(digest, acc.hash));
        if (!ok) {
          this.limiter.loginFail('ip:' + ip, now);
          this.limiter.loginFail('acct:' + lower, now);
          await this._secLog('login_fail', { user: lower, ip });
          return err('Wrong username or password.', 401);
        }
        this.limiter.loginOk('acct:' + lower);
        await this._secLog('login', { user: acc.name, ip });
        return json({ token: await this._newSession(acc), profile: profileOf(acc) });
      }
      case 'googleLogin':
        return this._googleLogin(m);
      case 'leaderboard':
        return this._leaderboard();
    }

    // everything else needs a session
    const acc = await this._session(m.token);
    if (!acc) return err('Signed out. Please sign in again.', 401);
    const lower = acc.name.toLowerCase();

    switch (m.op) {
      case 'me':
        return json({ profile: profileOf(acc) });
      case 'logout': {
        await this.ctx.storage.delete('sess:' + m.token);
        const list = (await this.ctx.storage.get('sessions:' + lower)) || [];
        await this.ctx.storage.put('sessions:' + lower, list.filter((t) => t !== m.token));
        return json({ ok: true });
      }
      case 'logoutAll': {
        const n = await this._endAllSessions(lower);
        await this.ctx.storage.delete('sess:' + m.token); // sessions from before the index existed
        await this._secLog('logout_all', { user: acc.name, ip, detail: `${n} sessions` });
        return json({ ok: true, ended: n });
      }
      case 'ackWarning': {
        if (!acc.warning) return json({ profile: profileOf(acc) });
        const next = { ...acc, warning: null };
        await this._save(next);
        return json({ profile: profileOf(next) });
      }
    }

    // a banned account can sign in and see why, but nothing else
    const ban = banInfo(acc, Date.now());
    if (ban) {
      const left = ban.permanent ? 'This ban is permanent.' : `It lifts in ${timeLeft(ban.until, Date.now())}.`;
      return json({ error: `Your account is banned: ${ban.reason}. ${left}`, banned: ban }, 403);
    }

    if (MOD_OPS.has(m.op)) return this._mod(acc, m, ip);
    if (m.op === 'report') return this._report(acc, m);

    switch (m.op) {
      case 'rename': {
        // Only for names that fail the username filter; normal renames are not a feature.
        if (nameIsClean(acc.name)) return err('Your username is fine. Renaming is only needed for names that break the rules.');
        const name = String(m.name || '').trim();
        if (!validName(name)) return err('Usernames are 3-16 letters, numbers, _ or -.');
        if (!nameIsClean(name)) return err('That username is not allowed. Pick one without swear words.');
        if (name.toLowerCase() !== lower && (await this._acc(name.toLowerCase()))) return err('That username is taken.', 409);
        return this._rename(acc, name, m.token);
      }
      case 'buy': {
        const id = String(m.item || '');
        const price = PRICES[id];
        if (price == null) return err('That item is not in the shop.');
        if (acc.owned.includes(id)) return err('You already own that.');
        if (acc.coins < price) return err('Not enough coins.');
        acc.coins -= price;
        acc.owned.push(id);
        await this._save(acc);
        this._push(lower, { t: 'profile', profile: profileOf(acc) });
        return json({ profile: profileOf(acc) });
      }
      case 'equip': {
        upgradeAccount(acc);
        if (m.skin != null) {
          if (!acc.owned.includes(m.skin) || !String(m.skin).startsWith('skin_')) return err('You do not own that outfit.');
          acc.equipped.skin = m.skin;
        }
        if (m.pickaxe != null) {
          if (!acc.owned.includes(m.pickaxe) || !PICKAXES[m.pickaxe]) return err('You do not own that pickaxe.');
          upgradeAccount(acc).equipped.pickaxe = m.pickaxe;
        }
        if (m.backbling != null) {
          if (!acc.owned.includes(m.backbling) || !BACKBLINGS[m.backbling]) return err('You do not own that back bling.');
          upgradeAccount(acc).equipped.backbling = m.backbling;
        }
        if (Array.isArray(m.emotes)) {
          const list = m.emotes.slice(0, EMOTE_SLOTS).map((e) => (e && acc.owned.includes(e) && String(e).startsWith('emote_') ? e : null));
          while (list.length < EMOTE_SLOTS) list.push(null);
          acc.equipped.emotes = list;
        }
        await this._save(acc);
        this._sendFriendsOf(lower);
        return json({ profile: profileOf(acc) });
      }
      case 'reward': {
        // match payout: outlasted (scaled), 75 per elimination, 400 for a win
        // Coin payout is rate-limited; wins/kills still count so the boards stay honest after quick rematches.
        const now = Date.now();
        const players = Math.max(1, Math.min(100, m.players | 0));
        const placement = Math.max(1, Math.min(players, m.placement | 0 || players));
        const kills = Math.max(0, Math.min(40, m.kills | 0));
        const won = !!m.won && placement === 1;
        const rateLimited = now - (acc.lastReward || 0) < REWARD_GAP_MS;
        let earned = 0;
        if (!rateLimited) {
          const outlasted = Math.round(((players - placement) / Math.max(1, players - 1)) * 250);
          earned = Math.min(1500, outlasted + kills * 75 + (won ? 400 : 0));
          acc.coins += earned;
          acc.lastReward = now;
        }
        // Leaderboard stats only for HARD bot-difficulty matches (client-reported, like kills).
        const ranked = m.ranked === true;
        acc.stats = applyMatchStats(acc.stats, { kills, won, ranked });
        // Flag results that look impossible or unlikely so a dev can review them (never an auto-ban).
        const flags = rewardFlags({ kills, players, placement, won, ranked }, acc, now);
        let next = trackRanked(acc, { ranked, won, now });
        for (const f of flags) next = addFlag(next, f, now);
        if (next.flagCount !== acc.flagCount) await this.ctx.storage.put('flagged:' + lower, { at: now });
        await this._save(next);
        return json({ profile: profileOf(next), earned, rateLimited, ranked });
      }
      case 'boxResult': {
        // Box Fights ladder: client-reported (not verifiable), rate-limited, flagged for review.
        const now = Date.now();
        const result = validateBoxResult(m);
        if (!result.ok) return err(result.error);
        const stats = boxStats(acc);
        if (boxRateLimited(stats, now)) return json({ ok: false, rateLimited: true, error: 'One rated result at a time: try again in a few seconds.' }, 429);
        const applied = applyBoxResult(stats, result, now);
        let next = { ...acc, box: applied.stats };
        for (const kind of boxFlags(stats, result, now)) next = addFlag(next, { kind, why: `box ${result.size}v${result.size} ${result.won ? 'win' : 'loss'} (${result.score.join('-')}${result.forfeit ? ', forfeit' : ''}) vs ${result.oppElo}, elo ${stats.elo}` }, now);
        if (next.flagCount !== acc.flagCount) await this.ctx.storage.put('flagged:' + lower, { at: now });
        await this._save(next);
        return json({ ok: true, elo: applied.stats.elo, delta: applied.delta, tier: applied.tier, games: applied.stats.games });
      }
      case 'adReward': {
        // watched a rewarded ad to the end (client-reported; capped per day, see AD_REWARD_*)
        const now = Date.now();
        const day = new Date(now).toISOString().slice(0, 10);
        if (acc.adDay !== day) {
          acc.adDay = day;
          acc.adCount = 0;
        }
        if ((acc.adCount | 0) >= AD_REWARD_DAILY) return err(`That's all ${AD_REWARD_DAILY} ad rewards for today. Come back tomorrow!`, 429);
        if (now - (acc.lastAdReward || 0) < AD_REWARD_GAP_MS) return err('One ad reward at a time: try again in a few seconds.', 429);
        acc.adCount = (acc.adCount | 0) + 1;
        acc.lastAdReward = now;
        acc.coins += AD_REWARD_COINS;
        await this._save(acc);
        this._push(lower, { t: 'profile', profile: profileOf(acc) });
        return json({ profile: profileOf(acc), earned: AD_REWARD_COINS });
      }
      case 'friendAdd': {
        const to = String(m.name || '').trim().toLowerCase();
        if (to === lower) return err('That is you!');
        const other = await this._acc(to);
        if (!other) return err('No player with that username.', 404);
        if (acc.friends.includes(to)) return err(`${other.name} is already your friend.`);
        if (acc.friends.length >= MAX_FRIENDS) return err('Your friends list is full.');
        if (acc.incoming.includes(to)) return this._accept(acc, other); // they asked first
        if (!acc.outgoing.includes(to)) acc.outgoing.push(to);
        if (!other.incoming.includes(lower)) other.incoming.push(lower);
        await this._save(acc);
        await this._save(other);
        this._push(to, { t: 'request', from: acc.name });
        this._sendFriends(to, other);
        this._sendFriends(lower, acc);
        return json({ profile: profileOf(acc), text: `Friend request sent to ${other.name}.` });
      }
      case 'friendAccept': {
        const from = String(m.name || '').trim().toLowerCase();
        const other = await this._acc(from);
        if (!other || !acc.incoming.includes(from)) return err('That request is gone.');
        return this._accept(acc, other);
      }
      case 'friendDecline':
      case 'friendRemove': {
        const o = String(m.name || '').trim().toLowerCase();
        const other = await this._acc(o);
        const drop = (arr, x) => {
          const i = arr.indexOf(x);
          if (i >= 0) arr.splice(i, 1);
        };
        drop(acc.incoming, o);
        drop(acc.outgoing, o);
        drop(acc.friends, o);
        await this._save(acc);
        if (other) {
          drop(other.incoming, lower);
          drop(other.outgoing, lower);
          drop(other.friends, lower);
          await this._save(other);
          this._sendFriends(o, other);
        }
        this._sendFriends(lower, acc);
        return json({ profile: profileOf(acc) });
      }
      case 'invite': {
        const to = String(m.name || '').trim().toLowerCase();
        const code = String(m.code || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
        if (!acc.friends.includes(to)) return err('You can only invite friends.');
        if (code.length !== 4) return err('No party to invite to.');
        if (!this.online.has(to)) return err('That friend is offline.');
        this._push(to, { t: 'invite', from: acc.name, code });
        return json({ ok: true });
      }
    }
    return err('Unknown request.');
  }

  /** Move an account to a new name: storage key, sign-in indexes, friends' lists, live sockets. */
  async _rename(acc, name, token) {
    const old = acc.name.toLowerCase();
    const next = name.toLowerCase();
    const st = this.ctx.storage;
    acc.name = name;
    if (next === old) {
      await this._save(acc);
    } else {
      await st.put('user:' + next, acc);
      await st.put('renamed:' + old, next); // other devices' sessions follow it (see _session)
      await st.delete('user:' + old);
      if (acc.googleSub) await st.put('google:' + acc.googleSub, next);
      const sessions = await st.get('sessions:' + old);
      if (sessions) {
        await st.put('sessions:' + next, sessions);
        await st.delete('sessions:' + old);
      }
      const sess = await st.get('sess:' + token);
      if (sess) await st.put('sess:' + token, { ...sess, u: next });
      const swap = (arr) => arr.map((n) => (n === old ? next : n));
      for (const o of new Set([...acc.friends, ...acc.incoming, ...acc.outgoing])) {
        const other = await this._acc(o);
        if (!other) continue;
        other.friends = swap(other.friends);
        other.incoming = swap(other.incoming);
        other.outgoing = swap(other.outgoing);
        await this._save(other);
      }
      const conns = this.online.get(old);
      if (conns) {
        this.online.delete(old);
        this.online.set(next, conns);
        for (const id of conns) {
          const c = this.getConnection(id);
          if (c) c.setState({ u: next });
        }
      }
      if (this.status.has(old)) {
        this.status.set(next, this.status.get(old));
        this.status.delete(old);
      }
    }
    this._push(next, { t: 'profile', profile: profileOf(acc) });
    this._sendFriends(next, acc);
    this._sendFriendsOf(next);
    return json({ profile: profileOf(acc) });
  }

  async _accept(acc, other) {
    const a = acc.name.toLowerCase();
    const b = other.name.toLowerCase();
    for (const [x, y] of [
      [acc, b],
      [other, a],
    ]) {
      x.incoming = x.incoming.filter((n) => n !== y);
      x.outgoing = x.outgoing.filter((n) => n !== y);
      if (!x.friends.includes(y)) x.friends.push(y);
    }
    await this._save(acc);
    await this._save(other);
    this._sendFriends(a, acc);
    this._sendFriends(b, other);
    return json({ profile: profileOf(acc), text: `You and ${other.name} are now friends.` });
  }

  // ---------------------------------------------------------------- presence

  async onConnect(conn, ctx) {
    if (!originAllowed(ctx.request.headers.get('origin'), this.env && this.env.ALLOWED_ORIGINS)) {
      conn.close(4003, 'origin');
      return;
    }
    const url = new URL(ctx.request.url);
    const acc = await this._session(url.searchParams.get('token'));
    if (!acc) {
      conn.send(JSON.stringify({ t: 'error', text: 'signed-out' }));
      conn.close(4001, 'signed-out');
      return;
    }
    const lower = acc.name.toLowerCase();
    conn.setState({ u: lower });
    let set = this.online.get(lower);
    const wasOnline = !!set;
    if (!set) this.online.set(lower, (set = new Set()));
    set.add(conn.id);
    if (!this.status.has(lower)) this.status.set(lower, { s: 'lobby', party: null, skin: acc.equipped.skin });
    this._sendFriends(lower, acc);
    if (!wasOnline) this._sendFriendsOf(lower);
  }

  async onMessage(conn, raw) {
    const u = conn.state && conn.state.u;
    if (!u || typeof raw !== 'string' || raw.length > 512) return;
    let m;
    try {
      m = JSON.parse(raw);
    } catch {
      return;
    }
    if (m.t === 'status') {
      const s = m.s === 'match' ? 'match' : 'lobby';
      const party = typeof m.party === 'string' ? m.party.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4) : null;
      const prev = this.status.get(u) || {};
      this.status.set(u, { s, party, skin: typeof m.skin === 'string' ? m.skin.slice(0, 40) : prev.skin });
      this._sendFriendsOf(u);
    }
  }

  onClose(conn) {
    const u = conn.state && conn.state.u;
    if (!u) return;
    const set = this.online.get(u);
    if (!set) return;
    set.delete(conn.id);
    if (set.size) return;
    this.online.delete(u);
    this.status.delete(u);
    this._sendFriendsOf(u);
  }

  onError(conn) {
    this.onClose(conn);
  }

  _push(lower, msg) {
    const set = this.online.get(lower);
    if (!set) return;
    const s = JSON.stringify(msg);
    for (const id of set) {
      const c = this.getConnection(id);
      if (c) c.send(s);
    }
  }

  /** Friend list with presence, pushed to `lower` (acc = their account). */
  async _sendFriends(lower, acc) {
    if (!this.online.has(lower)) return;
    acc = acc || (await this._acc(lower));
    if (!acc) return;
    const list = [];
    for (const f of acc.friends) {
      const st = this.status.get(f);
      const other = await this._acc(f);
      list.push({ name: other ? other.name : f, online: this.online.has(f), status: st ? st.s : 'offline', party: st ? st.party : null, skin: st ? st.skin : null });
    }
    list.sort((a, b) => Number(b.online) - Number(a.online) || a.name.localeCompare(b.name));
    const names = async (arr) => Promise.all(arr.map(async (n) => ((await this._acc(n)) || { name: n }).name));
    this._push(lower, { t: 'friends', list, incoming: await names(acc.incoming), outgoing: await names(acc.outgoing) });
  }

  /** Someone's presence changed: refresh every online friend of theirs. */
  async _sendFriendsOf(lower) {
    const acc = await this._acc(lower);
    if (!acc) return;
    for (const f of acc.friends) if (this.online.has(f)) this._sendFriends(f);
  }
}
