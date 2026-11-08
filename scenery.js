// ============================================================================
//  scenery.js — rich environment: animated water, pavilion, rockery, garden,
//  wind-swayed grass & flowers, willows, lotus.  CC0-free, procedurally built.
// ============================================================================
import * as THREE from 'three';
import { M, trackGeo } from './materials.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { colliders } from './world.js';

// --- shared wind uniforms (driven by main.js each frame) ---
export const windUniforms = {
  uTime: { value: 0 },
  uWindDir: { value: new THREE.Vector2(1, 0.35).normalize() },
  uWindStrength: { value: 0.9 },
};
export function updateWind(t) {
  windUniforms.uTime.value = t;
  // gentle gusting
  windUniforms.uWindStrength.value = 0.75 + 0.35 * Math.sin(t * 0.4);
}

// ===========================================================================
//  ORGANIC FOLIAGE TEXTURES (canvas-generated alpha cards)
// ===========================================================================
function canvasTexture(size, draw) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  draw(ctx, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

let _leafTex = null, _leafDarkTex = null, _blossomTex = null, _grassTex = null, _flowerTex = null, _willowTex = null;

function makeLeafTexture(hue, sat, light, count, size = 512) {
  return canvasTexture(size, (ctx, S) => {
    ctx.clearRect(0, 0, S, S);
    const cx = S / 2, cy = S / 2;
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.pow(Math.random(), 0.55) * S * 0.46;
      const x = cx + Math.cos(a) * r;
      const y = cy + Math.sin(a) * r * 0.94;
      const w = 5 + Math.random() * 11;
      const h = 2.6 + Math.random() * 6;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(a + Math.random() * 1.4);
      const l = light + (Math.random() - 0.5) * 24;
      const s2 = sat + (Math.random() - 0.5) * 16;
      const grad = ctx.createLinearGradient(-w, 0, w, 0);
      grad.addColorStop(0, `hsla(${hue - 4},${s2}%,${l - 9}%,0.96)`);
      grad.addColorStop(1, `hsla(${hue + 10},${s2}%,${l + 9}%,0.96)`);
      ctx.fillStyle = grad;
      ctx.beginPath(); ctx.ellipse(0, 0, w, h, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = `hsla(${hue},${s2}%,${l - 18}%,0.45)`;
      ctx.lineWidth = 0.7;
      ctx.beginPath(); ctx.moveTo(-w * 0.9, 0); ctx.lineTo(w * 0.9, 0); ctx.stroke();
      ctx.restore();
    }
  });
}

function makeBlossomTexture(size = 512) {
  return canvasTexture(size, (ctx, S) => {
    ctx.clearRect(0, 0, S, S);
    const cx = S / 2, cy = S / 2;
    for (let i = 0; i < 190; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.pow(Math.random(), 0.55) * S * 0.44;
      const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
      const petals = 5, rad = 4 + Math.random() * 6;
      const hue = 335 + Math.random() * 16;
      for (let p = 0; p < petals; p++) {
        const pa = (p / petals) * Math.PI * 2 + Math.random() * 0.3;
        ctx.beginPath();
        ctx.ellipse(x + Math.cos(pa) * rad * 0.7, y + Math.sin(pa) * rad * 0.7, rad * 0.62, rad * 0.42, pa, 0, Math.PI * 2);
        ctx.fillStyle = `hsla(${hue},${55 + Math.random() * 20}%,${80 + Math.random() * 10}%,0.95)`;
        ctx.fill();
      }
      ctx.beginPath(); ctx.arc(x, y, rad * 0.25, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,235,170,0.95)'; ctx.fill();
    }
    // a few green leaves between blossoms
    for (let i = 0; i < 40; i++) {
      const a = Math.random() * Math.PI * 2, r = Math.random() * S * 0.44;
      ctx.beginPath();
      ctx.ellipse(cx + Math.cos(a) * r, cy + Math.sin(a) * r, 8, 3.5, a, 0, Math.PI * 2);
      ctx.fillStyle = 'hsla(100,40%,35%,0.85)'; ctx.fill();
    }
  });
}

function makeGrassCardTexture(size = 256) {
  return canvasTexture(size, (ctx, S) => {
    ctx.clearRect(0, 0, S, S);
    for (let i = 0; i < 110; i++) {
      const x = S * 0.5 + (Math.random() - 0.5) * S * 0.9;
      const h = S * (0.4 + Math.random() * 0.55);
      const w = 0.8 + Math.random() * 2.4;
      const bend = (Math.random() - 0.5) * S * 0.22;
      const hue = 92 + Math.random() * 34;
      const l = 24 + Math.random() * 24;
      ctx.strokeStyle = `hsla(${hue},${45 + Math.random() * 20}%,${l}%,0.95)`;
      ctx.lineWidth = w; ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(x, S);
      ctx.quadraticCurveTo(x + bend * 0.35, S - h * 0.55, x + bend, S - h);
      ctx.stroke();
    }
  });
}

function makeFlowerCardTexture(size = 256) {
  return canvasTexture(size, (ctx, S) => {
    ctx.clearRect(0, 0, S, S);
    const palette = [[335, 70, 72], [0, 0, 96], [45, 90, 62], [350, 65, 72], [280, 40, 80]];
    for (let i = 0; i < 12; i++) {
      const bx = S * (0.2 + Math.random() * 0.6);
      const bh = S * (0.45 + Math.random() * 0.45);
      ctx.strokeStyle = 'hsla(105,45%,32%,0.95)';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(bx, S);
      ctx.quadraticCurveTo(bx + (Math.random() - 0.5) * 14, S - bh * 0.6, bx, S - bh);
      ctx.stroke();
      const [h, s, l] = palette[Math.floor(Math.random() * palette.length)];
      for (let p = 0; p < 5; p++) {
        const pa = (p / 5) * Math.PI * 2;
        ctx.beginPath();
        ctx.ellipse(bx + Math.cos(pa) * 5, S - bh + Math.sin(pa) * 5, 4.5, 2.8, pa, 0, Math.PI * 2);
        ctx.fillStyle = `hsla(${h},${s}%,${l}%,0.96)`; ctx.fill();
      }
      ctx.beginPath(); ctx.arc(bx, S - bh, 2, 0, Math.PI * 2);
      ctx.fillStyle = 'hsla(48,90%,70%,0.95)'; ctx.fill();
    }
  });
}

function makeWillowTexture(size = 512) {
  return canvasTexture(size, (ctx, S) => {
    ctx.clearRect(0, 0, S, S);
    for (let i = 0; i < 22; i++) {
      const x = Math.random() * S;
      const len = S * (0.55 + Math.random() * 0.42);
      const sway = (Math.random() - 0.5) * 26;
      ctx.strokeStyle = 'hsla(95,35%,38%,0.75)';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.quadraticCurveTo(x + sway, len * 0.55, x + sway * 0.6, len);
      ctx.stroke();
      // small leaves along the strand
      for (let k = 0; k < 26; k++) {
        const t = k / 26;
        const lx = x + sway * (t * t) * 0.9;
        const ly = len * t;
        ctx.save();
        ctx.translate(lx, ly);
        ctx.rotate((Math.random() - 0.5) * 1.2);
        ctx.beginPath();
        ctx.ellipse(0, 0, 5.5, 1.8, 0, 0, Math.PI * 2);
        ctx.fillStyle = `hsla(${92 + Math.random() * 26},${38 + Math.random() * 18}%,${34 + Math.random() * 16}%,0.95)`;
        ctx.fill();
        ctx.restore();
      }
    }
  });
}

function getLeafTextures() {
  if (!_leafTex) {
    _leafTex = makeLeafTexture(108, 46, 36, 340);
    _leafDarkTex = makeLeafTexture(132, 40, 27, 300);
    _blossomTex = makeBlossomTexture();
    _grassTex = makeGrassCardTexture();
    _flowerTex = makeFlowerCardTexture();
    _willowTex = makeWillowTexture();
  }
  return { leaf: _leafTex, dark: _leafDarkTex, blossom: _blossomTex, grass: _grassTex, flower: _flowerTex, willow: _willowTex };
}

// material for alpha-tested foliage cards, with wind sway
function makeCardMaterial(map, { color = 0xffffff, alphaTest = 0.38, swayAmp = 0.14, swaySpeed = 1.0 } = {}) {
  const mat = new THREE.MeshStandardMaterial({
    map, color, alphaTest, transparent: false,
    side: THREE.DoubleSide, roughness: 0.95, metalness: 0.0,
  });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = windUniforms.uTime;
    shader.uniforms.uWindDir = windUniforms.uWindDir;
    shader.uniforms.uWindStrength = windUniforms.uWindStrength;
    shader.uniforms.uSwayAmp = { value: swayAmp };
    shader.uniforms.uSwaySpeed = { value: swaySpeed };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        uniform float uTime; uniform vec2 uWindDir; uniform float uWindStrength;
        uniform float uSwayAmp; uniform float uSwaySpeed;
      `)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        float w = sin(uTime * uSwaySpeed + position.x * 0.35 + position.z * 0.35);
        float amp = uSwayAmp * uWindStrength * clamp(transformed.y + 1.2, 0.0, 3.0);
        transformed.x += uWindDir.x * w * amp;
        transformed.z += uWindDir.y * w * amp;
      `);
  };
  mat.customProgramCacheKey = () => 'cardsway' + swayAmp + swaySpeed;
  return mat;
}

