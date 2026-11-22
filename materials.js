// ============================================================================
//  materials.js — shared materials, tracked for disposal
//  Includes procedurally-generated (canvas) detail textures for realism.
// ============================================================================
import * as THREE from 'three';

export const disposables = { geometries: [], materials: [], textures: [] };

// PBR texture sets injected from textures.js (ambientCG, CC0).
let PBR = null;
export function setPBRTextures(sets) {
  PBR = sets;
  if (_mat) { _mat = null; }   // force rebuild with real maps
}

// clone a map with its own repeat (textures are shared images)
function pbrMap(setKey, kind, repeat = 2) {
  if (!PBR || !PBR[setKey] || !PBR[setKey][kind]) return null;
  const t = PBR[setKey][kind].clone();
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.needsUpdate = true;
  disposables.textures.push(t);
  return t;
}

let _mat = null;
export function trackGeo(g) { disposables.geometries.push(g); return g; }
function trackTex(t) { disposables.textures.push(t); return t; }

function std(opts) {
  const m = new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0.0, ...opts });
  disposables.materials.push(m);
  return m;
}

// ---- procedural canvas textures -------------------------------------------
function makeCanvas(size = 256) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return { c, ctx: c.getContext('2d') };
}
function toTex(c, repeat = 4, anisotropy = 4) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = anisotropy;
  return trackTex(t);
}

