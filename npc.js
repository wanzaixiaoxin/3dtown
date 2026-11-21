// ============================================================================
//  npc.js — villagers & animals using third-party FBX models (animated)
//  Wandering AI on the ground; animations driven by AnimationMixer.
// ============================================================================
import * as THREE from 'three';
import { CONFIG } from './config.js';
import {
  instantiate, playClip, mixers, applyCharacterColors, randomCharacterColors,
} from './assets.js';
import { TOWN, colliders } from './world.js';
import { SHOPS } from './commerce.js';

const NPC_CFG = CONFIG.npcs;
const VILLAGER_CFG = NPC_CFG.villagers;
const FLOW_CFG = NPC_CFG.flow || {};
const APPROACH = CONFIG.town.approachRoads || {};

export const npcs = [];
let scene = null;
const contactShadowGeometry = new THREE.CircleGeometry(1, 16);
const contactShadowMaterial = new THREE.MeshBasicMaterial({
  color: 0x11140f, transparent: true, opacity: 0.2, depthWrite: false,
  polygonOffset: true, polygonOffsetFactor: -1,
});
const VISIT_POINTS = [
  // 候客点在街道一侧（不是店门线），否则所有 NPC 挤在同一条 x=±8.4 的队伍里互相卡住
  ...SHOPS.map(shop => ({ id: shop.id, customer: shop.customer, keeper: shop.keeper, sign: shop.sign, door: shop.door, inside: shop.inside })),
  ...NPC_CFG.visitPoints,
];

// 到店候客点加一点稳定散布，避免多人叠在同一坐标反复推挤
function shopApproach(shop) {
  return {
    x: shop.customer.x + (Math.random() - 0.5) * 1.0,
    z: shop.customer.z + (Math.random() - 0.5) * 1.4,
  };
}

// The four town gates (matching the buildGate calls in world.js). Travelers
// spawn outside one and walk in through it, visit shops, then head back out.
const GATES = NPC_CFG.gates;

function clampTown(x, z, lim = TOWN.half - 3) {
  return [Math.max(-lim, Math.min(lim, x)), Math.max(-lim, Math.min(lim, z))];
}
// 城门在 TOWN.half - 1.5；流动人口要能走到城外引道上的出生/消失点。
const approachEnd = TOWN.half - 2 + (APPROACH.length || 0);
const travellerLimit = approachEnd - 0.5;   // 城内闲逛的 traveler
const flowLimit = approachEnd + 0.5;        // 城外进出的流动人口
const npcLimit = n => n.flow ? flowLimit : (n.role === 'traveler' ? travellerLimit : undefined);

// 城外引道上的出生点与消失点（沿城门外法线向外）。
// dist 是「距镇中心」的距离：gate 本身已在 TOWN.half 附近，不能再叠加一次，
// 否则目标会落到 100m 外、超出 clamp 边界，NPC 永远到不了而原地挣扎。
function gatePoint(gate, ratio) {
  const dist = (TOWN.half - 2) + (APPROACH.length || 0) * (ratio ?? 0.78);
  return { x: gate.nx * dist, z: gate.nz * dist };
}

// find a nearby free spot if the requested spawn is inside an obstacle
function freeSpot(x, z, lim) {
  const occupied = (px, pz) => npcs.some(n => Math.hypot(n.pos.x - px, n.pos.z - pz) < 1.0);
  if (!blocked(x, z, 0.6) && !occupied(x, z)) return [x, z];
  for (let r = 1.5; r <= 9; r += 1.5) {
    for (let a = 0; a < 12; a++) {
      const ang = (a / 12) * Math.PI * 2;
      const nx = x + Math.cos(ang) * r, nz = z + Math.sin(ang) * r;
      if (!blocked(nx, nz, 0.6) && !occupied(nx, nz)) return clampTown(nx, nz, lim);
    }
  }
  return clampTown(x, z, lim);
}
function blocked(x, z, r = 0.35) {
  for (const c of colliders) {
    if (c.water) continue;
    if (x > c.minX - r && x < c.maxX + r && z > c.minZ - r && z < c.maxZ + r) return true;
  }
  return false;
}

// Rotate a "facing angle" so a model whose front is +Z points along yaw.
function faceYaw(yaw) { return yaw; }

// ---------------------------------------------------------------------------
//  导航：网格 A* + 视线平滑
//  单一路径规划器替代旧的「单点绕障」——后者面对连续建筑会反复选角点抖动。
//  网格在碰撞体数量变化时惰性重建，兼容「我的城市」动态加墙。
// ---------------------------------------------------------------------------
function shortestAngle(diff) {
  return THREE.MathUtils.euclideanModulo(diff + Math.PI, Math.PI * 2) - Math.PI;
}

const NAV_CELL = 1.6;
const NAV_NEIGHBORS = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [1, 1], [1, -1], [-1, 1], [-1, -1],
];
let nav = null;

// 与 blocked() 的区别：水也算障碍（NPC 不该横穿池塘），且用导航专用膨胀半径。
function navBlocked(x, z, r = 0.62) {
  for (const c of colliders) {
    if (c.top !== undefined && c.top < 0.4 && !c.water) continue;
    const pad = r + (c.water ? 0.3 : 0);
    if (x > c.minX - pad && x < c.maxX + pad && z > c.minZ - pad && z < c.maxZ + pad) return true;
  }
  return false;
}

function ensureNav() {
  if (nav && nav.version === colliders.length) return nav;
  const limit = flowLimit + 2;
  const min = -limit;
  const size = Math.ceil((limit * 2) / NAV_CELL);
  const passable = new Uint8Array(size * size);
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const x = min + (c + 0.5) * NAV_CELL;
      const z = min + (r + 0.5) * NAV_CELL;
      passable[r * size + c] = navBlocked(x, z, 0.62) ? 0 : 1;
    }
  }
  nav = { min, size, passable, version: colliders.length };
  return nav;
}

const clampCell = (v, n) => v < 0 ? 0 : (v >= n ? n - 1 : v);
function cellOf(x, z, g) {
  return [clampCell(Math.floor((x - g.min) / NAV_CELL), g.size),
          clampCell(Math.floor((z - g.min) / NAV_CELL), g.size)];
}
function cellCenter(c, r, g) {
  return [g.min + (c + 0.5) * NAV_CELL, g.min + (r + 0.5) * NAV_CELL];
}
function nearestFreeCell(x, z, g, maxRing = 8) {
  const [c0, r0] = cellOf(x, z, g);
  if (g.passable[r0 * g.size + c0]) return [c0, r0];
  for (let ring = 1; ring <= maxRing; ring++) {
    for (let dr = -ring; dr <= ring; dr++) {
      for (let dc = -ring; dc <= ring; dc++) {
        if (Math.max(Math.abs(dc), Math.abs(dr)) !== ring) continue;
        const c = c0 + dc, r = r0 + dr;
        if (c < 0 || r < 0 || c >= g.size || r >= g.size) continue;
        if (g.passable[r * g.size + c]) return [c, r];
      }
    }
  }
  return null;
}

// 二叉最小堆（按 score 数组里的值排序）
function heapPush(heap, idx, score) {
  heap.push(idx);
  let i = heap.length - 1;
  while (i > 0) {
    const p = (i - 1) >> 1;
    if (score[heap[p]] <= score[heap[i]]) break;
    [heap[p], heap[i]] = [heap[i], heap[p]]; i = p;
  }
}
function heapPop(heap, score) {
  const top = heap[0];
  const last = heap.pop();
  if (heap.length) {
    heap[0] = last;
    let i = 0;
    for (;;) {
      const l = i * 2 + 1, r = l + 1;
      let s = i;
      if (l < heap.length && score[heap[l]] < score[heap[s]]) s = l;
      if (r < heap.length && score[heap[r]] < score[heap[s]]) s = r;
      if (s === i) break;
      [heap[s], heap[i]] = [heap[i], heap[s]]; i = s;
    }
  }
  return top;
}

