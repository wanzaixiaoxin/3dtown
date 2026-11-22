// ============================================================================
//  world.js — town geometry, terrain, day-night environment
//  1 unit = 1 meter. All objects are seated on the ground (no floating).
// ============================================================================
import * as THREE from 'three';
import { CONFIG, color, angle, expr } from './config.js';
import { M, trackGeo, disposables } from './materials.js';
import { batchStatic } from './optimize.js';
import { instantiate } from './assets.js';
import { SHOPS, buildCommerce } from './commerce.js';
import { ALL_ROADS, buildDistricts } from './districts.js';
import {
  buildGrassField, buildFlowerBed, buildWillow, buildAnimatedPond,
  buildPavilion, buildRockery, buildGarden, buildBush, flushFlowers,
  makeFoliageMaterial, buildSkyDecor, buildRealTree,
  buildPine, buildBamboo, buildWaterfall, buildPetals, buildBronzeDing, buildStoneLion,
  buildBoat, buildLanternString, buildBanner, buildMist, buildRain,
} from './scenery.js';

const TOWN_CFG = CONFIG.town;
const BUILD_CFG = CONFIG.buildings;
const SCENERY_CFG = CONFIG.scenery;
const ENV_CFG = CONFIG.environment;

// ---- 窗灯错落：少量共享材质变体，避免每扇窗一个材质（控制 draw call）----
const WINDOW_VARIANTS = [];
function initWindowVariants() {
  if (WINDOW_VARIANTS.length) return WINDOW_VARIANTS;
  const base = M().windowLit;
  const defs = ENV_CFG.emissive?.windowLit?.variants || [{ threshold: 0, brightness: 1 }];
  for (const def of defs) {
    const mat = base.clone();
    mat.name = `windowLit-${WINDOW_VARIANTS.length}`;
    mat.userData.threshold = def.threshold ?? 0;
    mat.userData.brightness = def.brightness ?? 1;
    WINDOW_VARIANTS.push(mat);
    disposables.materials.push(mat);
  }
  return WINDOW_VARIANTS;
}
function windowVariant(x, z, floor, wx) {
  const list = initWindowVariants();
  const seed = Math.abs(Math.round((x * 31.7 + z * 17.3 + floor * 7.1 + wx * 53.3) * 10));
  return list[seed % list.length];
}

export const TOWN = { half: TOWN_CFG.half };        // playable half-size (from config)
export const colliders = [];             // {minX,maxX,minZ,maxZ,top,climbable?}
export const ladders = [];
export const lamps = [];                 // {x,z,y} light sources that glow at night
export const litWindows = [];            // emissive materials already shared; count only
export const walkableLanes = [];         // for minimap roads

// --- builder plot (我的城市) — reserved empty ground for the build module ---
// Chosen to clear the east shop row (x≈10), hero houses, pavilion house (17,0)
// and the barn (39,16): pad spans x 13.5–35.5, z 6–26.
const PLOT_CFG = TOWN_CFG.plot;
export const PLOT = { x: PLOT_CFG.x, z: PLOT_CFG.z, halfW: PLOT_CFG.halfW, halfD: PLOT_CFG.halfD };

export let world;

// ---- day-night environment object ----
export const env = {
  sun: null, hemi: null, rim: null, ambient: null,
  skyMat: null, fog: null, scene: null,
  mist: null, fogEnabled: false,
  sunLight: null, nightLights: [], // PointLights that turn on at night
  envMaps: null,                    // { morning, noon, afternoon, night } PMREM textures
  timeKey: 'noon',
  weather: 'clear',
};

// ---------------------------------------------------------------------------
//  GROUND: single large terrain with subtle vertex color variation + grass
// ---------------------------------------------------------------------------
function buildGround(parent) {
  const mat = M();
  const size = TOWN.half * 2 + 40;
  const seg = 64;
  const geo = trackGeo(new THREE.PlaneGeometry(size, size, seg, seg));
  // give gentle rolling height on the outer rim so town sits in a valley
  // 城外四条引道走廊压平，避免抬升的地形吞掉出生/消失点所在的路
  const AR = TOWN_CFG.approachRoads || {};
  const corridorHalf = (AR.width || 7) / 2 + 1.5;
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i);
    // 城区、环路和所有建筑地块保持水平；只在城墙外逐渐抬升。
    const edge = Math.max(Math.abs(x), Math.abs(y));
    const outer = Math.max(0, edge - (TOWN.half + 8));
    let h = Math.pow(outer / 35, 2) * 18 * (0.6 + 0.4 * Math.sin(x * 0.15) * Math.cos(y * 0.12));
    // PlaneGeometry local +Y maps to world -Z after rotation; either axis near
    // centre is a road corridor, so flatten there with a soft shoulder.
    const axisDist = Math.min(Math.abs(x), Math.abs(y));
    if (axisDist < corridorHalf + 3) {
      const t = Math.min(1, Math.max(0, (axisDist - corridorHalf) / 3));
      h *= t * t * (3 - 2 * t); // smoothstep: 0 on road, full height past shoulder
    }
    pos.setZ(i, h);
  }
  geo.computeVertexNormals();
  const ground = new THREE.Mesh(geo, mat.grassDark);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  ground.name = 'ground';
  // PlaneGeometry rotated: local +Z becomes world +Y
  ground.position.y = 0;
  parent.add(ground);

  // (dense wind-swayed grass field is added later by scenery.buildGrassField)
  return ground;
}

function addGrassPatches(parent) {
  const m = M();
  // scatter low grass tufts (instanced) as tiny cones
  const tuftGeo = trackGeo(new THREE.ConeGeometry(0.14, 0.34, 4));
  const count = 2200;
  const inst = new THREE.InstancedMesh(tuftGeo, m.grass, count);
  inst.name = 'grassTufts';
  inst.receiveShadow = false; inst.castShadow = false;
  const d = new THREE.Object3D();
  let i = 0, guard = 0;
  while (i < count && guard < count * 8) {
    guard++;
    const x = (Math.random() - 0.5) * TOWN.half * 1.85;
    const z = (Math.random() - 0.5) * TOWN.half * 1.85;
    if (ALL_ROADS.some(road => Math.abs(x - road) < 5.2) || ALL_ROADS.some(road => Math.abs(z - road) < 5.2)) continue;
    if (Math.sqrt(x * x + z * z) < 11.5) continue;
    if (Math.hypot(x + 16, z - 16) < 8) continue; // pond
    d.position.set(x, 0.15, z);
    d.rotation.set(0, Math.random() * Math.PI, 0);
    const s = 0.7 + Math.random() * 0.8;
    d.scale.set(s, s, s);
    d.updateMatrix();
    inst.setMatrixAt(i, d.matrix);
    i++;
  }
  inst.count = i;
  inst.instanceMatrix.needsUpdate = true;
  parent.add(inst);
}

