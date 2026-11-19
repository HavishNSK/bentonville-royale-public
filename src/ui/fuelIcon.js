// BENTONVILLE ROYALE — the fuel-pump pictogram (gas stations): one original outline in a 48x48
// box, shared by the inline-SVG HUD icon (icons.js 'fuel'), the minimap / full-map station marker
// (drawn on canvas from the same SVG path data via Path2D) and the station's sign
// (render/GasStationMesh.js). A generic pump shape: no brand emblem.

export const FUEL_ICON = Object.freeze({
  // pump body with a rounded top on a wide foot
  body: 'M10 41V11C10 8.5 12 6.5 14.5 6.5H26.5C29 6.5 31 8.5 31 11V41H34V45H7V41Z',
  // display window
  screen: 'M14 11.5H27V21H14Z',
  // hose from the side of the pump down and up to the nozzle hook
  hose: 'M31 17H35C37 17 38.5 18.5 38.5 20.5V36C38.5 38 40 39.5 41.5 39.5C43 39.5 44.5 38 44.5 36V16L40.5 11',
});

export const FUEL_FILL = '#ffc21f'; // sun gold
const INK = '#0a0a14';
const CREAM = '#fff1d6';

/** Inline-SVG body for a 48x48 viewBox (ink outline, flat fills). */
export function fuelSvg(fill = FUEL_FILL) {
  const F = FUEL_ICON;
  return (
    `<path d="${F.hose}" fill="none" stroke="${INK}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>` +
    `<path d="${F.body}" fill="${INK}" stroke="${INK}" stroke-width="6" stroke-linejoin="round"/>` +
    `<path d="${F.hose}" fill="none" stroke="${fill}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>` +
    `<path d="${F.body}" fill="${fill}"/>` +
    `<path d="${F.screen}" fill="${CREAM}" stroke="${INK}" stroke-width="2" stroke-linejoin="round"/>`
  );
}

let _paths = null;
function paths() {
  if (!_paths) {
    const F = FUEL_ICON;
    _paths = { body: new Path2D(F.body), screen: new Path2D(F.screen), hose: new Path2D(F.hose) };
  }
  return _paths;
}

/**
 * Map marker: the pump in `fill`, ink outline and a white halo so it reads over any map colour.
 * Draws into a (size * k) px square sprite.
 */
export function drawFuelMarker(g, k, fill = FUEL_FILL, size = 24) {
  const P = paths();
  const s = (size * k) / 48;
  g.save();
  g.scale(s, s);
  g.lineJoin = 'round';
  g.lineCap = 'round';
  // white halo, then the ink outline
  g.strokeStyle = '#ffffff';
  g.lineWidth = 10;
  g.stroke(P.body);
  g.stroke(P.hose);
  g.strokeStyle = INK;
  g.lineWidth = 6;
  g.stroke(P.body);
  g.stroke(P.hose);
  // flat fills
  g.fillStyle = fill;
  g.fill(P.body);
  g.strokeStyle = fill;
  g.lineWidth = 2.6;
  g.stroke(P.hose);
  g.fillStyle = CREAM;
  g.fill(P.screen);
  g.strokeStyle = INK;
  g.lineWidth = 2;
  g.stroke(P.screen);
  g.restore();
}
