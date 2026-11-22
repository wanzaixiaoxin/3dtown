// ============================================================================
//  assets.js — load third-party free FBX models (Quaternius, CC0) via FBXLoader
//  Normalizes to meters, grounds at y=0, converts materials, plays animations.
// ============================================================================
import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { CONFIG, angle, color } from './config.js';

const ASSET_CFG = CONFIG.assets;

const loader = new FBXLoader();
const cache = new Map();     // url -> THREE.Group (original)
export const mixers = [];    // AnimationMixer list updated each frame

// Quaternius 的部分建筑包（2017 Buildings / Civilization）只有单个白色材质，
// 贴图不内嵌（FBX 不带 atlas）。按模型哈希给整栋建筑一套明快色板，
// 屋顶部分（法线朝上的独立 mesh）用深色，其余为墙体亮色。
function paintUntexturedBuildings(root) {
  // 明快的墙体色板（低饱和暖色系，与程序化街区协调）
  const palettes = [
    { wall: 0xe8e0d0, roof: 0x555c66 },   // 米白 + 青灰顶
    { wall: 0xe3d5bd, roof: 0x6b4a3a },   // 暖米 + 砖红顶
    { wall: 0xd8dcd0, roof: 0x46525c },   // 灰白 + 深蓝顶
    { wall: 0xe6d8c8, roof: 0x5d6a55 },   // 奶白 + 墨绿顶
    { wall: 0xdcd2c0, roof: 0x66605a },   // 浅灰米 + 深棕顶
    { wall: 0xe0d6c6, roof: 0x74584a },   // 米黄 + 赭石顶
  ];
  root.traverse((o) => {
    if (!o.isMesh) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    const untextured = mats.every(m => !m.map && (!m.color || m.color.getHexString() === 'ffffff'));
    if (!untextured) return;
    const seedStr = (mats[0].name || 'x') + '|' + o.name;
    let hash = 0;
    for (const ch of seedStr) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
    const palette = palettes[Math.abs(hash) % palettes.length];
    for (const m of mats) {
      m.color.set(palette.wall);
      m.roughness = 0.88;
      m.needsUpdate = true;
    }
    // 若整个 mesh 的法线都朝上（ roofs 常拆成独立 mesh），用屋顶色
    const normal = o.geometry && o.geometry.attributes.normal;
    if (normal) {
      let upCount = 0, total = 0;
      for (let i = 0; i < normal.count; i += 3) {
        total++;
        if (normal.getY(i) > 0.7) upCount++;
      }
      if (total > 0 && upCount / total > 0.6) {
        for (const m of mats) { m.color.set(palette.roof); m.needsUpdate = true; }
      }
    }
  });
}

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

// 角色部位表：id 与材质组名归一化后的结果一一对应。
// 这是模型结构的一部分（不是可调设计数据），故固定在代码里；配色本身在配置里。
export const CHARACTER_PARTS = Object.freeze([
  { id: 0, key: 'other', label: '其他' },
  { id: 1, key: 'skin',  label: '肤色' },
  { id: 2, key: 'hair',  label: '发色' },
  { id: 3, key: 'eyes',  label: '眼睛' },
  { id: 4, key: 'shirt', label: '上衣' },
  { id: 5, key: 'pants', label: '裤装' },
  { id: 6, key: 'socks', label: '袜' },
  { id: 7, key: 'shoes', label: '鞋' },
]);

// FBX 材质组名 -> 部位 id。顺序即优先级，命中即停。
const PART_PATTERNS = [
  [1, /skin|face|head|neck|hand/],
  [2, /hair|brow|lash/],
  [3, /eye|pupil|iris/],
  [4, /shirt|cloth|torso|sleeve|coat|jacket|top/],
  [5, /pant|trouser|bottom|skirt|leg/],
  [6, /sock|stocking/],
  [7, /shoe|boot|sandal|foot/],
];

function partIdFromName(name) {
  const n = (name || '').toLowerCase();
  for (const [id, pattern] of PART_PATTERNS) if (pattern.test(n)) return id;
  return 0;
}