function crossedCardGeometry(w, h) {
  const planes = [];
  for (let i = 0; i < 3; i++) {
    const g = new THREE.PlaneGeometry(w, h);
    g.rotateY((i / 3) * Math.PI);
    planes.push(g);
  }
  const merged = mergeGeometries(planes, false);
  planes.forEach(g => g.dispose());
  return merged;
}

// ===========================================================================
//  WIND MATERIALS (vertex-shader sway keyed on world height / vertex color)
// ===========================================================================
// Grass tuft: instanced blades that bend with wind, bending more at the tip.
function makeGrassMaterial(baseColor) {
  const mat = new THREE.MeshStandardMaterial({
    color: baseColor, roughness: 1.0, side: THREE.DoubleSide,
  });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = windUniforms.uTime;
    shader.uniforms.uWindDir = windUniforms.uWindDir;
    shader.uniforms.uWindStrength = windUniforms.uWindStrength;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        uniform float uTime; uniform vec2 uWindDir; uniform float uWindStrength;
        varying float vWindPh;
      `)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        // height above local origin drives sway amount (0 at base, 1 at tip)
        float sway = clamp(transformed.y, 0.0, 1.0);
        // per-instance phase from instance matrix translation
        #ifdef USE_INSTANCING
          float ph = instanceMatrix[3].x * 0.7 + instanceMatrix[3].z * 0.9;
        #else
          float ph = 0.0;
        #endif
        float w = sin(uTime * 1.6 + ph) * 0.5 + sin(uTime * 0.7 + ph * 1.7) * 0.5;
        vec2 bend = uWindDir * (w * 0.22 * uWindStrength) * sway;
        transformed.x += bend.x;
        transformed.z += bend.y;
        transformed.y -= abs(w) * 0.03 * sway * uWindStrength;
      `);
  };
  mat.customProgramCacheKey = () => 'grasssway';
  return mat;
}

