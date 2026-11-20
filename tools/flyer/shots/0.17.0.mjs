// Shot list for the v0.17.0 "BOMBS and Bridges" flyer (src/data/updateFlyer.js). Format:
// tools/flyer/shots.mjs. Capture: node tools/flyer/capture.mjs --version 0.17.0
//
// Crystal Bridges coordinates come from src/world/crystal-bridges/site.js (PAVILIONS, LEVEL:
// MAIN floor y = -7, CREST y = 0); the main entrance is the Entrance Hall's east side (x = 56,
// z -242..-236).
export default {
  version: '0.17.0',
  shots: [
    // items first: they need no world setup
    { kind: 'item', file: 'bb-item-rocket-launcher.png', item: 'rocket_launcher', yaw: 62, elev: 16, fill: 1.05 },
    { kind: 'item', file: 'bb-item-grenade.png', item: 'grenade', yaw: 35, elev: 14, fill: 0.92 },
    { kind: 'item', file: 'bb-item-smoke.png', item: 'smoke', yaw: 35, elev: 14, fill: 0.92 },
    {
      kind: 'scene',
      file: 'bb-entrance.jpg',
      note: 'main entrance from the lawn to its east: obelisks, guardians, dragons, the sign',
      camera: { pos: { x: 77, y: 1.6, z: -239 }, lookAt: { x: 56, y: 4, z: -239 }, fov: 64 },
    },
    {
      kind: 'scene',
      file: 'bb-gallery.jpg',
      note: 'down the length of the first Early American gallery, paintings on both walls',
      player: { x: 43, y: -7, z: -294 },
      camera: { pos: { x: 43, y: -5.2, z: -295 }, lookAt: { x: 43, y: -5.8, z: -272 }, fov: 70 },
    },
    {
      kind: 'scene',
      file: 'bb-van.jpg',
      note: "Catfish Ken's van at Bentonville Square, from the north-west",
      camera: { target: { ref: 'van:square', dy: -0.4 }, heading: 2.4, pitch: -0.03, distance: 8.5, fov: 62 },
    },
    {
      // last: it blows a hole in the roof (reset restores panels, but keep destruction at the end)
      kind: 'scene',
      file: 'bb-roof-blast.jpg',
      note: 'looking up inside the Great Hall as a rocket tears through the copper roof',
      player: { x: -26, y: -7, z: -192 },
      camera: { pos: { x: -26, y: -5.4, z: -195 }, lookAt: { x: -26, y: 3, z: -187 }, fov: 74 },
      setup: [{ do: 'breakRoof', at: { x: -26, y: 2.6, z: -188 } }, { do: 'wait', ms: 160 }],
    },
  ],
};
