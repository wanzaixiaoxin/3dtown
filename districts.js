import * as THREE from 'three';
import { M, trackGeo, disposables } from './materials.js';

export const CITY_ROADS = [-200, -100, 0, 100, 200];
export const ALL_ROADS = [-240, ...CITY_ROADS, 240];
export const CITY_ZONES = [
  { key: 'park', label: '开放式公园', x: -48, z: 48, w: 25, d: 25, color: '#527d48' },
  { key: 'school', label: '学校', x: 48, z: -48, w: 25, d: 25, color: '#8c7855' },
  { key: 'stadium', label: '体育场', x: 48, z: -16, w: 25, d: 25, color: '#668653' },
  { key: 'police', label: '公安局', x: 16, z: 48, w: 22, d: 24, color: '#637587' },
  { key: 'prison', label: '监狱', x: -48, z: -48, w: 25, d: 25, color: '#686b68' },
  { key: 'fire', label: '消防局', x: -16, z: -48, w: 22, d: 24, color: '#8b5648' },
  { key: 'factory', label: '工厂区域', x: -75, z: -48, w: 16, d: 25, color: '#756b58' },
  { key: 'workshop', label: '作坊区', x: -48, z: -16, w: 25, d: 24, color: '#80684c' },
  { key: 'office', label: '写字楼', x: 48, z: 48, w: 25, d: 25, color: '#61747b' },
  { key: 'apartment', label: '居民楼', x: 48, z: 16, w: 25, d: 24, color: '#807768' },
  { key: 'villas', label: '别墅群', x: -48, z: 75, w: 25, d: 18, color: '#73805b' },
  { key: 'farm', label: '农田区域', x: 75, z: 48, w: 16, d: 25, color: '#8b7747' },
  { key: 'farmWest', label: '农田区域', x: -75, z: 48, w: 16, d: 25, color: '#8b7747' },
  { key: 'community', label: '社区住宅', x: -48, z: 16, w: 24, d: 23, color: '#75806a' },
  { key: 'parking', label: '公共停车场', x: 75, z: -16, w: 16, d: 22, color: '#686d6d' },
  { key: 'logistics', label: '物流仓储', x: -75, z: -75, w: 16, d: 18, color: '#716d5e' },
  { key: 'station', label: '火车站', x: -48, z: -75, w: 25, d: 18, color: '#657782' },
  { key: 'park', label: '城北绿地', x: 16, z: 75, w: 22, d: 18, color: '#527d48' },
  { key: 'community', label: '城南住宅', x: -16, z: -75, w: 22, d: 18, color: '#75806a' },
];

for (const zone of CITY_ZONES) {
  zone.x = Math.max(-220, Math.min(220, Math.round(zone.x * 3.125)));
  zone.z = Math.max(-220, Math.min(220, Math.round(zone.z * 3.125)));
  if (Math.abs(zone.x) > 180) zone.w = Math.min(zone.w, 18);
  if (Math.abs(zone.z) > 180) zone.d = Math.min(zone.d, 18);
}