// Foliage (tree canopy / bush / willow strands): whole-mesh gentle sway
export function makeFoliageMaterial(color, swayAmp = 0.12, swaySpeed = 1.0) {
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.92, flatShading: true });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = windUniforms.uTime;
    shader.uniforms.uWindDir = windUniforms.uWindDir;
    shader.uniforms.uWindStrength = windUniforms.uWindStrength;
    shader.uniforms.uSwayAmp = { value: swayAmp };
    shader.uniforms.uSwaySpeed = { value: swaySpeed };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        uniform float uTime; uniform vec2 uWindDir; uniform float uWindStrength;
        uniform float uSwayAmp; uniform float uSwaySpeed;
        varying float vH;
      `)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        float hh = clamp(transformed.y, 0.0, 20.0);
        float w = sin(uTime * uSwaySpeed + position.x * 0.4 + position.z * 0.4);
        vec2 bend = uWindDir * (w * uSwayAmp * uWindStrength) * (hh * 0.12);
        transformed.x += bend.x;
        transformed.z += bend.y;
      `);
  };
  mat.customProgramCacheKey = () => 'foliagesway' + swayAmp;
  return mat;
}

// Water: animated ripple normal via shader displacement + fresnel-ish tint
export function makeWaterMaterial(color = 0x3f7288) {
  const mat = new THREE.MeshStandardMaterial({
    color, roughness: 1.0, metalness: 0.0, transparent: true, opacity: 0.94, envMapIntensity: 0.04,
  });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = windUniforms.uTime;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        uniform float uTime;
        varying float vRipple;
      `)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        // gentle multi-wave ripple
        float r = sin(transformed.x * 0.7 + uTime * 1.3) * 0.06
                + sin(transformed.y * 0.9 - uTime * 1.7) * 0.05
                + sin((transformed.x + transformed.y) * 0.5 + uTime * 0.9) * 0.04;
        transformed.z += r;
        vRipple = r;
      `);
    // keep fragment untouched (cheaper on low-end GPUs)
  };
  mat.customProgramCacheKey = () => 'waterripple';
  return mat;
}