// ---------------------------------------------------------------------------
//  ROADS — stone cross roads + ring, seated flush on ground (y≈0.03)
// ---------------------------------------------------------------------------
function buildRoads(parent) {
  const m = M();
  const R = SCENERY_CFG.roads;
  const L = TOWN.half * 2;
  const halfWidth = R.width / 2;
  // main N-S and E-W stone lanes
  const mkLane = (w, len, rotY, name, offset) => {
    const g = trackGeo(new THREE.PlaneGeometry(w, len));
    const lane = new THREE.Mesh(g, offset === 0 ? m.roadStone : m.asphalt);
    lane.rotation.x = -Math.PI / 2; lane.rotation.z = rotY;
    if (rotY === 0) lane.position.x = offset;
    else lane.position.z = offset;
    lane.position.y = 0.04; lane.receiveShadow = true; lane.name = name;
    parent.add(lane);
    return lane;
  };
  for (const offset of ALL_ROADS) {
    const width = offset === 0 ? R.width : (R.vehicleWidth || 7);
    mkLane(width, L, 0, `road-v-${offset}`, offset);
    mkLane(width, L, Math.PI / 2, `road-h-${offset}`, offset);
    walkableLanes.push(
      { type: 'v', offset, half: width / 2 },
      { type: 'h', offset, half: width / 2 },
    );
  }

  // central plaza
  const plaza = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(R.plazaRadius, R.plazaRadius, 0.02, 40)), m.stoneLt);
  plaza.position.y = 0.05; plaza.receiveShadow = true; plaza.name = 'plaza';
  parent.add(plaza);
  const ring = new THREE.Mesh(trackGeo(new THREE.RingGeometry(R.ringInner, R.ringOuter, 40)), m.stoneDk);
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.07; ring.receiveShadow = true;
  parent.add(ring);

  // cobble edging strips along lanes (instanced small flat stones, flush on road)
  const cobGeo = trackGeo(new THREE.BoxGeometry(0.32, 0.05, 0.28));
  const count = R.cobbles;
  const inst = new THREE.InstancedMesh(cobGeo, m.cobble, count);
  inst.receiveShadow = true; inst.name = 'cobbles';
  const d = new THREE.Object3D();
  let i = 0;
  while (i < count) {
    const alongV = Math.random() > 0.5;
    let x, z;
    if (alongV) { x = (Math.random() - 0.5) * 8.4; z = (Math.random() - 0.5) * L; }
    else { x = (Math.random() - 0.5) * L; z = (Math.random() - 0.5) * 8.4; }
    if (Math.abs(x) < R.plazaRadius + 0.5 && Math.abs(z) < R.plazaRadius + 0.5) continue;
    d.position.set(x, 0.06, z);
    d.rotation.set(0, Math.random() * Math.PI, 0);
    const s = 0.6 + Math.random() * 0.5;
    d.scale.set(s, 1, s);
    d.updateMatrix();
    inst.setMatrixAt(i, d.matrix);
    i++;
  }
  inst.instanceMatrix.needsUpdate = true;
  parent.add(inst);
  buildApproachRoads(parent);
}

/**
 * 四条城外引道：从城墙缺口向外延伸，末端即人流出生/消失点。
 * 数据与 TOWN_CFG.approachRoads + NPC_CFG.gates 共用同一套坐标，npc.js 据此算 spawn。
 */
function buildApproachRoads(parent) {
  const AR = TOWN_CFG.approachRoads;
  if (!AR || AR.length <= 0) return;
  const m = M();
  const H = TOWN.half;
  const len = AR.length;
  const w = AR.width;
  const start = H - 2;                 // 稍微伸进城门内，和主路接上
  const gates = CONFIG.npcs.gates;
  gates.forEach((gate, idx) => {
    const alongX = gate.nx !== 0;      // 东/西门：路沿 X 轴
    const geo = trackGeo(new THREE.PlaneGeometry(w, len + 2));
    const road = new THREE.Mesh(geo, m.roadStone);
    road.rotation.x = -Math.PI / 2;
    road.rotation.z = alongX ? Math.PI / 2 : 0;
    road.position.set(
      alongX ? gate.nx * (start + len / 2) : gate.x,
      0.045,
      alongX ? gate.z : gate.nz * (start + len / 2),
    );
    road.receiveShadow = true;
    road.name = `approach-road-${idx}`;
    parent.add(road);

    if (!AR.markers) return;
    // 出生/消失点路标：矮石台 + 暖色灯柱，位于引道末端
    const dist = start + len * (AR.spawnRatio ?? 0.78);
    const mx = alongX ? gate.nx * dist : gate.x;
    const mz = alongX ? gate.z : gate.nz * dist;
    const marker = new THREE.Group();
    const pad = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.85, 1.0, 0.22, 8)), m.stoneDk);
    pad.position.y = 0.11; pad.receiveShadow = true; marker.add(pad);
    const post = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.12, 0.16, 2.1, 6)), m.woodDark);
    post.position.y = 1.15; post.castShadow = true; marker.add(post);
    const glow = new THREE.Mesh(trackGeo(new THREE.SphereGeometry(0.22, 8, 6)), m.lampGlow);
    glow.position.y = 2.28; marker.add(glow);
    marker.position.set(mx, 0, mz);
    marker.name = `approach-marker-${idx}`;
    parent.add(marker);
  });
}

// ---------------------------------------------------------------------------
//  HOUSE — realistic: stone base, plaster wall, timber frame, tiled hip roof
//  All parts rest on ground (y=0). Registers a collider.
// ---------------------------------------------------------------------------
function roadSafePosition(x, z, w, d, rotY = 0) {
  const hw = Math.abs(w / 2 * Math.cos(rotY)) + Math.abs(d / 2 * Math.sin(rotY));
  const hd = Math.abs(w / 2 * Math.sin(rotY)) + Math.abs(d / 2 * Math.cos(rotY));
  for (const road of ALL_ROADS) {
    const half = road === 0 ? 4.5 : 7;
    if (Math.abs(x - road) < hw + half + 0.8) {
      const side = x - road === 0 ? 1 : Math.sign(x - road);
      x = road + side * (hw + half + 0.8);
    }
    if (Math.abs(z - road) < hd + half + 0.8) {
      const side = z - road === 0 ? 1 : Math.sign(z - road);
      z = road + side * (hd + half + 0.8);
    }
  }
  return [x, z];
}

