import * as THREE from 'three';
import { M, trackGeo, disposables } from './materials.js';
import { batchStatic } from './optimize.js';
import { instantiate } from './assets.js';
import { windowVariant, getWindowVariants, setCommercialGlowHook } from './glow.js';

const districtDetails = [];
// 现代商业泛光材质（山姆式高侧窗等）：夜景统一调 emissiveIntensity
const commercialGlowMats = [];
let districtProxy = null;
setCommercialGlowHook(na => {
  const v = 0.15 + na * 2.2;
  for (const mat of commercialGlowMats) mat.emissiveIntensity = v;
});

export const CITY_ROADS = [-200, -100, 0, 100, 200];
export const ALL_ROADS = [-240, ...CITY_ROADS, 240];

// ===========================================================================
//  城市分区蓝图 —— 参照真实城市规划（北京「街坊制 + 单位大院」模式）
//  · 中心步行街核心保留：广场、池塘、花园与建造地块（世界坐标 |x|,|z| < 75）
//  · 内环 16 个 78×78 标准街坊全部占满，建筑数量按功能定密度：
//    CBD 低密高塔(6) / 居住行列式(12) / 围合院落(16) / 作坊(12) / 别墅(9)…
//  · 外环带状地块(26×78)与角部地块(26×26)：工业、农业、交通、特殊设施
//  · 坐标为街区网格单位（×3.125 = 世界米），w/d 直接用世界米
// ===========================================================================
export const CITY_ZONES = [
  // —— 内环东北象限：商务 + 居住 + 绿地 ——
  { key: 'office', label: '写字楼', x: 48, z: -48, w: 78, d: 78, color: '#61747b' },
  { key: 'apartment', label: '居民楼', x: 48, z: -16, w: 78, d: 78, color: '#807768' },
  { key: 'park', label: '城北绿地', x: 16, z: -48, w: 78, d: 78, color: '#527d48' },
  { key: 'community', label: '社区住宅', x: -16, z: -48, w: 78, d: 78, color: '#75806a', variant: 0 },
  // —— 内环西北象限：教育 + 手工业 + 居住 ——
  { key: 'school', label: '学校', x: -48, z: -48, w: 78, d: 78, color: '#8c7855' },
  { key: 'workshop', label: '作坊区', x: -48, z: -16, w: 78, d: 78, color: '#80684c' },
  { key: 'villas', label: '别墅群', x: -48, z: 16, w: 78, d: 78, color: '#73805b' },
  // —— 内环东南象限：公共服务 + 居住 ——
  { key: 'police', label: '公安局', x: 48, z: 16, w: 78, d: 78, color: '#637587' },
  { key: 'fire', label: '消防局', x: 16, z: 48, w: 78, d: 78, color: '#8b5648' },
  { key: 'community', label: '城南住宅', x: 48, z: 48, w: 78, d: 78, color: '#75806a', variant: 1 },
  // —— 内环西南象限：低密居住 + 文体 + 公园 ——
  { key: 'stadium', label: '体育场', x: -16, z: 48, w: 78, d: 78, color: '#668653' },
  { key: 'park', label: '开放式公园', x: -48, z: 48, w: 78, d: 78, color: '#527d48' },
  // —— 外环：工业 / 农业 / 交通 / 特殊设施沿城墙带状均匀布置 ——
  { key: 'factory', label: '工厂区域', x: 70, z: -48, w: 26, d: 78, color: '#756b58' },
  { key: 'logistics', label: '物流仓储', x: 70, z: -70, w: 26, d: 26, color: '#716d5e' },
  { key: 'farm', label: '农田区域', x: 70, z: 16, w: 26, d: 78, color: '#8b7747' },
  { key: 'farmWest', label: '农田区域', x: -70, z: 16, w: 26, d: 78, color: '#8b7747' },
  { key: 'prison', label: '监狱', x: -70, z: -70, w: 26, d: 26, color: '#686b68' },
  { key: 'station', label: '火车站', x: -16, z: -70, w: 78, d: 26, color: '#657782' },
  { key: 'parking', label: '公共停车场', x: -16, z: 70, w: 78, d: 26, color: '#686d6d' },
];

for (const zone of CITY_ZONES) {
  zone.x = Math.max(-220, Math.min(220, Math.round(zone.x * 3.125)));
  zone.z = Math.max(-220, Math.min(220, Math.round(zone.z * 3.125)));
}

