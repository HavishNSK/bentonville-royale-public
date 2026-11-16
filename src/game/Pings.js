// BENTONVILLE ROYALE — map markers and world pings, shared with your team.
//
//   const pings = new Pings(hud.el);
//   pings.set({ owner, slot, type: 'm'|'p', kind: 'loc'|'enemy'|'item', x, y, z, label?, target? })
//   pings.clear(ownerId, 'm')
//   pings.update(now, project, viewer)   // every frame: moves the on-screen markers
//   pings.blips(out)                     // minimap blips: 'pin<slot>' / 'ping<slot>' / 'pingEnemy'
//   pings.markerOf(ownerId)              // { x, z } of that player's map marker, or null
//   pings.reset()
//
// One map marker ('m', stays until removed or replaced) and one ping ('p', fades after a few
// seconds) per player. An enemy ping follows its target for its short life. On screen each
// shows a coloured diamond / pin with a label and the distance; off screen it clamps to the
// edge. Labels go through textContent.

import { TEAM_CSS } from './Teams.js';

const LIFE = { loc: 9, item: 12, enemy: 4.5 };
const CSS = `
.br-pings{position:absolute;inset:0;pointer-events:none;z-index:2;overflow:hidden}
.br-ping{position:absolute;left:0;top:0;display:flex;flex-direction:column;align-items:center;gap:calc(var(--u)*2);
  transform:translate(-50%,-100%);will-change:transform;transition:opacity .2s ease}
.br-ping-ico{width:calc(var(--u)*22);height:calc(var(--u)*22);background:var(--c);border:calc(var(--u)*3) solid #13202c;
  transform:rotate(45deg);border-radius:calc(var(--u)*4);box-shadow:0 0 0 calc(var(--u)*2) rgba(255,255,255,.75)}
.br-ping[data-type=m] .br-ping-ico{border-radius:50% 50% 50% 0;transform:rotate(-45deg)}
.br-ping[data-kind=enemy] .br-ping-ico{background:#ff3b3b}
.br-ping-txt{padding:calc(var(--u)*2) calc(var(--u)*8);border-radius:999px;background:rgba(19,32,44,.82);color:#fff;
  font-family:var(--br-display);font-size:calc(var(--u)*13);white-space:nowrap;line-height:1.15;text-align:center}
.br-ping-txt small{display:block;font-family:var(--br-body);font-weight:900;font-size:calc(var(--u)*10.5);opacity:.85}
.br-ping.is-edge .br-ping-txt{display:none}
.br-ping.is-new .br-ping-ico{animation:br-ping-pop .5s cubic-bezier(.3,1.6,.5,1)}
@keyframes br-ping-pop{from{scale:2.2;opacity:.2}}
@media (prefers-reduced-motion: reduce){.br-ping.is-new .br-ping-ico{animation:none}}
`;

export class Pings {
  constructor(hudEl) {
    if (!document.getElementById('br-pings-css')) {
      const st = document.createElement('style');
      st.id = 'br-pings-css';
      st.textContent = CSS;
      document.head.appendChild(st);
    }
    this.layer = document.createElement('div');
    this.layer.className = 'br-pings';
    hudEl.appendChild(this.layer);
    this.items = new Map(); // `${owner}:${type}` -> entry
    this.time = 0;
  }

