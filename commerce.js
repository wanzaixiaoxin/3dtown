import * as THREE from 'three';
import { CONFIG, angle } from './config.js';
import { M, trackGeo, disposables } from './materials.js';

const CC = CONFIG.commerce;
const TYPES = CC.types;

export const SHOPS = [];
for (const side of [-1, 1]) {
  CC.zPositions.forEach((z, i) => {
    const x = side * CC.xOffset;
    if (Math.hypot(x - CC.exclusion.x, z - CC.exclusion.z) < CC.exclusion.r) return;
    const type = TYPES[(i + (side > 0 ? CC.eastTypeShift : 0)) % TYPES.length];
    SHOPS.push({
      id: `${side < 0 ? 'west' : 'east'}-${z}`,
      side, x, z, ...type,
      rotY: side < 0 ? angle('-PI/2') : angle('PI/2'),
      keeper: { x: side * CC.keeper.xOffset, z: z + CC.keeper.zOffset },
      customer: { x: side * CC.customer.xOffset, z: z + CC.customer.zOffset },
    });
  });
}

function signTexture(text, color) {
  const canvas = document.createElement('canvas');
  canvas.width = 512; canvas.height = 160;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#2b1c13'; ctx.fillRect(0, 0, 512, 160);
  ctx.strokeStyle = color; ctx.lineWidth = 12; ctx.strokeRect(10, 10, 492, 140);
  ctx.fillStyle = '#f2dfb4';
  ctx.font = 'bold 66px "Songti SC", "SimSun", serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(text, 256, 82);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  disposables.textures.push(texture);
  return texture;
}

