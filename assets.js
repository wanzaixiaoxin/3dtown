// ============================================================================
//  assets.js — load third-party free FBX models (Quaternius, CC0) via FBXLoader
//  Normalizes to meters, grounds at y=0, converts materials, plays animations.
// ============================================================================
import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';

const loader = new FBXLoader();
const cache = new Map();     // url -> THREE.Group (original)
export const mixers = [];    // AnimationMixer list updated each frame

// Convert FBX default Phong materials to lit Standard materials (keeps textures),
// and enable shadows.
function convertMaterials(root) {
  root.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true;
    o.receiveShadow = true;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    const converted = mats.map((m) => {
      if (m.isMeshStandardMaterial) return m;
      const nm = new THREE.MeshStandardMaterial({
        name: m.name || 'fbx',
        map: m.map || null,
        color: m.color ? m.color.clone() : new THREE.Color(0xffffff),
        roughness: 0.85,
        metalness: 0.0,
        side: m.side ?? THREE.FrontSide,
        transparent: m.transparent || false,
        opacity: m.opacity ?? 1,
      });
      if (m.map) { m.map.colorSpace = THREE.SRGBColorSpace; nm.map = m.map; }
      return nm;
    });
    o.material = converted.length === 1 ? converted[0] : converted;
  });
}

function flattenSolidSkinnedMaterials(root) {
  root.traverse(mesh => {
    if (!mesh.isSkinnedMesh || !Array.isArray(mesh.material) || !mesh.geometry.groups.length) return;
    const materials = mesh.material;
    if (materials.some(m => m.map || m.transparent)) return;
    const geometry = mesh.geometry;
    const count = geometry.attributes.position.count;
    const colors = new Float32Array(count * 3).fill(1);
    for (const group of geometry.groups) {
      const material = materials[group.materialIndex];
      if (!material || !material.color) continue;
      const { r, g, b } = material.color;
      for (let i = group.start; i < group.start + group.count; i++) {
        const vertex = geometry.index ? geometry.index.getX(i) : i;
        colors[vertex * 3] = r;
        colors[vertex * 3 + 1] = g;
        colors[vertex * 3 + 2] = b;
      }
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.clearGroups();
    mesh.material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0 });
  });
}

// Load an FBX and return a normalized "template" group.
// targetHeight: desired height in meters (null = keep relative). grounds at y=0.
export function loadFBX(url, { targetHeight = null, targetFootprint = null, faceForward = true, feetScale = 1, charFacePlusX = false, modelYaw = 0, fixFeetRig = false } = {}) {
  return new Promise((resolve, reject) => {
    loader.load(url, (obj) => {
      convertMaterials(obj);
      flattenSolidSkinnedMaterials(obj);
      // Shrink oversized shoes on Quaternius characters (scale foot bones).
      if (feetScale !== 1) {
        obj.traverse((o) => {
          if (o.isBone && /^Foot[LR]$/.test(o.name)) {
            o.scale.multiplyScalar(feetScale);
          }
        });
      }
      // Normalize each rig's forward direction to +Z for NPC movement.
      if (charFacePlusX) obj.rotation.y = modelYaw;
      // Some exports parent the foot bones to the armature root instead of the shin,
      // so the feet do not follow the leg. Re-attach them to the shins, preserving
      // the bind-pose world transform (no visual jump, mesh stays intact).
      if (fixFeetRig) {
        const bones = {};
        obj.traverse((o) => { if (o.isBone) bones[o.name] = o; });
        const pairs = [
          ['FootL', 'LowerLegL'], ['FootR', 'LowerLegR'],
          ['FrontFootL', 'FrontLowLegL'], ['FrontFootR', 'FrontLowLegR'],
          ['BackFootL', 'BackLowLegL'], ['BackFootR', 'BackLowLegR'],
        ];
        const reparentedFeet = new Set();
        for (const [footName, shinName] of pairs) {
          const foot = bones[footName], shin = bones[shinName];
          if (foot && shin && foot.parent !== shin) {
            shin.attach(foot);
            reparentedFeet.add(footName);
          }
        }
        for (const clip of obj.animations || []) {
          clip.tracks = clip.tracks.filter(track => !reparentedFeet.has(track.name.split('.')[0]));
        }
      }
      // compute bbox
      let box = new THREE.Box3().setFromObject(obj);
      let size = box.getSize(new THREE.Vector3());

      let scale = 1;
      if (targetHeight) scale = targetHeight / size.y;
      else if (targetFootprint) scale = targetFootprint / Math.max(size.x, size.z);
      const horizontalScale = targetHeight && targetFootprint
        ? targetFootprint / Math.max(size.x, size.z)
        : scale;

      obj.scale.set(horizontalScale, scale, horizontalScale);
      // recompute after scaling, ground it (feet at y=0) and center on XZ
      box = new THREE.Box3().setFromObject(obj);
      const size2 = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      obj.position.x += -center.x;
      obj.position.z += -center.z;
      obj.position.y += -box.min.y;

      const wrap = new THREE.Group();
      wrap.add(obj);

      // store size metadata for callers (collider heights, etc.)
      wrap.userData.size = { x: size2.x, y: size2.y, z: size2.z };
      wrap.animations = obj.animations || [];
      resolve(wrap);
    }, undefined, (err) => reject(err));
  });
}