export function buildHouse(parent, x, z, w, d, h, opts = {}) {
  if (!opts.noRoadClamp) [x, z] = roadSafePosition(x, z, w, d, opts.rotY || 0);
  const m = M();
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  g.name = opts.name || 'house';
  g.rotation.y = opts.rotY || 0;

  const wallMat = opts.wallMat || m.plaster;
  const roofMat = opts.roofMat || m.roofBlue;

  // foundation (sits on ground, slightly larger)
  const baseH = 0.4;
  const base = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(w + 0.4, baseH, d + 0.4)), m.stoneDk);
  base.position.y = baseH / 2; base.castShadow = base.receiveShadow = true;
  g.add(base);

  // body — 门开着时拆成左右墙段 + 门楣，留出真正可穿行的门洞
  const bodyH = h - baseH;
  const doorH = Math.min(2.4, bodyH * 0.52), doorW = w * 0.26;
  const doorOpen = opts.doorOpen !== false && doorH < bodyH - 0.3;
  if (doorOpen) {
    const sideW = (w - doorW) / 2;
    for (const sx of [-1, 1]) {
      const seg = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(sideW, bodyH, d)), wallMat);
      seg.position.set(sx * (doorW + sideW) / 2, baseH + bodyH / 2, 0);
      seg.castShadow = seg.receiveShadow = true;
      g.add(seg);
    }
    const lintelH = bodyH - doorH;
    const lintel = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(doorW, lintelH, d)), wallMat);
    lintel.position.set(0, baseH + doorH + lintelH / 2, 0);
    lintel.castShadow = lintel.receiveShadow = true;
    g.add(lintel);
  } else {
    const body = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(w, bodyH, d)), wallMat);
    body.position.y = baseH + bodyH / 2; body.castShadow = body.receiveShadow = true;
    g.add(body);
  }

  // corner timber posts
  const postGeo = trackGeo(new THREE.BoxGeometry(0.18, bodyH, 0.18));
  for (const [px, pz] of [[w/2-0.09, d/2-0.09], [-w/2+0.09, d/2-0.09], [w/2-0.09, -d/2+0.09], [-w/2+0.09, -d/2+0.09]]) {
    const p = new THREE.Mesh(postGeo, m.woodDark);
    p.position.set(px, baseH + bodyH / 2, pz); p.castShadow = true; g.add(p);
  }
  // horizontal beam
  const beam = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(w + 0.08, 0.22, d + 0.08)), m.woodRed);
  beam.position.y = baseH + bodyH - 0.14; beam.castShadow = true; g.add(beam);

  // hip roof with curved, upturned eaves (Chinese flying eave)
  const roofH = opts.roofH ?? Math.min(2.0, h * 0.5);
  const overhang = 0.7;
  const eaveZ = d / 2 + overhang;
  const upturn = roofH * 0.30;             // eave tip lifts
  const SEG = 4;
  const baseTop = baseH + bodyH;
  const profile = [];
  for (let i = 0; i <= SEG; i++) {
    const t = i / SEG;
    // concave slope: steep near ridge, flattening then curling up at the eave
    const y = baseTop + roofH * Math.pow(1 - t, 1.35) + upturn * Math.pow(t, 7);
    profile.push({ z: eaveZ * t, y });
  }
  for (const side of [1, -1]) {
    for (let i = 0; i < SEG; i++) {
      const p0 = profile[i], p1 = profile[i + 1];
      const dz = side * (p1.z - p0.z), dy = p1.y - p0.y;
      const L = Math.hypot(dz, dy);
      const theta = Math.atan2(-dy, dz);
      const panel = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(w + overhang * 2, 0.14, L * 1.04)), roofMat);
      panel.position.set(0, (p0.y + p1.y) / 2, side * (p0.z + p1.z) / 2);
      panel.rotation.x = theta;
      panel.castShadow = panel.receiveShadow = true;
      g.add(panel);
    }
  }
  // triangular gable ends (fill the gap under the ridge at front/back)
  const gableShape = new THREE.Shape();
  gableShape.moveTo(-d / 2, 0); gableShape.lineTo(d / 2, 0); gableShape.lineTo(0, roofH); gableShape.closePath();
  const gableGeo = trackGeo(new THREE.ShapeGeometry(gableShape));
  for (const sx of [-1, 1]) {
    const gab = new THREE.Mesh(gableGeo, wallMat);
    gab.rotation.y = Math.PI / 2;
    gab.position.set(sx * w / 2, baseTop, 0);
    g.add(gab);
  }
  // ridge beam
  const ridge = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(w + overhang * 2, 0.18, 0.32)), m.woodDark);
  ridge.position.y = baseTop + roofH + upturn; ridge.castShadow = true; g.add(ridge);
  // ridge ornaments (吻兽) at both ends
  for (const sx of [-1, 1]) {
    const orn = new THREE.Mesh(trackGeo(new THREE.ConeGeometry(0.16, 0.5, 4)), m.gold);
    orn.position.set(sx * (w / 2 + overhang), baseTop + roofH + upturn + 0.22, 0);
    orn.rotation.z = sx * -0.35;
    orn.castShadow = true; g.add(orn);
  }

  const stories = opts.stories ?? (bodyH > 3.6 ? 2 : 1);
  const storyH = bodyH / stories;
  for (let level = 1; level < stories; level++) {
    const floorBeam = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(w + 0.12, 0.16, d + 0.12)), m.woodDark);
    floorBeam.position.y = baseH + storyH * level;
    floorBeam.castShadow = true;
    g.add(floorBeam);
  }

  // door — 两扇外开的门板 + 门洞内的暗色室内，NPC 可穿行进入
  if (doorOpen) {
    const room = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(doorW * 1.5, doorH * 1.05, 0.12)), m.woodDark);
    room.position.set(0, baseH + doorH / 2, Math.min(0.75, d * 0.28));
    g.add(room);
    const leafW = doorW / 2;
    const openAngle = opts.doorAngle ?? 1.1;
    for (const sx of [-1, 1]) {
      const hinge = new THREE.Group();
      hinge.position.set(sx * doorW / 2, 0, -d / 2 - 0.06);
      hinge.rotation.y = -sx * openAngle;
      const leaf = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(leafW * 0.94, doorH * 0.96, 0.08)), m.wood);
      leaf.position.set(-sx * leafW * 0.47, baseH + doorH / 2, 0);
      leaf.castShadow = true;
      hinge.add(leaf);
      g.add(hinge);
      const jamb = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.12, doorH + 0.16, 0.16)), m.woodDark);
      jamb.position.set(sx * (doorW / 2 + 0.06), baseH + doorH / 2, -d / 2 - 0.02);
      g.add(jamb);
    }
    const header = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(doorW + 0.32, 0.16, 0.16)), m.woodDark);
    header.position.set(0, baseH + doorH + 0.06, -d / 2 - 0.02);
    g.add(header);
  } else {
    const door = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(doorW, doorH, 0.1)), m.wood);
    door.position.set(0, baseH + doorH / 2, -d / 2 - 0.02); g.add(door);
    const doorFrame = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(doorW + 0.2, doorH + 0.16, 0.06)), m.woodDark);
    doorFrame.position.set(0, baseH + doorH / 2 + 0.02, -d / 2 + 0.02); g.add(doorFrame);
  }

  // windows (glowing at night) — 按位置选变体，黄昏渐次亮起而非整片同步
  const winMat = opts.winMat;
  const winH = Math.min(1.35, storyH * 0.42);
  const winGeo = trackGeo(new THREE.BoxGeometry(w * 0.16, winH, 0.08));
  for (let floor = 0; floor < stories; floor++) {
    const wy = baseH + storyH * (floor + 0.58);
    for (const wx of [-w * 0.28, w * 0.28]) {
      const win = new THREE.Mesh(winGeo, winMat || windowVariant(x, z, floor, wx));
      win.position.set(wx, wy, -d/2 - 0.02);
      g.add(win);
      const frame = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(w*0.16+0.14, winH+0.14, 0.05)), m.woodDark);
      frame.position.set(wx, wy, -d/2 + 0.02); g.add(frame);
    }
  }

  // under-eave lanterns (glow at night)
  if (opts.lanterns !== false) {
    for (const sx of [-1, 1]) {
      const lan = new THREE.Mesh(trackGeo(new THREE.SphereGeometry(0.17, 10, 10)), m.lantern);
      lan.position.set(sx * (w/2 - 0.35), baseH + bodyH * 0.72, -d/2 - 0.28);
      lan.scale.y = 1.25; g.add(lan);
      const cord = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.015, 0.015, 0.28, 4)), m.woodDark);
      cord.position.set(sx * (w/2 - 0.35), baseH + bodyH * 0.72 + 0.25, -d/2 - 0.28); g.add(cord);
    }
  }

  parent.add(g);

  // collider (body only, footprint rotated roughly — use unrotated AABB approx)
  if (!opts.noCollider) {
    const hw = Math.abs(w/2*Math.cos(g.rotation.y)) + Math.abs(d/2*Math.sin(g.rotation.y));
    const hd = Math.abs(w/2*Math.sin(g.rotation.y)) + Math.abs(d/2*Math.cos(g.rotation.y));
    colliders.push({ minX: x-hw, maxX: x+hw, minZ: z-hd, maxZ: z+hd, top: baseH + bodyH, kind: 'house' });
  }
  return g;
}

