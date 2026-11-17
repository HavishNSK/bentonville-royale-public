# Building interiors Phase 2 — local integration handoff

Checked 2026-11-16. Root `AGENTS.md` was read; no nested instructions were found in the affected paths.

## Integrated locally

Target: `building-interiors`. The original `changes` branch and `origin` configuration were preserved. Fetched HavishNSK branches into `refs/remotes/havish/*`, then merged main (`9a4f937`), landmarks (`1fcdef4`), bots/loot (`5897195`), and combat/multiplayer walls (`f861ec6`). The checker append conflict was resolved by retaining both landmark and multiplayer sections.

Furniture: `2fd637c`; narrow-wing layout/upstairs exit regressions: `0d7d008`; combined stairs/rendering/navigation/loot/docs: `83c8f84`; browser stair screenshot: `e863bcd`. Subsequent handoff commits do not change runtime behavior. Nothing was pushed or deployed.

## Behavior

- Deterministic, height/metadata-bounded upper floors, up to four storeys, only when a flight with approach pads and a side aisle fits. The checked-in map has 15 multi-storey buildings and 20 flights.
- Floor openings, visible stair treads, continuous movement surfaces, floor/stair ray blocking, ceiling headroom, and upper partitions with stable panel IDs. Floors/stairs/roofs remain unbreakable; the exterior band above the ground floor remains solid.
- Bots walk flights without treating them as walls, detour around shafts between flights, use floor-specific building membership, and descend before exiting. Room/loot centres are kept off shafts; upper-floor loot is supported and interactable.
- Room-specific decorative furniture and bounded room plaques, merged into existing building chunks and their culling. Props remain nonblocking; there is no physical furniture collision.
- Narrow clipped wings cannot become separate sliver rooms. Sixteen landmark layouts are gameplay interpretations, not verified real floor plans.
- Existing host wall-event validation, damage/break replication, and match restoration are retained. Late joins are rejected by the existing room flow; no late-join snapshot was added.

## Verification actually run

- `npm ci --ignore-scripts` and the QA package's locked install.
- `npm test`: 16/16 passed, including a full bot simulation opening upstairs loot, multi-floor up/down navigation, floor-specific membership, slab/stair ray blocking and upper-panel reset.
- `npm run check:interiors`: passed room reachability, door clearance, seeded bot routes/loot, deterministic plans, combat destruction, host/client loopback and malformed wall events.
- `npm run check:stairs`: passed all 20 flights in both directions (40 bot trips), collision, floor support, headroom and upper loot.
- `npm run build`: passed; existing ineffective dynamic-import warning for Net.js remains.
- `npm run test:coverage`: 46.09% aggregate Node line coverage. This is below the 80% repository target and excludes browser coverage.
- `node tools/qa/smoke.mjs --url http://127.0.0.1:5173 --wait 1500 --script tools/qa/interiors.mjs`: passed, zero uncaught page errors/game errors, nonblank canvas. Real Player movement entered/exited a door and climbed/descended stairs; Combat pickaxe broke a partition and Player walked through it; upstairs container opened; bot climbed stairs. Furnished-room/stair screenshots inspected under ignored `tools/qa/out/`.
- Browser console: optional `local-music/menu.mp3` returned 404; default `localhost:1999` party relay was offline. No real two-browser relay match, audible output or pointer-lock input was verified. The gameplay script uses the development inspection API to exercise movement and combat.
- `npm audit --omit=dev`: zero advisories. Full audit: existing high-severity `sharp` image-tool dependency advisories; suggested fix is a semver-major upgrade to 0.35.5. No image processing or dependency upgrade was performed for interiors.
- Diff whitespace and local secret/input-boundary review performed. No credentials, data collection or external provider integration added by the interior changes.

## Review blockers and remaining work

`cursor-agent` is absent from PATH and the inspected local CLI locations, so the requested `composer-2.5` cross-check did not run. No installation was attempted.

Greptile authentication works, but review is blocked: `greptile init --json` reports `not_connected` for both `Sh3hryarAhmed/bentonville-royale` and `HavishNSK/bentonville-royale`. The latter was checked in an isolated shared clone, preserving the user's origin/settings. `greptile review --agent --branch 9a4f937` rejects the disconnected repository. No completed review or review ID exists; Greptile review remains incomplete. No remote Greptile configuration, GitHub App access, branch protection or organization setting was changed.

Remaining: configured Cursor/Greptile reviews, real relay multiplayer/manual audio/pointer-lock checks, broader coverage toward 80%, and separate assessment/upgrading of the existing map-image dependency. No push, deployment, or PR was created.

## Reference discovery

Consulted https://agenticskills.io/ and installed Superpowers planning, parallel-agent, TDD and verification guidance. The attempted testing-category lookup failed; no external skill/code was installed or copied. Repository evidence and existing geometry APIs supplied the implementation contracts.
