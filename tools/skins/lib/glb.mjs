// Minimal GLB reader for the skin tools (Node only, no three.js): JSON chunk, binary chunk,
// typed accessors and the embedded base-colour texture. Only what the KayKit character files
// use (one buffer, float/ushort/ubyte accessors, one embedded PNG).
import fs from 'node:fs';

const COMPONENTS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
const ARRAYS = { 5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array };

export function readGlb(file) {
  const b = fs.readFileSync(file);
  if (b.readUInt32LE(0) !== 0x46546c67) throw new Error(`${file}: not a GLB`);
  const jsonLen = b.readUInt32LE(12);
  const json = JSON.parse(b.subarray(20, 20 + jsonLen).toString('utf8'));
  const binStart = 20 + jsonLen + 8;
  const binLen = b.readUInt32LE(20 + jsonLen);
  const bin = b.subarray(binStart, binStart + binLen);
  return { json, bin };
}

/** Accessor `i` as an array of tuples (numbers for SCALAR). Normalised ints become 0..1 floats. */
export function accessor({ json, bin }, i) {
  const a = json.accessors[i];
  const bv = json.bufferViews[a.bufferView];
  const n = COMPONENTS[a.type];
  const Arr = ARRAYS[a.componentType];
  const stride = bv.byteStride || n * Arr.BYTES_PER_ELEMENT;
  const base = bin.byteOffset + (bv.byteOffset || 0) + (a.byteOffset || 0);
  const out = new Array(a.count);
  const norm = a.normalized ? (Arr === Uint8Array ? 255 : Arr === Uint16Array ? 65535 : 1) : 1;
  for (let k = 0; k < a.count; k++) {
    const view = new Arr(bin.buffer.slice(base + k * stride, base + k * stride + n * Arr.BYTES_PER_ELEMENT));
    const v = Array.from(view, (x) => x / norm);
    out[k] = n === 1 ? v[0] : v;
  }
  return out;
}

/** The embedded PNG of image 0 as a Buffer. */
export function embeddedImage({ json, bin }, index = 0) {
  const img = json.images[index];
  const bv = json.bufferViews[img.bufferView];
  return Buffer.from(bin.subarray(bv.byteOffset || 0, (bv.byteOffset || 0) + bv.byteLength));
}

/** [{ node, name, skinned, parent, primitive }] for every node with a mesh. */
export function meshNodes({ json }) {
  const parent = {};
  json.nodes.forEach((n, i) => (n.children || []).forEach((c) => (parent[c] = i)));
  const out = [];
  json.nodes.forEach((n, i) => {
    if (n.mesh == null) return;
    const mesh = json.meshes[n.mesh];
    for (const p of mesh.primitives) {
      out.push({ node: i, name: n.name, skinned: n.skin != null, parent: parent[i] != null ? json.nodes[parent[i]].name : null, primitive: p });
    }
  });
  return out;
}