// ---------------------------------------------------------------------------
//  WALL SEGMENT (city wall) — grounded stone wall with battlements
// ---------------------------------------------------------------------------
function buildWall(parent, x, z, w, d, h) {
  const m = M();
  const wall = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(w, h, d)), m.wallStone);
  wall.position.set(x, h/2, z); wall.castShadow = wall.receiveShadow = true; wall.name = 'citywall';
  parent.add(wall);
  const along = w > d;
  const len = Math.max(w, d);
  const n = Math.max(2, Math.floor(len / 1.6));
  const crGeo = trackGeo(new THREE.BoxGeometry(along ? 0.7 : w, 0.55, along ? d : 0.7));
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    const c = new THREE.Mesh(crGeo, m.stoneLt);
    if (along) c.position.set(x - w/2 + t*w, h + 0.27, z);
    else c.position.set(x, h + 0.27, z - d/2 + t*d);
    c.castShadow = true; parent.add(c);
  }
  colliders.push({ minX: x-w/2, maxX: x+w/2, minZ: z-d/2, maxZ: z+d/2, top: h, kind: 'wall' });
}

// ---------------------------------------------------------------------------
//  GATE — twin towers + red lintel + gold plaque at a wall/lane crossing.
//  (cx,cz) is the gate centre on the wall line; (dirX,dirZ) is the unit
//  normal pointing INTO the town (plaque side). The 10m wall gap must
//  already be left by the caller (matching the 9m lane below the lintel).
// ---------------------------------------------------------------------------
function buildGate(parent, cx, cz, dirX, dirZ) {
  const m = M();
  const alongX = dirZ !== 0;            // gate spans the x axis (N/S gates)
  // twin towers flanking the 10m gap, 3.6m out from centre on each side
  const t1x = alongX ? cx - 3.6 : cx;
  const t1z = alongX ? cz : cz - 3.6;
  const t2x = alongX ? cx + 3.6 : cx;
  const t2z = alongX ? cz : cz + 3.6;
  const towerOpts = { roofMat: m.roofBrown, lanterns: false, wallMat: m.stoneLt };
  buildHouse(parent, t1x, t1z, 2.6, 2.6, 4.6, towerOpts);
  buildHouse(parent, t2x, t2z, 2.6, 2.6, 4.6, towerOpts);
  // red lintel bridging the towers (7.4m span across the gap)
  const lintelW = alongX ? 7.4 : 1.8;
  const lintelD = alongX ? 1.8 : 7.4;
  const lintel = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(lintelW, 0.7, lintelD)), m.woodRed);
  lintel.position.set(cx, 3.7, cz);
  lintel.castShadow = true;
  parent.add(lintel);
  // gold plaque facing into the town
  const plaqueW = alongX ? 2.6 : 0.15;
  const plaqueD = alongX ? 0.15 : 2.6;
  const plaque = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(plaqueW, 0.9, plaqueD)), m.gold);
  plaque.position.set(cx + dirX * 0.95, 3.75, cz + dirZ * 0.95);
  parent.add(plaque);
}

// ---------------------------------------------------------------------------
//  LADDER — leans on a wall face; grounded at baseY
// ---------------------------------------------------------------------------
function buildLadder(parent, x, z, baseY, topY, facing) {
  const m = M();
  const g = new THREE.Group();
  const h = topY - baseY;
  const railGeo = trackGeo(new THREE.BoxGeometry(0.09, h + 0.3, 0.09));
  const rungGeo = trackGeo(new THREE.BoxGeometry(0.72, 0.08, 0.08));
  const nR = Math.max(3, Math.floor(h / 0.42));
  for (const sx of [-0.34, 0.34]) {
    const rail = new THREE.Mesh(railGeo, m.wood);
    rail.position.set(sx, baseY + h/2, 0); rail.castShadow = true; g.add(rail);
  }
  for (let i = 0; i <= nR; i++) {
    const rung = new THREE.Mesh(rungGeo, m.woodDark);
    rung.position.set(0, baseY + 0.25 + (i / nR) * h, 0); g.add(rung);
  }
  g.rotation.x = -0.1;
  g.position.set(x, 0, z);
  if (Math.abs(facing.z) > Math.abs(facing.x)) g.rotation.y = facing.z > 0 ? 0 : Math.PI;
  else g.rotation.y = facing.x > 0 ? Math.PI/2 : -Math.PI/2;
  parent.add(g);

  ladders.push({
    x, z, baseY, topY, dirX: facing.x, dirZ: facing.z, width: 0.9,
    topLanding: { x: x - facing.x * 0.85, z: z - facing.z * 0.85 },
  });
}

// ---------------------------------------------------------------------------
//  TREE — trunk + 3 canopy blobs, grounded
// ---------------------------------------------------------------------------
function buildTree(parent, x, z, scale = 1) {
  const kind = (Math.abs(x * 7 + z * 13) % 5 === 0) ? 'blossom' : 'green';
  return buildRealTree(parent, x, z, scale, kind);
}