function findPathCells(sc, sr, tc, tr, g) {
  const N = g.size * g.size;
  const start = sr * g.size + sc, goal = tr * g.size + tc;
  if (start === goal) return [];
  const gScore = new Float32Array(N).fill(Infinity);
  const fScore = new Float32Array(N).fill(Infinity);
  const came = new Int32Array(N).fill(-1);
  const closed = new Uint8Array(N);
  const heap = [];
  gScore[start] = 0;
  fScore[start] = Math.hypot(tc - sc, tr - sr);
  heapPush(heap, start, fScore);
  let guard = 0;
  while (heap.length && guard++ < 8000) {
    const cur = heapPop(heap, fScore);
    if (closed[cur]) continue;
    if (cur === goal) {
      const path = [];
      for (let p = cur; p !== start && p >= 0; p = came[p]) path.push(p);
      path.reverse();
      return path;
    }
    closed[cur] = 1;
    const cc = cur % g.size, cr = (cur / g.size) | 0;
    for (const [dc, dr] of NAV_NEIGHBORS) {
      const nc = cc + dc, nr = cr + dr;
      if (nc < 0 || nr < 0 || nc >= g.size || nr >= g.size) continue;
      const ni = nr * g.size + nc;
      if (!g.passable[ni] || closed[ni]) continue;
      // 对角线不允许贴着墙角切过去（两侧正交格都必须可走）
      if (dc && dr && (!g.passable[cr * g.size + nc] || !g.passable[nr * g.size + cc])) continue;
      const tentative = gScore[cur] + (dc && dr ? 1.4142 : 1);
      if (tentative < gScore[ni]) {
        came[ni] = cur; gScore[ni] = tentative;
        fScore[ni] = tentative + Math.hypot(tc - nc, tr - nr);
        heapPush(heap, ni, fScore);
      }
    }
  }
  return null;
}

function lineClear(x0, z0, x1, z1, r = 0.5) {
  const dx = x1 - x0, dz = z1 - z0;
  const steps = Math.max(1, Math.ceil(Math.hypot(dx, dz) / 0.3));
  // 必须从 i=0 开始：NPC 贴着摊位/灯柱时，障碍往往只占起点前几厘米，
  // 旧版跳过起点 + 0.55 采样会误判为「直线可达」，导致 NPC 一直顶着障碍。
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    if (navBlocked(x0 + dx * t, z0 + dz * t, r)) return false;
  }
  return true;
}

// 规划世界坐标路径点（含视线平滑，去掉 A* 的锯齿）。
function planPath(x0, z0, gx, gz) {
  const g = ensureNav();
  const from = nearestFreeCell(x0, z0, g);
  const to = nearestFreeCell(gx, gz, g);
  if (!from || !to) return null;
  const cells = findPathCells(from[0], from[1], to[0], to[1], g);
  if (!cells) return null;
  const pts = cells.map(idx => {
    const [cx, cz] = cellCenter(idx % g.size, (idx / g.size) | 0, g);
    return [cx, cz];
  });
  pts.push([gx, gz]);
  // 贪心视线平滑：从当前位置跳跃到最远可直达的路点
  const out = [];
  let cx = x0, cz = z0, i = 0;
  while (i < pts.length) {
    let best = i;
    for (let j = pts.length - 1; j > i; j--) {
      if (lineClear(cx, cz, pts[j][0], pts[j][1])) { best = j; break; }
    }
    out.push(pts[best]); cx = pts[best][0]; cz = pts[best][1]; i = best + 1;
  }
  // 起点贴着障碍时，A* 首个格心可能在直线视线之外；先插一个可见的脱困点，
  // 否则 NPC 会一直顶着障碍却永远到不了第一个路点。
  if (out.length && !lineClear(x0, z0, out[0][0], out[0][1], 0.5)) {
    const esc = escapePoint(x0, z0, gx, gz);
    if (esc) out.unshift(esc);
  }
  return out;
}

// 目标点落到障碍里时，螺旋搜索最近的可达点（优先直线可见）。
function reachablePoint(n, x, z) {
  const lim = npcLimit(n);
  [x, z] = clampTown(x, z, lim);
  if (!navBlocked(x, z) && lineClear(n.pos.x, n.pos.z, x, z)) return [x, z];
  const spiral = (visibleOnly) => {
    for (let ring = 1; ring <= 10; ring++) {
      for (let a = 0; a < 16; a++) {
        const ang = (a / 16) * Math.PI * 2, rr = ring * 1.1;
        const nx = x + Math.cos(ang) * rr, nz = z + Math.sin(ang) * rr;
        const [px, pz] = clampTown(nx, nz, lim);
        if (navBlocked(px, pz)) continue;
        if (!visibleOnly || lineClear(n.pos.x, n.pos.z, px, pz)) return [px, pz];
      }
    }
    return null;
  };
  return spiral(true) || spiral(false) || [n.home.x, n.home.y];
}

// 顶墙时找一个「先离开障碍」的临时落脚点：必须当前可见、自身可站，
// 并尽量让后续到目标的视线通畅。用于脱困时替代纯侧向推力。
function escapePoint(x0, z0, gx, gz) {
  const candidates = [];
  for (const radius of [1.2, 1.8, 2.6]) {
    for (let a = 0; a < 16; a++) {
      const ang = (a / 16) * Math.PI * 2;
      const ex = x0 + Math.cos(ang) * radius;
      const ez = z0 + Math.sin(ang) * radius;
      if (navBlocked(ex, ez, 0.45)) continue;
      if (!lineClear(x0, z0, ex, ez, 0.45)) continue;
      const score = Math.hypot(ex - gx, ez - gz) + (lineClear(ex, ez, gx, gz, 0.45) ? 0 : 2);
      candidates.push([ex, ez, score]);
    }
    if (candidates.length) break;
  }
  if (!candidates.length) return null;
  candidates.sort((a, b) => a[2] - b[2]);
  return [candidates[0][0], candidates[0][1]];
}

// ---------------------------------------------------------------------------
//  持续人流：对象池 + 生命周期状态机
//  流动人口预先创建并复用，不反复实例化/销毁 skinned mesh（避免持续 GC 与卡顿）。
//  dormant → spawn(城外) → enter(进城) → visit(逛店) → exit(出城) → dormant
// ---------------------------------------------------------------------------
const flowPool = [];          // 所有流动人口实例（含休眠）
let flowSpawnTimer = 0;
let flowInitialized = false;
const randRange = ([lo, hi], fallback) =>
  Array.isArray([lo, hi]) && Number.isFinite(lo) && Number.isFinite(hi)
    ? lo + Math.random() * (hi - lo) : fallback;

// 生成一份「从某城门进城 → 逛 2~3 家店 → 从城门出城」的一次性行程
function makeFlowRoute(assets, gate) {
  const inward = VILLAGER_CFG.gateInward;
  const dl = Math.hypot(gate.x, gate.z) || 1;
  const inside = { x: gate.x - (gate.x / dl) * (inward + 1), z: gate.z - (gate.z / dl) * (inward + 1) };
  const steps = [{ x: inside.x, z: inside.z }];       // 城门内侧
  const stops = Math.round(randRange(FLOW_CFG.shopStops, 1));
  const picked = new Set();
  for (let k = 0; k < stops; k++) {
    let shop = null;
    for (let t = 0; t < 8; t++) {
      const cand = SHOPS[Math.floor(Math.random() * SHOPS.length)];
      if (!picked.has(cand.id)) { shop = cand; break; }
    }
    if (!shop) break;
    picked.add(shop.id);
    const approach = shopApproach(shop);
    steps.push({ x: approach.x, z: approach.z, shopId: shop.id, door: shop.door, inside: shop.inside });
  }
  // 返程：默认原门进出；按配置概率改走另一座城门，让四门始终都有人进出
  let exitGate = gate;
  if (Math.random() < (FLOW_CFG.exitOtherGate || 0)) {
    const others = GATES.filter(g => g !== gate);
    exitGate = others[Math.floor(Math.random() * others.length)];
  }
  if (exitGate !== gate) {
    const edl = Math.hypot(exitGate.x, exitGate.z) || 1;
    steps.push({
      x: exitGate.x - (exitGate.x / edl) * (inward + 1),
      z: exitGate.z - (exitGate.z / edl) * (inward + 1),
    });
  } else {
    steps.push({ x: inside.x, z: inside.z });          // 原门内侧
  }
  steps.push({ ...gatePoint(exitGate, APPROACH.despawnRatio), exit: true });
  return steps;
}