export const MODEL_SPECS = {
  house1:      { file: 'House1.fbx', targetHeight: 4.6 },
  house2:      { file: 'House2.fbx', targetHeight: 5.0 },
  building4:   { file: 'Building4.fbx', targetHeight: 10.2, targetFootprint: 5.2 },
  building2s:  { file: 'Building2_Small.fbx', targetHeight: 4.2, targetFootprint: 4.8 },
  well:        { file: 'Well.fbx', targetHeight: 1.25 },
  windmill:    { file: 'Windmill.fbx', targetHeight: 8.0 },
  barn:        { file: 'Barn.fbx', targetHeight: 4.8 },
  coop:        { file: 'ChickenCoop.fbx', targetHeight: 1.6 },
  cow:         { file: 'Cow.fbx', targetHeight: 1.45, charFacePlusX: true, fixFeetRig: true },
  horse:       { file: 'Horse.fbx', targetHeight: 1.9, charFacePlusX: true, fixFeetRig: true },
  sheep:       { file: 'Sheep.fbx', targetHeight: 0.85, charFacePlusX: true, fixFeetRig: true },
  pig:         { file: 'Pig.fbx', targetHeight: 0.65, charFacePlusX: true, fixFeetRig: true },
  pug:         { file: 'Pug.fbx', targetHeight: 0.35, charFacePlusX: true, fixFeetRig: true },
  fox:         { file: 'animal_fox.fbx', targetHeight: 0.5, charFacePlusX: true, modelYaw: Math.PI, fixFeetRig: true },
  bird:        { file: 'animal_bird.fbx', targetHeight: 0.3, charFacePlusX: true },
  manA:        { file: 'char_male_casual.fbx', targetHeight: 1.75, charFacePlusX: true, fixFeetRig: true },
  manB:        { file: 'char_male_longsleeve.fbx', targetHeight: 1.75, feetScale: 0.8, charFacePlusX: true, fixFeetRig: true },
  woman:       { file: 'char_female_casual.fbx', targetHeight: 1.68, feetScale: 0.8, charFacePlusX: true, fixFeetRig: true },
};