// ---------------------------------------------------------------------------
//  STREET LAMP — wooden post with a paper lantern (glows + point light at night)
// ---------------------------------------------------------------------------
function buildLamp(parent, x, z) {
  const m = M();
  const postH = 3.2;
  const post = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.08, 0.11, postH, 6)), m.woodDark);
  post.position.set(x, postH/2, z); post.castShadow = true; parent.add(post);
  const arm = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.7, 0.08, 0.08)), m.woodDark);
  arm.position.set(x + 0.3, postH - 0.2, z); parent.add(arm);
  const glow = new THREE.Mesh(trackGeo(new THREE.SphereGeometry(0.22, 10, 10)), m.lampGlow);
  glow.position.set(x + 0.6, postH - 0.55, z); glow.scale.y = 1.3; parent.add(glow);

  lamps.push({ x: x + 0.6, z, y: postH - 0.55 });
  colliders.push({ minX: x-0.15, maxX: x+0.15, minZ: z-0.15, maxZ: z+0.15, top: postH, kind: 'lamp' });
}

// ---------------------------------------------------------------------------
//  WELL / plaza centrepiece
// ---------------------------------------------------------------------------
function buildWell(parent, x, z) {
  const m = M();
  const ring = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(1.1, 1.2, 0.8, 20, 1, true)), m.stoneLt);
  ring.position.set(x, 0.4, z); ring.castShadow = ring.receiveShadow = true; parent.add(ring);
  const water = new THREE.Mesh(trackGeo(new THREE.CircleGeometry(1.0, 20)), m.water);
  water.rotation.x = -Math.PI/2; water.position.set(x, 0.55, z); parent.add(water);
  for (const sx of [-1, 1]) {
    const p = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.12, 2.0, 0.12)), m.woodDark);
    p.position.set(x + sx, 1.0, z); p.castShadow = true; parent.add(p);
  }
  const roof = new THREE.Mesh(trackGeo(new THREE.ConeGeometry(1.6, 0.8, 4)), m.roofBrown);
  roof.position.set(x, 2.35, z); roof.rotation.y = Math.PI/4; roof.castShadow = true; parent.add(roof);
  colliders.push({ minX: x-1.1, maxX: x+1.1, minZ: z-1.1, maxZ: z+1.1, top: 0.8, kind: 'well' });
}

// ---------------------------------------------------------------------------
//  POND — sunk ground disc of water with stone rim + lily pads
// ---------------------------------------------------------------------------
function buildPond(parent, x, z, r) {
  const m = M();
  const water = new THREE.Mesh(trackGeo(new THREE.CircleGeometry(r, 40)), m.water);
  water.rotation.x = -Math.PI/2; water.position.set(x, 0.12, z); water.receiveShadow = true; parent.add(water);
  // stone rim
  const rim = new THREE.Mesh(trackGeo(new THREE.TorusGeometry(r, 0.35, 8, 40)), m.stoneLt);
  rim.rotation.x = -Math.PI/2; rim.position.set(x, 0.2, z); rim.receiveShadow = true; parent.add(rim);
  // lily pads
  const padGeo = trackGeo(new THREE.CircleGeometry(0.4, 8));
  for (let i = 0; i < 8; i++) {
    const a = Math.random() * Math.PI * 2, rr = Math.random() * (r - 1);
    const pad = new THREE.Mesh(padGeo, m.leaf2);
    pad.rotation.x = -Math.PI/2; pad.position.set(x + Math.cos(a)*rr, 0.14, z + Math.sin(a)*rr);
    parent.add(pad);
  }
  // pond blocks walking (collider) — but low, so you can't walk into water
  colliders.push({ minX: x-r, maxX: x+r, minZ: z-r, maxZ: z+r, top: 0.01, water: true });
}

// ---------------------------------------------------------------------------
//  SKY DOME + DAY/NIGHT
// ---------------------------------------------------------------------------
function buildSky(scene) {
  // Vertex-coloured dome: uses MeshBasicMaterial so three's colour management
  // and tone mapping apply correctly (unlike a raw ShaderMaterial).
  const geo = trackGeo(new THREE.SphereGeometry(400, 40, 24));
  const colors = new Float32Array(geo.attributes.position.count * 3);
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const mat = new THREE.MeshBasicMaterial({
    vertexColors: true, side: THREE.BackSide, depthWrite: false, fog: false,
  });
  const dome = new THREE.Mesh(geo, mat);
  dome.name = 'skydome';
  dome.frustumCulled = false;
  scene.add(dome);

  // sun / moon disc sprite (billboard, additive)
  const cv = document.createElement('canvas'); cv.width = cv.height = 128;
  const ctx = cv.getContext('2d');
  const grd = ctx.createRadialGradient(64, 64, 2, 64, 64, 62);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.18, 'rgba(255,246,225,0.95)');
  grd.addColorStop(0.42, 'rgba(255,220,170,0.35)');
  grd.addColorStop(1, 'rgba(255,220,170,0)');
  ctx.fillStyle = grd; ctx.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sunMat = new THREE.SpriteMaterial({
    map: tex, transparent: true, depthWrite: false, depthTest: false,
    blending: THREE.AdditiveBlending, fog: false,
  });
  const sun = new THREE.Sprite(sunMat);
  sun.name = 'celestial';
  sun.scale.set(46, 46, 1);
  sun.renderOrder = -1;
  scene.add(sun);

  return {
    dome, geo, mat,
    sun, sunMat,
    setColors(top, bottom, sunDir, sunCol, sunStrength, isNight = false) {
      const cTop = new THREE.Color(top), cBot = new THREE.Color(bottom);
      const pos = geo.attributes.position;
      const col = geo.attributes.color;
      const c = new THREE.Color();
      for (let i = 0; i < pos.count; i++) {
        const h = Math.max(0, Math.min(1, pos.getY(i) / 400 * 0.5 + 0.5));
        c.copy(cBot).lerp(cTop, Math.pow(h, 0.9));
        col.setXYZ(i, c.r, c.g, c.b);
      }
      col.needsUpdate = true;
      // sun sprite position along direction
      const dir = new THREE.Vector3(...sunDir).normalize();
      sun.position.copy(dir).multiplyScalar(360);
      sunMat.color.set(sunCol);
      sunMat.opacity = sunStrength * 0.75;
      sun.scale.setScalar(isNight ? 30 : 46);
    },
  };
}

// 从配置派生，颜色字符串一次性转成 three.js 数值；运行时只读不改。
const COLOR_KEYS = [
  'skyTop', 'skyBot', 'fog', 'hemiSky', 'hemiGround', 'sunColor', 'ambient',
];
const TIME_PRESETS = Object.fromEntries(
  Object.entries(ENV_CFG.timePresets).map(([key, preset]) => {
    const normalized = { ...preset };
    for (const name of COLOR_KEYS) normalized[name] = color(preset[name]);
    return [key, normalized];
  }),
);

