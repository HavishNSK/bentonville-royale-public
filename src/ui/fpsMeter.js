// BENTONVILLE ROYALE — tiny FPS overlay (settings: showFps). Self-driven by
// requestAnimationFrame, so it needs no hook in the game loop; it only runs while shown.
//
//   const fps = createFpsMeter(document.body);
//   fps.setVisible(true);   fps.value -> last measured fps

// One meter per parent: the settings screen (menus.js) and Game.applySettings both call
// createFpsMeter(document.body) and get the same overlay.
const meters = new WeakMap();

// Optional diagnostics under the number (Game: frame cost, mouse rate, lock, resolution, GPU),
// so a player can screenshot it when their FPS drops.
let detailFn = null;
export function setFpsDetails(fn) {
  detailFn = typeof fn === 'function' ? fn : null;
}

export function createFpsMeter(parent = document.body) {
  const had = meters.get(parent);
  if (had) return had;
  const el = document.createElement('div');
  el.className = 'br-fps';
  el.setAttribute('aria-hidden', 'true');
  el.hidden = true;
  parent.appendChild(el);

  let raf = 0;
  let frames = 0;
  let last = 0;
  let value = 0;

  function tick(now) {
    raf = requestAnimationFrame(tick);
    if (!last) last = now;
    frames++;
    const span = now - last;
    if (span >= 500) {
      value = Math.round((frames * 1000) / span);
      let extra = '';
      try {
        extra = detailFn ? detailFn() || '' : '';
      } catch {
        extra = '';
      }
      el.textContent = value + ' FPS' + (extra ? '\n' + extra : '');
      frames = 0;
      last = now;
    }
  }

  const meter = {
    el,
    get value() {
      return value;
    },
    get visible() {
      return !el.hidden;
    },
    setVisible(on) {
      on = !!on;
      if (on === !el.hidden) return;
      el.hidden = !on;
      cancelAnimationFrame(raf);
      raf = 0;
      if (on) {
        frames = 0;
        last = 0;
        el.textContent = '— FPS';
        raf = requestAnimationFrame(tick);
      }
    },
  };
  meters.set(parent, meter);
  return meter;
}
