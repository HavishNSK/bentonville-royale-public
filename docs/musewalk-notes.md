# Musewalk reference notes (for porting the gallery look)

Source: https://github.com/shuyan-5200/musewalk, shallow clone at commit
`6510b5fce6766df642d382102d41308e1bdf1355` (2026-09-27), inspected 2026-11-17.
Local clone: `/Users/shehryarahmed/musewalk-ref` (outside this repo, not vendored).
Reference stack: three `^0.182.0` (installed 0.182.0), camera-controls 3.1.2, Vite 8.1.4,
`@fontsource-variable/cormorant-garamond` 5.3.0, `@fontsource-variable/noto-serif-sc` 5.3.0.
Our game is on three 0.187; every API used below (UnrealBloomPass, Reflector, RoomEnvironment,
NeutralToneMapping, InstancedBufferGeometry, SpotLight.map) exists there.

## License

- Code: MIT. Exact copyright line in `LICENSE`: **`Copyright (c) 2026 Musewalk contributors`**
- LICENSE adds: "This MIT license covers the SOURCE CODE of this project only. Bundled media assets are
  governed by their own terms and the release status recorded in CREDITS.md."
- Assets (CREDITS.md):
  - 36 paintings: Wikimedia Commons, all 36 manifest entries `licenseShortName: "Public domain"`
    (`public/art/sources.manifest.json`; "rights can vary by jurisdiction").
  - Venus de Milo mesh: SMK scan of plaster cast KAS434, Public Domain Mark 1.0 / CC0 (decimated to 23,992 tris).
  - `public/textures/disturb.jpg` (spotlight cookie): "Disturb" by Mitch Featherston, **CC BY 2.5**
    (same file ships with the three.js spotlight example). Attribution required if reused.
  - `og-cover.jpg`, `docs/screenshots/*`: CC0 1.0.
  - Fonts: Cormorant Garamond + Noto Serif SC, SIL OFL 1.1.
  - Audio: none; synthesized with Web Audio.
- Anything quoted below keeps the MIT notice: `Copyright (c) 2026 Musewalk contributors`, MIT License.
  If code is copied into Bentonville Royale, include the MIT notice + copyright line with it.

## Reference screenshots (`docs/musewalk-reference/`)

Captured headless with Playwright Chromium `--use-angle=metal` from the local dev server,
1440x900 viewport. Internal reference only. Paintings visible in them are musewalk demo files,
all marked **Public domain** on Wikimedia Commons per `sources.manifest.json`; the rotunda
also shows the SMK Venus de Milo scan (PDM/CC0) lit through the CC BY 2.5 "Disturb" cookie.
Do not copy the art files themselves into this repo.

| File | What it shows | Demo art visible (Commons file, license) |
| --- | --- | --- |
| 01-landing.jpg | Landing page over the rotunda | Venus scan; door previews of portal screens |
| 02-landing-sound-on.jpg / 02b-sound-toggle-closeup.jpg | Sound pill ON state (gold), landing-mode position | same |
| 03-entering-glide.jpg | Mid camera glide from landing pose into the lobby | same |
| 04-rotunda-entry.jpg | Rotunda, three wing doors, sculpture under cookie spotlight | Monet portal (Impression, Sunrise) through door II |
| 05-wing-classical-corridor.jpg | Classical ring hall (wine walls, gold accent) with artist portals | Mona Lisa (`File:Mona Lisa, by Leonardo da Vinci, from C2RMF retouched.jpg`), Girl with a Pearl Earring (`File:1665 Girl with a Pearl Earring.jpg`) — PD |
| 05-wing-modern-corridor.jpg | Modern ring hall (blue) with 4 portals | Starry Night, Impression Sunrise, The Scream, The Kiss — PD |
| 05-wing-future-corridor.jpg | Future "open" ring hall with 6 empty gold frames | none |
| 06-wing-classical-portal-vermeer.jpg | Facing one artist portal (misty image + overlay text) | Girl with a Pearl Earring — PD |
| 07-rotunda-look-left.jpg | Rotunda after a mouse-drag look | as 04 |
| 08-classical-a-portal-particle-transition.jpg | Portal dissolving into particles on entry | Girl with a Pearl Earring — PD |
| 08-classical-b-gallery-intro-card.jpg | Gallery intro card over particles | same |
| 08-classical-c-gallery-vermeer.jpg | Vermeer corridor (gold frames, wine walls) | Vermeer set (Pearl, Milkmaid, Lacemaker, Astronomer, Delft, Letter) — PD |
| 08-classical-e-focus-camera-mid-tween.jpg | Focus camera mid-glide | Pearl — PD |
| 08-classical-f-focus-info-panel.jpg | Focus framing + right info panel + vertical poem | Pearl — PD |
| 09-modern-d-hover-caption.jpg | Hover caption (italic title + gold original) and accent hover-glow plane behind Starry Night | Starry Night — PD |
| 09-modern-*.png | Same sequence for Van Gogh corridor (dark frames, blue light) | Starry Night (`File:Van Gogh - Starry Night - Google Art Project.jpg`), Sunflowers (`File:Vincent Willem van Gogh 127.jpg`), Almond blossom, Café Terrace, etc. — PD |
| 10-walk-into-painting-a..f.jpg | White veil → dream reveal → strokes rising → flat → orbit → "In Relief" (solid) | Starry Night — PD |
| 11-stardust-a..d.jpg | Handoff → dissolving → floating → drift (sound on) | Starry Night — PD |
| 12-future-wing-hint.jpg | Future wing after returning | none |

(See the final section "Screenshot run log" for which captures succeeded.)

## File map

| File | Role |
| --- | --- |
| `index.html` | `<canvas id="scene">` + `<div id="ui">`; loads `src/main.js`. |
| `src/main.js` | Renderer, camera, PMREM env, composer, state machine (`boot → landing → lobby/transition/hall → focus → dream → immersion`), picking/hover, focus framing math, all transitions/veils, bloom targets per state, main loop, `window.__musewalk` automation hooks. |
| `src/data.js` | Loads `gallery.config.json` (`?config=` same-origin override, altLang auto-switch), fills defaults, hex→int theme conversion, engine HINTS + UI label defaults, default dream poems. |
| `src/lobby.js` | Rotunda (drum walls, marble canvas texture, brass trims, dome, floor, Venus on pedestal, orbiting cookie spotlight), wing doors (pilasters, lintel, tablet, door glow), per-wing ring "antechamber" with artist portals (misty screens) or empty/future frames, walk bounds, zones, poses. |
| `src/hall.js` | Per-artist corridor gallery ("hall"): mirror floor, walls, backing panels, frames (`buildFrame`), plaques, per-painting spotlights, artist header, end wall text, back-door membrane, dust, fog. |
| `src/fx.js` | `createComposer` (Render → UnrealBloom → Output), `makeDust` (shader point dust), `makeMembrane` (door light film), `makeDoorGlow`, `makeBeam` (light cone), `makeMistyImage` (portal screen shader), `makeRipple` (floor click ring). |
| `src/utils.js` | Tween manager + easings, `drawSpaced` (manual letter spacing on canvas), `textPlane` (canvas-texture text quad), font stacks, `softCircleTexture`, `imageAverageColor`, dispose helpers. |
| `src/cameraRig.js` | camera-controls wrapper: first-person walk (SmoothDamp), focus/release tweens, orbit mode for dream, driven mode for stardust. |
| `src/ui.js` | All DOM UI: landing, veil, HUD crumb, tool buttons (Sound / Home), hint, hover caption, hall intro card, gallery intro card (loading/enter states), info panel (+ touch bottom sheet), dream UI, immersion UI. |
| `src/styles.css` | All UI CSS (tokens, landing, HUD, caption, intro card, panel, dream/immersion UI, touch overrides). |
| `src/dream.js` | "Step into the painting" scene: palette from image, gradient dome, mist curtains, still-water floor shader, light pool, beams, dust, orbit camera params, poem choice. |
| `src/dreamBodies/strokes.js` | Painting body made of ~42k instanced billboard "brush-stroke chips" displaced by blurred luminance depth; flat ↔ relief modes. |
| `src/immersion.js` | "Become stardust": ~52k point particles from the image, dissolve shader, scripted camera fly-through, ghost title text, FogExp2. Also reused as the portal→gallery transition. |
| `src/audio.js` | Web Audio ambient synth (drone, pad, tide noise, chimes w/ cross-feedback delay), per-mode params, `tide01()` clock that also drives visuals. |
| `src/appVariant.js` | `SCULPTURE_MODEL = 'models/venus-de-milo-24k.geometry.json'`. |
| `public/gallery.config.json` (+ `.zh.json`, `.mini.json`) | Whole museum content. |
| `scripts/fetch_art.py` | Wikimedia Commons downloader with license gate + manifest. |
| `scripts/verify.mjs` | puppeteer-core headless walkthrough (fails on console errors / assertions). |
| `scripts/check-config.mjs` | Static config/asset/ID checks. `check-privacy.mjs`, `check-release-assets.mjs`: release gates. |

There is no separate "post-processing/color grading" file beyond `fx.js#createComposer`; there is no LUT, no color-grade pass, no SSAO, no shadows (no `castShadow` anywhere). The "grade" is: NeutralToneMapping + bloom + CSS vignette + per-scene palettes.

## Renderer, camera, environment, post (main.js / fx.js)

```js
renderer = new THREE.WebGLRenderer({ canvas, antialias: !IS_TOUCH, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, IS_TOUCH ? 1.5 : 2));
renderer.toneMapping = THREE.NeutralToneMapping;   // toneMappingExposure NOT set → 1.0
// outputColorSpace left at default (SRGBColorSpace); all image textures colorSpace = SRGBColorSpace
// anisotropy = min(maxAnisotropy, touch ? 4 : 8)
camera = new THREE.PerspectiveCamera(58, aspect, 0.1, 160);
// IBL: PMREMGenerator.fromScene(new RoomEnvironment(), 0.04) → scene.environment on lobby + every hall
```

