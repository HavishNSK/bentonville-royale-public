// BENTONVILLE ROYALE — on-screen reboot card markers (team modes).
//
//   const rm = new RebootMarkers(pings.layer);
//   rebootMarkerTargets({ cards, vans, ... }, out)   // pure: which markers to show (see below)
//   rm.update(targets, project, viewer, W, H)        // every frame: moves / adds / removes them
//   rm.reset()
//
// Your team's reboot cards on the ground get a marker above them with the teammate's name, the
// distance and the seconds left, so you can find them without opening the map. Off screen or
// behind the camera the marker pins to the screen edge (Pings' screenAnchor) with an arrow
// pointing toward the card. While you carry a card, the nearest reboot van gets one too.
// Uses the same layer and look as map markers / pings. Names go through textContent.

import { screenAnchor } from './Pings.js';

const NAME_MAX = 16;
const CSS = `
.br-ping[data-kind=card] .br-ping-ico,.br-ping[data-kind=van] .br-ping-ico{transform:none;border-radius:calc(var(--u)*4);
  display:grid;place-items:center;color:#13202c;font-family:var(--br-display);font-size:calc(var(--u)*13);line-height:1}
.br-ping[data-kind=card] .br-ping-ico{width:calc(var(--u)*18);height:calc(var(--u)*24);background:#38e1ff}
.br-ping[data-kind=van] .br-ping-ico{background:#7dff6b}
.br-ping[data-kind=van][data-cd] .br-ping-ico{background:#8a96a3}
.br-ping-arrow{position:absolute;left:50%;top:50%;width:0;height:0;display:none;
  border-left:calc(var(--u)*7) solid transparent;border-right:calc(var(--u)*7) solid transparent;
  border-bottom:calc(var(--u)*10) solid #fff;filter:drop-shadow(0 0 calc(var(--u)*1.5) #13202c)}
.br-ping.is-edge .br-ping-arrow{display:block}
.br-ping[data-kind=card].is-edge .br-ping-txt,.br-ping[data-kind=van].is-edge .br-ping-txt{display:block}
.br-ping[data-kind=card].is-edge .br-ping-txt span,.br-ping[data-kind=van].is-edge .br-ping-txt span{display:none}
`;

/**
 * Which reboot markers the local player sees. Pure.
 *   cards: iterable of { v, name, team, x, y, z, until, holder }
 *   vans: [{ i, x, y, z, cooldownUntil }]
 *   teamMode, team (local player's team), selfId, alive (local player)
 *   carrying: cards the local player holds; time: Reboot clock (s); self: { x, z }
 * -> [{ key, kind: 'card'|'van', x, y, z, label, secs, cd }]
 * Cards: only your team's, on the ground (not held), not your own, only while you are alive.
 * Vans: only while you carry a card; the nearest ready one, else the one ready soonest.
 */
/** Share of the screen height at the bottom the HUD covers: edge markers stay above it. */
export const BOTTOM_HUD = 0.22;

/** An edge-pinned anchor (screenAnchor output) moved up out of the bottom HUD band. */
export function keepAboveHud(a, H) {
  if (a.edge) a.y = Math.min(a.y, H * (1 - BOTTOM_HUD));
  return a;
}

export function rebootMarkerTargets({ cards, vans = [], teamMode, team, selfId, alive, carrying = 0, time = 0, self = null }, out = []) {
  out.length = 0;
  if (!teamMode || team == null || !alive) return out;
  for (const c of cards || []) {
    if (c.holder != null || c.team !== team || c.v === selfId) continue;
    if (!Number.isFinite(c.x) || !Number.isFinite(c.z)) continue;
    out.push({
      key: 'c' + c.v,
      kind: 'card',
      x: c.x,
      y: (Number.isFinite(c.y) ? c.y : 0) + 1.7,
      z: c.z,
      label: cleanName(c.name),
      secs: Number.isFinite(c.until) ? Math.max(0, Math.ceil(c.until - time)) : -1,
      cd: false,
    });
  }
  if (carrying > 0 && self && vans.length) {
    let best = null;
    let bestScore = Infinity;
    for (const v of vans) {
      const wait = Math.max(0, (v.cooldownUntil || 0) - time);
      const d = Math.hypot(v.x - self.x, v.z - self.z);
      // ready vans first (by distance), then the one ready soonest
      const score = wait > 0 ? 1e9 + wait : d;
      if (score < bestScore) {
        bestScore = score;
        best = { v, wait };
      }
    }
    if (best) {
      const { v, wait } = best;
      out.push({
        key: 'v' + v.i,
        kind: 'van',
        x: v.x,
        y: (v.y || 0) + 4.2,
        z: v.z,
        label: wait > 0 ? `REBOOT ${Math.ceil(wait)}s` : 'REBOOT VAN',
        secs: -1,
        cd: wait > 0,
      });
    }
  }
  return out;
}