export function setupEnvironment(scene) {
  env.scene = scene;
  const L = ENV_CFG.lights;
  const D = ENV_CFG.decor;
  const F = ENV_CFG.initialFog;
  // sky
  env.sky = buildSky(scene);
  env.skyMat = null;
  env.skyDecor = buildSkyDecor(scene);
  env.petals = buildPetals(scene, D.petals[0], D.petals[1]);
  env.mist = buildMist(scene, D.mist);
  buildRain(scene, D.rain);
  env.fog = new THREE.Fog(color(F.color), F.near, F.far);
  scene.fog = null;
  env.fogEnabled = F.enabled;

  // hemisphere fill
  env.hemi = new THREE.HemisphereLight(color(L.hemi.sky), color(L.hemi.ground), L.hemi.intensity);
  scene.add(env.hemi);

  // ambient (goes blue/dark at night)
  env.ambient = new THREE.AmbientLight(color(L.ambient.color), L.ambient.intensity);
  scene.add(env.ambient);

  // key sun with shadows
  const sun = new THREE.DirectionalLight(color(L.sun.color), L.sun.intensity);
  sun.position.set(...L.sun.position);
  sun.castShadow = true;
  sun.shadow.mapSize.set(L.sun.shadowMap, L.sun.shadowMap);
  const S = TOWN.half + 20;
  sun.shadow.camera.near = 1; sun.shadow.camera.far = 320;
  sun.shadow.camera.left = -S; sun.shadow.camera.right = S;
  sun.shadow.camera.top = S; sun.shadow.camera.bottom = -S;
  sun.shadow.bias = -0.0002; sun.shadow.normalBias = 0.05;
  scene.add(sun); scene.add(sun.target);
  env.sun = sun; env.sunLight = sun;

  // rim/cool back light
  env.rim = new THREE.DirectionalLight(color(L.rim.color), L.rim.intensity);
  env.rim.position.set(...L.rim.position);
  scene.add(env.rim);

  // night point lights near lanterns/lamps get created in buildWorld (pooled)
}

let _curPreset = null;
export function applyTime(key, instant = true) {
  const p = TIME_PRESETS[key] || TIME_PRESETS.noon;
  env.timeKey = key;
  _curPreset = p;
  const m = M();

  const E = ENV_CFG;
  const L = E.lights;
  const W = E.weather.rain;
  const night = p.nightAmount >= 1;
  env.sky.setColors(p.skyTop, p.skyBot, p.sunPos, p.sunColor,
    night ? W.nightSkyScale : 1.0, night);

  const rainy = env.weather === 'rain';
  if (env.fog) {
    env.fog.color.set(rainy ? color(W.fogColor) : p.fog);
    env.fog.near = p.fogNear * (rainy ? W.fogNearScale : 1);
    env.fog.far = p.fogFar * (rainy ? W.fogFarScale : 1);
  }
  if (rainy && env.sun) env.sun.intensity = p.sunInt * W.sunScale;
  else if (env.sun) env.sun.intensity = p.sunInt;
  env.scene.background = new THREE.Color(p.skyBot);

  env.hemi.color.set(p.hemiSky);
  env.hemi.groundColor.set(p.hemiGround);
  env.hemi.intensity = p.hemiInt;

  env.ambient.color.set(p.ambient);
  env.ambient.intensity = p.ambientInt;

  env.sun.color.set(p.sunColor);
  env.sun.position.set(...p.sunPos);

  env.rim.intensity = L.rim.intensity * (1 - p.nightAmount * L.rim.nightFade);

  // emissive materials respond to nightAmount — 窗灯按变体错落点亮
  const na = p.nightAmount;
  const EM = E.emissive;
  const smooth = (a, b, v) => {
    const t = Math.min(1, Math.max(0, (v - a) / (b - a || 1)));
    return t * t * (3 - 2 * t);
  };
  for (const mat of WINDOW_VARIANTS) {
    const lit = smooth(mat.userData.threshold, mat.userData.threshold + 0.32, na);
    mat.emissiveIntensity = (EM.windowLit.base + lit * EM.windowLit.scale) * mat.userData.brightness;
    mat.color.setHex(color(lit > 0.5 ? EM.windowLit.nightColor : EM.windowLit.dayColor));
  }
  m.windowLit.emissiveIntensity = EM.windowLit.base + na * EM.windowLit.scale;
  m.windowLit.color.setHex(color(na > 0.5 ? EM.windowLit.nightColor : EM.windowLit.dayColor));
  m.lantern.emissiveIntensity = EM.lantern.base + na * EM.lantern.scale;
  m.lampGlow.emissiveIntensity = EM.lampGlow.base + na * EM.lampGlow.scale;

  // night point lights
  for (const L of env.nightLights) L.intensity = na * L.userData.baseIntensity;

  // HDRI environment map (reflections + image based lighting)
  if (env.envMaps && env.envMaps[key] && env.scene) {
    env.scene.environment = env.envMaps[key];
    const envInt = E.envMapIntensity[key] ?? 0.1;
    env.scene.traverse((object) => {
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const mat of materials) {
        if (!mat || !('envMapIntensity' in mat)) continue;
        mat.userData.baseEnvMapIntensity ??= mat.envMapIntensity;
        mat.envMapIntensity = mat.userData.baseEnvMapIntensity * envInt;
      }
    });
  }

  // sky decor: stars at night, clouds by day
  if (env.skyDecor) {
    env.skyDecor.starMat.opacity = Math.max(0, na * E.stars.opacityScale + E.stars.opacityOffset);
    env.skyDecor.cloudMat.opacity = E.clouds.opacity * (1 - na);
    env.skyDecor.clouds.visible = na < E.clouds.visibleBelow;
  }

  return p.label;
}

export function setWeatherMode(mode) {
  env.weather = mode;
  if (_curPreset) applyTime(env.timeKey);
}

export function setFogEnabled(enabled) {
  env.fogEnabled = Boolean(enabled);
  if (env.scene) env.scene.fog = env.fogEnabled ? env.fog : null;
  if (env.mist) env.mist.visible = env.fogEnabled;
}

export function setEnvMaps(maps) {
  env.envMaps = maps;
  // cache materials that respond to env intensity
  env._pbrMaterials = [];
  try {
    // M() is called later; collect lazily in applyTime instead
  } catch(e) {}
}

export function getExposure() { return _curPreset ? _curPreset.exposure : 1.05; }
export function getTimeLabel() { return _curPreset ? _curPreset.label : '正午'; }
export function getNightAmount() { return _curPreset ? _curPreset.nightAmount : 0; }

// ---------------------------------------------------------------------------
//  BUILD EVERYTHING
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
//  BUILDER PLOT PAD — flattened earthen base + stone kerb for 我的城市 module.
//  Procedural scatter (houses/trees/lamps/bushes/grass) must stay clear of it.
// ---------------------------------------------------------------------------
export function plotRect() {
  return {
    minX: PLOT.x - PLOT.halfW, maxX: PLOT.x + PLOT.halfW,
    minZ: PLOT.z - PLOT.halfD, maxZ: PLOT.z + PLOT.halfD,
  };
}

export function inPlot(x, z, pad = 2) {
  const r = plotRect();
  return x > r.minX - pad && x < r.maxX + pad && z > r.minZ - pad && z < r.maxZ + pad;
}

