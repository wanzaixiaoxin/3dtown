import * as THREE from 'three';
import { ALL_ROADS } from './districts.js';

const ROAD_HALF = 7;
const CITY_LIMIT = 238;
const LANE_CENTERS = [1.8, 5.0];
const laneOffset = (dir, laneIndex = 0) => dir * LANE_CENTERS[laneIndex ? 1 : 0];
const VEHICLE_ROADS = ALL_ROADS.filter(v => v !== 0);
const vehicles = [];
const signalNodes = [];
const dummy = new THREE.Object3D();
let bodyMesh, cabinMesh, wheelMesh, detailMesh, redMesh, greenMesh;
let headlightMesh, beamMesh, streetBulbMaterial, beamMaterial;
const streetPointLights = [];
let nightAmount = 0, targetNight = 0;
let trafficTime = 0;
const exits = { gate: 0, parking: 0, station: 0 };

const TYPES = {
  private: { size: [1.3, 0.48, 2.8], speed: 9.0, colors: [0xc94d45, 0x3e6f9e, 0xe3e5e2, 0x31383d, 0x5b8b65, 0x865b8e] },
  taxi: { size: [1.35, 0.5, 2.9], speed: 8.8, colors: [0xe5b82f] },
  fire: { size: [1.7, 0.95, 4.6], speed: 7.8, colors: [0xc93c32] },
  ambulance: { size: [1.6, 0.9, 4.0], speed: 8.4, colors: [0xeeeeea] },
  construction: { size: [1.75, 1.0, 4.5], speed: 6.8, colors: [0xd6a42f] },
  truck: { size: [1.75, 1.2, 5.0], speed: 7.2, colors: [0x657b82, 0x8b775c, 0x59676c] },
  school: { size: [1.7, 1.1, 5.2], speed: 7.0, colors: [0xe4b632] },
};
const TYPE_NAMES = Object.keys(TYPES);

const PARKING_POINTS = [
  { axis: 'z', road: 200, p: -50, dir: 1, kind: 'parking' },
  { axis: 'x', road: 100, p: 150, dir: -1, kind: 'parking' },
  { axis: 'z', road: 100, p: -150, dir: 1, kind: 'parking' },
  { axis: 'x', road: -200, p: -150, dir: 1, kind: 'station' },
];

export function isPedestrianAllowed(x, z) {
  const vertical = ALL_ROADS.find(road => Math.abs(x - road) <= ROAD_HALF);
  const horizontal = ALL_ROADS.find(road => Math.abs(z - road) <= ROAD_HALF);
  if (vertical === undefined && horizontal === undefined) return true;
  if (vertical === 0 || horizontal === 0) return true;
  if (vertical !== undefined && ALL_ROADS.some(road => Math.abs(z - (road - 9)) < 2 || Math.abs(z - (road + 9)) < 2)) return true;
  if (horizontal !== undefined && ALL_ROADS.some(road => Math.abs(x - (road - 9)) < 2 || Math.abs(x - (road + 9)) < 2)) return true;
  return false;
}

function transform(x, y, z, sx, sy, sz, ry = 0) { return { x, y, z, sx, sy, sz, ry }; }
function instancedBoxes(parent, transforms, material) {
  if (!transforms.length) return null;
  const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), material, transforms.length);
  transforms.forEach((t, i) => {
    dummy.position.set(t.x, t.y, t.z); dummy.rotation.set(0, t.ry || 0, 0); dummy.scale.set(t.sx, t.sy, t.sz);
    dummy.updateMatrix(); mesh.setMatrixAt(i, dummy.matrix);
  });
  mesh.instanceMatrix.needsUpdate = true; mesh.receiveShadow = true; parent.add(mesh); return mesh;
}