function flattenSolidSkinnedMaterials(root) {
  root.traverse(mesh => {
    if (!mesh.isSkinnedMesh || !Array.isArray(mesh.material) || !mesh.geometry.groups.length) return;
    const materials = mesh.material;
    const geometry = mesh.geometry;
    const count = geometry.attributes.position.count;

    // 关键：在 flatten 合并材质之前，把每个顶点归属的部位存成顶点属性。
    // 之后 7 个材质合并成一个，仍能按部位精确改色（主场景 NPC 与资产馆共用）。
    const partIds = new Float32Array(count);
    for (const group of geometry.groups) {
      const id = partIdFromName(materials[group.materialIndex]?.name);
      for (let i = group.start; i < group.start + group.count; i++) {
        const vertex = geometry.index ? geometry.index.getX(i) : i;
        partIds[vertex] = id;
      }
    }
    geometry.setAttribute('partId', new THREE.BufferAttribute(partIds, 1));

    if (materials.some(m => m.map || m.transparent)) return;
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
      paintUntexturedBuildings(obj);
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

// 从配置派生模型规格；角度 token 一次性转弧度。导出符号保持不变。
export const MODEL_SPECS = Object.fromEntries(
  Object.entries(ASSET_CFG.models).map(([key, spec]) => [key, {
    ...spec,
    ...(spec.modelYaw !== undefined ? { modelYaw: angle(spec.modelYaw) } : {}),
  }]),
);

// Public preload of everything used, returns a dict of template clones.
// Templates keep their AnimationClips on template.userData.animations.
export async function preloadAssets(onProgress) {
  const base = ASSET_CFG.base;
  const spec = MODEL_SPECS;

  const keys = Object.keys(spec);
  const out = {};
  let done = 0;
  // limited concurrency (avoids connection resets on simple static servers)
  const CONCURRENCY = ASSET_CFG.concurrency;
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

const CHAR_CFG = CONFIG.characters || {};

// 配置缺失时的回退色板，保持改造前的视觉连续性。
const FALLBACK_SKIN = [0xd8a97f, 0xc58d64, 0x9c6647, 0xe5b793, 0x70452f, 0xb97d5c];
const FALLBACK_CLOTH = [0x496a86, 0x8e4b3f, 0x547147, 0x80623c, 0x765b8b, 0xa27c3d, 0x3e7b72];

const pick = (list, i) => list[((i % list.length) + list.length) % list.length];

// 套装抽牌盒：把「上衣 × 裤子」的全部组合一次性洗牌，逐张发放，抽完再重洗。
// 相比逐部位独立随机，能保证一轮之内绝不撞衫；组合数 = 上衣数 × 裤子数。
let outfitBag = [];
function drawOutfitPair() {
  const pools = CHAR_CFG.randomPools || {};
  const shirts = Array.isArray(pools.shirt) && pools.shirt.length ? pools.shirt : FALLBACK_CLOTH;
  const pants = Array.isArray(pools.pants) && pools.pants.length ? pools.pants : FALLBACK_CLOTH;
  if (!outfitBag.length) {
    for (const s of shirts) for (const p of pants) outfitBag.push([s, p]);
    for (let i = outfitBag.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = outfitBag[i]; outfitBag[i] = outfitBag[j]; outfitBag[j] = tmp;
    }
  }
  return outfitBag.pop();
}

/**
 * 生成一套随机人物配色（部位 -> THREE.Color）。
 * 肤色/发色/眼睛等独立随机；上衣与裤子来自不重复的套装抽牌盒，
 * 因此在 characters.uniqueOutfits 开启时，一轮内不会出现相同穿着。
 * 缺失的部位回退到预设色板。
 */
export function randomCharacterColors() {
  const pools = CHAR_CFG.randomPools || {};
  const preset = CHARACTER_PARTS.length && CHAR_CFG.palettes?.length
    ? CHAR_CFG.palettes[Math.floor(Math.random() * CHAR_CFG.palettes.length)]
    : null;
  const out = {};
  for (const part of CHARACTER_PARTS) {
    if (part.key === 'other') continue;
    const pool = pools[part.key];
    if (Array.isArray(pool) && pool.length) {
      out[part.key] = new THREE.Color(color(pool[Math.floor(Math.random() * pool.length)]));
    } else if (preset) {
      const raw = preset.colors?.[part.key] ?? preset[part.key];
      if (raw !== undefined) out[part.key] = new THREE.Color(color(raw));
    }
  }
  if (CHAR_CFG.uniqueOutfits !== false) {
    const [shirt, pants] = drawOutfitPair();
    out.shirt = new THREE.Color(color(shirt));
    out.pants = new THREE.Color(color(pants));
  }
  return out;
}

/** 取第 variant 套人物配色（部位 -> THREE.Color）。配置优先，缺失则回退旧色板。 */
export function characterPalette(variant = 0) {
  const palettes = CHAR_CFG.palettes;
  if (Array.isArray(palettes) && palettes.length) {
    const preset = pick(palettes, variant);
    const out = {};
    for (const part of CHARACTER_PARTS) {
      if (part.key === 'other') continue;
      const raw = preset.colors?.[part.key] ?? preset[part.key];
      if (raw !== undefined && raw !== null) out[part.key] = new THREE.Color(color(raw));
    }
    return out;
  }
  const skin = new THREE.Color(pick(FALLBACK_SKIN, variant));
  const cloth = new THREE.Color(pick(FALLBACK_CLOTH, variant * 3 + 1));
  return { skin, shirt: cloth, pants: cloth };
}

/**
 * 按部位给角色实例上色。colors: { skin, hair, shirt, ... } -> THREE.Color | hex。
 * 只改当前实例的顶点色：首次调用 clone geometry（不污染模板），后续原地更新。
 * 没有 partId 顶点属性的网格会被跳过（非人物模型安全）。
 */
export function applyCharacterColors(root, colors) {
  if (!colors || !Object.keys(colors).length) return;
  root.traverse(mesh => {
    if (!mesh.isSkinnedMesh) return;
    mesh.frustumCulled = false;
    if (!mesh.geometry.getAttribute('partId')) return;
    // 标记必须挂在 mesh 上，不能挂在 geometry 上：SkeletonUtils.clone 的实例
    // 共享 geometry，若按 geometry 判断，先前的实例会把模板/其他实例误判为已上色，
    // 导致大量人物共用同一套顶点色（撞衫的真正原因）。
    if (!mesh.userData.colorized) {
      mesh.geometry = mesh.geometry.clone();
      mesh.userData.colorized = true;
    }
    const geometry = mesh.geometry;
    const partAttr = geometry.getAttribute('partId');
    let colorAttr = geometry.getAttribute('color');
    if (!colorAttr) {
      colorAttr = new THREE.BufferAttribute(new Float32Array(partAttr.count * 3).fill(1), 3);
      geometry.setAttribute('color', colorAttr);
      geometry.material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0 });
    }
    for (let i = 0; i < partAttr.count; i++) {
      const key = CHARACTER_PARTS[Math.round(partAttr.getX(i))]?.key;
      const raw = key && colors[key];
      if (!raw) continue;
      const c = raw.isColor ? raw : new THREE.Color(color(raw));
      colorAttr.setXYZ(i, c.r, c.g, c.b);
    }
    colorAttr.needsUpdate = true;
  });
}

export function applyCharacterVariant(root, variant) {
  applyCharacterColors(root, characterPalette(variant));
}

export function instantiate(template, { x = 0, z = 0, rotY = 0, scale = 1, variant = 0, colors = null } = {}) {
  if (!template) return null;
  const obj = skeletonClone(template);
  obj.position.set(x, 0, z);
  obj.rotation.y = rotY;
  obj.scale.setScalar(scale);
  obj.traverse(mesh => { if (mesh.isSkinnedMesh) mesh.frustumCulled = false; });
  if (colors) applyCharacterColors(obj, colors);
  else if (variant) applyCharacterVariant(obj, variant);
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
