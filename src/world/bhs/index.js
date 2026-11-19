// BENTONVILLE ROYALE — Bentonville High School: the bespoke landmark (lead-owned glue).
//
//   applyBhsOverrides(mapData)          // data.js, already run by the World constructor
//   const bhs = createBhs(world, data)  // after Crystal Bridges, BEFORE generic buildings register
//                                       // (stadium + kit colliders get stable sequential box ids)
//   bhs.skipBuilding(id)                // generic map buildings the bespoke ones replace
//   const view = await bhs.buildMeshes(root)
//   view.update(dt, ctx) ; view.owns(col) ; view.hideCollider(col) ; view.showCollider(col)
//
// Pieces (docs/bhs/BHS_CONTRACT.md, docs/bhs/STYLE_BIBLE.md):
//   stadium.js / stadiumMeshes.js   Tiger Stadium
//   kit/                            the BHS building kit (palette, builder, plan engine, materials, meshes)
//   north.js / south.js             the two school buildings, built with the kit (bespoke: replace
//                                   952075843 / 952075842); interior/* the hero spaces + classrooms
//   entering.js                     the "Now entering Bentonville High School" banner

import { BHS_STADIUM_SITE, hasBhs } from './data.js';
import { buildStadium } from './stadium.js';
import { createKit } from './kit/builder.js';
import { createKitNav, combineNav } from './kit/nav.js';
import { buildNorth, NORTH_ID } from './north.js';
import { buildSouth, SOUTH_ID } from './south.js';
import { buildGym } from './interior/gym/index.js';
import { buildLibrary } from './interior/library/index.js';
import { buildArend } from './interior/arend/index.js';
import { dressClassrooms } from './interior/classrooms/index.js';
import { dressFill, fillGroundGaps } from './fill.js';
import { onCampus } from './entering.js';

export { hasBhs };

/** Colliders built by the BHS module carry owner = BHS_OWNER (WorldMeshes routes hide/show by it). */
export const BHS_OWNER = 'bhs';

/** Generic map buildings replaced by bespoke kit buildings. */
export const BHS_BESPOKE = Object.freeze([NORTH_ID, SOUTH_ID]);

export function createBhs(world, mapData) {
  const stadium = buildStadium(world, { site: BHS_STADIUM_SITE, owner: BHS_OWNER, mapData });
  // both school buildings, bespoke (kit): generic scatter keeps off their footprints and plazas
  const kit = createKit(world, { owner: BHS_OWNER, seed: 20061 });
  world.reserve([[-52, 162], [66, 162], [66, 270], [-52, 270]]);
  world.reserve([[-116, 289], [116, 289], [116, 431], [-116, 431]]);
  const north = buildNorth(kit);
  const south = buildSouth(kit, { gym: buildGym, library: buildLibrary, arend: buildArend });
  dressClassrooms(kit, [...north.rooms, ...south.rooms].filter((r) => ['classroom', 'lab', 'music', 'gallery'].includes(r.kind)));
  dressFill(kit, [north, south]);
  fillGroundGaps(kit, [north, south]);
  world.fixedLoot = (world.fixedLoot || []).concat(kit.lootSpots);
  // bots: a waypoint graph generated from both plans, alongside Crystal Bridges' graph (Bots.js world.siteNav)
  const nav = createKitNav(kit, [north, south]);
  world.siteNav = combineNav(world.siteNav, nav);
  const skip = new Set(BHS_BESPOKE);
  return {
    stadium,
    kit,
    north,
    south,
    nav,
    skipBuilding: (id) => skip.has(id),
    async buildMeshes(root) {
      const [{ buildStadiumMeshes }, { buildKitMeshes }, { createEnteringBanner }] = await Promise.all([
        import('./stadiumMeshes.js'),
        import('./kit/meshes.js'),
        import('./entering.js'),
      ]);
      const st = buildStadiumMeshes({ root, world, parts: stadium.parts });
      const km = buildKitMeshes({ root, kit, name: 'bhs' });
      const banner = createEnteringBanner();
      let wasIn = false;
      return {
        stadium: st,
        kit: km,
        owns: (col) => !!col && col.owner === BHS_OWNER,
        update(dt, ctx) {
          if (st && st.update) st.update(dt, ctx);
          km.update(dt, ctx);
          // "Now entering" banner: once per crossing into the campus while playing
          const p = ctx && ctx.player && ctx.player.pos;
          if (p) {
            const inside = onCampus(p.x, p.z);
            if (inside && !wasIn && ctx.game && ctx.game.state === 'play') banner.show();
            wasIn = inside;
          }
        },
        hideCollider: (col) => (km.owns(col) ? km.hideCollider(col) : st && st.hideCollider && st.hideCollider(col)),
        showCollider: (col) => (km.owns(col) ? km.showCollider(col) : st && st.showCollider && st.showCollider(col)),
      };
    },
  };
}