// ===========================================================================
//  GRASS FIELD (instanced wind-swayed blades)
// ===========================================================================
export function buildGrassField(parent) {
  const T = getLeafTextures();
  const geo = trackGeo(crossedCardGeometry(0.42, 0.30));
  geo.translate(0, 0.15, 0);
  const mat = makeCardMaterial(T.grass, { alphaTest: 0.34, swayAmp: 0.16, swaySpeed: 1.35 });
  const COUNT = 4200;
  const inst = new THREE.InstancedMesh(geo, mat, COUNT);
  inst.name = 'grassField';
  inst.castShadow = false; inst.receiveShadow = false;
  const d = new THREE.Object3D();
  const color = new THREE.Color();
  const TOWN = 44;
  let i = 0, guard = 0;
  while (i < COUNT && guard < COUNT * 6) {
    guard++;
    const x = (Math.random() - 0.5) * TOWN * 1.9;
    const z = (Math.random() - 0.5) * TOWN * 1.9;
    if (Math.abs(x) < 5.2 || Math.abs(z) < 5.2) continue;
    if (Math.hypot(x, z) < 11.5) continue;
    if (Math.hypot(x + 26, z - 26) < 8) continue;
    d.position.set(x, 0.02, z);
    d.rotation.set(0, Math.random() * Math.PI * 2, 0);
    const sc = 0.65 + Math.random() * 0.75;
    d.scale.set(sc, sc * (0.8 + Math.random() * 0.45), sc);
    d.updateMatrix();
    inst.setMatrixAt(i, d.matrix);
    color.setHSL(0.26 + Math.random() * 0.06, 0.25 + Math.random() * 0.15, 0.42 + Math.random() * 0.14);
    inst.setColorAt(i, color);
    i++;
  }
  inst.count = i;
  inst.instanceMatrix.needsUpdate = true;
  if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
  parent.add(inst);
  return inst;
}

// ===========================================================================
//  FLOWER BEDS — instanced alpha cards with painted blossoms
// ===========================================================================
const flowerRegistry = { mats: [] };

export function buildFlowerBed(parent, cx, cz, radius, count = 120) {
  const d = new THREE.Object3D();
  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2;
    const rr = Math.sqrt(Math.random()) * radius;
    d.position.set(cx + Math.cos(a) * rr, 0, cz + Math.sin(a) * rr);
    d.rotation.set(0, Math.random() * Math.PI * 2, 0);
    const s = 0.8 + Math.random() * 0.6;
    d.scale.set(s, s, s);
    d.updateMatrix();
    flowerRegistry.mats.push(d.matrix.clone());
  }
}

export function flushFlowers(parent) {
  if (!flowerRegistry.mats.length) return;
  const T = getLeafTextures();
  const geo = trackGeo(crossedCardGeometry(0.6, 0.55));
  geo.translate(0, 0.27, 0);
  const mat = makeCardMaterial(T.flower, { alphaTest: 0.3, swayAmp: 0.12, swaySpeed: 1.5 });
  const inst = new THREE.InstancedMesh(geo, mat, flowerRegistry.mats.length);
  inst.name = 'flowerCards';
  inst.castShadow = false; inst.receiveShadow = false;
  flowerRegistry.mats.forEach((mx, i) => inst.setMatrixAt(i, mx));
  inst.instanceMatrix.needsUpdate = true;
  parent.add(inst);
}

// ===========================================================================
//  WILLOW TREE — bark trunk + painted leaf cards + hanging strand cards
// ===========================================================================
export function buildWillow(parent, x, z, scale = 1) {
  const m = M();
  const T = getLeafTextures();
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  const trunkH = 3.2 * scale;
  const trunk = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.18 * scale, 0.34 * scale, trunkH, 8)), m.trunk);
  trunk.position.y = trunkH / 2; trunk.castShadow = true; g.add(trunk);

  // canopy: leaf cards
  const canopyMat = makeCardMaterial(T.leaf, { alphaTest: 0.36, swayAmp: 0.10, swaySpeed: 0.85 });
  const canopyGeo = trackGeo(crossedCardGeometry(4.6 * scale, 3.4 * scale));
  for (let i = 0; i < 3; i++) {
    const card = new THREE.Mesh(canopyGeo, canopyMat);
    card.position.set((Math.random() - 0.5) * 0.8 * scale, trunkH + (0.6 + i * 0.5) * scale, (Math.random() - 0.5) * 0.8 * scale);
    card.rotation.y = Math.random() * Math.PI;
    card.castShadow = true;
    g.add(card);
  }
  // hanging willow strands (alpha cards)
  const strandMat = makeCardMaterial(T.willow, { alphaTest: 0.28, swayAmp: 0.2, swaySpeed: 1.5 });
  const strandGeo = trackGeo(new THREE.PlaneGeometry(1.5 * scale, 3.2 * scale));
  strandGeo.translate(0, -1.6 * scale, 0);
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    const s2 = new THREE.Mesh(strandGeo, strandMat);
    s2.position.set(Math.cos(a) * 1.15 * scale, trunkH + 1.0 * scale, Math.sin(a) * 1.15 * scale);
    s2.rotation.y = -a + Math.PI / 2;
    g.add(s2);
  }

  parent.add(g);
  colliders.push({ minX: x - 0.4, maxX: x + 0.4, minZ: z - 0.4, maxZ: z + 0.4, top: trunkH, kind: 'tree' });
  return g;
}