function buildPlotPad(parent) {
  const m = M();
  const w = PLOT.halfW * 2, d = PLOT.halfD * 2;
  const pad = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(w, 0.1, d)), m.dirt);
  pad.position.set(PLOT.x, 0.05, PLOT.z);
  pad.receiveShadow = true;
  pad.name = 'builderPlotPad';
  parent.add(pad);
  // low stone kerb ringing the plot (decorative, no collider so you can walk in)
  const kerbMat = m.stoneLt;
  for (const [sx, sz, kw, kd] of [
    [0, -PLOT.halfD - 0.25, w + 0.5, 0.5],
    [0, PLOT.halfD + 0.25, w + 0.5, 0.5],
    [-PLOT.halfW - 0.25, 0, 0.5, d + 1.5],
    [PLOT.halfW + 0.25, 0, 0.5, d + 1.5],
  ]) {
    const kerb = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(kw, 0.22, kd)), kerbMat);
    kerb.position.set(PLOT.x + sx, 0.11, PLOT.z + sz);
    kerb.castShadow = kerb.receiveShadow = true;
    kerb.name = 'builderPlotKerb';
    parent.add(kerb);
  }
}

export function buildWorld(scene, assets = null) {
  world = new THREE.Group();
  world.name = 'world';
  scene.add(world);

  buildGround(world);
  buildRoads(world);
  buildPlotPad(world);
  // NOTE: the plaza well is replaced by a downloaded FBX well in placeAssets().

  // --- residential blocks: orient houses to face the main streets ---
  // 布局规则由 town.config.json → buildings.grid / reserved 驱动
  const grid = BUILD_CFG.grid;
  const houseDefs = [];
  const blockOffsets = grid.blockOffsets;      // distance from centre
  const runs = grid.runs;                      // positions along x (N/S) and z (E/W)
  let seed = grid.seed;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const range = ([lo, hi]) => lo + rnd() * (hi - lo);
  const m = M();
  const roofChoices = BUILD_CFG.roofMaterials.map(key => m[key]);
  const wallChoices = BUILD_CFG.wallMaterials.map(key => m[key]);

  for (const off of blockOffsets) {
    for (const run of runs) {
      // north side (z negative), facing +z
      let w = range(grid.size.w), d = range(grid.size.d), h = range(grid.size.h);
      houseDefs.push([run, -off, w, d, h, { rotY: 0, roofMat: roofChoices[Math.floor(rnd()*roofChoices.length)], wallMat: wallChoices[rnd() > 0.5 ? 0 : 1] }]);
      // south side (z positive), facing -z
      w = range(grid.size.w); d = range(grid.size.d); h = range(grid.size.h);
      houseDefs.push([run, off, w, d, h, { rotY: Math.PI, roofMat: roofChoices[Math.floor(rnd()*roofChoices.length)], wallMat: wallChoices[rnd() > 0.5 ? 0 : 1] }]);
    }
  }
  // east / west flank houses facing the E-W road
  for (const off of blockOffsets) {
    for (const run of runs) {
      let w = range(grid.flankSize.w), d = range(grid.flankSize.d), h = range(grid.flankSize.h);
      houseDefs.push([off, run, w, d, h, { rotY: Math.PI/2, roofMat: roofChoices[Math.floor(rnd()*roofChoices.length)] }]);
      w = range(grid.flankSize.w); d = range(grid.flankSize.d); h = range(grid.flankSize.h);
      houseDefs.push([-off, run, w, d, h, { rotY: -Math.PI/2, roofMat: roofChoices[Math.floor(rnd()*roofChoices.length)] }]);
    }
  }
  const RESERVED = BUILD_CFG.reserved;
  const inReserved = (x, z) =>
    RESERVED.some(r => Math.hypot(x - r.x, z - r.z) < r.r) || inPlot(x, z, 3);

  // filter out overlaps with reserved zones and with already-placed houses
  const placed = [];
  const houseHalf = (w, d, rotY) => ({
    hw: Math.abs(w/2*Math.cos(rotY)) + Math.abs(d/2*Math.sin(rotY)),
    hd: Math.abs(w/2*Math.sin(rotY)) + Math.abs(d/2*Math.cos(rotY)),
  });
  for (const def of houseDefs) {
    const [x, z, w, d, , o] = def;
    if (inReserved(x, z)) continue;
    const { hw, hd } = houseHalf(w, d, o.rotY || 0);
    let overlap = false;
    for (const p of placed) {
      if (x - hw < p.maxX + grid.gap && x + hw > p.minX - grid.gap &&
          z - hd < p.maxZ + grid.gap && z + hd > p.minZ - grid.gap) { overlap = true; break; }
    }
    if (overlap) continue;
    placed.push({ minX: x - hw, maxX: x + hw, minZ: z - hd, maxZ: z + hd });
    buildHouse(world, ...def);
  }

  buildDistricts(world, { buildHouse, buildTree, colliders });

  // --- pavilion on the plaza east edge (two-tier) ---
  const PV = BUILD_CFG.pavilion;
  if (PV.enabled !== false) {
    buildHouse(world, PV.x, PV.z, PV.w, PV.d, PV.h,
      { roofMat: m.roofBlue, roofH: PV.roofH, name: 'pavilion', rotY: angle(PV.rotY) });
    const tier = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(PV.tier.w, PV.tier.h, PV.tier.d)), m.plaster);
    tier.position.set(PV.x, PV.h + PV.tier.h / 2, PV.z); tier.castShadow = true; world.add(tier);
    const tierRoof = new THREE.Mesh(trackGeo(new THREE.ConeGeometry(PV.tierRoof.r, PV.tierRoof.h, PV.tierRoof.segments)), m.roofBlue);
    tierRoof.position.set(PV.x, PV.h + PV.tierRoof.h + PV.tier.h / 2, PV.z); tierRoof.rotation.y = Math.PI/4; tierRoof.castShadow = true; world.add(tierRoof);
  }

  // --- boundary city walls, with gates where the main lanes meet them ---
  const H = TOWN.half;
  const WC = BUILD_CFG.walls;
  const wallH = WC.height, wallT = WC.thickness;
  const outer = H / 2 + WC.offset;
  const seg = H - WC.inset;
  // south (existing gate, rebuilt via the shared gate factory)
  buildWall(world, -outer, H, seg, wallT, wallH);
  buildWall(world, outer, H, seg, wallT, wallH);
  buildGate(world, 0, H, 0, -1);
  // north gate on the N-S lane
  buildWall(world, -outer, -H, seg, wallT, wallH);
  buildWall(world, outer, -H, seg, wallT, wallH);
  buildGate(world, 0, -H, 0, 1);
  // east / west gates on the E-W lane
  buildWall(world, H, -outer, wallT, seg, wallH);
  buildWall(world, H, outer, wallT, seg, wallH);
  buildGate(world, H, 0, -1, 0);
  buildWall(world, -H, -outer, wallT, seg, wallH);
  buildWall(world, -H, outer, wallT, seg, wallH);
  buildGate(world, -H, 0, 1, 0);

  // --- ladders (climb onto walls / pavilion) ---
  const ladderTokens = { H: TOWN.half, PVX: PV.x };
  BUILD_CFG.ladders.forEach(L => buildLadder(
    world,
    expr(L.x, ladderTokens), expr(L.z, ladderTokens),
    L.baseY, L.topY, L.facing,
  ));

  // --- trees scattered (avoid roads, plaza, pond, houses) ---
  const EX = SCENERY_CFG.exclusion;
  const TS = SCENERY_CFG.treeScale;
  const blockedTree = (x, z) =>
    Math.hypot(x - EX.pond.x, z - EX.pond.z) < EX.pond.r ||
    ALL_ROADS.some(road => Math.abs(x - road) < EX.roadHalf) ||
    ALL_ROADS.some(road => Math.abs(z - road) < EX.roadHalf) ||
    (Math.abs(Math.abs(x) - EX.shopRow.center) < EX.shopRow.band && Math.abs(z) > EX.shopRow.minZ) ||
    Math.hypot(x - EX.pavilion.x, z - EX.pavilion.z) < EX.pavilion.r ||
    Math.hypot(x - EX.garden.x, z - EX.garden.z) < EX.garden.r ||
    inPlot(x, z, EX.plotPad);
  SCENERY_CFG.treeSpots.forEach(([x, z], i) => {
    if (blockedTree(x, z)) return;
    buildTree(world, x, z, TS.base + (i % TS.cycle) * TS.step);
  });

  // --- street lamps along the lanes ---
  SCENERY_CFG.lampPositions.forEach(([x, z]) => {
    if (!inPlot(x, z, 2)) buildLamp(world, x, z);
  });

  // --- pooled night point lights (a handful, positioned at key lamps) ---
  const NL = SCENERY_CFG.nightLights;
  NL.spots.forEach(([x, z], i) => {
    const pl = new THREE.PointLight(color(NL.color), 0, NL.distance, NL.decay);
    pl.position.set(x, NL.height, z);
    pl.userData.baseIntensity = NL.baseIntensity + (i % NL.intensityCycle) * NL.intensityStep;
    pl.castShadow = false;
    scene.add(pl);
    env.nightLights.push(pl);
  });

  // --- placed third-party FBX assets (well, hero houses, windmill, trees...) ---
  if (assets) placeAssets(world, assets);

  // --- RICH SCENERY: 由 scenery.calls 声明式调度，新增景观只改 JSON ---
  buildGrassField(world);

  const dispatch = {
    pond: a => buildAnimatedPond(world, ...a),
    pavilion: a => buildPavilion(world, ...a),
    rockery: a => buildRockery(world, ...a),
    garden: a => buildGarden(world, ...a),
    willow: a => buildWillow(world, ...a),
    flowerBed: a => buildFlowerBed(world, ...a),
    bush: (list, spec) => {
      if (!spec) return;
      const [base, step, cycle] = spec;
      list.forEach(([bx, bz], i) => {
        if (ALL_ROADS.some(road => Math.abs(bx - road) < EX.roadHalf) ||
            ALL_ROADS.some(road => Math.abs(bz - road) < EX.roadHalf)) return;
        if (inPlot(bx, bz, 2)) return;
        buildBush(world, bx, bz, base + (i % cycle) * step);
      });
    },
    pine: a => buildPine(world, ...a),
    bamboo: a => buildBamboo(world, ...a),
    waterfall: a => buildWaterfall(world, ...a),
    boat: a => buildBoat(world, ...a),
    lanternString: a => buildLanternString(world, ...a),
    banner: a => buildBanner(world, ...a),
    bronzeDing: a => buildBronzeDing(world, ...a),
    stoneLion: a => buildStoneLion(world, a[0], a[1], a[2], angle(a[3])),
  };
  for (const call of SCENERY_CFG.calls) {
    const fn = dispatch[call.fn];
    if (!fn) { console.warn(`[world] 未知景观构建器: ${call.fn}`); continue; }
    fn(call.args, call.scale);
  }

  // one-pass flush of all flower instances (few draw calls)
  flushFlowers(world);

  // merge all static geometry by material -> few draw calls (big perf win)
  batchStatic(world);

  return world;
}