Composer: `RenderPass` → `UnrealBloomPass(Vector2(innerWidth, innerHeight), strength 0.4, radius 0.85, threshold 1.05)` → `OutputPass` (OutputPass applies the tone mapping + sRGB).
Bloom strength is eased every frame: `bloom.strength = lerp(bloom.strength, bloomTarget, min(1, dt*2))`.

| State | bloomTarget |
| --- | --- |
| Lobby / rotunda / ring halls | 0.42 |
| Artist corridor (hall) and focus from hall | 0.55 |
| Dream (step into painting) | 0.50 |
| Stardust + portal→gallery particle transition | 0.78 |

Threshold 1.05 means only HDR-ish emissive elements bloom (MeshBasic trims multiplied ×1.4–1.5, sky strips, beams, additive glows). Painting canvases are `MeshBasicMaterial` (unlit, ≤1.0) so they never bloom.

CSS overlays act as grading: `.vignette` radial gradient (see UI CSS), `.vignette.deep` in focus/dream.

## Palette (CSS tokens + global colors)

```css
:root {
  --gold: #d4af5a;
  --gold-dim: rgba(212, 175, 90, 0.45);
  --ink: #e9e2d4;
  --ink-dim: rgba(233, 226, 212, 0.55);
  --bg: #07070a;
  --serif-cn: 'Noto Serif SC Variable', 'Noto Serif SC', 'Songti SC', 'STSong', serif;
  --serif-en: 'Cormorant Garamond Variable', 'Cormorant Garamond', 'Didot', 'Times New Roman', serif;
  --ease: cubic-bezier(0.22, 0.61, 0.36, 1);
}
```