// ===========================================================================
//  REAL TREE — bark trunk + branches + alpha leaf / blossom cards
// ===========================================================================
export function buildRealTree(parent, x, z, scale = 1, kind = 'green') {
  const m = M();
  const T = getLeafTextures();
  const g = new THREE.Group();
  g.position.set(x, 0, z);

  const trunkH = 2.8 * scale;
  const trunk = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.16 * scale, 0.32 * scale, trunkH, 8)), m.trunk);
  trunk.position.y = trunkH / 2; trunk.castShadow = trunk.receiveShadow = true; g.add(trunk);

  // branches
  for (let b = 0; b < 3; b++) {
    const a = (b / 3) * Math.PI * 2 + Math.random();
    const br = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.05 * scale, 0.11 * scale, 1.5 * scale, 5)), m.trunk);
    br.position.set(Math.cos(a) * 0.45 * scale, trunkH * 0.82, Math.sin(a) * 0.45 * scale);
    br.rotation.set(Math.sin(a) * 0.75, 0, -Math.cos(a) * 0.75);
    br.castShadow = true; g.add(br);
  }

  const tex = kind === 'blossom' ? T.blossom : (kind === 'dark' ? T.dark : T.leaf);
  const mat = makeCardMaterial(tex, { alphaTest: 0.38, swayAmp: kind === 'blossom' ? 0.11 : 0.13, swaySpeed: 0.95 });
  const cardGeo = trackGeo(crossedCardGeometry(2.9 * scale, 2.4 * scale));
  const clusters = [
    [0, trunkH + 0.9 * scale, 0, 1.1],
    [0.85 * scale, trunkH + 1.35 * scale, 0.3 * scale, 0.9],
    [-0.85 * scale, trunkH + 1.3 * scale, -0.25 * scale, 0.88],
    [0.15 * scale, trunkH + 1.95 * scale, -0.35 * scale, 0.8],
    [-0.35 * scale, trunkH + 0.55 * scale, 0.75 * scale, 0.75],
  ];
  for (const [bx, by, bz, scl] of clusters) {
    const card = new THREE.Mesh(cardGeo, mat);
    card.position.set(bx, by, bz);
    card.rotation.set(0, Math.random() * Math.PI, 0);
    card.scale.setScalar(scl);
    card.castShadow = true;
    g.add(card);
  }

  parent.add(g);
  colliders.push({ minX: x - 0.35, maxX: x + 0.35, minZ: z - 0.35, maxZ: z + 0.35, top: trunkH, kind: 'tree' });
  return g;
}

// ===========================================================================
//  POND with animated water + lotus pads/flowers + stone rim
// ===========================================================================
export function buildAnimatedPond(parent, x, z, r) {
  const m = M();
  const waterMat = makeWaterMaterial(0x3f7288);
  const waterGeo = trackGeo(new THREE.CircleGeometry(r, 48, 0, Math.PI * 2));
  // segment the disc so vertex displacement has vertices to move
  const water = new THREE.Mesh(trackGeo(new THREE.CircleGeometry(r, 40, 0, Math.PI * 2)), waterMat);
  water.rotation.x = -Math.PI / 2;
  water.position.set(x, 0.16, z);
  water.receiveShadow = true;
  water.name = 'pond-water';
  water.userData.noBatch = true;   // custom ripple shader needs local space
  parent.add(water);

  // stone rim (ring of blocks)
  const rimGeo = trackGeo(new THREE.TorusGeometry(r, 0.4, 6, 40));
  const rim = new THREE.Mesh(rimGeo, m.stoneLt);
  rim.rotation.x = -Math.PI / 2; rim.position.set(x, 0.18, z);
  rim.receiveShadow = true; parent.add(rim);

  // lotus pads + a few flowers
  const padGeo = trackGeo(new THREE.CircleGeometry(0.42, 10));
  for (let i = 0; i < 14; i++) {
    const a = Math.random() * Math.PI * 2, rr = Math.random() * (r - 1.1);
    const pad = new THREE.Mesh(padGeo, m.lotusPad);
    pad.rotation.x = -Math.PI / 2;
    pad.position.set(x + Math.cos(a) * rr, 0.19, z + Math.sin(a) * rr);
    parent.add(pad);
    if (i % 4 === 0) {
      const fl = new THREE.Group();
      for (let p = 0; p < 6; p++) {
        const petal = new THREE.Mesh(trackGeo(new THREE.ConeGeometry(0.05, 0.16, 4)), m.lotusFlower);
        const pa = (p / 6) * Math.PI * 2;
        petal.position.set(Math.cos(pa) * 0.06, 0.1, Math.sin(pa) * 0.06);
        petal.rotation.z = Math.cos(pa) * 0.5; petal.rotation.x = Math.sin(pa) * 0.5;
        fl.add(petal);
      }
      fl.position.set(x + Math.cos(a) * rr, 0.2, z + Math.sin(a) * rr);
      parent.add(fl);
    }
  }
  // block walking into water
  colliders.push({ minX: x - r, maxX: x + r, minZ: z - r, maxZ: z + r, top: 0.01, water: true });
}

