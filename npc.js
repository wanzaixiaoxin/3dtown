// ============================================================================
//  npc.js — villagers & animals using third-party FBX models (animated)
//  Wandering AI on the ground; animations driven by AnimationMixer.
// ============================================================================
import * as THREE from 'three';
import { instantiate, playClip, mixers } from './assets.js';
import { TOWN, colliders } from './world.js';

export const npcs = [];
let scene = null;

function clampTown(x, z) {
  const lim = TOWN.half - 3;
  return [Math.max(-lim, Math.min(lim, x)), Math.max(-lim, Math.min(lim, z))];
}

// find a nearby free spot if the requested spawn is inside an obstacle
function freeSpot(x, z) {
  if (!blocked(x, z, 0.6)) return [x, z];
  for (let r = 1.5; r <= 9; r += 1.5) {
    for (let a = 0; a < 12; a++) {
      const ang = (a / 12) * Math.PI * 2;
      const nx = x + Math.cos(ang) * r, nz = z + Math.sin(ang) * r;
      if (!blocked(nx, nz, 0.6)) return clampTown(nx, nz);
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

function addNPC(instance, opts) {
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
    yaw: Math.random() * Math.PI * 2,
    waitT: Math.random() * 2.5,
    walkClip: opts.walkClip,     // 'Man_Walk' / 'Walk'
    idleClip: opts.idleClip,     // 'Man_Idle' / 'Idle'
    curAction: null,
    mixer: null,
    size: instance.userData.size,
  };
  // start with idle
  // bone map + rest pose (for procedural gait overlay)
  const bones = {};
  instance.traverse((o) => { if (o.isBone) bones[o.name] = o; });
  npc.bones = bones;
  npc.rest = {};
  const animatedBones = ['UpperLegL','UpperLegR','LowerLegL','LowerLegR','UpperArmL','UpperArmR',
    'FrontUpLegL','FrontUpLegR','FrontLowLegL','FrontLowLegR','BackUpLegL','BackUpLegR','BackLowLegL','BackLowLegR'];
  for (const name of animatedBones) {
    if (bones[name]) npc.rest[name] = bones[name].quaternion.clone();
  }
  npc.walkPhase = Math.random() * Math.PI * 2;
  npc.walkBlend = 0;
  instance.updateMatrixWorld(true);
  npc.footAxisL = computeFootPitchAxis(bones['FootL']);
  npc.footAxisR = computeFootPitchAxis(bones['FootR']);

  let idle = playClip(instance, npc.idleClip || 'Idle', { speed: 0.9, register: false });
  if (!idle && instance.animations && instance.animations.length) {
    idle = playClip(instance, instance.animations[0].name, { speed: 0.9, register: false });
  }
  if (idle) { npc.mixer = idle.mixer; npc.curAction = idle.action; }
  npcs.push(npc);
  return npc;
}

function switchClip(npc, clipName, speed = 1) {
  if (!clipName) return;
  const clips = npc.group.animations || [];
  const clip = clips.find(c => c.name.toLowerCase().includes(clipName.toLowerCase()));
  if (!clip || !npc.mixer) return;
  if (npc.curAction && npc.curAction._clip === clip) {
    // same clip: just adapt playback speed so feet don't skate
    npc.curAction.timeScale = speed;
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

  // Villagers — mix of man/woman, placed around plaza & lanes
  const villagerSpots = [
    [-8, -8, 'manA'], [8, -8, 'woman'], [-8, 8, 'manB'], [8, 8, 'manA'],
    [-4, 4, 'woman'], [4, -4, 'manB'], [-16, 0, 'manA'], [16, 4, 'woman'],
    [0, 16, 'manB'], [0, -16, 'manA'], [-14, -14, 'woman'], [14, 14, 'manB'],
  ];
  villagerSpots.forEach(([ox, oz, kind]) => {
    const [x, z] = freeSpot(ox, oz);
    const inst = instantiate(assets[kind], { x, z });
    if (!inst) return;
    addNPC(inst, {
      type: 'villager', x, z,
      speed: 1.0 + Math.random() * 0.35,
      radius: 6 + Math.random() * 4,
      walkClip: 'Walk', idleClip: 'Idle',
    });
  });

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
      speed: 0.75 + Math.random() * 0.3,
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
      speed: 1.4 + Math.random() * 0.5,
      radius: 7 + Math.random() * 5,
      walkClip: 'Walk', idleClip: 'Idle',
    });
  });

  return npcs;
}

