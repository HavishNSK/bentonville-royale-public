// Shot list for the v0.20.0 "BHS and Box Fights" flyer (src/data/updateFlyer.js). Format:
// tools/flyer/shots.mjs. Capture: node tools/flyer/capture.mjs --version 0.20.0
//
// Bentonville High coordinates come from src/world/bhs/north.js (main entrance niche on the
// North Building's west face, x -38.4..-34.6, z 241..250.6; flag pole at x -48.4, z 229.5) and
// src/world/bhs/south.js (AREND_HOUSE / AREND_STAGE, ARENA). Ground is y 0 there.
//
// Box Fights shots start a real local box fight through the dev-only `eval` action
// (game.startMatch(undefined, { boxFight: { size } }), as main.js playBoxFight does) and run on a
// fresh boot each: the arena takes over the world, so they go last. The arena for size 2 is
// x -240..-208, z 160..192, floor y 300 (src/game/BoxFights.js arenaLayout); the middle wall runs
// east-west along z 176. Our team spawns on the north half.
const startBox = (size, hold) => `
  game.settings.difficulty = 'normal';
  game.startMatch(undefined, { boxFight: { size: ${size} } });
  await studio.sleep(400);
  const bf = game.boxFight;
  if (!bf) throw new Error('box fight did not start');
  ${hold ? 'bf.state = { ...bf.state, t: 999 }; // hold the countdown: the middle wall stays up' : ''}
  return { size: bf.size, phase: bf.state.phase };
`;
// Waits for FIGHT (the wall lifts), keeps the player alive, builds one ramp in front of them,
// then lets the bots fight for `after` ms (a round can end in ~5 s, which raises the wall again).
const fightFor = (size, after) => `
  game.settings.difficulty = 'normal';
  game.startMatch(undefined, { boxFight: { size: ${size} } });
  const t0 = performance.now();
  while (game.boxFight && game.boxFight.state.phase !== 'fight' && performance.now() - t0 < 15000) await studio.sleep(50);
  if (!game.boxFight || game.boxFight.state.phase !== 'fight') throw new Error('box fight never reached FIGHT');
  game.player.god = true;
  const ramp = window.__game.debug.build('ramp');
  if (game.player.setBuildPiece) game.player.setBuildPiece(null); // no ghost preview in the shot
  await studio.sleep(${after});
  return { phase: game.boxFight.state.phase, ramp, alive: game.combat.actors.filter((a) => a.alive).length };
`;

export default {
  version: '0.20.0',
  shots: [
    {
      kind: 'scene',
      file: 'v20-bhs-entrance.jpg',
      note: 'hero: the North Building main entrance from the plaza to its south-west, the flag on the left (clear of the stadium light poles)',
      camera: { pos: { x: -56, y: 2.2, z: 251 }, lookAt: { x: -37, y: 7, z: 236 }, fov: 72 },
    },
    {
      kind: 'scene',
      file: 'v20-bhs-arts.jpg',
      note: 'Arend Arts Center: from the side of the house over the seats toward the stage and its red curtain',
      player: { x: 60, y: 0, z: 300 },
      camera: { pos: { x: 55, y: 4, z: 298 }, lookAt: { x: 96, y: 3, z: 312 }, fov: 70 },
    },
    {
      kind: 'scene',
      file: 'v20-bhs-arena.jpg',
      note: 'Tiger Arena: high corner view over the painted court and bleachers',
      player: { x: -69, y: 0, z: 341 },
      camera: { pos: { x: -90, y: 10, z: 316 }, lookAt: { x: -62, y: 1, z: 346 }, fov: 66 },
    },
    {
      kind: 'scene',
      file: 'v20-box-wall.jpg',
      fresh: true,
      note: 'a 2v2 box fight during the countdown: our side, the middle wall up across the arena',
      hidePlayer: false,
      camera: { pos: { x: -224, y: 303.6, z: 160.8 }, lookAt: { x: -224, y: 302, z: 176 }, fov: 72 },
      settle: 800,
      setup: [{ do: 'eval', js: startBox(2, true) }, { do: 'wait', ms: 1500 }],
    },
    {
      kind: 'scene',
      file: 'v20-box-fight.jpg',
      fresh: true,
      note: 'a 2v2 box fight a few seconds after FIGHT, from high in our north-west corner: ramps, walls, the other team',
      hidePlayer: false,
      camera: { pos: { x: -239.3, y: 305.3, z: 160.8 }, lookAt: { x: -222, y: 300.3, z: 180 }, fov: 76 },
      settle: 800,
      setup: [{ do: 'eval', js: fightFor(2, 5000) }],
    },
  ],
};
