# Hackathon notes: Bentonville High School POI

## What was built
Bentonville High School is a bespoke landmark in `src/world/bhs/`. It was built in two passes.

**First pass:** a realistic re-skin on the generic buildings, plus Tiger Stadium. The user rejected the look as "not realistic".

**Second pass:** the accuracy rebuild (`BHS_ACCURACY_FIX_PROMPT.md`). Both school buildings are now bespoke kit buildings, matched against the user's reference photos:
- **Style bible:** `docs/bhs/STYLE_BIBLE.md`, with a palette sampled from the photos by `tools/bhs/palette.mjs`.
- **Kit:** `src/world/bhs/kit/`, containing:
  - palette and procedural materials, including the Crystal Bridges glass with a bluer tint
  - a pure builder
  - a plan engine that turns rooms, voids, stair halls, raised volumes and facades into geometry
  - bot nav, merged meshes, interior streaming and a light pool
- **North Building** (`north.js`):
  - U-shaped, 3 storeys, around the outdoor commons (the courtyard).
  - **West main entrance** in a niche: brick frontage, storefront, glass doors under a canopy, the sign band with an original tiger emblem, a 2-storey curtain wall, and the light-block stair tower with a white metal crown.
  - Inside: the lobby, the cafeteria (commons atrium, glass-railed walkway, feature stair) on the left, the crosswalk vestibule on the right, and the loop hallway straight ahead.
  - Four big corner stairwells. Classrooms branch off the hallway with glass onto it, and the court-side rooms have big windows onto the courtyard.
- **Main / South building** (`south.js`):
  - 2 storeys with raised volumes: Tiger Arena, the auxiliary gym, the cafeteria clerestory, the Arend Arts Center house and fly tower, and the library.
  - The entry court with its water channel and arch beam, and the Arend's stepped brick drums.
  - A partial covered walkway attached to this building only, and the zebra crosswalk.
  - The cafeteria with tables around the reboot van.
- **Hallways and fill rooms** (`fill.js`): locker banks, offices, restrooms, storage, and lots of loot.
- **Gameplay:**
  - Everything breaks: walls, glass, floors, the roof (as tiles), stairs and furniture.
  - Loot on a destroyed piece drops to the surface below (`Loot.dropFrom`).
  - Players can **vault** thin obstacles such as fences and rails (`Player._findVault`).
  - The "Now entering Bentonville High School" banner.
  - The HUD label covers the whole campus.
- **Tiger Stadium:** the visitor stand was removed so the North Building entrance plaza stays open.

## Who did what (subagents)
| Area | Owner | Result |
|---|---|---|
| Kit, both building shells, facades, hallways, fill, nav, cafeteria, entrance slice, crosswalk | lead | `kit/`, `north.js`, `south.js`, `fill.js` |
| Classrooms (subject types, 8 layouts, lived-in props, accents, moods, loot) | subagent A | `interior/classrooms/`: 101 rooms |
| Library (2-storey atrium, mezzanine) | subagent B | `interior/library/` |
| Tiger Arena + auxiliary gym | subagent C | `interior/gym/` |
| Arend Arts Center lobby + theatre (1,798 seats, raised stage, red curtain) | subagent D | `interior/arend/` |
| Stadium (first pass) | stadium agent | `stadium.js`, `stadiumMeshes.js` |
| QA (fresh agents) | QA | see the report |

## Approximate spaces (no matching reference photo)
These were built from the style bible and typical US high school detailing:
- classrooms, hallways and lockers, the stairwells (other than the commons stair), offices, restrooms and storage
- Tiger Arena and the auxiliary gym
- the Arend lobby
- the main building's cafeteria
- all room layouts beyond the photographed spaces

## Cuts and deviations
- **Folder:** `src/world/bhs/` instead of `src/poi/bhs/`, following the repo's convention.
- **No global post-processing** (N8AO etc.), to keep the change isolated. Realism comes from baked contact shading, emissive fixtures and a small light pool.
- **The stadium** is moved into the tile (the real one is about 280 m west), its stands are shallower, and the visitor stand is gone.
- **Signs:** the entrance sign band reads "BENTONVILLE HIGH SCHOOL / MAIN ENTRANCE". Other signs and banners are blank.
- **The emblem** is an original drawing, not the school's logo.
- **The Arend house has 1,798 seats**, more than the real 1,190.

## Known bugs and limits
- Furniture colliders on an upper floor do not fall when the tile under them breaks; loose decor hides with its tile. Gym trusses and hung backstops stay in the air if their roof tile breaks.
- Wall decor in rooms against slanted exterior walls can sit off the wall; boards are kept off those walls.
- The generic interior recipes (`src/world/interiors/bhs.js`) are still used by the generic-building checks only. The game builds the bespoke buildings.
- `Game.js` also has a separate BHS entry toast (added outside this work) next to the "Now entering" banner. QA saw only the banner fire, but both are wired: keep one.

## QA (fresh agent, 2026-11-19) and the fixes after it
Recognisability scores (1–5, photo vs render) before the last fixes:
- North entrance 3; North Building from the crosswalk 3; campus oblique 3 / aerial 2
- commons 2; south entry court 3; walkway 2
- library 4; Arend theatre 3; gym 4; classrooms 3

User asks:
- **Passed:** entrance with the emblem, the banner, the Arend auditorium, lots of chests (164 chests, 0 floating), the fence vault, the loop-hallway layout, a breakable roof (rifle and grenade), tables around the reboot van.
- **Failed, then fixed:**
  - Stairs: a landing rail blocked every 2nd → 3rd floor flight, and the north-east stair hall stood partly outside the building.
  - Empty grass-floored zones: four areas got rooms.
  - The crosswalk: stripes raised above the road, and the canopy now reaches over half the crossing.
  - Opaque windows: partition walls were doubled inside exterior and courtyard walls, covering every window from inside. That was the root cause of QA's "boards block the courtyard glass". The windows now look out onto the courtyard and into classrooms.
  - Look: commons floor, table density, ducts, bluer glass, canopy undersides, tower width.
  - The "Open Open Chest" prompt (an existing bug on `main`).

Frame rate (headless SwiftShader, relative only; Low quality, fps):

| View | main | branch at QA | branch now |
|---|---|---|---|
| BHS aerial | 3.8 | 2.8 | 3.2 |
| Inside commons | 2.3 | 1.2 | 1.6 |
| Inside arena | 2.6 | 1.3 | 1.8 |
| Square (another POI) | 2.9 | 2.5 | 2.8 |

What moved the numbers:
- the point-light pool removed: its 4 lights cost about 20% everywhere, other POIs included
- small props streamed at 30 m
- interiors chunked in space
- all plain-colour props sharing one material per chunk (draw calls about 900 → 560 in the commons)

BHS interiors stay heavier than the empty generic shells on `main`, because they are fully furnished.
