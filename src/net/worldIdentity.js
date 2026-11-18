// A deployment compatibility checksum, not an authentication or anti-cheat control.
// Bump when collision/surface rules change without changing map or interior data.
export const COLLISION_REVISION = 1;
const cached = new WeakMap();
const ID = /^w1-[a-f0-9]{16}$/;

function checksum() {
  let a = 0x811c9dc5, b = 0x9e3779b9;
  const byte = v => {
    a = Math.imul(a ^ v, 0x01000193);
    b = Math.imul(b ^ v, 0x85ebca6b);
  };
  return {
    text(value) {
      const s = JSON.stringify(value);
      for (let i = 0; i < s.length; i++) {
        const n = s.charCodeAt(i);
        byte(n & 255);
        byte(n >>> 8);
      }
    },
    heights(values) {
      const buffer = new DataView(new ArrayBuffer(4));
      for (let i = 0; i < values.length; i++) {
        buffer.setFloat32(0, values[i], true);
        for (let j = 0; j < 4; j++) byte(buffer.getUint8(j));
      }
    },
    value: () => (a >>> 0).toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0'),
  };
}

/** Map data and terrain samples are immutable after load; avoid hashing on every getter. */
export function worldIdentity(data, world, interiorVersion) {
  if (!data || !world || !world.interiorHash) return null;
  const terrain = world.terrain;
  const previous = cached.get(world);
  if (previous && previous.data === data && previous.terrain === terrain &&
      previous.interior === world.interiorHash && previous.version === interiorVersion) return previous.id;
  const h = checksum();
  h.text([COLLISION_REVISION, interiorVersion, world.interiorHash]);
  // Hash actual coordinates and roads rather than trusting a generated timestamp.
  h.text(data);
  if (terrain) {
    h.text([terrain.minX, terrain.minZ, terrain.cell, terrain.cols, terrain.rows]);
    h.heights(terrain.h);
  } else h.text('flat-ground');
  const id = 'w1-' + h.value();
  cached.set(world, { data, terrain, interior: world.interiorHash, version: interiorVersion, id });
  return id;
}

/** Old hosts, missing IDs, and unavailable local worlds cannot establish compatibility. */
export function sameWorld(local, remote) {
  return typeof local === 'string' && ID.test(local) && local === remote;
}
