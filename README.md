# Bentonville Royale

An original third-person building battle royale set on a map of Bentonville, Arkansas.

> Status: prototype / active development. Implemented features below are verified from source; production readiness and full multiplayer E2E coverage are not established.

## Overview and Features

Play a solo match against 31 bots or host a friend lobby with up to eight human players, with bots filling the remaining slots in a 32-actor match. Drop into the map, collect weapons and supplies, harvest materials, build cover, and survive a shrinking storm.

Implemented systems include:

- Third-person movement, freefall, gliding, combat, reloads, health, shields, and consumables.
- Five weapon types, inventory/hotbar, floor loot, chests, and ammo boxes.
- Walls, floors, ramps, and cones using wood, brick, or metal; damage and structural collapse.
- Scripted bots, difficulty settings, storm phases, victory/defeat screens, minimap, and full map.
- Cartoon rendering, quality settings, synthesized audio with recorded sample fallbacks, and saved player preferences.
- Friend lobbies via PartyServer/WebSocket rooms; optional Google Photorealistic 3D Tiles as a visual layer.
- Optional accounts (username/password or Google sign-in) for coins, shop, locker, and friends on the Cloudflare Accounts Durable Object.

There is no traditional database, paid checkout, or model-provider integration. Bots are scripted game logic. Additional terrain, canopy, and ground-imagery files exist but are not loaded by the current game.

## Local Setup

Use Node.js 22.12+ (or Node 20.19+ supported by Vite 8), npm, and a desktop browser with WebGL2, keyboard, and mouse. Node 24.14.0 was used for the successful documentation integration build check.

From the repository root:

```bash
npm ci --ignore-scripts
npm run dev
```

Open `http://localhost:5173`. Vite may choose another port if it is occupied; use the URL it prints. The dev/preview configuration binds to network interfaces, so use a trusted network, especially when serving personal music.

No environment variables or map downloads are required for the default game. Assets and processed map data are already checked in. If the browser cannot create a WebGL2 context, try a browser/device with GPU support enabled.

### Optional Google 3D View

```bash
cp .env.example .env.local
```

Set `VITE_GOOGLE_MAPS_API_KEY` only if using the optional Google view, restart Vite, and enable the view in Settings. Follow the API/referrer restrictions in [.env.example](.env.example). Google Cloud billing and Map Tiles API access are required for that feature.

| Variable | Required | Scope | Purpose and configuration |
| --- | --- | --- | --- |
| `VITE_PARTYKIT_HOST` | No | Public browser bundle | Optional relay host:port, supplied in `.env.local` or the hosting build environment; defaults to `localhost:1999`. |
| `VITE_GOOGLE_MAPS_API_KEY` | No | Public browser bundle | Optional Google Map Tiles API key, supplied through `.env.local` locally or the build environment on hosting. Restrict to intended referrers and the Map Tiles API. |
| `VITE_GOOGLE_CLIENT_ID` | No | Public browser bundle | OAuth Web client ID for Continue with Google (GIS). Authorize JS origins for local and production. Must match Worker `GOOGLE_CLIENT_ID`. |
| `GOOGLE_CLIENT_ID` | No | Cloudflare Worker (`wrangler` vars/secret) | Same OAuth Web client ID; used as JWT `aud` when verifying Google ID tokens. Empty disables Google login on the server. |
| `VITE_CLEVER_AUTH` / `VITE_CLEVER_CLIENT_ID` | No | Public browser bundle | Set `VITE_CLEVER_AUTH=1` (or set the Clever client id) to show **Log in with Clever**. |
| `CLEVER_CLIENT_ID` | No | Cloudflare Worker vars | Clever application client ID (public). |
| `CLEVER_CLIENT_SECRET` | No | Cloudflare Worker **secret** | Clever application secret. Required for token exchange. Never put in `VITE_*` or git. |

Every `VITE_*` value is visible to browser users. Use intentionally public restricted keys, never private credentials. Leave Maps unset to disable the Google tiles toggle. Leave the client ID unset to hide Continue with Google. The tiles layer is visual only; retain provider attribution.

