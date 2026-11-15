# Wave 1 / D: weapon audio and models

Status: **done.** Verified in the running game on port 5195, with the art pass's toToon materials applied.

## Models (`public/assets/weapons/`)
- New guns are from Quaternius's "Ultimate Guns Pack" (CC0): rifle, smg, shotgun (pump), sniper and pistol. The pickaxe is CircuitZ's "Pickaxe 1" (CC0) and replaces the axe stand-in. Credits and source URLs are in `credits/weapons-loot.md`.
- File names are the same as before, and the GLBs are baked into the conventions Character.js and Loot.js already expect, so **no game code changed**:
  - barrel points to -Z, up is +Y, and the grip sits at (0, -0.014, 0.152), so the existing holder offset and x1.45 scale put it in the hand
  - each gun is scaled to a set length in the hand: rifle 1.15 m, SMG 0.85 m, shotgun 1.2 m, sniper 1.6 m, pistol 0.45 m
  - guns are 1.5x thicker than real so they read at third-person distance
  - the near-black base colours were lifted so they read under the toon shader
- The pickaxe handle runs along +Y with its origin at the grip.
- `manifest.json` lists bounds, grip and muzzle for each file.
- All 6 GLBs pass gltf-validator with 0 errors and 0 warnings. Together they are 380 KB and 396 to 1930 triangles each, with no textures.
- Shots: `wave1-d-shots/side-grid.png` (held, under toon), `floor-close.png` and `07-floor-weapons.png` (floor loot).
- Known gap: Character's hard-coded muzzle point (holder-local z 0.85) now sits about 0.35 m short on the sniper and about 0.4 m long on the pistol and SMG. `manifest.json` has the holder-space muzzle for each gun (`holderMuzzle`) if someone wants to use it.

## Audio
- `public/assets/sfx/` holds 45 MP3s (mono, 96 kb/s, about 420 KB in total). They are CC0 Freesound recordings, trimmed and level-matched. The full table is in `credits/audio.md`. No audio was taken from any commercial game.
- `src/audio/Sfx.js` has an optional per-sound `sample` field: a list of round-robin variants, or a set keyed by a play() option via `sampleBy` (`surface` for `bullet_impact`, `weapon` for `reload`).
  - Samples are fetched and decoded on `unlock()`. `preloadSamples()` can also be called early.
  - Samples play through the same gain, distance lowpass, pan, throttle and voice-steal chain as the synth sounds.
  - The synth recipe is the fallback whenever a sample is missing or fails to decode.
  - Sample gain (`sgain`) was calibrated against the synth with an OfflineAudioContext.
  - New sound: `shotgun_pump`.
  - New inspection hooks: `sampleInfo()` and `stats`.
- Sounds that now use samples: the 5 gunshots, reload (pump sound for the shotgun), empty_click, weapon_switch, bullet_impact (wood/stone/brick/metal/body), swing, and hit_wood/stone/metal.
- `src/audio/README.md` documents all of this.

## Verification
- Headless Chrome via `tools/qa/smoke.mjs`:
  - all 45 samples decoded with 0 failures
  - every gun fired through its sample (`shot_*:buf`)
  - all impact, reload, pump, click, switch and harvest variants played from samples
  - 0 page errors, 0 console errors, 0 failed requests, and `game.errors` was empty
- The audio itself was not listened to.

## Follow-ups (optional)
- Combat.js still calls `bullet_impact` without `surface`, so impacts use the stone set. Passing `res.surface` (and `surface: 'body'` on actor hits) would turn on the wood/metal/body sets.
- Player.js could pass `{ weapon: id }` to `reload` to get the pump sound on the shotgun.
- Nothing calls `shotgun_pump` after a shotgun shot yet.
