# tools/skins — outfit recipes and the skin lab

Outfits (`SKINS` in `src/game/Cosmetics.js`) are built from data, so a new one is a recipe, not
a model file: borrow body parts from the four KayKit kits, recolour named atlas regions, and add
small procedural pieces. Then render it headless and look at the PNG.

| File | What it is |
| --- | --- |
| `src/game/skinRecipe.js` | Schema, region tables, addon shapes/presets/bones, limits, `normalizeSkin()` (no imports; the server reads it through `Cosmetics.js`) |
| `src/game/Character.js` | Builds a recipe: part swaps on the shared skeleton, recoloured atlas copies, addon meshes |
| `src/render/SkinAddons.js` | Addon primitives -> one merged, vertex-coloured mesh per bone |
| `skinlab.html` + `src/dev/skinLab.js` | Dev-only lab page (Vite builds `index.html` only, so it never ships) |
| `tools/skins/render.mjs` | Renders lab pages to PNG in `tools/skins/out/` (git-ignored) |
| `tools/skins/swatches.mjs` | Lists every atlas cell: colour, meshes / slots using it, region names |
| `tools/skins/examples/*.json` | Example recipes |
| `tests/skin-recipes.test.mjs` | Schema, region tables, recolour, caps, back-compat, kitbash |

## Workflow (description or reference image -> outfit)

1. Pick the base `model` whose silhouette is closest (rogue hood, knight helmet, barbarian bear hat, mage hat).
2. Swap `parts` for the pieces that fit better; set `hat` / `cape` to `null` to drop them.
3. Map the reference's colours onto regions (`colors`). Keep the cartoon palette: saturated
   mid-tones, ink `#1b1d24` for darks, cream `#fff1d6` for lights.
4. Add at most a few `addons` for the defining silhouette details (ears, horns, a fin, a visor).
5. Write it to a JSON file and render: `node tools/skins/render.mjs --recipe my-skin.json`.
   Read `tools/skins/out/recipe-my-skin.png`, fix what looks wrong, repeat.
6. Add it to `SKINS` (id `skin_<name>`, `rarity`, `price` like its peers), then
   `node tools/skins/render.mjs --skin skin_<name> --all` and `npm test`.

Original designs only: no real brands, logos, or other games' characters.

## Recipe format

```json
{
  "name": "Catfish Ken Superfan",
  "model": "player",
  "rarity": "epic",
  "price": 1500,
  "tint": null,
  "parts": { "head": "bot_c", "hat": null, "legs": "bot_b", "cape": null },
  "colors": { "shirt": "#8a5cf0", "pants": "#fff1d6", "boots": "#ffc21f", "bot_b.trim": "#ffc21f", "r2c5": "#ffc21f" },
  "addons": [
    { "shape": "dome", "bone": "head", "pos": [0, 0.42, -0.02], "scale": [1, 0.86, 1], "color": "#8a5cf0" },
    { "preset": "ears", "color": "#8a5cf0", "color2": "#fff1d6", "scale": 0.8 },
    { "shape": "cylinder", "bone": "head", "pos": [0.27, 0.12, 0.36], "rot": [0, 0, 64], "scale": [0.028, 0.3, 0.028], "color": "#1b1d24", "mirror": true }
  ]
}
```

- `model`: base kit, `player` (Hooded Rogue), `bot_a` (Knight), `bot_b` (Barbarian), `bot_c` (Mage). Sets the body scale and every slot not listed in `parts`.
- `parts`: slot -> kit or `null`. Slots: `head`, `hat`, `body`, `arms`, `legs`, `cape`; only `hat` and `cape` can be `null`.
  The rogue has no separate hat: `Rogue_Head_Hooded` is head and hood in one mesh, so `head: "player"` always brings the hood (and `hat: "player"` is invalid).
  A borrowed hat sits on the head bone exactly as in its own file, so a helmet over the rogue's hood will clip; drop the hood by taking another kit's head.
- `colors`: key -> `#rrggbb`. A plain region name applies to every kit worn that has it; `kit.region` (`bot_b.fur`) targets one kit; a raw cell `r1c1` targets the base kit, `bot_a.r1c1` another one.
  The colour becomes the swatch's average; its light-to-dark gradient is kept (`colour * luminance / average luminance`, clipped at 255).
  Unknown names are ignored with a warning; a bad colour is an error.
- `tint`: `0xRRGGBB` or `#rrggbb` multiplied over the kit meshes after recolouring (as the old tint skins do). Addons are not tinted.
- `addons`: see below. Unknown fields are reported, never executed.

`normalizeSkin(def)` returns `{ model, parts, tint, paint, addons, triangles, custom, errors, warnings }` and never throws; the lab prints its errors and warnings under the render, and the tests require none for catalog skins.

## Regions per kit

Atlas cells are `rRcC` (row 0-3 from the top, column 0-7) of an 8 x 4 grid of gradient swatches.
`node tools/skins/render.mjs --swatches <kit>` draws the atlas with every cell labelled;
`--probe <kit>` paints each used cell magenta in turn on the character, which is how these were checked.

