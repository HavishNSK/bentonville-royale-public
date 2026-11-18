// BENTONVILLE ROYALE — per-landmark interior material styles (rendering only; pure data).
// Read by InteriorMeshes.js through plan.id. No collision, layout or plan-hash impact: changing a
// colour here never changes the deterministic plan (Interiors.js), only the merged chunk colours.
//
// LANDMARK_STYLE = { [buildingId]: { kinds: { [roomKind]: S }, labels: { [roomLabel]: S } } }
// S = { wall?, floor?, ceiling?, beams?: { spacing, color, depth, width? }, threshold?, trim? }
//   wall / floor / ceiling / trim / threshold: 0xRRGGBB
//   beams: timber beams under the ceiling, each spanning the room's short axis, repeated every
//          `spacing` m along the long axis, `depth` m deep (hanging below the ceiling), `width` m wide
//   threshold: dark band on the floor across every interior doorway of a styled room
// A room's style is its label entry if present, else its kind entry, else none (labels beat kinds).
//
// Crystal Bridges (8240824): materials only from the owner's own AskRosie 3D virtual tour design
// language (warm concrete, timber-beamed galleries on wood floors, limestone circulation, a cool
// glass-tinted bridge). No artwork, titles or artist names are taken from that project.

const CONCRETE = 0xd8d1c2;
const CEILING = 0xe9e4d8;
const THRESHOLD = 0x555047;
const BEAMS = Object.freeze({ spacing: 2.4, color: 0x8a6849, depth: 0.25, width: 0.18 });

const GALLERY = Object.freeze({ wall: CONCRETE, floor: 0x806144, ceiling: CEILING, beams: BEAMS, threshold: THRESHOLD, trim: 0x74553b });
const LIMESTONE = Object.freeze({ wall: CONCRETE, floor: 0xc5c0b5, ceiling: CEILING, threshold: THRESHOLD, trim: 0xb3aa98 });
// Bridge pavilion: wood floor and beams, walls blended ~45% from concrete toward a glass tint (#9dbeba)
const BRIDGE = Object.freeze({ ...GALLERY, wall: 0xbecac0 });

export const LANDMARK_STYLE = Object.freeze({
  8240824: Object.freeze({
    kinds: Object.freeze({ gallery: GALLERY, lobby: LIMESTONE, hall: LIMESTONE, corridor: LIMESTONE, open: LIMESTONE }),
    labels: Object.freeze({
      'Main Lobby': LIMESTONE,
      'Great Hall': LIMESTONE,
      'Gallery Walk': LIMESTONE,
      'Upper Walkway': LIMESTONE,
      'Lobby Balcony': LIMESTONE,
      'Great Hall Balcony': LIMESTONE,
      'Bridge Gallery': BRIDGE,
      'Bridge Gallery Upper': BRIDGE,
    }),
  }),
});

/**
 * The style for one room of a plan, or null. room: a plan room ({ kind, label }) or null.
 * styles defaults to LANDMARK_STYLE (tests can pass {} to render the unstyled baseline).
 */
export function styleFor(planId, room, styles = LANDMARK_STYLE) {
  if (!room) return null;
  const entry = styles[planId];
  if (!entry) return null;
  const byLabel = entry.labels && typeof room.label === 'string' ? entry.labels[room.label] : undefined;
  if (byLabel) return byLabel;
  return (entry.kinds && entry.kinds[room.kind]) || null;
}