// 街坊填充：未被功能分区占用的内环街坊布置通用居住街坊，外环留作城郊开阔地
const INFILL_NAMES = ['综合市场', '社区服务中心', '商住混合区', '仓储配套区', '工匠作坊', '城市公寓'];
const BLOCK_CENTERS = [-220, -150, -50, 50, 150, 220];
let infillIndex = 0;
for (const x of BLOCK_CENTERS) for (const z of BLOCK_CENTERS) {
  if (Math.abs(x) < 75 && Math.abs(z) < 75) continue; // 中央广场、池塘、花园和建造地块
  if (CITY_ZONES.some(zone => Math.hypot(zone.x - x, zone.z - z) < 12)) continue;
  if (Math.abs(x) > 180 && Math.abs(z) < 180 && infillIndex % 2) continue; // 外环留白，避免城郊拥挤
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

export function buildDistricts(parent, { buildHouse: baseHouse, buildTree: baseTree, colliders, assets = null }) {
  districtDetails.length = 0;
  const m = M();
  const dummy = new THREE.Object3D();
  let activeZone = { x: 0, z: 0 };
  const materialCache = new Map();
  const mat = value => {
    if (!materialCache.has(value)) {
      const material = new THREE.MeshStandardMaterial({ color: value, roughness: 0.9 });
      // 地坪与其他贴地几何共面区域较多，轻微深度偏移防 z-fighting
      material.polygonOffset = true;
      material.polygonOffsetFactor = -1;
      material.polygonOffsetUnits = -1;
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
  const groundBox = (group, w, d, material, x, z) => box(group, w, 0.1, d, material, x, 0.05, z);
  const ground = (group, zone, color) => groundBox(group, zone.w, zone.d, mat(color), 0, 0);
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

  // 放置一个 FBX 模型实例（CC0 建筑资产），按footprint对齐、落地面 y=0，注册碰撞体。
  // 模型缺失时回退到程序化 buildHouse，保证任何资产子集下街区都能完整成形。
  // 每个实例按 (key,x,z) 哈希做轻度和色偏移（保持 paintUntexturedBuildings 的主色，
  // 只做明度/色相微调），避免同款模型复制粘贴感又不破坏配色体系。
  function tintHash(str) {
    let h = 0;
    for (const ch of str) h = (h * 31 + ch.charCodeAt(0)) | 0;
    return Math.abs(h);
  }
  function applyTint(inst, key, x, z, seed) {
    // 微调量：亮度 ±8%，色相 ±4°，2 档屋顶加亮
    const h = tintHash(key + ':' + x + ':' + z + ':' + seed);
    const mul = 0.92 + (h % 5) * 0.04;               // 0.92–1.08
    const hueShift = ((h >> 3) % 9 - 4) / 60;        // ±0.067 hue
    const lift = (h >> 6) % 3 === 0;                 // 1/3 概率墙体加亮一档
    const _c = new THREE.Color();
    inst.traverse(o => {
      if (!o.isMesh) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const mm of mats) {
        if (mm.map) continue;
        if (!mm.color) continue;
        const hex = mm.color.getHexString();
        if (hex === 'ffffff') continue;              // 他人负责的白模不碰
        _c.copy(mm.color);
        const hsl = {};
        _c.getHSL(hsl);
        _c.setHSL(
          (hsl.h + hueShift + 1) % 1,
          Math.min(1, hsl.s * 1.05),
          Math.min(0.85, Math.max(0.12, hsl.l * mul + (lift ? 0.05 : 0))),
        );
        mm.color.copy(_c);
      }
    });
  }
  function assetHouse(group, key, x, z, rotY, fbw, fbd, fbH, opts = {}) {
    const template = assets?.[key];
    if (!template) {
      return buildHouse(group, x, z, fbw, fbd, fbH, { roofMat: m.roofGrey, lanterns: false, ...opts });
    }
    // group 已定位在分区原点，实例只需局部坐标（batchStatic 以局部变换烘焙后由 group 定位）
    const inst = instantiate(template, { x, z, rotY });
    applyTint(inst, key, x, z, opts.seed || 0);
    group.add(inst);
    const hw = Math.max(fbw / 2, 2), hd = Math.max(fbd / 2, 2);
    colliders.push({
      minX: activeZone.x + x - hw, maxX: activeZone.x + x + hw,
      minZ: activeZone.z + z - hd, maxZ: activeZone.z + z + hd, top: fbH, kind: 'house',
    });
    return inst;
  }

  function sign(group, text, x, z, color) {
    box(group, 4.8, 0.85, 0.15, m.woodDark, x, 2.8, z);
    box(group, 0.1, 2.4, 0.1, m.woodDark, x - 2, 1.2, z);
    box(group, 0.1, 2.4, 0.1, m.woodDark, x + 2, 1.2, z);
    const material = new THREE.MeshStandardMaterial({ map: labelTexture(text, color), roughness: 0.85 });
    disposables.materials.push(material);
    add(group, new THREE.PlaneGeometry(4.55, 0.68), material, x, 2.8, z + 0.09);
  }

  // 围墙大院（单位大院模式）：四周围墙 + 北向大门
  function compoundWall(group, color) {
    const S = 34, H = 2.4, T = 0.7, gap = 8;
    const wallMat = mat(color);
    for (const s of [-1, 1]) {
      box(group, S * 2 + T, H, T, wallMat, 0, H / 2, s * S);
      box(group, T, H, S * 2, wallMat, s * S, H / 2, 0);
    }
    const seg = S - gap / 2;
    for (const s of [-1, 1]) {
      box(group, seg, H, T, wallMat, s * (gap / 2 + seg / 2), H / 2, -S);
      collider(s * (gap / 2 + seg / 2), -S, seg, T, H, 'wall');
    }
    for (const s of [-1, 1]) box(group, 0.9, 3.2, 0.9, m.stoneDk, s * (gap / 2 + 0.45), 1.6, -S);
    box(group, gap + 1, 0.5, 0.9, mat(0xb75b45), 0, 3.3, -S);
    collider(0, S, S * 2, T, H, 'wall');
    collider(-S, 0, T, S * 2, H, 'wall');
    collider(S, 0, T, S * 2, H, 'wall');
  }

  // ---- 现代建筑工艺 ---------------------------------------------------------
  // 共享材质（有质感）：玻璃幕墙（半镜面）、竖向翼板、金属收边
  let _glassMat = null, _finsMat = null, _mullionMat = null;
  const glassMat = () => {
    if (!_glassMat) {
      _glassMat = new THREE.MeshStandardMaterial({
        color: 0x2e4a5c, roughness: 0.18, metalness: 0.55, envMapIntensity: 1.4,
      });
      disposables.materials.push(_glassMat);
    }
    return _glassMat;
  };
  const finsMat = () => {
    if (!_finsMat) {
      _finsMat = new THREE.MeshStandardMaterial({ color: 0xb8bec4, roughness: 0.5, metalness: 0.35 });
      disposables.materials.push(_finsMat);
    }
    return _finsMat;
  };
  const mullionMat = () => {
    if (!_mullionMat) {
      _mullionMat = new THREE.MeshStandardMaterial({ color: 0x3a4248, roughness: 0.6, metalness: 0.3 });
      disposables.materials.push(_mullionMat);
    }
    return _mullionMat;
  };

  // 摩天楼：分段退台体量 + 玻璃幕墙 + 竖向翼板 + 顶部设备层 + 屋顶航空灯
  // 参照陆家嘴/珠江新城玻璃塔楼；翼板/楼层线全部走实例化合批，避免上千 draw call
  function skyscraper(group, x, z, w, d, height, opts = {}) {
    const glass = opts.glass || glassMat();
    const body = opts.body || mat(opts.bodyColor ?? 0x9aa5ad);
    const fins = finsMat();
    const mull = mullionMat();
    const segs = opts.segments || 3;                     // 退台段数
    const segH = height / segs;
    const finTransforms = [];                            // 待实例化翼板
    const mullTransforms = [];                           // 待实例化楼层线
    let cw = w, cd = d;
    for (let s = 0; s < segs; s++) {
      const bh = segH * (s === segs - 1 ? 0.82 : 1);     // 顶段留设备层
      const y = segH * s;
      // 幕墙主体
      box(group, cw, bh, cd, glass, x, y + bh / 2, z);
      // 每段顶部压顶石
      box(group, cw + 0.5, 0.45, cd + 0.5, body, x, y + bh + 0.22, z);
      // 竖向翼板（四立面）：把玻璃面切成有节奏的竖条
      const nFins = Math.max(3, Math.round(cw / 4.5));
      for (let fi = 0; fi < nFins; fi++) {
        const fx = x - cw / 2 + (fi + 0.5) * (cw / nFins);
        finTransforms.push([fx, y + bh / 2, z - cd / 2 - 0.18, 1, bh - 0.4]);
        finTransforms.push([fx, y + bh / 2, z + cd / 2 + 0.18, 1, bh - 0.4]);
      }
      const nFinsZ = Math.max(3, Math.round(cd / 4.5));
      for (let fi = 0; fi < nFinsZ; fi++) {
        const fz = z - cd / 2 + (fi + 0.5) * (cd / nFinsZ);
        finTransforms.push([x - cw / 2 - 0.18, y + bh / 2, fz, 0, bh - 0.4]);
        finTransforms.push([x + cw / 2 + 0.18, y + bh / 2, fz, 0, bh - 0.4]);
      }
      // 横向楼层线（收边）
      for (let fy = 1.6; fy < bh - 0.6; fy += 5.5) {
        mullTransforms.push([x, y + fy, z, cw + 0.12, cd + 0.12]);
      }
      // 退台
      cw *= 0.86; cd *= 0.86;
    }
    // 翼板实例网格：dims [x,z,orientation,height]
    if (finTransforms.length) {
      const inst = new THREE.InstancedMesh(trackGeo(new THREE.BoxGeometry(0.22, 1, 0.32)), fins, finTransforms.length);
      finTransforms.forEach(([fx, fy, fz, o, fh], i) => {
        dummy.position.set(fx, fy, fz);
        dummy.rotation.set(0, o ? Math.PI / 2 : 0, 0);
        dummy.scale.set(1, fh, 1);
        dummy.updateMatrix(); inst.setMatrixAt(i, dummy.matrix);
      });
      inst.instanceMatrix.needsUpdate = true;
      inst.castShadow = false; inst.receiveShadow = true; inst.userData.noBatch = true;
      group.add(inst);
    }
    if (mullTransforms.length) {
      const inst = new THREE.InstancedMesh(trackGeo(new THREE.BoxGeometry(1, 0.1, 1)), mull, mullTransforms.length);
      mullTransforms.forEach(([mx, my, mz, mw, md], i) => {
        dummy.position.set(mx, my, mz);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(mw, 1, md);
        dummy.updateMatrix(); inst.setMatrixAt(i, dummy.matrix);
      });
      inst.instanceMatrix.needsUpdate = true;
      inst.castShadow = false; inst.receiveShadow = true; inst.userData.noBatch = true;
      group.add(inst);
    }
    // 夜景窗灯：每层四立面的细亮条，用 5 种 windowLit 变体错落点亮（夜景自动发光）
    const litGroups = new Map();   // variantIndex -> transforms
    for (let s = 0; s < segs; s++) {
      const bh = segH * (s === segs - 1 ? 0.82 : 1);
      const y = segH * s;
      for (let fy = 2.6; fy < bh - 1.2; fy += 3.4) {
        const litY = y + fy;
        const nLit = Math.max(2, Math.round(cw / 6));
        for (let li = 0; li < nLit; li++) {
          const lx = x - cw / 2 + (li + 0.5) * (cw / nLit);
          const vi = Math.abs(Math.round(lx * 7.3 + litY * 3.1)) % 5;
          if (!litGroups.has(vi)) litGroups.set(vi, []);
          litGroups.get(vi).push([lx, litY, z - cd / 2 - 0.14, cw / nLit * 0.8, 0, 0.9]);
          litGroups.get(vi).push([lx, litY, z + cd / 2 + 0.14, cw / nLit * 0.8, 0, 0.9]);
        }
        const nLitZ = Math.max(2, Math.round(cd / 6));
        for (let li = 0; li < nLitZ; li++) {
          const lz = z - cd / 2 + (li + 0.5) * (cd / nLitZ);
          const vi = Math.abs(Math.round(lz * 5.7 + litY * 2.3)) % 5;
          if (!litGroups.has(vi)) litGroups.set(vi, []);
          litGroups.get(vi).push([x - cw / 2 - 0.14, litY, lz, 0, cd / nLitZ * 0.8, 0.9]);
          litGroups.get(vi).push([x + cw / 2 + 0.14, litY, lz, 0, cd / nLitZ * 0.8, 0.9]);
        }
      }
      cw *= 0.86; cd *= 0.86;
    }
    for (const [vi, list] of litGroups) {
      const inst = new THREE.InstancedMesh(trackGeo(new THREE.BoxGeometry(1, 1, 1)), getWindowVariants()[vi], list.length);
      list.forEach(([lx, ly, lz, lw, ld, lh], i) => {
        dummy.position.set(lx, ly, lz);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(lw || 0.1, lh, ld || 0.1);
        dummy.updateMatrix(); inst.setMatrixAt(i, dummy.matrix);
      });
      inst.instanceMatrix.needsUpdate = true;
      inst.castShadow = false; inst.receiveShadow = false; inst.userData.noBatch = true;
      group.add(inst);
    }
    // 顶部设备层 + 航空障碍灯
    const topY = height;
    box(group, cw * 0.9, 2.2, cd * 0.9, mat(0x6a7078), x, topY + 1.1, z);
    box(group, cw * 0.4, 0.6, cd * 0.4, mull, x, topY + 2.6, z);
    box(group, 0.5, 0.5, 0.5, new THREE.MeshStandardMaterial({
      color: 0xd8442e, emissive: 0xd8442e, emissiveIntensity: 0.9,
    }), x, topY + 3.1, z);
    // 底部玻璃裙楼（两层通高商业）
    if (!opts.noPodium) {
      box(group, w + 5, 5.2, d + 5, glass, x, 2.6, z);
      box(group, w + 5.5, 0.4, d + 5.5, body, x, 5.4, z);
      // 裙楼入口雨棚
      box(group, 7, 0.3, 3, body, x, 5.9, z - (d + 5) / 2 - 1.2);
      for (const px of [-3, 3]) box(group, 0.25, 3.2, 0.25, mull, x + px, 3.2, z - (d + 5) / 2 - 1.2);
      collider(x, z, w + 6, d + 6, height + 3, 'house');
    } else {
      collider(x, z, w, d, height + 3, 'house');
    }
  }

  // 现代高层住宅塔（恒大/碧桂园式）：米色/暖色塔身 + 白色阳台横带 + 裙楼车库
  // 阳台板/窗带每塔 4 条 × 楼层，全部合批为每塔 2 个 InstancedMesh
  function residentialTower(group, x, z, w, d, height, opts = {}) {
    const wall = mat(opts.wall ?? 0xd8c9b0);
    const accent = mat(opts.accent ?? 0x8a6a50);         // 底部基座暖棕
    const band = mat(0xf2ede2);                          // 阳台横带米白
    const glass = glassMat();
    const bodyH = height - 1.2;
    // 塔身
    box(group, w, bodyH, d, wall, x, bodyH / 2, z);
    // 阳台横带 + 窗带（实例化）
    const floors = Math.max(3, Math.round(bodyH / 3));
    const bandT = [], winT = [];
    for (let f = 0; f < floors; f++) {
      const fy = 2.2 + f * (bodyH / floors);
      bandT.push([x, fy, z, w + 0.7, d + 0.7]);          // 阳台板
      bandT.push([x, fy + 0.5, z, w + 0.4, d + 0.4]);    // 栏板
      winT.push([x, fy + 1.2, z - d / 2 - 0.05, w * 0.92, 0, 1.1]);
      winT.push([x, fy + 1.2, z + d / 2 + 0.05, w * 0.92, 0, 1.1]);
      winT.push([x - w / 2 - 0.05, fy + 1.2, z, d * 0.92, 1, 1.1]);
      winT.push([x + w / 2 + 0.05, fy + 1.2, z, d * 0.92, 1, 1.1]);
    }
    const bandInst = new THREE.InstancedMesh(trackGeo(new THREE.BoxGeometry(1, 0.55, 1)), band, bandT.length);
    bandT.forEach(([bx, by, bz, bw, bd], i) => {
      dummy.position.set(bx, by, bz); dummy.rotation.set(0, 0, 0); dummy.scale.set(bw, 1, bd);
      dummy.updateMatrix(); bandInst.setMatrixAt(i, dummy.matrix);
    });
    bandInst.instanceMatrix.needsUpdate = true; bandInst.castShadow = false; bandInst.receiveShadow = true;
    bandInst.userData.noBatch = true;
    group.add(bandInst);
    const winInst = new THREE.InstancedMesh(trackGeo(new THREE.BoxGeometry(1, 1, 1)), glass, winT.length);
    winT.forEach(([wx, wy, wz, wl, o, wh], i) => {
      dummy.position.set(wx, wy, wz);
      dummy.rotation.set(0, o ? Math.PI / 2 : 0, 0);
      dummy.scale.set(o ? 0.1 : wl, wh, o ? wl : 0.1);
      dummy.updateMatrix(); winInst.setMatrixAt(i, dummy.matrix);
    });
    winInst.instanceMatrix.needsUpdate = true; winInst.castShadow = false; winInst.receiveShadow = true;
    winInst.userData.noBatch = true;
    group.add(winInst);
    // 夜景窗灯：每层两条错落亮条（windowLit 变体，夜间自动发光）
    const litT = [];
    for (let f = 0; f < floors; f++) {
      const fy = 2.2 + f * (bodyH / floors);
      const side = f % 2 === 0 ? 1 : -1;
      litT.push([x + side * w * 0.18, fy + 1.2, z - d / 2 - 0.09, w * 0.42, 0, 1.15]);
      litT.push([x - side * w * 0.18, fy + 1.2, z + d / 2 + 0.09, w * 0.42, 0, 1.15]);
    }
    const litMap = new Map();
    litT.forEach(([lx, ly, lz, lw, ld, lh]) => {
      const vi = Math.abs(Math.round(lx * 9.1 + ly * 4.7 + lz * 6.3)) % 5;
      if (!litMap.has(vi)) litMap.set(vi, []);
      litMap.get(vi).push([lx, ly, lz, lw, ld, lh]);
    });
    for (const [vi, list] of litMap) {
      const inst = new THREE.InstancedMesh(trackGeo(new THREE.BoxGeometry(1, 1, 1)), getWindowVariants()[vi], list.length);
      list.forEach(([lx, ly, lz, lw, ld, lh], i) => {
        dummy.position.set(lx, ly, lz); dummy.rotation.set(0, 0, 0);
        dummy.scale.set(lw || 0.1, lh, ld || 0.1);
        dummy.updateMatrix(); inst.setMatrixAt(i, dummy.matrix);
      });
      inst.instanceMatrix.needsUpdate = true; inst.castShadow = false; inst.receiveShadow = false;
      inst.userData.noBatch = true;
      group.add(inst);
    }
    // 顶部收边 + 设备
    box(group, w + 0.5, 0.5, d + 0.5, accent, x, bodyH + 0.25, z);
    box(group, w * 0.3, 1.2, d * 0.3, accent, x, bodyH + 1.0, z);
    // 底部基座（两层商业/门厅）+ 单元入口
    box(group, w + 2.5, 4.2, d + 2.5, accent, x, 2.1, z);
    box(group, w + 3, 0.35, d + 3, band, x, 4.4, z);
    box(group, 5, 3.4, 0.4, glass, x, 1.8, z - (d + 2.5) / 2 - 0.1);
    box(group, 6, 0.35, 2.2, band, x, 4.0, z - (d + 2.5) / 2 - 0.8);
    collider(x, z, w + 3, d + 3, height, 'house');
  }

  // 大型商业体（山姆/武商/SKP 式）：大体量盒子 + 巨型门头 + 玻璃条窗 + 屋顶停车场
  function bigBoxMall(group, x, z, w, d, height, opts = {}) {
    const body = mat(opts.body ?? 0xc9c2b4);             // 大面米灰实体墙
    const band = mat(opts.band ?? 0x5b4632);             // 深色木质腰线
    const glass = glassMat();
    const sign = mat(opts.sign ?? 0x8a2f2a);             // 商标红
    // 主体
    box(group, w, height, d, body, x, height / 2, z);
    // 竖向实墙分隔（把大盒子切成有节奏的开间）
    const bays = Math.max(4, Math.round(w / 9));
    for (let i = 1; i < bays; i++) {
      const bx = x - w / 2 + i * (w / bays);
      box(group, 0.5, height, 0.5, band, bx, height / 2, z - d / 2 - 0.2);
    }
    // 高侧窗带（上部通长玻璃带，仓储超市特征）——夜间整条发白光（商业泛光）
    const shopGlow = new THREE.MeshStandardMaterial({
      color: 0x24313a, emissive: 0xfff3d8, emissiveIntensity: 0.0, roughness: 0.4,
    });
    disposables.materials.push(shopGlow);
    commercialGlowMats.push(shopGlow);   // 注册进夜景联动列表
    box(group, w * 0.96, 1.6, 0.12, shopGlow, x, height * 0.72, z - d / 2 - 0.06);
    box(group, w * 0.96, 1.6, 0.12, shopGlow, x, height * 0.72, z + d / 2 + 0.06);
    box(group, 0.12, 1.6, d * 0.9, shopGlow, x - w / 2 - 0.06, height * 0.72, z);
    box(group, 0.12, 1.6, d * 0.9, shopGlow, x + w / 2 + 0.06, height * 0.72, z);
    // 腰线
    box(group, w + 0.6, 0.8, d + 0.6, band, x, height * 0.55, z);
    box(group, w + 0.6, 0.35, d + 0.6, band, x, height + 0.15, z);
    // 巨型门头：两层高通高玻璃入口 + 大雨棚 + 商标色块
    box(group, 14, 6.5, 0.5, glass, x, 3.25, z - d / 2 - 0.3);
    box(group, 16, 0.5, 4.5, sign, x, 7.0, z - d / 2 - 1.8);      // 红色大挑檐（logo 带位）
    box(group, 12, 1.6, 0.3, sign, x, 8.6, z - d / 2 - 0.4);      // 门头招牌色块
    for (const px of [-7.5, 0, 7.5]) box(group, 0.4, 7, 0.4, band, x + px, 3.5, z - d / 2 - 0.55);
    // 次入口
    box(group, 6, 3.2, 0.4, glass, x - w / 2 - 0.3, 1.7, z - d * 0.25);
    // 屋顶设备（空调机组排布）
    for (let i = 0; i < 4; i++) {
      box(group, 2.2, 1.0, 1.6, mat(0x9aa0a6), x - w * 0.28 + i * (w * 0.18), height + 0.9, z + d * 0.2);
    }
    collider(x, z, w + 2, d + 6, height + 1.5, 'house');
  }

  // ---- 内环街坊蓝图 -------------------------------------------------------

  // CBD：摩天楼群（4 主塔 + 2 副塔退台）+ 中央广场 —— 都市天际线
  function cbdBlock(group, zone) {
    ground(group, zone, 0x8b9298);
    groundBox(group, 30, 30, mat(0xa3a9ad), 0, 0);
    skyscraper(group, -24, -24, 16, 16, 46, { bodyColor: 0x8fa3b0 });
    skyscraper(group, 6, -26, 14, 14, 58, { bodyColor: 0x7f98a8, segments: 4 });
    skyscraper(group, 30, -22, 12, 12, 38, { bodyColor: 0xa8b4ba });
    skyscraper(group, -28, 22, 13, 13, 42, { bodyColor: 0x93a8b4, segments: 4 });
    skyscraper(group, 4, 26, 17, 15, 64, { bodyColor: 0x6f8a9c, segments: 4 });
    skyscraper(group, 30, 24, 11, 11, 34, { bodyColor: 0x9db0b8 });
    for (const [x, z] of [[-36, 0], [36, 0], [0, -36], [0, 36], [-36, -8], [36, 8]]) buildTree(group, x, z, 0.9);
    for (const [x, z] of [[-12, -6], [12, 6], [-14, 12], [14, -12]]) {
      groundBox(group, 7, 7, mat(0x74884f), x, z);
      buildTree(group, x, z, 1.1);
    }
  }

  // 居民楼小区：4 栋高层住宅塔 + 中轴景观带（现代商品房小区形态）
  function apartmentBlock(group, zone) {
    ground(group, zone, 0x7c8175);
    groundBox(group, zone.w - 14, 14, mat(0x6f8b57), 0, 0);
    residentialTower(group, -22, -22, 13, 11, 42, { wall: 0xd8c9b0, accent: 0x9a7350 });
    residentialTower(group, 22, -22, 12, 12, 36, { wall: 0xcfc4ae, accent: 0x8a6a50 });
    residentialTower(group, -22, 22, 12, 12, 48, { wall: 0xe0d2b8, accent: 0x9a7350 });
    residentialTower(group, 22, 22, 13, 11, 40, { wall: 0xd2c8b4, accent: 0x8a6a50 });
    // 中轴景观：水景 + 树阵 + 步道
    add(group, new THREE.CylinderGeometry(6, 6.4, 0.4, 24), m.stoneLt, 0, 0.2, 0);
    add(group, new THREE.CylinderGeometry(5.2, 5.2, 0.14, 24), m.water, 0, 0.42, 0);
    for (const z of [-10, -4, 4, 10]) {
      buildTree(group, -6, z, 0.85);
      buildTree(group, 6, z, 0.85);
      box(group, 2.2, 0.12, 0.55, m.wood, 0, 0.55, z);
    }
  }

  // 社区住宅：围合式院落 2×2 组团 共 16 栋真实民居（House1-5 轮换）
  function courtyardBlock(group, zone) {
    ground(group, zone, 0x7c8175);
    const keys = ['qhouse1', 'qhouse2', 'qhouse3', 'qhouse4', 'qhouse5'];
    let i = 0;
    for (const cx of [-18, 18]) for (const cz of [-18, 18]) {
      groundBox(group, 27, 27, mat(0x6f8b57), cx, cz);
      for (const [ox, oz, rot] of [[-8, -8, 0], [8, -8, Math.PI / 2], [8, 8, Math.PI], [-8, 8, -Math.PI / 2]]) {
        assetHouse(group, keys[i++ % keys.length], cx + ox, cz + oz, rot, 7, 6.5, 5.5);
      }
    }
  }

  // 别墅群：3×3 宅基地 共 9 座真实民居模型（最低密度居住）
  function villaQuarter(group, zone) {
    ground(group, zone, 0x72825e);
    const keys = ['qhouse3', 'qhouse1', 'qhouse5', 'qhouse2', 'qhouse4', 'qhouse1', 'qhouse5', 'qhouse3', 'qhouse2'];
    let i = 0;
    for (const x of [-24, 0, 24]) for (const z of [-24, 0, 24]) {
      groundBox(group, 15, 14, mat(0x6f8b57), x, z);
      assetHouse(group, keys[i], x, z, [0, Math.PI / 2, Math.PI, -Math.PI / 2][i % 4], 8, 6.5, 5.5);
      buildTree(group, x + 5.5, z - 5, 0.7);
      i++;
    }
  }

  // 学校：教学楼（Bank 体量）+ 两栋配楼（中世纪民居）+ 操场（篮球架、旗杆）
  function schoolCampus(group, zone) {
    ground(group, zone, 0x7c8175);
    assetHouse(group, 'bank', 0, -20, 0, 15, 12, 11);
    assetHouse(group, 'mhouse', -22, 2, Math.PI / 2, 8, 9, 6.5);
    assetHouse(group, 'mhouse', 22, 2, -Math.PI / 2, 8, 9, 6.5);
    groundBox(group, 40, 22, mat(0xa8624f), 0, 22);
    groundBox(group, 26, 14, mat(0x4f873f), 0, 22);
    for (const x of [-13, 13]) {
      add(group, new THREE.CylinderGeometry(0.09, 0.09, 3.2, 6), m.woodDark, x, 1.6, 22);
      box(group, 1.5, 0.9, 0.08, m.stoneLt, x, 2.9, 22);
      add(group, new THREE.TorusGeometry(0.26, 0.03, 6, 12), mat(0xb85b38), x, 2.55, 21.8);
    }
    add(group, new THREE.CylinderGeometry(0.07, 0.09, 8, 6), m.stoneLt, 0, 4, -6);
    box(group, 1.6, 1.0, 0.06, mat(0xc23b2e), 0.85, 7.2, -6);
    for (const x of [-30, -10, 10, 30]) buildTree(group, x, -32, 0.85);
  }

  // 作坊区：3 排 × 4 列 12 座真实民居工坊（前店后坊格局）+ 烟囱 + 货栈
  function workshopQuarter(group, zone) {
    ground(group, zone, 0x7d745f);
    groundBox(group, 3.2, zone.d - 14, m.roadStone, 0, 0);
    groundBox(group, zone.w - 14, 3, m.roadStone, 0, 11);
    const keys = ['mhouse', 'qhouse1', 'mhouse', 'qhouse4', 'qhouse2', 'mhouse', 'qhouse5', 'qhouse3', 'mhouse', 'qhouse1', 'qhouse4', 'mhouse'];
    let i = 0;
    for (const z of [-22, 0, 22]) for (let c = 0; c < 4; c++) {
      const rot = [[0, Math.PI, Math.PI / 2, -Math.PI / 2][c], [Math.PI, 0, Math.PI / 2, -Math.PI / 2][c], [0, Math.PI, -Math.PI / 2, Math.PI / 2][c]][z === 0 ? 1 : z > 0 ? 2 : 0];
      assetHouse(group, keys[i++ % keys.length], -27 + c * 18, z, rot, 10, 8, 5);
    }
    for (const x of [-27, 27]) add(group, new THREE.CylinderGeometry(0.5, 0.7, 7, 8), m.stoneDk, x, 3.5, 31);
    for (const [x, z] of [[-9, -31], [9, -31], [-9, 31], [9, 31]]) box(group, 1.6, 1.2, 1.6, m.wood, x, 0.6, z);
  }

  // 体育场：标准田径场 + 四面看台 + 四座灯塔（满配街区级体育设施）
  function stadiumBlock(group, zone) {
    ground(group, zone, 0x7d6b58);
    const field = add(group, new THREE.CircleGeometry(15, 40), mat(0x4f873f), 0, 0.08, 0);
    field.rotation.x = -Math.PI / 2; field.scale.y = 1.2;
    const track = add(group, new THREE.RingGeometry(15.4, 22, 40), mat(0xa75e49), 0, 0.07, 0);
    track.rotation.x = -Math.PI / 2; track.scale.y = 1.2;
    for (const s of [-1, 1]) {
      box(group, 44, 1.6, 7, m.stoneLt, 0, 0.8, s * 30);
      box(group, 44, 0.9, 5.2, m.stoneLt, 0, 2.0, s * 29);
      box(group, 46, 0.3, 9, m.roofGrey, 0, 3.4, s * 30);
      collider(0, s * 30, 46, 9, 3.5, 'wall');
    }
    for (const s of [-1, 1]) {
      box(group, 7, 1.4, 30, m.stoneLt, s * 30, 0.7, 0);
      collider(s * 30, 0, 9, 62, 3, 'wall');
    }
    // 环形罩棚（C:S 体育场标志）：倾斜环拱由 14 段扇形板拼成，内低外高
    const canopyMat = mat(0xcdd3d6);
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2;
      const r = 27.5;
      const px = Math.cos(a) * r, pz = Math.sin(a) * r;
      const panel = add(group, new THREE.BoxGeometry(10.5, 0.28, 6.5), canopyMat, px, 8.2, pz);
      panel.rotation.y = -a + Math.PI / 2;
      panel.rotation.z = 0.28;                     // 外高内低倾角
      panel.rotation.order = 'YXZ';
      // 支撑斜柱
      const ix = Math.cos(a) * 22.5, iz = Math.sin(a) * 22.5;
      const col = add(group, new THREE.BoxGeometry(0.5, 9.5, 0.5), m.stoneDk, (px + ix) / 2, 4.6, (pz + iz) / 2);
      col.rotation.y = -a;
      col.rotation.x = 0.3 * Math.sin(a);          // 简化斜撑姿态
      col.rotation.z = -0.3 * Math.cos(a);
    }
    // 记分牌（南北两块）
    for (const s of [-1, 1]) {
      const board = box(group, 8, 4, 0.4, mat(0x233242), 0, 10.5, s * 25);
      box(group, 0.5, 3, 0.5, m.stoneDk, -3, 7.5, s * 25);
      box(group, 0.5, 3, 0.5, m.stoneDk, 3, 7.5, s * 25);
    }
    for (const [x, z] of [[-33, -33], [33, -33], [-33, 33], [33, 33]]) {
      box(group, 0.7, 16, 0.7, m.stoneDk, x, 8, z);
      box(group, 2.4, 0.7, 0.7, mat(0xe8e4d8), x, 16.2, z);
    }
  }

  // 公园 / 绿地：十字步道 + 花坛 + 树阵；公园带池塘亭榭，绿地为中央草坪
  function parkBlock(group, zone, variant) {
    ground(group, zone, 0x668d54);
    groundBox(group, 3, zone.d - 10, m.roadStone, 0, 0);
    groundBox(group, zone.w - 10, 3, m.roadStone, 0, 0);
    for (const [x, z] of [[-28, -28], [28, -28], [-28, 28], [28, 28], [-14, -28], [14, 28], [-28, 12], [28, -12], [-20, 16], [20, -16], [-8, 32], [8, -32]]) {
      buildTree(group, x, z, 0.85);
    }
    for (const [x, z] of [[-18, -14], [18, 14], [-24, 20], [24, -20]]) {
      box(group, 5, 0.25, 5, m.stoneLt, x, 0.12, z);
      box(group, 3.6, 0.3, 3.6, mat(0xb75b45), x, 0.3, z);
    }
    for (const x of [-10, 10]) {
      box(group, 2.2, 0.12, 0.55, m.wood, x, 0.55, 6);
      box(group, 2.2, 0.7, 0.12, m.wood, x, 0.9, 6.25);
    }
    if (variant === 0) {
      add(group, new THREE.CylinderGeometry(5, 5.4, 0.14, 24), m.stoneLt, 0, 0.08, 0);
      add(group, new THREE.CylinderGeometry(8, 8.5, 0.5, 28), m.stoneLt, 16, 0.25, -16);
      add(group, new THREE.CylinderGeometry(7.2, 7.2, 0.14, 28), m.water, 16, 0.52, -16);
      collider(16, -16, 17, 17, 0.6, 'wall');
      for (const a of [0, 1, 2, 3]) {
        const px = -16 + Math.cos(a * Math.PI / 2 + Math.PI / 4) * 3.4, pz = 16 + Math.sin(a * Math.PI / 2 + Math.PI / 4) * 3.4;
        box(group, 0.35, 3, 0.35, m.woodDark, px, 1.5, pz);
      }
      add(group, new THREE.ConeGeometry(4.4, 2.2, 4), m.roofBrown, -16, 4.6, 16);
      collider(-16, 16, 5.5, 5.5, 3, 'house');
    } else {
      add(group, new THREE.CylinderGeometry(14, 14, 0.08, 30), mat(0x5f9a4c), 0, 0.06, 0);
      const ring = add(group, new THREE.TorusGeometry(18, 0.7, 6, 36), m.roadStone, 0, 0.05, 0);
      ring.rotation.x = -Math.PI / 2;
      for (const [x, z] of [[-10, -10], [10, 10], [-10, 10], [10, -10]]) buildTree(group, x, z, 1.05);
      // 电视塔地标（C:S Unique Building 风）：收分塔身 + 观景球 + 天线
      const towerMat = mat(0xd6dce0);
      add(group, new THREE.CylinderGeometry(2.6, 4.6, 26, 14), towerMat, 0, 13, 20);
      add(group, new THREE.CylinderGeometry(2.2, 2.6, 8, 14), towerMat, 0, 30, 20);
      // 观景舱（球体 + 环）
      add(group, new THREE.SphereGeometry(5.2, 18, 12), glassMat(), 0, 38, 20);
      add(group, new THREE.TorusGeometry(5.3, 0.35, 8, 24), mullionMat(), 0, 38, 20).rotation.x = Math.PI / 2;
      add(group, new THREE.CylinderGeometry(1.2, 2.0, 7, 10), towerMat, 0, 44, 20);
      // 天线（夜景红色航空灯）
      add(group, new THREE.CylinderGeometry(0.18, 0.3, 14, 6), mullionMat(), 0, 54.5, 20);
      const beacon = box(group, 0.7, 0.7, 0.7, new THREE.MeshStandardMaterial({
        color: 0xd8442e, emissive: 0xd8442e, emissiveIntensity: 0.9,
      }), 0, 61.8, 20);
      collider(0, 20, 7, 7, 61, 'wall');
    }
  }

  // 公安局大院：围墙 + 办公主楼（Hospital 体量）+ 副楼 + 车库警车 + 训练场
  function policeCompound(group, zone) {
    ground(group, zone, 0x7c8175);
    compoundWall(group, 0x8a9096);
    assetHouse(group, 'hospital', 0, -16, 0, 15, 12, 12);
    assetHouse(group, 'qhouse4', -20, 10, Math.PI / 2, 8, 9, 6);
    box(group, 14, 4, 8, mat(0x8a9096), 20, 2, 10);
    box(group, 14.3, 0.3, 8.3, m.roofGrey, 20, 4.15, 10);
    for (const x of [15, 25]) {
      box(group, 3.4, 1.2, 6, mat(0x2f4d6b), x, 0.75, 22);
      box(group, 1.6, 0.5, 2.2, mat(0xe8e8e8), x, 1.5, 22);
    }
    groundBox(group, 16, 10, mat(0x9aa3a8), -8, 24);
    collider(20, 10, 14, 8, 4.2, 'house');
  }

  // 消防局大院：围墙 + 红色主楼（Shop 体量改造）+ 训练塔 + 出车棚 + 消防车
  function fireCompound(group, zone) {
    ground(group, zone, 0x7c8175);
    compoundWall(group, 0x9b5a4c);
    assetHouse(group, 'shop', -8, -16, 0, 11, 10, 8);
    box(group, 5, 14, 5, mat(0xa85c4b), 18, 7, -16);
    box(group, 5.4, 0.4, 5.4, m.roofGrey, 18, 14.2, -16);
    box(group, 18, 5, 9, mat(0x9b5a4c), -14, 2.5, 16);
    for (const x of [-20, -13, -6]) {
      box(group, 3.2, 1.5, 6.5, mat(0xc23b2e), x, 0.9, 16);
      box(group, 2.2, 0.7, 2.4, mat(0xe4e8e9), x, 1.6, 14.6);
    }
    for (const x of [8, 14]) box(group, 0.5, 1.0, 0.5, mat(0xc23b2e), x, 0.5, 22);
    collider(18, -16, 5, 5, 14.2, 'house');
    collider(-14, 16, 18, 9, 5.2, 'house');
  }

  // 监狱（角部地块）：高墙 + 四角哨塔 + 监楼 + 中央瞭望塔
  function prisonBlock(group, zone) {
    ground(group, zone, 0x777872);
    const S = 12, H = 3.6;
    for (const s of [-1, 1]) {
      box(group, S * 2, H, 0.5, m.stoneDk, 0, H / 2, s * S);
      box(group, 0.5, H, S * 2, m.stoneDk, s * S, H / 2, 0);
    }
    for (const [x, z] of [[-S, -S], [S, -S], [-S, S], [S, S]]) box(group, 2, 5.5, 2, m.stoneLt, x, 2.75, z);
    box(group, 12, 5.5, 6, m.stoneLt, -3, 2.75, -6);
    box(group, 12.5, 0.4, 6.5, m.roofGrey, -3, 5.7, -6);
    box(group, 8, 4.5, 5, m.stoneLt, 6, 2.25, 6);
    box(group, 8.5, 0.4, 5.5, m.roofGrey, 6, 4.7, 6);
    box(group, 0.6, 7, 0.6, m.stoneDk, 0, 3.5, 0);
    box(group, 2.4, 0.5, 2.4, m.stoneDk, 0, 7.2, 0);
    collider(0, 0, zone.w - 2, zone.d - 2, H, 'wall');
  }

  // ---- 外环带状 / 角部地块蓝图 ---------------------------------------------

  // 工厂：两座大厂房（Barn 体量放大）+ 仓库 + 三根烟囱 + 原料堆
  function factoryBlock(group, zone) {
    ground(group, zone, 0x777064);
    assetHouse(group, 'barn', -4, -22, 0, 13, 14, 7.5);
    assetHouse(group, 'barn', -4, 2, Math.PI, 13, 14, 7.5);
    box(group, 9, 5, 12, mat(0x8a806d), 7, 2.5, -24);
    box(group, 9.5, 0.35, 12.5, m.roofGrey, 7, 5.15, -24);
    collider(7, -24, 9, 12, 5.4, 'house');
    for (const z of [-12, 18, 26]) add(group, new THREE.CylinderGeometry(0.7, 1.0, 13, 10), mat(0x66564b), 7, 6.5, z);
    for (const z of [30, 34]) box(group, 2.2, 1.6, 2.2, m.wood, 7, 0.8, z);
  }

  // 农田：2 列 × 4 垄 + 真实农舍 + 风车 + 防风林
  function farmBlock(group, zone) {
    ground(group, zone, 0x6d7c4a);
    for (const z of [-27, -9, 9, 27]) for (const x of [-7, 7]) {
      groundBox(group, 9, 14, m.dirt, x, z);
      for (let r = -2; r <= 2; r++) box(group, 0.35, 0.4, 12.5, mat(0x66813e), x + r * 1.8, 0.24, z);
    }
    assetHouse(group, 'qhouse3', 0, 0, 0, 7, 6, 6);
    assetHouse(group, 'windmill', 5, 6, Math.PI / 4, 6, 6, 8);
    for (const z of [-34, 34]) buildTree(group, -9, z, 0.8);
  }

  // 物流仓储（角部地块）：两座仓库（Barn 体量）+ 装卸场 + 集装箱堆
  function logisticsBlock(group, zone) {
    ground(group, zone, 0x777064);
    groundBox(group, 20, 8, mat(0x8b8d88), 0, 10);
    assetHouse(group, 'barn', -7, -6, Math.PI / 2, 11, 12, 6.5);
    assetHouse(group, 'barn', 7, -6, Math.PI / 2, 11, 12, 6.5);
    const boxColors = [0x8a5a3c, 0x3c6a8a, 0x6a8a3c, 0x8a7a3c];
    for (const [x, z, c] of [[-6, 10, 0], [0, 10, 1], [6, 10, 2], [-3, 7, 3]]) {
      box(group, 4.5, 2.2, 2.4, mat(boxColors[c]), x, 1.1, z);
    }
  }

  // 火车站：站房（Bank 体量）+ 钟楼 + 双轨 + 雨棚站台 + 站前广场
  function stationBlock(group, zone) {
    ground(group, zone, 0x8b9298);
    groundBox(group, 22, 7, mat(0xa3a9ad), -18, -8);
    assetHouse(group, 'bank', -18, 0, 0, 15, 12, 11);
    box(group, 3, 12, 3, m.stoneLt, -18, 6, -6.5);
    box(group, 3.4, 0.8, 3.4, m.roofGrey, -18, 12.4, -6.5);
    for (const z of [5, 9]) {
      box(group, zone.w - 6, 0.15, 0.5, m.stoneDk, 0, 0.15, z);
      for (let x = -36; x <= 36; x += 1.4) box(group, 0.22, 0.1, 2.6, m.woodDark, x, 0.06, z);
    }
    box(group, zone.w - 10, 0.25, 3.4, m.stoneLt, 0, 3.2, 7);
    for (const x of [-32, -16, 0, 16, 32]) box(group, 0.3, 3.2, 0.3, m.stoneDk, x, 1.6, 7);
    collider(0, 7, zone.w - 10, 4, 3.4, 'wall');
  }

  // 公共停车场：4 列车位 × 20 位 + 值班亭 + 灯杆（约 130 个车位）
  function parkingBlock(group, zone) {
    groundBox(group, zone.w, zone.d, m.asphalt, 0, 0);
    const carColors = [0x55768a, 0x8a5560, 0x6a8a55, 0x9a9a9a, 0x4a4f52];
    for (const z of [-9, -5, 5, 9]) {
      let k = 0;
      for (let x = -34; x <= 34; x += 3.4) {
        box(group, 0.1, 0.02, 4.4, m.stoneLt, x - 1.55, 0.08, z);
        if ((k++ + z + 20) % 3 !== 0) {
          box(group, 1.9, 0.75, 4.0, mat(carColors[(k + z) % carColors.length]), x, 0.42, z);
        }
      }
    }
    box(group, 3, 3, 3, mat(0x9aa3a8), 36, 1.5, -11);
    box(group, 3.2, 0.3, 3.2, m.roofGrey, 36, 3.2, -11);
    collider(36, -11, 3.4, 3.4, 3.4, 'house');
    for (const x of [-30, 0, 30]) {
      box(group, 0.14, 5, 0.14, m.stoneDk, x, 2.5, 0);
      box(group, 1.2, 0.1, 0.5, mat(0xe8e4d8), x, 5.05, 0);
    }
  }

  // 大型商业体街坊：山姆式大盒超市 + 停车场（占满 78×78 街坊）
  function mallBlock(group, zone) {
    ground(group, zone, 0x9a9d9a);
    groundBox(group, 22, 20, mat(0x8f9390), -24, 24);   // 入口前广场
    bigBoxMall(group, -16, -8, 52, 34, 13);
    // 停车场带（沿街坊南缘）
    groundBox(group, zone.w - 10, 18, m.asphalt, 0, 28);
    const carColors = [0x55768a, 0x8a5560, 0x6a8a55, 0x9a9a9a];
    for (let i = 0; i < 14; i++) {
      box(group, 2.0, 0.8, 4.2, mat(carColors[i % carColors.length]), -30 + i * 4.6, 0.42, 26);
      if (i % 3 !== 2) box(group, 2.0, 0.8, 4.2, mat(carColors[(i + 2) % carColors.length]), -30 + i * 4.6, 0.42, 31);
    }
    for (const x of [-34, -12, 10, 32]) box(group, 0.14, 5, 0.14, m.stoneDk, x, 2.5, 22);
    // 购物车归集区 + 绿化带
    for (const x of [-36, -32]) box(group, 1.8, 1.0, 1.4, mat(0xb0b6ba), x, 0.5, 16);
    for (const [tx, tz] of [[36, -28], [36, -12], [36, 4]]) buildTree(group, tx, tz, 0.9);
  }

  // 底商上住楼（C:S mixed-use）：底部 2 层通高玻璃商业 + 上部横带住宅
  function mixedUseBlock(group, x, z, w, d, height, opts = {}) {
    const wall = mat(opts.wall ?? 0xc9bfa8);
    const band = mat(0xf2ede2);
    const glass = glassMat();
    const commH = 5.2;
    const bodyH = height - commH;
    // 商业裙楼：通高玻璃 + 深色框
    box(group, w, commH, d, glass, x, commH / 2, z);
    box(group, w + 0.4, 0.35, d + 0.4, mat(0x3a4248), x, commH + 0.15, z);
    // 住宅部分：横带窗
    box(group, w - 1.2, bodyH, d - 1.2, wall, x, commH + bodyH / 2, z);
    const floors = Math.max(2, Math.round(bodyH / 3.2));
    const litT = [];
    for (let f = 0; f < floors; f++) {
      const fy = commH + 2.0 + f * (bodyH / floors);
      box(group, w - 0.8, 0.4, d - 0.8, band, x, fy, z);
      litT.push([x, fy + 1.0, z - (d - 1.2) / 2 - 0.06, (w - 1.2) * 0.8, 0, 1.0]);
      litT.push([x, fy + 1.0, z + (d - 1.2) / 2 + 0.06, (w - 1.2) * 0.8, 0, 1.0]);
    }
    const litMap = new Map();
    litT.forEach(([lx, ly, lz, lw, ld, lh]) => {
      const vi = Math.abs(Math.round(lx * 9.1 + ly * 4.7 + lz * 6.3)) % 5;
      if (!litMap.has(vi)) litMap.set(vi, []);
      litMap.get(vi).push([lx, ly, lz, lw, ld, lh]);
    });
    for (const [vi, list] of litMap) {
      const inst = new THREE.InstancedMesh(trackGeo(new THREE.BoxGeometry(1, 1, 1)), getWindowVariants()[vi], list.length);
      list.forEach(([lx, ly, lz, lw, ld, lh], i) => {
        dummy.position.set(lx, ly, lz); dummy.rotation.set(0, 0, 0);
        dummy.scale.set(lw || 0.1, lh, ld || 0.1);
        dummy.updateMatrix(); inst.setMatrixAt(i, dummy.matrix);
      });
      inst.instanceMatrix.needsUpdate = true; inst.castShadow = false; inst.receiveShadow = false;
      inst.userData.noBatch = true;
      group.add(inst);
    }
    // 店招横幅（商业特征）
    box(group, w * 0.55, 0.8, 0.14, mat(0xa8443a), x, 3.9, z - d / 2 - 0.12);
    collider(x, z, w, d, height, 'house');
  }

  // 通用居住街坊（infill）：按距 CBD 距离取三档密度——民居(低)/底商上住(中)/小高层(高)
  // 形成 C:S 式「老城→多层→高层」高度梯度
  function denseModule(group, zone) {
    const dist = Math.hypot(zone.x, zone.z);          // 距城中心
    const tier = dist < 210 ? 2 : dist < 320 ? 1 : 0; // 2=小高层 1=底商上住 0=民居
    if (tier === 2) return midRiseBlock(group, zone);
    if (tier === 1) return mixedUseQuarter(group, zone);
    // tier 0：FBX 民居行列式（原有逻辑）
    const grid = zone.w >= 70 ? 8 : 4;
    const pitch = grid === 8 ? 9 : 4.4;
    const keys = ['qhouse1', 'qhouse2', 'qhouse3', 'qhouse4', 'qhouse5'];
    groundBox(group, zone.w, zone.d, mat(0x7c8175), 0, 0);
    if (grid === 8) {
      groundBox(group, zone.w, 3, m.roadStone, 0, 0);
      groundBox(group, 3, zone.d, m.roadStone, 0, 0);
    }
    let i = 0;
    for (let row = 0; row < grid; row++) for (let col = 0; col < grid; col++) {
      if ((zone.variant + (grid === 8 ? 0 : 2)) % 2 === 0
        ? (row % 4 === 3 || col % 4 === 3)
        : (row >= 2 && row <= 5 && col >= 2 && col <= 5)) continue;
      const x = (col - (grid - 1) / 2) * pitch;
      const z = (row - (grid - 1) / 2) * pitch;
      const rot = [0, Math.PI, Math.PI / 2, -Math.PI / 2][(col + row + zone.variant) % 4];
      assetHouse(group, keys[(i + zone.variant) % keys.length], x, z, rot, 7, 6, 5.5);
      i++;
    }
    groundBox(group, grid === 8 ? 16 : 9, grid === 8 ? 16 : 9, mat(0x668653), 0, 0);
    for (const [tx, tz] of [[-4, -4], [4, -4], [-4, 4], [4, 4]]) buildTree(group, tx, tz, 0.75);
    collider(0, 0, grid === 8 ? 15 : 8, grid === 8 ? 15 : 8, 2.5, 'wall');
  }

  // 中档：底商上住 6 栋（L 形围合）
  function mixedUseQuarter(group, zone) {
    ground(group, zone, 0x8a8d85);
    const spots = [
      [-24, -24, 0], [0, -26, 0], [24, -24, 0],
      [-24, 24, Math.PI], [24, 24, Math.PI],
      [0, 26, Math.PI],
    ];
    for (const [x, z, rot] of spots) mixedUseBlock(group, x, z, 20, 9, 17, { wall: 0xc9bfa8 });
    // 中央口袋公园
    groundBox(group, 22, 16, mat(0x668653), 0, 0);
    add(group, new THREE.CylinderGeometry(3.4, 3.8, 0.5, 20), m.stoneLt, 0, 0.25, 0);
    add(group, new THREE.CylinderGeometry(2.8, 2.8, 0.14, 20), m.water, 0, 0.5, 0);
    for (const [tx, tz] of [[-8, -5], [8, -5], [-8, 5], [8, 5]]) buildTree(group, tx, tz, 0.9);
  }

  // 高档：小高层板楼 4 栋（30m，现代米色横带风）+ 中央花园
  function midRiseBlock(group, zone) {
    ground(group, zone, 0x8a8d85);
    const spots = [
      [-22, -20, 34, 12], [22, -20, 30, 12], [-22, 20, 30, 12], [22, 20, 34, 12],
    ];
    for (const [x, z, w, d] of spots) {
      // 板楼：主体 + 楼层横带 + 女儿墙
      const h = 30 + (w === 34 ? 4 : 0);
      const wall = mat(0xd8c9b0);
      const band = mat(0xf2ede2);
      box(group, w, h, d, wall, x, h / 2, z);
      const floors = Math.round(h / 3);
      const litT = [];
      for (let f = 1; f < floors; f++) {
        const fy = f * (h / floors);
        box(group, w + 0.5, 0.45, d + 0.5, band, x, fy, z);
        litT.push([x, fy + 1.2, z - d / 2 - 0.07, w * 0.85, 0, 1.1]);
      }
      box(group, w + 0.6, 0.5, d + 0.6, band, x, h + 0.25, z);
      const litMap = new Map();
      litT.forEach(([lx, ly, lz, lw, ld, lh]) => {
        const vi = Math.abs(Math.round(lx * 8.3 + ly * 5.1 + lz * 7.7)) % 5;
        if (!litMap.has(vi)) litMap.set(vi, []);
        litMap.get(vi).push([lx, ly, lz, lw, ld, lh]);
      });
      for (const [vi, list] of litMap) {
        const inst = new THREE.InstancedMesh(trackGeo(new THREE.BoxGeometry(1, 1, 1)), getWindowVariants()[vi], list.length);
        list.forEach(([lx, ly, lz, lw, ld, lh], i) => {
          dummy.position.set(lx, ly, lz); dummy.rotation.set(0, 0, 0);
          dummy.scale.set(lw || 0.1, lh, ld || 0.1);
          dummy.updateMatrix(); inst.setMatrixAt(i, dummy.matrix);
        });
        inst.instanceMatrix.needsUpdate = true; inst.castShadow = false; inst.receiveShadow = false;
        inst.userData.noBatch = true;
        group.add(inst);
      }
      collider(x, z, w, d, h, 'house');
    }
    // 中央花园
    groundBox(group, 26, 18, mat(0x668653), 0, 0);
    for (const [tx, tz] of [[-10, -6], [10, -6], [-10, 6], [10, 6], [0, 0]]) buildTree(group, tx, tz, 0.95);
    box(group, 3.4, 0.12, 1.4, m.wood, 0, 0.5, 0);
  }

  for (const zone of CITY_ZONES) {
    activeZone = zone;
    const group = new THREE.Group();
    group.position.set(zone.x, 0, zone.z);
    group.name = `district-${zone.key}`;
    if (zone.key === 'office') cbdBlock(group, zone);
    else if (zone.key === 'apartment') apartmentBlock(group, zone);
    else if (zone.key === 'community') courtyardBlock(group, zone);
    else if (zone.key === 'villas') villaQuarter(group, zone);
    else if (zone.key === 'school') schoolCampus(group, zone);
    else if (zone.key === 'workshop') workshopQuarter(group, zone);
    else if (zone.key === 'stadium') stadiumBlock(group, zone);
    else if (zone.key === 'park') parkBlock(group, zone, zone.label === '开放式公园' ? 0 : 1);
    else if (zone.key === 'police') policeCompound(group, zone);
    else if (zone.key === 'fire') fireCompound(group, zone);
    else if (zone.key === 'prison') prisonBlock(group, zone);
    else if (zone.key === 'factory') factoryBlock(group, zone);
    else if (zone.key.startsWith('farm')) farmBlock(group, zone);
    else if (zone.key === 'logistics') logisticsBlock(group, zone);
    else if (zone.key === 'station') stationBlock(group, zone);
    else if (zone.key === 'parking') parkingBlock(group, zone);
    else if (zone.key === 'infill' && zone.label === '综合市场' && !zone.mallDone) {
      zone.mallDone = true;
      mallBlock(group, zone);   // 大型商业体（山姆式大盒超市），只建一处
    }
    else denseModule(group, zone); // infill 通用街坊
    sign(group, zone.label, -zone.w / 2 + 3, -zone.d / 2 + 1.2, zone.color);
    const worldX = group.position.x, worldZ = group.position.z;
    group.position.set(0, 0, 0);
    batchStatic(group);
    group.position.set(worldX, 0, worldZ);
    group.traverse(o => { if (o.isMesh) o.userData.noBatch = true; });
    districtDetails.push(group);
    parent.add(group);
  }
  const proxyMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95 });
  disposables.materials.push(proxyMaterial);
  districtProxy = new THREE.InstancedMesh(trackGeo(new THREE.BoxGeometry(1, 1, 1)), proxyMaterial, CITY_ZONES.length);
  const PROXY_HEIGHTS = {
    office: 58, apartment: 44, school: 11, community: 8, workshop: 6, police: 9, fire: 9,
    stadium: 4, prison: 6, factory: 7, station: 10, logistics: 6, villas: 5,
  };
  CITY_ZONES.forEach((zone, i) => {
    let height = PROXY_HEIGHTS[zone.key] ?? (['park', 'farm', 'farmWest', 'parking'].includes(zone.key) ? 0.8 : 9);
    if (zone.key === 'infill') {
      const dist = Math.hypot(zone.x, zone.z);
      height = dist < 210 ? 34 : dist < 320 ? 17 : 6;
    }
    const cap = Math.abs(zone.x) > 180 || Math.abs(zone.z) > 180 ? 80 : 72;
    const width = Math.min(zone.w, cap);
    const depth = Math.min(zone.d, cap);
    dummy.position.set(zone.x, height / 2, zone.z); dummy.rotation.set(0, 0, 0); dummy.scale.set(width, height, depth); dummy.updateMatrix();
    districtProxy.setMatrixAt(i, dummy.matrix); districtProxy.setColorAt(i, new THREE.Color(zone.color));
  });
  districtProxy.instanceMatrix.needsUpdate = true; districtProxy.instanceColor.needsUpdate = true;
  districtProxy.visible = false; districtProxy.userData.noBatch = true;
  parent.add(districtProxy);
}

