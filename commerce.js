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
      // 门洞与屋内落点：供 NPC 走进建筑使用
      door: { x: side * (CC.xOffset - CC.doorInset), z },
      inside: { x: side * (CC.xOffset - CC.insideInset), z },
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
  // 字号随字数自适应，长店名也不会溢出招牌边框
  const fontSize = text.length <= 2 ? 78 : text.length <= 4 ? 60 : 46;
  ctx.font = `bold ${fontSize}px "Songti SC", "SimSun", serif`;
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
  // 中式小灯笼：红灯笼身 + 上下金箍 + 流苏，给摊位/店门添生活气息
  const putLantern = (group, accent, x, y, z) => {
    const body = addMesh(group, new THREE.SphereGeometry(0.16, 12, 8), mat(0xa8342a), x, y, z);
    body.scale.y = 1.15;
    addMesh(group, new THREE.CylinderGeometry(0.075, 0.075, 0.04, 10), mat(0xd9a441), x, y + 0.2, z);
    addMesh(group, new THREE.CylinderGeometry(0.075, 0.075, 0.04, 10), mat(0xd9a441), x, y - 0.2, z);
    addMesh(group, new THREE.CylinderGeometry(0.012, 0.012, 0.16, 6), mat(0xd9a441), x, y - 0.3, z);
  };

  // ---- 精细业态商品 ------------------------------------------------------
  // 每种业态摆一套一眼可辨的货：酒坛/茶具/布卷/药材/米袋/瓷器/线装书/客栈杂物。
  // surfaceY 是柜台台面高度，gx/gz 是柜台中心（group 局部坐标）。
  function addGoods(group, type, gx = 0, gz = -2.2, surfaceY = 0.96) {
    const sign = type.sign;
    const y0 = surfaceY;
    const POT = mat(0x7c4a30), POT_D = mat(0x5c3522), CLAY = mat(0xa9714a);
    const LINEN = mat(0xcbbfa2), PAPER = mat(0xe4d7b4), INK = mat(0x3a3a42);
    const put = (geo, material, x, y, z, rx = 0, ry = 0, rz = 0) => {
      const mesh = addMesh(group, geo, material, gx + x, y0 + y, gz + z);
      mesh.rotation.set(rx, ry, rz);
      return mesh;
    };
    // 旋转体（酒坛、瓷瓶、葫芦、罐）
    const lathe = (profile, material, x, y, z, seg = 14) =>
      put(new THREE.LatheGeometry(profile.map(([r, h]) => new THREE.Vector2(r, h)), seg), material, x, y, z);
    // 碗：浅碟 + 圈足
    const bowl = (material, x, y, z, r = 0.13) => {
      lathe([[0.035, 0], [r * 0.55, 0.01], [r, 0.09], [r * 1.04, 0.1], [r * 0.9, 0.1], [r * 0.5, 0.035]], material, x, y, z, 12);
    };

    if (sign === '酒') {
      // 三只大肚酒坛，泥封口 + 红布
      for (const [i, x] of [-0.78, -0.05, 0.7].entries()) {
        lathe([[0.12, 0], [0.2, 0.06], [0.27, 0.22], [0.26, 0.42], [0.17, 0.6], [0.13, 0.68], [0.15, 0.74]], POT, x, 0, i === 1 ? 0.04 : -0.04);
        put(new THREE.CylinderGeometry(0.145, 0.135, 0.07, 12), LINEN, x, 0.77, i === 1 ? 0.04 : -0.04);
        put(new THREE.SphereGeometry(0.05, 8, 6), mat(0xa8342a), x, 0.82, i === 1 ? 0.04 : -0.04);
      }
      // 酒壶 + 叠放的酒碗
      lathe([[0.06, 0], [0.16, 0.05], [0.18, 0.2], [0.1, 0.32], [0.07, 0.36]], CLAY, -0.15, 0, 0.42, 12);
      for (let i = 0; i < 3; i++) bowl(LINEN, 0.45, i * 0.055, 0.42, 0.12);
    } else if (sign === '茶') {
      // 茶壶（壶身+盖+嘴）+ 一摞茶盏 + 茶叶罐 + 茶饼
      lathe([[0.07, 0], [0.19, 0.04], [0.22, 0.18], [0.14, 0.3], [0.11, 0.33]], mat(0xb9c9c0), -0.6, 0, 0, 14);
      put(new THREE.CylinderGeometry(0.08, 0.11, 0.04, 12), mat(0x8fa79c), -0.6, 0.35, 0);
      put(new THREE.CylinderGeometry(0.025, 0.025, 0.18, 8), mat(0xb9c9c0), -0.82, 0.18, 0, 0, 0, 0.9);
      for (let i = 0; i < 4; i++) bowl(mat(0xdfe8e2), -0.05 + (i % 2) * 0.02, Math.floor(i / 2) * 0.06, 0.08 + (i % 2) * 0.06, 0.1);
      for (const x of [0.42, 0.7]) {
        lathe([[0.1, 0], [0.12, 0.03], [0.12, 0.26], [0.09, 0.3]], POT, x, 0, -0.05, 12);
        put(new THREE.CylinderGeometry(0.1, 0.1, 0.02, 12), LINEN, x, 0.31, -0.05);
      }
      for (let i = 0; i < 3; i++) put(new THREE.CylinderGeometry(0.11, 0.11, 0.035, 12), mat(0x6c7d4e), 0.5 + i * 0.04, 0.02 + i * 0.04, 0.38);
    } else if (sign === '布') {
      // 多色布卷躺放 + 叠好的布匹 + 一支挂起的布幔
      const colors = [0x9d5151, 0x557a9b, 0xb39450, 0x6c7d4e, 0x8d6b9c];
      colors.forEach((c, i) => {
        const roll = put(new THREE.CylinderGeometry(0.14, 0.14, 0.62, 14), mat(c), -0.8 + i * 0.4, 0.16, -0.02, 0, 0, Math.PI / 2);
        put(new THREE.CylinderGeometry(0.055, 0.055, 0.64, 10), LINEN, -0.8 + i * 0.4, 0.16, -0.02, 0, 0, Math.PI / 2);
      });
      for (let i = 0; i < 3; i++) put(new THREE.BoxGeometry(0.56, 0.07, 0.38), mat(colors[(i + 2) % colors.length]), -0.35, 0.42 + i * 0.08, 0.42);
      const drape = put(new THREE.PlaneGeometry(0.62, 0.8), mat(0x9d5151), 0.78, 0.45, -0.32, 0, 0.1, 0);
      drape.material.side = THREE.DoubleSide;
    } else if (sign === '药') {
      // 药柜（格子抽屉）+ 药罐 + 草药捆 + 葫芦 + 晒药竹匾
      put(new THREE.BoxGeometry(0.9, 0.62, 0.28), m.woodDark, -0.5, 0.34, -0.28);
      for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++) {
        put(new THREE.BoxGeometry(0.19, 0.17, 0.03), mat(0xb99a6e), -0.87 + c * 0.24, 0.14 + r * 0.2, -0.13);
        put(new THREE.SphereGeometry(0.018, 6, 5), POT_D, -0.87 + c * 0.24, 0.14 + r * 0.2, -0.11);
      }
      for (const x of [0.25, 0.55, 0.8]) lathe([[0.09, 0], [0.12, 0.04], [0.12, 0.2], [0.08, 0.24]], mat(0x9a6b45), x, 0, 0.05, 12);
      for (let i = 0; i < 5; i++) put(new THREE.CylinderGeometry(0.025, 0.025, 0.3, 6), mat(0x7a8b4a), -0.55 + i * 0.05, 0.16, 0.42, 0, 0, 0.3 + i * 0.12);
      lathe([[0.04, 0], [0.13, 0.08], [0.15, 0.2], [0.07, 0.3], [0.055, 0.38], [0.09, 0.44]], POT, 0.72, 0, 0.4, 12);
      put(new THREE.CylinderGeometry(0.34, 0.3, 0.05, 14), mat(0xb59a63), 0.2, 0.02, -0.42);
      for (let i = 0; i < 7; i++) put(new THREE.SphereGeometry(0.03, 6, 5), mat(0x8a6b3c), 0.02 + (i % 4) * 0.1, 0.06, -0.5 + Math.floor(i / 4) * 0.09);
    } else if (sign === '米') {
      // 鼓形米袋（扎口）+ 敞口米斗 + 竹筐盛米
      for (const [i, x] of [-0.75, -0.05, 0.65].entries()) {
        const sack = put(new THREE.SphereGeometry(0.28, 12, 8), mat(0xcbb98a), x, 0.26, i === 1 ? 0.05 : -0.02);
        sack.scale.set(1, 1.05, 0.82);
        put(new THREE.CylinderGeometry(0.1, 0.13, 0.12, 10), LINEN, x, 0.55, i === 1 ? 0.05 : -0.02);
        put(new THREE.TorusGeometry(0.1, 0.018, 6, 12), POT, x, 0.53, i === 1 ? 0.05 : -0.02, Math.PI / 2);
      }
      put(new THREE.CylinderGeometry(0.26, 0.18, 0.3, 4), m.woodDark, 0.42, 0.16, 0.46, 0, Math.PI / 4);
      put(new THREE.CylinderGeometry(0.22, 0.22, 0.03, 4), mat(0xe0cf9c), 0.42, 0.31, 0.46, 0, Math.PI / 4);
      for (let i = 0; i < 6; i++) put(new THREE.SphereGeometry(0.022, 6, 5), mat(0xe6d6a4), -0.1 + (i % 3) * 0.08, 0.02, 0.34 + Math.floor(i / 3) * 0.07);
    } else if (sign === '瓷') {
      // 青花瓷瓶（白釉+蓝纹）+ 叠放碗碟 + 茶具
      const porcelain = mat(0xe8ecf0), blue = mat(0x3a6ea8);
      for (const [i, x] of [-0.72, -0.05, 0.65].entries()) {
        lathe([[0.09, 0], [0.2, 0.05], [0.25, 0.24], [0.18, 0.46], [0.1, 0.58], [0.12, 0.68], [0.15, 0.72]], porcelain, x, 0, -0.02, 16);
        put(new THREE.TorusGeometry(0.19, 0.018, 6, 16), blue, x, 0.26, -0.02, Math.PI / 2);
        put(new THREE.TorusGeometry(0.14, 0.015, 6, 16), blue, x, 0.45, -0.02, Math.PI / 2);
      }
      for (let i = 0; i < 4; i++) bowl(porcelain, 0.4, i * 0.05, 0.42, 0.14);
      lathe([[0.05, 0], [0.14, 0.04], [0.16, 0.14], [0.08, 0.22]], blue, -0.4, 0, 0.42, 12);
    } else if (sign === '书') {
      // 两摞线装书 + 书卷 + 笔架毛笔
      const covers = [0x6b4a3a, 0x4f6684, 0x7a5b3c, 0x556b52];
      for (const [s, bx] of [-0.7, 0.05].entries()) {
        for (let i = 0; i < 5; i++) {
          const c = covers[(i + s) % covers.length];
          put(new THREE.BoxGeometry(0.6, 0.07, 0.4), mat(c), bx, i * 0.075, -0.02, 0, (i % 2 ? 1 : -1) * 0.03);
          put(new THREE.BoxGeometry(0.54, 0.05, 0.35), PAPER, bx, i * 0.075, -0.02);
        }
      }
      for (let i = 0; i < 3; i++) put(new THREE.CylinderGeometry(0.05, 0.05, 0.4, 10), PAPER, 0.68, 0.06 + i * 0.11, 0.3, 0, 0, Math.PI / 2);
      put(new THREE.BoxGeometry(0.34, 0.05, 0.1), POT_D, -0.4, 0.05, 0.44);
      for (let i = 0; i < 3; i++) put(new THREE.CylinderGeometry(0.012, 0.012, 0.3, 6), INK, -0.5 + i * 0.1, 0.2, 0.44, 0, 0, 0.08);
    } else if (sign === '客栈') {
      // 红灯笼 + 算盘 + 茶壶茶碗 + 菜单木牌
      for (const x of [-0.7, 0.72]) {
        lathe([[0.05, 0], [0.16, 0.06], [0.18, 0.2], [0.1, 0.28]], mat(0xa8342a), x, 0.45, -0.05, 12);
        put(new THREE.CylinderGeometry(0.09, 0.09, 0.03, 12), mat(0xd9a441), x, 0.76, -0.05);
      }
      put(new THREE.BoxGeometry(0.5, 0.3, 0.05), m.woodDark, -0.02, 0.18, 0.42);
      for (let r = 0; r < 3; r++) for (let c = 0; c < 6; c++) put(new THREE.SphereGeometry(0.018, 6, 5), mat(0xd9c08a), -0.22 + c * 0.088, 0.08 + r * 0.09, 0.45);
      lathe([[0.06, 0], [0.16, 0.04], [0.18, 0.17], [0.1, 0.26]], LINEN, 0.1, 0, 0.02, 12);
      for (let i = 0; i < 2; i++) bowl(LINEN, 0.48, i * 0.05, 0.06, 0.11);
      const menu = put(new THREE.PlaneGeometry(0.34, 0.5), PAPER, 0.62, 0.3, -0.35);
      menu.material.side = THREE.DoubleSide;
    } else {
      // 通用：几只陶罐 + 布包
      for (const x of [-0.6, 0, 0.6]) lathe([[0.09, 0], [0.16, 0.06], [0.16, 0.24], [0.1, 0.3]], POT, x, 0, 0, 12);
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
    // 布棚前沿的波浪垂边 + 挑杆，避免看起来像一块硬板
    for (let i = 0; i < 7; i++) {
      const flap = addBox(g, 0.7, 0.3 + (i % 2) * 0.09, 0.05, accent, -2.1 + i * 0.7, 3.13, -2.84);
      flap.rotation.x = -0.12;
    }
    addBox(g, 5.1, 0.07, 0.07, m.woodDark, 0, 3.24, -2.86);
    // 店门两侧的灯笼：与门前外摆摊呼应，统一业态配色
    putLantern(g, accent, -2.35, 2.85, -2.8);
    putLantern(g, accent, 2.35, 2.85, -2.8);
    addBox(g, 2.5, 0.78, 0.65, m.wood, 0, 0.45, -2.2);
    addBox(g, 2.65, 0.12, 0.78, m.woodDark, 0, 0.9, -2.2);
    addGoods(g, shop, 0, -2.2, 0.96);
    addBox(g, 0.58, 0.58, 0.58, m.wood, 1.85, 0.3, -2.15);
    addBox(g, 0.52, 0.52, 0.52, m.wood, 1.85, 0.85, -2.15);
    addMesh(g, new THREE.CylinderGeometry(0.23, 0.18, 0.4, 8), mat(0x9b5d3f), -1.85, 0.22, -2.15);
    addMesh(g, new THREE.SphereGeometry(0.36, 8, 6), mat(0x557e46), -1.85, 0.62, -2.15);
    parent.add(g);

    const counterX = shop.x + (shop.side < 0 ? 0.55 : -0.55);
    colliders.push({ minX: counterX - 0.45, maxX: counterX + 0.45, minZ: shop.z - 1.45, maxZ: shop.z + 1.45, top: 0.95, kind: 'prop' });
    if (index % 2 === 0) buildBanner(parent, shop.side * 6.4, shop.z, shop.sign, shop.side < 0 ? 0 : Math.PI);
  }

  // 店铺门前的外摆摊：业态、配色、商品、字号全部跟随最近的店铺，
  // 让摊子和店铺一眼就能看出是同一家，而不是各自孤立的木架。
  const stallSpots = [[-5.65, -169], [5.65, -144], [-5.65, -56], [5.65, 56], [-5.65, 144], [5.65, 169]];
  const nearestShop = (x, z) => SHOPS.reduce((best, s) => {
    const d = Math.hypot(s.x - x, s.z - z);
    return !best || d < best.d ? { shop: s, d } : best;
  }, null).shop;
  for (const [x, z] of stallSpots) {
    const shop = nearestShop(x, z);
    const sign = shop.sign, name = shop.name, color = shop.color;
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    // 让摊位正面朝向街心（与店铺一致），商品/招牌都面向玩家来的方向
    g.rotation.y = shop.rotY;
    const accent = mat(color);
    // 木架 + 斜撑
    for (const px of [-0.95, 0.95]) {
      for (const pz of [-0.55, 0.55]) addBox(g, 0.09, 2.1, 0.09, m.woodDark, px, 1.05, pz);
      const brace = addBox(g, 0.07, 0.07, 1.05, m.woodDark, px, 1.93, 0);
      brace.rotation.x = px < 0 ? 0.48 : -0.48;
    }
    // 斜布棚 + 波浪垂边 + 挑杆
    const canopy = addBox(g, 2.4, 0.08, 1.6, accent, 0, 2.18, 0);
    canopy.rotation.x = -0.14;
    for (let i = 0; i < 5; i++) {
      const flap = addBox(g, 0.46, 0.28 + (i % 2) * 0.09, 0.05, accent, -0.92 + i * 0.46, 2.0, -0.82);
      flap.rotation.x = -0.14;
    }
    addBox(g, 2.42, 0.06, 0.06, m.woodDark, 0, 2.07, -0.85);
    // 柜台 + 前挡板 + 按下层货架/台面两层摆货，品类更丰富
    addBox(g, 2.0, 0.72, 0.85, m.wood, 0, 0.38, 0);
    addBox(g, 2.05, 0.1, 0.92, m.woodDark, 0, 0.78, 0);
    addBox(g, 2.0, 0.42, 0.05, m.woodDark, 0, 0.51, -0.46);
    addGoods(g, shop, 0, 0, 0.83);
    // 店名字号幌：与店铺招牌同款同色，成为店铺的延伸
    const signMat = new THREE.MeshStandardMaterial({ map: signTexture(name, color), roughness: 0.9, side: THREE.DoubleSide });
    disposables.materials.push(signMat);
    const flag = addMesh(g, new THREE.PlaneGeometry(1.5, 0.47), signMat, 0, 1.72, -0.9);
    flag.rotation.y = Math.PI;
    // 摊主用的小秤 + 灯笼，增加生活气息
    addBox(g, 0.32, 0.05, 0.08, m.woodDark, 0.78, 0.83, -0.28);
    putLantern(g, accent, -0.82, 1.55, -0.8);
    parent.add(g);
    // 摊位随店铺朝向旋转了 ±90°，碰撞盒也要跟着交换长短边，否则与实物错位
    colliders.push({ minX: x - 0.85, maxX: x + 0.85, minZ: z - 1.15, maxZ: z + 1.15, top: 2.2, kind: 'prop' });
  }

  const cart = new THREE.Group();
  cart.position.set(3.1, 0, 257.5);
  addBox(cart, 1.6, 0.55, 2.1, m.wood, 0, 0.72, 0);
  for (const x of [-0.88, 0.88]) {
    const wheel = addMesh(cart, new THREE.CylinderGeometry(0.48, 0.48, 0.12, 12), m.woodDark, x, 0.48, 0.25);
    wheel.rotation.z = Math.PI / 2;
  }
  addBox(cart, 0.65, 0.65, 0.65, m.wood, -0.35, 1.3, 0.25);
  addBox(cart, 0.6, 0.6, 0.6, m.wood, 0.35, 1.25, -0.35);
  parent.add(cart);
  colliders.push({ minX: 2.1, maxX: 4.1, minZ: 256.2, maxZ: 258.8, top: 1.7, kind: 'prop' });
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
