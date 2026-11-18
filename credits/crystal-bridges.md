# Crystal Bridges landmark credits

This file credits the code, fonts and art used by the Crystal Bridges point of interest (`src/world/crystal-bridges/`). The project-wide index is [`ASSET_CREDITS.md`](../ASSET_CREDITS.md).

## musewalk (code ported, MIT)

https://github.com/shuyan-5200/musewalk, commit `6510b5f`, inspected 2026-11-17.

The following were ported and adapted:

| Ported | musewalk source | Ported to |
|---|---|---|
| Frame builder (gold / dark / float) | `src/hall.js` | `gallery/frames.js` |
| Plaque type ramp | `src/hall.js` | `gallery/frames.js` |
| Light-pool and beam values | `src/hall.js`, `src/lobby.js` | `gallery/frames.js` |
| Painting size rule and hang height | `src/hall.js` | `gallery/hang.js` |
| Caption, info panel, veil and vignette, with their CSS | `src/ui.js`, `src/styles.css` | `gallery/ui.js`, `gallery/gallery.css` |
| Focus framing | `src/main.js`, `src/cameraRig.js` | `gallery/index.js` |
| Brush-stroke body shader | `src/dreamBodies/strokes.js` | `gallery/portal.js` |
| Ambient synth | `src/audio.js` | `gallery/ambience.js` |
| Commons downloader and its license policy | `scripts/fetch_art.py` | `scripts/fetch-cb-art.mjs` (Node port) |
| `gallery.config.json` shape | `public/gallery.config.json` | `public/data/crystal-bridges.config.json` |

No musewalk artwork, images, fonts or textures were copied. Reference screenshots of musewalk running locally are kept for comparison in `docs/musewalk-reference/`; they show Commons public-domain paintings and the PDM / CC0 Venus de Milo scan.

```
MIT License

Copyright (c) 2026 Musewalk contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Fonts

**Cormorant Garamond** (variable; roman and italic, Latin subset): self-hosted as `public/assets/fonts/CormorantGaramond-Variable.woff2` and `CormorantGaramond-Italic-Variable.woff2`.

- Copyright 2015 The Cormorant Project Authors.
- License: SIL Open Font License 1.1. The full text is in `public/assets/fonts/CormorantGaramond-OFL.txt`.
- Source: the `@fontsource-variable/cormorant-garamond` 5.3.0 package (musewalk's font dependency).
- Used only for the gallery UI and plaques. The game HUD keeps Lilita One / Nunito.

## Paintings

Paintings on the walls are fetched by `scripts/fetch-cb-art.mjs`. Kindred Spirits came from Wikimedia Commons. Commons then rate-limited this machine, and the owner chose the museum's own collection records for the other 30, with `node scripts/fetch-cb-art.mjs --source museum`. Those are accepted only when the record says `"copyright": "Public Domain"`. Each is credited "Courtesy of Crystal Bridges Museum of American Art" together with the museum's credit line and photography credit; the per-file list is in [`ASSET_CREDITS.md`](../ASSET_CREDITS.md). Only works held by Crystal Bridges are fetched, and only files whose Commons license is "Public domain", "CC0" or "CC BY". `public/art/sources.json` records, for every file:

- title, artist and year;
- the Commons file page;
- the license;
- credit;
- SHA-256.

The images themselves are in `public/art/crystal-bridges/`.

Still-copyrighted works are **not reproduced**. Their place shows an empty musewalk-style frame, a plinth, or a procedural stand-in canvas, with a label naming the real work:

- Rockwell, Warhol, Rothko, Kerry James Marshall, Kusama, Maya Lin, Koons, Haring, Bourgeois.
- Titles marked `verify: true` in the config were not confirmed against the museum's collection database and should be checked before release.

## Building reference material

Research sources are listed in `docs/crystal-bridges-research.md`.

- Floor plans, the venue map and the audio-tour script were read for layout and materials only.
- No museum photo, Safdie Architects image or McGill archive image is copied into the game.
- All textures (concrete with cedar bands, red oak, quartzite, copper, steel, grass) are procedural canvases drawn in `meshes.js`.

## Statues

Stone figures on plinths around the museum (`src/world/crystal-bridges/statues.js`), models in `public/assets/statues/`:

| File | Source | License |
| --- | --- | --- |
| `dragon.glb` | Original model made for this game by the project owner, Shehryar (`dragon-statue.glb`, Blender glTF export). | Project's own work |
| `gargoyle.glb` | Pixor free library, "Gargoyle" (`https://pixor.art/library/dungeon/gargoyle/`), retrieved 2026-11-17 | CC0 1.0 |
| `guardian.glb` | Pixor free library, "Guardian statue" (`https://pixor.art/library/dungeon/statue/`), retrieved 2026-11-17 | CC0 1.0 |
| `broken-statue.glb` | Pixor free library, "Broken statue" (`https://pixor.art/library/ruins/broken-statue/`), retrieved 2026-11-17 | CC0 1.0 |
| `idol.glb` | Pixor free library, "Idol" (`https://pixor.art/library/ruins/idol/`), retrieved 2026-11-17 | CC0 1.0 |
| `obelisk.glb` | Pixor free library, "Desert obelisk" (`https://pixor.art/library/desert/obelisk-desert/`), retrieved 2026-11-17 | CC0 1.0 |

Pixor's license page (`https://pixor.art/library/license/`) dedicates every library model to the public domain under CC0 1.0 and says credit is appreciated but not required ("Made with Pixor", https://pixor.art). They are game props, not reproductions of works in the Crystal Bridges collection.
