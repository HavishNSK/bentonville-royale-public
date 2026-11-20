// BENTONVILLE ROYALE — Bentonville High School interiors (pure data, no three.js).
//
// Owned by the BHS interior work (docs/bhs/BHS_CONTRACT.md, layout notes in docs/bhs/INTERIOR.md).
// Wired in by the shared modules:
//   landmarks.js        bhsRecipes({ def, R, cut, rowAt, roomsAt, evenAt })  -> LANDMARK_RECIPES
//   landmarkDressing.js bhsDressing(kit)                                     -> LANDMARK_DRESSING
//   landmarkStyle.js    BHS_STYLE                                            -> LANDMARK_STYLE
// The helpers are passed in (not imported) so there is no import cycle with those modules.
//
// Every layout is an invented, realistic APPROXIMATION of a modern American high school inside
// the real footprints: no official floor plans, real room numbers, names, signage or security
// details. Labels are generic ("Math Classroom C", "Chemistry Lab"); letter suffixes are invented.
//
// Frames (local metres, from the planner): a = west -> east, b = south -> north, 4.4 m storeys.
//   952075842 main building, 228 x 137, 2 storeys; main entry court on the north face at a ~ 100,
//             the Arend Arts Center in the north-east wing (b > 93, a 131-228).
//   952075843 North Building, 112 x 103, 3 storeys, main door (stair tower) at the south-east.
// Stair shafts: the planner (storeys.js) puts flights only in ground rooms of kind corridor /
// hall / lobby that fit a flight. Corridors here are 3.6 m wide (too narrow for a flight), so
// shafts land in the dedicated stair halls (same rect on every storey) and the lobbies.
// Double-height rooms (Tiger Arena, auxiliary gym, Arend Arts Center house and stage, Lecture
// Hall, lobbies, North Building commons) have an 'open' overlook / balcony room on the storey above, never a classroom.

export const BHS_MAIN = 952075842; // south / main building
export const BHS_NORTH = 952075843; // North Building

const letters = (pre, n, from = 0) => Array.from({ length: n }, (_, i) => pre + ' ' + String.fromCharCode(65 + from + i));

// ------------------------------------------------------------------ room label tables
// Shared by the recipes and the dressing so the two cannot drift apart.

// Main building, ground floor
const M0_LABS = ['Chemistry Lab', 'Biology Lab', 'Physics Lab', 'Earth Science Lab', 'Anatomy Lab', 'Forensic Science Lab']; // 12 x 15.5 m
const M0_WEST = letters('Math Classroom', 8); // 9.3 x 10.4 m
const M0_MUSIC = ['Band Room', 'Choir Room', 'Orchestra Room'];
const M0_ART = ['Art Studio', 'Ceramics Studio', 'Drawing Studio'];
const M0_EAST = letters('English Classroom', 5); // 10.6 x 12 m
// Main building, upper floor
const M1_SOUTH = letters('Social Studies Classroom', 6);
const M1_WEST = letters('English Classroom', 8, 5);
const M1_EAST = letters('World Languages Classroom', 5);
const M1_CTE_W = ['Business Classroom', 'Computer Science Lab', 'Engineering Lab', 'Robotics Lab'];
const M1_CTE_E = ['Family and Consumer Sciences Lab', 'Health Science Lab', 'Graphic Design Lab', 'Marketing Classroom'];

// North Building, per storey (index = level)
const N_LABS = [
  ['Chemistry Lab', 'Biology Lab', 'Physics Lab', 'AP Science Lab'],
  letters('Science Lab', 4),
  letters('English Classroom', 4),
];
const N_ROW_A = [letters('Math Classroom', 4), letters('Social Studies Classroom', 4), letters('English Classroom', 4, 4)];
const N_ROW_B = [letters('Math Classroom', 4, 4), letters('Social Studies Classroom', 4, 4), letters('English Classroom', 4, 8)];
const N_ROW_C = [letters('Math Classroom', 4, 8), letters('Social Studies Classroom', 4, 8), letters('English Classroom', 4, 12)];
const N_FLOOR = ['', 'Second-Floor ', 'Third-Floor '];
const N_SEMINAR = letters('Seminar Room', 4);