// ---------------------------------------------------------------------------
//  立交桥：主干道交汇处（±100,±100 与 -100,100）的苜蓿叶式高架
//  东西向车流上跨（桥面 y≈6.5），南北向地面通过；四条匝道弯连
// ---------------------------------------------------------------------------
export function buildInterchange(parent, x, z) {
  const m = M();
  const dummy = new THREE.Object3D();
  const add = (geometry, material, px, py, pz, rotY = 0) => {
    const mesh = new THREE.Mesh(trackGeo(geometry), material);
    mesh.position.set(px, py, pz); mesh.rotation.y = rotY;
    mesh.castShadow = mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  };
  const deckMat = new THREE.MeshStandardMaterial({ color: 0x8d9094, roughness: 0.85 });
  const pierMat = new THREE.MeshStandardMaterial({ color: 0x9aa0a4, roughness: 0.9 });
  const railMat = new THREE.MeshStandardMaterial({ color: 0xb6bcc0, roughness: 0.6, metalness: 0.3 });
  const bridgeLen = 86, deckW = 13, deckY = 6.8;

  // 主跨桥面（东西向）+ 引桥斜坡（两端下沉）
  add(new THREE.BoxGeometry(bridgeLen, 0.8, deckW), deckMat, x, deckY, z);
  const rampLen = 46;
  for (const s of [-1, 1]) {
    const ramp = add(new THREE.BoxGeometry(rampLen, 0.7, deckW), deckMat, x + s * (bridgeLen / 2 + rampLen / 2 - 2), deckY / 2 + 0.4, z);
    ramp.rotation.z = -s * Math.atan2(deckY - 0.4, rampLen);
    // 引道接地段
    add(new THREE.BoxGeometry(30, 0.12, deckW), deckMat, x + s * (bridgeLen / 2 + rampLen + 13), 0.06, z);
  }
  // 桥墩（跨中 3 对圆柱）
  for (const px of [-26, 0, 26]) {
    for (const pz of [-deckW / 2 + 1.5, deckW / 2 - 1.5]) {
      add(new THREE.CylinderGeometry(0.9, 1.1, deckY - 0.4, 10), pierMat, x + px, (deckY - 0.4) / 2, z + pz);
    }
  }
  // 防撞栏（桥面两侧通长）
  for (const s of [-1, 1]) {
    add(new THREE.BoxGeometry(bridgeLen + rampLen * 1.6, 0.9, 0.25), railMat, x, deckY + 0.7, z + s * (deckW / 2));
  }
  // 四条苜蓿叶匝道：四分之一圆环坡道（内环 8m 外环 15m），从地面盘上桥
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const cx = x + sx * 30, cz = z + sz * 30;
    const ring = new THREE.Mesh(
      trackGeo(new THREE.RingGeometry(8, 15, 20, 1, 0, Math.PI / 2)),
      new THREE.MeshStandardMaterial({ color: 0x84888c, roughness: 0.88, side: THREE.DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(cx, 0.14, cz);
    ring.rotation.z = sx * sz > 0 ? 0 : Math.PI / 2;
    ring.receiveShadow = true;
    parent.add(ring);
    // 匝道护栏（内缘）
    add(new THREE.TorusGeometry(8.2, 0.14, 6, 14, Math.PI / 2), railMat, cx, 0.55, cz, sx * sz > 0 ? 0 : Math.PI / 2);
  }
}

let zonePlanMode = false;   // 分区规划图模式：航拍下强制显示色块
export function setZonePlanMode(on) {
  zonePlanMode = Boolean(on);
}
export function isZonePlanMode() { return zonePlanMode; }

export function updateDistrictLOD(camera) {
  const overview = camera.position.y > 180;
  const showProxy = overview || zonePlanMode;
  for (const group of districtDetails) group.visible = !showProxy;
  if (districtProxy) districtProxy.visible = showProxy;
}