Other recurring colors: veil black `#000`, white veil `#f6f1e6`; canvas text cream `rgba(238,231,217,a)` (#eee7d9) and `rgba(243,237,225,0.99)`; plaque bg `rgba(10,10,14,0.64)`; dream poem `rgba(238,231,217,0.9)`; default accent / ripple `#b7a98c`; favicon stroke `#b7a98c`.
Selection `rgba(212,175,90,0.3)`. Body font is `--serif-cn` (Noto Serif SC renders the Latin UI text too); `--serif-en` is used for titles/italics.

## Per-wing themes (gallery.config.json)

| Wing | accent | wall | panel | floor | fog | lightColor | frameStyle |
| --- | --- | --- | --- | --- | --- | --- | --- |
| I Classical "LUMEN AETERNUM" | `#d4af5a` | `#33191c` | `#422026` | `#0e0a09` | `#0f0908` | `#ffd9a8` | gold |
| II Modern "LA LUMIÈRE ET L’INSTANT" | `#7fb4d8` | `#1d2734` | `#263344` | `#0a0d11` | `#090c10` | `#cfe4ff` | dark |
| III Future "ARS FUTURA" (type open, frames 6) | `#e8a25a` | `#4a4239` | `#5a5044` | `#14110d` | `#13100c` | `#ffeed2` | gold |
| Engine defaults (data.js) | `#b7a98c` | `#2a211c` | `#39302a` | `#0d0a08` | `#0c0908` | `#ffe2b8` | dark |

An artist may override any of these via `artist.atmosphere` (only inside its own corridor). Empty-frame palette (future wing): `[0xe0564a, 0x7fb4d8, 0xd4af5a, 0x8aa67c, 0xb48ad8]`.

## Rotunda / lobby (lobby.js) — exact values

Dimensions: drum radius `R = 14`, height `H = 9`, door half-angle gap `GAP = 0.145` rad; wing doors spread `STEP = 0.78` rad apart, centered opposite the entrance (`angles = -spread/2 + spread/(n-1)*i`, spread = `min((n-1)*0.78, 1.5π)`).

- `scene.background = 0x050403`. **No fog in the rotunda.**
- Marble canvas texture (`makeMarbleTexture`, 512², repeat (2,1)): base `[232,228,218]`, vein `[158,148,132]`, accent `[248,244,232]`, scale 0.85.
- Drum wall: `MeshStandardMaterial({ color 0x302a24, map marble, roughness 0.88, metalness 0.01, DoubleSide })`; plinth (h 1.05, y 0.52) `0x1b1713` rough 0.84 metal 0.02.
- Cornice ring (h 0.55, y = H−0.55) `0x28221d` rough 0.86 BackSide.
- Brass: `MeshStandardMaterial({ color 0x77603a, metalness 0.88, roughness 0.42, envMapIntensity 0.65 })`; torus band r R−0.07, tube 0.022 at y 1.08.
- Dome/ceiling disk: `0x25211d` + marble, rough 0.94.
- Floor: `MeshLambertMaterial({ color 0x8a8478 })` circle R+0.2 (deliberately mid warm-grey so the cookie spotlight reads).
- Pedestal `CylinderGeometry(1.08, 1.18, 0.36, 72)` `0x1d1712`+marble rough 0.62 metal 0.05 envMapIntensity 0.18; brass cap `(1.22,1.22,0.08)` at y 0.4.
- Venus: `MeshLambertMaterial({ color 0xfffbf1, emissive 0x241f18, emissiveIntensity 0.12 })`, geometry scale 0.0024, rotation.y π.
- Fake contact shadow: plane 3.8×1.25, radial gradient texture (0→rgba(0,0,0,0.5), 0.5→0.2, 0.78→0.05, 1→0), color `0x17120f`, opacity 0.34, rotates with the key light.
- **Key light**: `new SpotLight(0xffffff, 155, 0 /*distance∞*/, Math.PI/6, 1 /*penumbra*/, 2 /*decay*/)`, `spot.map = disturb.jpg` (Linear filters, no mipmaps, sRGB). Orbits: `a = t*0.16; pos = (cos a*3.2, H−1.55 = 7.45, sin a*3.2)`, target `(−cos a*0.55, 0.1, −sin a*0.55)`.
- Statue fill: `SpotLight(0xfff7ea, 20, 13, 0.52, 0.82, 1.6)` at `(0, 7.65, 3.2)` → target `(0, 1.58, 0)`.
- Ambient: `HemisphereLight(0xf4eadc, 0x211a14, 0.16)` + `AmbientLight(0xffffff, 0.018)`.
- Dust: `makeDust({ count 170, box [7, 7.5, 7], center [0, 4.5, 0], opacity 0.22 })` (color default `0xfff2d8`, size 0.035).
- Wing door (local +z toward hall): cheeks `Box(0.5,4.85,1.7)` at x ±2.05; passTop `Box(4.6,1.5,1.7)` y 5.6; stone `0x2c241d`+marble rough 0.74 metal 0.04; stoneDark `0x0d0a08` rough 0.86. Pilasters `Box(0.6,5.5,0.42)` at x ±2.12 z 0.7; inner jamb `(0.28,5.0,0.22)` x ±1.78; capitals `(0.78,0.3,0.46)` y 5.62; bases `(0.78,0.36,0.46)` y 0.18; lintel `(5.0,0.85,0.44)` y 6.2; brass lintel trim `(5.0,0.07,0.045)` y 5.81. Tablet back `(4.25,1.45,0.08)` y 7.32; tablet text plane 4.05×1.28 @210ppm: double accent stroke rect (3px α0.65 inset 10, 1.5px α0.3 inset 22), numeral `400 h*0.16 FONT_EN` accent α0.92 at y 0.24h, name `300 h*0.21 FONT_CN` spacing 6 (auto-fit to 92% width) cream α0.95 at 0.52h, latin `300 h*0.12 FONT_EN` spacing 3 cream α0.42 at 0.79h.
- Door lights: `PointLight(wing.accent, open ? 4 : 1.3, 9, 1.8)` at `(0,3.2,0.9)` (+1.8 on hover); tablet `PointLight(0xffe2b8, 3, 5, 1.8)` at `(0,6.6,1.6)` (+4 on hover). Door hover glow (`makeDoorGlow(3.7, 4.7, accent)`): halo opacity `hover*0.16`, outline `hover*0.55`, veil shader alpha `hover*0.13`; tablet halo `hover*0.24`. Hover easing `hover += (target−hover)*min(1, dt*6)`.

### Ring hall per wing ("antechamber", lobby.js `buildAntechamber`)

- Passage length `DPASS = 3.6`, ring height `RING_H = 6.6`, entrance half-angle 0.46, radius `ringRadiusFor(n) = max(7, min(11.5, 5.6 + n*0.62))`.
- Mirror floor `Reflector(CircleGeometry(rr,72), { clipBias 0.003, 512×512, color 0x8a8a90 })` + tint circle `MeshBasic(wing.floor, opacity 0.82)`.
- Ring wall `CylinderGeometry(rr+0.25, …, RING_H, 80, open, BackSide)` `MeshStandard(wing.wall, rough 0.95, metal 0.02)`; ceiling `0x0a0908`; sky disk r 2.2 `MeshBasic(lightColor × (open?0.5:0.4))`; glowing trim torus r rr−0.05 tube 0.025 at y 0.14 `MeshBasic(accent × 1.4)`.
- Center light: `PointLight(wing.lightColor, open ? 16 : 13, rr*2.4, 1.6)` at y 5.9.
- Artist portals spread at ~0.8 rad each around the back wall; open wing frames clustered within 3.6 rad.
- **Artist portal** (`buildArtistPortal`): screen h 3.0 (w = h·aspect, max w 4.1), centre y 2.45; frame `Box(w+0.2, h+0.2, 0.13)` `0x130f0b` rough 0.68 metal 0.3; lip `Box(w+0.03,h+0.03,0.02)` `0x6a5a3c` metal 0.7 rough 0.5 envMapIntensity 0.5; `makeMistyImage(texture, accent, w, h, { dim 0.46, haloDiameter min(max(w,h)*1.5, 4.9) })`; 90-particle accent dust (opacity 0.5, size 0.05); text overlay (epithet 0.05h accent α0.88 at 0.31h, name 0.115h cream α0.99 at 0.45h, original italic 0.05h α0.66 at 0.55h, dates 0.042h accent α0.72 at 0.615h, gradient rule at 0.67h, `「 line 」` 0.046h α0.84 at 0.9h; center radial darkening rgba(8,7,6,0.6)→0).
- Misty screen shader: texture × `mix(uDim, 1, uHover*0.6)`; 6% feathered edges (alpha = edge); rim mist `uAccent * rim * (0.1 + mist*0.1)`; halo opacity `0.34 + hover*0.4`; outline opacity `hover*0.85`; float bob `y = sin(t*0.55+phase)*0.035`.
- Future wing works: gold frame same as hall gold; featured maxH 2.7 / maxW 4.0 (landscape) or 3.4; others maxH 1.95–2.05 / maxW 3.3 or 2.05; centre y 2.35; `SpotLight(lightColor, featured ? 78 : 64, 16, 0.5, 0.72, 1.6)` from 2.6 m inward at y RING_H−0.5. Empty frames: 1.5×1.9 (portrait) / 2.1×1.45, gold box `(w+0.3,h+0.3,0.1)`, lip `0x241c10`, canvas `MeshBasic(0x6f6859)`, colored bar `w*0.55 × 0.045` (palette ×1.25) and "No.00N Reserved" plaque 0.95×0.34.

## Artist corridor gallery (hall.js) — exact values

Constants: `WALL_X = 6.5` (half-width), `HEIGHT = 7.6`, `HANG_Y = 2.42`.

- `scene.background = new Color(hall.fog)`; **`scene.fog = new THREE.Fog(hall.fog, 10, 64)`** (linear, near 10, far 64).
- Layout (single artist): works alternate left/right, `STRIDE = 4.0` (same side every 8 m), first work centre z −7.0; each work section `z0 = zp + 4.2`; corridor end `zEnd = −7 − (n−1)*4 − 6.5`; entry pose `(0, 1.7, 3.6)`, yaw 0. Walk bounds x ∈ [−5.5, 5.5], z ∈ [zEnd+1.4, 4.8].
- Mirror floor: `Reflector(PlaneGeometry(14.4, totalLen+6), { clipBias 0.003, textureWidth/Height 1024 (512 touch), multisample 4 (0 touch), color 0x9090a0 })` + floor tint `MeshBasic(hall.floor, transparent, opacity 0.86, depthWrite false)` at y 0.012.
- Walls: `BoxGeometry(0.4, 7.6, totalLen+6)` with `MeshStandardMaterial({ color hall.wall, roughness 0.96, metalness 0.02 })`; end/entry walls same material.
- Ceiling: `MeshStandard(0x08080a, roughness 1)`.
- Sky strip (skylight): `PlaneGeometry(1.5, totalLen−6)` `MeshBasic(lightColor × 0.5)` at y 7.54.
- Skirting glow line: `Box(0.03, 0.03, totalLen+5)` `MeshBasic(accent × 1.5)` at x ±6.48, y 0.16.
- Backing panel per section: `Box(0.09, 5.3, panelLen)` `MeshStandard(hall.panel, roughness 0.92)` at x ±6.45, y 2.95; `panelLen = 7.4 + (n−1)*4.7`.
- Lights: `HemisphereLight(lightColor × 0.5, hall.floor, 1.1)` + `AmbientLight(0xffffff, 0.18)`.
- **Per-painting spotlight**: `new SpotLight(hall.lightColor, frameStyle==='float' ? 44 : 76, 17 /*distance*/, 0.6 /*angle rad ≈34°*/, 0.78 /*penumbra*/, 1.7 /*decay*/)`, position `(side*3.8, 6.9, z)`, target `(side*6.5, 2.42, z)`. No shadows.
- End wall: text plane 9×4.5 @100ppm (numeral `300 0.16h FONT_EN` accent α0.9; name `200 0.2h FONT_CN` spacing 14 cream α0.92; latin `300 0.07h FONT_EN` spacing 6 α0.4) at y 4.1; light cone `makeBeam({ rTop 0.8, rBottom 3.2, height 7.6, color lightColor, opacity 0.1 })` (open cylinder, vertical alpha gradient 0.55→0.12@0.6→0, additive).
- Artist header (first section): text plane 6×3 @110ppm at y 5.05 on the wall: `「 epithet 」` `300 0.075h CN` accent α0.78 spacing 6 @0.13h; name `300 0.155h CN` α0.97 spacing 8 @0.38h; original `italic 300 0.082h EN` α0.5 @0.6h; dates `300 0.065h EN` accent α0.65 spacing 3 @0.76h; gradient rule 60% width at 0.875h, 2px.
- Back door: `makeMembrane(3.0, 4.6, accent)` (animated additive film, alpha `(0.07 + glow*0.11 + hover*0.24)*edges`) + plaque "回 长 廊 / BACK TO THE GALLERIA".
- Dust: `makeDust({ count 600, box [13, 6.6, totalLen], center [0, 3.8, zMid], opacity 0.32 })`.

### Frames (`buildFrame`) and painting size rules

| style | geometry | material | canvas z |
| --- | --- | --- | --- |
| gold | outer `Box(w+0.34, h+0.34, 0.12)`; inner lip `Box(w+0.08, h+0.08, 0.06)` at z 0.04 | outer `MeshStandard(0xa8843c, metalness 0.92, roughness 0.34)`; lip `MeshStandard(0x1c150c, roughness 0.6)` | 0.075 |
| dark | `Box(w+0.14, h+0.14, 0.08)` | `MeshStandard(0x191310, metalness 0.25, roughness 0.5)` | 0.045 |
| float | back `Box(w+0.55, h+0.55, 0.04)`; stand `Box(w+0.05, h+0.05, 0.06)` z 0.045 | back `MeshStandard(0x77767a, roughness 0.96)`; stand `MeshStandard(0x101013, roughness 0.6)` | 0.08 |

So: gold border = 0.17 m per side (0.12 deep) with a 0.04 m dark sight-edge (lip); dark border = 0.07 m per side (0.08 deep); there is **no mat/passe-partout** in any style (float has a 0.275 m grey backboard reveal).
Painting size: `maxH = 2.35`, `maxW = work.wide ? 3.9 : 2.7`; `h = maxH; w = h*aspect; if (w > maxW) { w = maxW; h = w/aspect }`. Canvas = `MeshBasicMaterial({ map })` (unlit). Hung at `x = side*(6.5−0.16)`, y 2.42, rotated to face the corridor. Hover glow plane `(w+1.0, h+1.0)` accent additive at z −0.06, `opacity = hover*0.32`; group scale `1 + hover*0.012`.

### Wall plaque (label next to each painting, canvas texture)

`textPlane({ width: plaqueW (0.9–1.55, by title length), height: 0.42, ppm: 460 })`, placed `gapFromFrame 0.46` m right of the frame, centre y = HANG_Y−(HANG_Y−1.42) → world y 1.42, z 0.24 off wall.
- Fill `rgba(10,10,14,0.64)`; stroke accent α0.58, lineWidth `max(2, round(h*0.012))`, inset `pad*0.48` where `pad = h*0.13`.
- Title `《title》` `400` weight FONT_CN, start `0.2h` px, min `0.135h`, spacing 2px, `rgba(238,231,217,0.95)`, at y 0.3h (auto-shrinks 1px at a time, spacing −0.08 per step).
- Original (translated title) `italic 300` FONT_EN, start 0.13h, min 0.09h, accent α0.85, at 0.56h.
- Year `300` FONT_CN, start 0.11h, min 0.085h, `rgba(238,231,217,0.58)`, at 0.78h.

## UI typography & CSS (styles.css / ui.js)

Fonts: `@fontsource-variable/cormorant-garamond` (+ `wght-italic.css`) and `@fontsource-variable/noto-serif-sc`, preloaded through `document.fonts.load` for weights 200/300/400 before canvas text is drawn (3 s timeout). Canvas stacks: `FONT_CN = '"Noto Serif SC Variable", "Noto Serif SC", "Songti SC", serif'`, `FONT_EN = '"Cormorant Garamond Variable", "Cormorant Garamond", "Times New Roman", serif'`.
Style signature: very wide letter-spacing (0.2–0.95em) with matching `text-indent` to re-centre, light weights (200–300), gold/cream on near-black, 1px hairline gold borders, no border radius except the 44px pill tool buttons.

Hover caption (DOM, follows the cursor, flips left within 340px of the right edge):

```css
.caption { position: fixed; z-index: 25; pointer-events: none; transform: translate(18px, -50%);
  opacity: 0; transition: opacity 0.35s var(--ease); max-width: 300px; }
.caption.show { opacity: 1; }
.caption .cap-t { font-size: 16px; font-weight: 400; letter-spacing: 0.18em; color: var(--ink);
  text-shadow: 0 1px 12px rgba(0,0,0,.9); }
.caption .cap-s { font-family: var(--serif-en); font-style: italic; font-size: 12.5px; font-weight: 300;
  letter-spacing: 0.08em; color: var(--gold); margin-top: 3px; text-shadow: 0 1px 10px rgba(0,0,0,.9); }
```
`.cap-t` = `<i>title</i>` (or `《title》` for CJK); `.cap-s` = `work.original`. Hover is throttled to 40 ms.

Info panel (focus mode, right side): DOM order inside `.panel > .p-scroll`: `.p-hall` ("I · Johannes Vermeer"), `h1.p-title`, `.p-orig`, `.p-meta` (year · medium `<br>` museum), `.p-rule`, `p.p-desc`, `.p-artist-label` ("ARTIST"), `.p-artist-name`, `.p-artist-dates` (original · dates), `.p-epithet` (`「 epithet 」`), `p.p-bio`; then `.p-actions` (`button.p-enter` "Step Into the Painting" + `button.p-close` "Back") and absolutely positioned vertical `.p-poem` (work.line). Each scroll child gets `.reveal` + `--i` index.

```css
.panel { position: fixed; top: 0; right: 0; bottom: 0; z-index: 35; width: min(440px, 94vw);
  padding: 80px 96px 28px 48px; box-sizing: border-box; display: flex; flex-direction: column; overflow: hidden;
  background: linear-gradient(200deg, rgba(11, 11, 17, 0.62), rgba(6, 6, 10, 0.86));
  backdrop-filter: blur(20px) saturate(1.25); border-left: 1px solid rgba(212, 175, 90, 0.22);
  transform: translateX(103%); transition: transform 1.05s var(--ease); }
.panel.show { transform: translateX(0); pointer-events: auto !important; }
.panel .p-hall { font-size: 11px; letter-spacing: 0.4em; color: var(--gold-dim); }
.panel .p-title { margin-top: 18px; font-size: 36px; font-weight: 300; letter-spacing: 0.1em; line-height: 1.5; }
.panel .p-orig { margin-top: 8px; font-family: var(--serif-en); font-style: italic; font-size: 17px; font-weight: 300; color: rgba(233, 226, 212, 0.62); }
.panel .p-meta { margin-top: 20px; font-size: 11.5px; letter-spacing: 0.22em; line-height: 2; color: var(--gold); }
.panel .p-rule { height: 1px; margin: 26px 0; background: linear-gradient(to right, var(--gold-dim), transparent); }
.panel .p-desc { font-size: 14.5px; font-weight: 300; line-height: 2.35; color: rgba(233, 226, 212, 0.86); text-align: justify; }
.panel .p-artist-label { margin-top: 38px; font-size: 10.5px; letter-spacing: 0.5em; color: var(--gold-dim); }
.panel .p-artist-name { margin-top: 12px; font-size: 21px; font-weight: 400; letter-spacing: 0.12em; }
.panel .p-artist-dates { font-family: var(--serif-en); font-size: 13px; font-style: italic; color: rgba(233, 226, 212, 0.5); margin-top: 4px; }
.panel .p-epithet { margin-top: 14px; font-size: 13.5px; letter-spacing: 0.26em; color: var(--gold); }
.panel .p-bio { margin-top: 14px; font-size: 13px; font-weight: 300; line-height: 2.2; color: rgba(233, 226, 212, 0.66); text-align: justify; }
.panel .p-actions { flex: 0 0 auto; margin-top: 18px; padding-top: 16px; display: flex; gap: 14px; align-items: center;
  background: linear-gradient(to bottom, rgba(6, 6, 10, 0), rgba(6, 6, 10, 0.72) 28%, rgba(6, 6, 10, 0.92)); }
.panel .p-enter { flex: 1; padding: 15px 10px 13px; font-family: var(--serif-cn); font-size: 13.5px;
  letter-spacing: 0.42em; text-indent: 0.42em; color: var(--gold); background: rgba(212, 175, 90, 0.07);
  border: 1px solid rgba(212, 175, 90, 0.55); cursor: pointer; transition: all 0.6s var(--ease); }
.panel .p-enter.latin { letter-spacing: 0.16em; text-indent: 0.16em; white-space: nowrap; }
.panel .p-enter:hover { background: rgba(212, 175, 90, 0.2); box-shadow: 0 0 34px rgba(212, 175, 90, 0.28); }
.panel .p-close { padding: 15px 22px 13px; font-family: var(--serif-cn); font-size: 13px; letter-spacing: 0.2em; text-indent: 0.2em;
  color: var(--ink-dim); background: transparent; border: 1px solid rgba(233, 226, 212, 0.2); cursor: pointer; transition: all 0.6s var(--ease); }
.panel .p-poem { position: absolute; top: 84px; right: 30px; writing-mode: vertical-rl; font-size: 16.5px; font-weight: 300;
  letter-spacing: 0.34em; line-height: 2.1; max-height: 62vh; color: rgba(212, 175, 90, 0.78); text-shadow: 0 0 22px rgba(212, 175, 90, 0.25); }
.panel .reveal { opacity: 0; transform: translateY(16px); }
.panel.show .reveal { animation: rise 1s var(--ease) both; animation-delay: calc(0.25s + var(--i, 0) * 0.09s); }
@keyframes rise { from { opacity: 0; transform: translateY(26px); } to { opacity: 1; transform: translateY(0); } }
```
Scrollbar: thin, thumb `rgba(212,175,90,0.22)`, 5px, radius 999px. Touch: panel becomes a bottom sheet (border-top 1.5px gold α0.55, radius 22px 22px 0 0, peek 104px, transition 0.42s).

Other UI blocks:
- `.vignette`: `radial-gradient(ellipse 130% 100% at 50% 45%, transparent 55%, rgba(0,0,0,0.42) 100%)`; `.deep`: `ellipse 120% 95% …, transparent 40%, rgba(0,0,0,0.62)`; transition opacity 1.2s.
- `.veil`: fixed, z 45, `#000`, opacity transition set per call (`transitionDuration = dur ms`), `.white` → `#f6f1e6`.
- Landing: bg `radial-gradient(ellipse 90% 70% at 50% 38%, rgba(10,10,16,0.18) 0%, rgba(5,5,9,0.72) 100%)`; kicker `--serif-en clamp(11px,1.2vw,14px)` spacing 0.95em ink-dim (rise 1.6s delay 0.2s); title `--serif-en clamp(64px,11.5vw,138px)` w300 spacing 0.3em line-height 1.2, `text-shadow: 0 0 70px rgba(212,175,90,0.18)` (rise 1.8s/0.5s); sub `--serif-cn clamp(15px,1.9vw,22px)` w300 spacing 0.58em gold (1.8s/0.8s); tagline `clamp(13px,1.4vw,16px)` w300 spacing 0.34em ink-dim margin-top 96px (1.8s/1.3s); enter button padding `17px 54px 15px`, 15px w400 spacing 0.5em, `border: 1px solid rgba(212,175,90,0.5)`, hover bg `rgba(212,175,90,0.12)` + `box-shadow: 0 0 44px rgba(212,175,90,0.3), inset 0 0 22px rgba(212,175,90,0.08)` (rise 1.8s/1.7s); foot 12px spacing 0.28em `rgba(233,226,212,0.42)` bottom 4.5dvh (1.8s/2.1s). Loader: 1px bar `rgba(233,226,212,0.14)` with fill `linear-gradient(to right, transparent, var(--gold))`, width 0.4s.
- HUD crumb (top 30 left 36): logo `--serif-en 19px w500 spacing 0.32em`, separator `◆` gold-dim 12px, location 12.5px w300 spacing 0.28em ink-dim.
- **Sound toggle** (`.tool-btn.sound-btn`, label "Sound"): `min-width 44px; height 44px; padding 0 13px; border-radius 22px; border 1px solid rgba(233,226,212,0.26); background rgba(8,8,12,0.35); backdrop-filter blur(8px); color ink-dim; font 14.5px --serif-cn; transition all 0.5s`. Off state draws a diagonal strike: `::after { width 22px; height 1px; background currentColor; opacity .72; transform rotate(-45deg) }`. On (`.on`): `background rgba(212,175,90,0.18); border-color gold; color gold`. Hover: gold border/text + `box-shadow 0 0 22px rgba(212,175,90,0.22)`; tooltip `.tip` 11px spacing 0.2em below. Position `top 26px right 32px` (landing: `top 18px right 104px`). Sound starts muted; `aria-pressed` mirrors state.
- `.hint` (bottom 34px, centred): 13px w300 line-height 1.8 spacing 0.26em `rgba(233,226,212,0.66)`, `text-shadow: 0 1px 12px rgba(0,0,0,.92), 0 0 18px rgba(212,175,90,.15)`, fade 1.1s, auto-hide 6 s.
- Intro card `.hall-intro .hi-card`: max-width 620px, padding `64px 64px 56px`, centred, `background: linear-gradient(165deg, rgba(10,10,15,0.55), rgba(7,7,11,0.75)); backdrop-filter: blur(14px); border-top: 1px solid var(--gold-dim); border-bottom: 1px solid rgba(212,175,90,0.18)`. `.hi-no` EN 46px w300 gold; `.hi-name` 31px w300 spacing 0.3em; `.hi-latin` EN 12px spacing 0.55em gold-dim; `.hi-rule` 56×1px gold-dim margin 28px auto; `.hi-text` 15px w300 line-height 2.3 α0.82 justify/last-center; go text 13px spacing 0.34em α0.62 pulsing (`softPulse` 2.6s: opacity 0.35↔0.85). Loading dots 5px gold, `giPulse` 1.3s staggered 0.16s.
- Dream UI: `.dream-poem` bottom 16dvh, `clamp(16px,2vw,21px)` w300 spacing 0.42em `rgba(238,231,217,0.9)`, `poemDrift` 12s delay 2s (0%: opacity 0, spacing 0.58em, blur 4px → 16%: 0.92/blur 0 → 72%: 0.92/0.42em → 100%: 0/0.4em/blur 2px). Buttons column bottom 30 right 36 gap 12: padding `13px 26px 11px`, 12.5px spacing 0.32em, ink-dim on `rgba(8,8,12,0.3)` with `1px rgba(233,226,212,0.25)` + blur 8px; `.dream-star` gold text on `rgba(212,175,90,0.08)` border α0.55.
- Immersion UI: title top 9dvh `clamp(34px,5.2vw,58px)` w200 spacing 0.42em α0.92 `text-shadow 0 0 60px rgba(255,255,255,0.25)`; sub EN italic `clamp(13px,1.5vw,17px)` spacing 0.3em `rgba(212,175,90,0.75)`; line bottom 12dvh fades in 2.2s after 2.4s.

## Camera & transition timings

Camera-controls SmoothDamp constants (`cameraRig.js`): eye 1.7 m, walk 3.0 m/s, run 5.6, arrow-turn 0.65 rad/s, drag rotate −0.26, pitch range ±0.8, `SMOOTH_MOVE 0.3`, `SMOOTH_DRAG 0.13`, `SMOOTH_CINEMA 0.8`, first-person radius 1e-4. Global easings (utils.js): `easeInOutCubic`, `easeOutCubic = 1−(1−t)^3`, `easeInOutSine = −(cos(πt)−1)/2`; CSS `--ease: cubic-bezier(0.22, 0.61, 0.36, 1)`.

| Transition | Timing |
| --- | --- |
| Boot reveal | veil off 2000 ms; landing camera `(0,2.6,10.2)` yaw 0, sway `azimuth = base + sin(t*0.05)*0.12` |
| Landing → lobby | CSS landing fade 1.6s; camera `glideToPose(entry (−2.45,2.1,6.12), yaw −0.12, pitch 0.105)` smoothTime 0.3 |
| Click wing door / exit | `glideToPose(pose, yaw, 0, 4800, smoothTime 0.95)`; chime |
| Lobby "home" | veil on 650 ms → teleport → veil off 900 ms |
| Ring portal → artist gallery | portal art becomes `Immersion` particles (camZ 26, speed 4.5, bloom 0.78), intro card shows; ≥900 ms fly; then particles fade (`fadeRate 1.6`, 520 ms), cloud moved 9 m in front of the corridor entry and faded over 1.5 s `easeOutCubic` while the corridor shows through; click to enter. Fallback (no texture): veil 750 ms → build → veil off 1000 ms. "Loading" text appears only after 700 ms. |
| Corridor → ring | veil 750 ms on, 1000 ms off |
| **Focus a painting** | camera `focusTo(target, yaw, pitch)` with `smoothTime 0.8` (critically damped spring, ~2–3 s to settle) and a 1 m look radius; when it resolves → `ui.panel(entry)` (1.05 s slide, items rise 1 s staggered 0.09 s from 0.25 s); vignette deep (1.2 s). Framing: `dist = clamp(max((h/2)/tan(vfov/2), (w/2)/(hTan*visibleFrac))*1.3 + 0.55, 1.7, 5.4)` (touch pad 1.45, +0.6, max 8); camera shifted right by `dist*hTan*(1−visibleFrac)` so the art centres in the area left of the 440px panel (`visibleFrac = (innerWidth−min(440, 0.94·innerWidth))/innerWidth`, only when width ≥ 900); `target.y = center.y − 0.12`; `pitch = atan2(center.y − target.y, dist) * 0.9`. |
| Close focus | panel out, `rig.release()` smoothTime 0.55 |
| **Step into painting** | `ui.veil(true, { white: true, dur: 800 })` (#f6f1e6) → mount dream scene → `veil(false, 1800 ms)`; strokes body waits `RISE_DELAY 1.1 s` then rises over `RISE_DUR 1.5 s` (`easeInOutSine`), but default mode is flat (uMix = rise × modeMix, modeMix starts 0); flat↔solid mode eases with rate 2.6/s (`modeMix += (target−modeMix)*min(1, dt*2.6)`). Return from stardust uses riseDelay 0.15 s. Exit dream: veil 750 ms on / 1000 ms off. |
| **Become stardust** | no veil: dream dims over `HANDOFF_ALIGN 0.45 s` (`easeInOutSine`, `rig.faceFront` rotates orbit to front) → immersion takes over with matched scale and the dream's depth relief baked into particle z; audio `swell()` |
| Stardust → back | particles fade `fadeRate 3`, veil 700 ms, dream re-mounts quick (veil off 1500 ms). Exit to gallery: fade (≤1500 ms) + veil 700/1000 ms. |
| Floor click ripple | `RingGeometry(0.96, 1.0, 48)` accent, 0.95 s `easeOutCubic`, scale 0.25→1.70, opacity 0.85→0 |

## Walk-into-painting ("dream") scene — exact values (dream.js + strokes.js)

Scene setup per painting:
- Size: `WALL_H = 6.2`; `W = clamp(6.2*aspect, 4.6, 13.2)`, `H = 6.2`, `cy = H/2 + WALL_LIFT(−0.4) = 2.7`.
- Palette from a 24×24 downsample: `avg` = mean color; `accent` = pixel maximizing `lum*(0.25+sat)`, then HSL `s = min(1, s*1.15+0.08)`, `l = clamp(l, 0.45, 0.62)`.
- Derived: `deep = avg×0.10` (background), `mid = avg×0.32`, `top = avg.lerp(accent,0.35)×0.5`, `fogCol = avg×0.22`.
- Dome: `SphereGeometry(42, 32, 20)` BackSide gradient — `mix(uBottom, uMid, smoothstep(−0.25, 0.12, y))`, then `mix(…, uTop, smoothstep(0.12, 0.75, y))`, `*= 1 − uDim*0.85`.
- Fog (custom GLSL, not THREE.Fog): `f = 1 − exp(−fogD² · dist²); col = mix(col, fogCol, f*0.9)`, `FOG_BASE = 0.030`, modulated `fogD = 0.030 * (1 + (tide−0.5)*0.36)`.
- Mist curtains (desktop 2, touch 1): `PlaneGeometry(W*1.25, 4.2)` at y 2.5, z 2.1 (phase 0) and z 3.4 (phase 2.6); color `fogCol×1.6`; alpha `(0.05 + 0.03*n)*edges*(1−uDim)` where `n = sin(x*7 + t*0.05 + phase) * sin(y*5 − t*0.04 + phase*1.7)`, edge smoothsteps 0–0.22 / 0.78–1 (x), 0–0.3 / 0.7–1 (y).
- Water floor: `CircleGeometry(17, 48)`, `mix(deep×0.7, fogCol, smoothstep(0.3, 0.95, r))` + accent streak `max(sin(x*14+t*0.12)*sin(y*11−t*0.09), 0)*0.03*(1−r)`, fog, `*= 1 − dim*0.8`.
- Light pool: `PlaneGeometry(W*0.85, 3.6)` soft circle, accent, additive, opacity `(0.12 + tide*0.07)*(1−dim)` at (0, 0.02, 1.7).
- Two beams: `makeBeam({ rTop 0.5, rBottom 2.6, height 9, color accent, opacity 0.09 })` at `x = ±W*0.28, y 5.2, z 2.0`, `rotation.z = ±0.14`, opacity `(0.07 + tide*0.05)*(1−dim)`.
- Dust: count 300 (touch 120), box `[max(20, W*1.8), 9, 13]`, centre `[0, 3.4, 4.5]`, color `accent×1.25`, opacity 0.42, size 0.055.
- Orbit camera: target `(0, cy, 0.5)`; `minDist = clamp(max(1.7, W*0.24) + 0.4, 1.4, 8.4)`, `maxDist = minDist + 7.0`, start distance `clamp(7.8, min+0.4, max−0.6)`, start pos `(0, cy*0.92, 0.5 + start)`; polar limits `[π/2 − 0.55, π/2 + 0.12]`; azimuth unlimited (can see the back); rotate speed 0.9; wheel = dolly.
- Poem: `work.poem` or default list indexed by char-code sum of the work id.

Strokes body (one instanced draw call):
- Count target 42,000 (touch 15,000): `gx = max(24, round(sqrt(N*aspect)))`, `gy = max(24, round(gx/aspect))`.
- Each instance: `PlaneGeometry(1,1)` billboard of size `step × SIZE_MUL 2.35 × (1 ± 0.20)`, anisotropy up to 0.16, rotation ±0.45 rad; UV patch so overlapping chips sample the same texel (front view reassembles the painting seamlessly).
- Depth: auto luminance depth (128² → two box blurs r=5 → 5–95% stretch), sign −1 (dark = near), amplitude `FALLBACK_AMP 0.5 × THICK 1.6 m`, anchor 0.35, jitter ±0.05 m, edge lock 5%, tide amplitude 0.10; bob 0.012 m at 0.4 Hz.
- Fragment: superellipse mask `m = 1 − r⁴`, discard if `m < 0.35`; depth hint ±6% (`1 + vShade*0.12`), shimmer `1 + sin(t*0.5 + seed)*0.03`, edge darkening 0.12; clamped to ≤1 (never blooms); opaque + depthWrite.
- Uniforms: `uMap, uDepth, uDepthSign(−1), uDepthAmp(0.5), uMix(0→1), uAnchor(0.35), uTide, uTideAmp(0.10), uTime, uFog, uFogD, uQuad, uPaint(W,H)`.

## Stardust ("immersion") — exact values (immersion.js)

- Particles: target 52,000 (touch 22,000): `cols = max(60, round(sqrt(N*aspect)))`, `rows = max(60, round(cols/aspect))`, one per sampled pixel. Plane `planeW = aspect ≥ 1 ? 30 : 26*aspect`. Point size `aSize = (0.65 + lum*0.9)*(planeW/cols)*2.1`, `gl_PointSize = clamp(aSize*(1 + uProgress*0.55)*uScale / max(0.6, −mv.z), 1, 26)`, `uScale = innerHeight / (2*tan(29°))`.
- Dissolve: `disp = position; disp.z += seed.x*26 − 19; disp.xy *= 1 + seed.yz*0.85`; `k = uProgress*(0.55 + 0.45*seed.w)`; float wobble amplitude `0.85*uProgress` (freqs 0.32+0.5s, 0.27+0.4s, 0.22+0.4s); color `× (1 + uProgress*0.45)`; round soft dot `smoothstep(0.25, 0.05, r²)`; depth fade `1 − smoothstep(2, 26, depth)*0.35`. `transparent, depthWrite false, depthTest false`, normal blending.
- Progress: `smooth(7, 26, (startZ − camZ) + progOffset)` (smoothstep), progOffset 5 when handed off from dream.
- Camera script: startZ 34 (or matched `clamp(matchDist*planeW/paintingW, 10, 30)`); speed targets 5.4 (camZ > 12) → 2.4 (> −4) → 1.1 (> −11) → 0, `speed = lerp(speed, target, dt*0.9)`; sway `x = sin(t*0.12)*1.6*drift`, `y = cos(t*0.095)*1.1*drift`, slow z breathing after stopping `sin(holdT*0.16)*2.2*min(1, holdT*0.05)`; cloud `rotation.y = sin(t*0.03)*0.12*drift`; drag look via yaw/pitch with damp `1 − exp(−dt*5)`.
- Scene: `bg = imageAverageColor × 0.16`, **`FogExp2(bg, 0.012)`**; 900 dust motes in `[70,50,90]` box, color `avg×1.6`, opacity 0.5, size 0.07; ghost title text plane 36×12 at z −42 (`200` CN at α0.16, italic EN α0.10), bobbing `y = 2 + sin(t*0.2)*0.8`.
- Fade: `opacity = lerp(opacity, fadeTarget, dt*fadeRate)`, fadeRate default 2.4.

Shared dust shader (`makeDust`): per-point drift `x += sin(t*0.11 + s*17)*0.9`, `y += sin(t*0.07 + s*23)*0.6`, `z += cos(t*0.09 + s*29)*0.9`; size `clamp(aSize*760/max(0.8, −mv.z), 1, 9)`; twinkle `0.35 + 0.65*(0.5+0.5*sin(t*0.5 + s*41))`; additive, soft radial sprite (0→1, 0.35→0.55, 1→0). Default color `0xfff2d8`.

## Ambient audio synth (audio.js)

Created lazily on the first unmute gesture (default muted). Graph:

```
[drone: 2× sine 55 Hz + 110 Hz] → lowpass 160 Hz → gain 0.02 ─┐
[pad: 5× triangle 146.83, 220, 293.66, 329.63, 440 Hz, detune ±4 cents]
      → lowpass (cutoff per mode, Q 0.5) → padGain (per mode) ─┤
[tide: 2 s looped white noise] → highpass 110 → lowpass 480 (Q 0.4, swept 380+320·tide)
      → tideGain ─────────────────────────────────────────────┤
[chimes: per hit 2 sines base & base·2.004 (amp 1, 0.35)] → chimeBus ─┬─────┤
                         chimeBus → delay d1 0.309 s ⇄ d2 0.473 s     │     │
                         (fb1 0.34 d1→d2, fb2 0.30 d2→d1)             │     │
                         d1,d2 → lowpass 1600 → wet gain 0.5 ─────────┘     │
bus = master lowpass 3200 Hz → DynamicsCompressor(threshold −28, ratio 2.5, attack 0.25, release 0.4)
    → master gain (0 ↔ 0.42, setTargetAtTime τ 3.2 s on first start, 0.6 s on toggle) → destination
```

- Tide clock: period 6.5 s, asymmetric (rise 42% / fall 58%), `tide = 0.5 − 0.5*cos(q*2π)`; exposed as `tide01()` and drives dream fog/beams/pool/relief. Every ~80 ms: `padGain → padBase*(0.82 + 0.34*tide)` (τ 0.12), `tideGain → 0.020*mode.tide*(0.30 + 0.95*(1−tide))` (τ 0.18).
- Modes: `lobby { pad 0.022, cutoff 680, tide 0.9, chime [12,24] s }`, `hall { 0.019, 560, 0.7, [14,26] }`, `dream { 0.028, 620, 1.5, [10,20] }`, `immersion { 0.034, 1200, 1.1, [7,14] }`; cutoff glides with `setTargetAtTime(τ 2.2)`.
- Chime: random note from A-major pentatonic `[440, 493.88, 554.37, 659.25, 739.99, 880]`, ×0.5 except in immersion; envelope 0 → 0.0085×amp linear in 0.12 s → exponential to 0.0001 at 6.5 s. Also fired on UI actions (focus, door, enter painting).
- Swell (stardust): tideGain → 0.064 (τ 0.5) then back to 0.020 at +1.4 s (τ 1.2); sines 220 and 329.63 Hz ramp to 0.012 in 0.8/1.1 s, decay to 0.0001 by 6 s.
- Mute: master → 0 over τ 0.6, context suspended after 7 s.

## gallery.config.json schema

Top level: `title`, `subtitle`, `kicker`, `tagline`, `enterLabel`, `loadingLine`, `footnote`, `altLang { label, config, lang }`, optional `ui {…label overrides…}`, optional `hints {…}`, optional `depthPolicy: "uniform-auto" | "enhanced"`, `wings[]`.
Wing: `id`, `no` (default Roman numeral), `name`, `short`, `latin`, `en`, `intro`, `type: "collection" | "open"`, `frames` (open wing empty-frame count, default 10), `comingSoon`, theme hexes `accent, wall, panel, floor, fog, lightColor`, `frameStyle: "gold" | "dark" | "float"`, `artists[]`.
Artist: `id`, `name`, `original`, `dates`, `place`, `epithet`, `bio`, optional `atmosphere { accent, wall, panel, floor, fog, lightColor, frameStyle }`, `works[]`.
Work: `id`, `file` (same-origin relative path), `title`, `original`, `year`, `medium`, `museum`, `desc`, `line` (short poetic line), optional `wide: true`, `poem`, `depth` (depth image, bright = near; used only when depthPolicy is enhanced), `splat` (reserved, unused). Artists/works with no `file` are skipped with a console warning.

Example (verbatim from `public/gallery.config.json`, wing II trimmed to one artist/work):

```json
{
  "id": "modern", "no": "II", "name": "Modern · Light and the Instant", "short": "现代馆",
  "latin": "LA LUMIÈRE ET L’INSTANT", "en": "The Modern Wing",
  "intro": "In the nineteenth century painters stepped out of the studio and found that sunlight changes the world every second. Painting stopped copying eternity and began chasing the moment — and the burning heart behind it.",
  "accent": "#7fb4d8", "wall": "#1d2734", "panel": "#263344", "floor": "#0a0d11", "fog": "#090c10",
  "lightColor": "#cfe4ff", "frameStyle": "dark",
  "artists": [
    {
      "id": "vangogh", "name": "Vincent van Gogh", "original": "文森特 · 梵高", "dates": "1853 – 1890",
      "place": "津德尔特 / 阿尔勒 / 奥维尔", "epithet": "The Burning Sunflower",
      "bio": "He sold one painting in his lifetime, and became the whole world's beloved after it. …",
      "works": [
        {
          "id": "vangogh-starry", "file": "art/vangogh-starry.jpg", "title": "The Starry Night",
          "original": "星月夜", "year": "1889", "medium": "Oil on canvas",
          "museum": "Museum of Modern Art, New York",
          "desc": "Through the barred window of the asylum at Saint-Rémy, he watched the sky churn into whirlpools, stars swelling like fireworks. This is not what the night looks like — it is what the night feels like, burning inside a troubled mind.",
          "line": "He painted the roaring in his ears into a whirlpool of stars."
        }
      ]
    }
  ]
}
```
Open wing example: `{ "id": "future", "no": "III", "name": "Future · Your Museum", "latin": "ARS FUTURA", "type": "open", "frames": 6, "accent": "#e8a25a", "wall": "#4a4239", "panel": "#5a5044", "floor": "#14110d", "fog": "#13100c", "lightColor": "#ffeed2", "frameStyle": "gold", "artists": [] }`.
Static checks (`check-config.mjs`): unique wing/artist/work ids, files must be same-origin relative under `public/`, JPEG/PNG/WebP magic bytes must match extension, `enhanced` requires every work to have `depth`, alt-language configs must have identical structure.

## Wikimedia art fetch script (`scripts/fetch_art.py`)

- Endpoint: `https://commons.wikimedia.org/w/api.php` via `curl -sL --max-time 120 -A "Musewalk/1.0 (…; Commons provenance downloader)"`; retries with back-off delays 0, 3, 8, 20 s on empty/invalid bodies; 0.8 s sleep between works.
- `WORKS` = tuples `(id, exact Commons file title, search fallback query, thumb width 1200–1800)`.
- Candidate order: previous manifest title → exact title → `list=search` results (`srnamespace=6`, `srlimit=12`, only `.jpg/.jpeg`). Every candidate gets a full metadata query (search rank cannot bypass the license gate).
- Metadata query: `action=query&prop=imageinfo&redirects=1&iiprop=url|size|mime|extmetadata&iiurlwidth=<width>&iiextmetadatafilter=LicenseShortName|LicenseUrl|Artist|Credit&iiextmetadatalanguage=en&titles=File:…`.
- Reject when: missing page, MIME ≠ `image/jpeg`, license not in allow list, no `descriptionurl`, CC BY without Artist/Credit, CC BY without LicenseUrl, no download URL.
- License allow list (normalized lowercase, NBSP collapsed): `public domain`, `cc0`, `cc0 1.0`, `cc0 1.0 universal`, `cc by 1.0`, `cc by 2.0`, `cc by 2.5`, `cc by 3.0`, `cc by 4.0`. Everything else (BY-SA, BY-NC, unknown) rejected.
- Download `thumburl || url`; must be ≥ 12,000 bytes and start with `FF D8 FF`; atomic write via temp file + `os.replace`. Existing local file reused when its SHA-256 matches the manifest.
- Manifest `public/art/sources.manifest.json`: `{ schemaVersion: 1, generatedBy, licensePolicy { accepted: ["Public domain","CC0","CC BY <version>"], rejected: ["CC BY-SA","CC BY-NC","unknown/missing"] }, files: { "<id>.jpg": { workId, localPath, bytes, sha256, commonsFileTitle, canonicalDescriptionUrl, licenseShortName, licenseUrl, artist, credit, sourceMime, sourceWidth, sourceHeight } } }` (sorted, written atomically after each work). Flags: `--metadata-only`, `--only WORK_ID` (repeatable), `--manifest PATH`. Exit 1 if any failure.

## Headless verify script (`scripts/verify.mjs`)

- puppeteer-core with a system Chrome/Chromium (`CHROME_PATH`/`PUPPETEER_EXECUTABLE_PATH` or standard paths), headless, flags `--no-sandbox --enable-unsafe-swiftshader --use-angle=swiftshader`. Env: `VERIFY_URL` (default `http://127.0.0.1:5173`), `VERIFY_TOUCH=1` (390×844 @2x mobile), `VERIFY_LABEL`, `VERIFY_SLOW=1` (all waits ×4), `VERIFY_SIZE=WxH` (default 1366x860), `VERIFY_WING/ARTIST/WORK`.
- Fails on any console error/warning, page error, failed request, unexpected main-frame navigation, or assertion. Screenshots to `shots/verify-<label>/`.
- Flow: landing (sound defaults muted, toggle works + aria + not occluded) → click enter (first-frame jump < 0.8 m, view radius < 0.01) → WASD walk ≥ 0.5 m → corridor shots via `__musewalk.gotoWing` → `enterGalleryById` (intro card, click) → `focusWork` (panel, focus radius ≈ 1 m) → enter dream (default flat, toggle solid/flat) → stardust → back to dream (keeps solid) → exit to focus (radius restored) → re-enter dream (flat again) → stardust exit → Escape to hall → home button from focus/dream/stardust → back to lobby → future wing and rotunda shots.
- Uses the page's `window.__musewalk` hooks: `state, pos, viewRadius, audioMuted, dreamMode, labels, enterGalleryById, configSummary, backToLobby, gotoWing, gotoWingById, facePortalById, gotoLobby, focusWork, enterDreamNow`.

## Verbatim excerpts (MIT — Copyright (c) 2026 Musewalk contributors)

### 1. Frame builder + painting + spotlight (`src/hall.js`)

```js
// Copyright (c) 2026 Musewalk contributors — MIT License
function buildFrame(style, w, h) {
  const g = new THREE.Group();
  if (style === 'gold') {
    const gold = new THREE.MeshStandardMaterial({ color: 0xa8843c, metalness: 0.92, roughness: 0.34 });
    const outer = new THREE.Mesh(new THREE.BoxGeometry(w + 0.34, h + 0.34, 0.12), gold);
    const lip = new THREE.Mesh(
      new THREE.BoxGeometry(w + 0.08, h + 0.08, 0.06),
      new THREE.MeshStandardMaterial({ color: 0x1c150c, roughness: 0.6 }),
    );
    lip.position.z = 0.04;
    g.add(outer, lip);
    g.userData.canvasZ = 0.075;
  } else if (style === 'dark') {
    const wood = new THREE.MeshStandardMaterial({ color: 0x191310, metalness: 0.25, roughness: 0.5 });
    const fr = new THREE.Mesh(new THREE.BoxGeometry(w + 0.14, h + 0.14, 0.08), wood);
    g.add(fr);
    g.userData.canvasZ = 0.045;
  } else {
    const mat = new THREE.MeshStandardMaterial({ color: 0x77767a, roughness: 0.96 });
    const back = new THREE.Mesh(new THREE.BoxGeometry(w + 0.55, h + 0.55, 0.04), mat);
    const stand = new THREE.Mesh(
      new THREE.BoxGeometry(w + 0.05, h + 0.05, 0.06),
      new THREE.MeshStandardMaterial({ color: 0x101013, roughness: 0.6 }),
    );
    stand.position.z = 0.045;
    g.add(back, stand);
    g.userData.canvasZ = 0.08;
  }
  return g;
}

// inside hangWork(...):
  const maxH = 2.35;
  const maxW = work.wide ? 3.9 : 2.7;
  let h = maxH;
  let w = h * aspect;
  if (w > maxW) { w = maxW; h = w / aspect; }
  // ...
  const canvas = new THREE.Mesh(
    new THREE.PlaneGeometry(w, h),
    new THREE.MeshBasicMaterial({ map: texture }),
  );
  canvas.position.z = frame.userData.canvasZ;
  // ...
  const spotIntensity = hall.frameStyle === 'float' ? 44 : 76;
  const spot = new THREE.SpotLight(hall.lightColor, spotIntensity, 17, 0.6, 0.78, 1.7);
  spot.position.set(side * (WALL_X - 2.7), HEIGHT - 0.7, z);
  spot.target.position.set(side * WALL_X, HANG_Y, z);
  hallGroup.add(spot, spot.target);
```

### 2. Hall atmosphere (`src/hall.js`) and rotunda key light (`src/lobby.js`)

```js
// Copyright (c) 2026 Musewalk contributors — MIT License
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(hall.fog);
  scene.fog = new THREE.Fog(hall.fog, 10, 64);
  // ...
  scene.add(new THREE.HemisphereLight(
    new THREE.Color(hall.lightColor).multiplyScalar(0.5),
    new THREE.Color(hall.floor),
    1.1,
  ));
  const amb = new THREE.AmbientLight(0xffffff, 0.18);
  scene.add(amb);

// lobby.js
  const spot = new THREE.SpotLight(0xffffff, 155, 0, Math.PI / 6, 1, 2);
  spot.map = spotlightMap;               // textures/disturb.jpg (CC BY 2.5, Mitch Featherston)
  spot.position.set(3.1, H - 1.55, 3.1);
  spot.target = spotTarget;
  // update(): const a = t * 0.16;
  //   spot.position.set(Math.cos(a) * 3.2, H - 1.55, Math.sin(a) * 3.2);
  //   spotTarget.position.set(-Math.cos(a) * 0.55, 0.1, -Math.sin(a) * 0.55);
```

### 3. Caption + info panel DOM (`src/ui.js`) — CSS is quoted in full above

```js
// Copyright (c) 2026 Musewalk contributors — MIT License
    caption(data, x, y) {
      if (!data) { caption.classList.remove('show'); return; }
      caption.querySelector('.cap-t').innerHTML = formatTitle(data.title);   // escaped, then <i>…</i>
      caption.querySelector('.cap-s').textContent = data.original;
      const flip = x > window.innerWidth - 340;
      caption.style.left = `${x}px`;
      caption.style.top = `${y}px`;
      caption.style.transform = flip ? 'translate(calc(-100% - 18px), -50%)' : 'translate(18px, -50%)';
      caption.classList.add('show');
    },

    panel(entry) {
      // ...
      const scroll = el('div', 'p-scroll');
      panelEl.appendChild(scroll);
      let i = 0;
      const add = (node) => {
        node.classList.add('reveal');
        node.style.setProperty('--i', i++);
        scroll.appendChild(node);
        return node;
      };
      add(el('div', 'p-hall', `${hall.no} · ${hall.name}`));
      add(el('h1', 'p-title', `${work.title}`));
      if (work.original) add(el('div', 'p-orig', work.original));
      const meta = [work.year, work.medium].filter(Boolean).join(' · ');
      const metaEl = el('div', 'p-meta', meta);
      if (work.museum) metaEl.append(document.createElement('br'), document.createTextNode(work.museum));
      add(metaEl);
      add(el('div', 'p-rule'));
      add(el('p', 'p-desc', work.desc));
      add(el('div', 'p-artist-label', labels.panelArtistLabel));
      add(el('div', 'p-artist-name', artist.name));
      const sub = [artist.original, artist.dates].filter(Boolean).join(' · ');
      if (sub) add(el('div', 'p-artist-dates', sub));
      if (artist.epithet) add(el('div', 'p-epithet', `「 ${artist.epithet} 」`));
      add(el('p', 'p-bio', artist.bio));
      const actions = el('div', 'p-actions');
      const enter = el('button', 'p-enter', labels.panelEnterLabel);
      // ...
      panelEl.appendChild(el('div', 'p-poem', work.line));
      void panelEl.offsetWidth;   // reflow to replay the reveal animation
      panelEl.classList.add('show');
    },
```
(`el()` uses `textContent`; the only `innerHTML` is the HTML-escaped title.)

### 4. Focus camera tween (`src/main.js` + `src/cameraRig.js`)

```js
// Copyright (c) 2026 Musewalk contributors — MIT License
  const vfov = (camera.fov * Math.PI) / 180;
  const hTan = Math.tan(vfov / 2) * camera.aspect;
  const panelPx = IS_TOUCH ? 0 : Math.min(440, innerWidth * 0.94);
  const visibleFrac = IS_TOUCH || innerWidth < 900 ? 1 : (innerWidth - panelPx) / innerWidth;
  const pad = IS_TOUCH ? 1.45 : 1.3;
  const extra = IS_TOUCH ? 0.6 : 0.55;
  const maxD = IS_TOUCH ? 8 : 5.4;
  const dist = clamp(
    Math.max(
      (entry.h / 2) / Math.tan(vfov / 2),
      (entry.w / 2) / (hTan * visibleFrac),
    ) * pad + extra,
    1.7, maxD,
  );
  const target = entry.center.clone().addScaledVector(entry.normal, dist);
  if (visibleFrac < 1) {
    const right = new THREE.Vector3().crossVectors(entry.normal.clone().negate(), camera.up).normalize();
    target.addScaledVector(right, dist * hTan * (1 - visibleFrac));
  }
  target.y = entry.center.y - (IS_TOUCH ? 0 : 0.12);
  const yaw = Math.atan2(entry.normal.x, entry.normal.z);
  const pitch = IS_TOUCH ? 0 : Math.atan2(entry.center.y - target.y, dist) * 0.9;
  audio.chime();
  rig.focusTo(target, yaw, pitch, 2.0).then(() => {
    if (state === 'focus') ui.panel(entry);
  });

// cameraRig.js
  focusTo(targetPos, yaw, pitch) {
    if (this.mode !== 'locked') this._saved = this.getPose();
    this.mode = 'locked';
    this.controls.enabled = false;
    this.controls.smoothTime = SMOOTH_CINEMA;   // 0.8
    const f = this._forwardOf(yaw, pitch);       // (-sin(yaw)cos(p), sin(p), -cos(yaw)cos(p))
    return this.controls
      .setLookAt(targetPos.x - f.x, targetPos.y - f.y, targetPos.z - f.z,
        targetPos.x, targetPos.y, targetPos.z, true)
      .then(() => { this.controls.smoothTime = SMOOTH_MOVE; });
  }
```
(The `2.0` argument is ignored by `focusTo`. Without camera-controls, emulate with a critically damped SmoothDamp, smoothTime 0.8.)

### 5. Walk-into-painting stroke body (vertex shader, `src/dreamBodies/strokes.js`) and stardust dissolve (`src/immersion.js`)

```glsl
// Copyright (c) 2026 Musewalk contributors — MIT License
// strokes.js vertex (constants inlined: EDGE 0.05, THICK 1.6, JITTER*2 0.1, BOB 0.4/0.012, SIZE_VAR*2 0.4, ANISO 0.16, ROT 0.9)
float d = 0.5 + (texture2D(uDepth, aUv).r - 0.5) * uDepthSign;
float ef = smoothstep(0.0, 0.05, aUv.x) * (1.0 - smoothstep(0.95, 1.0, aUv.x))
         * smoothstep(0.0, 0.05, aUv.y) * (1.0 - smoothstep(0.95, 1.0, aUv.y));
float amp = 1.0 + (uTide - 0.5) * uTideAmp;
float z = ((d - uAnchor) * 1.6 * uDepthAmp * amp + (aSeed.x - 0.5) * 0.1) * ef * uMix;
vec3 anchor = vec3((aUv - 0.5) * uPaint, z);
anchor.y += sin(uTime * 0.4 + aSeed.y * 6.2832) * 0.012 * uMix;
float sizeVar = 1.0 + (aSeed.z - 0.5) * 0.4;
float aniso = fract(aSeed.x * 13.7) * 0.16;
float ang = (aSeed.w - 0.5) * 0.9;
float ca = cos(ang), sa = sin(ang);
vec2 lo = position.xy * vec2(1.0 + aniso, 1.0 - aniso);
vec2 off = vec2(lo.x * ca - lo.y * sa, lo.x * sa + lo.y * ca) * uQuad * sizeVar;
vUv = aUv + off / uPaint;            // patch UV: overlapping chips sample the same texel
vLocal = position.xy * 2.0;
vShade = d - 0.5;
vSeedW = aSeed.w;
vec4 mv = modelViewMatrix * vec4(anchor, 1.0);
mv.xy += off;                        // view-space billboard
vDist = -mv.z;
gl_Position = projectionMatrix * mv;

// immersion.js vertex (stardust)
vec3 flat0 = position;
vec3 disp = position;
disp.z += aSeed.x * 26.0 - 19.0;
disp.x *= 1.0 + aSeed.y * 0.85;
disp.y *= 1.0 + aSeed.z * 0.85;
float k = uProgress * (0.55 + 0.45 * aSeed.w);
vec3 pos = mix(flat0, disp, k);
float t = uTime;
float amp = 0.85 * uProgress;
pos.x += sin(t * (0.32 + aSeed.x * 0.5) + aSeed.w * 6.283) * amp;
pos.y += cos(t * (0.27 + aSeed.y * 0.4) + aSeed.w * 12.56) * amp * 0.8;
pos.z += sin(t * (0.22 + aSeed.z * 0.4) + aSeed.w * 9.42) * amp * 1.2;
vec4 mv = modelViewMatrix * vec4(pos, 1.0);
float ps = aSize * (1.0 + uProgress * 0.55) * uScale / max(0.6, -mv.z);
gl_PointSize = clamp(ps, 1.0, 26.0);
vFade = 1.0 - smoothstep(2.0, 26.0, -mv.z) * 0.35;
gl_Position = projectionMatrix * mv;
// fragment: r2 = dot(pc-0.5); discard r2>0.25; a = smoothstep(0.25,0.05,r2);
//           gl_FragColor = vec4(vColor*(1.0+uProgress*0.45), a*uOpacity*vFade);
```

### 6. Ambient audio core (`src/audio.js`, abridged)

```js
// Copyright (c) 2026 Musewalk contributors — MIT License
    const masterLP = ctx.createBiquadFilter();
    masterLP.type = 'lowpass';
    masterLP.frequency.value = MASTER_LP;           // 3200
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -28;
    comp.ratio.value = 2.5;
    comp.attack.value = 0.25;
    comp.release.value = 0.4;
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    masterLP.connect(comp);
    comp.connect(this.master);
    this.master.connect(ctx.destination);
    // drone: sine 55 + 110 → lowpass 160 → gain 0.02 → masterLP
    // pad: triangle 146.83/220/293.66/329.63/440 (±4 cents) → lowpass(mode.cutoff, Q 0.5) → padGain(mode.pad)
    // tide: looped 2 s white noise → highpass 110 → lowpass 480 (Q 0.4) → tideGain(0)
    const d1 = ctx.createDelay(2);
    d1.delayTime.value = 0.309;
    const d2 = ctx.createDelay(2);
    d2.delayTime.value = 0.473;
    const fb1 = ctx.createGain();
    fb1.gain.value = 0.34;
    const fb2 = ctx.createGain();
    fb2.gain.value = 0.30;
    d1.connect(fb1); fb1.connect(d2);
    d2.connect(fb2); fb2.connect(d1);
    const wetLP = ctx.createBiquadFilter();
    wetLP.type = 'lowpass';
    wetLP.frequency.value = 1600;
    const wet = ctx.createGain();
    wet.gain.value = 0.5;
    d1.connect(wetLP); d2.connect(wetLP);
    wetLP.connect(wet);
    wet.connect(this.bus);
    this.chimeBus = ctx.createGain();
    this.chimeBus.gain.value = 1;
    this.chimeBus.connect(d1);
    this.chimeBus.connect(this.bus);
    this.master.gain.setTargetAtTime(this.muted ? 0 : MASTER_LEVEL, ctx.currentTime, 3.2);   // 0.42

  chime() {
    // base = random A-major pentatonic note × (immersion ? 1 : 0.5)
    [[base, 1], [base * 2.004, 0.35]].forEach(([f, amp]) => {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(CHIME_LEVEL * amp, t0 + 0.12);      // 0.0085
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + CHIME_DECAY);   // 6.5 s
      o.connect(g);
      g.connect(this.chimeBus);
      o.start(t0);
      o.stop(t0 + CHIME_DECAY + 0.5);
    });
  }
```

## Porting notes for Bentonville Royale

- Our renderer/post settings differ; adopt per-POI scene values only (fog, lights, materials), not a global NeutralToneMapping switch, unless the game's look is re-tuned.
- Musewalk uses one `Reflector` per room (render-to-texture). In an open-world game this is expensive; prefer a dark glossy `MeshStandardMaterial` (roughness ~0.15, metalness ~0.6) or a single low-res reflector only when the player is inside.
- 76-intensity SpotLights with decay 1.7 are tuned for physically based lights (three ≥ r155). Each painting costs one spotlight; budget accordingly (or bake into a light map / use a single fake light cone mesh via `makeBeam`).
- Fonts: our identity is Lilita One/Nunito; Cormorant Garamond/Noto Serif SC would be a POI-only exception and would need bundling (OFL 1.1).
- The disturb.jpg cookie is CC BY 2.5 — attribution needed if used.
- No Musewalk artwork is in this repo; only screenshots under `docs/musewalk-reference/`.

## Screenshot run log

Run 2026-11-17, Playwright Chromium headless, `--use-angle=metal --ignore-gpu-blocklist`, WebGL2 renderer
"ANGLE (Apple, ANGLE Metal Renderer: Apple M4)", viewport 1440x900, against `vite` dev server on 127.0.0.1:5191
(server stopped afterwards). Scripts: scratchpad `mw-shots.mjs` (tour) and `mw-hover.mjs` (caption); both drive the page via
`window.__musewalk` hooks plus real clicks on `.sound-btn`, `.l-enter`, `.hall-intro`, `.p-enter`, `.dream-mode`, `.dream-star`, `.imm-exit`.

- Succeeded (32 PNGs, ~23 MB): every file listed in the table above.
- Hover caption: the first pass found no caption in the Vermeer corridor (cursor sweep missed the paintings), so there is no
  `08-classical-d-*`; the second pass captured `09-modern-d-hover-caption.jpg`.
- Not captured: audio itself (screenshots only show the Sound toggle off/on state; `11-stardust-d-drift-sound-on.jpg` shows the ON pill).
- No page errors were logged during the runs.