| Region | player (Rogue) | bot_a (Knight) | bot_b (Barbarian) | bot_c (Mage) |
| --- | --- | --- | --- | --- |
| skin (head only) | r0c0 | r0c0 | r0c0 | r0c0 |
| hair | r0c1 (brows) | r0c1 | r0c1 (beard, brows); alias `beard` | r0c1 |
| eyes | r0c2 | r0c2 | r0c2 (head only) | r0c2 |
| shirt (main torso colour) | r1c0; alias `tunic` | r0c3 body, arms | r1c0 + r1c1; alias `tunic` | r1c0; alias `robe` |
| pants | r1c7 | r1c7 | r1c7 | r1c7 |
| boots | r2c3 | - (part of `armor`) | r2c3 | r2c3 |
| gloves / hands | r2c5 | - | r2c7 (wraps) | r2c7 (bare hands) |
| hat | r1c1 head = `hood` | r0c3 hat = `helmet` | r0c7 hat | r1c1 head, hat |
| cape | r1c1 cape | r1c0 body, cape | r0c7 body, cape | r1c2 |
| metal | r0c3 (buckle) | r1c2 (buckle) | r0c3 (studs) | r0c3 (buttons, hat buckle) |
| belt | r0c5 body | r0c6 body | r0c6 body | r0c5 body |
| other | `leather` r0c5, `pouch` r0c6, `cloak` r1c1 body/arms/cape | `armor` r0c3 body/arms/legs, `chainmail` r0c4, `leather` r0c6, `trim` r0c7, `badge` r1c1 | `leather` r0c6, `fur` r0c7, `trim` r1c2 body/arms/legs, `teeth` r1c2 hat | `trim` r0c4, `hatband` r0c5 hat, `pouch` r2c2 |

`node tools/skins/swatches.mjs [kit]` prints the same with cell colours and per-mesh vertex counts.

## Addons

Every addon is a unit primitive (fits a 1 m cube, centred) or a preset, placed in the **bone's
frame at rest, in metres**: origin at the bone, +Y up, +Z the way the character faces, +X the
character's left. The frame is the same on every kit.

| Field | Meaning |
| --- | --- |
| `shape` | `box`, `sphere`, `dome` (upper half ball), `cylinder` (`taper`: top radius / bottom radius), `cone` (tip up), `torus` (flat ring; `tube`: thickness / diameter, `arc` degrees), `capsule`, `band` (open ring wall centred on +Z; `arc` degrees) |
| `preset` | `horns`, `visor`, `crown`, `mask`, `ears`, `antenna` (sized for the head bone) |
| `bone` | `head` (default), `chest`, `spine`, `hips`, `hand.l`, `hand.r`, `upperarm.l/.r`, `lowerarm.l/.r`, `upperleg.l/.r`, `lowerleg.l/.r`, `foot.l/.r` |
| `pos` | `[x, y, z]` metres from the bone, each within +-1.5 |
| `rot` | `[x, y, z]` degrees (XYZ order) |
| `scale` | shape: its size in metres per axis (number or `[x, y, z]`, 0.005..2). Preset: a multiplier (0.05..3) |
| `color`, `color2` | `#rrggbb`; presets paint accents with `color2` |
| `mirror` | `true` also builds the piece reflected across X (left / right pairs) |

Reference sizes (head bone frame): the head spans about x -0.43..0.43, y 0..0.8 (top), z -0.4..0.42 (face front);
eyes at about y 0.3, mouth y 0.15. The chest bone is about 0.22 m below the head bone; the hips about 0.68 m.

## Limits and cost

Per skin (enforced by `normalizeSkin`; anything over is dropped with an error):

| Cap | Value |
| --- | --- |
| addon entries | 8 |
| primitives after presets and mirroring | 32 |
| addon triangles | 2,400 (a kit body is about 4,500) |
| bones carrying addons | 4 (each is one extra draw call per character) |
| colour entries | 24 |

Triangles per shape: box 12, cone 20, band 32, cylinder 40, dome 70, sphere 120, capsule 140, torus 168.

Runtime cost: a plain tint skin builds exactly as before (same shared materials). Part swaps reuse the
source kit's geometry and material (no copies). Recolouring makes one 512 x 512 canvas texture
(about 1.4 MB of GPU memory with mipmaps) per distinct kit + colour map, once, shared by every
character in that outfit. Addon geometry is built once per recipe and shared; each addon bone adds
one draw call per character. Kitbashing needs every borrowed kit loaded: the game and the lobby
showcase load all four already; a slot whose kit is missing keeps the base part.

## Rendering

Set up the QA browser once: `cd tools/qa && npm i && npx playwright install chromium`.

```bash
node tools/skins/render.mjs --skin skin_catfish_ken          # turnaround: front, 3/4, side, back, head close-up
node tools/skins/render.mjs --recipe tools/skins/examples/catfish-ken.json
node tools/skins/render.mjs --swatches bot_b                 # labelled atlas
node tools/skins/render.mjs --probe bot_b                    # every used cell painted magenta in turn
node tools/skins/render.mjs --all                            # contact sheet of every catalog skin
```

Modes combine in one run. Each PNG path is printed; recipe errors / warnings and page errors go to
stderr and make the exit code 1. Server: with `--url http://host:port` it uses that dev server; else
it reuses one answering on `http://localhost:5173` (`npm run dev`); else it starts Vite on
`127.0.0.1` on a free port and stops it afterwards. `--out <dir>` and `--timeout <ms>` are optional.

In a browser the same pages are `/skinlab.html?skin=<id>`, `?recipe=<base64url JSON>` (see
`encodeRecipe` in `skinRecipe.js`), `?swatches=<kit>`, `?probe=<kit>` and `?all=1`.
The lab uses the lobby showcase's light rig, turned with each camera so the back is lit too, and the idle pose at a fixed time.
