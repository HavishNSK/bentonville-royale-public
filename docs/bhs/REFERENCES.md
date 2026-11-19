# Bentonville High School: exterior references

Owner: exterior agent (`src/world/bhs/exterior.js`). Retrieved 2026-11-18.

Photos and aerial imagery were **looked at for reference only**. None of them is copied into the repo
or the game. Everything in the game is procedural (canvas textures, boxes, quads). No logos, mascot
art, district branding, signage text, names, room numbers or security details are modelled.

## Sources

| # | Source | What it shows / says | Confidence |
|---|---|---|---|
| 1 | [BHS history](https://bhs.bentonvillek12.org/about-us/history) | Current main building at SE J St, about 230,000 sq ft. Arend Arts Center opened 2001-2003. A 2006 expansion added about 275,000 sq ft to the west, north and east. No description of materials. | High for dates and sizes |
| 2 | [School Designs: BHS North Building](https://schooldesigns.com/Projects/bentonville-high-school-north-building/) | Hight Jackson Associates, completed August 2006, 193,350 sq ft. A three-storey academic wing around a central courtyard, a multi-storey media centre, and a **stair tower that marks the main entry**. No exterior materials given. Photos are credited but were not viewable. | High for the program, none for materials |
| 3 | [Arend Arts Center page](https://www.bentonvillek12.org/academics/visual-performing-arts1/art-centers/arend-arts-center) and its linked *Facility Specifications* (02/2020) and *Line Set Specifications* PDFs | 1,190 seats: 802 on the main floor and a **388-seat balcony**. Proscenium 23 ft high. Plaster line to back wall 39 ft. **36 line sets** with 63 ft battens and 28 ft legs. A fly rail on the stage-right gallery, and a grid height whose first digit did not extract (about 58-68 ft). Together these mean a full fly loft (stage house) and a tall house with a balcony. | High that a stage house exists. Its height is an estimate |
| 4 | [Talk Business, 2001](https://talkbusiness.net/2001/06/arends-arts-center-under-construction/) | Arend Arts Center: Hight-Jackson Associates, about 55,000 sq ft, about 1,200-seat auditorium. | Medium |
| 5 | [Wikimedia Commons: BHS Overall view](https://commons.wikimedia.org/wiki/File:BHS_Overall_view.jpg) (500 px panorama, from the stadium side looking east) | **Dark red / maroon brick** on both buildings, with **white parapet fascias** and white metal-panel volumes. The North Building has a glass curtain-wall band with a rounded corner and horizontal window rows. A tall **buff / tan block** (stage house) rises behind it. The long main-building facade has two rows of regular punched windows and a white top band. Light rooftop units. A covered walkway canopy. | Medium (small, old image) |
| 6 | Esri World Imagery aerial, zoom 17-19, around 36.3515 N, 94.1965 W (viewed only) | White membrane roofs and scattered square rooftop units on both buildings. North Building: courtyard plan with an angled north-east wing and an angled glass prow at the south-east corner (the main entry, facing the main building). Main building: a large west block with a raised central volume (gym / arena). The north-east block is the Arend Arts Center: a **curved, faceted lobby** at its north-west corner, a lobby / gallery strip with a row of units, a plain auditorium roof, and an east block with a 2 x 5 grid of roof hatches (stage house smoke vents). Long shadows to the north mean that block stands well above the 2-storey roofs. The entry court on the north side has a curved entry at its back and an arched walkway canopy at the street. | Medium-high for the plan. Heights come from shadows only |
| 7 | [Wikipedia: Bentonville High School](https://en.wikipedia.org/wiki/Bentonville_High_School) | Two buildings, stadium adjacent. Nothing on the exterior. | n/a |

Not used: `File:Bentonville_High_School.jpg` on Commons shows the 1928 Old High (now Old High
Middle School), a different building.

## What we model

- **Brick:** deep red-brown running bond (8 x 24 courses per 1.6 m tile) on both buildings
  (refs 5, 6). The exact brick blend is **uncertain**.
- **Main building, 2 floors:** paired punched windows (1.7 m wide on a 3.6 m bay, sill 0.95 m,
  head 3.05 m per storey) with cast-stone sills. Cast-stone plinth and a band at the 4.4 m floor
  line. A white metal fascia over the top 0.6 m. White coping. The window rhythm is an
  approximation of ref 5.
- **North Building, 3 floors:** ribbon windows between brick piers on every floor, cast-stone
  bands at 4.4 m and 8.8 m. The top floor is clad in white metal panels (ref 5).
  - **Glass stair tower** at the south-east corner around the main entry: a full-height curtain
    wall (refs 2, 6).
  - **Media centre glazing:** a two-storey curtain wall across the middle of the west face (refs 2, 5).
    Its position is **uncertain**.
- **Arend Arts Center:** brick base, a band at 4.4 m, and buff / tan precast above it.
  - A **curved glass lobby** at the north-west corner (ref 6).
  - **Auditorium house** raised to about 14 m, and a **stage house (fly tower)** to about 19.5 m with
    10 roof hatches (refs 3, 5, 6). Both heights are **estimates**: the fly loft is inferred from
    the 23 ft proscenium and 36 line sets, and the house from the balcony.
- **Main entry court:** a curved glass entry at the back of the court and a covered steel walkway
  north to the street (ref 6). The real arched canopy at the street is simplified to a flat canopy.
- **Doors:** the game's shell doors (World `_planShell`) get storefront glass, a dark-bronze
  surround and a cantilevered canopy. They are **not** at the real door positions: the shell
  places them by road access. The curved main entry and the North Building tower glass are drawn at
  the real locations.
- **Roofs:** a white / light grey membrane (`BHS_TINT.roof`) and hashed rooftop HVAC units, with a
  few larger air-handling units.

Not modelled (uncertain or out of scope): the raised gym / arena volume on the west block, exact
window counts per wing, the real arched street canopy, signage of any kind.
