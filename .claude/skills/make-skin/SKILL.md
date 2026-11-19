---
name: make-skin
description: Make a new Bentonville Royale outfit (skin) from a description or reference image(s), using the skin recipe system and the headless skin lab renderer. Use whenever the user asks for a new skin / outfit / character look, or to change an existing one.
---

# Make a skin from a description or reference image

Outfits are data, not model files. A skin is a **recipe** in `SKINS` (`src/game/Cosmetics.js`):
a base kit, borrowed `parts`, recoloured `colors` regions and a few procedural `addons`.
Full format, region names per kit, addon shapes/presets/bones and limits: **`tools/skins/README.md`**.
Read it before writing a recipe.

## 0. Setup (once per session)

- Dev server for the lab: reuse one on `localhost:5173` (the user's `npm run dev`), or start a
  non-reloading one (agents editing files would reload a HMR page mid-render):
  `npx vite --config node_modules/.qa-vite.config.mjs` (port 5174; if that file is missing,
  `node tools/skins/render.mjs` starts its own Vite).
- Playwright: `cd tools/qa && npm i && npx playwright install chromium` (already done on this machine).

## 1. Read the brief

- Reference images: look at every image the user gave. Write down, per body area, the colours
  (hood/hat, hair, skin, shirt/tunic, cloak/cape, belt, pants, boots, gloves, metal trims) and
  the 1-3 silhouette features that make the look (ears, horns, a crest, a visor, a mask, a big hat).
- Description only: decide those same things from the words.
- **Original designs only.** If the reference is another game's or a franchise's character, make an
  original outfit inspired by its colours and vibe, not a copy of the character (no names, logos,
  signature emblems, exact costume). No real brands. Say so to the user in one line if it applies.

## 2. Write the recipe

- Pick `model`: the kit whose silhouette is closest (rogue hood, knight helmet, barbarian bear hat, mage hat).
- `parts`: swap slots from other kits for a better fit; `hat`/`cape: null` to drop them
  (the rogue's head and hood are one mesh).
- `colors`: map the colours onto regions (`node tools/skins/swatches.mjs <kit>` lists them;
  `--swatches <kit>` / `--probe <kit>` render them). Keep the game palette feel: saturated
  mid-tones, ink `#1b1d24` darks, cream `#fff1d6` lights.
- `addons`: only for silhouette features the kits lack. Prefer presets (`horns`, `visor`, `crown`,
  `mask`, `ears`, `antenna`), then primitives. Stay well under the caps (8 addons, 2,400 triangles).
- Save it as `tools/skins/examples/<name>.json` (that folder is committed; `out/` is not).

## 3. Render, look, fix (loop)

```
node tools/skins/render.mjs --recipe tools/skins/examples/<name>.json [--url http://127.0.0.1:5174]
```

Read the printed PNG (`tools/skins/out/recipe-<name>.png`: front, 3/4, side, back, head close-up).
Compare with the reference / description and fix: wrong region coloured, clipping addons, an addon
floating off the head, proportions. Repeat until it reads right at a glance. Usually 2-4 rounds.
Check the back view too (capes, hair, addons).

## 4. Add it to the game

- Add to `SKINS` as `skin_<snake_name>` with `name`, `rarity` and `price` like its peers
  (uncommon 800, rare 1200, epic 1500-1600, legendary 2000; free items are price 0).
- `node tools/skins/render.mjs --skin skin_<name> --all`, then Read `out/skin_<name>.png` and
  `out/all.png` (no other outfit changed).
- `npm test` (`tests/skin-recipes.test.mjs` validates every skin) and `npm run build`.
- Optional live check: the lobby line-up / locker in the browser (Chrome tools), or a sandbox
  match with the skin equipped.

## 5. Report and commit

Tell the user: the outfit name, rarity/price, what each part and colour is, which addons, and show
the turnaround (path to the PNG, or publish/attach it if they want to see it). Commit only when
asked or when the session's workflow says so (conventional commit `feat: <name> outfit`).

Note: a new priced item changes the daily shop rotation (`featuredToday` picks from all priced ids).