/** Registers the BHS recipes through landmarks.js `def`. */
export function bhsRecipes({ def, R, cut, rowAt, evenAt }) {
  /** Rooms of one kind evenly along `axis` over [a0, a1] (the first one starts at the parent edge). */
  const seq = (axis, a0, a1, kind, labels) =>
    labels.length === 1 ? R(kind, labels[0]) : rowAt(axis, evenAt(a0, a1, labels.length), labels.map((l) => R(kind, l)));

  // Bentonville High School, main building (952075842; 228 x 137 m, 2 storeys).
  // World orientation: a = west -> east, b = south -> north (world z ~ 428.5 - b).
  // West block: science labs on the south face, a locker corridor with math classrooms, the
  // athletics corridor, Tiger Arena (competition gym), locker rooms, equipment and training
  // rooms, auxiliary gym, weight and wrestling rooms. Centre: the Main Lobby behind the north
  // entry court (the real main entrance), the Main Hall running south to the South Lobby, the
  // office suite (main office, nurse, counseling) and the cafeteria, with the kitchen and loading
  // dock at the north service door. North-east wing (buildingPart 1002835402, the map's Arend
  // Arts Center POI): the arts lobby at the wing's north-west corner, the Arend Arts Center house
  // (1,100+ seats) and the stage at the east end under the fly tower, scene shop and green room
  // behind it. South-east: band / choir / orchestra and art rooms off the arts corridors, and the
  // library in the south-east wing. Upper floor: classroom wings, CTE labs over the cafeteria,
  // overlooks / balconies over every double-height room.
  // Sources: bentonvillek12.org/page/arend-arts-center, bentonvillek12.org/o/bhs/page/history,
  // sites.google.com/bentonvillek12.org/bhstheatre, en.wikipedia.org/wiki/Bentonville_High_School.
  def(BHS_MAIN, 228.2, 137.2, 'b', () => {
    const west = (k) =>
      rowAt('b', [39, 42.6, 53, 56.6], [
        rowAt('a', [18, 30, 42, 54, 66, 78], [
          ...(k === 0 ? M0_LABS.map((l) => R('classroom', l)) : M1_SOUTH.map((l) => R('classroom', l))),
          k === 0 ? R('storage', 'Science Prep Room') : R('classroom', 'Psychology Classroom'),
        ]),
        R('corridor', k === 0 ? 'West Corridor' : 'Upper West Corridor'),
        rowAt('a', [15.2, 25.2], [
          R('classroom', (k === 0 ? M0_WEST : M1_WEST)[0]),
          R('corridor', 'Stair Hall West'),
          seq('a', 25.2, 91, 'classroom', (k === 0 ? M0_WEST : M1_WEST).slice(1)),
        ]),
        R('corridor', k === 0 ? 'Athletics Corridor' : 'Arena Concourse'),
        cut(
          'a',
          { abs: 56 },
          k === 0 ? R('gym', 'Tiger Arena') : R('open', 'Arena Upper Bowl'),
          cut(
            'b',
            { abs: 70 },
            k === 0
              ? rowAt('a', [66, 76, 83], [R('restroom', 'Boys Locker Room'), R('restroom', 'Girls Locker Room'), R('storage', 'Equipment Room'), R('office', 'Athletic Training Room')])
              : rowAt('a', [73], [R('office', 'Athletics Offices'), R('break', 'Team Room')]),
            k === 0 ? cut('b', { abs: 103 }, R('gym', 'Auxiliary Gym'), rowAt('a', [73], [R('gym', 'Weight Room'), R('gym', 'Wrestling Room')])) : R('open', 'Auxiliary Gym Overlook')
          )
        ),
      ]);

    // a 91-155, b 0-93: South Lobby, Main Hall, office suite, Main Lobby, cafeteria (CTE above)
    const centre = (k) =>
      cut(
        'b',
        { abs: 46 },
        k === 0 ? R('lobby', 'South Lobby') : R('open', 'South Lobby Overlook'),
        cut(
          'a',
          { abs: 94.6 },
          R('corridor', k === 0 ? 'Main Hall' : 'Upper Main Hall'),
          cut(
            'a',
            { abs: 124 },
            rowAt('b', [56.6, 70], [
              k === 0
                ? rowAt('a', [101.4, 109.2, 116.6], [R('restroom', 'Boys Restroom'), R('restroom', 'Girls Restroom'), R('office', "Nurse's Office"), R('office', 'Counseling Center')])
                : rowAt('a', [101.4, 109.2, 116.6], [R('restroom', 'Boys Restroom Upper'), R('restroom', 'Girls Restroom Upper'), R('break', 'Teacher Workroom'), R('office', 'Department Offices')]),
              k === 0
                ? rowAt('a', [106, 115], [R('office', 'Main Office'), R('office', 'Attendance Office'), R('office', 'Conference Room')])
                : rowAt('a', [106, 115], [R('classroom', 'Health Classroom'), R('office', 'Counseling Offices'), R('storage', 'Copy Room')]),
              k === 0 ? R('lobby', 'Main Lobby') : R('open', 'Lobby Overlook'),
            ]),
            k === 0
              ? R('cafeteria', 'Cafeteria')
              : cut('a', { abs: 138 }, rowAt('b', [57.8, 69.6, 81.4], M1_CTE_W.map((l) => R('classroom', l))), cut('a', { abs: 141.6 }, R('corridor', 'CTE Corridor'), rowAt('b', [57.8, 69.6, 81.4], M1_CTE_E.map((l) => R('classroom', l)))))
          )
        )
      );

    // a 155-228, b 0-93: library wing on the south-east, music / art rooms off the arts corridors
    const east = (k) =>
      cut(
        'b',
        { abs: 46 },
        rowAt('a', [168, 208], [
          cut('b', { abs: 24 }, R('classroom', k === 0 ? 'Computer Lab' : 'Testing Room'), R('corridor', 'Stair Hall East')),
          R('library', k === 0 ? 'Library' : 'Library Mezzanine'),
          cut('b', { abs: 23 }, R('office', k === 0 ? 'Library Workroom' : 'Media Production Room'), R('office', k === 0 ? 'Library Office' : 'Archive Room')),
        ]),
        cut(
          'a',
          { abs: 158.6 },
          R('corridor', k === 0 ? 'East Cross Corridor' : 'Upper East Cross Corridor'),
          rowAt('b', [49.6, 63, 66.6, 77.4, 89.4], [
            R('corridor', k === 0 ? 'Arts Corridor' : 'Upper Arts Corridor'),
            k === 0
              ? rowAt('a', [177, 194], M0_MUSIC.map((l) => R('classroom', l)))
              : rowAt('a', [177, 194], [R('classroom', 'Piano Lab'), R('studio', 'Music Practice Rooms'), R('storage', 'Music Library')]),
            R('corridor', k === 0 ? 'Fine Arts Corridor' : 'Upper Fine Arts Corridor'),
            k === 0
              ? seq('a', 158.6, 211.6, 'studio', M0_ART)
              : rowAt('a', evenAt(158.6, 211.6, 3), [R('classroom', 'Digital Media Lab'), R('classroom', 'Film Studies Classroom'), R('office', 'Yearbook Room')]),
            seq('a', 158.6, 211.6, 'classroom', k === 0 ? M0_EAST : M1_EAST),
            R('corridor', k === 0 ? 'North Corridor East' : 'Upper North Corridor East'),
          ])
        )
      );

    // a 90-228, b 93-137: kitchen + loading dock (north service door), then the Arend Arts Center
    // wing: arts lobby (north-west corner), theatre classroom / prop storage, house, stage, backstage
    const north = (k) =>
      rowAt('a', [131, 150, 168, 197, 211.6], [
        k === 0 ? cut('b', { abs: 112 }, R('kitchen', 'Kitchen'), R('storage', 'Loading Dock')) : cut('b', { abs: 112 }, R('kitchen', 'Culinary Arts Lab'), R('storage', 'Mechanical Room')),
        k === 0 ? R('lobby', 'Arts Center Lobby') : R('open', 'Arts Lobby Balcony'),
        cut('b', { abs: 115 }, R('classroom', k === 0 ? 'Theatre Classroom' : 'Drama Classroom'), R('storage', k === 0 ? 'Prop Storage' : 'Lighting Storage')),
        k === 0 ? R('auditorium', 'Arend Arts Center') : R('open', 'Arts Center Balcony'),
        k === 0 ? R('open', 'Stage') : R('storage', 'Fly Loft'),
        cut('b', { abs: 119 }, R(k === 0 ? 'storage' : 'break', k === 0 ? 'Scene Shop' : 'Dressing Rooms'), R(k === 0 ? 'break' : 'storage', k === 0 ? 'Green Room' : 'Costume Storage')),
      ]);

    const level = (k) => cut('a', { abs: 91 }, west(k), cut('b', { abs: 93 }, cut('a', { abs: 155 }, centre(k), east(k)), north(k)));
    // hints: stairs[0] seeds the first shaft (Main Lobby); the others are documentation
    return {
      levels: [level(0), level(1)],
      stairs: [{ a: 109, b: 81, dir: 'a' }, { a: 20, b: 48, dir: 'b' }, { a: 161, b: 35, dir: 'b' }, { a: 140, b: 115, dir: 'b' }],
    };
  });

  // Bentonville High School, North Building (952075843; 112 x 103 m, 3 storeys). The 2006
  // academic building: the main stair tower at the south-east entry, a ~200-seat lecture hall
  // on the main level, a commons and commons dining opening onto the courtyard (the open
  // north-east side of the footprint), a multi-storey media center, science labs on the south
  // face and double-loaded classroom corridors.
  // Sources: schooldesigns.com/Projects/bentonville-high-school-north-building,
  // bentonvillek12.org/o/bhs/page/history.
  def(BHS_NORTH, 111.8, 103, 'b', () => {
    const level = (k) => {
      const F = N_FLOOR[k];
      const west = rowAt('b', [18, 21.6, 32, 42.4, 46, 56.4, 60, 70.4], [
        seq('a', 8.3, 60, 'classroom', N_LABS[k]),
        R('corridor', F + 'Science Corridor'),
        rowAt('a', [22, 28, 34, 40], [
          R('corridor', 'Stair Hall Southwest'),
          R('storage', ['Lab Prep Room', 'Science Workroom', 'Book Storage'][k]),
          R('restroom', ['Boys Restroom', 'Boys Restroom Upper', 'Boys Restroom Top'][k]),
          R('restroom', ['Girls Restroom', 'Girls Restroom Upper', 'Girls Restroom Top'][k]),
          R('classroom', ['Forensic Science Lab', 'Environmental Science Lab', 'Writing Center'][k]),
        ]),
        seq('a', 8.3, 60, 'classroom', N_ROW_A[k]),
        R('corridor', F + 'Middle Corridor'),
        seq('a', 8.3, 60, 'classroom', N_ROW_B[k]),
        R('corridor', F + 'North Corridor'),
        seq('a', 8.3, 60, 'classroom', N_ROW_C[k]),
        cut(
          'a',
          { abs: 14 },
          R('corridor', 'Stair Hall Northwest'),
          k === 0 ? R('library', 'Media Center') : k === 1 ? R('library', 'Media Center Mezzanine') : cut('b', { abs: 81.6 }, seq('a', 14, 60, 'classroom', N_SEMINAR), R('open', 'Study Commons'))
        ),
      ]);
      const east = cut(
        'a',
        { abs: 63.6 },
        R('corridor', F + 'Central Corridor'),
        cut(
          'b',
          { abs: 24 },
          rowAt('a', [92], [
            k === 0 ? R('auditorium', 'Lecture Hall') : k === 1 ? R('open', 'Lecture Hall Balcony') : rowAt('a', [78], [R('classroom', 'AP Seminar Room'), R('classroom', 'Debate Classroom')]),
            R(k === 0 ? 'lobby' : 'corridor', 'Main Stair Tower'),
          ]),
          cut(
            'b',
            { abs: 52 },
            R(k === 1 ? 'open' : 'hall', ['Commons', 'Commons Overlook', 'Collaboration Commons'][k]),
            rowAt('a', [88], [
              k === 0 ? R('cafeteria', 'Commons Dining') : cut('b', { abs: 64 }, R(k === 1 ? 'break' : 'office', k === 1 ? 'Teacher Workroom' : 'Department Offices'), R('classroom', k === 1 ? 'Engineering Lab' : 'Robotics Lab')),
              R(k === 0 ? 'kitchen' : 'storage', ['Servery', 'Mechanical Room', 'Custodial Storage'][k]),
            ])
          )
        )
      );
      return cut('a', { abs: 60 }, west, east);
    };
    return {
      levels: [level(0), level(1), level(2)],
      stairs: [{ a: 102, b: 12, dir: 'b' }, { a: 7, b: 87, dir: 'b' }, { a: 11, b: 27, dir: 'b' }, { a: 70, b: 38, dir: 'a' }],
    };
  });
}