/** Peer-supplied name -> short plain label (textContent only; this just trims and caps length). */
export function cleanName(name) {
  const s = String(name == null ? '' : name).replace(/[\u0000-\u001f\u007f]/g, '').trim();
  if (!s) return 'Teammate';
  return s.length > NAME_MAX ? s.slice(0, NAME_MAX - 1) + '…' : s;
}

export class RebootMarkers {
  constructor(layer) {
    if (!document.getElementById('br-reboot-markers-css')) {
      const st = document.createElement('style');
      st.id = 'br-reboot-markers-css';
      st.textContent = CSS;
      document.head.appendChild(st);
    }
    this.layer = layer;
    this.items = new Map(); // key -> entry
    this._seen = new Set();
    this._a = {};
  }

  _make(t) {
    const el = document.createElement('div');
    el.className = 'br-ping';
    el.dataset.type = 'r';
    el.dataset.kind = t.kind;
    const ico = document.createElement('div');
    ico.className = 'br-ping-ico';
    ico.textContent = 'R';
    const arrow = document.createElement('div');
    arrow.className = 'br-ping-arrow';
    const txt = document.createElement('div');
    txt.className = 'br-ping-txt';
    const name = document.createElement('span');
    const dist = document.createElement('small');
    txt.append(name, dist);
    el.append(arrow, ico, txt);
    this.layer.appendChild(el);
    return { el, arrow, name, dist, label: null, info: null, cd: null, edge: null };
  }

  /**
   * targets: rebootMarkerTargets(); project(vec3-like) -> { x, y } px or null (behind the camera);
   * viewer: { x, z, heading }; W / H: screen px. Only transforms and changed text are written.
   */
  update(targets, project, viewer, W, H) {
    const seen = this._seen;
    seen.clear();
    const pad = 40;
    const a = this._a;
    for (const t of targets) {
      seen.add(t.key);
      let e = this.items.get(t.key);
      if (!e) {
        e = this._make(t);
        this.items.set(t.key, e);
      }
      if (e.label !== t.label) e.name.textContent = e.label = t.label;
      if (e.cd !== t.cd) {
        e.cd = t.cd;
        if (t.cd) e.el.dataset.cd = '1';
        else delete e.el.dataset.cd;
      }
      const d = Math.round(Math.hypot(t.x - viewer.x, t.z - viewer.z));
      const info = t.secs >= 0 ? `${d} m · ${t.secs}s` : `${d} m`;
      if (e.info !== info) e.dist.textContent = e.info = info;
      screenAnchor(project(t), t, viewer, W, H, pad, a);
      // pinned to the edge: stay above the bottom HUD band (health, shield, hotbar, build bar),
      // where a card behind you used to sit on top of the health bar
      keepAboveHud(a, H);
      if (e.edge !== a.edge) {
        e.edge = a.edge;
        e.el.classList.toggle('is-edge', a.edge);
      }
      // on screen: the pin's foot on the card; on the edge: centred, arrow pointing out
      e.el.style.transform = `translate(${Math.round(a.x)}px, ${Math.round(a.y)}px) ${a.edge ? 'translate(-50%, -50%)' : 'translate(-50%, -100%)'}`;
      if (a.edge) {
        const r = Math.round(a.angle * 100) / 100;
        // clear of the icon + distance pill: they are wider than tall, so sideways goes further
        const out = Math.round(30 + 16 * Math.abs(Math.sin(a.angle)));
        e.arrow.style.transform = `translate(-50%, -50%) rotate(${r}rad) translateY(calc(var(--u) * -${out}))`;
      }
    }
    for (const [key, e] of this.items) {
      if (seen.has(key)) continue;
      e.el.remove();
      this.items.delete(key);
    }
  }

  reset() {
    for (const e of this.items.values()) e.el.remove();
    this.items.clear();
  }
}
