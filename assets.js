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

// Load an FBX and return a normalized "template" group.
// targetHeight: desired height in meters (null = keep relative). grounds at y=0.
export function loadFBX(url, { targetHeight = null, targetFootprint = null, faceForward = true, feetScale = 1, charFacePlusX = false } = {}) {
  return new Promise((resolve, reject) => {
    loader.load(url, (obj) => {
      convertMaterials(obj);
      // Shrink oversized shoes on Quaternius characters (scale foot bones).
      if (feetScale !== 1) {
        obj.traverse((o) => {
          if (o.isBone && /^Foot[LR]$/.test(o.name)) {
            o.scale.multiplyScalar(feetScale);
          }
        });
      }
      // Quaternius characters face +X; rotate the mesh root so it faces +Z.
      if (charFacePlusX) obj.rotation.y = -Math.PI / 2;
      // compute bbox
      let box = new THREE.Box3().setFromObject(obj);
      let size = box.getSize(new THREE.Vector3());

      let scale = 1;
      if (targetHeight) scale = targetHeight / size.y;
      else if (targetFootprint) scale = targetFootprint / Math.max(size.x, size.z);

      obj.scale.setScalar(scale);
      // recompute after scaling, ground it (feet at y=0) and center on XZ
      box = new THREE.Box3().setFromObject(obj);
      const size2 = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      obj.position.x += -center.x;
      obj.position.z += -center.z;
      obj.position.y += -box.min.y;

      // quaternius characters/animals face +X in their source; alias to +Z if needed
      const wrap = new THREE.Group();
      wrap.add(obj);

      // store size metadata for callers (collider heights, etc.)
      wrap.userData.size = { x: size2.x, y: size2.y, z: size2.z };
      wrap.animations = obj.animations || [];
      resolve(wrap);
    }, undefined, (err) => reject(err));
  });
}

// Public preload of everything used, returns a dict of template clones.
// Templates keep their AnimationClips on template.userData.animations.
export async function preloadAssets(onProgress) {
  const base = './assets/models/';
  const spec = {
    house1:      { file: 'House1.fbx', targetHeight: 5.5 },
    house2:      { file: 'House2.fbx', targetHeight: 5.0 },
    building4:   { file: 'Building4.fbx', targetHeight: 4.6 },
    building2s:  { file: 'Building2_Small.fbx', targetHeight: 4.0 },
    well:        { file: 'Well.fbx', targetHeight: 2.6 },
    windmill:    { file: 'Windmill.fbx', targetHeight: 8.0 },
    barn:        { file: 'Barn.fbx', targetHeight: 4.5 },
    coop:        { file: 'ChickenCoop.fbx', targetHeight: 2.0 },
    cow:         { file: 'Cow.fbx', targetHeight: 1.6 },
    horse:       { file: 'Horse.fbx', targetHeight: 2.1 },
    sheep:       { file: 'Sheep.fbx', targetHeight: 1.2 },
    pig:         { file: 'Pig.fbx', targetHeight: 0.9 },
    pug:         { file: 'Pug.fbx', targetHeight: 0.5 },
    fox:         { file: 'animal_fox.fbx', targetHeight: 0.8 },
    bird:        { file: 'animal_bird.fbx', targetHeight: 0.4 },
    manA:        { file: 'char_male_casual.fbx', targetHeight: 1.75, feetScale: 0.62, charFacePlusX: true },
    manB:        { file: 'char_male_longsleeve.fbx', targetHeight: 1.75, feetScale: 0.62, charFacePlusX: true },
    woman:       { file: 'char_female_casual.fbx', targetHeight: 1.68, feetScale: 0.62, charFacePlusX: true },
  };

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

export function instantiate(template, { x = 0, z = 0, rotY = 0, scale = 1 } = {}) {
  if (!template) return null;
  const obj = skeletonClone(template);
  obj.position.set(x, 0, z);
  obj.rotation.y = rotY;
  obj.scale.setScalar(scale);
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