// ---------------------------------------------------------------------------
//  placeAssets — insert downloaded FBX models (Quaternius CC0) into the town.
//  Each instance registered with a collider so the player can't walk through.
// ---------------------------------------------------------------------------
function addPropCollider(x, z, w, d, top, kind = 'prop') {
  colliders.push({ minX: x - w/2, maxX: x + w/2, minZ: z - d/2, maxZ: z + d/2, top, kind });
}

function placeAssets(parent, assets) {
  const m = M();
  const sz = (k) => (assets[k] && assets[k].userData.size) || { x: 2, y: 2, z: 2 };

  // 1) FBX well at plaza centre (replaces procedural well)
  if (assets.well) {
    const w = sz('well');
    const inst = instantiate(assets.well, { x: 0, z: -1.5 });
    parent.add(inst);
    addPropCollider(0, -1.5, Math.max(w.x, 1.6), Math.max(w.z, 1.6), w.y, 'well');
  }

  // 2) Hero buildings flanking the plaza — real textured houses
  for (const h of BUILD_CFG.heroes) {
    if (!assets[h.asset]) continue;
    const s = sz(h.asset);
    const rotY = angle(h.rotY);
    const [x, z] = roadSafePosition(h.x, h.z, s.x, s.z, rotY);
    const inst = instantiate(assets[h.asset], { x, z, rotY });
    parent.add(inst);
    addPropCollider(x, z, Math.max(s.x, 3.2), Math.max(s.z, 3.2), s.y, 'house');
  }

  const SH = BUILD_CFG.shopShell;
  SHOPS.forEach((shop, i) => {
    buildHouse(parent, shop.x, shop.z, SH.w, SH.d, SH.h, {
      rotY: shop.rotY, name: 'shop', stories: SH.stories, roofH: SH.roofH,
      roofMat: i % 3 === 0 ? m.roofBrown : m.roofBlue,
      wallMat: i % 2 === 0 ? m.plasterWarm : m.plaster,
    });
  });
  buildCommerce(parent, colliders, buildBanner);

  // 3) Windmill + barn + chicken coop in the outskirts (characterful silhouettes)
  for (const f of BUILD_CFG.farms) {
    if (!assets[f.asset]) continue;
    const s = sz(f.asset);
    const rotY = angle(f.rotY);
    const [x, z] = roadSafePosition(f.x, f.z, s.x, s.z, rotY);
    parent.add(instantiate(assets[f.asset], { x, z, rotY }));
    addPropCollider(x, z, Math.max(s.x, 2.5), Math.max(s.z, 2.5), f.colliderTop, f.kind);
  }

  // 4) (FBX nature pack relies on external textures that FBX doesn't embed —
  //     those models render white, so we keep the richer PROCEDURAL colored
  //     trees instead and add extra procedural foliage for density.)

}
