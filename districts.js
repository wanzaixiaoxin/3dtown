import * as THREE from 'three';
import { M, trackGeo, disposables } from './materials.js';

export const CITY_ROADS = [-64, -32, 0, 32, 64];
export const CITY_ZONES = [
  { key: 'park', label: '开放式公园', x: -48, z: 48, w: 25, d: 25, color: '#527d48' },
  { key: 'school', label: '学校', x: 48, z: -48, w: 25, d: 25, color: '#8c7855' },
  { key: 'stadium', label: '体育场', x: 48, z: -16, w: 25, d: 25, color: '#668653' },
  { key: 'police', label: '公安局', x: 16, z: 48, w: 22, d: 24, color: '#637587' },
  { key: 'prison', label: '监狱', x: -48, z: -48, w: 25, d: 25, color: '#686b68' },
  { key: 'fire', label: '消防局', x: -16, z: -48, w: 22, d: 24, color: '#8b5648' },
  { key: 'factory', label: '工厂区域', x: -80, z: -48, w: 23, d: 25, color: '#756b58' },
  { key: 'workshop', label: '作坊区', x: -48, z: -16, w: 25, d: 24, color: '#80684c' },
  { key: 'office', label: '写字楼', x: 48, z: 48, w: 25, d: 25, color: '#61747b' },
  { key: 'apartment', label: '居民楼', x: 48, z: 16, w: 25, d: 24, color: '#807768' },
  { key: 'villas', label: '别墅群', x: -48, z: 80, w: 25, d: 22, color: '#73805b' },
  { key: 'farm', label: '农田区域', x: 80, z: 48, w: 23, d: 25, color: '#8b7747' },
  { key: 'farmWest', label: '农田区域', x: -80, z: 48, w: 23, d: 25, color: '#8b7747' },
];

function labelTexture(text, color = '#394d58') {
  const canvas = document.createElement('canvas');
  canvas.width = 512; canvas.height = 144;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = color; ctx.fillRect(0, 0, 512, 144);
  ctx.strokeStyle = '#d9c89c'; ctx.lineWidth = 8; ctx.strokeRect(6, 6, 500, 132);
  ctx.fillStyle = '#f4ecd9'; ctx.font = 'bold 58px "Microsoft YaHei", sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, 256, 75);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  disposables.textures.push(texture);
  return texture;
}