/** BHS set dressing, in the landmarkDressing.js directive format. `kit` = that module's helpers. */
export function bhsDressing({ d, classroom, gym, auditorium, offices, kitchen, lockers, library, cafeteria, lobby, storage, breakRoom, lounge, reserve }) {
  // classroom rows: whiteboard on the west (a0) side wall, desks facing it; depth = room width along a
  const row = (labels, depth, opts) => labels.flatMap((l) => classroom(l, 'a0', depth, opts));
  const stairHall = (room, level) => [reserve(room, { spine: 2, kit: false, level }), d(room, 'walls', 'bench', { gap: 3, max: 2 }, level), d(room, 'walls', 'plant', { max: 2 }, level)];
  const lockerRoom = (room) => [d(room, 'walls', 'locker_bank', { gap: 0.1, max: 10 }), d(room, 'grid', 'bench', { aisle: 1.6, margin: 1.6, max: 4 })];
  const overlook = (room, level, n = 10) => [reserve(room, { spine: 3, kit: false, level }), d(room, 'walls', 'railing', { gap: 0.2, max: n }, level), d(room, 'walls', 'bench', { gap: 4, max: 4 }, level)];
  const lab = (labels, depth, level) => row(labels, depth, { lab: true, desks: 8, level });

  return {
    // Main building: locker-lined corridors, classroom desk grids facing whiteboards, lab benches,
    // gyms with courts and bleachers, the Arend Arts Center house facing its stage, cafeteria
    // serving line, library stacks and reading tables, the main office suite.
    952075842: [
      // ground: circulation
      ...lobby('Main Lobby', { entrance: 'b1', level: 0 }),
      d('Main Lobby', 'walls', 'display_case', { gap: 0.6, max: 6 }, 0),
      ...lobby('South Lobby', { desk: false, entrance: 'b0', level: 0 }),
      d('South Lobby', 'walls', 'display_case', { gap: 1, max: 4 }, 0),
      ...lockers('Main Hall', ['a0', 'a1'], 12, 0),
      ...lockers('West Corridor', ['b0', 'b1'], 40, 0),
      ...lockers('Athletics Corridor', ['b0'], 16, 0),
      ...lockers('Arts Corridor', ['b1'], 14, 0),
      ...lockers('Fine Arts Corridor', ['b0', 'b1'], 20, 0),
      ...lockers('North Corridor East', ['b0'], 18, 0),
      ...lockers('East Cross Corridor', ['a0', 'a1'], 12, 0),
      ...stairHall('Stair Hall West'),
      ...stairHall('Stair Hall East'),
      // ground: science + classrooms
      ...lab(M0_LABS, 12, 0),
      ...storage('Science Prep Room', { racks: 4, crates: 4, level: 0 }),
      ...row(M0_WEST, 9.3, { desks: 24, level: 0 }),
      ...row(M0_EAST, 10.6, { desks: 24, level: 0 }),
      // ground: office suite
      d('Main Office', 'at', 'reception_desk', { fa: 0.5, fb: 0.3, face: 'b-' }, 0),
      ...offices('Main Office', { desks: 4, level: 0 }),
      ...offices('Attendance Office', { desks: 3, level: 0 }),
      ...offices('Counseling Center', { desks: 4, level: 0 }),
      ...offices('Conference Room', { desks: 2, level: 0 }),
      d("Nurse's Office", 'walls', 'bed', { gap: 0.8, max: 3 }, 0),
      d("Nurse's Office", 'walls', 'sink', { max: 1 }, 0),
      d("Nurse's Office", 'walls', 'filing_cabinet', { max: 2 }, 0),
      // ground: athletics
      ...gym('Tiger Arena', 56, { court: [15.2, 28.7], bleachers: 12, level: 0 }),
      ...gym('Auxiliary Gym', 34, { court: [15.2, 26], bleachers: 4, level: 0 }),
      reserve('Wrestling Room', { kit: false, level: 0 }),
      d('Wrestling Room', 'centre', 'rug', { w: 12, d: 9, face: 'a+' }, 0),
      d('Wrestling Room', 'walls', 'bench', { gap: 2, max: 4 }, 0),
      reserve('Weight Room', { kit: false, level: 0 }),
      d('Weight Room', 'grid', 'workbench', { face: 'b+', aisle: 1.6, margin: 1.6, max: 12 }, 0),
      d('Weight Room', 'wall_mount', 'mirror', { gap: 0.4, max: 8 }, 0),
      ...storage('Equipment Room', { racks: 6, crates: 8, level: 0 }),
      ...lockerRoom('Boys Locker Room'),
      ...lockerRoom('Girls Locker Room'),
      d('Athletic Training Room', 'grid', 'bed', { face: 'b+', aisle: 1.4, margin: 1.4, max: 4 }, 0),
      // ground: arts
      ...lobby('Arts Center Lobby', { entrance: 'b1', level: 0 }),
      ...classroom('Theatre Classroom', 'a0', 18, { desks: 24, level: 0 }),
      ...storage('Prop Storage', { racks: 4, crates: 8, level: 0 }),
      reserve('Arend Arts Center', { spine: 0, kit: false, level: 0 }),
      d('Arend Arts Center', 'grid', 'seat_row', { face: 'a+', aisle: 1.2, margin: 1.6, max: 90 }, 0),
      // stage platform on the proscenium (house) side, south of the house door; the stage room is an
      // 'open' circulation room, so its centre spine and door legs stay clear
      reserve('Stage', { spine: 0, kit: false, level: 0 }),
      d('Stage', 'at', 'stage', { fa: 0.2, fb: 0.2, face: 'a-', w: 12, d: 5 }, 0),
      d('Stage', 'walls', 'crate', { sides: ['a1'], gap: 1, max: 6 }, 0),
      d('Stage', 'walls', 'shelf', { sides: ['b0', 'b1'], gap: 2, max: 4 }, 0),
      ...storage('Scene Shop', { racks: 3, crates: 8, level: 0 }),
      d('Scene Shop', 'walls', 'workbench', { gap: 0.6, max: 3 }, 0),
      ...lounge('Green Room', 0),
      ...M0_MUSIC.flatMap((l) => [
        d(l, 'grid', 'chair', { face: 'a-', aisle: 1.0, margin: 1.6, max: 40 }, 0),
        d(l, 'wall_mount', 'whiteboard', { sides: ['a0'], max: 1 }, 0),
        d(l, 'walls', 'shelf', { sides: ['b1'], gap: 0.3, max: 4 }, 0),
      ]),
      ...M0_ART.flatMap((l) => [d(l, 'grid', 'workbench', { face: 'b-', aisle: 1.4, margin: 1.4, max: 8 }, 0), d(l, 'walls', 'shelf', { gap: 0.4, max: 4 }, 0), d(l, 'walls', 'easel', { gap: 1, max: 6 }, 0)]),
      // ground: dining + library
      ...cafeteria('Cafeteria', 'b1', { tables: 60, level: 0 }),
      ...kitchen('Kitchen', { islands: 2, level: 0 }),
      ...storage('Loading Dock', { racks: 6, crates: 10, level: 0 }),
      ...library('Library', { stacks: 30, tables: 6, level: 0 }),
      ...offices('Library Workroom', { desks: 3, level: 0 }),
      ...offices('Library Office', { desks: 2, level: 0 }),
      d('Computer Lab', 'grid', 'desk', { face: 'a-', aisle: 1.2, margin: 1.2, max: 20 }, 0),
      d('Computer Lab', 'wall_mount', 'whiteboard', { sides: ['a0'], max: 1 }, 0),

      // upper floor
      ...lockers('Upper West Corridor', ['b0', 'b1'], 40, 1),
      ...lockers('Upper Main Hall', ['a0', 'a1'], 12, 1),
      ...lockers('Upper Arts Corridor', ['b1'], 14, 1),
      ...lockers('Upper Fine Arts Corridor', ['b0', 'b1'], 20, 1),
      ...lockers('Upper North Corridor East', ['b0'], 18, 1),
      ...lockers('CTE Corridor', ['a0', 'a1'], 14, 1),
      ...row(M1_SOUTH, 12, { desks: 28, level: 1 }),
      ...classroom('Psychology Classroom', 'a0', 12, { desks: 28, level: 1 }),
      ...row(M1_WEST, 9.3, { desks: 24, level: 1 }),
      ...row(M1_EAST, 10.6, { desks: 24, level: 1 }),
      ...row(['Digital Media Lab', 'Film Studies Classroom'], 17.6, { desks: 28, level: 1 }),
      ...classroom('Drama Classroom', 'a0', 18, { desks: 24, level: 1 }),
      ...storage('Lighting Storage', { racks: 3, crates: 6, level: 1 }),
      ...storage('Copy Room', { racks: 2, crates: 4, level: 1 }),
      ...offices('Counseling Offices', { desks: 4, level: 1 }),
      ...offices('Yearbook Room', { desks: 6, level: 1 }),
      ...classroom('Piano Lab', 'a0', 18.4, { desks: 20, level: 1 }),
      ...storage('Music Library', { racks: 4, crates: 4, level: 1 }),
      ...M1_CTE_W.flatMap((l, i) => classroom(l, 'a0', 14, { lab: i > 0, desks: i > 0 ? 8 : 24, level: 1 })),
      ...M1_CTE_E.flatMap((l, i) => classroom(l, 'a1', 13.4, { lab: i < 3, desks: i < 3 ? 8 : 24, level: 1 })),
      ...kitchen('Culinary Arts Lab', { islands: 3, level: 1 }),
      ...storage('Mechanical Room', { racks: 2, crates: 6, level: 1 }),
      ...overlook('Lobby Overlook', 1),
      ...overlook('South Lobby Overlook', 1),
      ...overlook('Arts Lobby Balcony', 1),
      ...overlook('Auxiliary Gym Overlook', 1),
      reserve('Arena Upper Bowl', { spine: 0, kit: false, level: 1 }),
      d('Arena Upper Bowl', 'walls', 'bleachers', { sides: ['b0', 'b1', 'a0'], gap: 0.4, max: 20 }, 1),
      d('Arena Upper Bowl', 'walls', 'railing', { sides: ['a1'], gap: 0.2, max: 6 }, 1),
      reserve('Arts Center Balcony', { spine: 0, kit: false, level: 1 }),
      d('Arts Center Balcony', 'grid', 'seat_row', { face: 'a+', aisle: 1.2, margin: 1.6, max: 60 }, 1),
      ...storage('Fly Loft', { racks: 2, crates: 6, level: 1 }),
      ...storage('Costume Storage', { racks: 4, crates: 4, level: 1 }),
      ...breakRoom('Dressing Rooms', { tables: 2, level: 1 }),
      d('Dressing Rooms', 'wall_mount', 'mirror', { gap: 0.3, max: 8 }, 1),
      ...breakRoom('Teacher Workroom', { tables: 3, level: 1 }),
      ...breakRoom('Team Room', { tables: 3, level: 1 }),
      ...offices('Athletics Offices', { desks: 6, level: 1 }),
      ...offices('Department Offices', { desks: 8, level: 1 }),
      ...classroom('Health Classroom', 'a0', 12.4, { desks: 24, level: 1 }),
      ...library('Library Mezzanine', { stacks: 24, tables: 4, level: 1 }),
      ...offices('Media Production Room', { desks: 4, level: 1 }),
      ...classroom('Testing Room', 'a0', 13, { desks: 30, level: 1 }),
      ...storage('Archive Room', { racks: 4, crates: 4, level: 1 }),
    ],

    // North Building: lecture hall facing its lectern stage, commons and dining, stacks over two
    // storeys of media center, lab benches on the south face, locker-lined classroom corridors.
    952075843: [
      ...auditorium('Lecture Hall', 'a1', { w: 10, dd: 4, seats: 40, level: 0 }),
      d('Lecture Hall', 'wall_mount', 'whiteboard', { sides: ['a1'], max: 2, gap: 2 }, 0),
      reserve('Lecture Hall Balcony', { spine: 0, kit: false, level: 1 }),
      d('Lecture Hall Balcony', 'grid', 'seat_row', { face: 'a+', aisle: 1.2, margin: 1.6, max: 24 }, 1),
      d('Lecture Hall Balcony', 'walls', 'railing', { sides: ['a1'], gap: 0.2, max: 6 }, 1),
      ...lobby('Main Stair Tower', { desk: false, entrance: 'b0', level: 0 }),
      ...stairHall('Main Stair Tower', 1),
      ...stairHall('Main Stair Tower', 2),
      ...stairHall('Stair Hall Southwest'),
      ...stairHall('Stair Hall Northwest'),
      d('Commons', 'hang', 'painting_large', { styles: ['landscape'], spacing: 5.2, max: 3, label: false }, 0),
      ...[0.18, 0.41, 0.64, 0.87].flatMap((fa, index) =>
        [0.20, 0.51, 0.82].map(fb => d('Commons', 'at', 'commons_table', {
          fa, fb, face: index % 2 ? 'a+' : 'b+',
        }, 0))),
      d('Commons', 'grid', 'commons_table', { aisle: 2.0, margin: 1.8, max: 8 }, 0),
      d('Commons', 'walls', 'bench', { gap: 3, max: 6 }, 0),
      ...cafeteria('Commons Dining', 'a1', { tables: 16, level: 0 }),
      ...kitchen('Servery', { islands: 1, level: 0 }),
      ...overlook('Commons Overlook', 1),
      d('Collaboration Commons', 'grid', 'cafe_table', { aisle: 1.8, margin: 2.4, max: 16 }, 2),
      ...library('Media Center', { stacks: 24, tables: 4, level: 0 }),
      ...library('Media Center Mezzanine', { stacks: 20, tables: 3, level: 1 }),
      d('Study Commons', 'grid', 'cafe_table', { aisle: 1.8, margin: 2, max: 16 }, 2),
      ...row(N_SEMINAR, 11.5, { desks: 16, level: 2 }),
      ...[0, 1, 2].flatMap((k) => [
        ...(k < 2 ? lab(N_LABS[k], 12.9, k) : row(N_LABS[k], 12.9, { desks: 24, level: k })),
        ...row(N_ROW_A[k], 12.9, { desks: 24, level: k }),
        ...row(N_ROW_B[k], 12.9, { desks: 24, level: k }),
        ...row(N_ROW_C[k], 12.9, { desks: 24, level: k }),
        ...lockers(N_FLOOR[k] + 'Science Corridor', ['b0', 'b1'], 24, k),
        ...lockers(N_FLOOR[k] + 'Middle Corridor', ['b0', 'b1'], 24, k),
        ...lockers(N_FLOOR[k] + 'North Corridor', ['b0', 'b1'], 24, k),
        ...lockers(N_FLOOR[k] + 'Central Corridor', ['a0'], 20, k),
      ]),
      ...storage('Lab Prep Room', { racks: 2, crates: 4, level: 0 }),
      ...storage('Science Workroom', { racks: 2, crates: 4, level: 1 }),
      ...storage('Book Storage', { racks: 4, crates: 4, level: 2 }),
      ...classroom('Forensic Science Lab', 'a1', 20, { lab: true, desks: 8, level: 0 }),
      ...classroom('Environmental Science Lab', 'a1', 20, { lab: true, desks: 8, level: 1 }),
      ...classroom('Writing Center', 'a1', 20, { desks: 20, level: 2 }),
      ...breakRoom('Teacher Workroom', { tables: 3, level: 1 }),
      ...offices('Department Offices', { desks: 8, level: 2 }),
      ...classroom('Engineering Lab', 'a0', 24, { lab: true, desks: 8, level: 1 }),
      ...classroom('Robotics Lab', 'a0', 24, { lab: true, desks: 8, level: 2 }),
      ...storage('Mechanical Room', { racks: 2, crates: 6, level: 1 }),
      ...storage('Custodial Storage', { racks: 3, crates: 6, level: 2 }),
      ...row(['AP Seminar Room', 'Debate Classroom'], 14.2, { desks: 24, level: 2 }),
    ],
  };
}

