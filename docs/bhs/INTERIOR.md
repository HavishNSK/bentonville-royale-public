> **Superseded (2026-11-19).** In the game, both BHS buildings are now bespoke kit buildings (`src/world/bhs/north.js`, `south.js`, `interior/`; see `docs/bhs/STYLE_BIBLE.md` and `docs/bhs/BHS_CONTRACT.md`). The procedural recipes below (`src/world/interiors/bhs.js`) only apply where the generic building system still builds these footprints, such as `scripts/check-interiors.mjs` and the interior tests.

# Bentonville High School interiors

Owner: interior agent. Code: `src/world/interiors/bhs.js` (recipes, dressing, materials).
Test: `tests/bhs-interior.test.mjs`. Contract: `docs/bhs/BHS_CONTRACT.md`.

The layouts are an **invented, believable modern American high school** fitted to the real OSM
footprints. They are not the school's floor plans. Only the building programme comes from the public
sources below. Everything else is standard school design.

## Sources (public descriptions only)
- Bentonville Schools, Arend Arts Center page: https://www.bentonvillek12.org/page/arend-arts-center
  (performing arts center at the high school, opened January 2003).
- BHS Theatre site: https://sites.google.com/bentonvillek12.org/bhstheatre/home (1,100+ seat venue).
- Bentonville High School history: https://www.bentonvillek12.org/o/bhs/page/history
- School Designs, BHS North Building: https://schooldesigns.com/Projects/bentonville-high-school-north-building
  (2006 academic building: commons opening onto a central courtyard, multi-storey media center,
  science labs, ~200-seat lecture hall on the main level, main stair tower at the entry).
- Wikipedia, Bentonville High School: https://en.wikipedia.org/wiki/Bentonville_High_School
- Map data: the Arend Arts Center POI sits in the main building's north-east wing; Tiger Arena is
  named in public map listings, with no published plan.

## What is real vs invented
| Real (from sources / map) | Invented |
|---|---|
| Footprints, storey counts (2 and 3), north entry court as the main entrance | Every room position and size |
| Arend Arts Center in the north-east wing (buildingPart 1002835402), 1,100+ seats, stage at the east end | Balcony seating, scene shop, green room, dressing rooms |
| Tiger Arena (competition gym) in the main building | Its position (west block), auxiliary gym, locker rooms, weight room |
| Cafeteria, library, main office exist (any US high school) | Their positions, kitchen, loading dock, office suite |
| North Building: commons/courtyard, media center, labs, lecture hall, stair tower | Classroom wings, upper-floor rooms, department names |

Labels are generic ("Math Classroom C", "Chemistry Lab"). Letter suffixes are invented, and no label
contains a digit, so none can match a real room number. There are no names, signage text or security
details (cameras, alarms, access control).

## Frames
Planner frame: `a` runs west to east and `b` runs south to north. Storeys are 4.4 m apart.
Corridors are 3.6 m wide. That is too narrow for the stair planner, so it places flights only in the
stair halls and lobbies, which keep the same rectangle on every storey.

## Main building (952075842, 228 x 137 m, 2 storeys)
World mapping: world x is about a - 113 and world z is about 428.5 - b, so the north wall is b 137
(z 291) and the south wall is b 0 (z 429).

**Ground floor**
- West block (a 0-90): science labs along the south face, then the West Corridor (lockers). North of
  it are math classrooms and Stair Hall West, then the Athletics Corridor and Tiger Arena
  (56 x 58 m of floor). The block also holds the boys' and girls' locker rooms, the equipment room,
  the athletic training room, the auxiliary gym, the weight room and the wrestling room.
- Centre (a 90-155): the South Lobby is at the south door. The Main Hall runs north from it to the
  **Main Lobby**, which sits behind the north entry court, the real main entrance (world x about -10,
  z about 336). The office suite lies between them: restrooms, Nurse's Office, Counseling Center,
  Main Office, Attendance Office and a Conference Room. The Cafeteria sits east of the office suite.