  /** Adds or replaces `owner`'s marker ('m') or ping ('p'). */
  set(p) {
    const key = p.owner + ':' + p.type;
    let e = this.items.get(key);
    if (!e) {
      const el = document.createElement('div');
      el.className = 'br-ping';
      const ico = document.createElement('div');
      ico.className = 'br-ping-ico';
      const txt = document.createElement('div');
      txt.className = 'br-ping-txt';
      const name = document.createElement('span');
      const dist = document.createElement('small');
      txt.append(name, dist);
      el.append(ico, txt);
      this.layer.appendChild(el);
      e = { el, name, dist, lastD: -1 };
      this.items.set(key, e);
    }
    Object.assign(e, {
      owner: p.owner,
      type: p.type,
      kind: p.kind || 'loc',
      slot: Math.max(0, Math.min(3, p.slot | 0)),
      x: +p.x,
      y: +p.y || 0,
      z: +p.z,
      target: p.target || null,
      until: p.type === 'm' ? Infinity : this.time + (LIFE[p.kind] || LIFE.loc),
    });
    e.el.dataset.type = e.type;
    e.el.dataset.kind = e.kind;
    e.el.style.setProperty('--c', TEAM_CSS[e.slot]);
    e.name.textContent = p.label || (e.type === 'm' ? 'Marker' : e.kind === 'enemy' ? 'Enemy' : 'Here');
    e.el.classList.remove('is-new');
    void e.el.offsetWidth; // restart the pop
    e.el.classList.add('is-new');
    return e;
  }

  clear(owner, type) {
    const key = owner + ':' + type;
    const e = this.items.get(key);
    if (!e) return;
    e.el.remove();
    this.items.delete(key);
  }

  markerOf(owner) {
    const e = this.items.get(owner + ':m');
    return e ? { x: e.x, z: e.z } : null;
  }

  reset() {
    for (const e of this.items.values()) e.el.remove();
    this.items.clear();
  }

  /** Minimap / full-map blips. */
  blips(out) {
    for (const e of this.items.values()) {
      out.push({ x: e.x, z: e.z, kind: e.type === 'm' ? 'pin' + e.slot : e.kind === 'enemy' ? 'pingEnemy' : 'ping' + e.slot });
    }
    return out;
  }

  /**
   * project(vec3-like) -> { x, y } screen px or null (behind the camera); viewer: {x,y,z}.
   * W/H: screen size in px.
   */
  update(dt, project, viewer, W, H) {
    this.time += dt;
    const pad = 28;
    for (const [key, e] of this.items) {
      if (this.time > e.until || (e.target && !e.target.alive)) {
        e.el.remove();
        this.items.delete(key);
        continue;
      }
      if (e.target) {
        e.x = e.target.pos.x;
        e.y = e.target.pos.y;
        e.z = e.target.pos.z;
      }
      const top = e.y + (e.kind === 'enemy' ? 2.2 : e.type === 'm' ? 0.2 : 0.4);
      const sc = project({ x: e.x, y: top, z: e.z });
      let sx;
      let sy;
      let edge = false;
      if (sc && sc.x >= pad && sc.x <= W - pad && sc.y >= pad && sc.y <= H - pad) {
        sx = sc.x;
        sy = sc.y;
      } else {
        // off screen / behind: pin it to the screen edge in its direction
        edge = true;
        let dx = sc ? sc.x - W / 2 : 0;
        let dy = sc ? sc.y - H / 2 : 0;
        if (!sc) {
          // behind the camera: use the world bearing, flipped to the bottom edge
          const ang = Math.atan2(e.x - viewer.x, -(e.z - viewer.z)) - (viewer.heading || 0);
          dx = Math.sin(ang) * W;
          dy = H;
        }
        const k = Math.min((W / 2 - pad) / Math.max(1e-3, Math.abs(dx)), (H / 2 - pad) / Math.max(1e-3, Math.abs(dy)));
        sx = W / 2 + dx * k;
        sy = H / 2 + dy * k;
      }
      e.el.style.transform = `translate(${Math.round(sx)}px, ${Math.round(sy)}px) translate(-50%, -100%)`;
      e.el.classList.toggle('is-edge', edge);
      const d = Math.round(Math.hypot(e.x - viewer.x, e.z - viewer.z));
      if (d !== e.lastD) {
        e.lastD = d;
        e.dist.textContent = d + ' m';
      }
      // fade the last second of a ping
      e.el.style.opacity = e.until - this.time < 1 ? String(Math.max(0, e.until - this.time)) : '';
    }
  }
}
