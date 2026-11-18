// BENTONVILLE ROYALE — multiplayer wire format.
//
// One WebSocket per player to the PartyKit relay (party/server.js), carrying:
//   text frames   JSON  — lobby, match start, actions, events, inventory
//   binary frames ArrayBuffer — host snapshots (H->C, ~20 Hz) and client
//                               movement state (C->H, ~30 Hz)
//
// Binary layouts (little endian):
//
// SNAPSHOT (H->C)                         CLIENT STATE (C->H)
//   u8  type = 1                            u8  type = 2
//   u16 seq                                 u16 seq
//   f32 hostTime (s)                        f32 x, y, z
//   f32 storm cx, cz, r, nextCx, nextCz,    i16 vx, vy, vz   (x100 m/s)
//       nextR                               u16 heading      (0..2pi -> 0..65535)
//   u8  phase, u8 mode, u16 secondsLeft*10  i16 pitch        (x10000)
//   u8  dps, u8 alive, u8 nActors           u8  flags  (see FLAG below)
//   per actor (17 bytes):                   u8  mode   (MODES index)
//     u8  id, u8 flags                      u8  equip  (EQUIP index)
//     i16 x*10, i16 y*20, i16 z*10          = 32 bytes
//     u16 heading, i8 pitch*80
//     u8  equip, u8 health, u8 shield, u8 kills
//     u8  xflags (XFLAG: downed, being revived)
//         (a downed actor's health byte carries its down HP)
//
// Reliable messages are JSON objects { t: <type>, ... }. Anything longer than
// the sender's chunk size is split into { t: '_c', id, i, n, s } parts and
// reassembled by makeReassembler().

import { WEAPONS, TAU } from '../core/config.js';

export const PROTO_VERSION = 4; // 2: teams (roster tm, start mode, snapshot xflags, knock / revive events); 3: ballistic sniper rounds ('sh' b/d, 'ph' claims); 4: drivable cars ('veh' / 'drv' actions, 've' 'vw' 'vd' 'vx' 'vh' 'vf' events, 'cars' poses, XFLAG.lean)
export const MAX_HUMANS = 16;
export const SNAP_HZ = 20;
export const STATE_HZ = 30;
export const INTERP_DELAY = 0.1; // s of buffering for remote actors on clients
export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I / O
export const CODE_LEN = 4;

export const T_SNAP = 1;
export const T_STATE = 2;

export const FLAG = { alive: 1, grounded: 2, gliding: 4, crouch: 8, bus: 16, emote: 32, ads: 64, reloading: 128 };
export const XFLAG = { downed: 1, revived: 2, lean: 4 }; // revived = a teammate is reviving this actor right now; lean = leaning out of a car window
export const MODES = ['ground', 'freefall', 'glide', 'bus', 'dead', 'downed'];
export const STORM_MODES = ['waiting', 'shrinking', 'final', 'done'];
export const EQUIP = ['pickaxe', 'none', ...Object.keys(WEAPONS), 'grenade', 'smoke']; // new ids go on the end
export const SURF = ['none', 'body', 'shield', 'dirt', 'wood', 'brick', 'metal', 'glass', 'water'];

export function randomCode(rng = Math.random) {
  let s = '';
  for (let i = 0; i < CODE_LEN; i++) s += CODE_ALPHABET[Math.floor(rng() * CODE_ALPHABET.length)];
  return s;
}

export function normalizeCode(s) {
  return String(s || '')
    .toUpperCase()
    .replace(/[^A-Z]/g, '')
    .slice(0, CODE_LEN);
}

export function validCode(s) {
  return s.length === CODE_LEN && [...s].every((c) => CODE_ALPHABET.includes(c));
}

const u16h = (h) => Math.round((((h % TAU) + TAU) % TAU) * (65535 / TAU)) & 0xffff;
const hFromU16 = (v) => (v * TAU) / 65535;
const i16 = (v) => Math.max(-32768, Math.min(32767, Math.round(v)));
const u8 = (v) => Math.max(0, Math.min(255, Math.round(v || 0)));

// ------------------------------------------------------------------ snapshot

