// BENTONVILLE ROYALE — Bentonville City Square meshes (browser only): the fountain.
// Dimensions come from layout.json (fountain.*); colliders are registered in index.js with the
// same numbers, so what you see is what you stand on.
import * as THREE from 'three';

const STONE = 0xd9cfbb; // pale limestone / cast-stone rim (Esri 2025 imagery: light ring)
const STONE_DARK = 0xc4b89f;
const WATER = 0x4f9fc4;
const SPRAY = 0xeaf6fb;
const PLANT = 0x4f8a3a;
const PLANT_DARK = 0x3d7030;

export function buildSquareMeshes({ root, layout }) {
  const F = layout.fountain;
  const g = new THREE.Group();
  g.name = 'bentonville-square';
  g.position.set(F.x, 0, F.z);
  const mat = (color, extra = {}) => new THREE.MeshLambertMaterial({ color, ...extra });
  const stone = mat(STONE);
  const stoneDark = mat(STONE_DARK);
  const add = (geo, m, y = 0, cast = true) => {
    const mesh = new THREE.Mesh(geo, m);
    mesh.position.y = y;
    mesh.castShadow = cast;
    mesh.receiveShadow = true;
    g.add(mesh);
    return mesh;
  };
  const inner = F.rimR - F.rimW;

  // basin: outer wall, coping on top, inner wall down to the water
  add(new THREE.CylinderGeometry(F.rimR, F.rimR + 0.05, F.rimH, 64, 1, true), stone, F.rimH / 2);
  const top = add(new THREE.RingGeometry(inner, F.rimR + 0.06, 64), stoneDark, F.rimH + 0.001, false);
  top.rotation.x = -Math.PI / 2;
  const innerWall = new THREE.CylinderGeometry(inner, inner, F.rimH, 64, 1, true);
  add(innerWall, mat(STONE_DARK, { side: THREE.BackSide }), F.rimH / 2, false);

  // water between the rim and the planter
  const water = add(
    new THREE.RingGeometry(F.planterR, inner, 64),
    new THREE.MeshLambertMaterial({ color: WATER, transparent: true, opacity: 0.88, emissive: 0x0d2f45 }),
    F.waterY,
    false,
  );
  water.rotation.x = -Math.PI / 2;
  water.name = 'sq-water';

  // raised centre planter (green in every aerial) with low shrubs
  add(new THREE.CylinderGeometry(F.planterR, F.planterR + 0.04, F.planterH, 48), stone, F.planterH / 2);
  const soil = add(new THREE.CircleGeometry(F.planterR - 0.18, 48), mat(0x5b4632), F.planterH + 0.005, false);
  soil.rotation.x = -Math.PI / 2;
  const shrubGeo = new THREE.IcosahedronGeometry(0.55, 1);
  const shrubs = [mat(PLANT), mat(PLANT_DARK)];
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    const r = i % 3 === 0 ? 0.6 : 1.45;
    const s = add(shrubGeo, shrubs[i % 2], F.planterH + 0.3);
    s.position.x = Math.cos(a) * r;
    s.position.z = Math.sin(a) * r;
    s.scale.set(1, 0.75 + (i % 3) * 0.12, 1);
  }

  // low arcs of spray from the planter edge into the basin (white ring in the 2025 imagery)
  const spray = new THREE.MeshBasicMaterial({ color: SPRAY, transparent: true, opacity: 0.55, depthWrite: false });
  const jetGeo = new THREE.ConeGeometry(0.09, 1.1, 6, 1, true);
  const jets = [];
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    const j = add(jetGeo, spray, F.waterY + 0.45, false);
    const r = F.planterR + 0.55;
    j.position.x = Math.cos(a) * r;
    j.position.z = Math.sin(a) * r;
    j.rotation.order = 'YXZ';
    j.rotation.y = -a + Math.PI / 2;
    j.rotation.x = 0.55; // leaning outwards
    j.renderOrder = 2;
    jets.push(j);
  }

  root.add(g);
  let t = 0;
  return {
    group: g,
    update(dt) {
      t += dt;
      const s = 1 + Math.sin(t * 6) * 0.06;
      for (let i = 0; i < jets.length; i++) jets[i].scale.y = s + Math.sin(t * 5 + i) * 0.04;
    },
  };
}