### Optional Google Sign-In

1. Create an OAuth 2.0 Web client ID in Google Cloud Console.
2. Add authorized JavaScript origins (`http://localhost:5173`, `https://bentonvilleroyale.vercel.app`, and any other play origins).
3. Set `VITE_GOOGLE_CLIENT_ID` in `.env.local` / Vercel and the same value as Worker `GOOGLE_CLIENT_ID` (`wrangler.jsonc` vars or `npx wrangler secret put GOOGLE_CLIENT_ID`).
4. Redeploy the Worker (`npm run party:deploy`) and rebuild/redeploy the static site.

The browser receives a Google ID token; the Accounts Durable Object verifies signature, `iss`, `aud`, and `exp` against Google's JWKS, then creates or resumes an account keyed by Google `sub` (not email). Username/password accounts remain available. This is still a prototype identity layer: room codes are not authentication, and there is no dedicated anti-cheat or trusted match authority.

### Optional Clever Sign-In (school SSO)

Bentonville Google Workspace blocks unverified apps with `Error 400: admin_policy_enforced`, so school Chromebooks should use Clever instead. Clever uses OAuth authorization-code on the Cloudflare Worker (client secret never reaches the browser).

1. Create an app in the [Clever developer dashboard](https://apps.clever.com/).
2. Set the redirect URI to exactly:
   `https://bentonville-royale.bentonville-royale.workers.dev/auth/clever/callback`
3. Ask Bentonville Schools IT / Clever district admins to **share/approve** the app for the district (required for student/staff login).
4. Put `CLEVER_CLIENT_ID` in `wrangler.jsonc` vars and store the secret with:
   `npx wrangler secret put CLEVER_CLIENT_SECRET`
5. Set `VITE_CLEVER_AUTH=1` in `.env.local` and Vercel (gitignored locally; never commit `CLEVER_CLIENT_SECRET`).
6. Redeploy the Worker and rebuild/redeploy the static site.

Flow: **Log in with Clever** → Clever → Worker callback → one-time `?br_auth=` ticket → game redeems a session. Accounts are keyed by Clever user id (`clever:<id>`), not email. Username/password still works without Clever.

### Developer Chat Access

Developer chat access is granted by the username allowlist in `src/net/devs.js`, including `Rakkart13`. The presence Worker verifies the signed-in account session before granting the red `[DEV]` chat title and `/announce message` command; changing a display nickname does not grant access. Allowlist changes require deploying the Worker (`npm run party:deploy`), then reconnecting or refreshing while signed in to that account.

### Optional Personal Music

Place a personal track at `local-music/menu.mp3`. The dev/preview middleware serves it locally; the game otherwise uses synthesized music. The folder is ignored by Git and Vercel and is not copied to `dist/`. Do not move personal tracks into `public/`.

## User Flow and Controls

1. Select **PLAY** for solo, or **WITH FRIENDS** to host/join using a room code and display name.
2. The host shares the code and starts the friend match when players have joined.
3. Drop/glide, loot, fight, build, and remain inside the storm circle.
4. Use the result screen to play again or return to the menu. In friend matches, the host starts the next round.

| Input | Action |
| --- | --- |
| WASD / mouse | Move / look |
| Shift | Sprint |
| Ctrl or Z | Crouch |
| Space | Jump or deploy glider during freefall |
| Left mouse | Fire, swing, place a piece, or use selected item |
| Right mouse | Aim |
| E / R | Interact / reload |
| 1–5 or wheel | Select hotbar slot |
| F | Equip pickaxe |
| Q / C / V / X | Wall / floor / ramp / cone |
| G | Cycle build material |
| B | Emote |
| M / Escape | Full map / pause |

Click into gameplay to capture the pointer. Settings include sensitivity, invert Y, volume, graphics quality, bot difficulty, and optional Google view. Only matches on **Hard** bot difficulty count toward the RANKS leaderboards (wins and eliminations); Easy and Normal matches still pay coins. In multiplayer the host's difficulty is sent in the start message and decides for everyone. The client reports `ranked` with the match result and the account server (`party/accounts.js`) adds wins/kills only when `ranked === true`. Like kills, this is client-reported, not anti-cheat. Touch gameplay is not implemented.

## Commands and Verification

| Command | Purpose |
| --- | --- |
| `npm ci --ignore-scripts` | Install root dependencies from the lockfile without lifecycle scripts |
| `npm run dev` | Run the Vite development server |
| `npm run build` | Build static output in `dist/` |
| `npm run preview` | Serve the production build locally |
| `npm run fetch-map` | Regenerate map JSON and credits; optional maintenance with external downloads |
| `npm test` | Run focused Node interior regression tests |
| `npm run test:coverage` | Measure Node test coverage (not browser coverage) |
| `npm run check:interiors` | Map-wide rooms, doors, loot, combat and multiplayer wall-event checks |
| `npm run check:stairs` | Map-wide stair collision, headroom and bot ascent/descent checks |
| `npm run party:dev` | Start the optional local lobby/party relay |
| `npm audit` | Inspect root dependency advisories |

There are no configured root lint, format or TypeScript commands. Node tests cover the interior changes; the project has not established 80% overall test coverage. Do not treat a successful build as gameplay verification.

The existing Playwright WebGL smoke harness has separate dependencies and a Chromium installation. Follow [tools/qa/README.md](tools/qa/README.md) for setup, then start the app and run:

```bash
node tools/qa/smoke.mjs --url http://localhost:5173
node tools/qa/smoke.mjs --url http://localhost:5173 --script tools/qa/interiors.mjs
```

Inspect the final JSON and screenshots. The harness can return success while reporting console errors, failed requests, or a blank canvas. It does not verify audible output or full pointer-lock behavior. `npm test` in the QA package is a failing placeholder, not the smoke-test entry point.

For future gameplay changes, add targeted unit/integration coverage and critical-flow browser checks. Multiplayer verification should include separate host/guest browsers, disconnects, malformed messages, and network failure.

## Repository Structure

```text
bentonville-royale/
├── src/
│   ├── main.js             # Boot, menus, match lifecycle
│   ├── core/               # Config, assets, input
│   ├── game/               # Simulation, player, bots, combat, loot, building, storm
│   ├── net/                # PeerJS room, friend match, input transport
│   ├── world/              # OSM-derived world and meshes
│   ├── render/             # Atmosphere, effects, postprocessing, Google tiles
│   ├── ui/                 # Menus, HUD, map, settings
│   └── audio/              # Web Audio and recorded-sample support
├── public/assets/          # Models, fonts, recorded sound effects
├── public/data/            # Processed map and supplemental data
├── scripts/                # Optional map-data generation tools
├── tools/qa/               # Standalone Playwright smoke harness
├── credits/                # Asset and data provenance
├── agents/                 # Historical contracts and handoff reports
├── AGENTS.md               # Engineering and security policy
├── README.md
├── .env.example
└── vite.config.js
```

## Architecture and Data Flow

Vite serves one browser application at `/`; there is no application API backend. `src/main.js` connects menus, settings, game loading, and friend matches. `Game.load()` reads the OSM JSON and asset manifests, builds the world, and initializes simulation/rendering.

```text
Static map + asset files -> Game/World -> Three.js canvas + DOM HUD
Browser input -> local simulation (solo/host) -> match state
Guest input/state -> WebSocket relay -> host simulation -> snapshots -> guest view
Settings + display name <-> browser localStorage
Optional Google key + enabled setting -> Google tiles -> visual layer
```

Friend matches use the WebSocket relay in `party/`. Its address is the `?party=host:port` URL override, then public `VITE_PARTYKIT_HOST`, then `localhost:1999`. Run `npm run party:dev` for local lobbies; solo/free build remains usable without it. The default local relay being offline can produce a lobby connection warning. The host runs the simulation, while guests transmit input and movement state. This is a prototype trust model: there is no dedicated trusted server, verified identity, anti-cheat guarantee, or comprehensive packet-validation guarantee. Room codes are joining conveniences, not account authentication. Host departure ends the hosted session; there is no host-migration mechanism.

The online list and matchmaking run on the Cloudflare Worker in `party/` (`npm run party:dev` locally, `npm run party:deploy` to publish). Every title screen connects to one `Presence` Durable Object (`party/presence.js`, client `src/net/Presence.js`). It reports a display name and a status (in the lobby, searching in a mode, or in a match), and receives the counts plus up to 60 names. Tab tokens are never sent to other clients, and names and statuses are self-reported, unverified display data. The **ONLINE** button on the title screen lists these players, and the party status line shows how many others are searching in your mode. When party leaders press PLAY in the same mode, the matchmaker (`party/matchmaker.js`) batches everyone who queued within 8 seconds, up to 8 humans, into one match, and bots fill the remaining spots.

Sniper rifles (any weapon with `ballistic` in `src/core/config.js`) fire projectiles with travel time and light bullet drop instead of hitscan rays. `Combat.tickProjectiles` steps them each frame. The host resolves damage; clients fly copies for visuals only. A guest's own round that reaches someone sends a hit claim, and the host accepts it only if its own round passed within the existing 1.6 m lag allowance. This is a favor-the-shooter convenience, not anti-cheat. Bots lead targets by a difficulty-scaled amount. The multiplayer protocol version is 3, so older builds can't join newer hosts.

The **CROSSHAIR** settings tab changes only the regular gun crosshair: style, a fixed color palette, capped size and thickness, and the outline. Scope, shotgun, build and pickaxe reticles stay the same for everyone, and spread-based styles still open up with bloom.

Settings are stored under `bentonville-royale.settings.v1`, and the player name under `bentonville-royale.playerName`. Remove those keys in browser storage to reset them. Match state is in memory; there is no persistent match database.

## Building Interiors

Enterable buildings have deterministic room plans, partition doors and room loot spots. Sixteen Bentonville landmarks have authored gameplay layouts; these are interpretations, not verified real interior plans. Interior version and plan hashes are included in the multiplayer map identity to reject mismatched clients.

Buildings with sufficient height, metadata and clear space receive up to four storeys. A flight needs approach pads, headroom and a side aisle; smaller or irregular buildings safely retain a single floor. Big footprints get extra stair shafts (one more per ~1,800 m² of footprint, up to four, at least 30 m apart, circulation rooms preferred) so every part of a long building has a way up. Upper floor slabs have stairwell openings, collision and ray blocking; floors and roofs are solid from below (being lifted to just under one never snaps you onto it), and build pieces inside a multi-storey building must fit under the ceiling of the storey they stand on. Stairs use continuous movement surfaces beneath visible treads. Bots route through rooms and take the nearest flight, and loot spawns on supported floors. `npm run check:stairs` on the current checked-in map reports 35 flights across 13 buildings.

Every room kind gets a deterministic furniture kit scaled to its size (`src/world/interiors/furnishings.js`): about 70 low-poly prop kinds placed along walls, in grids with aisles of at least 1.2 m, as centrepieces and as wall-mounted art, boards and screens, plus ceiling light panels. The sixteen landmarks also get authored set pieces (`src/world/interiors/landmarkDressing.js`): galleries, stages and seating, courtrooms, gyms, classrooms, food halls, brewery tanks and so on. Like the layouts, these are stylised approximations inspired by the public descriptions cited in `landmarks.js`, not real floor plans. Placement always keeps exterior and interior doorways, the door-to-room-centre lanes, loot spots, stairs and a corridor walking spine clear. Small rooms that contain stairs stay empty.

Larger furniture is solid. Beds, sofas, tables, counters, shelves, crates and similar items block movement through per-level capsule colliders (`levels[i].props`). Players can step onto low pieces and land on taller ones. Pieces marked as cover (counters, shelves, fridges, lockers, crates and similar) also stop bullets and bot sight lines (`levels[i].propBlock`). Chairs, rugs, benches and wall decor never block, and furniture is not destructible. Lighting is baked into vertex colours (skirting, ceiling bands, floor-edge shading, light pools); there are no runtime lights. Props, lights and the 32 room plaques share building chunk geometry and culling, within a render budget of 12,000 quads per ordinary building and 60,000 per landmark. Over budget, decor is trimmed before core furniture.

Pickaxes and bullets damage wall panels; broken panels open matching visual, movement and raycast gaps. Upper partitions are breakable. Floors between storeys (the ceiling of the storey below) are breakable too: each is split into tiles of up to 4 m (2 m in rooms under 80 m²; `src/world/interiors/floorTiles.js`) that you can pickaxe or shoot from above or below, then fall, see, shoot or climb through. A 0.5 m rim along every room edge, and the floor under furniture, ceiling lights and loot, stays solid. Ground floors, stairs, roofs and the exterior wall band above the ground storey remain intact. Host wall events replicate damage and breaks (walls and floor tiles alike), and match reset restores panels. Joining an already-started match is rejected; no late-join snapshot or dedicated authoritative game server is implemented.

The strict browser interiors script starts free build and exercises Player movement through a door and stairs, Combat pickaxe destruction, upper-floor loot interaction and bot stair movement through the development inspection API. It avoids headless pointer-lock limitations; audible output and real multi-browser relay play still need manual checks.

## Map and Asset Maintenance

The game currently consumes `public/data/bentonville-osm.json`. World units are meters: x east, z south, y up; heading zero faces north.

The optional scripts regenerate source data:

- `scripts/fetch-map-data.mjs`: cached OSM download and game-map generation; also consumes cached Overture heights when available. Rewrites map JSON and `credits/map-data.md`.
- `scripts/fetch-overture.py`: optional Overture building cache; requires Python and `pyarrow`, separately from npm dependencies.
- `scripts/fetch-terrain.mjs`: USGS terrain output.
- `scripts/fetch-imagery.mjs`: imagery-derived canopy and ground texture; requires the map and terrain outputs first and uses `sharp`/`geotiff`.

These tools contact external data services and write generated files. Preserve request pacing/caps, cache behavior, and provenance. Do not run the OSM fetch in parallel. Normal setup does not require regeneration. Terrain/canopy/ground outputs are not currently consumed by the game.

Asset and data credits are maintained in [credits/](credits/). Preserve the existing notices when redistributing assets or changing data processing.

## Design System and Accessibility

The game uses a deliberate cartoon dusk/Ozark visual identity. Shared tokens and fonts live in `src/ui/hud.css`; menus extend them in `src/ui/menus.css`.

| Token | Value | Role |
| --- | --- | --- |
| `--br-ink` | `#15103a` | Dark outlines/background |
| `--br-ink-2` | `#2a2070` | Secondary ink |
| `--br-panel` | `rgba(21, 16, 58, 0.74)` | HUD surfaces |
| `--br-cream` | `#fff6dc` | Text |
| `--br-sun` | `#ffc21f` | Primary emphasis |
| `--br-coral` | `#ff5d4a` | Warm accent |
| `--br-heart` | `#ff4f6d` | Health |
| `--br-sky` | `#2f9bff` | Shield/cool accent |
| `--br-leaf` | `#46cf63` | Positive/green status |
| `--br-storm` | `#a66bff` | Storm |

Display type is Lilita One; body type is Nunito, both locally hosted. Icons use the local SVG set in `src/ui/icons.js`. Components use bold ink outlines, offset shadows, rounded corners, and viewport-scaled `--u` units (1 px at the 720 px reference size, clamped from 0.75 to 2.25 px). Reuse local component spacing/radii instead of introducing another scale. HUD adaptations include a 500 px height threshold and 3:2 aspect-ratio threshold; reduced-motion CSS exists. Gameplay remains desktop-first.

For UI changes, verify focus, labels, contrast, non-color status cues, reduced motion, and smaller viewports. Existing styles do not establish a completed accessibility audit.

## Security, Privacy, and Deployment

Read [AGENTS.md](AGENTS.md) before changes. It defines engineering requirements, not proof of implemented controls.

- Optional accounts use the Cloudflare Accounts Durable Object (password PBKDF2 or Google ID-token verification). Application-level rate limiting is limited; do not store sensitive personal data beyond what the feature needs. Room codes remain joining conveniences, not verified competition identity.
- There is no upload service, model API, SQL database, or application telemetry integration established in the current source. Browser preferences persist locally; friend play and account presence contact the PartyServer worker. WebRTC paths (if used) can expose network information to peers.
- Optional Google tiles and Google sign-in contact Google with the configured public client/key values. Keep them disabled when unneeded and review provider billing and privacy implications before enabling.
- No repository CI workflow or production security-header configuration is present. CSP, framing protection, HTTPS, and other hosting controls require deployment-specific configuration and verification.
- Deploy the `dist/` output from `npm run build` to a suitable static host. `.vercelignore` exists, but a live Vercel project or deployment is not verified. Preview/production credentials, DNS, and publishing require separately authorized work.
- Personal music, raw download caches, `.env` files, and private material must remain out of deployment artifacts. The Vite local-music middleware is a development/preview facility, not an application backend in the static build.

Known dependency finding from the 2026-11-16 audit: direct development dependency `sharp@0.33.5` has a high-severity finding affecting native image processing dependencies. It is used by the optional imagery-generation tool. This template integration does not upgrade it; review a compatible upgrade and verify image processing before running that pipeline against untrusted inputs.

## Troubleshooting and Current Limitations

- **No audio:** interact with the page to unlock Web Audio and check the volume. Recorded sample failures fall back to synthesis; see [src/audio/README.md](src/audio/README.md).
- **Google toggle disabled:** configure the optional key and restart Vite. Check billing, enabled Map Tiles API, and referrer/API restrictions.
- **Friend cannot join:** check the code and network access to signaling/STUN. Restrictive NAT/firewalls may fail without TURN. Host/guest E2E behavior still needs broader verification.
- **Poor rendering performance:** select Low quality and disable optional tiles. Rendering requires WebGL2; performance depends on device/GPU.
- **Map regeneration fails:** inspect cached download state and script errors; do not bypass upstream request caps or assume partial outputs are complete.

Main gaps are automated test coverage, trusted multiplayer security, touch input, supplemental terrain/imagery integration, and verified production hosting/accessibility. These are limitations, not promises of scheduled work. `agents/SUMMARY.md` is a historical handoff and predates the networking code; use current source for capability claims.

## Contributing and Template Provenance

Keep changes focused, preserve user work, inspect current source, add tests for behavior changes, run applicable checks, and update these docs when setup or behavior changes. Use conventional commits. The owner requires Greptile for PR reviews; local specialist reviews supplement it. Do not commit/push or create a PR solely to obtain a review without authorization.

This README and the engineering policy are adapted from the owner's [Template repository](https://github.com/rakshithj09/Template), inspected 2026-11-16: README blob `463ec195e4a217c999a2d934d697b04d88b0eb49`, AGENTS blob `ffc0f926665e10e7b3962c6ff40bf1058e34c126`. Placeholder/example-only sections were replaced with repository facts; inapplicable API/database/upload/RAG sections were omitted from this README. The policy retains conditional safeguards for future changes and preserves owner workflow/Greptile requirements.

The required [AgenticSkills directory](https://agenticskills.io/) lookup was completed during adaptation; no external skills or packages were adopted from that directory. Existing local workflow guidance and repository source informed the documentation.

No root application license is currently specified. Individual asset/data provenance remains in `credits/`; this README does not relicense those materials.