// ===========================================================================
//  PAVILION (亭) — multi-tier Chinese pavilion with curved eaves
// ===========================================================================
export function buildPavilion(parent, x, z, s = 1) {
  const m = M();
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  const baseR = 3.2 * s, colH = 3.2 * s;

  // stone platform
  const base = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(baseR + 0.6, baseR + 0.9, 0.5 * s, 6)), m.stoneLt);
  base.position.y = 0.25 * s; base.castShadow = base.receiveShadow = true; g.add(base);

  // 6 red columns
  const colGeo = trackGeo(new THREE.CylinderGeometry(0.16 * s, 0.18 * s, colH, 8));
  const ringR = baseR;
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const col = new THREE.Mesh(colGeo, m.pavilionRed);
    col.position.set(Math.cos(a) * ringR, 0.5 * s + colH / 2, Math.sin(a) * ringR);
    col.castShadow = true; g.add(col);
  }
  // top ring beam
  const beam = new THREE.Mesh(trackGeo(new THREE.TorusGeometry(ringR, 0.1 * s, 6, 24)), m.woodDark);
  beam.rotation.x = Math.PI / 2; beam.position.y = 0.5 * s + colH; g.add(beam);

  // railings between columns (top + bottom rail + balusters)
  for (let i = 0; i < 6; i++) {
    const a0 = (i / 6) * Math.PI * 2, a1 = ((i + 1) / 6) * Math.PI * 2;
    const p0 = new THREE.Vector3(Math.cos(a0) * ringR, 0, Math.sin(a0) * ringR);
    const p1 = new THREE.Vector3(Math.cos(a1) * ringR, 0, Math.sin(a1) * ringR);
    const mid = p0.clone().add(p1).multiplyScalar(0.5);
    const len = p0.distanceTo(p1) * 0.94;
    const ang = Math.atan2(p1.z - p0.z, p1.x - p0.x);
    for (const [yy, hh] of [[0.5 * s + 0.95 * s, 0.08 * s], [0.5 * s + 0.45 * s, 0.06 * s]]) {
      const rail = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(len, hh, 0.1 * s)), m.pavilionRed);
      rail.position.set(mid.x, yy, mid.z);
      rail.rotation.y = -ang;
      rail.castShadow = true; g.add(rail);
    }
    // balusters
    for (let b = 1; b <= 3; b++) {
      const t = b / 4;
      const bx = p0.x + (p1.x - p0.x) * t, bz = p0.z + (p1.z - p0.z) * t;
      const bal = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.06 * s, 0.42 * s, 0.06 * s)), m.pavilionRed);
      bal.position.set(bx, 0.5 * s + 0.66 * s, bz);
      g.add(bal);
    }
  }

  // two-tier pagoda roof — steep cones, small eaves, proper stacking
  const roofY = 0.5 * s + colH;
  const roofDS = m.roofBlue.clone();
  roofDS.side = THREE.DoubleSide;
  roofDS.color = new THREE.Color(0xffffff);
  const roofMat = roofDS;
  // ---- lower tier ----
  const r1 = baseR + 0.9 * s;
  const h1 = 3.2 * s;
  const cone1 = new THREE.Mesh(trackGeo(new THREE.ConeGeometry(r1, h1, 6)), roofMat);
  cone1.position.y = roofY + h1 / 2;
  cone1.rotation.y = Math.PI / 6;
  cone1.castShadow = true; g.add(cone1);
  // eave edge ring
  const eave1 = new THREE.Mesh(trackGeo(new THREE.TorusGeometry(r1 * 0.99, 0.09 * s, 6, 24)), roofMat);
  eave1.rotation.x = Math.PI / 2;
  eave1.position.y = roofY + 0.02; g.add(eave1);
  // dark eave underside (reads as shadowed rafters from below)
  const ceil1 = new THREE.Mesh(trackGeo(new THREE.CircleGeometry(r1 * 0.99, 24)), m.woodDark);
  ceil1.rotation.x = Math.PI / 2;
  ceil1.position.y = roofY - 0.01; g.add(ceil1);
  // ---- upper storey drum ----
  const drumR = baseR * 0.48;
  const drumH = 0.95 * s;
  const drum = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(drumR, drumR * 1.04, drumH, 6)), m.plaster);
  drum.position.y = roofY + h1 * 0.8 + drumH / 2;
  drum.rotation.y = Math.PI / 6; drum.castShadow = true; g.add(drum);
  // ---- upper tier ----
  const r2 = drumR + 0.55 * s;
  const h2 = 2.0 * s;
  const upperBase = roofY + h1 * 0.8 + drumH;
  const cone2 = new THREE.Mesh(trackGeo(new THREE.ConeGeometry(r2, h2, 6)), roofMat);
  cone2.position.y = upperBase + h2 / 2;
  cone2.rotation.y = Math.PI / 6;
  cone2.castShadow = true; g.add(cone2);
  const eave2 = new THREE.Mesh(trackGeo(new THREE.TorusGeometry(r2 * 0.99, 0.075 * s, 6, 24)), roofMat);
  eave2.rotation.x = Math.PI / 2;
  eave2.position.y = upperBase + 0.01; g.add(eave2);
  const ceil2 = new THREE.Mesh(trackGeo(new THREE.CircleGeometry(r2 * 0.99, 24)), m.woodDark);
  ceil2.rotation.x = Math.PI / 2;
  ceil2.position.y = upperBase - 0.01; g.add(ceil2);
  // upturned gold tips at both eave rings
  for (const [rr, yy] of [[r1, roofY + 0.02], [r2, upperBase + 0.01]]) {
    for (let c = 0; c < 6; c++) {
      const ca = (c / 6) * Math.PI * 2 + Math.PI / 6;
      const tip = new THREE.Mesh(trackGeo(new THREE.ConeGeometry(0.07 * s, 0.5 * s, 4)), m.gold);
      tip.position.set(Math.cos(ca) * rr * 1.01, yy + 0.1 * s, Math.sin(ca) * rr * 1.01);
      tip.rotation.set(Math.sin(ca) * 0.75, -ca, -Math.cos(ca) * 0.75);
      g.add(tip);
    }
  }
  // finial
  const finial = new THREE.Mesh(trackGeo(new THREE.SphereGeometry(0.2 * s, 10, 10)), m.gold);
  finial.position.y = upperBase + h2 + 0.3 * s; g.add(finial);

  parent.add(g);
  colliders.push({ minX: x - baseR, maxX: x + baseR, minZ: z - baseR, maxZ: z + baseR, top: roofY, kind: 'pavilion' });
  return g;
}