export function buildCommerce(parent, colliders, buildBanner) {
  const m = M();
  const materialCache = new Map();
  const mat = color => {
    if (!materialCache.has(color)) {
      const material = new THREE.MeshStandardMaterial({ color, roughness: 0.88 });
      materialCache.set(color, material);
      disposables.materials.push(material);
    }
    return materialCache.get(color);
  };
  const addMesh = (group, geometry, material, x, y, z) => {
    const mesh = new THREE.Mesh(trackGeo(geometry), material);
    mesh.position.set(x, y, z);
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  };
  const addBox = (group, w, h, d, material, x, y, z) => addMesh(group, new THREE.BoxGeometry(w, h, d), material, x, y, z);

  function addGoods(group, sign, color) {
    const goodsMat = mat(color);
    if (sign === '酒' || sign === '瓷') {
      for (const x of [-0.65, 0, 0.65]) {
        addMesh(group, new THREE.CylinderGeometry(0.13, 0.19, 0.4, 8), goodsMat, x, 1.12, -2.2);
        addMesh(group, new THREE.CylinderGeometry(0.07, 0.09, 0.12, 8), goodsMat, x, 1.37, -2.2);
      }
    } else if (sign === '布') {
      for (const [i, c] of [0x9d5151, 0x557a9b, 0xb39450].entries()) {
        const roll = addMesh(group, new THREE.CylinderGeometry(0.14, 0.14, 0.65, 10), mat(c), -0.65 + i * 0.65, 1.06, -2.2);
        roll.rotation.z = Math.PI / 2;
      }
    } else if (sign === '书') {
      for (let i = 0; i < 4; i++) addBox(group, 0.62, 0.08, 0.4, mat(i % 2 ? 0x77503c : 0x4f6684), -0.5 + i * 0.34, 0.97 + i * 0.08, -2.2);
    } else if (sign === '米') {
      for (const x of [-0.55, 0, 0.55]) {
        const sack = addMesh(group, new THREE.SphereGeometry(0.24, 8, 6), mat(0xc5ac79), x, 1.08, -2.2);
        sack.scale.y = 1.35;
      }
    } else {
      for (const x of [-0.55, 0, 0.55]) addBox(group, 0.38, 0.25, 0.34, goodsMat, x, 1.03, -2.2);
    }
  }

  for (const [index, shop] of SHOPS.entries()) {
    const g = new THREE.Group();
    g.position.set(shop.x, 0, shop.z);
    g.rotation.y = shop.rotY;
    const accent = mat(shop.color);
    addBox(g, 2.25, 0.7, 0.12, m.woodDark, 0, 3.05, -1.82);
    const signMat = new THREE.MeshStandardMaterial({ map: signTexture(shop.name, shop.color), roughness: 0.85, side: THREE.FrontSide });
    disposables.materials.push(signMat);
    const sign = addMesh(g, new THREE.PlaneGeometry(2.05, 0.58), signMat, 0, 3.05, -1.89);
    sign.rotation.y = Math.PI;
    const signBack = sign.clone();
    signBack.rotation.y = 0;
    signBack.position.z += 0.01;
    g.add(signBack);
    const awning = addBox(g, 5.05, 0.09, 1.25, accent, 0, 3.35, -2.25);
    awning.rotation.x = -0.12;
    addBox(g, 2.5, 0.78, 0.65, m.wood, 0, 0.45, -2.2);
    addBox(g, 2.65, 0.12, 0.78, m.woodDark, 0, 0.9, -2.2);
    addGoods(g, shop.sign, shop.color);
    addBox(g, 0.58, 0.58, 0.58, m.wood, 1.85, 0.3, -2.15);
    addBox(g, 0.52, 0.52, 0.52, m.wood, 1.85, 0.85, -2.15);
    addMesh(g, new THREE.CylinderGeometry(0.23, 0.18, 0.4, 8), mat(0x9b5d3f), -1.85, 0.22, -2.15);
    addMesh(g, new THREE.SphereGeometry(0.36, 8, 6), mat(0x557e46), -1.85, 0.62, -2.15);
    parent.add(g);

    const counterX = shop.x + (shop.side < 0 ? 0.55 : -0.55);
    colliders.push({ minX: counterX - 0.45, maxX: counterX + 0.45, minZ: shop.z - 1.45, maxZ: shop.z + 1.45, top: 0.95, kind: 'prop' });
    if (index % 2 === 0) buildBanner(parent, shop.side * 6.4, shop.z, shop.sign, shop.side < 0 ? 0 : Math.PI);
  }

  const stalls = [
    [-5.65, -28, '茶', '#3f7054'], [5.65, -21.5, '米', '#a37b35'],
    [-5.65, -15, '酒', '#9e3f32'], [5.65, 15, '瓷', '#39747b'],
    [-5.65, 28, '布', '#526b9d'], [5.65, 34, '药', '#527443'],
  ];
  for (const [x, z, sign, color] of stalls) {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    const accent = mat(color);
    for (const px of [-0.95, 0.95]) for (const pz of [-0.55, 0.55]) addBox(g, 0.07, 2.1, 0.07, m.woodDark, px, 1.05, pz);
    addBox(g, 2.25, 0.1, 1.5, accent, 0, 2.15, 0);
    addBox(g, 1.95, 0.72, 0.85, m.wood, 0, 0.38, 0);
    addBox(g, 2.05, 0.1, 0.95, m.woodDark, 0, 0.78, 0);
    for (const px of [-0.55, 0, 0.55]) addMesh(g, new THREE.CylinderGeometry(0.14, 0.19, 0.34, 8), accent, px, 1.0, 0);
    parent.add(g);
    colliders.push({ minX: x - 1.15, maxX: x + 1.15, minZ: z - 0.8, maxZ: z + 0.8, top: 2.2, kind: 'prop' });
  }

  const cart = new THREE.Group();
  cart.position.set(3.1, 0, 38.5);
  addBox(cart, 1.6, 0.55, 2.1, m.wood, 0, 0.72, 0);
  for (const x of [-0.88, 0.88]) {
    const wheel = addMesh(cart, new THREE.CylinderGeometry(0.48, 0.48, 0.12, 12), m.woodDark, x, 0.48, 0.25);
    wheel.rotation.z = Math.PI / 2;
  }
  addBox(cart, 0.65, 0.65, 0.65, m.wood, -0.35, 1.3, 0.25);
  addBox(cart, 0.6, 0.6, 0.6, m.wood, 0.35, 1.25, -0.35);
  parent.add(cart);
  colliders.push({ minX: 2.1, maxX: 4.1, minZ: 37.2, maxZ: 39.8, top: 1.7, kind: 'prop' });
}