// Public preload of everything used, returns a dict of template clones.
// Templates keep their AnimationClips on template.userData.animations.
export async function preloadAssets(onProgress) {
  const base = './assets/models/';
  const spec = MODEL_SPECS;

  const keys = Object.keys(spec);
  const out = {};
  let done = 0;
  // limited concurrency (avoids connection resets on simple static servers)
  const CONCURRENCY = 3;
  let cursor = 0;
  async function worker() {
    while (cursor < keys.length) {
      const k = keys[cursor++];
      const s = spec[k];
      try {
        out[k] = await loadFBX(base + s.file, s);
      } catch (e) {
        // one retry
        try { out[k] = await loadFBX(base + s.file, s); }
        catch (e2) { console.warn('asset load failed', k, e2); out[k] = null; }
      } finally {
        done++;
        onProgress?.(done / keys.length, k);
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  return out;
}

// Clone a template (deep clone skinned meshes safely with SkeletonUtils-like copy).
// For non-skinned static props, .clone(true) is fine. For animated characters we
// need a proper skeleton clone — use THREE's clone for skinned via SkeletonUtils.
import { clone as skeletonClone } from 'three/addons/utils/SkeletonUtils.js';

const SKIN_TONES = [0xd8a97f, 0xc58d64, 0x9c6647, 0xe5b793, 0x70452f, 0xb97d5c];
const CLOTH_COLORS = [0x496a86, 0x8e4b3f, 0x547147, 0x80623c, 0x765b8b, 0xa27c3d, 0x3e7b72];

function applyCharacterVariant(root, variant) {
  const skin = new THREE.Color(SKIN_TONES[variant % SKIN_TONES.length]);
  const cloth = new THREE.Color(CLOTH_COLORS[(variant * 3 + 1) % CLOTH_COLORS.length]);
  root.traverse(mesh => {
    if (!mesh.isSkinnedMesh) return;
    mesh.frustumCulled = false;
    const source = mesh.geometry.getAttribute('color');
    if (!source) return;
    mesh.geometry = mesh.geometry.clone();
    const colors = mesh.geometry.getAttribute('color');
    for (let i = 0; i < source.count; i++) {
      const r = source.getX(i), g = source.getY(i), b = source.getZ(i);
      const isSkin = r > 0.16 && g > 0.05 && r > g * 1.03 && g > b * 1.01;
      const isCoolCloth = (b >= r || g >= r) && Math.max(r, g, b) > 0.18 && Math.max(r, g, b) - Math.min(r, g, b) > 0.06;
      const isCloth = !isSkin && isCoolCloth && Math.min(r, g, b) < 0.75;
      if (!isSkin && !isCloth) continue;
      const color = isSkin ? skin : cloth;
      colors.setXYZ(i,
        color.r * 0.85 + r * 0.15,
        color.g * 0.85 + g * 0.15,
        color.b * 0.85 + b * 0.15,
      );
    }
    colors.needsUpdate = true;
  });
}

export function instantiate(template, { x = 0, z = 0, rotY = 0, scale = 1, variant = 0 } = {}) {
  if (!template) return null;
  const obj = skeletonClone(template);
  obj.position.set(x, 0, z);
  obj.rotation.y = rotY;
  obj.scale.setScalar(scale);
  obj.traverse(mesh => { if (mesh.isSkinnedMesh) mesh.frustumCulled = false; });
  if (variant) applyCharacterVariant(obj, variant);
  // SkeletonUtils.clone JSON-serializes userData (destroying AnimationClips),
  // so re-attach the live clips from the template as a direct property.
  obj.animations = template.animations || [];
  obj.userData.size = template.userData.size;
  return obj;
}

// Start an animation clip on an instance. Returns { mixer, action, clip }.
export function playClip(instance, clipName, { loop = true, speed = 1, register = true } = {}) {
  const clips = instance.animations || [];
  if (!clips.length) return null;
  const clip = clips.find(c => c.name.toLowerCase().includes(clipName.toLowerCase()));
  if (!clip) return null;   // don't silently fall back to an unrelated clip
  const mixer = new THREE.AnimationMixer(instance);
  const action = mixer.clipAction(clip);
  action.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
  action.clampWhenFinished = !loop;
  action.timeScale = speed;
  action.play();
  if (register) mixers.push(mixer);
  return { mixer, action, clip };
}

// Find a skinned root inside an instantiated group for the mixer target
export function getSkinnedRoot(instance) {
  let root = instance;
  instance.traverse(o => { if (o.isSkinnedMesh && o.skeleton) root = o; });
  return root;
}

export function disposeAssets() {
  cache.clear();
  mixers.length = 0;
}