export const SNAP_HEADER = 1 + 2 + 4 + 24 + 1 + 1 + 2 + 1 + 1 + 1;
export const SNAP_ACTOR = 17;

/** actors: [{ id, flags, x, y, z, heading, pitch, equip, health, shield, kills, xf }] */
export function encodeSnapshot(seq, hostTime, storm, alive, actors) {
  const buf = new ArrayBuffer(SNAP_HEADER + SNAP_ACTOR * actors.length);
  const d = new DataView(buf);
  let o = 0;
  d.setUint8(o, T_SNAP); o += 1;
  d.setUint16(o, seq & 0xffff, true); o += 2;
  d.setFloat32(o, hostTime, true); o += 4;
  for (const k of ['cx', 'cz', 'r', 'nextCx', 'nextCz', 'nextR']) {
    d.setFloat32(o, storm[k] || 0, true);
    o += 4;
  }
  d.setUint8(o, u8(storm.phase)); o += 1;
  d.setUint8(o, Math.max(0, STORM_MODES.indexOf(storm.mode))); o += 1;
  d.setUint16(o, Math.min(65535, Math.round((storm.secondsLeft || 0) * 10)), true); o += 2;
  d.setUint8(o, u8(storm.dps)); o += 1;
  d.setUint8(o, u8(alive)); o += 1;
  d.setUint8(o, actors.length); o += 1;
  for (const a of actors) {
    d.setUint8(o, a.id); o += 1;
    d.setUint8(o, a.flags); o += 1;
    d.setInt16(o, i16(a.x * 10), true); o += 2;
    d.setInt16(o, i16(a.y * 20), true); o += 2;
    d.setInt16(o, i16(a.z * 10), true); o += 2;
    d.setUint16(o, u16h(a.heading), true); o += 2;
    d.setInt8(o, Math.max(-127, Math.min(127, Math.round(a.pitch * 80)))); o += 1;
    d.setUint8(o, a.equip); o += 1;
    d.setUint8(o, u8(a.health)); o += 1;
    d.setUint8(o, u8(a.shield)); o += 1;
    d.setUint8(o, u8(a.kills)); o += 1;
    d.setUint8(o, (a.xf || 0) & 0xff); o += 1;
  }
  return buf;
}

export function decodeSnapshot(buf) {
  const d = new DataView(buf);
  let o = 0;
  if (d.getUint8(o) !== T_SNAP) return null;
  o += 1;
  const seq = d.getUint16(o, true); o += 2;
  const time = d.getFloat32(o, true); o += 4;
  const storm = {};
  for (const k of ['cx', 'cz', 'r', 'nextCx', 'nextCz', 'nextR']) {
    storm[k] = d.getFloat32(o, true);
    o += 4;
  }
  storm.phase = d.getUint8(o); o += 1;
  storm.mode = STORM_MODES[d.getUint8(o)] || 'waiting'; o += 1;
  storm.secondsLeft = d.getUint16(o, true) / 10; o += 2;
  storm.dps = d.getUint8(o); o += 1;
  const alive = d.getUint8(o); o += 1;
  const n = d.getUint8(o); o += 1;
  const actors = new Array(n);
  for (let i = 0; i < n; i++) {
    const a = {};
    a.id = d.getUint8(o); o += 1;
    a.flags = d.getUint8(o); o += 1;
    a.x = d.getInt16(o, true) / 10; o += 2;
    a.y = d.getInt16(o, true) / 20; o += 2;
    a.z = d.getInt16(o, true) / 10; o += 2;
    a.heading = hFromU16(d.getUint16(o, true)); o += 2;
    a.pitch = d.getInt8(o) / 80; o += 1;
    a.equip = d.getUint8(o); o += 1;
    a.health = d.getUint8(o); o += 1;
    a.shield = d.getUint8(o); o += 1;
    a.kills = d.getUint8(o); o += 1;
    a.xf = d.getUint8(o); o += 1;
    actors[i] = a;
  }
  return { seq, time, storm, alive, actors };
}

// ------------------------------------------------------------------ client state

export const STATE_BYTES = 32;

