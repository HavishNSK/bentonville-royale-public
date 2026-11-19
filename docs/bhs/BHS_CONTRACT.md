# Bentonville High School: build contract (v2, accuracy rebuild)

The lead owns this file. Read it, `docs/bhs/STYLE_BIBLE.md` and `AGENTS.md` before writing any code.

## Goal
BHS must look like the real Bentonville High School, inside and out, matched against the user's
reference photos (spec: `BHS_ACCURACY_FIX_PROMPT.md`, kept outside the repo). Both school buildings
are **bespoke kit buildings** (`src/world/bhs/`), not generic map buildings. The look is owned by
one eye, the lead: you use the kit, you don't invent your own architecture style.

## Rules (non-negotiable)
- **Reference photos are private.**
  - They live in `~/Pictures/bhs-refs` (override with `BHS_REFS`). Decoded copies are in `...\bhs-refs\_work\decoded\*.png` (some files are AVIF or WebP, so use the decoded PNGs).
  - Never copy, move, rename, edit or symlink them into the repo, and never use them as textures.
  - Comparisons and anything else derived from them go in `~/Pictures/bhs-refs/_work/` (outside the repo).
  - A pre-commit hook enforces this.
- **Logos and text.** No school logos or mascot art copied from photos. The kit's `emblem` look is an *original* tiger emblem drawn for this project; use it where the real school shows its emblem. No real student or staff names, no room numbers, no readable copyrighted text, no security details (cameras, alarm panels, access hardware), no official floor plans.
- **Ownership.** Edit ONLY your own folder and test file. Don't edit `kit/`, `plan.js`, `north.js`, `south.js`, `index.js`, `World*.js` or any other shared file. If you need a kit change, put it in your report with the exact diff. Don't run git stash, checkout, reset or commit.
- **Map scripts.** Never run `npm run fetch-map`, `compose-map` or `swap-tile`.

## Coordinates
Composed-world metres: x east, z **south**, y up; ground is y = 0, floor-to-floor 4.4 m.
- North Building: x -46..65, z 164..269 (3 storeys, roof 13.2).
- South (main) building: x -114..114, z 291..429 (2 storeys, roof 8.8; raised volumes are higher).
- Hero rects are exported from `src/world/bhs/south.js`: `ARENA`, `AUX_GYM`, `CAFE`, `AREND_LOBBY`,
  `AREND_HOUSE`, `AREND_STAGE`, `LIBRARY` (each `{ x0, x1, z0, z1, top }`).
- Plan rooms are in `plan.rooms` (`{ id, level, x0, x1, z0, z1, kind, label, doors, tall, ... }`).
  `ctx.plan.roomAt(x, z, level)` finds a room.

## The kit (`src/world/bhs/kit/`)
`builder.js` (pure, runs in Node) gives you K:
- `K.box(o, { mat, look, faces, hp, walkable, role })`: a collider plus a drawn box.
  - `o = { cx, cz, hx, hz, yaw, y0, y1 }`.
  - `mat`: `'brick' | 'block' | 'metal' | 'wood' | 'glass' | 'solid'`. Everything breaks except `'solid'` (floors, stairs).
  - `faces = { pu, nu, pv, nv, top, bottom }` sets per-face looks; `'none'` hides a face.
- `K.decor(o, look, { faces, dep, shape: 'cyl' })`: drawn only. `dep` = the part it rests on; the decor hides when that part breaks.
- Structure: `K.wall(a, b, { y0, y1, t, out, lookOut, lookIn, openings })`, `K.slab(rect, y, opts)`,
  `K.stairs(a, b, y0, y1, w, { rail: 'glass' | 'picket' })`, `K.railing(a, b, y, { style })`,
  `K.column(x, z, y0, y1, { r, look })`.
- Lighting and gameplay: `K.light({ x, y, z, range, intensity, color })` places light spots; a pool of real lights follows the camera. `K.loot({ kind: 'chest' | 'ammoBox' | 'item', x, y, z, yaw, tier? })`.
- Determinism: `K.rnd()` is a seeded RNG. Use it, never `Math.random`.
- Interior streaming: `K.setGroup('int:south:0')` (`int:<north|south>:<level>`). Interior groups are hidden beyond 95 m. Set the group before you add pieces.
- **Looks** (`materials.js`, colours from `palette.js` = the style bible):
  - building: `brick`, `brickBand`, `buffBrick`, `buffStone`, `buffFascia`, `cmuLight`, `blockGrey`, `metalWhite`, `metalGrey`, `canopy`, `coping`, `alu`, `glass`
  - floors: `paving`, `terrazzo`, `terrazzoDark`, `vct`, `carpet`, `carpetBand`
  - walls, ceilings, trim: `wood`, `column`, `banner`, `libWall`, `libPier`, `ceilingTile`, `aacCeiling`, `acoustic`, `paint`, `base`, `sillIn`
  - library: `shelfWood`, `shelfEnd`
  - theatre: `seat`, `stageWood`, `valance`
  - doors and lockers: `doorWood`, `doorFrame`, `locker`
  - stairs and rails: `stairTread`, `stairRiser`, `stringer`, `nosing`, `railCap`, `railGlass`, `picket`
  - fixtures and services: `fixture` (emissive light), `duct`
  - outdoor and special: `water`, `grass`, `turf`, `mulch`, `emblem`, `signMain`
  - plain `'#rrggbb'` colours for props: prefer `PAL` / accent colours from `palette.js`
- Merged geometry: one draw call per (group, look), so props cost vertices, not draw calls. Keep each hero under about 25k decor pieces.

## Slice reference
Match the quality and look of `docs/bhs/slice/*.png` (game renders of the North entrance and commons).

## Match loop (required for every hero space)
1. Run your own dev server: `npx vite --port <your port> --strictPort`.
2. Write your own views file in your folder, e.g. `src/world/bhs/interior/<you>/views.json`, with
   `{ name, ref, cam: { x, y, z, tx, ty, tz, hfov }, tp: [x, z] }`. Leave `ref` out for spaces without a photo.
3. Render with `node tools/qa/bhs-shot.mjs --url http://localhost:<port> --views <file> --round <n>`. It writes renders to `_work/renders/` and photo|render comparisons to `_work/compare/`.
4. Each round, list the 5 biggest differences, fix them and re-render. Do at least 3 rounds.
5. Stop your server when done.

## Tests
- Run `npm test` (the 3 failures already on main are known: `devs-chat`, `update-flyer`, and `interior-landmark-dressing` "751973534").
- Run your own `node --test tests/bhs-<you>.test.mjs`.
- Run `npx vite build --outDir <scratchpad>/dist`.
- Your test should build `new World(mapData)` and `createBhs(world, mapData)` from `src/world/bhs/index.js`, then check your colliders, stairs, rows and loot (stairs climbable; risers ≤ 0.6 m; loot on surfaces).

## Report
Report:
- files changed
- what you built, by photo
- the comparison images per round, with the remaining differences
- test commands and results
- requested kit or shared diffs
- known issues