// ------------------------------------------------------------------ materials
// VCT corridors and classrooms, terrazzo lobbies and commons, painted block (CMU) walls in light
// neutrals, acoustic-tile ceilings, maple courts, carpet in the library and offices, dark house
// finishes in the theatre. Accent: plain orange and black school colours on trim only.
const CMU = 0xe9e5db; // painted concrete block
const TILE_CEIL = 0xf1efe9; // acoustic ceiling tile
const THRESH = 0x4d4a46;
const S = (wall, floor, ceiling, trim) => Object.freeze({ wall, floor, ceiling, trim, threshold: THRESH });

const CORRIDOR = S(CMU, 0xd6d0c2, TILE_CEIL, 0xc0621f); // cream VCT, orange base trim
const CLASSROOM = S(0xece8de, 0xcdc6b6, TILE_CEIL, 0x55585e);
const LAB = S(0xe6eae6, 0xbdc2bd, TILE_CEIL, 0x3f4448);
const TERRAZZO = S(0xece6da, 0xcbc3b3, TILE_CEIL, 0x2b2b2b);
const COMMONS = Object.freeze({
  ...S(0xa3a6aa, 0xa39b90, TILE_CEIL, 0x4e4540),
  panelWood: 0xb38655, inlay: 0x554b43,
  mural: Object.freeze([0x527f77, 0x8fb3a2, 0xcad4be]),
  beams: Object.freeze({ spacing: 2.3, width: 0.22, depth: 0.30, color: 0xa77f60 }),
});
const GYM = S(0xe2dccf, 0xd2a266, 0x8f969c, 0x1c1c1c); // maple court, exposed grey deck
const HOUSE = S(0x3a3540, 0x5a2f36, 0x28262b, 0x1d1b1f); // dark walls, burgundy carpet
const ARTS_HOUSE = S(0x8d8070, 0x47413d, 0xb8b2a8, 0x33312e);
const STAGE = Object.freeze({ ...S(0xa27d64, 0x484341, 0xd4bca0, 0x514137), panelWood: 0xb48a68 });
const LIBRARY = Object.freeze({ ...S(0xe4e4e1, 0x5b5a5e, TILE_CEIL, 0xc49d72), inlay: 0x7a3a3a });
const OFFICE = S(0xebe6db, 0x6d7079, TILE_CEIL, 0x5c5f66);
const RESTROOM = S(0xdfe4e5, 0xbcc0c2, TILE_CEIL, 0x6e7478);
const KITCHEN = S(0xe8e8e3, 0x9b5c45, TILE_CEIL, 0x55585e); // quarry tile
const STORAGE = S(0xd8d4cb, 0xa8a49b, 0xcfccc5, 0x5c5f66); // sealed concrete
const STUDIO = S(0xebe7df, 0xb3aea4, TILE_CEIL, 0x55585e);
const BLEACHER = S(0xe2dccf, 0xa9a59d, 0x8f969c, 0x1c1c1c);

