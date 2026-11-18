// BENTONVILLE ROYALE — Crystal Bridges statues (pure data; no three.js).
//
// Stone figures on plinths around the museum: a pair guarding each entrance, one or two per
// gallery (kept out of bot lanes, clear of the hang walls) and a few on the outdoor terraces.
// build.js registers a plinth box (drawn with the site's stone) plus a hidden collider for the
// figure; meshes.js loads the GLBs and draws one InstancedMesh per model.
//
// Models live in public/assets/statues/ (credits in public/assets/statues/CREDITS.md). Every
// model is +Y up with its origin at the base centre; `h` is its native height (m) and `r` its
// native footprint half-width (m), from the GLB bounds. The figure's front is native +z.

export const STATUE_MODELS = Object.freeze({
  dragon: { url: '/assets/statues/dragon.glb', h: 1.17, r: 0.43 }, // carries its own base
  gargoyle: { url: '/assets/statues/gargoyle.glb', h: 1.28, r: 0.51 },
  guardian: { url: '/assets/statues/guardian.glb', h: 2.4, r: 0.54 },
  marble: { url: '/assets/statues/broken-statue.glb', h: 2.26, r: 0.62 },
  idol: { url: '/assets/statues/idol.glb', h: 0.98, r: 0.3 },
  obelisk: { url: '/assets/statues/obelisk.glb', h: 4.65, r: 0.75 },
});

/**
 * { id, model, x, z, s: scale, plinth: plinth height (m, 0 = none), face: [fx, fz] direction
 *   the figure looks, near: pavilion / pad id (documentation; build.js finds the ground) }
 */
export const STATUES = Object.freeze([
  // ---- main entrance (east crest colonnade): obelisks at the street end, dragons at the door
  { id: 'main-obelisk-n', model: 'obelisk', x: 70.6, z: -244.4, s: 0.85, plinth: 0.35, face: [1, 0], near: 'colonnade' },
  { id: 'main-obelisk-s', model: 'obelisk', x: 70.6, z: -233.6, s: 0.85, plinth: 0.35, face: [1, 0], near: 'colonnade' },
  { id: 'main-guardian-n', model: 'guardian', x: 64.5, z: -244.6, s: 1.05, plinth: 0.5, face: [0, 1], near: 'colonnade' },
  { id: 'main-guardian-s', model: 'guardian', x: 64.5, z: -233.4, s: 1.05, plinth: 0.5, face: [0, -1], near: 'colonnade' },
  { id: 'main-dragon-n', model: 'dragon', x: 60.4, z: -244.6, s: 1.7, plinth: 0.45, face: [1, 0.35], near: 'colonnade' },
  { id: 'main-dragon-s', model: 'dragon', x: 60.4, z: -233.4, s: 1.7, plinth: 0.45, face: [1, -0.35], near: 'colonnade' },
  // Entrance Hall: two tall marble figures either side of the stair, seen all the way down
  { id: 'hall-marble-n', model: 'marble', x: 49, z: -244.4, s: 1.55, plinth: 0.8, face: [0, 1], near: 'entry-tower' },
  { id: 'hall-marble-s', model: 'marble', x: 49, z: -233.6, s: 1.55, plinth: 0.8, face: [0, -1], near: 'entry-tower' },
  // ---- south entrance: gargoyles just inside the South Lobby door, facing whoever comes in
  { id: 'south-gargoyle-w', model: 'gargoyle', x: -6.4, z: -159.6, s: 1.15, plinth: 0.9, face: [0, 1], near: 'south-lobby' },
  { id: 'south-gargoyle-e', model: 'gargoyle', x: 8.4, z: -159.6, s: 1.15, plinth: 0.9, face: [0, 1], near: 'south-lobby' },
  // ---- galleries
  { id: 'lobby-dragon', model: 'dragon', x: 16.3, z: -247.6, s: 1.9, plinth: 0.6, face: [1, -1], near: 'lobby' },
  { id: 'ea1-idol', model: 'idol', x: 50.5, z: -292.5, s: 1.0, plinth: 1.0, face: [-1, 1], near: 'early-american-1' },
  { id: 'ea2-guardian', model: 'guardian', x: 50.5, z: -307.5, s: 1.0, plinth: 0.5, face: [-1, -1], near: 'early-american-2' },
  { id: 'reflection-dragon', model: 'dragon', x: 43, z: -346.6, s: 2.2, plinth: 0.7, face: [0, 1], near: 'reflection' },
  { id: 'north-gargoyle', model: 'gargoyle', x: 21.6, z: -368.6, s: 1.2, plinth: 1.0, face: [1, 1], near: 'north-gallery' },
  { id: 'contemporary-marble', model: 'marble', x: -52.4, z: -276, s: 1.2, plinth: 0.6, face: [1, -1], near: 'contemporary' },
  { id: 'contemporary-idol', model: 'idol', x: -39.6, z: -340.4, s: 1.1, plinth: 1.0, face: [-1, 1], near: 'contemporary' },
  { id: 'lower-west-guardian', model: 'guardian', x: -52.6, z: -360.6, s: 1.1, plinth: 0.5, face: [1, 1], near: 'lower-west' },
  { id: 'west26-dragon', model: 'dragon', x: -52.4, z: -380, s: 2.0, plinth: 0.6, face: [1, 0], near: 'west-wing-2026' },
  { id: 'west26-marble', model: 'marble', x: -39.6, z: -410, s: 1.25, plinth: 0.6, face: [-1, 0], near: 'west-wing-2026' },
  { id: 'west26-gargoyle', model: 'gargoyle', x: -52.4, z: -440, s: 1.2, plinth: 1.0, face: [1, 0], near: 'west-wing-2026' },
  { id: 'east26-obelisk', model: 'obelisk', x: 54.4, z: -448.4, s: 0.9, plinth: 0.3, face: [-1, 1], near: 'east-wing-2026' },
  { id: 'east26-guardian', model: 'guardian', x: 39.6, z: -389.2, s: 1.1, plinth: 0.5, face: [1, -1], near: 'east-wing-2026' },
  { id: 'great-hall-idol', model: 'idol', x: -31.2, z: -197.2, s: 1.0, plinth: 1.0, face: [1, 1], near: 'great-hall' },
  { id: 'store-idol', model: 'idol', x: 55.4, z: -252.6, s: 0.9, plinth: 1.0, face: [-1, -1], near: 'store' },
  // ---- outdoors: terraces and the top of the lawn path
  { id: 'terrace-gargoyle', model: 'gargoyle', x: 48, z: -302, s: 1.2, plinth: 0.9, face: [1, 0], near: 'east-terrace' },
  { id: 'walker-gargoyle-w', model: 'gargoyle', x: 8.8, z: -274, s: 1.1, plinth: 0.9, face: [0, -1], near: 'walker-terrace' },
  { id: 'walker-gargoyle-e', model: 'gargoyle', x: 28.6, z: -274, s: 1.1, plinth: 0.9, face: [0, -1], near: 'walker-terrace' },
  { id: 'trail-obelisk-w', model: 'obelisk', x: -8.5, z: -137.5, s: 0.8, plinth: 0.3, face: [0, 1], near: 'south-lawn-path' },
  { id: 'trail-obelisk-e', model: 'obelisk', x: 10.5, z: -137.5, s: 0.8, plinth: 0.3, face: [0, 1], near: 'south-lawn-path' },
]);

/** Plinth half-width for a statue (a little wider than the figure's footprint). */
export function plinthHalf(st) {
  return STATUE_MODELS[st.model].r * st.s + 0.18;
}