// ===========================================================================
//  ROCKERY (假山) — clustered irregular boulders, some stacked high
// ===========================================================================
export function buildRockery(parent, x, z, scale = 1) {
  const m = M();
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  // main jagged peak
  const peak = new THREE.Mesh(trackGeo(new THREE.DodecahedronGeometry(1.15 * scale, 0)), m.rock);
  peak.position.y = 1.5 * scale; peak.scale.set(0.9, 1.5, 0.85);
  peak.rotation.set(0.4, 0.7, 0.2); peak.castShadow = peak.receiveShadow = true; g.add(peak);
  // surrounding boulders, decreasing size outward
  const N = 14;
  for (let i = 0; i < N; i++) {
    const a = Math.random() * Math.PI * 2;
    const rr = (0.5 + Math.random() * 1.9) * scale;
    const scl = (0.35 + Math.random() * 0.75) * scale;
    const geo = trackGeo(new THREE.DodecahedronGeometry(scl, 0));
    const rock = new THREE.Mesh(geo, Math.random() > 0.45 ? m.rock : m.rockDark);
    rock.position.set(Math.cos(a) * rr, scl * (0.55 + Math.random() * 0.5), Math.sin(a) * rr);
    rock.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
    rock.scale.set(1, 0.7 + Math.random() * 0.9, 0.9 + Math.random() * 0.3);
    rock.castShadow = rock.receiveShadow = true;
    g.add(rock);
  }
  // moss patches on the lower rocks
  for (let i = 0; i < 6; i++) {
    const a = Math.random() * Math.PI * 2, rr = Math.random() * 1.6 * scale;
    const moss = new THREE.Mesh(trackGeo(new THREE.SphereGeometry((0.25 + Math.random() * 0.3) * scale, 6, 4)), m.moss);
    moss.position.set(Math.cos(a) * rr, (0.35 + Math.random() * 0.7) * scale, Math.sin(a) * rr);
    moss.scale.y = 0.35; g.add(moss);
  }
  parent.add(g);
  colliders.push({ minX: x - 2.6 * scale, maxX: x + 2.6 * scale, minZ: z - 2.6 * scale, maxZ: z + 2.6 * scale, top: 3.0 * scale, kind: 'rock' });
  return g;
}