/** s: { x,y,z, vx,vy,vz, heading, pitch, flags, mode, equip } */
export function encodeState(seq, s) {
  const buf = new ArrayBuffer(STATE_BYTES);
  const d = new DataView(buf);
  d.setUint8(0, T_STATE);
  d.setUint16(1, seq & 0xffff, true);
  d.setFloat32(3, s.x, true);
  d.setFloat32(7, s.y, true);
  d.setFloat32(11, s.z, true);
  d.setInt16(15, i16(s.vx * 100), true);
  d.setInt16(17, i16(s.vy * 100), true);
  d.setInt16(19, i16(s.vz * 100), true);
  d.setUint16(21, u16h(s.heading), true);
  d.setInt16(23, i16(s.pitch * 10000), true);
  d.setUint8(25, s.flags);
  d.setUint8(26, Math.max(0, MODES.indexOf(s.mode)));
  d.setUint8(27, s.equip);
  return buf;
}

export function decodeState(buf) {
  const d = new DataView(buf);
  if (buf.byteLength < 28 || d.getUint8(0) !== T_STATE) return null;
  const s = {
    seq: d.getUint16(1, true),
    x: d.getFloat32(3, true),
    y: d.getFloat32(7, true),
    z: d.getFloat32(11, true),
    vx: d.getInt16(15, true) / 100,
    vy: d.getInt16(17, true) / 100,
    vz: d.getInt16(19, true) / 100,
    heading: hFromU16(d.getUint16(21, true)),
    pitch: d.getInt16(23, true) / 10000,
    flags: d.getUint8(25),
    mode: MODES[d.getUint8(26)] || 'ground',
    equip: d.getUint8(27),
  };
  if (![s.x, s.y, s.z, s.heading, s.pitch].every(Number.isFinite)) return null;
  return s;
}

/** Newer-than for wrapping u16 sequence numbers. */
export function seqNewer(a, b) {
  return ((a - b) & 0xffff) !== 0 && ((a - b) & 0xffff) < 0x8000;
}

// ------------------------------------------------------------------ chunk reassembly (sender: Net.js)

/** Returns a function(msg) -> full message | null that reassembles chunked messages. */
export function makeReassembler() {
  const parts = new Map();
  return (msg) => {
    if (!msg || msg.t !== '_c') return msg;
    let p = parts.get(msg.id);
    if (!p) parts.set(msg.id, (p = { n: msg.n, got: 0, s: new Array(msg.n) }));
    if (p.s[msg.i] == null) p.got++;
    p.s[msg.i] = msg.s;
    if (p.got < p.n) return null;
    parts.delete(msg.id);
    try {
      return JSON.parse(p.s.join(''));
    } catch {
      return null;
    }
  };
}

/** Rounds numbers in a flat array to `d` decimals (smaller JSON). */
export function rnd(v, d = 2) {
  const m = 10 ** d;
  return Math.round(v * m) / m;
}

/**
 * Building wall panel events from the host (`{ e: 'wd', b, p, hp }` damaged, `{ e: 'wx', b, p }`
 * broken; b = building map id, p = panel index). Peer messages are untrusted: b must be a
 * number / short string naming a hollow building (never an object, which World.buildingById
 * would accept as a collider), p an integer index into its panels, hp finite (clamped to
 * 1..maxHp). Returns { c, pn, hp } (hp only meaningful for 'wd') or null.
 */
export function resolvePanelEvent(world, e) {
  if (!world || !world.buildingById || !e || (e.e !== 'wd' && e.e !== 'wx')) return null;
  const b = e.b;
  const okId = (typeof b === 'number' && Number.isSafeInteger(b)) || (typeof b === 'string' && b.length > 0 && b.length <= 40);
  if (!okId) return null;
  const c = world.buildingById(b);
  const panels = c && c.shell && c.shell.panels;
  if (!panels) return null;
  const p = e.p;
  if (!Number.isInteger(p) || p < 0 || p >= panels.length) return null;
  const pn = panels[p];
  if (!pn) return null;
  if (e.e === 'wx') return { c, pn, hp: 0 };
  const hp = e.hp;
  if (typeof hp !== 'number' || !Number.isFinite(hp)) return null;
  return { c, pn, hp: Math.min(pn.maxHp, Math.max(1, hp)) };
}
