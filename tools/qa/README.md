# tools/qa — headless WebGL smoke test

Self-contained (own `package.json` / `node_modules`). Setup once:

```
cd tools/qa && npm i && npx playwright install chromium
```

## Usage

```
node tools/qa/smoke.mjs --url http://localhost:5173 [--out tools/qa/out] [--wait 4000]
     [--width 1280 --height 720] [--timeout 30000]
     [--eval "<js expression>"]      repeatable; result printed as JSON
     [--script path/to/steps.mjs]    scripted steps (see below)
     [--shots 3 --interval 1500]     N final screenshots spaced by interval (default 1)
```

Order of operations: launch Chromium (first GPU flag set that yields a WebGL2 context:
`--use-angle=metal`, then SwiftShader fallbacks) -> load page -> `--wait` -> canvas health
check -> `--eval`s -> `--script` -> `--shots`.

Output lines are prefixed: `[gpu]`, `[load]`, `[console.error]`, `[console.warning]`,
`[pageerror]`, `[requestfailed]`, `[http 404]`, `[canvas]`, `[eval]`, `[shot]`, `[script]`.
The last line is always a one-line JSON summary:

```
{ok, pageErrors, consoleErrors, consoleWarnings, failedRequests, screenshots:[...], renderer, gpuFlags, blankCanvas, loaded, ms}
```

- Exit code 0 = page loaded (HTTP < 400) and no uncaught page errors; otherwise 1 (2 = bad args).
  Console errors and failed requests are reported but do not fail the run.
- `blankCanvas` is true when >= 99.5% of the largest `<canvas>` is one colour
  (`null` if there is no canvas). `failedRequests` includes HTTP >= 400 responses.
- Screenshots are `NN-name.png` in the out dir (default `tools/qa/out`); old files are overwritten, not cleared.

## Steps script

```js
// steps.mjs
export default async function (page, h) {
  await h.shot('menu');                       // -> out/01-menu.png
  await h.click();                            // click at current mouse pos (starts at centre)
  await h.key('KeyW', 800);                   // hold W for 800 ms (keyboard.down/up)
  await h.mouseMove(200, 0);                  // relative move, in CSS px
  await h.sleep(500);
  const pos = await h.evalJSON('window.__game && window.__game.player?.position');
  console.log('player', JSON.stringify(pos));
  await h.shot('after-move');
}
```

`helpers`: `shot(name)`, `key(code, ms)`, `mouseMove(dx, dy)`, `click()`, `sleep(ms)`,
`evalJSON(expr)` (expression evaluated in the page, promises awaited, result JSON-cloned).
`page` is the raw Playwright page.

## Limitations

- Pointer lock is generally not granted in headless Chromium; `mouseMove` produces normal
  `mousemove` events (with `movementX/Y`), but code gated on `document.pointerLockElement`
  will not run. Drive the game through `window.__game` via `evalJSON` instead.
- No audio output is verified (autoplay is allowed, nothing is listened to).
- Each run starts a fresh browser; there is no persistent state between runs.

## Self-test

```
python3 -m http.server 5190 --directory tools/qa/selftest &
node tools/qa/smoke.mjs --url http://localhost:5190 --eval "1+1" --script tools/qa/selftest/steps.mjs
```

Expect a rotating RGB triangle in the screenshots, `blankCanvas:false`, and one captured
`[console.error] selftest-error`.

## Playtest bot (`playtest.mjs`) — full matches with per-tick invariants

```
node tools/qa/playtest.mjs --url http://localhost:5173 [--scenario solo,death,rematch,chromebook|all]
     [--out tools/qa/out/playtest] [--headed] [--matches 3] [--cpu 4]
```

Run `npm run dev` (and `npm run party:dev` so the menus behave like production) first.
Scenarios click the real menu buttons and drive the match through `window.__game.debug`:

- `solo`: PLAY -> bus -> real glide and landing -> 20 s of play -> storm skipped to the end -> win -> MAIN MENU.
- `death`: PLAY -> land -> lethal damage -> defeat screen -> MAIN MENU.
- `rematch`: `--matches` games via PLAY AGAIN; flags a `leak` when scene objects, GPU geometries /
  textures / programs, actors, loot records or DOM nodes grow > 25 % + 50 from the first match.
- `chromebook`: 1366x768, performance mode + low quality, CPU throttled `--cpu`x; FPS and a mid-match resize.

`lib/monitor.js` is injected into every page and checks every 250 ms: finite positions and health,
health/shield in 0..100, alive-at-zero, out of bounds, player below terrain, ammo/mats/mag ranges,
`combat.aliveCount` vs the actors, storm never growing, result placement range, new `game.errors`,
frame stalls > 3 s (visible tab only). Warnings (not failures): bots stuck > 45 s, bots below terrain.
Each new violation gets a screenshot. `report.json` holds steps, violations, FPS and page diagnostics;
the exit code is 1 if any scenario failed, had a violation, a page error or a game error.

## Multiplayer smoke (`mp.mjs`) — host + clients in separate contexts

```
node tools/qa/mp.mjs --url http://localhost:5173 [--clients 2] [--out tools/qa/out/mp] [--headed]
```

Needs `npm run party:dev` (the relay on ws://localhost:1999) and a dev build (client debug hooks).
Private lobby -> join -> ready -> start, then: wall + edit placed by a client identical on every
page, host wall reaches clients, chest opened by a client opened everywhere, a 400 m one-tick
client move (no debug hook) rejected by the host, client disconnect, host leaving.

## Sources

The playtest / multiplayer harness adapts ideas (no code copied) from:
- jbcom/game-harness (MIT): silent sessions, fail on runtime errors — https://github.com/jbcom/game-harness
- Math-Quest-Web/Math-Quest PR #19: headless playtest bot, per-frame invariants, JSON + screenshots — https://github.com/Math-Quest-Web/Math-Quest/pull/19
- techilounge/resolveops-ai PR #19: invariant fuzzing over many games — https://github.com/techilounge/resolveops-ai/pull/19
- je55pr/zombonz PR #214: multi-context smoke over the real room server — https://github.com/je55pr/zombonz/pull/214
