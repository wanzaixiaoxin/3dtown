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
    // 临时绕行点：只改变当前走向，不覆盖 itinerary 目标
    detour: null,
    detourT: 0,
    detourGap: 0,
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
  if (npc.curAction && npc.curAction._clip === clip) {
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

// 预测性绕障：沿单位方向采样，返回最近会挡路的静态碰撞体。
function obstacleAhead(x, z, dx, dz, maxDist, r = 0.62) {
  const step = 0.6;
  for (let d = step; d <= maxDist; d += step) {
    const px = x + dx * d, pz = z + dz * d;
    for (const c of colliders) {
      if (c.water || (c.top !== undefined && c.top < 0.4)) continue;
      if (px > c.minX - r && px < c.maxX + r && pz > c.minZ - r && pz < c.maxZ + r) {
        return { c, d };
      }
    }
  }
  return null;
}

// 为障碍选一个能直线到达、且绕过去总路程最短的外侧角点。
function detourAround(c, x, z, gx, gz, dx, dz, r = 0.66) {
  const ex0 = c.minX - r, ex1 = c.maxX + r;
  const ez0 = c.minZ - r, ez1 = c.maxZ + r;
  let best = null, bestScore = Infinity;
  for (const [cx, cz] of [[ex0, ez0], [ex0, ez1], [ex1, ez0], [ex1, ez1]]) {
    const vx = cx - x, vz = cz - z;
    if (vx * dx + vz * dz < -0.4) continue;   // 不选身后
    let clear = true;                          // 直线不能穿过障碍本体
    for (let t = 0.15; t < 0.95; t += 0.12) {
      const sx = x + vx * t, sz = z + vz * t;
      if (sx > c.minX + 0.05 && sx < c.maxX - 0.05 && sz > c.minZ + 0.05 && sz < c.maxZ - 0.05) {
        clear = false; break;
      }
    }
    if (!clear) continue;
    const score = Math.hypot(vx, vz) + Math.hypot(cx - gx, cz - gz);
    if (score < bestScore) { bestScore = score; best = [cx, cz]; }
  }
  return best;
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

function facePoint(n, x, z, dt) {
  const yaw = Math.atan2(x - n.pos.x, z - n.pos.z);
  const dy = ((yaw - n.group.rotation.y + Math.PI) % (Math.PI * 2)) - Math.PI;
  n.group.rotation.y += dy * Math.min(1, dt * 9);
}

function interactionClip(n) {
  return n.variant % 3 === 0 ? 'Man Clapping' : 'Man Standing';
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

function advanceTarget(n) {
  if (n.itinerary) {
    // 流动人口的一次性行程：走到 exit 点后出城，不回到起点循环
    const done = n.routeIndex >= n.itinerary.length;
    if (done && n.flow) { retireFlowUnit(n); return; }
    const idx = done ? 0 : n.routeIndex;
    const point = n.itinerary[idx];
    n.routeIndex = done ? 1 : n.routeIndex + 1;
    n.target.set(point.x, 0, point.z);
    n.targetShopId = point.shopId || null;
    n.shopDoor = point.door || null;
    n.shopInside = point.inside || null;
    n.shopEntry = false;
    n.targetExit = !!(n.flow && point.exit);
  } else if (n.role === 'visitor') {
    const point = VISIT_POINTS[n.routeIndex % VISIT_POINTS.length];
    n.routeIndex = (n.routeIndex + 1) % VISIT_POINTS.length;
    const approach = point.door ? {
      x: point.customer.x + (Math.random() - 0.5) * 1.0,
      z: point.customer.z + (Math.random() - 0.5) * 1.4,
    } : point.customer;   // 水井/亭子没有店门，直接用原点和
    n.target.set(approach.x, 0, approach.z);
    n.targetShopId = point.id;
    n.shopDoor = point.door || null;
    n.shopInside = point.inside || null;
    n.shopEntry = false;
  } else {
    const a = Math.random() * Math.PI * 2;
    const rr = Math.random() * n.radius;
    let tx = n.home.x + Math.cos(a) * rr;
    let tz = n.home.y + Math.sin(a) * rr;
    [tx, tz] = clampTown(tx, tz);
    if (!blocked(tx, tz)) n.target.set(tx, 0, tz);
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
    if (n.waitT <= 0 && !n.detour && n.target.distanceTo(n.pos) < 0.85) {
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
        // 第一段：站在街边候客点，接下来才走向店门（不再从候客点瞬移到门口）
        n.shopEntry = true;
        // 门口也做一点散布，避免多人同时抢同一个坐标排队卡死
        n.target.set(
          n.shopDoor.x, 0,
          n.shopDoor.z + (Math.random() - 0.5) * 1.5,
        );
        n.waitT = 0.05;
      } else {
        if (n.targetShopId && n.shopDoor && n.shopInside) {
          // 第二段：到达店门口，平滑走进屋内再隐去（不是站定后瞬间消失）
          const walk = Math.max(0.3, VILLAGER_CFG.doorWalkTime ?? 1.15);
          n.shopVisitT = (VILLAGER_CFG.shopVisitTime || 2.2) + walk * 2;
          n.shopDoorDwell = walk;
          n.shopExitDwell = walk;
          n.shopVisitDoor = n.shopDoor;
          // 关键：此刻就快照屋内落点。下面的 advanceTarget 会把 n.shopInside
          // 改成下一家店，若进屋时再读就瞬移到几十米外，表现为「原地消失」。
          n.shopVisitInside = n.shopInside;
          n.pos.set(n.shopDoor.x, 0, n.shopDoor.z);
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

    // 绕行点生命周期：到达或超时即恢复原目标；短间隔防止角点间来回震荡
    n.detourGap = Math.max(0, (n.detourGap || 0) - dt);
    if (n.detour) {
      n.detourT -= dt;
      if (n.pos.distanceTo(n.detour) < 0.75 || n.detourT <= 0) {
        n.detour = null;
        n.detourGap = 0.4;
      }
    }
    const goal = n.detour || n.target;
    tmp.copy(goal).sub(n.pos); tmp.y = 0;
    const moveDist = tmp.length();
    let desiredYaw = n.yaw;
    if (moveDist > 0.4) {
      tmp.normalize();
      desiredYaw = Math.atan2(tmp.x, tmp.z);
      const dy0 = ((desiredYaw - n.group.rotation.y + Math.PI) % (Math.PI * 2)) - Math.PI;
      // 大角度转向也保留过半速度；旧值 0.15 会让 NPC 在障碍前几乎停住打转
      const turnFactor = 0.5 + 0.5 * Math.max(0, 1 - Math.abs(dy0) / 1.6);
      const sp = n.speed * (nightAmount > 0.5 ? 0.6 : 1) * turnFactor;
      const k = Math.min(1, dt * 10);
      n.vel.x += (tmp.x * sp - n.vel.x) * k;
      n.vel.z += (tmp.z * sp - n.vel.z) * k;
      n.yaw = desiredYaw;

      // 提前绕开静态障碍，不要走到贴墙才靠逃脱重试。
      // 进店的最后一段本来就要贴着房子走到门口，不能把它当障碍绕开。
      if (!n.detour && n.detourGap <= 0 && !n.shopEntry && moveDist > 3) {
        const hit = obstacleAhead(n.pos.x, n.pos.z, tmp.x, tmp.z, 2.6);
        if (hit) {
          const corner = detourAround(hit.c, n.pos.x, n.pos.z, goal.x, goal.z, tmp.x, tmp.z);
          if (corner) {
            n.detour = new THREE.Vector3(corner[0], 0, corner[1]);
            n.detourT = 4;
          }
        }
      }
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
    const rawSpeed = Math.hypot(moveX, moveZ) / Math.max(dt, 0.0001);
    // EMA smoothing — physical speed jitter (collider pushes, crowding) must
    // not feed straight into animation playback or the gait stutters
    n.smoothSpeed = (n.smoothSpeed ?? 0) + (rawSpeed - (n.smoothSpeed ?? 0)) * Math.min(1, dt * 6);
    const actualSpeed = n.smoothSpeed;

    // hysteresis for facing updates only
    const nowMoving = n.locomotionMoving ? actualSpeed > 0.05 : actualSpeed > 0.12;
    n.locomotionMoving = nowMoving;
    if (nowMoving) n.yaw = Math.atan2(moveX, moveZ);

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

    if (actualSpeed < 0.05 && moveDist > 0.6) {
      n.stuckT = (n.stuckT || 0) + dt;
      if (n.stuckT > 0.55) {
        // 逃脱只设置临时侧向绕行点，绝不覆盖 itinerary 目标：
        // 旧逻辑直接改 n.target，让 traveler/flow 丢失行程后反复重试。
        if (n.detour) {
          n.detour = null;   // 上一个绕行点无效，重选
        } else {
          const gx = n.target.x - n.pos.x, gz = n.target.z - n.pos.z;
          const gl = Math.hypot(gx, gz) || 1;
          const side = ((n.variant || 1) % 2) ? 1 : -1;
          const rr = 2 + Math.random() * 1.4;
          let ex = n.pos.x + (-gz / gl) * side * rr + (gx / gl) * 0.6;
          let ez = n.pos.z + (gx / gl) * side * rr + (gz / gl) * 0.6;
          [ex, ez] = clampTown(ex, ez, npcLimit(n));
          if (!blocked(ex, ez, 0.6)) {
            n.detour = new THREE.Vector3(ex, 0, ez);
            n.detourT = 3;
          }
        }
        n.waitT = 0.15;
        n.vel.set(0, 0, 0);
        n.stuckT = 0;
      }
    } else {
      n.stuckT = 0;
    }

    n.group.position.x = n.pos.x;
    n.group.position.z = n.pos.z;
    const dy = ((n.yaw - n.group.rotation.y + Math.PI) % (Math.PI * 2)) - Math.PI;
    // only snap instantly for near-opposite turns; small corrections ease out
    if (Math.abs(dy) > 1.8) {
      n.group.rotation.y = n.yaw;
    } else {
      n.group.rotation.y += dy * Math.min(1, dt * 18);
    }

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