// 让一个休眠的流动人口从随机城门出生，并随机配色
function spawnFlowUnit(n, assets) {
  const gate = GATES[Math.floor(Math.random() * GATES.length)];
  const sp = gatePoint(gate, APPROACH.spawnRatio);
  n.itinerary = makeFlowRoute(assets, gate);
  n.routeIndex = 1;   // target 已是 itinerary[0]，下次推进从 [1] 开始
  n.pos.set(sp.x, 0, sp.z);
  n.group.position.set(sp.x, 0, sp.z);
  n.target.set(n.itinerary[0].x, 0, n.itinerary[0].z);
  n.path = null; n.pathGoal = null; n.stallT = 0;   // 复用对象：清除上一次行程残留
  n.targetShopId = null; n.shopDoor = null; n.shopInside = null; n.shopEntry = false;
  n.shopVisitDoor = null; n.shopVisitInside = null; n.shopExitDwell = 0;
  n.targetExit = false;
  n.exitHoldT = null;
  n.waitT = 0;
  n.vel.set(0, 0, 0);
  n.speed = randRange(FLOW_CFG.walkSpeed, 1.0);
  n.yaw = Math.atan2(gate.x - sp.x, gate.z - sp.z);  // 面朝城内
  n.group.rotation.y = n.yaw;
  n.group.visible = true;
  n.flowState = 'active';
  if (FLOW_CFG.randomColors) applyCharacterColors(n.group, randomCharacterColors());
  if (!npcs.includes(n)) npcs.push(n);
}

// 到达消失点：隐藏并归还池，等待下次 spawn
function retireFlowUnit(n) {
  n.flowState = 'dormant';
  n.group.visible = false;
  n.targetExit = false;
  const idx = npcs.indexOf(n);
  if (idx >= 0) npcs.splice(idx, 1);
}

// 每个流动人口走完全程后立刻补位，维持镇上「持续有人进出」
function updateFlowSpawner(dt) {
  if (!FLOW_CFG.enabled || !flowInitialized) return;
  flowSpawnTimer -= dt;
  if (flowSpawnTimer > 0) return;
  const dormant = flowPool.filter(n => n.flowState === 'dormant');
  if (dormant.length) spawnFlowUnit(dormant[0], null);
  flowSpawnTimer = randRange(FLOW_CFG.spawnInterval, 2.5);
}

export function createGaitState(instance, type) {
  const state = { group: instance, type, size: instance.userData.size, bones: {}, rest: {}, pitchAxes: {}, footRestScale: {}, footRestY: {} };
  instance.traverse((o) => { if (o.isBone) state.bones[o.name] = o; });
  const animatedBones = ['UpperLegL','UpperLegR','LowerLegL','LowerLegR','FootL','FootR','UpperArmL','UpperArmR',
    'FrontUpLegL','FrontUpLegR','FrontLowLegL','FrontLowLegR','FrontFootL','FrontFootR',
    'BackUpLegL','BackUpLegR','BackLowLegL','BackLowLegR','BackFootL','BackFootR'];
  for (const name of animatedBones) {
    if (state.bones[name]) state.rest[name] = state.bones[name].quaternion.clone();
  }
  state.walkPhase = Math.random() * Math.PI * 2;
  state.walkBlend = 0;
  instance.updateMatrixWorld(true);
  if (type === 'villager') {
    for (const [name, direction] of [['FootL', -1], ['FootR', 1]]) {
      const foot = state.bones[name];
      if (!foot) continue;
      const rootQ = instance.getWorldQuaternion(new THREE.Quaternion());
      const footQ = foot.getWorldQuaternion(new THREE.Quaternion());
      const localUp = new THREE.Vector3(0, 1, 0)
        .applyQuaternion(rootQ)
        .applyQuaternion(footQ.invert())
        .normalize();
      foot.quaternion.multiply(_qTmp.setFromAxisAngle(localUp, direction * THREE.MathUtils.degToRad(18)));
      state.rest[name].copy(foot.quaternion);
    }
    instance.updateMatrixWorld(true);
  }
  for (const name of animatedBones) {
    state.pitchAxes[name] = computePitchAxis(instance, state.bones[name]);
  }
  for (const nm of ['FootL','FootR','FrontFootL','FrontFootR','BackFootL','BackFootR']) {
    if (state.bones[nm]) {
      state.footRestScale[nm] = state.bones[nm].scale.clone();
      state.footRestY[nm] = state.bones[nm].getWorldPosition(new THREE.Vector3()).y;
    }
  }
  return state;
}

function addNPC(instance, opts) {
  instance.traverse(o => { if (o.isMesh) o.castShadow = false; });
  const contactShadow = new THREE.Mesh(contactShadowGeometry, contactShadowMaterial);
  contactShadow.rotation.x = -Math.PI / 2;
  contactShadow.position.y = 0.025;
  contactShadow.scale.setScalar(opts.type === 'villager' ? 0.34 : 0.62);
  instance.add(contactShadow);
  scene.add(instance);
  const npc = {
    group: instance,
    type: opts.type,
    pos: new THREE.Vector3(opts.x, 0, opts.z),
    vel: new THREE.Vector3(),
    target: new THREE.Vector3(opts.x, 0, opts.z),
    speed: opts.speed,
    home: new THREE.Vector2(opts.x, opts.z),
    radius: opts.radius,
    role: opts.role || 'wander',
    routeIndex: opts.routeIndex || 0,
    itinerary: opts.itinerary || null,
    // A* 路径点队列（世界坐标 [x,z]）；为空表示直线可达目标
    path: null,
    pathGoal: null,
    stallT: 0,
    pushT: 0,          // 脱困侧向推力剩余时长
    pushDir: null,
    flow: !!opts.flow,
    flowState: opts.flow ? 'dormant' : 'resident',
    targetExit: false,
    variant: opts.variant || 0,
    interactionT: 0,
    gestureT: 2 + Math.random() * 5,
    yaw: opts.faceYaw ?? Math.random() * Math.PI * 2,
    waitT: Math.random() * 2.5,
    walkClip: opts.walkClip,     // 'Man_Walk' / 'Walk'
    idleClip: opts.idleClip,     // 'Man_Idle' / 'Idle'
    curAction: null,
    mixer: null,
    size: instance.userData.size,
  };
  Object.assign(npc, createGaitState(instance, opts.type));

  // start with idle
  let idle = playClip(instance, npc.idleClip || 'Idle', { speed: 0.9, register: false });
  if (!idle && instance.animations && instance.animations.length) {
    idle = playClip(instance, instance.animations[0].name, { speed: 0.9, register: false });
  }
  if (idle) { npc.mixer = idle.mixer; npc.curAction = idle.action; }
  npcs.push(npc);
  return npc;
}

function switchClip(npc, clipName, speed = 1, dt = 0) {
  if (!clipName) return;
  const clips = npc.group.animations || [];
  const clip = clips.find(c => c.name.toLowerCase().includes(clipName.toLowerCase()));
  if (!clip || !npc.mixer) return;
  if (npc.curAction && npc.curAction.getClip() === clip) {
    // same clip: ease playback speed toward the target so feet don't skate or
    // stutter when the physical speed jitter frame-to-frame
    const t = dt > 0 ? Math.min(1, dt * 5) : 1;
    npc.curAction.timeScale += (speed - npc.curAction.timeScale) * t;
    return;
  }
  const action = npc.mixer.clipAction(clip);
  action.reset();
  action.setLoop(THREE.LoopRepeat, Infinity);
  action.timeScale = speed;
  action.fadeIn(0.28).play();
  if (npc.curAction) npc.curAction.fadeOut(0.28);
  npc.curAction = action;
}