function buildMarkings(group) {
  const white = [], yellow = [], cement = [], arrows = [];
  const L = CITY_LIMIT * 2 + 16;
  for (const road of VEHICLE_ROADS) {
    for (const side of [-1, 1]) {
      yellow.push(transform(road + side * 0.13, 0.073, 0, 0.09, 0.018, L));
      yellow.push(transform(0, 0.074, road + side * 0.13, L, 0.018, 0.09));
      white.push(transform(road + side * 6.65, 0.073, 0, 0.12, 0.018, L));
      white.push(transform(0, 0.074, road + side * 6.65, L, 0.018, 0.12));
      for (let p = -CITY_LIMIT; p < CITY_LIMIT; p += 8) {
        white.push(transform(road + side * 3.5, 0.075, p, 0.1, 0.018, 3.6));
        white.push(transform(p, 0.076, road + side * 3.5, 3.6, 0.018, 0.1));
      }
    }
    const cuts = [-260, ...ALL_ROADS, 260];
    for (let i = 0; i < cuts.length - 1; i++) {
      const start = cuts[i] + 11, end = cuts[i + 1] - 11;
      if (end <= start) continue;
      const mid = (start + end) / 2, len = end - start;
      for (const side of [-1, 1]) {
        cement.push(transform(road + side * 8.5, 0.055, mid, 3, 0.09, len));
        cement.push(transform(mid, 0.055, road + side * 8.5, len, 0.09, 3));
      }
    }
    for (const cross of ALL_ROADS) for (const dir of [-1, 1]) for (const laneIndex of [0, 1]) {
      const turnBias = ((Math.abs(road + cross) / 100) | 0) % 3 - 1;
      arrows.push({ axis: 'z', road, cross, dir, laneIndex, turnBias });
      arrows.push({ axis: 'x', road, cross, dir, laneIndex, turnBias: -turnBias });
    }
  }
  for (const v of ALL_ROADS) for (const h of ALL_ROADS) {
    if (v === 0 && h === 0) continue;
    for (const side of [-1, 1]) {
      for (let i = 0; i < 11; i++) {
        white.push(transform(v - 6 + i * 1.2, 0.082, h + side * 9, 0.65, 0.02, 3));
        white.push(transform(v + side * 9, 0.083, h - 6 + i * 1.2, 3, 0.02, 0.65));
      }
      white.push(transform(v - side * 3.4, 0.08, h + side * 10.5, 6.4, 0.02, 0.22));
      white.push(transform(v + side * 10.5, 0.08, h - side * 3.4, 0.22, 0.02, 6.4));
    }
  }
  instancedBoxes(group, cement, new THREE.MeshStandardMaterial({ color: 0xa6a8a5, roughness: 1 }));
  instancedBoxes(group, white, new THREE.MeshBasicMaterial({ color: 0xf1f0e8 }));
  instancedBoxes(group, yellow, new THREE.MeshBasicMaterial({ color: 0xe8b83f }));

  const shape = new THREE.Shape();
  shape.moveTo(0, 1.25); shape.lineTo(0.55, 0.45); shape.lineTo(0.2, 0.45);
  shape.lineTo(0.2, -1); shape.lineTo(-0.2, -1); shape.lineTo(-0.2, 0.45); shape.lineTo(-0.55, 0.45); shape.closePath();
  const geometry = new THREE.ShapeGeometry(shape); geometry.rotateX(-Math.PI / 2);
  const mesh = new THREE.InstancedMesh(geometry, new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide }), arrows.length);
  arrows.forEach((a, i) => {
    const lane = laneOffset(a.dir, a.laneIndex);
    // Right-hand traffic: forward × up points to the road edge.
    const x = a.axis === 'z' ? a.road - lane : a.cross - a.dir * 14;
    const z = a.axis === 'z' ? a.cross - a.dir * 14 : a.road + lane;
    let yaw = a.axis === 'z' ? (a.dir > 0 ? Math.PI : 0) : (a.dir > 0 ? -Math.PI / 2 : Math.PI / 2);
    yaw += a.turnBias * Math.PI / 4;
    dummy.position.set(x, 0.088, z); dummy.rotation.set(0, yaw, 0); dummy.scale.set(0.85, 0.85, 0.85); dummy.updateMatrix(); mesh.setMatrixAt(i, dummy.matrix);
  });
  mesh.instanceMatrix.needsUpdate = true; group.add(mesh);
}