// ===========================================================================
//  buildStandaloneShop — placeable single shopfront for the builder module.
//  Mirrors buildCommerce's storefront look (sign, awning, counter, goods)
//  but returns a self-contained Group; registers NO collider itself — the
//  caller (builder.js) owns collider lifecycle so delete/undo stays clean.
//  Returns { group, footprint } (footprint = AABB half sizes for colliders).
// ===========================================================================
export function buildStandaloneShop(signChar, rotY = 0) {
  const m = M();
  const type = TYPES.find(t => t.sign === signChar) || TYPES[0];
  const g = new THREE.Group();
  g.rotation.y = rotY;

  const mat = color => new THREE.MeshStandardMaterial({ color, roughness: 0.88 });
  const accent = mat(type.color);
  const addMesh = (geometry, material, x, y, z) => {
    const mesh = new THREE.Mesh(trackGeo(geometry), material);
    mesh.position.set(x, y, z);
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    g.add(mesh);
    return mesh;
  };
  const addBox = (w, h, d, material, x, y, z) => addMesh(new THREE.BoxGeometry(w, h, d), material, x, y, z);

  // signboard + hanging shop sign (faces -z, matching street shops)
  addBox(2.25, 0.7, 0.12, m.woodDark, 0, 3.05, -1.82);
  const signMat = new THREE.MeshStandardMaterial({ map: signTexture(type.name, type.color), roughness: 0.85, side: THREE.FrontSide });
  disposables.materials.push(signMat);
  const sign = addMesh(new THREE.PlaneGeometry(2.05, 0.58), signMat, 0, 3.05, -1.89);
  sign.rotation.y = Math.PI;
  sign.name = 'shopSign';
  const signBack = sign.clone();
  signBack.rotation.y = 0;
  signBack.position.z += 0.01;
  g.add(signBack);
  const awning = addBox(5.05, 0.09, 1.25, accent, 0, 3.35, -2.25);
  awning.rotation.x = -0.12;
  awning.name = 'shopAwning';
  // counter + display shelf + goods by trade
  addBox(2.5, 0.78, 0.65, m.wood, 0, 0.45, -2.2);
  addBox(2.65, 0.12, 0.78, m.woodDark, 0, 0.9, -2.2);
  addBox(5.2, 2.9, 0.15, m.woodDark, 0, 1.55, -2.62);
  addBox(5.2, 0.1, 0.5, m.wood, 0, 1.05, -2.4);
  const goodsMat = mat(type.color);
  if (type.sign === '酒' || type.sign === '瓷') {
    for (const x of [-0.65, 0, 0.65]) {
      addMesh(new THREE.CylinderGeometry(0.13, 0.19, 0.4, 8), goodsMat, x, 1.12, -2.2);
      addMesh(new THREE.CylinderGeometry(0.07, 0.09, 0.12, 8), goodsMat, x, 1.37, -2.2);
    }
  } else if (type.sign === '布') {
    for (const [i, c] of [0x9d5151, 0x557a9b, 0xb39450].entries()) {
      const roll = addMesh(new THREE.CylinderGeometry(0.14, 0.14, 0.65, 10), mat(c), -0.65 + i * 0.65, 1.06, -2.2);
      roll.rotation.z = Math.PI / 2;
    }
  } else if (type.sign === '书') {
    for (let i = 0; i < 4; i++) addBox(0.62, 0.08, 0.4, mat(i % 2 ? 0x77503c : 0x4f6684), -0.5 + i * 0.34, 0.97 + i * 0.08, -2.2);
  } else if (type.sign === '米') {
    for (const x of [-0.55, 0, 0.55]) {
      const sack = addMesh(new THREE.SphereGeometry(0.24, 8, 6), mat(0xc5ac79), x, 1.08, -2.2);
      sack.scale.y = 1.35;
    }
  } else {
    for (const x of [-0.55, 0, 0.55]) addBox(0.38, 0.25, 0.34, goodsMat, x, 1.03, -2.2);
  }
  addBox(0.58, 0.58, 0.58, m.wood, 1.85, 0.3, -2.15);
  addBox(0.52, 0.52, 0.52, m.wood, 1.85, 0.85, -2.15);
  addMesh(new THREE.CylinderGeometry(0.23, 0.18, 0.4, 8), mat(0x9b5d3f), -1.85, 0.22, -2.15);
  addMesh(new THREE.SphereGeometry(0.36, 8, 6), mat(0x557e46), -1.85, 0.62, -2.15);

  return { group: g, footprint: { hw: 2.75, hd: 1.35, top: 3.5 } };
}
