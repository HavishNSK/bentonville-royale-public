# tools/flyer — update-flyer images and preview, no manual screenshots

The update flyer (`src/data/updateFlyer.js`, rendered by `src/ui/updateFlyer.js`) is a full-screen
splash shown once per version. Everything it shows can be produced and checked from the command
line, so an agent can make a new flyer from a description of the update:

| Step | File / command |
| --- | --- |
| 1. Patch notes | `src/data/patchNotes.js` (new entry at the top; bump `package.json` / `package-lock.json`) |
| 2. Flyer copy | `src/data/updateFlyer.js` (`FLYER`) |
| 3. Shot list | `tools/flyer/shots/<version>.mjs` (format in `shots.mjs`) |
| 4. Capture | `node tools/flyer/capture.mjs --out tools/flyer/out/capture`, look, then without `--out` |
| 5. Preview | `node tools/flyer/preview.mjs` -> `tools/flyer/out/preview/*.png` |
| 6. Test | `npm test` (`tests/flyer-assets.test.mjs`, `tests/update-flyer.test.mjs`), `npm run build` |

## Setup

Uses the QA harness's Playwright + Chromium (`tools/qa`) and `sharp` from the root dev
dependencies. Once:

```
npm ci --ignore-scripts      # root (vite, sharp); sharp may need: npm rebuild sharp
cd tools/qa && npm i && npx playwright install chromium
```

Both scripts start their own Vite dev server on `127.0.0.1:5199` (loopback only, stopped at the
end). To reuse a running one instead: `--url http://localhost:5173/` (it must be `npm run dev`,
not a production build: capture needs the dev-only `window.__game.raw`). `--port N` picks another
port. The pages answer Vite's HMR websocket themselves, so saving a source file mid-run does not
reload them (they keep the code they booted with); any other failure is retried once from a fresh
boot.

## 1-2. Patch notes and flyer copy

`FLYER.version` must have a `PATCH_NOTES` entry and must not be newer than the newest one (a later
patch without a flyer keeps showing the last flyer to players who have not seen it). Keep the
existing style:

- `kicker`: `'NEW UPDATE'`. `title`: `[BIG, small]`, the big word 1 short word in caps
  (`'BOMBS'`, `'and Bridges'`). `tagline`: one punchy line, two short sentences at most.
- 2-4 `sections`, each `{ id, tag, title }` plus `items` (item cards: `img`, `name`, `rarity`,
  `text`), and/or `images` (1-2 scene shots with real `alt` text) and `bullets` (one plain line
  per change, what players will notice). `tag` is one word in caps (`BOMBS`, `BRIDGES`, `FIXED`).
- `rarity` is one of `common uncommon rare epic legendary` (colours the card).
- `hero`: the most exciting scene shot, 16:9, the headline sits over its bottom-left.
- Image paths are `/ui/news/<name>.jpg|png`; name them by version or theme (`bb-` was 0.17.0).

## 3. Shot list

`tools/flyer/shots/<version>.mjs` default-exports `{ version, reuse?, shots }`. Each shot writes
exactly one file, `public/ui/news/<file>`, which the FLYER must reference; every FLYER image needs
a shot, or is listed in `reuse` (kept as is). The full format, with every option, is the comment
at the top of [`shots.mjs`](shots.mjs). The worked example is [`shots/0.17.0.mjs`](shots/0.17.0.mjs).

```js
export default {
  version: '0.20.0',
  reuse: [],
  shots: [
    // transparent PNG of one model, the game's toon materials and sun, 3/4 view, 360 px square
    { kind: 'item', file: 'cc-item-medkit.png', item: 'medkit', glow: true },
    { kind: 'item', file: 'cc-item-rifle.png', item: 'rifle', yaw: 70, fill: 1.0, glow: 'legendary' },

    // JPEG of the world with every HUD / menu element hidden, 1100x618
    {
      kind: 'scene', file: 'cc-van.jpg',
      camera: { target: { ref: 'van:square', dy: -0.4 }, heading: 2.4, pitch: -0.03, distance: 8.5, fov: 62 },
    },
    {
      kind: 'scene', file: 'cc-fight.jpg', mode: 'sandbox',
      player: { x: -17.6, z: 18, heading: 2.2, pitch: -0.15 }, distance: 5,   // over the shoulder
      setup: [
        { do: 'give', item: 'rocket_launcher', rarity: 'legendary' },
        { do: 'spawnBots', difficulty: 'hard', count: 3, near: { x: -30, z: 5 } },
        { do: 'wait', ms: 2500 },
      ],
    },
    {
      kind: 'scene', file: 'cc-roof.jpg', fresh: true,   // destructive: own boot
      player: { x: -26, y: -7, z: -192 },
      camera: { pos: { x: -26, y: -5.4, z: -195 }, lookAt: { x: -26, y: 3, z: -187 }, fov: 74 },
      setup: [{ do: 'breakRoof', at: { x: -26, y: 2.6, z: -188 } }, { do: 'wait', ms: 160 }],
    },
  ],
};
```

Coordinates are world metres: x east, z south, y up; `heading` 0 looks north (-z), `pitch` > 0
looks up (radians). Useful places:

