---
name: make-update-flyer
description: Make the Bentonville Royale update flyer (the full-screen "NEW UPDATE" splash) for a release from a description of what changed (and optional reference images), with captured in-game images and previews, no manual screenshots. Use whenever the user asks for an update flyer, patch notes splash, or "what's new" screen for a version.
---

# Make an update flyer

The flyer is data (`FLYER` in `src/data/updateFlyer.js`) plus images in `public/ui/news/`, all
produced from the command line. Full details, shot-list format, named places, setup actions and
budgets: **`tools/flyer/README.md`** (and the header of `tools/flyer/shots.mjs`). Read it first.

## 1. Gather what changed

- From the user's description, and from `git log` since the last flyer's version (the commits are
  the ground truth: list only shipped changes, never planned ones; AGENTS.md section 1).
- Pick 2-3 headline themes for the sections and one hero moment for the big image.
- Reference images from the user: use them for the mood and composition of shots, not as assets
  (flyer images are always captures of the real game).

## 2. Patch notes + version

- New entry at the top of `PATCH_NOTES` in `src/data/patchNotes.js` (version, date, title, sections).
- Bump `package.json` / `package-lock.json` version if the release needs it (ask if unsure).

## 3. Flyer copy (`src/data/updateFlyer.js`)

Keep the house style: kicker `NEW UPDATE`; title `[BIG WORD, 'and Small']`; one punchy tagline;
2-3 sections with a short `tag` (caps), a `title`, then `items` (item cards: model render, name,
rarity, one-line text) and/or `images` + `bullets` (short, concrete, player-facing). Every image
needs real alt text. File names: `<prefix>-<what>.jpg|png` with one prefix per version.

## 4. Shot list (`tools/flyer/shots/<version>.mjs`)

One shot per new image: `item` renders for weapons/consumables, `scene` shots for places and
moments (camera by free pos/lookAt or orbit; named places like `landmark:<key>`, `van:<poi>`;
setup actions such as `spawnBots`, `placePieces`, `rocket`, `breakRoof`, `smoke`, `openDoor`).
`reuse` lists images kept from earlier flyers. See `shots/0.17.0.mjs` as the worked example.

## 5. Capture, look, fix (loop)

```
node tools/flyer/capture.mjs --version <v> --out tools/flyer/out/capture   # scratch first
```

Read every PNG/JPG produced. Fix framing (camera pos/target, fov, distance), timing (`wait`,
`settle`) and setup until each image clearly shows its point. Then capture for real (no `--out`) so
the files land in `public/ui/news/`.

## 6. Preview

```
node tools/flyer/preview.mjs --version <v>
```

Read `tools/flyer/out/preview/desktop-*.png` and `phone-*.png`: headline over the hero, item cards,
wrapping, no overflow or clipped text (the tool also reports these). Use `--flyer draft.mjs` /
`--images <dir>` to preview a draft before writing it into `src/` / `public/`.

## 7. Test, report, commit

- `npm test` (`tests/flyer-assets.test.mjs`, `tests/update-flyer.test.mjs`) and `npm run build`.
- Show the user the preview (paths, or publish an artifact if they want to look) and summarise the
  copy. Commit when asked (`feat: v<version> update flyer`); pushing to `havish/main` makes it live,
  so confirm first.