function signalGreen(axis) {
  const phase = trafficTime % 16;
  return axis === 'z' ? phase < 7 : phase >= 8 && phase < 15;
}

function buildSignals(group) {
  const poles = [];
  for (const v of VEHICLE_ROADS) for (const h of ALL_ROADS) {
    signalNodes.push({ x: v + 8.5, z: h + 8.5, axis: 'z' }, { x: v - 8.5, z: h - 8.5, axis: 'x' });
    poles.push(transform(v + 8.5, 1.5, h + 8.5, 0.12, 3, 0.12), transform(v - 8.5, 1.5, h - 8.5, 0.12, 3, 0.12));
    poles.push(transform(v + 8.5, 2.9, h + 8.5, 0.65, 0.95, 0.25), transform(v - 8.5, 2.9, h - 8.5, 0.65, 0.95, 0.25));
  }
  instancedBoxes(group, poles, new THREE.MeshStandardMaterial({ color: 0x343b3c, roughness: 0.8 }));
  const geometry = new THREE.SphereGeometry(0.2, 8, 6);
  redMesh = new THREE.InstancedMesh(geometry, new THREE.MeshBasicMaterial({ color: 0xff3c2f }), signalNodes.length);
  greenMesh = new THREE.InstancedMesh(geometry, new THREE.MeshBasicMaterial({ color: 0x58e37b }), signalNodes.length);
  redMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); greenMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  group.add(redMesh, greenMesh);
}

function signBoard(group, text, x, z, width = 3.8, color = '#286293') {
  const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 160;
  const ctx = canvas.getContext('2d'); ctx.fillStyle = color; ctx.fillRect(0, 0, 512, 160);
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 8; ctx.strokeRect(8, 8, 496, 144);
  ctx.fillStyle = '#fff'; ctx.font = 'bold 40px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, 256, 82);
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(width, width * 0.3125), new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide }));
  sign.position.set(x, 3.2, z); group.add(sign);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 2.8, 8), new THREE.MeshStandardMaterial({ color: 0x4b5253 }));
  pole.position.set(x, 1.4, z); group.add(pole);
}

function buildRoadSigns(group) {
  for (const args of [['中央商业街 步行优先',-7,9],['学校区域 减速慢行',38,-38],['工业区 货车通行',-70,-38],['全城限速 40',58,8]]) signBoard(group, ...args);
  for (const v of VEHICLE_ROADS) for (const h of ALL_ROADS) {
    const vi = ALL_ROADS.indexOf(v) + 1, hi = ALL_ROADS.indexOf(h) + 1;
    signBoard(group, `经${vi}路 / 纬${hi}路`, v + 9.2, h - 9.2, 2.4, '#287052');
  }
}

function buildStreetLights(group) {
  const poles = [], bulbs = [];
  for (const road of ALL_ROADS) for (const axis of ['x', 'z']) {
    for (let p = -220; p <= 220; p += 44) for (const side of [-1, 1]) {
      const x = axis === 'z' ? road + side * 10.5 : p;
      const z = axis === 'z' ? p : road + side * 10.5;
      poles.push(transform(x, 2.4, z, 0.1, 4.8, 0.1));
      poles.push(transform(x, 4.65, z, 0.75, 0.08, 0.08));
      bulbs.push({ x, z });
    }
  }
  instancedBoxes(group, poles, new THREE.MeshStandardMaterial({ color: 0x3d4445, roughness: 0.8 }));
  streetBulbMaterial = new THREE.MeshStandardMaterial({ color: 0x77776b, emissive: 0xffd58a, emissiveIntensity: 0, roughness: 0.45 });
  const bulbMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(0.2, 8, 6), streetBulbMaterial, bulbs.length);
  bulbs.forEach((p, i) => {
    dummy.position.set(p.x, 4.55, p.z); dummy.rotation.set(0, 0, 0); dummy.scale.set(1, 1, 1); dummy.updateMatrix(); bulbMesh.setMatrixAt(i, dummy.matrix);
  });
  bulbMesh.instanceMatrix.needsUpdate = true; group.add(bulbMesh);
  for (const road of [-200, -100, 100, 200]) for (const cross of [-200, 0, 200]) {
    const light = new THREE.PointLight(0xffc87c, 0, 20, 2);
    light.position.set(road + 4, 4.4, cross + 4); light.castShadow = false;
    streetPointLights.push(light); group.add(light);
  }
}