// Proper obstacle avoidance: push the proposed position out of any collider
// (axis of least penetration). Prevents NPCs from ever entering walls/houses.
function separate(x, z, r) {
  for (const c of colliders) {
    if (c.water) continue;
    if (c.top !== undefined && c.top < 0.4) continue; // low thresholds not obstacles
    const innerX = x > c.minX - r && x < c.maxX + r;
    const innerZ = z > c.minZ - r && z < c.maxZ + r;
    if (!(innerX && innerZ)) continue;
    // penetration depths to each face
    const dl = x - (c.minX - r), dr = (c.maxX + r) - x;
    const df = z - (c.minZ - r), db = (c.maxZ + r) - z;
    const m = Math.min(dl, dr, df, db);
    if (m <= 0) continue;
    if (m === dl) x = c.minX - r;
    else if (m === dr) x = c.maxX + r;
    else if (m === df) z = c.minZ - r;
    else z = c.maxZ + r;
  }
  return [x, z];
}

// 沿墙滑行：separate 的推出向量就是障碍外法线，扣掉速度里朝障碍的分量。
function slideVelocity(n, pushX, pushZ) {
  const pl = Math.hypot(pushX, pushZ);
  if (pl < 1e-4) return;
  const ux = pushX / pl, uz = pushZ / pl;
  const into = n.vel.x * ux + n.vel.z * uz;
  if (into < 0) { n.vel.x -= into * ux; n.vel.z -= into * uz; }
}

// assets = dictionary from preloadAssets()
export function spawnNPCs(s, assets) {
  scene = s;
  if (!assets) return npcs;

  const villagerKinds = VILLAGER_CFG.kinds;
  const SP = VILLAGER_CFG.speed;
  for (let i = 0; i < VILLAGER_CFG.count; i++) {
    const kind = villagerKinds[i % villagerKinds.length];
    const keeper = i < VILLAGER_CFG.keeperCount;
    const traveler = i >= VILLAGER_CFG.travelerFrom;
    const role = keeper ? 'keeper' : traveler ? 'traveler' : 'visitor';
    const shop = SHOPS[(i * VILLAGER_CFG.routeStep) % SHOPS.length];
    let spot = keeper ? SHOPS[(i * 2) % SHOPS.length].keeper : shop.customer;
    let itinerary = null;
    if (traveler) {
      // enter from a random gate, visit a shop, then walk back out the same gate
      const gate = GATES[i % GATES.length];
      const inward = VILLAGER_CFG.gateInward;
      const dirLen = Math.hypot(gate.x, gate.z);
      const inX2 = gate.x - (gate.x / dirLen) * inward;
      const inZ2 = gate.z - (gate.z / dirLen) * inward;
      spot = { x: gate.x, z: gate.z };
      const approach = shopApproach(shop);
      itinerary = [
        { x: inX2, z: inZ2 },
        { x: approach.x, z: approach.z, shopId: shop.id, door: shop.door, inside: shop.inside },
        { x: gate.x, z: gate.z },
      ];
    }
    const [x, z] = freeSpot(spot.x, spot.z, traveler ? travellerLimit : undefined);
    const inst = instantiate(assets[kind], {
      x, z,
      colors: VILLAGER_CFG.randomColors ? randomCharacterColors() : null,
      variant: i + 1,
    });
    if (!inst) continue;
    addNPC(inst, {
      type: 'villager', x, z,
      speed: keeper ? 0 : (SP.base + (i % SP.cycle) * SP.step) * (traveler ? SP.travelerScale : 1),
      radius: VILLAGER_CFG.radius,
      role,
      routeIndex: (i * VILLAGER_CFG.routeStep) % SHOPS.length,
      itinerary,
      variant: i + 1,
      faceYaw: keeper ? (SHOPS[(i * 2) % SHOPS.length].side < 0 ? Math.PI / 2 : -Math.PI / 2) : undefined,
      walkClip: VILLAGER_CFG.walkClip, idleClip: VILLAGER_CFG.idleClip,
    });
  }

  // Farm animals — cows, sheep, pigs (animated Walk/Idle)
  NPC_CFG.animals.forEach(({ kind, x: ox, z: oz }) => {
    const [x, z] = freeSpot(ox, oz);
    const inst = instantiate(assets[kind], { x, z, rotY: Math.random() * Math.PI * 2 });
    if (!inst) return;
    addNPC(inst, {
      type: 'animal', x, z,
      speed: NPC_CFG.animalSpeed.base + Math.random() * NPC_CFG.animalSpeed.range,
      radius: NPC_CFG.animalRadius.base + Math.random() * NPC_CFG.animalRadius.range,
      walkClip: VILLAGER_CFG.walkClip, idleClip: VILLAGER_CFG.idleClip,
    });
  });

  // Dogs (pug) + fox — quicker wanderers
  NPC_CFG.smalls.forEach(({ kind, x: ox, z: oz }) => {
    const [x, z] = freeSpot(ox, oz);
    const inst = instantiate(assets[kind], { x, z });
    if (!inst) return;
    addNPC(inst, {
      type: 'animal', x, z,
      speed: NPC_CFG.smallSpeed.base + Math.random() * NPC_CFG.smallSpeed.range,
      radius: NPC_CFG.smallRadius.base + Math.random() * NPC_CFG.smallRadius.range,
      walkClip: VILLAGER_CFG.walkClip, idleClip: VILLAGER_CFG.idleClip,
    });
  });

  // 流动人口池：额外的一批人，从城外持续进出（复用实例，不反复创建）
  if (FLOW_CFG.enabled && !flowInitialized) {
    const poolSize = FLOW_CFG.poolSize || 12;
    const kinds = VILLAGER_CFG.kinds;
    for (let i = 0; i < poolSize; i++) {
      const kind = kinds[i % kinds.length];
      const gate = GATES[i % GATES.length];
      const sp = gatePoint(gate, APPROACH.spawnRatio);
      const inst = instantiate(assets[kind], {
        x: sp.x, z: sp.z,
        colors: FLOW_CFG.randomColors ? randomCharacterColors() : null,
        variant: i + 1,
      });
      if (!inst) continue;
      inst.visible = false;   // 初始全部休眠，由调度器陆续放出
      const n = addNPC(inst, {
        type: 'villager', x: sp.x, z: sp.z, speed: 1, radius: VILLAGER_CFG.radius,
        role: 'traveler', flow: true,
        walkClip: VILLAGER_CFG.walkClip, idleClip: VILLAGER_CFG.idleClip,
        variant: i + 1,
      });
      flowPool.push(n);
    }
    flowInitialized = true;
    // 初始先放出一批，避免开局镇外空无一人
    const initial = Math.min(FLOW_CFG.initialActive || 6, flowPool.length);
    for (let i = 0; i < initial; i++) {
      spawnFlowUnit(flowPool[i], null);
      // 让初始批次分散在行程不同阶段，不要挤在城门口
      const steps = flowPool[i].itinerary.length;
      const jump = i % Math.max(1, steps - 1);
      flowPool[i].routeIndex = jump + 1;
      const pt = flowPool[i].itinerary[jump];
      flowPool[i].pos.set(pt.x, 0, pt.z);
      flowPool[i].group.position.set(pt.x, 0, pt.z);
      flowPool[i].target.set(pt.x, 0, pt.z);
    }
    flowSpawnTimer = randRange(FLOW_CFG.spawnInterval, 2.5);
  }

  return npcs;
}

const _qTmp = new THREE.Quaternion();

function poseBoneAxis(bones, rest, name, axis, angle) {
  const b = bones[name];
  if (!b || !axis) return;
  const r = rest[name];
  if (r) b.quaternion.copy(r);
  b.quaternion.multiply(_qTmp.setFromAxisAngle(axis, angle));
}

// Convert the character's sideways axis into each bone's local space. FBX bones
// do not share a common local axis, even when their names are symmetrical.
function computePitchAxis(root, bone) {
  if (!bone) return null;
  const rootQ = root.getWorldQuaternion(new THREE.Quaternion());
  const boneQ = bone.getWorldQuaternion(new THREE.Quaternion());
  return new THREE.Vector3(1, 0, 0).applyQuaternion(rootQ).applyQuaternion(boneQ.invert()).normalize();
}

