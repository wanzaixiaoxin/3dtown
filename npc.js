// ============================================================================
//  npc.js — villagers & animals using third-party FBX models (animated)
//  Wandering AI on the ground; animations driven by AnimationMixer.
// ============================================================================
import * as THREE from 'three';
import { instantiate, playClip, mixers } from './assets.js';
import { TOWN, colliders } from './world.js';
import { SHOPS } from './commerce.js';

export const npcs = [];
let scene = null;
const contactShadowGeometry = new THREE.CircleGeometry(1, 16);
const contactShadowMaterial = new THREE.MeshBasicMaterial({
  color: 0x11140f, transparent: true, opacity: 0.2, depthWrite: false,
  polygonOffset: true, polygonOffsetFactor: -1,
});
const VISIT_POINTS = [
  ...SHOPS.map(shop => ({ id: shop.id, customer: shop.customer, keeper: shop.keeper, sign: shop.sign })),
  { id: 'well', customer: { x: 0, z: 2.2 }, keeper: { x: 0, z: -1.5 }, sign: '取水' },
  { id: 'pavilion', customer: { x: -9.5, z: 17 }, keeper: { x: -13, z: 20 }, sign: '观景' },
];

function clampTown(x, z) {
  const lim = TOWN.half - 3;
  return [Math.max(-lim, Math.min(lim, x)), Math.max(-lim, Math.min(lim, z))];
}