- North-east wing (b 93-137, a 131-228; buildingPart 1002835402 and the map's Arend Arts Center
  POI): the **Arts Center Lobby** is at the wing's north-west corner. East of it are a Theatre
  Classroom and Prop Storage, then the **Arend Arts Center** house (world x about 55-84). The
  **Stage** is at the east end under the fly tower (world x about 84-97), with the Scene Shop and the
  Green Room behind it at the north-east stage door. The Kitchen and Loading Dock sit at the north
  service door, west of the wing.
- South-east (a 155-228): the Library, Computer Lab, Stair Hall East and the library offices are in
  the south-east wing. North of them are the Arts Corridor, the Band, Choir and Orchestra rooms, the
  Fine Arts Corridor, three art studios, English classrooms and the North Corridor East, which runs
  along the side of the house.

**Upper floor:** Social studies and English classrooms over the west wing. The Arena Upper Bowl
(bleachers) and the Auxiliary Gym Overlook are over the gyms. Overlooks sit over the Main Lobby, the
South Lobby and the arts lobby. The Arts Center Balcony (seat rows) is over the house and the Fly Loft
is over the stage, with the dressing rooms and costume storage behind it. Over the arts wing there are
also a Drama Classroom and Lighting Storage. A CTE corridor over the cafeteria serves business,
computer science, engineering, robotics, FACS, health science, graphic design and marketing rooms.
There is also a culinary arts lab over the kitchen, a health classroom, offices and a teacher
workroom. Over the arts corridors are music practice rooms, a piano lab, a music library, digital
media, film studies and yearbook rooms, and world-language classrooms. The library side holds a
Library Mezzanine, a testing room and an archive room.

Stairs: Main Lobby (seeded), Stair Hall West, Stair Hall East and the Arts Center Lobby.

Known gap: the shell from World has no exterior door at the north entry court, so the Main Lobby is
reached from the Main Hall. The real entrance position comes from the exterior research.

## North Building (952075843, 112 x 103 m, 3 storeys)
Every floor has the same skeleton:
- the science row on the south face, then the Science Corridor;
- Stair Hall Southwest, a prep or storage room, boys' and girls' restrooms, and a lab;
- two classroom rows on either side of the Middle Corridor;
- the North Corridor and one more classroom row;
- Stair Hall Northwest (at the north-west door) and the media center block;
- a Central Corridor running north to south.

The east side holds the Lecture Hall, the Main Stair Tower (main door), the Commons, the Commons
Dining area (opens to the courtyard door on the north-east side) and the Servery.
- Level 0: chemistry, biology, physics, AP science and forensic labs, math classrooms, the Media
  Center, the ~200-seat Lecture Hall, the Commons and Commons Dining.
- Level 1: science labs, social studies classrooms and the Media Center Mezzanine. The Lecture Hall
  Balcony and Commons Overlook are open to the rooms below. This floor also has a teacher workroom,
  an engineering lab and a mechanical room.
- Level 2: English classrooms, a writing center, and seminar rooms around a Study Commons. It also
  has an AP seminar room, a debate classroom, the Collaboration Commons, department offices, a
  robotics lab and custodial storage.

Stairs: Main Stair Tower (seeded), Stair Hall Northwest, Stair Hall Southwest and the Commons.

## Double-height rooms
The engine always has a breakable slab between storeys and supports no open-to-below voids.
Following the contract and the existing landmarks (West High's arena bowl, Sam Walton Hall's balcony),
every double-height room has an `open` room, never classrooms, directly above it:
- the arena has an upper bowl with bleachers above it;
- the auditorium house has a balcony with seat rows;
- the lecture hall has a balcony with seat rows and a railing;
- the lobbies and the North Building commons have overlooks with railings.

The Fly Loft over the stage is a storage room, as in West High's recipe.

## Materials (`BHS_STYLE`)
- Cream VCT corridors with orange base trim.
- Painted block walls in light neutrals and acoustic-tile ceilings.
- Terrazzo lobbies, commons and cafeteria.
- A maple court and grey deck in the gyms, red mats in the wrestling room and a rubber floor in the
  weight room.
- Dark walls and burgundy carpet in the auditorium, the balcony and the lecture hall, and a black
  stage.
- Blue-grey carpet with wood trim in the library, and carpet in the offices.
- Quarry tile in the kitchens, sealed concrete in storage and studios, and sheet vinyl in the labs.
