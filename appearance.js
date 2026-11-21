// ============================================================================
//  appearance.js — NPC 外观多样化：年龄段体型 + 发型 + 服饰款式
//  体型用非均匀缩放实现；发型/服饰是挂在骨骼上的程序化几何，跟随人物动作。
//  所有几何与材质登记到 disposables，场景销毁时统一释放。
// ============================================================================
import * as THREE from 'three';
import { CONFIG } from './config.js';

const AP_CFG = CONFIG.characterAppearance || {};

// 配置里的颜色是 "0xRRGGBB" 字符串，转成数值。
function hex(value, fallback) {
  if (typeof value === 'string' && /^(0x|#)[0-9a-f]{6}$/i.test(value)) return Number(value.replace('#', '0x'));
  return Number.isFinite(value) ? value : fallback;
}

// 共享材质缓存（按 hex 颜色），避免几十个 NPC 各建一份材质。
const materialCache = new Map();
function mat(value) {
  const c = hex(value, 0x888888);
  if (!materialCache.has(c)) materialCache.set(c, new THREE.MeshStandardMaterial({ color: c, roughness: 0.9, metalness: 0 }));
  return materialCache.get(c);
}

export const disposables = { geometries: [], materials: [] };
function track(geo) { disposables.geometries.push(geo); return geo; }

// 稳定伪随机：同一 seed 得到同一外观，流动人口复用实例时外观不变。
function rng(seed) {
  let s = (seed >>> 0) || 1;
  return () => {
    s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
    return ((s >>> 0) % 100000) / 100000;
  };
}
const pick = (arr, r) => arr[Math.floor(r() * arr.length) % arr.length];

// ---------------------------------------------------------------------------
// 年龄段体型：以成年为 1.0。儿童整体矮小、头身比更大；少年略矮；老者微佝偻。
// ---------------------------------------------------------------------------
const AGES = AP_CFG.ages || {
  child:  { weight: 0.14, scale: { x: 0.66, y: 0.62, z: 0.66 }, headBoost: 1.18, hair: 0x2a1d14 },
  teen:   { weight: 0.16, scale: { x: 0.88, y: 0.86, z: 0.88 }, headBoost: 1.07, hair: 0x241910 },
  adult:  { weight: 0.50, scale: { x: 1.00, y: 1.00, z: 1.00 }, headBoost: 1.00, hair: 0x1d150f },
  senior: { weight: 0.20, scale: { x: 0.97, y: 0.95, z: 0.97 }, headBoost: 0.99, hair: 0x9a9086 },
};

function chooseAge(r) {
  const entries = Object.entries(AGES);
  let total = 0; for (const [, a] of entries) total += (a.weight ?? 1);
  let x = r() * total;
  for (const [key, a] of entries) {
    x -= (a.weight ?? 1);
    if (x <= 0) return key;
  }
  return entries[entries.length - 1][0];
}

// ---------------------------------------------------------------------------
// 发型：挂在 Head 骨骼上。Head 局部 +Y 为头顶、+Z 为面部前方，骨骼世界尺度约 0.363。
// 因此局部坐标 = 世界尺寸 / 0.363。下面用局部尺寸书写。
// ---------------------------------------------------------------------------
const SKIN_SCALE = 0.363; // FBX 归一化后骨骼的世界缩放，用于把世界尺寸换算成局部
const L = (world) => world / SKIN_SCALE;

// 发型 builders：返回要挂到 head 的 mesh 数组（局部坐标）
function buildHair(style, hairHex, r) {
  const out = [];
  const material = mat(hairHex);
  const add = (geo, x, y, z, rx = 0, ry = 0, rz = 0) => {
    const m = new THREE.Mesh(track(geo), material);
    m.position.set(x, y, z); m.rotation.set(rx, ry, rz);
    m.castShadow = false; m.receiveShadow = false; m.userData.appearancePart = true;
    out.push(m);
    return m;
  };
  // 模型自带头发作为基础发型（发色由配色控制），这里只加顶部小装饰，避免重复覆盖
  // 形成大黑块。Head 骨局部 +Y 是头顶：世界 +0.18m 处≈局部 y=0.5；头宽世界≈±0.1m。
  // 装饰件世界半径控制在 4~6cm，明显小于头，位置抬到头顶或后脑上方。
  switch (style) {
    case 'bald':      // 光头：不挂；发色由调用方染成肤色
    case 'short':     // 短发：模型自带
    case 'buzz':      // 寸头：模型自带（靠发色深浅区分）
    case 'long':      // 长发：woman/manB 模型自带
      break;
    case 'topknot': { // 男子束发：小髻 + 发簪 + 发带
      const y = L(0.19);
      add(new THREE.SphereGeometry(L(0.052), 12, 10), 0, y, -L(0.02));
      add(new THREE.CylinderGeometry(L(0.007), L(0.007), L(0.20), 8), 0, y + L(0.01), -L(0.02), 0, 0, Math.PI / 2);
      add(new THREE.TorusGeometry(L(0.05), L(0.009), 6, 12), 0, y - L(0.035), -L(0.02), Math.PI / 2, 0, 0);
      break;
    }
    case 'bun': {     // 女子发髻：脑后上方小髻 + 横簪
      const y = L(0.14), z = -L(0.10);
      add(new THREE.SphereGeometry(L(0.058), 12, 10), 0, y, z);
      add(new THREE.CylinderGeometry(L(0.007), L(0.007), L(0.22), 8), 0, y, z, 0, 0, Math.PI / 2);
      break;
    }
    case 'double': {  // 女童双丫髻：头顶两侧对称小揪（贴在头顶，不是脸侧）
      const x = L(0.062), y = L(0.17);
      add(new THREE.SphereGeometry(L(0.044), 12, 10), x, y, 0);
      add(new THREE.SphereGeometry(L(0.044), 12, 10), -x, y, 0);
      add(new THREE.TorusGeometry(L(0.038), L(0.007), 6, 10), x, y - L(0.03), 0, Math.PI / 2, 0, 0);
      add(new THREE.TorusGeometry(L(0.038), L(0.007), 6, 10), -x, y - L(0.03), 0, Math.PI / 2, 0, 0);
      break;
    }
    case 'elderbun': {// 老者：小髻 + 布带（灰白）
      const y = L(0.17), z = -L(0.03);
      add(new THREE.SphereGeometry(L(0.042), 12, 10), 0, y, z);
      add(new THREE.TorusGeometry(L(0.045), L(0.009), 6, 12), 0, y - L(0.03), z, Math.PI / 2, 0, 0);
      break;
    }
    default:
      break;
  }
  return out;
}

// ---------------------------------------------------------------------------
// 头饰：按服饰款式戴帽（远景可辨的款式标志）。挂 Head 骨，位置在头顶。
// ---------------------------------------------------------------------------
function buildHeadwear(style, r) {
  const HW = AP_CFG.headwear || {};
  const kind = style?.headwear || 'none';
  if (kind === 'none' || !HW[kind]) return [];
  const spec = HW[kind];
  const material = mat(spec.color ?? 0x3a3128);
  const accent = mat(spec.accent ?? 0x211a14);
  const out = [];
  const add = (geo, material_, x, y, z, rx = 0, ry = 0, rz = 0) => {
    const m = new THREE.Mesh(track(geo), material_);
    m.position.set(x, y, z); m.rotation.set(rx, ry, rz);
    m.castShadow = false; m.receiveShadow = false; m.userData.appearancePart = true;
    out.push(m); return m;
  };
  const top = L(0.205); // 头顶高度
  if (kind === 'conical') { // 斗笠：宽檐锥帽，农户/脚夫
    add(new THREE.ConeGeometry(L(0.26), L(0.16), 14), material, 0, top + L(0.05), 0);
    add(new THREE.CylinderGeometry(L(0.27), L(0.27), L(0.012), 16), material, 0, top - L(0.01), 0);
  } else if (kind === 'skullcap') { // 瓜皮帽：半球 + 顶珠，商贾
    add(new THREE.SphereGeometry(L(0.115), 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), material, 0, top, 0);
    add(new THREE.SphereGeometry(L(0.022), 8, 6), accent, 0, top + L(0.11), 0);
    add(new THREE.TorusGeometry(L(0.115), L(0.012), 6, 14), accent, 0, top - L(0.01), 0, Math.PI / 2, 0, 0);
  } else if (kind === 'square') { // 方巾：书生方顶帽（帽身扣在头顶，两侧下垂的折角）
    add(new THREE.BoxGeometry(L(0.19), L(0.09), L(0.18)), material, 0, top + L(0.005), 0);
    // 帽檐（贴头顶的一圈布）
    add(new THREE.BoxGeometry(L(0.22), L(0.025), L(0.21)), accent, 0, top - L(0.04), 0);
    // 后方垂下的两条布带（书生巾的典型特征）
    add(new THREE.BoxGeometry(L(0.035), L(0.13), L(0.012)), material, L(0.075), top - L(0.10), -L(0.09));
    add(new THREE.BoxGeometry(L(0.035), L(0.13), L(0.012)), material, -L(0.075), top - L(0.10), -L(0.09));
  } else if (kind === 'scarf') { // 布巾：伙计/短褐裹头
    add(new THREE.SphereGeometry(L(0.118), 12, 10, 0, Math.PI * 2, 0, Math.PI * 0.5), material, 0, top - L(0.01), 0);
    add(new THREE.TorusGeometry(L(0.116), L(0.018), 6, 14), accent, 0, top - L(0.03), 0, Math.PI / 2, 0, 0);
  }
  return out;
}

// ---------------------------------------------------------------------------
// 服饰款式：配色主题（由调用方通过 colors 应用）+ 挂件（腰带/香囊/头饰）
// ---------------------------------------------------------------------------
const OUTFITS = AP_CFG.outfits || [
  { name: '布衣', sash: 0x6b5a42, headwear: 'none' },
  { name: '短褐', sash: 0x4a3b30, headwear: 'none' },
  { name: '商贾', sash: 0x8c6a2f, headwear: 'skullcap' },
  { name: '书生', sash: 0x4f5f6b, headwear: 'square' },
  { name: '伙计', sash: 0x7a5233, headwear: 'none' },
  { name: '农户', sash: 0x5c6b48, headwear: 'conical' },
];

function buildAccessories(style) {
  const add = (parent, geo, material, x, y, z, rx = 0, ry = 0, rz = 0) => {
    const m = new THREE.Mesh(track(geo), material);
    m.position.set(x, y, z); m.rotation.set(rx, ry, rz);
    m.castShadow = false; m.receiveShadow = false; m.userData.appearancePart = true;
    parent.add(m);
    return m;
  };

  // 腰带使用薄圆筒布带，避免粗圆管在骨骼缩放后呈现“游泳圈”外观。
  return { style, build(abdomenBone) {
    if (!abdomenBone) return;
    const waist = mat(style.sash);
    add(abdomenBone, new THREE.CylinderGeometry(L(0.125), L(0.125), L(0.035), 16, 1, true), waist);
    // 香囊：部分款式在腰侧挂一个小囊
    if (style.name === '商贾' || style.name === '书生') {
      add(abdomenBone, new THREE.SphereGeometry(L(0.035), 8, 6), mat(0x8c3a2e), L(0.16), L(-0.06), 0);
    }
  }};
}

// ---------------------------------------------------------------------------
// 对外：为一个人物生成外观档案
// ---------------------------------------------------------------------------
export function makeAppearance(seed, gender = 'male', opts = {}) {
  const r = rng(seed * 2654435761 + 12345);
  const ageKey = opts.forceAge || chooseAge(r);
  const age = AGES[ageKey];
  const outfit = pick(OUTFITS, r);
  const hasHeadwear = !!outfit.headwear && outfit.headwear !== 'none';
  let hairStyle;
  // 戴帽款式用短发（帽子盖住头顶，发髻会穿模）；光头只在无帽款里出现。
  if (hasHeadwear) {
    hairStyle = pick(['short', 'buzz'], r);
  } else if (ageKey === 'child') hairStyle = pick(gender === 'female' ? ['double', 'short', 'buzz'] : ['double', 'buzz', 'short'], r);
  else if (ageKey === 'teen') hairStyle = pick(gender === 'female' ? ['bun', 'long', 'short'] : ['topknot', 'short', 'buzz'], r);
  else if (ageKey === 'senior') hairStyle = pick(['elderbun', 'bald', 'short'], r);
  else hairStyle = pick(gender === 'female' ? ['bun', 'long', 'topknot'] : ['topknot', 'buzz', 'short'], r);
  const bald = hairStyle === 'bald' && !hasHeadwear;
  return { seed, ageKey, age, hairStyle, outfit, gender, bald, hasHeadwear };
}

/**
 * 把外观应用到人物实例。必须在 addNPC/createGaitState 之前调用（体型缩放要先设好，
 * 这样 footRestY 记录的是缩放后的脚踝高度）。
 * @param instance 人物 group
 * @param bones createGaitState 之前需要先拿到骨骼；这里自行 traverse 收集
 * @param app makeAppearance 的结果
 */
export function applyAppearance(instance, app) {
  if (!instance || !app) return app;
  const age = app.age;
  // 体型：非均匀缩放。再把头部单独放大一点（儿童头身比更大）。
  const s = age.scale;
  instance.scale.set(s.x, s.y, s.z);
  const bones = {};
  instance.traverse(o => { if (o.isBone) bones[o.name] = o; });

  // 款式与 makeAppearance 中选的一致。
  const style = OUTFITS.find(o => o.name === app.outfit?.name) || app.outfit;
  app.hasHeadwear = !!style?.headwear && style.headwear !== 'none';

  // 发型挂到 Head。光头把头发顶点色改成肤色（由调用方 colors 处理，这里标记）。
  // 戴帽款式（斗笠/方巾/瓜皮帽/布巾）时不再叠加发髻，避免穿模；帽子本身就是款式标志。
  const head = bones['Head'];
  if (head && !app.hasHeadwear && app.hairStyle !== 'bald') {
    const hairHex = app.age.hair ?? 0x1d150f;
    for (const m of buildHair(app.hairStyle, hairHex, rng(app.seed))) head.add(m);
  }
  app.bald = app.hairStyle === 'bald' && !app.hasHeadwear;

  // 头饰挂到 Head（按款式）。
  if (head && app.hasHeadwear) for (const m of buildHeadwear(style, rng(app.seed))) head.add(m);

  // 服饰挂件挂到 Abdomen（腰带/香囊）。
  buildAccessories(style).build(bones['Abdomen']);
  app.outfitName = style?.name;
  app.sash = style?.sash;
  return app;
}

/** 供 groundFeet 使用：脚掌下沉补偿随体型高度缩放。 */
export function footDropScale(app) {
  return app?.age?.scale?.y ?? 1;
}

export function disposeAppearance() {
  disposables.geometries.forEach(g => g.dispose?.());
  disposables.geometries.length = 0;
  for (const m of materialCache.values()) m.dispose?.();
  materialCache.clear();
}