// find a nearby free spot if the requested spawn is inside an obstacle
function freeSpot(x, z) {
  const occupied = (px, pz) => npcs.some(n => Math.hypot(n.pos.x - px, n.pos.z - pz) < 1.0);
  if (!blocked(x, z, 0.6) && !occupied(x, z)) return [x, z];
  for (let r = 1.5; r <= 9; r += 1.5) {
    for (let a = 0; a < 12; a++) {
      const ang = (a / 12) * Math.PI * 2;
      const nx = x + Math.cos(ang) * r, nz = z + Math.sin(ang) * r;
      if (!blocked(nx, nz, 0.6) && !occupied(nx, nz)) return clampTown(nx, nz);
    }
  }
  return clampTown(x, z);
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

// assets = dictionary from preloadAssets()
export function spawnNPCs(s, assets) {
  scene = s;
  if (!assets) return npcs;

  const villagerKinds = ['manA', 'woman', 'manB', 'manA', 'woman', 'manB', 'manA', 'woman', 'manB', 'manA', 'woman', 'manB'];
  for (let i = 0; i < 18; i++) {
    const kind = villagerKinds[i % villagerKinds.length];
    const keeper = i < 6;
    const traveler = i >= 14;
    const role = keeper ? 'keeper' : traveler ? 'traveler' : 'visitor';
    const shop = SHOPS[(i * 3) % SHOPS.length];
    let spot = keeper ? SHOPS[(i * 2) % SHOPS.length].keeper : shop.customer;
    let itinerary = null;
    if (traveler) {
      const gateX = i % 2 === 0 ? -1.5 : 1.5;
      spot = { x: gateX, z: 39.5 + (i - 14) * 0.65 };
      itinerary = [
        { x: gateX, z: 38 },
        { x: gateX * 0.7, z: 24 },
        { x: shop.customer.x, z: shop.customer.z, shopId: shop.id },
        { x: gateX, z: 41 },
      ];
    }
    const [x, z] = freeSpot(spot.x, spot.z);
    const inst = instantiate(assets[kind], { x, z, variant: i + 1 });
    if (!inst) continue;
    addNPC(inst, {
      type: 'villager', x, z,
      speed: keeper ? 0 : (0.7 + (i % 5) * 0.09) * (traveler ? 1.1 : 1),
      radius: 4,
      role,
      routeIndex: (i * 3) % SHOPS.length,
      itinerary,
      variant: i + 1,
      faceYaw: keeper ? (SHOPS[(i * 2) % SHOPS.length].side < 0 ? Math.PI / 2 : -Math.PI / 2) : undefined,
      walkClip: 'Walk', idleClip: 'Idle',
    });
  }

  // Farm animals — cows, sheep, pigs (animated Walk/Idle)
  const animalSpots = [
    ['cow', 20, -20], ['cow', -20, -20], ['sheep', 14, -22], ['sheep', -14, -22],
    ['pig', 22, 8], ['pig', -22, 10], ['sheep', 18, 20], ['cow', -18, 18],
  ];
  animalSpots.forEach(([kind, ox, oz]) => {
    const [x, z] = freeSpot(ox, oz);
    const inst = instantiate(assets[kind], { x, z, rotY: Math.random() * Math.PI * 2 });
    if (!inst) return;
    addNPC(inst, {
      type: 'animal', x, z,
      speed: 0.45 + Math.random() * 0.2,
      radius: 5 + Math.random() * 4,
      walkClip: 'Walk', idleClip: 'Idle',
    });
  });

  // Dogs (pug) + fox — quicker wanderers
  const smallSpots = [['pug', 6, 10], ['pug', -10, 6], ['fox', 24, -6], ['fox', -24, -10]];
  smallSpots.forEach(([kind, ox, oz]) => {
    const [x, z] = freeSpot(ox, oz);
    const inst = instantiate(assets[kind], { x, z });
    if (!inst) return;
    addNPC(inst, {
      type: 'animal', x, z,
      speed: 0.5 + Math.random() * 0.25,
      radius: 7 + Math.random() * 5,
      walkClip: 'Walk', idleClip: 'Idle',
    });
  });

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

export function updateNPCs(dt, nightAmount = 0) {
  const tmp = new THREE.Vector3();
  for (const n of npcs) {
    if (n.mixer) n.mixer.update(dt);
    if (n.role === 'keeper') {
      updateKeeper(n, dt);
      continue;
    }
    n.waitT -= dt;

    if (n.waitT <= 0 && n.target.distanceTo(n.pos) < 0.6) {
      n.waitT = n.role === 'traveler' ? 0.8 + Math.random() * 1.5 : 2 + (n.variant % 4) + Math.random() * 2;
      n.targetShopId = null;
      if (n.itinerary) {
        const point = n.itinerary[n.routeIndex % n.itinerary.length];
        n.routeIndex = (n.routeIndex + 1) % n.itinerary.length;
        n.target.set(point.x, 0, point.z);
        n.targetShopId = point.shopId || null;
      } else if (n.role === 'visitor') {
        const point = VISIT_POINTS[n.routeIndex % VISIT_POINTS.length];
        n.routeIndex = (n.routeIndex + 1) % VISIT_POINTS.length;
        n.target.set(point.customer.x, 0, point.customer.z);
        n.targetShopId = point.id;
      } else {
        const a = Math.random() * Math.PI * 2;
        const rr = Math.random() * n.radius;
        let tx = n.home.x + Math.cos(a) * rr;
        let tz = n.home.y + Math.sin(a) * rr;
        [tx, tz] = clampTown(tx, tz);
        if (!blocked(tx, tz)) n.target.set(tx, 0, tz);
      }
    }

    tmp.copy(n.target).sub(n.pos); tmp.y = 0;
    const dist = tmp.length();
    let desiredYaw = n.yaw;
    if (dist > 0.5) {
      tmp.normalize();
      desiredYaw = Math.atan2(tmp.x, tmp.z);
      const dy0 = ((desiredYaw - n.group.rotation.y + Math.PI) % (Math.PI * 2)) - Math.PI;
      const turnFactor = Math.abs(dy0) > 0.9 ? 0.15 : 1.0;
      const sp = n.speed * (nightAmount > 0.5 ? 0.6 : 1) * turnFactor;
      // ease the velocity toward the desired one — hard assignments make the
      // gait stutter when the turn factor flips frame-to-frame
      const k = Math.min(1, dt * 10);
      n.vel.x += (tmp.x * sp - n.vel.x) * k;
      n.vel.z += (tmp.z * sp - n.vel.z) * k;
      n.yaw = desiredYaw;
    } else {
      n.vel.multiplyScalar(0.8);
    }

    const previousX = n.pos.x, previousZ = n.pos.z;
    let nx = n.pos.x + n.vel.x * dt;
    let nz = n.pos.z + n.vel.z * dt;
    [nx, nz] = separate(nx, nz, 0.45);
    [nx, nz] = clampTown(nx, nz);
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
    [n.pos.x, n.pos.z] = clampTown(n.pos.x, n.pos.z);

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

    if (actualSpeed < 0.04 && dist > 0.5) {
      n.stuckT = (n.stuckT || 0) + dt;
      if (n.stuckT > 0.8) {
        // escape: pick a fresh random reachable spot nearby and pause briefly —
        // re-targeting the same unreachable point caused a visible
        // start-stuck-start stutter loop
        for (let tries = 0; tries < 8; tries++) {
          const a = Math.random() * Math.PI * 2;
          const rr = 2 + Math.random() * 2;
          const [ex, ez] = clampTown(n.pos.x + Math.cos(a) * rr, n.pos.z + Math.sin(a) * rr);
          if (!blocked(ex, ez, 0.6)) { n.target.set(ex, 0, ez); break; }
        }
        n.waitT = 0.8 + Math.random() * 0.6;
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
}

export function disposeNPCs() {
  for (const n of npcs) scene.remove(n.group);
  npcs.length = 0;
}
