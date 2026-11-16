// BENTONVILLE ROYALE — in-match emote wheel (hold the emote key, flick the mouse, let go).
//
//   const wheel = createEmoteWheel(hud.el);
//   wheel.show(['emote_cheer', 'emote_sit', null, ...])   // the six equipped emotes
//   wheel.select(i)                                       // highlighted segment, -1 = none
//   wheel.hide()
//
// Six segments clockwise from the top; number keys 1-6 pick directly. A quick tap of the
// emote key (no flick) plays the first emote. Text goes through textContent.

import { emoteDef, EMOTE_SLOTS } from '../game/Cosmetics.js';

const CSS = `
.br-ew{position:absolute;left:50%;top:50%;width:calc(var(--u)*360);height:calc(var(--u)*360);transform:translate(-50%,-50%) scale(.9);
  opacity:0;visibility:hidden;pointer-events:none;z-index:6;transition:opacity .12s ease,transform .16s var(--br-spring),visibility 0s linear .12s}
.br-ew.is-on{opacity:1;visibility:visible;transform:translate(-50%,-50%) scale(1);transition:opacity .12s ease,transform .16s var(--br-spring)}
.br-ew-ring{position:absolute;inset:0;border-radius:50%;background:radial-gradient(circle,rgba(21,16,58,.15) 0 30%,rgba(21,16,58,.72) 31% 100%);
  border:calc(var(--u)*3) solid var(--br-ink)}
.br-ew-seg{position:absolute;left:50%;top:50%;width:calc(var(--u)*104);height:calc(var(--u)*62);margin:calc(var(--u)*-31) 0 0 calc(var(--u)*-52);
  display:flex;flex-direction:column;align-items:center;justify-content:center;gap:calc(var(--u)*2);border-radius:calc(var(--u)*14);
  border:calc(var(--u)*2.5) solid var(--br-ink);background:var(--br-cream);color:var(--br-ink);font-family:var(--br-body);font-weight:900;
  font-size:calc(var(--u)*12);text-align:center;line-height:1.05;box-shadow:0 calc(var(--u)*4) 0 var(--br-ink);transition:transform .1s ease,background-color .1s ease}
.br-ew-seg kbd{font-family:var(--br-display);font-weight:400;font-size:calc(var(--u)*13);opacity:.6}
.br-ew-seg.is-empty{background:rgba(255,246,220,.35);color:rgba(21,16,58,.55)}
.br-ew-seg.is-sel{background:var(--br-sun);transform:scale(1.12)}
.br-ew-mid{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);font-family:var(--br-display);font-size:calc(var(--u)*18);
  color:var(--br-cream);text-shadow:0 calc(var(--u)*2) 0 var(--br-ink);text-align:center;max-width:calc(var(--u)*110)}
@media (prefers-reduced-motion: reduce){.br-ew,.br-ew.is-on,.br-ew-seg{transition:none}}
`;

export function createEmoteWheel(hudEl) {
  if (!document.getElementById('br-ew-css')) {
    const st = document.createElement('style');
    st.id = 'br-ew-css';
    st.textContent = CSS;
    document.head.appendChild(st);
  }
  const root = document.createElement('div');
  root.className = 'br-ew';
  root.setAttribute('aria-hidden', 'true');
  const ring = document.createElement('div');
  ring.className = 'br-ew-ring';
  root.appendChild(ring);
  const mid = document.createElement('div');
  mid.className = 'br-ew-mid';
  root.appendChild(mid);
  const segs = [];
  const R = 118; // segment centre radius in --u
  for (let i = 0; i < EMOTE_SLOTS; i++) {
    const a = (i / EMOTE_SLOTS) * Math.PI * 2;
    const s = document.createElement('div');
    s.className = 'br-ew-seg';
    s.style.transform = '';
    s.style.left = `calc(50% + var(--u) * ${Math.round(Math.sin(a) * R)})`;
    s.style.top = `calc(50% - var(--u) * ${Math.round(Math.cos(a) * R)})`;
    const name = document.createElement('span');
    const key = document.createElement('kbd');
    key.textContent = String(i + 1);
    s.append(name, key);
    root.appendChild(s);
    segs.push({ el: s, name });
  }
  hudEl.appendChild(root);
  let list = [];
  let sel = -2;

  return {
    show(ids) {
      list = (ids || []).slice(0, EMOTE_SLOTS);
      for (let i = 0; i < EMOTE_SLOTS; i++) {
        const d = emoteDef(list[i]);
        segs[i].name.textContent = d ? d.name : 'Empty';
        segs[i].el.classList.toggle('is-empty', !d);
      }
      sel = -2;
      this.select(-1);
      root.classList.add('is-on');
    },
    select(i) {
      if (i === sel) return;
      sel = i;
      segs.forEach((s, k) => s.el.classList.toggle('is-sel', k === i));
      const d = i >= 0 ? emoteDef(list[i]) : null;
      mid.textContent = d ? d.name : 'EMOTE';
    },
    hide() {
      root.classList.remove('is-on');
    },
    isOpen: () => root.classList.contains('is-on'),
  };
}