// ===========================================================================
//  GARDEN — a walled garden courtyard: flower beds, hedges, willows, path
// ===========================================================================
export function buildGarden(parent, cx, cz, size = 12) {
  const m = M();
  const half = size / 2;
  // low white garden walls (3 sides, opening toward town)
  const wallH = 1.1, wallT = 0.35;
  const mkWall = (x, z, w, d) => {
    const wl = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(w, wallH, d)), m.stoneLt);
    wl.position.set(x, wallH / 2, z); wl.castShadow = wl.receiveShadow = true; parent.add(wl);
    colliders.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2, top: wallH, kind: 'wall' });
  };
  mkWall(cx, cz - half, size, wallT);         // north
  mkWall(cx - half, cz, wallT, size);         // west
  mkWall(cx + half, cz, wallT, size);         // east
  // opening on south — two short walls
  mkWall(cx - half * 0.6, cz + half, half * 0.8, wallT);
  mkWall(cx + half * 0.6, cz + half, half * 0.8, wallT);

  // garden ground (dirt path + grass)
  const path = new THREE.Mesh(trackGeo(new THREE.PlaneGeometry(1.6, size * 0.9)), m.stone);
  path.rotation.x = -Math.PI / 2; path.position.set(cx, 0.05, cz); path.receiveShadow = true; parent.add(path);

  // flower beds in corners
  buildFlowerBed(parent, cx - half * 0.5, cz - half * 0.5, 2.2, 90);
  buildFlowerBed(parent, cx + half * 0.5, cz - half * 0.5, 2.2, 90, ['petalRed','petalYellow','petalWhite']);
  // central rockery
  buildRockery(parent, cx, cz - half * 0.15, 0.8);
  // hedges along walls
  const hedgeMat = makeFoliageMaterial(0x4f7a3a, 0.08, 0.9);
  for (let i = -1; i <= 1; i += 2) {
    const hedge = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(size * 0.7, 0.7, 0.6)), hedgeMat);
    hedge.position.set(cx, 0.35, cz - half + 0.5 + (i > 0 ? 0 : 0)); hedge.castShadow = true;
    // only one row near north wall
    if (i === -1) parent.add(hedge);
  }
  // small willow at a corner
  buildWillow(parent, cx + half - 1.6, cz + half - 1.6, 0.8);
}

// ===========================================================================
//  A couple of small scenic bushes with wind
// ===========================================================================
export function buildBush(parent, x, z, scale = 1) {
  const T = getLeafTextures();
  const mat = makeCardMaterial(T.dark, { alphaTest: 0.36, swayAmp: 0.09, swaySpeed: 1.1 });
  const geo = trackGeo(crossedCardGeometry(1.7 * scale, 1.4 * scale));
  const b = new THREE.Mesh(geo, mat);
  b.position.set(x, 0.55 * scale, z);
  b.rotation.y = Math.random() * Math.PI;
  b.castShadow = true; parent.add(b);
}

// ===========================================================================
//  SKY DECOR — drifting clouds (day) + stars (night)
// ===========================================================================
export function buildSkyDecor(scene) {
  const group = new THREE.Group();
  group.name = 'skyDecor';

  // --- stars ---
  const starCount = 900;
  const starPos = new Float32Array(starCount * 3);
  for (let i = 0; i < starCount; i++) {
    // upper hemisphere only
    const a = Math.random() * Math.PI * 2;
    const y = 0.15 + Math.random() * 0.85;
    const r = Math.sqrt(1 - y * y);
    starPos[i*3] = Math.cos(a) * r * 340;
    starPos[i*3+1] = y * 340;
    starPos[i*3+2] = Math.sin(a) * r * 340;
  }
  const starGeo = trackGeo(new THREE.BufferGeometry());
  starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
  const starMat = new THREE.PointsMaterial({
    color: 0xf6f2e0, size: 2.2, sizeAttenuation: false,
    transparent: true, opacity: 0, depthWrite: false, fog: false,
    blending: THREE.AdditiveBlending,
  });
  const stars = new THREE.Points(starGeo, starMat);
  stars.name = 'stars';
  group.add(stars);

  // --- cloud texture (soft radial puff) ---
  const cv = document.createElement('canvas'); cv.width = cv.height = 128;
  const ctx = cv.getContext('2d');
  const grd = ctx.createRadialGradient(64, 64, 8, 64, 64, 62);
  grd.addColorStop(0, 'rgba(255,255,255,0.95)');
  grd.addColorStop(0.45, 'rgba(255,255,255,0.55)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grd; ctx.fillRect(0, 0, 128, 128);
  const cloudTex = new THREE.CanvasTexture(cv);
  cloudTex.colorSpace = THREE.SRGBColorSpace;

  const cloudMat = new THREE.SpriteMaterial({
    map: cloudTex, transparent: true, opacity: 0.38, depthWrite: false, fog: false,
  });
  const clouds = new THREE.Group();
  clouds.name = 'clouds';
  for (let i = 0; i < 18; i++) {
    const s = new THREE.Sprite(cloudMat);
    const a = Math.random() * Math.PI * 2;
    const rr = 90 + Math.random() * 160;
    s.position.set(Math.cos(a) * rr, 95 + Math.random() * 60, Math.sin(a) * rr);
    const sc = 16 + Math.random() * 26;
    s.scale.set(sc, sc * 0.45, 1);
    clouds.add(s);
  }
  group.add(clouds);

  scene.add(group);
  return { stars, starMat, cloudMat, clouds };
}
