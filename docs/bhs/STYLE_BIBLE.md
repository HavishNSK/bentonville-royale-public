# Bentonville High School: style bible

This is the single source of truth for how BHS looks. It's written from the reference photos in
`~/Pictures/bhs-refs` (the `BHS_REFS` folder; outside the repo, private: cited here **by filename only** and never
copied, embedded or used as textures). Every line cites its photos in brackets.

- **Colours** were sampled by `tools/bhs/palette.mjs` (patches listed in `tools/bhs/palette-samples.json`):
  per-patch channel median, then the median across patches, with luminance outliers dropped.
- **Sampled** = what the camera saw (includes the photo's exposure and shade).
- **Game albedo** = the material colour used in game. It starts from the sampled value and is lifted or
  neutralised where the photo patch was shaded or tinted. The tuning is done by eye in the match loop,
  photo beside render (`_work/compare/`).
- **Units:** 1 unit = 1 m. Scale references: a standard door is 2.1 m, a stair riser is about 17 cm.
- **Floor-to-floor:** 4.4 m (BHS `data.js`).

Abbreviations for the photo files:

| Short | File |
|---|---|
| ENT | entrance.jpg (AVIF) |
| DRW | drawingofnorthbuildingentrance.jpg |
| NOR | north.png |
| SOU | south.png |
| WLK | walkwaybetweenschools.jpg |
| N2S | northbuildingrightsouthbuildingleftpicture.jpg |
| 3DF | 3Dfrontview.png |
| L3D | labeled3Dview.png |
| AE1 | aerialview.jpg (WebP) |
| AE2 | aerialview2.png |
| CB | viewofnorthbuildingcafeteriafrom2ndfloorbridge.jpg |
| C1 | northbuildingcafeteriafirstfloor.jpg |
| LIB | bhslibrary.jpg (WebP) |
| LI2 | libraryimage2.jpg |
| AAC | bhsaacarendartscenter.jpg |

> **Note on N2S.** Its filename says "north building right, south building left". But the left building has the
> white metal tower, the tall glass and the 3-storey brick that ENT, DRW and 3DF show on the North
> Building, and the right building has the south building's buff-banded brick and covered walkway
> (WLK). The features decide: in N2S the **North Building is on the left**.

## 1. Palette

### Exterior

| Surface | Sampled | Game albedo | Notes [photos] |
|---|---|---|---|
| Red brick (both buildings) | #50352b | #7a3f31 | deep red-brown, running bond, mid-grey mortar. The patch is partly shaded, so it's lifted [ENT, WLK, NOR] |
| Brick soldier/accent band | #623427 | #8a4532 | a slightly brighter red, single course, at the storefront head [ENT] |
| Buff lintels and sills | (n/a) | #b89c78 | tan cast stone over the brick windows [ENT, NOR] |
| Light block, North tower | #d2c6bd | #d8cfc4 | split-face light CMU, stack bond [ENT] |
| Buff brick, south walkway piers and bands | #776658 | #b59d80 | tan brick piers and top bands. The patch was shaded [WLK, N2S] |
| Buff fascia, walkway | #928f8a | #cdbfa6 | smooth buff band with the blank lettering field. Shaded patch [WLK] |
| White ribbed metal panel | #efeeee | #e9e9e6 | horizontal ribbed panels on the tower and atrium heads [ENT, DRW, N2S] |
| Grey metal panel (angled upper volume) | #85827f | #9a9893 | flat panels in a staggered joint [ENT] |
| Curtain-wall glass | #6c898c | #6f8e92 | reflective blue-green, 1.5 m x 1.2 m lites [ENT, DRW, NOR] |
| Storefront and mullion aluminium | #979797 | #b9bcbe | clear anodised [ENT] |
| Canopy fascia and soffit | #c5c1bc | #d7d5d1 | flat white aluminium canopy [ENT] |
| Paving | #c6b19a | #c2b8a8 | broom-finished concrete. The photo is warm, so it's neutralised [ENT] |
| Roof membrane | (n/a) | #e6e6e2 | white TPO with grey walk pads [AE2, NOR, 3DF] |

### North Building commons

| Surface | Sampled | Game albedo | Notes [photos] |
|---|---|---|---|
| Wood banding | #82624d | #a5764f | horizontal wood plank panels with dark reveals, upper walls [CB, C1] |
| Upper wall wood (lit) | #997c5b | #b38655 | warmer where lit [C1] |
| Grey block lower walls | #9298a3 | #a3a6aa | ground-floor ground-face block [CB] |
| Columns | #8c8b90 | #b4b3b2 | round, light grey, 0.6 m diameter [CB, C1] |
| Floor, dark band | #554b43 | #4e4540 | polished terrazzo-like, very glossy [CB, C1] |
| Floor, field | #91887f | #a39b90 | light polished field [CB, C1] |
| Banner panels | #676863 | #2b3036 | tall dark navy/black panels. **Text and emblems are blank** [CB, C1] |
| Glass railing | (n/a) | glass on an aluminium cap | glass panels in a metal top rail at the 2nd-floor walkway [C1, CB] |

### Library

| Surface | Sampled | Game albedo | Notes [photos] |
|---|---|---|---|
| Walls | #c8caca | #e4e4e1 | white painted [LIB, LI2] |
| Brick piers | #837567 | #9a6f55 | tall brick piers between window bays [LIB] |
| Carpet field | #555356 | #5b5a5e | grey [LIB, LI2] |
| Carpet bands | #5a4443 | #7a3a3a | red-maroon aisle bands [LIB] |
| Shelf wood | #b69877 | #c49d72 | maple shelf tops and end caps [LIB, LI2] |
| Shelf end panels | #675f61 | #ecebe8 | white end panels. The patch was shaded [LIB] |

### Arend Arts Center (AAC) theatre

| Surface | Sampled | Game albedo | Notes [photos] |
|---|---|---|---|
| Seats | #080807 | #1c1c1e | black upholstered, continental rows [AAC] |
| Stage shell wood | #a27d64 | #b48a68 | vertical wood panels with a lit ceiling cloud [AAC] |
| Acoustic wall panels | #5c5041 | #8d8070 | angled fabric panels, taupe [AAC] |
| Ceiling and soffits | #7e7364 | #b8b2a8 | light plaster, curved bulkheads [AAC] |
| Proscenium valance | #6e4016 | #8a5524 | gold-brown drape [AAC] |

## 2. Materials (all procedural canvas textures, world-space UVs: `src/world/bhs/kit/materials.js`)
- **Brick, running bond:** 0.2 x 0.067 m courses, mortar #8d8780, ±6 % per-brick tint jitter. A soldier course is
  bricks on end, 0.2 m high [ENT, NOR, WLK].
- **Split-face block:** 0.4 x 0.2 m, stack bond, faint speckle [ENT].
- **Ribbed metal panel:** horizontal 0.3 m ribs, a highlight line on every rib [ENT, DRW, N2S].
- **Curtain wall:** a gradient sky reflection plus mullion lines on a 1.5 x 1.2 m grid, with 0.05 m caps drawn as geometry
  [ENT, DRW].
- **Terrazzo:** speckled light field with dark bands 1.2 m wide in a large grid. Glossy (Phong, high shininess)
  [CB, C1].
- **Wood banding:** horizontal planks 0.3 m high with 0.02 m dark reveals and grain [CB, C1].
- **Carpet:** fine noise. The band colour comes from geometry [LIB].
- **Acoustic tile ceiling:** 0.6 x 1.2 m grid, white #e8e6e1 (approximate, no ceiling photo of the commons).
- **VCT (corridors and classrooms):** 0.3 m tiles, cream #d9d2c3 with grey #a8a49c accents.
  *Approximate*: there's no corridor photo.

## 3. Exterior per facade

### North Building (U-shape around a grass courtyard) [AE1, AE2, 3DF, L3D, NOR]
- **Plan.** A west commons and entry block, a north wing (angled at its north-east end), an east wing and a south wing, around a
  courtyard (about x -6..34, z 196..240 in game coordinates). The wings are about 22 m deep, double-loaded.
- **Height.** 3 storeys of 4.4 m plus a 1 m parapet, so a 14.2 m roof edge. The commons block is about as tall, with a raised
  clerestory. The stair tower rises about 2 m higher [ENT, 3DF].
- **Main entrance (west face)** [ENT, DRW, 3DF, AE1]
  - It sits in the re-entrant corner where the west wall steps (about x -42, z 187).
  - North of the entry is a 2-storey brick block:
    - ground floor: a silver storefront band 3.6 m high with mullions every 1.5 m and a 0.6 m spandrel
    - above it, a red soldier band, then brick with one punched 3.0 x 1.4 m window under a buff lintel
  - The entry itself:
    - 6 pairs of glass doors under a flat white canopy (0.3 m fascia, about 4 m deep, at 4.0 m)
    - above the canopy, a 2-storey glass curtain wall (6 x 7 lites)
    - a white ribbed metal head and an angled grey metal-panel volume on top
  - South of the entry: a light split-face block tower (about 4 m wide) with a tall vertical window strip (1.2 m wide),
    then white ribbed panel.
  - The fascia lettering and the mascot are **blank** (rule 7).
- **Wings** [NOR, 3DF, N2S]
  - Red brick, 3 rows of punched windows (1.5 m wide x 1.6 m high, sill 0.9 m above each floor) in pairs on a
    3.6 m bay, with buff sills.
  - A white parapet coping.
  - Ground-floor windows are slightly taller.
- **Commons glass corner** [3DF, NOR]: a curtain wall with a horizontal sunshade fin at each floor, and a silver ribbed
  metal-panel volume with strip windows next to it.

```
West elevation, North Building at the main entry (looking east, not to scale):
  ______________________________   ___________   _____
 |  brick   [lintel]             | |  glass    | |tower|  white ribbed
 |  [  window 3.0x1.4  ]         | |  curtain  | | CMU |  panel
 |=====soldier band===============| |  6x7 lites| | |  |
 |  silver storefront  3.6 m     | |=CANOPY====| | |  |
 |  |  |  |  |  |  |  |  |  |    | |doors x 6  | | |  |
 ------------------------------------------------------- grade
```

### South / main building [SOU, WLK, 3DF, L3D, AE1, AE2]
- **Classroom wings:** 2 storeys of red brick, with a buff brick top band (about 1.2 m) and a buff band at the floor line.
  Punched windows in pairs [WLK, 3DF, SOU].
- **Big volumes:** gyms (west), the AAC and the cafe/library blocks are taller (about 12–14 m), with white roofs and
  roof units [L3D, 3DF].
- **Entry court (north face, between the AAC and the west wing)** [SOU]
  - a long water channel / cascade running north–south
  - a curved concrete arch beam on posts at the court mouth
  - a paved court
- **AAC north front** [SOU]: curved and stepped brick drums (3 stepped arcs), a curved glass lobby, and a raised
  fly tower behind.
- **Covered walkway** [WLK, N2S]
  - It links the buildings across the service road.
  - 0.9 m square buff brick piers carry a flat roof with a deep buff fascia. The letter field is blank.
  - The underside is light. There are picnic tables at the west end.

## 4. Hero spaces (interior)

### Commons / cafeteria (North Building) [CB, C1]
- **Size:** about 34 x 30 m, a 3-storey atrium (about 13 m to the roof). Scale comes from the 2.1 m doors in the CB back wall.
- **Ground floor:**
  - grey block walls with flush wood doors
  - round columns on about a 9 m grid
  - the servery opening at the far end with a glass storefront
  - a wall clock
- **Upper floors:**
  - a 2nd-floor walkway/bridge along one side with a glass railing (1.07 m)
  - wood banding up to the clerestory windows (3rd level)
  - tall dark banner panels hung on the wood (blank)
- **Floor:** glossy terrazzo with a light field and dark bands, in a big grid.
- **Furniture:** round cafe tables (1.2 m) with 4 black chairs, some square tables, and high-top tables along the edge
  [CB, C1].
- **Light:** high-bay pendant fixtures, daylight from the clerestory and the curtain wall.

### Library (south building) [LIB, LI2]
- A two-storey atrium with tall vertical window bays between brick piers on one side.
- White walls, and a second-floor gallery/mezzanine with a white balustrade (left side in LIB).
- Low shelving rows (1.5 m) with maple tops and white end panels, in long runs.
- Taller perimeter shelving (2.1 m).
- Lounge chairs (black), a computer table zone with wood tables and chairs [LI2], fluorescent lay-in lights, and an
  acoustic tile ceiling in the low parts.

### AAC theatre [AAC]
- A fan-shaped house with continental seating, black seats, and a raked floor of about 0.15 m per row.
- A curved upper balcony fascia.
- Side walls with angled taupe acoustic panels.
- The stage has a wood shell (side towers plus a ceiling cloud with downlights) and a gold valance.
- The proscenium is about 7 m (23 ft) high.

### Gym / arena, main hallways and lockers, classrooms, offices, restrooms, stairs (except the commons)
There are **no photos**, so these are *approximate* (listed in HACKATHON_NOTES.md):
- They use the exterior and commons palette (red brick feature walls, grey block, VCT, acoustic tile).
- Typical US high school detailing.
- Lockers are painted steel, two-tier, in the accent colours below.

## 5. Accent colours for classrooms (from the sampled palette)
- brick red #7a3f31
- wood #a5764f
- navy #2b3036
- library maroon #7a3a3a
- curtain-glass teal #6f8e92
- buff #b59d80

## 6. Signs and graphics
Same shapes and colours as the real ones, with blank text. No logos, mascot, names or numbers (rule 7).