// grass detail: green base + many short blades of varied hue
export function grassTexture(repeat = 14) {
  const { c, ctx } = makeCanvas(512);
  ctx.fillStyle = '#5f8a44';
  ctx.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 9000; i++) {
    const x = Math.random() * 512, y = Math.random() * 512;
    const g = 90 + Math.random() * 90;
    const r = 40 + Math.random() * 40;
    const b = 30 + Math.random() * 40;
    ctx.strokeStyle = `rgb(${r|0},${g|0},${b|0})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + (Math.random() - 0.5) * 5, y - 3 - Math.random() * 5);
    ctx.stroke();
  }
  // subtle patches
  for (let i = 0; i < 60; i++) {
    ctx.fillStyle = `rgba(${60+Math.random()*40|0},${110+Math.random()*40|0},50,0.12)`;
    ctx.beginPath();
    ctx.arc(Math.random()*512, Math.random()*512, 20+Math.random()*50, 0, Math.PI*2);
    ctx.fill();
  }
  return toTex(c, repeat);
}

// stone paving: grey blocks with mortar lines + grain
export function stoneTexture(repeat = 8) {
  const { c, ctx } = makeCanvas(512);
  ctx.fillStyle = '#8c8579';
  ctx.fillRect(0, 0, 512, 512);
  const rowH = 64;
  for (let ry = 0; ry < 512; ry += rowH) {
    const offset = ((ry / rowH) % 2) * 64;
    for (let rx = -64 + offset; rx < 512; rx += 128) {
      const v = 120 + Math.random() * 40;
      ctx.fillStyle = `rgb(${v|0},${(v-6)|0},${(v-14)|0})`;
      ctx.fillRect(rx + 3, ry + 3, 128 - 6, rowH - 6);
      // grain speckles
      for (let s = 0; s < 40; s++) {
        ctx.fillStyle = `rgba(60,58,52,${0.05+Math.random()*0.12})`;
        ctx.fillRect(rx + 3 + Math.random()*120, ry + 3 + Math.random()*(rowH-6), 2, 2);
      }
    }
  }
  // mortar
  ctx.strokeStyle = 'rgba(50,48,42,0.5)';
  ctx.lineWidth = 3;
  for (let ry = 0; ry <= 512; ry += rowH) { ctx.beginPath(); ctx.moveTo(0, ry); ctx.lineTo(512, ry); ctx.stroke(); }
  return toTex(c, repeat);
}

// wood grain
export function woodTexture(baseR = 120, baseG = 78, baseB = 48) {
  const { c, ctx } = makeCanvas(256);
  ctx.fillStyle = `rgb(${baseR},${baseG},${baseB})`;
  ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 60; i++) {
    const y = Math.random() * 256;
    ctx.strokeStyle = `rgba(${baseR*0.6|0},${baseG*0.6|0},${baseB*0.6|0},${0.06+Math.random()*0.15})`;
    ctx.lineWidth = 0.5 + Math.random() * 1.5;
    ctx.beginPath();
    ctx.moveTo(0, y);
    for (let x = 0; x <= 256; x += 16) ctx.lineTo(x, y + Math.sin(x * 0.05 + i) * 2);
    ctx.stroke();
  }
  return toTex(c, 2);
}

// roof tile: rows of curved tiles with ridges
export function roofTexture(base = '#394b57', repeat = 6) {
  const { c, ctx } = makeCanvas(256);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, 256, 256);
  const colW = 16;
  for (let x = 0; x < 256; x += colW) {
    const grad = ctx.createLinearGradient(x, 0, x + colW, 0);
    grad.addColorStop(0, 'rgba(255,255,255,0.14)');
    grad.addColorStop(0.5, 'rgba(0,0,0,0.05)');
    grad.addColorStop(1, 'rgba(0,0,0,0.28)');
    ctx.fillStyle = grad;
    ctx.fillRect(x, 0, colW, 256);
  }
  // horizontal tile seams
  ctx.strokeStyle = 'rgba(0,0,0,0.22)';
  for (let y = 0; y < 256; y += 24) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(256, y); ctx.stroke(); }
  return toTex(c, repeat);
}

// plaster: warm off-white with subtle mottling
export function plasterTexture() {
  const { c, ctx } = makeCanvas(256);
  ctx.fillStyle = '#efe6d2';
  ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 2500; i++) {
    ctx.fillStyle = `rgba(${180+Math.random()*40|0},${170+Math.random()*40|0},${150+Math.random()*40|0},${0.05+Math.random()*0.12})`;
    ctx.beginPath(); ctx.arc(Math.random()*256, Math.random()*256, 1+Math.random()*3, 0, Math.PI*2); ctx.fill();
  }
  for (let i = 0; i < 40; i++) {
    ctx.strokeStyle = `rgba(150,140,120,${0.03+Math.random()*0.05})`;
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(Math.random()*256, Math.random()*256);
    ctx.lineTo(Math.random()*256, Math.random()*256); ctx.stroke();
  }
  return toTex(c, 3);
}

// lattice window: dark frame + warm panes (used as map + emissiveMap)
export function latticeTexture() {
  const { c, ctx } = makeCanvas(128);
  ctx.fillStyle = '#2a2018'; ctx.fillRect(0, 0, 128, 128);
  const cols = 4, rows = 5;
  const pw = 128 / cols, ph = 128 / rows;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      ctx.fillStyle = '#ffd79a';
      ctx.fillRect(x * pw + 3, y * ph + 3, pw - 6, ph - 6);
    }
  }
  ctx.strokeStyle = '#1d1510'; ctx.lineWidth = 4;
  for (let x = 0; x <= cols; x++) { ctx.beginPath(); ctx.moveTo(x * pw, 0); ctx.lineTo(x * pw, 128); ctx.stroke(); }
  for (let y = 0; y <= rows; y++) { ctx.beginPath(); ctx.moveTo(0, y * ph); ctx.lineTo(128, y * ph); ctx.stroke(); }
  return toTex(c, 1);
}

// Create-or-get shared material set (lazy singleton).
export function M() {
  if (_mat) return _mat;

  const grassTex = grassTexture(60);
  const stoneTex = stoneTexture(3);
  const stoneRoadTex = stoneTexture(30);
  const stoneWallTex = stoneTexture(28);
  const woodTex = woodTexture(120, 78, 48);
  const woodDarkTex = woodTexture(66, 40, 26);

  const plasterTex = plasterTexture();
  _mat = {
    plaster:     std({
      color: 0xffffff, roughness: 0.95,
      map: pbrMap('plaster', 'color', 2) || plasterTex,
      normalMap: pbrMap('plaster', 'normal', 2),
      roughnessMap: pbrMap('plaster', 'rough', 2),
      normalScale: new THREE.Vector2(0.5, 0.5),
    }),
    plasterWarm: std({
      color: 0xfff2dd, roughness: 0.95,
      map: pbrMap('plaster', 'color', 2) || plasterTex,
      normalMap: pbrMap('plaster', 'normal', 2),
      roughnessMap: pbrMap('plaster', 'rough', 2),
      normalScale: new THREE.Vector2(0.5, 0.5),
    }),
    wood:        std({
      color: 0xffffff, roughness: 0.75,
      map: pbrMap('wood_plank', 'color', 2) || woodTex,
      normalMap: pbrMap('wood_plank', 'normal', 2),
      roughnessMap: pbrMap('wood_plank', 'rough', 2),
    }),
    woodDark:    std({
      color: 0xc9a888, roughness: 0.8,
      map: pbrMap('wood_plank', 'color', 2) || woodDarkTex,
      normalMap: pbrMap('wood_plank', 'normal', 2),
      roughnessMap: pbrMap('wood_plank', 'rough', 2),
    }),
    woodRed:     std({
      color: 0xb2543f, roughness: 0.62,
      map: pbrMap('wood_plank', 'color', 2) || woodTex,
      normalMap: pbrMap('wood_plank', 'normal', 2),
      roughnessMap: pbrMap('wood_plank', 'rough', 2),
    }),
    roofBlue:    std({
      color: 0x64798a, roughness: 0.9, metalness: 0.0,
      map: pbrMap('roof_tile', 'color', 3) || roofTexture('#5a7183', 3),
      normalMap: pbrMap('roof_tile', 'normal', 3),
      normalScale: new THREE.Vector2(1.1, 1.1),
    }),
    roofBrown:   std({
      color: 0x8f6244, roughness: 0.92, metalness: 0.0,
      map: pbrMap('roof_tile', 'color', 3) || roofTexture('#7a5238', 3),
      normalMap: pbrMap('roof_tile', 'normal', 3),
    }),
    roofGrey:    std({
      color: 0x778088, roughness: 0.9, metalness: 0.0,
      map: pbrMap('roof_tile', 'color', 3) || roofTexture('#6d757d', 3),
      normalMap: pbrMap('roof_tile', 'normal', 3),
    }),
    stone:       std({
      color: 0xffffff, roughness: 0.9,
      map: pbrMap('granite', 'color', 2) || stoneTex,
      normalMap: pbrMap('granite', 'normal', 2),
    }),
    stoneLt:     std({
      color: 0xf2ece2, roughness: 1.0, envMapIntensity: 0.22,
      map: pbrMap('granite', 'color', 2) || stoneTex,
      normalMap: pbrMap('granite', 'normal', 2),
    }),
    stoneDk:     std({
      color: 0xb9b2a6, roughness: 1.0,
      map: pbrMap('granite', 'color', 2) || stoneTex,
      normalMap: pbrMap('granite', 'normal', 2),
    }),
    cobble:      std({
      color: 0xd8d2c6, roughness: 0.98,
      map: pbrMap('stone_paving', 'color', 4) || stoneTex,
      normalMap: pbrMap('stone_paving', 'normal', 4),
    }),
    roadStone:   std({
      color: 0xd6dade, roughness: 0.98, metalness: 0.0, envMapIntensity: 0.35,
      map: pbrMap('stone_paving', 'color', 18) || stoneRoadTex,
      normalMap: pbrMap('stone_paving', 'normal', 18),
      normalScale: new THREE.Vector2(0.8, 0.8),
    }),
    asphalt:     std({ color: 0x41464a, roughness: 0.96, metalness: 0, envMapIntensity: 0.08 }),
    cement:      std({ color: 0x9a9d9c, roughness: 1.0, metalness: 0, envMapIntensity: 0.1 }),
    wallStone:   std({
      color: 0xb9bfc2, roughness: 1.0, envMapIntensity: 0.18,
      map: pbrMap('brick', 'color', 14) || stoneWallTex,
      normalMap: pbrMap('brick', 'normal', 14),
    }),
    gold:        std({ color: 0xd8b25a, roughness: 0.35, metalness: 0.65 }),
    leaf:        std({ color: 0x5f8f4a, roughness: 0.92 }),
    leaf2:       std({ color: 0x496f36, roughness: 0.92 }),
    leaf3:       std({ color: 0x6fa054, roughness: 0.92 }),
    trunk:       std({ color: 0xffffff, roughness: 1.0, map: woodDarkTex }),
    grass:       std({ color: 0x7aa855, roughness: 1.0 }),
    grassDark:   std({ color: 0xffffff, roughness: 1.0, map: grassTex }),
    dirt:        std({ color: 0x8a7355, roughness: 1.0 }),
    water:       std({ color: 0x2f5d72, roughness: 0.9, metalness: 0.0, transparent: true, opacity: 0.93, envMapIntensity: 0.08 }),
    skin:        std({ color: 0xd8a97f, roughness: 0.85 }),
    windowLit:   std({
      color: 0xffffff, emissive: 0xffb04a, emissiveIntensity: 0.0, roughness: 0.65,
      map: latticeTexture(), emissiveMap: latticeTexture(),
    }),
    lantern:     std({ color: 0xd23b2b, emissive: 0xff5a2a, emissiveIntensity: 0.0, roughness: 0.5 }),
    lampGlow:    std({ color: 0x3a2f20, emissive: 0xffc46a, emissiveIntensity: 0.0, roughness: 0.6 }),
    // garden / flora
    petalPink:   std({ color: 0xe89ab5, roughness: 0.8 }),
    petalRed:    std({ color: 0xd0556a, roughness: 0.8 }),
    petalYellow: std({ color: 0xf0cf5a, roughness: 0.8 }),
    petalWhite:  std({ color: 0xf4ece0, roughness: 0.8 }),
    flowerStem:  std({ color: 0x4f7a3a, roughness: 0.9 }),
    willowLeaf:  std({ color: 0x8fb85e, roughness: 0.9 }),
    rock:        std({ color: 0x9a938a, roughness: 1.0, flatShading: true }),
    rockDark:    std({ color: 0x76706a, roughness: 1.0, flatShading: true }),
    moss:        std({ color: 0x6a8a4a, roughness: 1.0 }),
    pavilionRed: std({ color: 0xb03a28, roughness: 0.6 }),
    lotusPad:    std({ color: 0x5a8a48, roughness: 0.9 }),
    lotusFlower: std({ color: 0xf0b8cc, roughness: 0.75 }),
  };
  // remember grass texture for later tone tweaks
  _mat._grassTex = grassTex;
  return _mat;
}