const _qTmp = new THREE.Quaternion();
const _xAxis = new THREE.Vector3(1, 0, 0);

function poseBone(bones, rest, name, angle) {
  const b = bones[name];
  if (!b) return;
  const r = rest[name];
  if (r) b.quaternion.copy(r);
  b.quaternion.multiply(_qTmp.setFromAxisAngle(_xAxis, angle));
}

function poseBoneAxis(bones, rest, name, axis, angle) {
  const b = bones[name];
  if (!b || !axis) return;
  const r = rest[name];
  if (r) b.quaternion.copy(r);
  b.quaternion.multiply(_qTmp.setFromAxisAngle(axis, angle));
}

// the foot bone's local axis that corresponds to the character's side axis
function computeFootPitchAxis(footBone) {
  if (!footBone) return null;
  const q = new THREE.Quaternion();
  footBone.getWorldQuaternion(q);
  return new THREE.Vector3(1, 0, 0).applyQuaternion(q.invert()).normalize();
}

// Procedural walk cycle overlay: the FBX walk clips have very small leg swing,
// so we drive thighs/shins/arms directly to get a readable, non-sliding gait.
export function applyGait(n, dt, moving, speed) {
  const isVillager = n.type === 'villager';
  const target = moving ? 1 : 0;
  n.walkBlend += (target - n.walkBlend) * Math.min(1, dt * 12);
  const w = n.walkBlend;

  if (w < 0.01) {
    // restore rest pose when idle
    for (const name in n.rest) n.bones[name].quaternion.copy(n.rest[name]);
    n.group.position.y = 0;
    return;
  }

  // stride frequency tied to actual speed (rad/s)
  n.walkPhase += dt * (2.6 + speed * 3.4);
  const ph = n.walkPhase;
  const sw = Math.sin(ph);
  const swOpp = Math.sin(ph + Math.PI);

  if (isVillager) {
    // natural walking amplitude (previous values made a "splits" pose)
    const thighAmp = 0.40;
    const thighL = sw * thighAmp * w;
    const thighR = swOpp * thighAmp * w;
    poseBone(n.bones, n.rest, 'UpperLegL', thighL);
    poseBone(n.bones, n.rest, 'UpperLegR', thighR);
    // knee flexes during the swing phase (never hyper-extends)
    const kneeL = Math.max(0, Math.cos(ph)) * 0.85 * w;
    const kneeR = Math.max(0, Math.cos(ph + Math.PI)) * 0.85 * w;
    poseBone(n.bones, n.rest, 'LowerLegL', -kneeL);
    poseBone(n.bones, n.rest, 'LowerLegR', -kneeR);
    // ankle keeps the sole roughly level
    poseBoneAxis(n.bones, n.rest, 'FootL', n.footAxisL, -(thighL - kneeL) * 0.55);
    poseBoneAxis(n.bones, n.rest, 'FootR', n.footAxisR, -(thighR - kneeR) * 0.55);
    // arms swing opposite to the legs
    poseBone(n.bones, n.rest, 'UpperArmL', swOpp * 0.30 * w);
    poseBone(n.bones, n.rest, 'UpperArmR', sw * 0.30 * w);
    // subtle vertical bob, twice per cycle (one per step)
    n.group.position.y = Math.abs(Math.sin(ph)) * 0.018 * w;
    if (n.bones.FootL) n.bones.FootL.scale.setScalar(0.86);
    if (n.bones.FootR) n.bones.FootR.scale.setScalar(0.86);
  } else {
    // quadruped: diagonal gait (front-left with back-right)
    poseBone(n.bones, n.rest, 'FrontUpLegL', sw * 0.5 * w);
    poseBone(n.bones, n.rest, 'FrontUpLegR', swOpp * 0.5 * w);
    poseBone(n.bones, n.rest, 'BackUpLegL', swOpp * 0.48 * w);
    poseBone(n.bones, n.rest, 'BackUpLegR', sw * 0.48 * w);
    poseBone(n.bones, n.rest, 'FrontLowLegL', -Math.max(0, -sw) * 0.6 * w);
    poseBone(n.bones, n.rest, 'FrontLowLegR', -Math.max(0, -swOpp) * 0.6 * w);
    poseBone(n.bones, n.rest, 'BackLowLegL', -Math.max(0, -swOpp) * 0.6 * w);
    poseBone(n.bones, n.rest, 'BackLowLegR', -Math.max(0, -sw) * 0.6 * w);
    n.group.position.y = Math.abs(Math.sin(ph * 2)) * 0.02 * w;
  }
}