function spawnPoints() {
  const points = [...PARKING_POINTS];
  for (const road of VEHICLE_ROADS) for (const axis of ['x', 'z']) for (const side of [-1, 1]) {
    points.push({ axis, road, p: side * 236, dir: -side, kind: 'gate' });
  }
  return points;
}
const SPAWN_POINTS = spawnPoints();

function applySpawn(v, point) {
  v.axis = point.axis; v.road = point.road; v.p = point.p; v.dir = point.dir;
  v.laneIndex = v.laneIndex || 0; v.lane = laneOffset(point.dir, v.laneIndex);
  v.speed = 0; v.active = true; v.turn = null; v.respawnT = 0; v.spawnKind = point.kind;
}

function buildVehicles(group) {
  for (let i = 0; i < 64; i++) {
    const axis = i % 2 ? 'x' : 'z';
    const road = VEHICLE_ROADS[(i >> 1) % VEHICLE_ROADS.length];
    const dir = i % 4 < 2 ? 1 : -1;
    const laneIndex = (i >> 2) % 2;
    const type = TYPE_NAMES[i % TYPE_NAMES.length];
    const spec = TYPES[type];
    vehicles.push({
      axis, road, dir, laneIndex, lane: laneOffset(dir, laneIndex), p: -220 + (i % 16) * 28,
      speed: 2 + i % 4, targetSpeed: spec.speed * (0.9 + (i % 3) * 0.08), type,
      color: spec.colors[i % spec.colors.length], active: true, respawnT: 0, turn: null, exitAtGate: i % 5 === 0,
    });
  }
  const count = vehicles.length;
  bodyMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.58, metalness: 0.12 }), count);
  cabinMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: 0x9fb3bc, roughness: 0.3, metalness: 0.08 }), count);
  detailMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.65 }), count);
  wheelMesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.24, 0.24, 0.18, 12), new THREE.MeshStandardMaterial({ color: 0x17191a, roughness: 0.95 }), count * 4);
  headlightMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: 0xfff2c2, emissive: 0xffd88a, emissiveIntensity: 2.4 }), count * 2);
  const beamCanvas = document.createElement('canvas'); beamCanvas.width = 64; beamCanvas.height = 128;
  const beamCtx = beamCanvas.getContext('2d');
  const gradient = beamCtx.createLinearGradient(0, 0, 0, 128);
  gradient.addColorStop(0, 'rgba(255,235,180,0.65)'); gradient.addColorStop(1, 'rgba(255,235,180,0)');
  beamCtx.fillStyle = gradient; beamCtx.fillRect(0, 0, 64, 128);
  const beamTexture = new THREE.CanvasTexture(beamCanvas);
  beamMaterial = new THREE.MeshBasicMaterial({ map: beamTexture, color: 0xffe4a8, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
  const beamGeometry = new THREE.PlaneGeometry(3.4, 7); beamGeometry.rotateX(-Math.PI / 2);
  beamMesh = new THREE.InstancedMesh(beamGeometry, beamMaterial, count);
  for (const mesh of [bodyMesh, cabinMesh, detailMesh, wheelMesh, headlightMesh, beamMesh]) mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  vehicles.forEach((v, i) => {
    bodyMesh.setColorAt(i, new THREE.Color(v.color));
    detailMesh.setColorAt(i, new THREE.Color(v.type === 'ambulance' ? 0xd94037 : v.type === 'taxi' ? 0x222222 : v.type === 'fire' ? 0xd8d8d0 : 0x555b58));
  });
  bodyMesh.instanceColor.needsUpdate = detailMesh.instanceColor.needsUpdate = true;
  group.add(bodyMesh, cabinMesh, detailMesh, wheelMesh, headlightMesh, beamMesh);
}

function nextIntersection(v) {
  let nearest = Infinity, intersection = 0;
  for (const cross of ALL_ROADS) {
    const d = (cross - v.p) * v.dir;
    if (d > 0 && d < nearest) { nearest = d; intersection = cross; }
  }
  return { distance: nearest, intersection };
}

function basePose(v) {
  return {
    // 右侧通行：车身右侧朝向路缘，左转/右转/掉头均复用此坐标。
    x: v.axis === 'x' ? v.p : v.road - v.lane,
    z: v.axis === 'z' ? v.p : v.road + v.lane,
    yaw: v.axis === 'x' ? (v.dir > 0 ? Math.PI / 2 : -Math.PI / 2) : (v.dir > 0 ? 0 : Math.PI),
  };
}

function beginTurn(v, cross) {
  if (cross === 0 || v.turn) return;
  const from = basePose(v), newAxis = v.axis === 'x' ? 'z' : 'x', newDir = Math.random() < 0.5 ? -1 : 1;
  const laneIndex = v.laneIndex || 0;
  const next = { axis: newAxis, road: cross, p: v.road + newDir * 10, dir: newDir, laneIndex, lane: laneOffset(newDir, laneIndex) };
  const oldAxis = v.axis, oldRoad = v.road, oldP = v.p, oldDir = v.dir, oldLane = v.lane, oldLaneIndex = v.laneIndex;
  Object.assign(v, next);
  const to = basePose(v);
  Object.assign(v, { axis: oldAxis, road: oldRoad, p: oldP, dir: oldDir, lane: oldLane, laneIndex: oldLaneIndex });
  const delta = THREE.MathUtils.euclideanModulo(to.yaw - from.yaw + Math.PI, Math.PI * 2) - Math.PI;
  v.turn = { t: 0, from, to, next, startYaw: from.yaw, delta };
}

function updateTurn(v, dt) {
  const turn = v.turn; turn.t += dt / 0.85;
  const t = Math.min(1, turn.t), s = t * t * (3 - 2 * t);
  if (t >= 1) {
    Object.assign(v, turn.next); v.turn = null; v.speed = Math.max(2.5, v.speed * 0.65);
    return basePose(v);
  }
  return {
    x: THREE.MathUtils.lerp(turn.from.x, turn.to.x, s),
    z: THREE.MathUtils.lerp(turn.from.z, turn.to.z, s),
    yaw: turn.startYaw + turn.delta * s,
  };
}

function deactivate(v, kind) {
  v.active = false; v.speed = 0; v.turn = null; v.respawnT = 2 + Math.random() * 4;
  exits[kind] = (exits[kind] || 0) + 1;
}

let currentPedestrians = [];
function shouldYield(v) {
  const pose = basePose(v);
  for (const person of currentPedestrians) {
    if (person.type !== 'villager' || person.group?.visible === false) continue;
    const px = person.pos?.x ?? person.group?.position.x;
    const pz = person.pos?.z ?? person.group?.position.z;
    if (!Number.isFinite(px) || !Number.isFinite(pz)) continue;
    const dx = px - pose.x, dz = pz - pose.z;
    const forward = dx * Math.sin(pose.yaw) + dz * Math.cos(pose.yaw);
    const lateral = Math.abs(dx * Math.cos(pose.yaw) - dz * Math.sin(pose.yaw));
    const nearRoad = ALL_ROADS.some(road => Math.abs(px - road) < 11 || Math.abs(pz - road) < 11);
    if (nearRoad && forward > 0 && forward < 13 && lateral < 2.6) return true;
    if (forward > 0 && forward < 2.2 && lateral < 1.8) return true;
  }
  return false;
}

function updateVehicleState(v, dt) {
  if (!v.active) {
    v.respawnT -= dt;
    if (v.respawnT <= 0) applySpawn(v, SPAWN_POINTS[Math.floor(Math.random() * SPAWN_POINTS.length)]);
    return;
  }
  if (v.turn) return;
  let target = shouldYield(v) ? 0 : v.targetSpeed;
  const next = nextIntersection(v);
  const stopDistance = 10.5 + TYPES[v.type].size[2] / 2 + 0.35;
  if (next.distance < stopDistance + 5 && !signalGreen(v.axis)) {
    target = next.distance <= stopDistance ? 0 : Math.min(target, Math.max(0, (next.distance - stopDistance) * 1.5));
  }
  for (const other of vehicles) {
    if (other === v || !other.active || other.turn || other.axis !== v.axis || other.road !== v.road || other.dir !== v.dir || other.laneIndex !== v.laneIndex) continue;
    const gap = (other.p - v.p) * v.dir;
    if (gap > 0 && gap < 7) target = Math.min(target, Math.max(0, (gap - 4.8) * 1.2));
  }
  v.speed += (target - v.speed) * Math.min(1, dt * 3.2);
  v.p += v.speed * v.dir * dt;
  if (next.distance < 0.45 && signalGreen(v.axis) && Math.random() < 0.42) beginTurn(v, next.intersection);
  for (const point of PARKING_POINTS) {
    if (point.axis === v.axis && point.road === v.road && Math.abs(point.p - v.p) < 0.4 && Math.random() < 0.18) {
      deactivate(v, point.kind); return;
    }
  }
  if (Math.abs(v.p) > CITY_LIMIT) {
    if (v.exitAtGate) deactivate(v, 'gate');
    else {
      v.p = Math.sign(v.p) * (CITY_LIMIT - 0.2);
      v.dir *= -1; v.lane = laneOffset(v.dir, v.laneIndex); v.speed = 1.5;
    }
  }
}

function setInstance(mesh, index, x, y, z, yaw, sx, sy, sz, visible = true) {
  dummy.position.set(x, y, z); dummy.rotation.set(0, yaw, 0); dummy.scale.set(visible ? sx : 0.001, visible ? sy : 0.001, visible ? sz : 0.001);
  dummy.updateMatrix(); mesh.setMatrixAt(index, dummy.matrix);
}

function renderVehicles(dt) {
  vehicles.forEach((v, i) => {
    if (!v.active) {
      setInstance(bodyMesh, i, 0, -10, 0, 0, 1, 1, 1, false);
      setInstance(cabinMesh, i, 0, -10, 0, 0, 1, 1, 1, false);
      setInstance(detailMesh, i, 0, -10, 0, 0, 1, 1, 1, false);
      setInstance(beamMesh, i, 0, -10, 0, 0, 1, 1, 1, false);
      for (let w = 0; w < 4; w++) setInstance(wheelMesh, i * 4 + w, 0, -10, 0, 0, 1, 1, 1, false);
      for (let w = 0; w < 2; w++) setInstance(headlightMesh, i * 2 + w, 0, -10, 0, 0, 1, 1, 1, false);
      return;
    }
    const pose = v.turn ? updateTurn(v, shouldYield(v) ? 0 : dt) : basePose(v);
    const spec = TYPES[v.type], [width, height, length] = spec.size;
    setInstance(bodyMesh, i, pose.x, height / 2 + 0.18, pose.z, pose.yaw, width, height, length);
    const cabinLength = ['fire','truck','construction'].includes(v.type) ? 1.8 : v.type === 'school' ? 5.8 : v.type === 'ambulance' ? 3.4 : 2.0;
    setInstance(cabinMesh, i, pose.x, height + 0.55, pose.z, pose.yaw, width * 0.84, v.type === 'school' ? 0.85 : 0.65, cabinLength);
    let detail = [0.001, 0.001, 0.001], detailY = height + 1;
    if (v.type === 'taxi') detail = [0.6, 0.28, 0.38];
    else if (v.type === 'fire') { detail = [0.35, 0.2, 4.4]; detailY = height + 1.0; }
    else if (v.type === 'ambulance') { detail = [width + 0.04, 0.18, 2.8]; detailY = height * 0.85; }
    else if (v.type === 'construction') { detail = [1.4, 0.8, 2.2]; detailY = height + 0.8; }
    else if (v.type === 'school') { detail = [0.5, 0.5, 0.12]; detailY = 1.3; }
    setInstance(detailMesh, i, pose.x, detailY, pose.z, pose.yaw, ...detail);
    const c = Math.cos(pose.yaw), s = Math.sin(pose.yaw);
    let wi = 0;
    for (const lx of [-width / 2 - 0.04, width / 2 + 0.04]) for (const lz of [-length * 0.31, length * 0.31]) {
      const wx = pose.x + lx * c + lz * s, wz = pose.z - lx * s + lz * c;
      dummy.position.set(wx, 0.43, wz); dummy.rotation.set(0, pose.yaw, Math.PI / 2); dummy.scale.set(1, 1, 1); dummy.updateMatrix(); wheelMesh.setMatrixAt(i * 4 + wi++, dummy.matrix);
    }
    const lightsOn = nightAmount > 0.08;
    let hi = 0;
    for (const lx of [-width * 0.32, width * 0.32]) {
      const lz = length / 2 + 0.04;
      const hx = pose.x + lx * c + lz * s, hz = pose.z - lx * s + lz * c;
      setInstance(headlightMesh, i * 2 + hi++, hx, 0.55 + height * 0.25, hz, pose.yaw, 0.2, 0.14, 0.08, lightsOn);
    }
    const beamDistance = length / 2 + 3.4;
    setInstance(beamMesh, i,
      pose.x + Math.sin(pose.yaw) * beamDistance, 0.1,
      pose.z + Math.cos(pose.yaw) * beamDistance,
      pose.yaw, 1, 1, 1, lightsOn,
    );
  });
  for (const mesh of [bodyMesh, cabinMesh, detailMesh, wheelMesh, headlightMesh, beamMesh]) mesh.instanceMatrix.needsUpdate = true;
}

function updateSignals() {
  signalNodes.forEach((node, i) => {
    const green = signalGreen(node.axis);
    dummy.rotation.set(0, 0, 0); dummy.scale.setScalar(green ? 0.001 : 1); dummy.position.set(node.x, 3.08, node.z); dummy.updateMatrix(); redMesh.setMatrixAt(i, dummy.matrix);
    dummy.scale.setScalar(green ? 1 : 0.001); dummy.position.y = 2.62; dummy.updateMatrix(); greenMesh.setMatrixAt(i, dummy.matrix);
  });
  redMesh.instanceMatrix.needsUpdate = true; greenMesh.instanceMatrix.needsUpdate = true;
}

function updateLighting(dt) {
  nightAmount += (targetNight - nightAmount) * Math.min(1, dt * 3);
  if (streetBulbMaterial) {
    streetBulbMaterial.emissiveIntensity = nightAmount * 3.2;
    streetBulbMaterial.color.setHex(nightAmount > 0.1 ? 0xffe0a0 : 0x77776b);
  }
  for (const light of streetPointLights) light.intensity = nightAmount * 4.2;
  if (beamMaterial) beamMaterial.opacity = nightAmount * 0.32;
}

export function buildTraffic(scene) {
  const group = new THREE.Group(); group.name = 'modernTraffic';
  buildMarkings(group); buildSignals(group); buildRoadSigns(group); buildStreetLights(group); buildVehicles(group); scene.add(group);
  updateSignals(); renderVehicles(0);
}

export function updateTraffic(dt, pedestrians = [], night = 0) {
  if (!bodyMesh) return;
  currentPedestrians = pedestrians;
  targetNight = night;
  trafficTime += dt; updateSignals(); updateLighting(dt);
  for (const v of vehicles) updateVehicleState(v, dt);
  renderVehicles(dt);
}

export function trafficStats() {
  return {
    vehicles: vehicles.length,
    active: vehicles.filter(v => v.active).length,
    moving: vehicles.filter(v => v.active && v.speed > 0.3).length,
    turning: vehicles.filter(v => v.turn).length,
    exits: { ...exits }, phase: trafficTime % 16,
  };
}