const INFILL_NAMES = ['综合市场', '社区服务中心', '商住混合区', '仓储配套区', '工匠作坊', '城市公寓'];
const BLOCK_CENTERS = [-220, -150, -50, 50, 150, 220];
let infillIndex = 0;
for (const x of BLOCK_CENTERS) for (const z of BLOCK_CENTERS) {
  if (Math.abs(x) < 75 && Math.abs(z) < 75) continue; // 中央广场、池塘、花园和建造地块
  if (CITY_ZONES.some(zone => Math.hypot(zone.x - x, zone.z - z) < 12)) continue;
  CITY_ZONES.push({
    key: 'infill', label: INFILL_NAMES[infillIndex % INFILL_NAMES.length], variant: infillIndex++,
    x, z, w: Math.abs(x) > 180 || Math.abs(z) > 180 ? 18 : 78,
    d: Math.abs(x) > 180 || Math.abs(z) > 180 ? 18 : 78, color: '#6f776c',
  });
}

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
  const dummy = new THREE.Object3D();
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
    const result = baseHouse(group, x, z, w, d, h, { ...opts, noRoadClamp: true });
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
    const glass = mat(0x8ca6b3);
    box(group, w, height, d, wall, x, height / 2, z);
    box(group, w + 0.35, 0.3, d + 0.35, m.stoneDk, x, height + 0.15, z);
    box(group, 1.5, 2.2, 0.12, glass, x, 1.1, z - d / 2 - 0.07);
    box(group, 3.2, 0.16, 1.2, m.stoneLt, x, 2.35, z - d / 2 - 0.55);
    for (let floor = 0; floor < floors; floor++) {
      const y = 1.4 + floor * ((height - 1.2) / floors);
      box(group, w + 0.08, 0.09, d + 0.08, m.stoneLt, x, y - 0.65, z);
      for (const wx of [-0.3, 0, 0.3]) {
        box(group, w * 0.17, 0.75, 0.05, glass, x + wx * w, y, z - d / 2 - 0.03);
        box(group, w * 0.17, 0.75, 0.05, glass, x + wx * w, y, z + d / 2 + 0.03);
        if (floor > 0 && floors <= 6) {
          box(group, w * 0.2, 0.09, 0.65, m.stoneLt, x + wx * w, y - 0.48, z - d / 2 - 0.34);
          box(group, w * 0.2, 0.45, 0.04, glass, x + wx * w, y - 0.25, z - d / 2 - 0.64);
        }
      }
      for (const wz of [-0.27, 0.27]) {
        box(group, 0.05, 0.75, d * 0.2, glass, x - w / 2 - 0.03, y, z + wz * d);
        box(group, 0.05, 0.75, d * 0.2, glass, x + w / 2 + 0.03, y, z + wz * d);
      }
    }
    for (const rx of [-w * 0.25, w * 0.25]) box(group, 1.1, 0.55, 0.8, m.stoneDk, x + rx, height + 0.55, z);
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
    add(group, new THREE.CylinderGeometry(2, 2.2, 0.45, 24), m.stoneLt, 0, 0.23, 0);
    add(group, new THREE.CylinderGeometry(1.65, 1.65, 0.12, 24), m.water, 0, 0.48, 0);
    add(group, new THREE.CylinderGeometry(0.18, 0.28, 1.5, 12), m.stoneLt, 0, 1.1, 0);
    box(group, 2.4, 0.12, 1.2, mat(0xb75b45), 8, 1.4, 6);
    box(group, 0.12, 1.4, 0.12, m.woodDark, 7, 0.7, 6);
    box(group, 0.12, 1.4, 0.12, m.woodDark, 9, 0.7, 6);
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
    groundBox(group, 15, 25, mat(0x777064), 0, 0);
    for (const x of [-3.5, 3.5]) {
      box(group, 5.5, 4.5, 13, mat(0x8a806d), x, 2.25, 0);
      box(group, 6, 0.35, 13.5, m.roofGrey, x, 4.65, 0);
      box(group, 2.6, 3, 0.12, m.woodDark, x, 1.5, -6.55);
      collider(x, 0, 5.5, 13, 4.8, 'house');
    }
    for (const x of [-5.5, 5.5]) add(group, new THREE.CylinderGeometry(0.65, 0.9, 13, 12), mat(0x66564b), x, 6.5, 8);
  }

  function fields(group) {
    for (const [x,z] of [[-3.5,-6],[3.5,-6],[-3.5,5],[3.5,5]]) {
      groundBox(group, 5.5, 9, m.dirt, x, z);
      for (let row = -2; row <= 2; row++) box(group, 0.3, 0.35, 8.2, mat(0x66813e), x + row, 0.22, z);
    }
    buildHouse(group, 0, 10, 5, 3, 4.2, { stories: 1, roofMat: m.roofBrown, lanterns: false });
  }

  function denseModule(group, zone) {
    const grid = zone.w >= 70 ? 8 : 4;
    const pitch = grid === 8 ? 9 : 4.4;
    const count = grid * grid;
    groundBox(group, zone.w, zone.d, mat(0x7c8175), 0, 0);
    const bodyMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.88 });
    disposables.materials.push(bodyMaterial);
    const bodies = new THREE.InstancedMesh(trackGeo(new THREE.BoxGeometry(1, 1, 1)), bodyMaterial, count);
    const roofs = new THREE.InstancedMesh(trackGeo(new THREE.ConeGeometry(1, 1, 4)), m.roofBlue, count);
    const colors = [0x9b8d7a, 0x7f9195, 0x9a8175, 0x7e8876, 0x8e8297, 0xa0947e];
    for (let row = 0; row < grid; row++) for (let col = 0; col < grid; col++) {
      const i = row * grid + col;
      const x = (col - (grid - 1) / 2) * pitch;
      const z = (row - (grid - 1) / 2) * pitch;
      const height = 4.5 + ((i + zone.variant) % 5) * 1.7;
      const width = grid === 8 ? 6.7 : 3.8;
      dummy.position.set(x, height / 2, z); dummy.rotation.set(0, 0, 0); dummy.scale.set(width, height, width); dummy.updateMatrix(); bodies.setMatrixAt(i, dummy.matrix);
      bodies.setColorAt(i, new THREE.Color(colors[(i + zone.variant) % colors.length]));
      dummy.position.y = height + 1.0; dummy.rotation.y = Math.PI / 4; dummy.scale.set(width * 0.72, 2, width * 0.72); dummy.updateMatrix(); roofs.setMatrixAt(i, dummy.matrix);
    }
    bodies.instanceMatrix.needsUpdate = roofs.instanceMatrix.needsUpdate = true;
    bodies.instanceColor.needsUpdate = true;
    bodies.castShadow = roofs.castShadow = false; bodies.receiveShadow = roofs.receiveShadow = true;
    group.add(bodies, roofs);
    collider(0, 0, zone.w - 3, zone.d - 3, 3, 'house');
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
      buildHouse(group, -10, 2, 4, 9, 5.4, { stories: 2, roofMat: m.roofBrown, lanterns: false });
      groundBox(group, 18, 9, mat(0x72945c), 0, 6);
      for (const x of [-6, 6]) {
        add(group, new THREE.CylinderGeometry(0.08, 0.08, 3, 6), m.woodDark, x, 1.5, 7);
        box(group, 1.6, 0.9, 0.08, m.stoneLt, x, 2.6, 7);
        add(group, new THREE.TorusGeometry(0.28, 0.035, 6, 12), mat(0xb85b38), x, 2.3, 6.65);
      }
    } else if (zone.key === 'police') {
      buildHouse(group, 0, 2, 13, 8, 5.4, { stories: 2, roofMat: m.roofGrey, wallMat: m.stoneLt, lanterns: false });
      box(group, 12, 0.25, 0.25, mat(0x365a80), 0, 1.1, -7);
      for (const x of [-4, 4]) {
        box(group, 2.1, 0.65, 4.2, mat(0xe5e7e8), x, 0.55, -7);
        box(group, 2.0, 0.25, 1.1, mat(0x365a80), x, 0.85, -7);
      }
    } else if (zone.key === 'fire') {
      buildHouse(group, 0, 2, 13, 8, 5.4, { stories: 2, roofMat: m.roofGrey, wallMat: mat(0xa85c4b), lanterns: false });
      for (const x of [-3, 0, 3]) box(group, 2.4, 2.5, 0.12, m.woodDark, x, 1.25, -2.05);
      box(group, 2.5, 10, 2.5, mat(0xa85c4b), 7, 5, 5);
      box(group, 2.3, 1.2, 5.4, mat(0xc54335), -5, 0.9, -7);
      box(group, 2.1, 1.2, 1.8, mat(0xe4e8e9), -5, 1.5, -8.4);
      box(group, 0.35, 0.35, 4.2, m.stoneLt, -5, 2.25, -6.8);
    } else if (zone.key === 'workshop') {
      for (const [x,z] of [[-6,-5],[6,-5],[-6,5],[6,5]]) buildHouse(group, x, z, 6, 5, 4.4, { stories: 1, roofMat: m.roofBrown });
      for (const x of [-6,6]) add(group, new THREE.CylinderGeometry(0.35, 0.5, 5, 8), m.stoneDk, x, 2.5, 9);
      for (const [x,z] of [[-1,-7],[1,-7],[-1,8],[1,8]]) box(group, 1.4, 1.1, 1.4, m.wood, x, 0.55, z);
    } else if (zone.key === 'infill') {
      denseModule(group, zone);
    } else if (zone.key === 'community') {
      for (const [x,z] of [[-7,-4],[0,-4],[7,-4],[-7,4],[0,4],[7,4]]) {
        groundBox(group, 6.2, 7, mat(0x6f8b57), x, z);
        buildHouse(group, x, z, 5, 4, 4.4, { stories: 1, roofMat: m.roofBrown });
      }
    } else if (zone.key === 'parking') {
      groundBox(group, 15, 21, m.asphalt, 0, 0);
      for (const z of [-7,-3,1,5]) for (const x of [-4,0,4]) {
        box(group, 0.09, 0.02, 3, m.stoneLt, x - 1.6, 0.08, z);
        if ((x + z) % 3) box(group, 1.6, 0.7, 3.2, mat(0x55768a), x, 0.4, z);
      }
    } else if (zone.key === 'logistics') {
      groundBox(group, 15, 17, mat(0x777064), 0, 0);
      for (const x of [-3.5,3.5]) {
        box(group, 5.5, 4, 11, mat(0x8a806d), x, 2, 0);
        box(group, 6, 0.3, 11.5, m.roofGrey, x, 4.15, 0);
        collider(x, 0, 5.5, 11, 4.3, 'house');
      }
    } else if (zone.key === 'station') {
      buildHouse(group, 0, 2, 17, 6, 5.4, { stories: 2, roofMat: m.roofGrey, wallMat: m.stoneLt, lanterns: false });
      groundBox(group, 24, 4, m.cement, 0, -4);
      for (const z of [-7,-5.5]) box(group, 25, 0.12, 0.12, m.stoneDk, 0, 0.12, z);
      for (let x = -12; x <= 12; x += 1.2) box(group, 0.18, 0.08, 2.4, m.woodDark, x, 0.06, -6.25);
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
