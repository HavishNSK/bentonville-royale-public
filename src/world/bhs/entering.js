// BENTONVILLE ROYALE — "Now entering Bentonville High School" banner (DOM, browser only).
// Same behaviour as the Crystal Bridges banner (src/world/crystal-bridges/gallery/ui.js
// `entering`): shown for ~3.6 s each time a playing player crosses into the campus. Styled in
// the school's black and gold [ENT] (docs/bhs/STYLE_BIBLE.md).
//
// The tiger emblem (kit/emblem.js: an ORIGINAL drawing, not the school's logo artwork) STAMPS onto
// the banner's bottom-left corner: it drops in big, rotated and blurred, slams down past its size and
// settles; on impact the banner jolts, a gold shock ring bursts out and the gold rule flashes. The
// emblem hangs partly off the banner (left and bottom); the text keeps clear of it (left padding).

import { drawEmblem } from './kit/emblem.js';

const LOGO = 120; // css px: the emblem's size on screen

const CSS = `
.bhs-enter { position: fixed; left: 50%; top: 17%; transform: translate(-50%, 0); z-index: 40;
  padding: 20px 64px 20px 112px; text-align: center; pointer-events: none; opacity: 0;
  font-family: 'Lilita One', 'Nunito', sans-serif; color: #f4efe2;
  background: linear-gradient(165deg, rgba(14, 12, 8, 0.6), rgba(8, 7, 5, 0.8));
  backdrop-filter: blur(12px); border-top: 2px solid #c9a54a; border-bottom: 1px solid rgba(201, 165, 74, 0.25);
  transition: opacity 0.6s cubic-bezier(.2,.7,.2,1), transform 0.6s cubic-bezier(.2,.7,.2,1); }
.bhs-enter.show { opacity: 1; transform: translate(-50%, 6px); animation: bhsJolt 0.34s 0.62s ease-out both; }
.bhs-enter .k { font-family: 'Nunito', sans-serif; font-weight: 700; font-size: 12px; letter-spacing: 0.55em; text-indent: 0.55em; color: #b8964a; }
.bhs-enter .t { margin-top: 6px; font-size: 36px; letter-spacing: 0.12em; text-indent: 0.12em; white-space: nowrap; }
.bhs-enter .s { margin-top: 4px; font-family: 'Nunito', sans-serif; font-size: 13px; font-weight: 700; letter-spacing: 0.32em; text-indent: 0.32em; color: #c9a54a; }
.bhs-enter .logo { position: absolute; left: -46px; bottom: -44px; width: ${LOGO}px; height: ${LOGO}px;
  opacity: 1; transform: rotate(-8deg); transform-origin: 50% 50%; filter: drop-shadow(0 6px 10px rgba(0, 0, 0, 0.55)); }
.bhs-enter .logo canvas { width: 100%; height: 100%; display: block; }
.bhs-enter .ring { position: absolute; inset: 0; border-radius: 50%; border: 4px solid #e0c062; opacity: 0; }
.bhs-enter .flash { position: absolute; left: 0; right: 0; top: -2px; height: 2px; background: #fff1c2; opacity: 0; }
.bhs-enter.show .logo { animation: bhsStamp 0.5s 0.3s cubic-bezier(.3,.9,.35,1.25) both; }
.bhs-enter.show .ring { animation: bhsRing 0.55s 0.62s ease-out both; }
.bhs-enter.show .flash { animation: bhsFlash 0.5s 0.62s ease-out both; }
@keyframes bhsStamp {
  0% { opacity: 0; transform: scale(3.2) rotate(-28deg); filter: blur(4px) drop-shadow(0 30px 30px rgba(0,0,0,0.6)); }
  60% { opacity: 1; transform: scale(0.86) rotate(5deg); filter: blur(0) drop-shadow(0 2px 3px rgba(0,0,0,0.7)); }
  78% { transform: scale(1.07) rotate(-10deg); }
  100% { opacity: 1; transform: scale(1) rotate(-8deg); filter: drop-shadow(0 6px 10px rgba(0,0,0,0.55)); }
}
@keyframes bhsRing { 0% { opacity: 0.95; transform: scale(0.7); } 100% { opacity: 0; transform: scale(1.9); } }
@keyframes bhsFlash { 0% { opacity: 1; } 100% { opacity: 0; } }
@keyframes bhsJolt {
  0% { transform: translate(-50%, 6px); }
  25% { transform: translate(calc(-50% - 5px), 10px); }
  50% { transform: translate(calc(-50% + 4px), 3px); }
  75% { transform: translate(calc(-50% - 2px), 7px); }
  100% { transform: translate(-50%, 6px); }
}
@media (prefers-reduced-motion: reduce) {
  .bhs-enter { transition-duration: 0.01s; }
  .bhs-enter.show, .bhs-enter.show .logo, .bhs-enter.show .ring, .bhs-enter.show .flash { animation: none; }
  .bhs-enter.show .logo { opacity: 1; transform: rotate(-8deg); }
}
`;

/** The emblem drawn into a canvas at the screen's pixel density. */
function emblemCanvas() {
  const dpr = Math.min(3, (typeof window !== 'undefined' && window.devicePixelRatio) || 1);
  const cv = document.createElement('canvas');
  cv.width = cv.height = Math.round(LOGO * dpr);
  const ctx = cv.getContext('2d');
  ctx.scale(cv.width / 256, cv.height / 256);
  drawEmblem(ctx);
  cv.setAttribute('aria-hidden', 'true');
  return cv;
}

/** createEnteringBanner() -> { show(), dispose() } (a no-op outside the browser). */
export function createEnteringBanner() {
  if (typeof document === 'undefined') return { show() {}, dispose() {} };
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
  const el = document.createElement('div');
  el.className = 'bhs-enter';
  el.setAttribute('role', 'status');
  el.setAttribute('aria-live', 'polite');
  const line = (cls, text) => {
    const d = document.createElement('div');
    d.className = cls;
    d.textContent = text;
    return d;
  };
  const logo = document.createElement('div');
  logo.className = 'logo';
  const ring = document.createElement('div');
  ring.className = 'ring';
  logo.append(emblemCanvas(), ring);
  const flash = document.createElement('div');
  flash.className = 'flash';
  el.append(flash, line('k', 'NOW ENTERING'), line('t', 'BENTONVILLE HIGH SCHOOL'), line('s', 'HOME OF THE TIGERS'), logo);
  document.body.appendChild(el);
  let t = 0;
  return {
    show() {
      clearTimeout(t);
      // restart the stamp every time: drop the class, force a reflow, add it back
      el.classList.remove('show');
      void el.offsetWidth;
      el.classList.add('show');
      t = setTimeout(() => el.classList.remove('show'), 3600);
    },
    dispose() {
      clearTimeout(t);
      el.remove();
      style.remove();
    },
  };
}

/** Is (x, z) on the BHS campus tile (composed map, docs/bhs/BHS_CONTRACT.md)? */
export const onCampus = (x, z) => x > -125 && x < 125 && z > 135 && z < 460;