export function updateNPCs(dt, nightAmount = 0) {
  const tmp = new THREE.Vector3();
  for (const n of npcs) {
    // animations
    if (n.mixer) n.mixer.update(dt);

    n.waitT -= dt;
    const moving = n.vel.lengthSq() > 0.05;

    if (n.waitT <= 0 && n.target.distanceTo(n.pos) < 0.6) {
      n.waitT = 2 + Math.random() * 4;
      const a = Math.random() * Math.PI * 2;
      const rr = Math.random() * n.radius;
      let tx = n.home.x + Math.cos(a) * rr;
      let tz = n.home.y + Math.sin(a) * rr;
      [tx, tz] = clampTown(tx, tz);
      if (!blocked(tx, tz)) n.target.set(tx, 0, tz);
    }

    tmp.copy(n.target).sub(n.pos); tmp.y = 0;
    const dist = tmp.length();
    let desiredYaw = n.yaw;
    if (dist > 0.5) {
      tmp.normalize();
      desiredYaw = Math.atan2(tmp.x, tmp.z);
      // turn in place first when the target is far off-axis
      const dy0 = ((desiredYaw - n.group.rotation.y + Math.PI) % (Math.PI * 2)) - Math.PI;
      const turnFactor = Math.abs(dy0) > 0.9 ? 0.15 : 1.0;
      const sp = n.speed * (nightAmount > 0.5 ? 0.6 : 1) * turnFactor;
      n.vel.x = tmp.x * sp; n.vel.z = tmp.z * sp;
      n.yaw = desiredYaw;
    } else {
      n.vel.multiplyScalar(0.8);
    }

    let nx = n.pos.x + n.vel.x * dt;
    let nz = n.pos.z + n.vel.z * dt;
    [nx, nz] = separate(nx, nz, 0.45);
    [nx, nz] = clampTown(nx, nz);
    n.pos.x = nx; n.pos.z = nz;

    // keep NPCs out of water entirely
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

    n.group.position.x = n.pos.x;
    n.group.position.z = n.pos.z;

    // smooth rotate toward movement direction
    const dy = ((n.yaw - n.group.rotation.y + Math.PI) % (Math.PI * 2)) - Math.PI;
    if (Math.abs(dy) > 0.7) {
      n.group.rotation.y = n.yaw;       // snap: never walk sideways/backwards
    } else {
      n.group.rotation.y += dy * Math.min(1, dt * 14);
    }

    // switch anim clip based on movement; sync playback speed to actual velocity
    const curSpeed = Math.hypot(n.vel.x, n.vel.z);
    const nowMoving = moving && curSpeed > 0.15;
    if (nowMoving) {
      // clip's natural stride covers ~1.3 m/s; scale timeScale accordingly
      const clipSpeed = Math.min(1.6, Math.max(0.5, curSpeed / 1.3));
      switchClip(n, n.walkClip, clipSpeed);
    } else {
      switchClip(n, n.idleClip, 1.0);
    }

    // procedural gait overlay (legs bend & arms swing, no foot sliding)
    applyGait(n, dt, nowMoving, curSpeed);
  }
}

export function disposeNPCs() {
  for (const n of npcs) scene.remove(n.group);
  npcs.length = 0;
}