export function buildDistricts(parent, { buildHouse: baseHouse, buildTree: baseTree, colliders }) {
  const m = M();
  let activeZone = { x: 0, z: 0 };
  const materialCache = new Map();
  const mat = value => {
    if (!materialCache.has(value)) {
      const material = new THREE.MeshStandardMaterial({ color: value, roughness: 0.9 });
      materialCache.set(value, material);
      disposables.materials.push(material);
    }
    return materialCache.get(value);
  };
  const add = (group, geometry, material, x, y, z) => {
    const mesh = new THREE.Mesh(trackGeo(geometry), material);
    mesh.position.set(x, y, z); mesh.castShadow = mesh.receiveShadow = true; group.add(mesh);
    return mesh;
  };
  const box = (group, w, h, d, material, x, y, z) => add(group, new THREE.BoxGeometry(w, h, d), material, x, y, z);
  const groundBox = (group, w, d, material, x, z) => box(group, w, 0.06, d, material, x, 0.03, z);
  const shiftCollider = (c, dx, dz) => {
    c.minX += dx; c.maxX += dx; c.minZ += dz; c.maxZ += dz;
  };
  const collider = (x, z, w, d, top, kind = 'house') => colliders.push({
    minX: activeZone.x + x - w / 2, maxX: activeZone.x + x + w / 2,
    minZ: activeZone.z + z - d / 2, maxZ: activeZone.z + z + d / 2, top, kind,
  });
  function buildHouse(group, x, z, w, d, h, opts) {
    const before = colliders.length;
    const result = baseHouse(group, x, z, w, d, h, opts);
    for (let i = before; i < colliders.length; i++) shiftCollider(colliders[i], activeZone.x, activeZone.z);
    return result;
  }
  function buildTree(group, x, z, scale) {
    const before = colliders.length;
    const result = baseTree(group, x, z, scale);
    for (let i = before; i < colliders.length; i++) shiftCollider(colliders[i], activeZone.x, activeZone.z);
    return result;
  }

  function sign(group, text, x, z, color) {
    box(group, 4.8, 0.85, 0.15, m.woodDark, x, 2.8, z);
    box(group, 0.1, 2.4, 0.1, m.woodDark, x - 2, 1.2, z);
    box(group, 0.1, 2.4, 0.1, m.woodDark, x + 2, 1.2, z);
    const material = new THREE.MeshStandardMaterial({ map: labelTexture(text, color), roughness: 0.85 });
    disposables.materials.push(material);
    add(group, new THREE.PlaneGeometry(4.55, 0.68), material, x, 2.8, z + 0.09);
  }

  function modernBlock(group, x, z, w, d, height, color, floors) {
    const wall = mat(color);
    box(group, w, height, d, wall, x, height / 2, z);
    box(group, w + 0.35, 0.3, d + 0.35, m.stoneDk, x, height + 0.15, z);
    for (let floor = 0; floor < floors; floor++) {
      const y = 1.4 + floor * ((height - 1.2) / floors);
      for (const wx of [-0.3, 0, 0.3]) box(group, w * 0.17, 0.75, 0.05, m.windowLit, x + wx * w, y, z - d / 2 - 0.03);
    }
    collider(x, z, w, d, height);
  }

  function park(group, zone) {
    groundBox(group, 24, 24, mat(0x668d54), 0, 0);
    groundBox(group, 2.2, 24, m.roadStone, 0, 0);
    groundBox(group, 24, 2.2, m.roadStone, 0, 0);
    for (const [x, z] of [[-8,-8],[8,-8],[-8,8],[8,8],[-5,5],[6,4]]) buildTree(group, x, z, 0.85);
    for (const x of [-6, 6]) {
      box(group, 2.2, 0.12, 0.55, m.wood, x, 0.55, 0);
      box(group, 2.2, 0.7, 0.12, m.wood, x, 0.9, 0.25);
    }
  }

  function stadium(group) {
    groundBox(group, 24, 24, mat(0x7d6b58), 0, 0);
    const field = add(group, new THREE.CircleGeometry(7.5, 40), mat(0x4f873f), 0, 0.08, 0);
    field.rotation.x = -Math.PI / 2; field.scale.y = 1.25;
    const track = add(group, new THREE.RingGeometry(7.7, 10.2, 40), mat(0xa75e49), 0, 0.07, 0);
    track.rotation.x = -Math.PI / 2; track.scale.y = 1.25;
    for (const x of [-11, 11]) box(group, 2.2, 1.8, 19, m.stoneLt, x, 0.9, 0);
    for (const z of [-8, 8]) {
      box(group, 3.2, 0.08, 0.08, m.stoneLt, 0, 1.5, z);
      for (const x of [-1.6, 1.6]) box(group, 0.08, 1.5, 0.08, m.stoneLt, x, 0.75, z);
    }
  }

  function prison(group) {
    groundBox(group, 24, 24, mat(0x777872), 0, 0);
    for (const [x, z, w, d] of [[0,-11.5,24,0.5],[0,11.5,24,0.5],[-11.5,0,0.5,24],[11.5,0,0.5,24]]) {
      box(group, w, 3.4, d, m.stoneDk, x, 1.7, z);
    }
    for (const [x,z] of [[-10,-10],[10,-10],[-10,10],[10,10]]) box(group, 2, 5.5, 2, m.stoneLt, x, 2.75, z);
    buildHouse(group, 0, 0, 13, 8, 5.4, { stories: 2, roofMat: m.roofGrey, wallMat: m.stoneLt, lanterns: false });
    collider(0, 0, 24, 24, 3.4, 'wall');
  }

  function factory(group) {
    groundBox(group, 23, 25, mat(0x777064), 0, 0);
    for (const x of [-5, 5]) {
      box(group, 8, 4.5, 13, mat(0x8a806d), x, 2.25, 0);
      box(group, 8.5, 0.35, 13.5, m.roofGrey, x, 4.65, 0);
      box(group, 3.5, 3, 0.12, m.woodDark, x, 1.5, -6.55);
      collider(x, 0, 8, 13, 4.8, 'house');
    }
    for (const x of [-7, 7]) add(group, new THREE.CylinderGeometry(0.65, 0.9, 13, 12), mat(0x66564b), x, 6.5, 8);
  }

  function fields(group) {
    for (const [x,z] of [[-5,-6],[5,-6],[-5,5],[5,5]]) {
      groundBox(group, 8, 9, m.dirt, x, z);
      for (let row = -3; row <= 3; row++) box(group, 0.3, 0.35, 8.2, mat(0x66813e), x + row, 0.22, z);
    }
    buildHouse(group, 0, 10, 5, 3, 4.2, { stories: 1, roofMat: m.roofBrown, lanterns: false });
  }

  for (const zone of CITY_ZONES) {
    activeZone = zone;
    const group = new THREE.Group();
    group.position.set(zone.x, 0, zone.z);
    group.name = `district-${zone.key}`;
    if (zone.key === 'park') park(group, zone);
    else if (zone.key === 'stadium') stadium(group);
    else if (zone.key === 'prison') prison(group);
    else if (zone.key === 'factory') factory(group);
    else if (zone.key.startsWith('farm')) fields(group);
    else if (zone.key === 'school') {
      buildHouse(group, 0, -5, 17, 6, 8.4, { stories: 3, roofMat: m.roofBrown, lanterns: false });
      groundBox(group, 18, 9, mat(0x72945c), 0, 6);
      for (const x of [-6, 6]) add(group, new THREE.CylinderGeometry(0.08, 0.08, 3, 6), m.woodDark, x, 1.5, 7);
    } else if (zone.key === 'police') {
      buildHouse(group, 0, 2, 13, 8, 5.4, { stories: 2, roofMat: m.roofGrey, wallMat: m.stoneLt, lanterns: false });
      box(group, 12, 0.25, 0.25, mat(0x365a80), 0, 1.1, -7);
    } else if (zone.key === 'fire') {
      buildHouse(group, 0, 2, 13, 8, 5.4, { stories: 2, roofMat: m.roofGrey, wallMat: mat(0xa85c4b), lanterns: false });
      for (const x of [-3, 0, 3]) box(group, 2.4, 2.5, 0.12, m.woodDark, x, 1.25, -2.05);
      box(group, 2.5, 10, 2.5, mat(0xa85c4b), 7, 5, 5);
    } else if (zone.key === 'workshop') {
      for (const [x,z] of [[-6,-5],[6,-5],[-6,5],[6,5]]) buildHouse(group, x, z, 6, 5, 4.4, { stories: 1, roofMat: m.roofBrown });
      for (const x of [-6,6]) add(group, new THREE.CylinderGeometry(0.35, 0.5, 5, 8), m.stoneDk, x, 2.5, 9);
    } else if (zone.key === 'office') {
      modernBlock(group, -7, 1, 7, 9, 19, 0x607781, 7);
      modernBlock(group, 1, -1, 8, 10, 25, 0x526b78, 9);
      modernBlock(group, 8, 3, 5, 8, 16, 0x72838a, 6);
    } else if (zone.key === 'apartment') {
      for (const [x,z,h] of [[-6,-5,14],[6,-5,17],[-6,6,16],[6,6,13]]) modernBlock(group, x, z, 7, 7, h, 0x9a8f7f, Math.round(h / 2.8));
    } else if (zone.key === 'villas') {
      for (const [x,z] of [[-7,-5],[0,-5],[7,-5],[-7,5],[0,5],[7,5]]) {
        groundBox(group, 6.4, 8, mat(0x6f8b57), x, z);
        buildHouse(group, x, z, 5, 4.5, 4.4, { stories: 1, roofMat: m.roofBrown });
      }
    }
    sign(group, zone.label, -zone.w / 2 + 3, -zone.d / 2 + 1.2, zone.color);
    parent.add(group);
  }
}
