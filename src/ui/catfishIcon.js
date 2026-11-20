// BENTONVILLE ROYALE — the catfish icon (Catfish Ken's reboot vans): one original outline in a
// 48x48 box, nose to the right, shared by the inline-SVG HUD icon (icons.js 'catfish') and the
// minimap / full-map van marker (drawn on canvas from the same SVG path data via Path2D).

export const CATFISH_ICON = Object.freeze({
  // wide flat head, tapering body, forked tail and a dorsal fin
  body: 'M43 25C43 19 38 15 30 15C24 15 19 17 14 21L5 14L9 25L5 36L14 29C19 33 24 35 30 35C38 35 43 31 43 25ZM22 17L26 9.5L33 15.5Z',
  belly: 'M17 29.5C21.5 32 25.5 33.5 30 33.5C35.5 33.5 39.5 31.5 41.5 28C36 30.5 25 31.5 17 29.5Z',
  // barbels: two long ones drooping from the mouth, a short one curling up off the snout
  whiskers: 'M41 28Q46 31 45 39M37 30Q40 36 35.5 41M42 22Q46.5 20 45.5 14',
  mouth: 'M43 26.5Q39 29.5 34 27.5',
  eye: { cx: 35, cy: 21, r: 3.2, pupil: 1.6 },
});

export const CATFISH_FILL = '#8a5cf0'; // violet, the van's purple spray
const INK = '#0a0a14';
const CREAM = '#fff1d6';

/** Inline-SVG body for a 48x48 viewBox (ink outline, flat fills). */
export function catfishSvg(fill = CATFISH_FILL) {
  const C = CATFISH_ICON;
  const e = C.eye;
  return (
    `<path d="${C.whiskers}" fill="none" stroke="${INK}" stroke-width="3" stroke-linecap="round"/>` +
    `<path d="${C.body}" fill="${INK}" stroke="${INK}" stroke-width="6" stroke-linejoin="round"/>` +
    `<path d="${C.body}" fill="${fill}"/>` +
    `<path d="${C.belly}" fill="${CREAM}"/>` +
    `<path d="${C.mouth}" fill="none" stroke="${INK}" stroke-width="2" stroke-linecap="round"/>` +
    `<circle cx="${e.cx}" cy="${e.cy}" r="${e.r}" fill="#fff" stroke="${INK}" stroke-width="1.5"/>` +
    `<circle cx="${e.cx + 0.8}" cy="${e.cy}" r="${e.pupil}" fill="${INK}"/>`
  );
}

let _paths = null;
function paths() {
  if (!_paths) {
    const C = CATFISH_ICON;
    _paths = { body: new Path2D(C.body), belly: new Path2D(C.belly), whiskers: new Path2D(C.whiskers), mouth: new Path2D(C.mouth) };
  }
  return _paths;
}

/**
 * Map marker: the catfish filled with the van's state colour, ink outline and a white halo so it
 * reads over any map colour. Draws into a (26 * k) px square sprite, centred.
 */
export function drawCatfishMarker(g, k, fill) {
  const P = paths();
  const e = CATFISH_ICON.eye;
  const s = (26 * k) / 48;
  g.save();
  g.scale(s, s);
  g.lineJoin = 'round';
  g.lineCap = 'round';
  // white halo, then the ink outline
  g.strokeStyle = '#ffffff';
  g.lineWidth = 9;
  g.stroke(P.body);
  g.lineWidth = 7;
  g.stroke(P.whiskers);
  g.strokeStyle = INK;
  g.lineWidth = 4.5;
  g.stroke(P.body);
  g.lineWidth = 3;
  g.stroke(P.whiskers);
  // flat fills and the face
  g.fillStyle = fill;
  g.fill(P.body);
  g.fillStyle = CREAM;
  g.fill(P.belly);
  g.strokeStyle = INK;
  g.lineWidth = 2.2;
  g.stroke(P.mouth);
  g.fillStyle = '#ffffff';
  g.beginPath();
  g.arc(e.cx, e.cy, e.r, 0, Math.PI * 2);
  g.fill();
  g.lineWidth = 1.5;
  g.stroke();
  g.fillStyle = INK;
  g.beginPath();
  g.arc(e.cx + 0.8, e.cy, e.pupil, 0, Math.PI * 2);
  g.fill();
  g.restore();
}
