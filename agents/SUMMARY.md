# Agents

Snapshot **2026-11-16 ~9:40pm America/Chicago**. Branch: `feat/interior-overhaul` (uncommitted Crystal Bridges restyle + spectator POV work). Root `AGENTS.md` still applies. Older wave reports under `agents/reports/` are historical; do not treat them as current product truth (multiplayer, accounts, interiors phase 1–2, and ranks already shipped on `main`).

The Claude Code session that owned this restyle hit the **5-hour usage limit** (resets **1:10am America/Chicago**). One background agent finished; the follow-up polish agent died mid-fix.

## Failed / incomplete this session

| Agent | Status | What landed | Left unfinished |
| --- | --- | --- | --- |
| **Agent E** — Gallery hanging engine and dressing | **Done** | Hang engine, `wall_label`, `art`/`artStyle`/`frame` plan fields, Crystal Bridges gallery hang (19–38 works + labels, 3 m spine), Bridge Galleries with no art. Cross-check: Main Lobby + Great Hall `kit: false`, mixed large cadence `i % 3 === 2`, lobby desk moved. Files: `furnishings.js`, `landmarkDressing.js`, related tests. `npm test` 58/58. | Nothing blocking for E. |
| **Agent F** — Gallery materials and original art render | **Main pass done; polish failed (rate limit / HTTP 429)** | `landmarkStyle.js`, style overrides + beams + thresholds in `InteriorMeshes.js`, procedural `painting`/`painting_large` + `wall_label` in `InteriorFurnishings.js`, `tests/interior-style.test.mjs` + render tests. First SubagentHandback was delivered. | **Visual polish from screenshots / owner notes (the resume that died):** (1) ceiling between timber beams reads blue-grey / sky-like instead of warm cream `#e9e4d8`; (2) Bridge Gallery beams appear to run past a wall into open air. Do **not** re-do Main Lobby / Great Hall kit or large-painting cadence — Agent E already fixed those. Gallery Walk benches under paintings: leave as-is (owner choice). |

Contract / scratch (local to that Claude session, may vanish after reboot):  
`/private/tmp/claude-501/-Users-havishkunchanapalli-bentonville-royale/f4b5495f-d29c-4815-8611-924e00096a7f/scratchpad/INTERIOR_CONTRACT.md`  
Screenshots: `…/scratchpad/cb-shots2/` (esp. Bridge Gallery + gallery spines).  
Cursor gallery review: `…/scratchpad/cursor-review-gallery.txt`.

Known pre-existing `check:interiors` fails (ignore unless asked):  
`sam_walton_hall` and `eighth_and_plate` “not a hollow building”.

## Also on this dirty tree (same branch, not Crystal Bridges)

Spectator mode (Cursor session): POV follow-cam of the watched player + LMB/RMB cycle + HUD banner (`Game.js`, `hud.js`, `hud.css`). Unrelated to Agent F; keep unless the next agent is told to leave UI alone.

## What to tell the next Claude agent

Paste the block under **Handoff prompt** below into a new Claude Code session after the limit resets (or on another account). Prefer **one** agent owning `InteriorMeshes.js` / `landmarkStyle.js` only for the two visual bugs; do not relaunch the full Agent E/F parallel restyle.

---

### Handoff prompt (copy/paste)

```text
Continue Bentonville Royale on branch feat/interior-overhaul at /Users/havishkunchanapalli/bentonville_royale.

FIRST: read AGENTS.md (binding), agents/SUMMARY.md (this handoff), and if still present /private/tmp/claude-501/-Users-havishkunchanapalli-bentonville-royale/f4b5495f-d29c-4815-8611-924e00096a7f/scratchpad/INTERIOR_CONTRACT.md (ADDENDUM v2). Inspect current src/world/InteriorMeshes.js, src/world/interiors/landmarkStyle.js, and screenshots in that scratchpad’s cb-shots2/ if they exist.

Context: Crystal Bridges (building id 8240824) AskRosie-style restyle is mostly done. Agent E (placement) finished. Agent F (rendering) finished the main pass then died on a rate limit while fixing screenshot issues. Do NOT redo hang/dressing. Do NOT copy real Crystal Bridges / AskRosie artwork, titles, or artists — materials + procedural art only.

Your job — only these visual fixes:
1) Ceiling between timber beams looks blue-grey / sky-like. Styled ceilings must read warm cream #e9e4d8 (see landmarkStyle CEILING). Likely causes: wrong ceiling hex (CEILING_HEX vs style.ceiling), hemisphere/sky light bleeding through missing ceiling fill between beams, or beams without a proper ceiling plane behind them on single-storey rooms. Fix so gallery ceilings match AskRosie cream, not outdoor sky.
2) Bridge Gallery: timber beams appear to run past a wall into open air. Clip/cut beams so they stay inside the Bridge Gallery(/Upper) room volume / inner poly; do not let them pierce adjacent volumes or exterior.

Own/edit only as needed: src/world/InteriorMeshes.js, src/world/interiors/landmarkStyle.js, tests/interior-style.test.mjs (and interior-render.test.mjs only if required). Do NOT edit furnishings.js / landmarkDressing.js / Game.js / hud* unless a one-line import is required. No commits unless I ask. No package installs.

Verify: node --test tests/interior-style.test.mjs tests/interior-render.test.mjs; npm test; npm run build. Ignore the two pre-existing check:interiors hollow-building fails for sam_walton_hall / eighth_and_plate. If you can, re-capture Bridge Gallery + one gallery spine screenshots and compare.

Report: root cause of each bug, files changed, commands + results, remaining risks. Read AGENTS.md confirmation in the report.
```

## Finished earlier (still true on main / this branch base)

- Interiors phase 1–2 merged via PRs (stairs, furnishings, breakable walls, landmark layouts). Report: `agents/reports/building-interiors-phase2.md`.
- Multiplayer / accounts / ranks / presence / patch notes: on `main` (see recent git history). Do not restart those from old “killed agent” rows below.

## Historical (2026-11-14) — do not restart blindly

The 3:23pm table (map data wiring, weapon-audio report, early P2P) is obsolete as a work queue for networking (P2P/PartyServer shipped later). Terrain/imagery still may not be consumed at runtime; confirm in current `Game.js` / `World.js` before claiming map-data work is needed.