- `landmark:<key>` for map POIs (`square`, `crystal_bridges`, `momentary`, `compton_gardens`, ...,
  from `public/data/bentonville-osm.json` `landmarks`), `van:<poi>` for Catfish Ken's reboot vans
  (`square`, `crystal_bridges`, `memorial_park`, `community_center`, `bentonville_high`,
  `bentonville_west`), `pavilion:<id>` and `door:south|library` for Crystal Bridges.
- Crystal Bridges: `src/world/crystal-bridges/site.js` (`PAVILIONS` boxes, `LEVEL`: street
  `CREST` y 0, main floor y -7, lower y -11). The main entrance is the Entrance Hall's east side
  (x 56, z -242..-236); the Great Hall (copper roof) is x -34..-18, z -200..-176.
- Inside a building, give `player` with the floor `y`, or the player lands on the roof.

Setup actions are a whitelist (`wait`, `spawnBots`, `placePieces`, `rocket`, `breakRoof`, `smoke`,
`openDoor`, `give`, `eval`); `eval` runs JavaScript in the dev page with `game` in scope and is
for this repo's own shot lists only. There is no time-of-day or weather: the game has one fixed
afternoon sky, and the validator rejects those keys. Shots reuse one booted game per `mode`, with a
best-effort reset in between (bots, builds, grenades, broken wall panels); put destructive shots
last or give them `fresh: true`.

Item ids: any `WEAPONS` id (`rifle`, `smg`, `shotgun`, `sniper`, `pistol`, `rocket_launcher`,
variants such as `burst_rifle` use their base model), consumables (`grenade`, `smoke`, `medkit`,
`tonic`; `gascan` has no model yet), or `chest` / `ammo` / `crate`. `yaw` / `elev` (degrees) turn
the camera, `rotate` turns the model, `fill` sets how much of the frame it spans.

## 4. Capture

```
node tools/flyer/capture.mjs --out tools/flyer/out/capture          # scratch first
node tools/flyer/capture.mjs                                         # into public/ui/news
node tools/flyer/capture.mjs --only cc-van.jpg,cc-item-medkit.png    # just these
node tools/flyer/capture.mjs --shots /tmp/try.mjs --out /tmp/try     # an experimental list
```

Other flags: `--version x.y.z` (default `FLYER.version`), `--quality low|medium|high` (graphics,
default high), `--scale N` (render at N x and downscale), `--headed`. Output is one line per shot
(`[ok] file WxH size`, `[retry]`, `[fail] file: reason`, plus the resolved camera and any setup
action results), then a JSON summary. Exit code 1 if any shot failed, 2 for a bad shot list.

A shot fails when the frame is blank (one flat colour: camera inside a wall), an item render is
empty or has no transparent pixels, or a file is over budget. **Read the images** after every
capture: the checks cannot tell a good composition from a bad one. Iterate on camera numbers with
`--shots` + `--out` in a scratch dir, and only write into `public/ui/news` when the result is at
least as good as what is there.

Budgets (from the 0.17.0 images: scene JPEGs 58-156 KB, item PNGs 26-30 KB): JPEG <= 250 KB,
PNG <= 80 KB (capture falls back to a 256-colour palette PNG when a glow pushes it over).
Sizes: scenes 1100x618 (hero included; the hero crops to 16:7.4), items 360x360.

## 5. Preview

```
node tools/flyer/preview.mjs                                  # the current FLYER
node tools/flyer/preview.mjs --images tools/flyer/out/capture # with captured images not yet copied
node tools/flyer/preview.mjs --version 0.20.0                 # tools/flyer/drafts/0.20.0.mjs
node tools/flyer/preview.mjs --flyer path/to/draft.mjs
```

Opens the title screen with fresh storage, so the flyer opens by itself like a player's first
launch after the update, at desktop 1440x900 and phone 390x844 (2x). Saves one PNG per screenful
of the scrolling card to `tools/flyer/out/preview/<desktop|phone>-<n>.png` (gitignored) and reports
broken images, anything wider than the card, horizontal page scroll and clipped text (exit 1 if
any). A draft is a plain module with no imports, `export const FLYER = { ... }`, served in place of
`src/data/updateFlyer.js` for the preview only. Read the PNGs: check the headline over the hero,
text overflow on the phone, and that every image reads at its displayed size.

## 6. Test

`npm test` runs `tests/flyer-assets.test.mjs`: the flyer version is a released one, the copy has
its parts, every image exists with alt text / a name, rarities are valid, PNGs are square with
transparency (RGBA, or a palette with a tRNS chunk),
files are within budget, and `tools/flyer/shots/<FLYER.version>.mjs` is valid and covers every
image. Then `npm run build`.

## Files

- `shots.mjs`: format, budgets, validator, coverage (pure Node; used by the test).
- `capture.mjs`, `preview.mjs`: the CLIs. `lib.mjs`: dev server, browser, game boot.
- `page/studio.js`: runs inside the dev page (camera pin, HUD hiding, setup actions, item renders).
  Loaded with a dynamic import only by these tools; the game never imports it, so it is not in a
  production build.
- `shots/<version>.mjs`: one shot list per flyer.

## Limitations

- Needs WebGL2 in headless Chromium (Metal on macOS; SwiftShader fallback is slow).
- No time of day or weather. Effects (explosions, debris, smoke) are captured at whatever moment
  the `wait` lands on, so they vary a little between runs.
- `gascan` and other models built only in code elsewhere are not available as items.
- The camera ignores walls: put it somewhere open, or the frame is the inside of a wall.