// Procedural walk cycle overlay: the FBX walk clips have very small leg swing,
// so we drive thighs/shins/arms directly to get a readable, non-sliding gait.
function poseQuadrupedLeg(n, upper, lower, foot, upperAngle, flexion, hind = false) {
  const lowerAngle = hind ? -flexion : flexion;
  poseBoneAxis(n.bones, n.rest, upper, n.pitchAxes[upper], upperAngle);
  poseBoneAxis(n.bones, n.rest, lower, n.pitchAxes[lower], lowerAngle);
  poseBoneAxis(n.bones, n.rest, foot, n.pitchAxes[foot], -(upperAngle + lowerAngle) * 0.85);
}

const _footPosition = new THREE.Vector3();
function groundFeet(n, dt) {
  let lowestOffset = Infinity;
  for (const name in n.footRestY) {
    const bone = n.bones[name];
    if (!bone) continue;
    const offset = bone.getWorldPosition(_footPosition).y - n.footRestY[name];
    lowestOffset = Math.min(lowestOffset, offset);
  }
  if (!Number.isFinite(lowestOffset)) return;
  const targetY = n.group.position.y - lowestOffset;
  if (n.groundY === undefined) n.groundY = targetY;
  n.groundY += (targetY - n.groundY) * Math.min(1, dt * 18);
  n.group.position.y = n.groundY;
}

export function applyGait(n, dt, moving, speed, mode = 'walk') {
  const isVillager = n.type === 'villager';
  const running = !isVillager && mode === 'run';
  const target = moving ? 1 : 0;
  n.walkBlend += (target - n.walkBlend) * Math.min(1, dt * 12);
  const w = n.walkBlend;

  const restoreFootScale = () => {
    if (!n.footRestScale) return;
    for (const nm in n.footRestScale) n.bones[nm].scale.copy(n.footRestScale[nm]);
  };
  if (w < 0.01) {
    // restore rest pose when idle
    for (const name in n.rest) n.bones[name].quaternion.copy(n.rest[name]);
    restoreFootScale();
    n.group.position.y = 0;
    groundFeet(n, dt);
    return;
  }

  // Match stride frequency to actual speed and the animal's leg scale.
  const walkRate = isVillager ? 2.6 + speed * 3.4 : 1.8 + speed * 4.0 / (n.size?.y || 1);
  n.walkPhase += dt * (running ? 6.4 + speed * 1.8 : walkRate);
  const ph = n.walkPhase;
  const sw = Math.sin(ph);
  const swOpp = Math.sin(ph + Math.PI);

  if (isVillager) {
    const thighAmp = 0.26;
    const thighL = sw * thighAmp * w;
    const thighR = swOpp * thighAmp * w;
    poseBoneAxis(n.bones, n.rest, 'UpperLegL', n.pitchAxes['UpperLegL'], thighL);
    poseBoneAxis(n.bones, n.rest, 'UpperLegR', n.pitchAxes['UpperLegR'], thighR);
    // Flex only the leg swinging forward; the supporting leg stays extended.
    const kneeL = Math.max(0, -Math.cos(ph)) * 0.9 * w;
    const kneeR = Math.max(0, -Math.cos(ph + Math.PI)) * 0.9 * w;
    poseBoneAxis(n.bones, n.rest, 'LowerLegL', n.pitchAxes['LowerLegL'], kneeL);
    poseBoneAxis(n.bones, n.rest, 'LowerLegR', n.pitchAxes['LowerLegR'], kneeR);
    // Reset from rest every frame and counter-rotate the ankle to keep soles level.
    poseBoneAxis(n.bones, n.rest, 'FootL', n.pitchAxes['FootL'], -(thighL + kneeL) * 0.85);
    poseBoneAxis(n.bones, n.rest, 'FootR', n.pitchAxes['FootR'], -(thighR + kneeR) * 0.85);
    // arms swing opposite to the legs
    poseBoneAxis(n.bones, n.rest, 'UpperArmL', n.pitchAxes['UpperArmL'], swOpp * 0.30 * w);
    poseBoneAxis(n.bones, n.rest, 'UpperArmR', n.pitchAxes['UpperArmR'], sw * 0.30 * w);
    // Lower the pelvis slightly at full stride instead of lifting both feet.
    n.group.position.y = -Math.abs(sw) * 0.018 * w;
    restoreFootScale();
  } else if (running) {
    const frontPhaseL = ph;
    const frontPhaseR = ph + 0.28;
    const backPhaseL = ph + Math.PI + 0.55;
    const backPhaseR = ph + Math.PI + 0.83;
    const frontL = Math.sin(frontPhaseL) * 0.62 * w;
    const frontR = Math.sin(frontPhaseR) * 0.62 * w;
    const backL = Math.sin(backPhaseL) * 0.72 * w;
    const backR = Math.sin(backPhaseR) * 0.72 * w;
    const flexFL = Math.max(0, -Math.cos(frontPhaseL)) * 1.05 * w;
    const flexFR = Math.max(0, -Math.cos(frontPhaseR)) * 1.05 * w;
    const flexBL = Math.max(0, -Math.cos(backPhaseL)) * 1.15 * w;
    const flexBR = Math.max(0, -Math.cos(backPhaseR)) * 1.15 * w;
    poseQuadrupedLeg(n, 'FrontUpLegL', 'FrontLowLegL', 'FrontFootL', frontL, flexFL);
    poseQuadrupedLeg(n, 'FrontUpLegR', 'FrontLowLegR', 'FrontFootR', frontR, flexFR);
    poseQuadrupedLeg(n, 'BackUpLegL', 'BackLowLegL', 'BackFootL', backL, flexBL, true);
    poseQuadrupedLeg(n, 'BackUpLegR', 'BackLowLegR', 'BackFootR', backR, flexBR, true);
    n.group.position.y = Math.pow(Math.max(0, Math.sin(ph + 0.4)), 3) * 0.06 * w;
    restoreFootScale();
  } else {
    const frontL = sw * 0.34 * w;
    const frontR = swOpp * 0.34 * w;
    const backL = swOpp * 0.32 * w;
    const backR = sw * 0.32 * w;
    const flexFL = Math.max(0, -Math.cos(ph)) * 0.65 * w;
    const flexFR = Math.max(0, Math.cos(ph)) * 0.65 * w;
    const flexBL = Math.max(0, Math.cos(ph)) * 0.65 * w;
    const flexBR = Math.max(0, -Math.cos(ph)) * 0.65 * w;
    poseQuadrupedLeg(n, 'FrontUpLegL', 'FrontLowLegL', 'FrontFootL', frontL, flexFL);
    poseQuadrupedLeg(n, 'FrontUpLegR', 'FrontLowLegR', 'FrontFootR', frontR, flexFR);
    poseQuadrupedLeg(n, 'BackUpLegL', 'BackLowLegL', 'BackFootL', backL, flexBL, true);
    poseQuadrupedLeg(n, 'BackUpLegR', 'BackLowLegR', 'BackFootR', backR, flexBR, true);
    n.group.position.y = -Math.abs(sw) * 0.012 * w;
    restoreFootScale();
  }
  if (!running) groundFeet(n, dt);
}

function facePoint(n, x, z, dt, maxRate = 0) {
  const yaw = Math.atan2(x - n.pos.x, z - n.pos.z);
  const dy = shortestAngle(yaw - n.group.rotation.y);
  const step = Math.min(1, dt * 9) * dy;
  // maxRate>0 时限制角速度（用于移动中平滑转身，避免瞬间掉头）
  const applied = maxRate > 0 ? THREE.MathUtils.clamp(step, -maxRate * dt, maxRate * dt) : step;
  n.group.rotation.y += applied;
  return dy;
}

function interactionClip(n) {
  // FBX 动画名是 Man_Clapping / Female_Clapping（下划线+性别前缀），
  // switchClip 用 includes 匹配，故用性别无关的单词子串。
  return n.variant % 3 === 0 ? 'Clapping' : 'Standing';
}