const KINDS = Object.freeze({
  corridor: CORRIDOR, classroom: CLASSROOM, gym: GYM, auditorium: HOUSE, library: LIBRARY, office: OFFICE,
  restroom: RESTROOM, kitchen: KITCHEN, storage: STORAGE, studio: STUDIO, break: OFFICE, lobby: TERRAZZO,
  hall: TERRAZZO, open: TERRAZZO, cafeteria: TERRAZZO,
});
const labStyles = (labels) => Object.fromEntries(labels.map((l) => [l, LAB]));

/** BHS interior materials, in the landmarkStyle.js format. */
export const BHS_STYLE = Object.freeze({
  [BHS_MAIN]: Object.freeze({
    kinds: KINDS,
    labels: Object.freeze({
      ...labStyles([...M0_LABS, ...M1_CTE_W.slice(1), ...M1_CTE_E.slice(0, 3)]),
      'Arena Upper Bowl': BLEACHER,
      'Auxiliary Gym Overlook': BLEACHER,
      'Arend Arts Center': ARTS_HOUSE,
      'Arts Center Balcony': ARTS_HOUSE,
      Stage: STAGE,
      'Fly Loft': STAGE,
      'Wrestling Room': S(0xe2dccf, 0xb0201c, 0x8f969c, 0x1c1c1c), // red wrestling mats
      'Weight Room': S(0xe2dccf, 0x2f3033, 0x8f969c, 0x1c1c1c), // rubber floor
      'Boys Locker Room': RESTROOM,
      'Girls Locker Room': RESTROOM,
    }),
  }),
  [BHS_NORTH]: Object.freeze({
    kinds: KINDS,
    labels: Object.freeze({
      ...labStyles([...N_LABS[0], ...N_LABS[1], 'Forensic Science Lab', 'Environmental Science Lab', 'Engineering Lab', 'Robotics Lab']),
      'Lecture Hall': HOUSE,
      'Lecture Hall Balcony': HOUSE,
      Commons: COMMONS,
      'Commons Dining': COMMONS,
      'Commons Overlook': COMMONS,
      'Collaboration Commons': COMMONS,
      'Study Commons': LIBRARY,
    }),
  }),
});
