import * as THREE from 'three';
import { M, trackGeo, disposables } from './materials.js';
import { batchStatic } from './optimize.js';
import { instantiate } from './assets.js';

const districtDetails = [];
let districtProxy = null;

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
  // 每个实例按 (key,x,z) 哈希取一套墙/顶色调，避免同款模型复制粘贴感。
  const TINTS = [
    { wall: 0xffffff, roof: null },       // 原色
    { wall: 0xe8d0b8, roof: 0x8a5a42 },   // 暖米墙 + 红褐顶
    { wall: 0xd4e0d8, roof: 0x4a5e6a },   // 青白墙 + 蓝灰顶
    { wall: 0xe8d8d0, roof: 0x7a4a3a },   // 粉白墙 + 砖红顶
    { wall: 0xd8dde4, roof: 0x3e4a56 },   // 灰蓝墙 + 深蓝顶
    { wall: 0xf0e2c0, roof: 0x6a5a3a },   // 奶黄墙 + 土黄顶
  ];
  function tintHash(str) {
    let h = 0;
    for (const ch of str) h = (h * 31 + ch.charCodeAt(0)) | 0;
    return Math.abs(h);
  }
  function applyTint(inst, key, x, z, seed) {
    const t = TINTS[tintHash(key + ':' + x + ':' + z + ':' + seed) % TINTS.length];
    if (t.wall === 0xffffff) return;
    inst.traverse(o => {
      if (!o.isMesh) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      const normal = o.geometry?.attributes.normal;
      // 单 mesh 判断：多数法线朝上 = 屋顶部分，用顶色；否则用墙色
      let up = 0, total = 0;
      if (normal) for (let i = 0; i < normal.count; i += 3) { total++; if (normal.getY(i) > 0.7) up++; }
      const isRoof = total > 0 && up / total > 0.6;
      for (const mm of mats) {
        if (mm.map) continue; // 有贴图的模型不动色
        const target = isRoof ? (t.roof ?? mm.color) : t.wall;
        if (target && mm.color) mm.color.set(target);
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

  // ---- 内环街坊蓝图 -------------------------------------------------------

  // CBD：6 座高层塔楼（真实 FBX 资产）+ 中央广场（低密度高强度，真实商务区形态）
  function cbdBlock(group, zone) {
    ground(group, zone, 0x8b9298);
    groundBox(group, 30, 30, mat(0xa3a9ad), 0, 0);
    const towers = [
      ['tower2', -26, -26, 11], ['tower1', 2, -26, 11], ['tower3', 28, -26, 11],
      ['tower1', -26, 24, 11], ['tower2', 2, 24, 11], ['tower3', 28, 26, 10],
    ];
    towers.forEach(([key, x, z, fp], i) => {
      assetHouse(group, key, x, z, [0, Math.PI / 2, Math.PI][i % 3], fp, fp, key === 'tower1' ? 22 : key === 'tower2' ? 18 : 15);
    });
    for (const [x, z] of [[-36, 0], [36, 0], [0, -36], [0, 36]]) buildTree(group, x, z, 0.9);
  }

  // 居民楼：两排公寓板楼（真实 FBX 资产 Flat/Flat2）+ 内部绿地
  function apartmentBlock(group, zone) {
    ground(group, zone, 0x7c8175);
    groundBox(group, zone.w - 16, 12, mat(0x6f8b57), 0, 0);
    const rows = [
      ['flat', -18, -24], ['flat2', 18, -24], ['flat', -18, 24], ['flat2', 18, 24],
      ['flat2', -18, 0], ['flat', 18, 0],
    ];
    for (const [key, x, z] of rows) assetHouse(group, key, x, z, 0, 13, 10, key === 'flat' ? 16 : 13);
    for (const [x, z] of [[-32, -12], [32, -12], [-32, 12], [32, 12], [0, -32], [0, 32]]) buildTree(group, x, z, 0.9);
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

  // 通用居住街坊（infill）：FBX 真实民居的行列式布局（性能：共享几何，静态合批）
  function denseModule(group, zone) {
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
      // 中央留出街坊绿地（mode 交替：行列式 vs 围合式）
      if ((zone.variant + (grid === 8 ? 0 : 2)) % 2 === 0
        ? (row % 4 === 3 || col % 4 === 3)
        : (row >= 2 && row <= 5 && col >= 2 && col <= 5)) continue;
      const x = (col - (grid - 1) / 2) * pitch;
      const z = (row - (grid - 1) / 2) * pitch;
      const rot = [0, Math.PI, Math.PI / 2, -Math.PI / 2][(col + row + zone.variant) % 4];
      assetHouse(group, keys[(i + zone.variant) % keys.length], x, z, rot, 7, 6, 5.5);
      i++;
    }
    // 街坊绿地：中央树阵 + 长椅
    groundBox(group, grid === 8 ? 16 : 9, grid === 8 ? 16 : 9, mat(0x668653), 0, 0);
    for (const [tx, tz] of [[-4, -4], [4, -4], [-4, 4], [4, 4]]) buildTree(group, tx, tz, 0.75);
    collider(0, 0, grid === 8 ? 15 : 8, grid === 8 ? 15 : 8, 2.5, 'wall');
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
    office: 26, apartment: 17, school: 11, community: 8, workshop: 6, police: 9, fire: 9,
    stadium: 4, prison: 6, factory: 7, station: 10, logistics: 6, villas: 5,
  };
  CITY_ZONES.forEach((zone, i) => {
    const height = PROXY_HEIGHTS[zone.key] ?? (['park', 'farm', 'farmWest', 'parking'].includes(zone.key) ? 0.8 : 9);
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

export function updateDistrictLOD(camera) {
  const overview = camera.position.y > 180;
  for (const group of districtDetails) group.visible = !overview;
  if (districtProxy) districtProxy.visible = overview;
}