function updateKeeper(n, dt) {
  n.vel.set(0, 0, 0);
  n.group.position.x = n.pos.x;
  n.group.position.z = n.pos.z;
  n.gestureT -= dt;
  let guest = null, best = 2.8;
  for (const other of npcs) {
    if (other === n || (other.role !== 'visitor' && other.role !== 'traveler')) continue;
    const d = Math.hypot(other.pos.x - n.pos.x, other.pos.z - n.pos.z);
    if (d < best) { best = d; guest = other; }
  }
  if (guest && n.gestureT <= 0) {
    n.interactionT = 1.8 + (n.variant % 3) * 0.6;
    n.gestureT = 5 + Math.random() * 4;
  }
  n.interactionT = Math.max(0, n.interactionT - dt);
  if (n.interactionT > 0 && guest) {
    facePoint(n, guest.pos.x, guest.pos.z, dt);
    switchClip(n, interactionClip(n), 0.9);
  } else {
    facePoint(n, n.pos.x + Math.sin(n.yaw), n.pos.z + Math.cos(n.yaw), dt);
    switchClip(n, n.idleClip, 0.9);
  }
  applyGait(n, dt, false, 0);
}

function updateInteraction(n, dt) {
  if (!n.targetShopId) return false;
  const point = VISIT_POINTS.find(p => p.id === n.targetShopId);
  if (!point) return false;
  facePoint(n, point.keeper.x, point.keeper.z, dt);
  switchClip(n, interactionClip(n), 0.85);
  return true;
}

// 卡死检测的进度基准：目标或路点变化时必须重置，否则旧基准会误判。
function resetGoalCheck(n) {
  n.goalCheckT = 0;
  n.stallT = 0;
  n.goalPrevDist = n.path
    ? Math.hypot(n.path[0][0] - n.pos.x, n.path[0][1] - n.pos.z)
    : Math.hypot(n.target.x - n.pos.x, n.target.z - n.pos.z);
}

// 统一设置目标：校正到可达点，并作废旧路径（目标变了必须重新规划）。
function setTarget(n, x, z) {
  const [px, pz] = reachablePoint(n, x, z);
  n.target.set(px, 0, pz);
  n.path = null;
  n.pathGoal = null;
  n.pushT = 0;
  n.stallSide = 0;
  resetGoalCheck(n);
}

function advanceTarget(n) {
  if (n.itinerary) {
    // 流动人口的一次性行程：走到 exit 点后出城，不回到起点循环
    const done = n.routeIndex >= n.itinerary.length;
    if (done && n.flow) { retireFlowUnit(n); return; }
    const idx = done ? 0 : n.routeIndex;
    const point = n.itinerary[idx];
    n.routeIndex = done ? 1 : n.routeIndex + 1;
    setTarget(n, point.x, point.z);
    n.targetShopId = point.shopId || null;
    n.shopDoor = point.door || null;
    n.shopInside = point.inside || null;
    n.shopEntry = false;
    n.targetExit = !!(n.flow && point.exit);
  } else if (n.role === 'visitor') {
    // 只挑可达的拜访点，避免反复选中墙角里的坐标导致原地挣扎。
    const order = [];
    for (let k = 0; k < VISIT_POINTS.length; k++) order.push((n.routeIndex + k) % VISIT_POINTS.length);
    let point = null;
    for (const idx of order) {
      const p = VISIT_POINTS[idx];
      const [rx, rz] = reachablePoint(n, p.customer.x, p.customer.z);
      if (Math.hypot(rx - p.customer.x, rz - p.customer.z) < 2.2) { point = p; n.routeIndex = (idx + 1) % VISIT_POINTS.length; break; }
    }
    if (!point) { point = VISIT_POINTS[n.routeIndex % VISIT_POINTS.length]; n.routeIndex = (n.routeIndex + 1) % VISIT_POINTS.length; }
    const approach = point.door ? {
      x: point.customer.x + (Math.random() - 0.5) * 1.0,
      z: point.customer.z + (Math.random() - 0.5) * 1.4,
    } : point.customer;   // 水井/亭子没有店门，直接用原点和
    setTarget(n, approach.x, approach.z);
    n.targetShopId = point.id;
    n.shopDoor = point.door || null;
    n.shopInside = point.inside || null;
    n.shopEntry = false;
  } else {
    // wander（动物/闲逛）：优先在开阔可行走区域取点，最多试 8 次
    let tx = n.home.x, tz = n.home.y;
    for (let t = 0; t < 8; t++) {
      const a = Math.random() * Math.PI * 2;
      const rr = 1.5 + Math.random() * Math.max(1, n.radius - 1.5);
      const cx = n.home.x + Math.cos(a) * rr;
      const cz = n.home.y + Math.sin(a) * rr;
      const [px, pz] = clampTown(cx, cz, npcLimit(n));
      if (!navBlocked(px, pz) && lineClear(n.pos.x, n.pos.z, px, pz)) { tx = px; tz = pz; break; }
    }
    setTarget(n, tx, tz);
  }
}

export function updateNPCs(dt, nightAmount = 0) {
  updateFlowSpawner(dt);
  const tmp = new THREE.Vector3();
  const retireList = [];
  for (const n of npcs) {
    if (n.mixer) n.mixer.update(dt);
    if (n.role === 'keeper') {
      updateKeeper(n, dt);
      continue;
    }
    // 进店：门口 → 走进屋内 → 屋内停留 → 走出屋门 → 继续行程
    if (n.shopVisitT > 0) {
      n.shopVisitT -= dt;
      n.vel.set(0, 0, 0);
      // shopInside 会在 advanceTarget 里被下一站覆盖，进屋落点必须用进店时快照
      if (n.shopDoorDwell > 0) {
        n.shopDoorDwell -= dt;
        if (n.shopVisitInside) {
          facePoint(n, n.shopVisitInside.x, n.shopVisitInside.z, dt);
          const dx = n.shopVisitInside.x - n.pos.x, dz = n.shopVisitInside.z - n.pos.z;
          const d = Math.hypot(dx, dz);
          if (d > 0.05) {
            // 匀速走完门洞距离，而不是站定后瞬间消失
            const step = Math.min(d, d / Math.max(n.shopDoorDwell, dt) * dt);
            n.pos.x += dx / d * step; n.pos.z += dz / d * step;
            if (n.group) n.group.position.set(n.pos.x, 0, n.pos.z);
            switchClip(n, n.walkClip, 0.9, dt);
            applyGait(n, dt, true, n.speed);
          }
        }
        if (n.shopDoorDwell <= 0 && n.shopVisitInside) {
          n.pos.set(n.shopVisitInside.x, 0, n.shopVisitInside.z);
          if (n.group) {
            n.group.position.set(n.pos.x, 0, n.pos.z);
            n.group.visible = false;   // 走进门之后才隐藏
          }
        }
      } else if (n.shopExitDwell > 0 && n.shopVisitT <= n.shopExitDwell && n.shopVisitDoor) {
        // 出门：先在屋内现身，再平滑走回门口（不在门口凭空冒出）
        if (n.group && !n.group.visible) {
          if (n.shopVisitInside) n.pos.set(n.shopVisitInside.x, 0, n.shopVisitInside.z);
          n.group.position.set(n.pos.x, 0, n.pos.z);
          n.group.visible = true;
        }
        n.shopExitDwell -= dt;
        facePoint(n, n.shopVisitDoor.x, n.shopVisitDoor.z, dt);
        const dx = n.shopVisitDoor.x - n.pos.x, dz = n.shopVisitDoor.z - n.pos.z;
        const d = Math.hypot(dx, dz);
        if (d > 0.05) {
          const step = Math.min(d, d / Math.max(n.shopExitDwell, dt) * dt);
          n.pos.x += dx / d * step; n.pos.z += dz / d * step;
          if (n.group) n.group.position.set(n.pos.x, 0, n.pos.z);
          switchClip(n, n.walkClip, 0.9, dt);
          applyGait(n, dt, true, n.speed);
        }
      } else {
        switchClip(n, n.idleClip, 1.0, dt);
        applyGait(n, dt, false, 0);
      }
      if (n.shopVisitT <= 0) {
        if (n.shopVisitDoor) {
          n.pos.set(n.shopVisitDoor.x, 0, n.shopVisitDoor.z);
          if (n.group) n.group.position.set(n.pos.x, 0, n.pos.z);
        }
        if (n.group) n.group.visible = true;
        n.shopVisitT = 0;
        n.shopDoorDwell = 0;
        n.shopExitDwell = 0;
        n.shopVisitDoor = null;
        n.shopVisitInside = null;
        n.waitT = 0.5;
      }
      continue;
    }
    n.waitT -= dt;

    // 绕行途中不触发到站（绕行点只是临时走向，行程目标保持不变）
    // A* 路径耗尽且已靠近最后一个路点也算到达（门口点可能被网格膨胀微调过）
    const nearTarget = n.target.distanceTo(n.pos) < 0.85 ||
      (n.pathGoal && !n.path && Math.hypot(n.target.x - n.pos.x, n.target.z - n.pos.z) < 1.4);
    if (n.waitT <= 0 && nearTarget) {
      // 流动人口到达城外消失点：短暂停留后回收进池等待补位
      if (n.targetExit) {
        if (n.exitHoldT == null) n.exitHoldT = randRange(FLOW_CFG.exitHold, 1.2);
        n.exitHoldT -= dt;
        if (n.exitHoldT > 0) {
          n.vel.set(0, 0, 0);
          switchClip(n, n.idleClip, 1.0, dt);
          applyGait(n, dt, false, 0);
          continue;
        }
        retireList.push(n);
        continue;
      }
      if (n.targetShopId && n.shopDoor && n.shopInside && !n.shopEntry) {
        // 第一段：站在街边候客点，接下来才走向店门。
        // 店门坐标可能落在摊位 prop 的膨胀区里（物理上走不到），校正到
        // 门口外侧最近可走点，作为「实际到达门口」的位置。
        n.shopEntry = true;
        const doorZ = n.shopDoor.z + (Math.random() - 0.5) * 1.0;
        const [dx, dz] = reachablePoint(n, n.shopDoor.x, doorZ);
        n.doorReached = new THREE.Vector3(dx, 0, dz);
        setTarget(n, dx, dz);
        n.waitT = 0.05;
      } else {
        if (n.targetShopId && n.shopDoor && n.shopInside) {
          // 第二段：到达店门口，平滑走进屋内再隐去（不是站定后瞬间消失）
          const walk = Math.max(0.3, VILLAGER_CFG.doorWalkTime ?? 1.15);
          n.shopVisitT = (VILLAGER_CFG.shopVisitTime || 2.2) + walk * 2;
          n.shopDoorDwell = walk;
          n.shopExitDwell = walk;
          // 用「实际到达门口」的点做进店动画起点，不再瞬移到不可走的门坐标
          n.shopVisitDoor = n.doorReached ? n.doorReached.clone() : new THREE.Vector3(n.shopDoor.x, 0, n.shopDoor.z);
          // 关键：此刻就快照屋内落点。下面的 advanceTarget 会把 n.shopInside
          // 改成下一家店，若进屋时再读就瞬移到几十米外，表现为「原地消失」。
          n.shopVisitInside = n.shopInside;
          n.pos.set(n.shopVisitDoor.x, 0, n.shopVisitDoor.z);
          if (n.group) {
            n.group.position.set(n.pos.x, 0, n.pos.z);
            n.group.visible = true;
          }
        }
        n.waitT = n.role === 'traveler' ? 0.8 + Math.random() * 1.5 : 2 + (n.variant % 4) + Math.random() * 2;
        n.targetShopId = null;
        n.shopDoor = null;
        n.shopInside = null;
        n.shopEntry = false;
        advanceTarget(n);
      }
    }

    // ---- 导航目标：A* 路径点，直线可见时直接走目标 ----
    // 进店阶段也要寻路：候客点→店门之间的摊位/灯柱会挡路，
    // 旧的「跳过寻路直冲店门」正是 NPC 卡在门口的根因。
    const goalChanged = !n.pathGoal ||
      Math.abs(n.pathGoal[0] - n.target.x) > 0.05 || Math.abs(n.pathGoal[1] - n.target.z) > 0.05;
    if (goalChanged) {
      n.path = null; n.pathGoal = null;
      if (!lineClear(n.pos.x, n.pos.z, n.target.x, n.target.z, n.shopEntry ? 0.3 : 0.5)) {
        const planned = planPath(n.pos.x, n.pos.z, n.target.x, n.target.z);
        if (planned && planned.length) { n.path = planned; n.pathGoal = [n.target.x, n.target.z]; resetGoalCheck(n); }
      }
    }
    // 消费已到达的路径点（视线捷径让队列通常只剩 1~2 点）
    if (n.path && n.path.length) {
      const head = n.path[0];
      const next = n.path.length > 1 ? n.path[1] : n.target;
      // next 可能是 A* 路点数组 [x,z]，也可能是目标 Vector3，取坐标方式不同。
      const nx = Array.isArray(next) ? next[0] : next.x;
      const nz = Array.isArray(next) ? next[1] : next.z;
      if (Math.hypot(head[0] - n.pos.x, head[1] - n.pos.z) < 0.85 ||
          lineClear(n.pos.x, n.pos.z, nx, nz)) {
        n.path.shift();
        // 路径点消费完即置空，但保留 pathGoal 供「到站判定」识别已抵达，
        // 直到 advanceTarget 换新目标时才由 setTarget 清除。
        if (!n.path.length) n.path = null;
        resetGoalCheck(n);
      }
    }
    // 路径可能因碰撞推挤而失效：首个路点不再可见时立刻重规划，
    // 不能等 stall 计时——否则 NPC 会持续朝一个走不到的点顶墙。
    if (n.path && !lineClear(n.pos.x, n.pos.z, n.path[0][0], n.path[0][1], 0.45)) {
      const planned = planPath(n.pos.x, n.pos.z, n.target.x, n.target.z);
      n.path = planned && planned.length ? planned : null;
      n.pathGoal = n.path ? [n.target.x, n.target.z] : null;
      resetGoalCheck(n);
    }
    const gx = n.path ? n.path[0][0] : n.target.x;
    const gz = n.path ? n.path[0][1] : n.target.z;
    tmp.set(gx - n.pos.x, 0, gz - n.pos.z);
    const moveDist = tmp.length();
    if (moveDist > 0.35) {
      tmp.multiplyScalar(1 / moveDist);
      const desiredYaw = Math.atan2(tmp.x, tmp.z);
      // 身体朝向以有限角速度追向目标（不瞬移），大角度时先转身再加速，
      // 速度始终沿"身体实际朝向"而不是目标方向 —— 消除横移/螃蟹步。
      const dyaw = shortestAngle(desiredYaw - n.group.rotation.y);
      const maxRate = 3.4;                       // rad/s，约 0.9s 完成 180° 转身
      const turn = THREE.MathUtils.clamp(dyaw, -maxRate * dt, maxRate * dt);
      n.group.rotation.y += turn;
      n.yaw = n.group.rotation.y;
      const aligned = Math.max(0.25, 1 - Math.abs(dyaw) / 1.5); // 转身时减速但不 absolute stop
      const sp = n.speed * (nightAmount > 0.5 ? 0.6 : 1) * aligned;
      // 用朝向的 forward 作为移动方向（three 中 +Z 为模型正面）
      const fx = Math.sin(n.group.rotation.y), fz = Math.cos(n.group.rotation.y);
      const k = Math.min(1, dt * 8);
      n.vel.x += (fx * sp - n.vel.x) * k;
      n.vel.z += (fz * sp - n.vel.z) * k;
    } else {
      n.vel.multiplyScalar(0.8);
    }

    const previousX = n.pos.x, previousZ = n.pos.z;
    let nx = n.pos.x + n.vel.x * dt;
    let nz = n.pos.z + n.vel.z * dt;
    const rawNX = nx, rawNZ = nz;
    [nx, nz] = separate(nx, nz, 0.45);
    const pushX = nx - rawNX, pushZ = nz - rawNZ;
    if (Math.abs(pushX) + Math.abs(pushZ) > 1e-4) {
      // 被墙挡住时扣掉法向速度、保留切向速度，沿墙滑过去而不是原地顶墙
      slideVelocity(n, pushX, pushZ);
      nx = n.pos.x + n.vel.x * dt;
      nz = n.pos.z + n.vel.z * dt;
      [nx, nz] = separate(nx, nz, 0.45);
    }
    [nx, nz] = clampTown(nx, nz, npcLimit(n));
    n.pos.x = nx; n.pos.z = nz;

    for (const c of colliders) {
      if (!c.water) continue;
      const cx = (c.minX + c.maxX) / 2, cz = (c.minZ + c.maxZ) / 2;
      const rr = (c.maxX - c.minX) / 2;
      const dx = n.pos.x - cx, dz = n.pos.z - cz, d = Math.hypot(dx, dz);
      if (d < rr + 0.6) {
        const k = (rr + 0.6 - d) / (d || 1e-4);
        n.pos.x += dx * k; n.pos.z += dz * k;
        n.waitT = 0;
      }
    }

    for (const other of npcs) {
      if (other === n) continue;
      let dx = n.pos.x - other.pos.x, dz = n.pos.z - other.pos.z;
      let d = Math.hypot(dx, dz);
      if (d < 0.001) {
        const a = (npcs.indexOf(n) + 1) * 2.399;
        dx = Math.cos(a) * 0.001; dz = Math.sin(a) * 0.001; d = 0.001;
      }
      const clearance = n.type === 'villager' && other.type === 'villager' ? 0.75 : 0.9;
      if (d < clearance) {
        const push = (clearance - d) * 0.5 / d;
        n.pos.x += dx * push;
        n.pos.z += dz * push;
      }
    }
    [n.pos.x, n.pos.z] = separate(n.pos.x, n.pos.z, 0.45);
    [n.pos.x, n.pos.z] = clampTown(n.pos.x, n.pos.z, npcLimit(n));

    const moveX = n.pos.x - previousX, moveZ = n.pos.z - previousZ;
    const realMove = Math.hypot(moveX, moveZ);          // 本帧真实位移（卡死判定用）
    const rawSpeed = realMove / Math.max(dt, 0.0001);
    // EMA smoothing 只用于动画播放速度，避免碰撞推挤造成的步态抖动
    n.smoothSpeed = (n.smoothSpeed ?? 0) + (rawSpeed - (n.smoothSpeed ?? 0)) * Math.min(1, dt * 6);
    const actualSpeed = n.smoothSpeed;

    const nowMoving = n.locomotionMoving ? actualSpeed > 0.05 : actualSpeed > 0.12;
    n.locomotionMoving = nowMoving;
    // 注意：不再用位移方向覆盖 yaw。yaw 由身体朝向驱动，保证「朝哪走就朝哪看」。

    // ---- locomotion state machine ----
    // Clip switches are expensive (0.28s crossfade + restart). Requiring the
    // opposite condition to hold for 0.3s kills the frame-level Walk<->Idle
    // thrash seen when NPCs jostle against each other or walls.
    const wantState = actualSpeed > (n.locoState === 'walk' ? 0.06 : 0.16) ? 'walk' : 'idle';
    if (wantState !== n.locoState) {
      n.locoTimer = (n.locoTimer ?? 0) + dt;
      if (n.locoTimer >= 0.3) {
        n.locoState = wantState;
        n.locoTimer = 0;
      }
    } else {
      n.locoTimer = 0;
    }

    // 持续脱困推力：脱离灯柱/摊位这类小障碍需要好几帧侧向力，单次推力无效。
    n.pushT = Math.max(0, (n.pushT || 0) - dt);
    if (n.pushT > 0 && n.pushDir) {
      n.vel.x += n.pushDir[0] * n.speed * dt * 3.2;
      n.vel.z += n.pushDir[1] * n.speed * dt * 3.2;
    }

    // 卡死检测：按「到当前路点的距离是否真的在缩短」判定，而不是看单帧位移。
    // 顶墙时物理分离会把每帧位移压到几乎为零，但又会留下微小抖动；
    // 旧口径会被抖动反复清零，导致 NPC 原地顶墙几十秒。
    const activeGoal = n.path ? n.path[0] : null;
    const gx0 = (activeGoal ? activeGoal[0] : n.target.x) - n.pos.x;
    const gz0 = (activeGoal ? activeGoal[1] : n.target.z) - n.pos.z;
    const goalDist = Math.hypot(gx0, gz0);
    if (n.goalCheckT === undefined) { n.goalCheckT = 0; n.goalPrevDist = goalDist; }
    n.goalCheckT += dt;
    if (n.goalCheckT >= 0.6) {
      const progress = n.goalPrevDist - goalDist;
      // waitT / shopVisitT > 0 是主动停留，不算卡死
      if (progress < 0.15 && goalDist > 0.9 && n.waitT <= 0 && n.shopVisitT <= 0) {
        n.stallT = (n.stallT || 0) + n.goalCheckT;
      } else {
        n.stallT = 0;
        n.stallSide = 0;
      }
      n.goalCheckT = 0;
      n.goalPrevDist = goalDist;
    }
    if (n.stallT > 1.2) {
      n.stallT = 0;
      n.goalCheckT = 0;
      n.goalPrevDist = goalDist;
      n.path = null; n.pathGoal = null;
      const gl0 = Math.hypot(gx0, gz0) || 1;
      // 优先插入一个「先绕开眼前障碍」的路点；纯侧向推力只能挪几十厘米，
      // 面对灯柱/摊位这类小障碍仍然会反复顶墙。
      const escape = escapePoint(n.pos.x, n.pos.z, n.target.x, n.target.z);
      if (escape) {
        const edx = escape[0] - n.pos.x, edz = escape[1] - n.pos.z;
        const ed = Math.hypot(edx, edz) || 1;
        n.pushDir = [edx / ed, edz / ed];
        n.pushT = 1.0;
        n.stallSide = 0;
      } else {
        if (!n.stallSide) {
          for (const side of [1, -1]) {
            const ex = n.pos.x + (-gz0 / gl0) * side * 1.6;
            const ez = n.pos.z + (gx0 / gl0) * side * 1.6;
            if (!navBlocked(ex, ez, 0.45)) { n.stallSide = side; break; }
          }
          if (!n.stallSide) n.stallSide = 1;
        }
        n.pushDir = [-gz0 / gl0 * n.stallSide, gx0 / gl0 * n.stallSide];
        n.pushT = 1.0;
      }
      // 目标本身在墙里：强制校正到可达点
      if (navBlocked(n.target.x, n.target.z)) {
        const [rx, rz] = reachablePoint(n, n.target.x, n.target.z);
        setTarget(n, rx, rz);
      } else {
        const planned = planPath(n.pos.x, n.pos.z, n.target.x, n.target.z) || [];
        n.path = escape ? [escape, ...planned] : planned;
        if (n.path.length) {
          n.pathGoal = [n.target.x, n.target.z];
          resetGoalCheck(n);
        } else {
          setTarget(n, n.home.x, n.home.y);
        }
      }
      n.waitT = Math.max(n.waitT, 0.1);
    }

    n.group.position.x = n.pos.x;
    n.group.position.z = n.pos.z;
    // yaw 已由导航段同步为 body facing；此处仅在交互/进店等外部改过朝向时兜底。

    if (n.locoState === 'walk') {
      const naturalSpeed = n.type === 'villager' ? 1.3 : 0.55;
      const clipSpeed = Math.min(1.6, Math.max(0.5, actualSpeed / naturalSpeed));
      switchClip(n, n.walkClip, clipSpeed, dt);
    } else if (!updateInteraction(n, dt)) {
      switchClip(n, n.idleClip, 1.0, dt);
    }
    applyGait(n, dt, n.locoState === 'walk', actualSpeed);
  }

  // 本帧到达城外消失点的流动人口统一回收（避免在遍历中改 npcs 数组）
  for (const n of retireList) retireFlowUnit(n);
}

export function disposeNPCs() {
  for (const n of npcs) scene.remove(n.group);
  npcs.length = 0;
  for (const n of flowPool) scene.remove(n.group);
  flowPool.length = 0;
  flowInitialized = false;
  flowSpawnTimer = 0;
}
