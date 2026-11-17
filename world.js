// ============================================================================
//  world.js — town geometry, terrain, day-night environment
//  1 unit = 1 meter. All objects are seated on the ground (no floating).
// ============================================================================
import * as THREE from 'three';
import { M, trackGeo, disposables } from './materials.js';
import { batchStatic } from './optimize.js';
import { instantiate } from './assets.js';
import { SHOPS, buildCommerce } from './commerce.js';
import {
  buildGrassField, buildFlowerBed, buildWillow, buildAnimatedPond,
  buildPavilion, buildRockery, buildGarden, buildBush, flushFlowers,
  makeFoliageMaterial, buildSkyDecor, buildRealTree,
  buildPine, buildBamboo, buildWaterfall, buildPetals, buildBronzeDing, buildStoneLion,
  buildBoat, buildLanternString, buildBanner, buildMist, buildRain,
} from './scenery.js';

export const TOWN = { half: 46 };        // playable half-size (scene doubled vs v1)
export const colliders = [];             // {minX,maxX,minZ,maxZ,top,climbable?}
export const ladders = [];
export const lamps = [];                 // {x,z,y} light sources that glow at night
export const litWindows = [];            // emissive materials already shared; count only
export const walkableLanes = [];         // for minimap roads

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
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i);
    const r = Math.sqrt(x * x + y * y) / (TOWN.half + 10);
    const rim = Math.max(0, r - 0.75); // 0 in the middle, rises toward edges
    const h = rim * rim * 26 * (0.6 + 0.4 * Math.sin(x * 0.15) * Math.cos(y * 0.12));
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
    if (Math.abs(x) < 5.2 || Math.abs(z) < 5.2) continue;
    if (Math.sqrt(x * x + z * z) < 11.5) continue;
    if (Math.hypot(x + 26, z - 26) < 8) continue; // pond
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
  const L = TOWN.half * 2;
  // main N-S and E-W stone lanes
  const mkLane = (w, len, rotY, name) => {
    const g = trackGeo(new THREE.PlaneGeometry(w, len));
    const lane = new THREE.Mesh(g, m.roadStone);
    lane.rotation.x = -Math.PI / 2; lane.rotation.z = rotY;
    lane.position.y = 0.04; lane.receiveShadow = true; lane.name = name;
    parent.add(lane);
    return lane;
  };
  mkLane(9, L, 0, 'road-ns');
  mkLane(9, L, Math.PI / 2, 'road-ew');
  walkableLanes.push({ type: 'h', half: 4.5 }, { type: 'v', half: 4.5 });

  // central plaza
  const plaza = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(11, 11, 0.02, 40)), m.stoneLt);
  plaza.position.y = 0.05; plaza.receiveShadow = true; plaza.name = 'plaza';
  parent.add(plaza);
  const ring = new THREE.Mesh(trackGeo(new THREE.RingGeometry(10.2, 10.9, 40)), m.stoneDk);
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.07; ring.receiveShadow = true;
  parent.add(ring);

  // cobble edging strips along lanes (instanced small flat stones, flush on road)
  const cobGeo = trackGeo(new THREE.BoxGeometry(0.32, 0.05, 0.28));
  const count = 900;
  const inst = new THREE.InstancedMesh(cobGeo, m.cobble, count);
  inst.receiveShadow = true; inst.name = 'cobbles';
  const d = new THREE.Object3D();
  let i = 0;
  while (i < count) {
    const alongV = Math.random() > 0.5;
    let x, z;
    if (alongV) { x = (Math.random() - 0.5) * 8.4; z = (Math.random() - 0.5) * L; }
    else { x = (Math.random() - 0.5) * L; z = (Math.random() - 0.5) * 8.4; }
    if (Math.abs(x) < 11.5 && Math.abs(z) < 11.5) continue;
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
}

// ---------------------------------------------------------------------------
//  HOUSE — realistic: stone base, plaster wall, timber frame, tiled hip roof
//  All parts rest on ground (y=0). Registers a collider.
// ---------------------------------------------------------------------------
function buildHouse(parent, x, z, w, d, h, opts = {}) {
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

  // body
  const bodyH = h - baseH;
  const body = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(w, bodyH, d)), wallMat);
  body.position.y = baseH + bodyH / 2; body.castShadow = body.receiveShadow = true;
  g.add(body);

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

  // door (recessed, with frame)
  const doorH = Math.min(2.4, bodyH * 0.52), doorW = w * 0.26;
  const door = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(doorW, doorH, 0.1)), m.wood);
  door.position.set(0, baseH + doorH / 2, -d / 2 - 0.02); g.add(door);
  const doorFrame = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(doorW + 0.2, doorH + 0.16, 0.06)), m.woodDark);
  doorFrame.position.set(0, baseH + doorH / 2 + 0.02, -d / 2 + 0.02); g.add(doorFrame);

  // windows (glowing at night) — lattice look via a lit material
  const winMat = opts.winMat || m.windowLit;
  const winH = Math.min(1.35, storyH * 0.42);
  const winGeo = trackGeo(new THREE.BoxGeometry(w * 0.16, winH, 0.08));
  for (let floor = 0; floor < stories; floor++) {
    const wy = baseH + storyH * (floor + 0.58);
    for (const wx of [-w * 0.28, w * 0.28]) {
      const win = new THREE.Mesh(winGeo, winMat);
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
  const hw = Math.abs(w/2*Math.cos(g.rotation.y)) + Math.abs(d/2*Math.sin(g.rotation.y));
  const hd = Math.abs(w/2*Math.sin(g.rotation.y)) + Math.abs(d/2*Math.cos(g.rotation.y));
  colliders.push({ minX: x-hw, maxX: x+hw, minZ: z-hd, maxZ: z+hd, top: baseH + bodyH, kind: 'house' });
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

const TIME_PRESETS = {
  morning: {
    label: '清晨', skyTop: 0x9fb6cf, skyBot: 0xf0dcc0, fog: 0xe2d4bc, fogNear: 90, fogFar: 300,
    hemiSky: 0xcfe0ee, hemiGround: 0x7a6a50, hemiInt: 0.5,
    sunColor: 0xffe0b0, sunInt: 1.5, sunPos: [-60, 40, 50],
    ambient: 0x3a4a5a, ambientInt: 0.35,
    exposure: 1.0, nightAmount: 0.35,
  },
  noon: {
    label: '正午', skyTop: 0x4f86c0, skyBot: 0xcfe0ea, fog: 0xc2d4e0, fogNear: 150, fogFar: 430,
    hemiSky: 0xbfd4e8, hemiGround: 0x6b5a44, hemiInt: 0.5,
    sunColor: 0xfff4dd, sunInt: 2.3, sunPos: [40, 80, 30],
    ambient: 0x556270, ambientInt: 0.12,
    exposure: 0.9, nightAmount: 0.0,
  },
  afternoon: {
    label: '黄昏', skyTop: 0x8a6ea8, skyBot: 0xf0b070, fog: 0xddaa78, fogNear: 90, fogFar: 320,
    hemiSky: 0xd8b898, hemiGround: 0x6a5040, hemiInt: 0.5,
    sunColor: 0xffb060, sunInt: 1.9, sunPos: [55, 26, -40],
    ambient: 0x4a3a48, ambientInt: 0.35,
    exposure: 1.02, nightAmount: 0.45,
  },
  night: {
    label: '夜晚', skyTop: 0x0b1526, skyBot: 0x1e2b42, fog: 0x162034, fogNear: 80, fogFar: 300,
    hemiSky: 0x3e5578, hemiGround: 0x201a24, hemiInt: 0.55,
    sunColor: 0xa9c2e8, sunInt: 0.85, sunPos: [-30, 70, -50], // moonlight
    ambient: 0x33465f, ambientInt: 0.9,
    exposure: 1.25, nightAmount: 1.0,
  },
};

export function setupEnvironment(scene) {
  env.scene = scene;
  // sky
  env.sky = buildSky(scene);
  env.skyMat = null;
  env.skyDecor = buildSkyDecor(scene);
  env.petals = buildPetals(scene, 38, 300);
  env.mist = buildMist(scene, 14);
  buildRain(scene, 1800);
  env.fog = new THREE.Fog(0xc8d8e2, 70, 260);
  scene.fog = null;

  // hemisphere fill
  env.hemi = new THREE.HemisphereLight(0xbfd4e8, 0x6b5a44, 1.0);
  scene.add(env.hemi);

  // ambient (goes blue/dark at night)
  env.ambient = new THREE.AmbientLight(0x556270, 0.3);
  scene.add(env.ambient);

  // key sun with shadows
  const sun = new THREE.DirectionalLight(0xfff4dd, 2.6);
  sun.position.set(40, 80, 30);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  const S = TOWN.half + 20;
  sun.shadow.camera.near = 1; sun.shadow.camera.far = 320;
  sun.shadow.camera.left = -S; sun.shadow.camera.right = S;
  sun.shadow.camera.top = S; sun.shadow.camera.bottom = -S;
  sun.shadow.bias = -0.0002; sun.shadow.normalBias = 0.05;
  scene.add(sun); scene.add(sun.target);
  env.sun = sun; env.sunLight = sun;

  // rim/cool back light
  env.rim = new THREE.DirectionalLight(0x9db8d6, 0.5);
  env.rim.position.set(-40, 30, -50);
  scene.add(env.rim);

  // night point lights near lanterns/lamps get created in buildWorld (pooled)
}

let _curPreset = null;
export function applyTime(key, instant = true) {
  const p = TIME_PRESETS[key] || TIME_PRESETS.noon;
  env.timeKey = key;
  _curPreset = p;
  const m = M();

  env.sky.setColors(p.skyTop, p.skyBot, p.sunPos, p.sunColor,
    key === 'night' ? 0.55 : 1.0, key === 'night');

  const rainy = env.weather === 'rain';
  if (env.fog) {
    env.fog.color.set(rainy ? 0x8d99a6 : p.fog);
    env.fog.near = p.fogNear * (rainy ? 0.45 : 1);
    env.fog.far = p.fogFar * (rainy ? 0.55 : 1);
  }
  if (rainy && env.sun) { env.sun.intensity = p.sunInt * 0.55; }
  else if (env.sun) { env.sun.intensity = p.sunInt; }
  env.scene.background = new THREE.Color(p.skyBot);

  env.hemi.color.set(p.hemiSky);
  env.hemi.groundColor.set(p.hemiGround);
  env.hemi.intensity = p.hemiInt;

  env.ambient.color.set(p.ambient);
  env.ambient.intensity = p.ambientInt;

  env.sun.color.set(p.sunColor);
  env.sun.intensity = p.sunInt;
  env.sun.position.set(...p.sunPos);

  env.rim.intensity = 0.5 * (1 - p.nightAmount * 0.7);

  // emissive materials respond to nightAmount
  const na = p.nightAmount;
  m.windowLit.emissiveIntensity = 0.15 + na * 2.6;
  m.windowLit.color.setHex(na > 0.5 ? 0x2a2016 : 0x3a3630);
  m.lantern.emissiveIntensity = 0.2 + na * 2.6;
  m.lampGlow.emissiveIntensity = 0.15 + na * 3.4;

  // night point lights
  for (const L of env.nightLights) L.intensity = na * L.userData.baseIntensity;

  // HDRI environment map (reflections + image based lighting)
  if (env.envMaps && env.envMaps[key] && env.scene) {
    env.scene.environment = env.envMaps[key];
    const envInt = { morning: 0.12, noon: 0.1, afternoon: 0.14, night: 0.1 }[key] ?? 0.1;
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
    env.skyDecor.starMat.opacity = Math.max(0, na * 1.2 - 0.15);
    env.skyDecor.cloudMat.opacity = 0.5 * (1 - na);
    env.skyDecor.clouds.visible = na < 0.85;
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
export function buildWorld(scene, assets = null) {
  world = new THREE.Group();
  world.name = 'world';
  scene.add(world);

  buildGround(world);
  buildRoads(world);
  buildAnimatedPond(world, -26, 26, 8);
  // NOTE: the plaza well is replaced by a downloaded FBX well in placeAssets().

  const m = M();

  // --- residential blocks: orient houses to face the main streets ---
  // North block (rows facing +z toward road) and south (facing -z), east/west flanks.
  const houseDefs = [];
  // four quadrants of houses; each block along a lane
  const blockOffsets = [16, 28];      // distance from centre
  const runs = [-34, -20, 20, 34];    // positions along x (N/S) and z (E/W)
  let seed = 1;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const roofChoices = [m.roofBlue, m.roofBrown, m.roofGrey];

  for (const off of blockOffsets) {
    for (const run of runs) {
      // north side (z negative), facing +z
      let w = 5 + rnd() * 2.5, d = 5 + rnd() * 1.8, h = 4 + rnd() * 1.6;
      houseDefs.push([run, -off, w, d, h, { rotY: 0, roofMat: roofChoices[Math.floor(rnd()*3)], wallMat: rnd()>0.5?m.plaster:m.plasterWarm }]);
      // south side (z positive), facing -z
      w = 5 + rnd() * 2.5; d = 5 + rnd() * 1.8; h = 4 + rnd() * 1.6;
      houseDefs.push([run, off, w, d, h, { rotY: Math.PI, roofMat: roofChoices[Math.floor(rnd()*3)], wallMat: rnd()>0.5?m.plaster:m.plasterWarm }]);
    }
  }
  // east / west flank houses facing the E-W road
  for (const off of blockOffsets) {
    for (const run of runs) {
      let w = 5 + rnd()*2, d = 5 + rnd()*1.5, h = 4 + rnd()*1.6;
      houseDefs.push([off, run, w, d, h, { rotY: Math.PI/2, roofMat: roofChoices[Math.floor(rnd()*3)] }]);
      w = 5 + rnd()*2; d = 5 + rnd()*1.5; h = 4 + rnd()*1.6;
      houseDefs.push([-off, run, w, d, h, { rotY: -Math.PI/2, roofMat: roofChoices[Math.floor(rnd()*3)] }]);
    }
  }
  // Reserved scenic zones — no houses may spawn inside these.
  const RESERVED = [
    { x: -26, z: 26, r: 11 },   // pond
    { x: -13, z: 20, r: 8.5 },  // pavilion
    { x: -34, z: 18, r: 5 },    // rockery A
    { x: -30, z: 30, r: 4 },    // rockery B
    { x: 30, z: -34, r: 10 },   // walled garden
  ];
  const inReserved = (x, z) => RESERVED.some(r => Math.hypot(x - r.x, z - r.z) < r.r);

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
      if (x - hw < p.maxX + 0.3 && x + hw > p.minX - 0.3 &&
          z - hd < p.maxZ + 0.3 && z + hd > p.minZ - 0.3) { overlap = true; break; }
    }
    if (overlap) continue;
    placed.push({ minX: x - hw, maxX: x + hw, minZ: z - hd, maxZ: z + hd });
    buildHouse(world, ...def);
  }

  // --- pavilion on the plaza east edge (two-tier) ---
  const pav = buildHouse(world, 17, 0, 6.5, 6.5, 5.4, { roofMat: m.roofBlue, roofH: 2.2, name: 'pavilion', rotY: Math.PI });
  const tier = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(3.6, 1.7, 3.6)), m.plaster);
  tier.position.set(17, 5.4 + 0.85, 0); tier.castShadow = true; world.add(tier);
  const tierRoof = new THREE.Mesh(trackGeo(new THREE.ConeGeometry(3.8, 1.7, 4)), m.roofBlue);
  tierRoof.position.set(17, 5.4 + 1.7 + 0.85, 0); tierRoof.rotation.y = Math.PI/4; tierRoof.castShadow = true; world.add(tierRoof);

  // --- boundary city walls with a south gate ---
  const H = TOWN.half, wallH = 3.6, wallT = 1.4;
  buildWall(world, -H/2 - 2.5, H, H - 5, wallT, wallH);
  buildWall(world,  H/2 + 2.5, H, H - 5, wallT, wallH);
  buildWall(world, 0, -H, H * 2, wallT, wallH);
  buildWall(world, H, 0, wallT, H * 2, wallH);
  buildWall(world, -H, 0, wallT, H * 2, wallH);
  // gate towers + lintel
  buildHouse(world, -3.6, H, 2.6, 2.6, 4.6, { roofMat: m.roofBrown, lanterns: false, wallMat: m.stoneLt });
  buildHouse(world,  3.6, H, 2.6, 2.6, 4.6, { roofMat: m.roofBrown, lanterns: false, wallMat: m.stoneLt });
  const lintel = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(7.4, 0.7, 1.8)), m.woodRed);
  lintel.position.set(0, 3.7, H); lintel.castShadow = true; world.add(lintel);
  const plaque = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(2.6, 0.9, 0.15)), m.gold);
  plaque.position.set(0, 3.75, H - 0.95); world.add(plaque);

  // --- ladders (climb onto walls / pavilion) ---
  buildLadder(world, 12, H - 0.9, 0, wallH, { x: 0, z: -1 });
  buildLadder(world, -H + 0.9, 10, 0, wallH, { x: 1, z: 0 });
  buildLadder(world, 17 + 3.5, 0, 0, 5.4, { x: 1, z: 0 });

  // --- trees scattered (avoid roads, plaza, pond, houses) ---
  const treeSpots = [
    [-34,12],[34,-12],[-12,34],[12,-34],[-40,-30],[40,30],[-20,20],[20,-20],
    [-30,-14],[30,14],[-8,30],[8,-30],[-36,36],[36,-36],[-24,8],[24,-8],
    [-16,24],[16,-24],[42,0],[-42,0],[0,40],[0,-40],[-30,40],[30,-40],
  ];
  treeSpots.forEach(([x,z], i) => {
    if (Math.hypot(x + 26, z - 26) < 10) return; // pond
    if (Math.abs(x) < 7 || Math.abs(z) < 7) return; // roads
    if (Math.abs(Math.abs(x) - 10) < 4 && Math.abs(z) > 12) return; // shop rows
    if (Math.hypot(x + 13, z - 20) < 8) return;   // pavilion
    if (Math.hypot(x - 30, z + 34) < 10) return;  // garden
    buildTree(world, x, z, 0.85 + (i % 4) * 0.12);
  });

  // --- street lamps along the lanes ---
  const lampPositions = [
    [6, 12], [-6, 12], [6, -12], [-6, -12],
    [6, 24], [-6, 24], [6, -24], [-6, -24],
    [12, 6], [-12, 6], [12, -6], [-12, -6],
    [24, 6], [-24, 6], [24, -6], [-24, -6],
  ];
  lampPositions.forEach(([x,z]) => buildLamp(world, x, z));

  // --- pooled night point lights (a handful, positioned at key lamps) ---
  const lightSpots = [[0,-1.5],[12,6],[-12,6],[12,-6],[-12,-6],[0,20],[0,-20],[0,34],[17,0]];
  for (let i = 0; i < lightSpots.length; i++) {
    const [x,z] = lightSpots[i];
    const pl = new THREE.PointLight(0xffb060, 0, 30, 2.0);
    pl.position.set(x, 3.4, z);
    pl.userData.baseIntensity = 9 + (i % 3) * 2.5;
    pl.castShadow = false;
    scene.add(pl);
    env.nightLights.push(pl);
  }

  // --- placed third-party FBX assets (well, hero houses, windmill, trees...) ---
  if (assets) placeAssets(world, assets);

  // --- RICH SCENERY: grass field, pavilion, rockery, garden, willows, flowers ---
  buildGrassField(world);

  // Scenic pavilion (亭) beside the pond, overlooking water
  buildPavilion(world, -13, 20, 1.0);

  // Rockery (假山) cluster near the pond's far side
  buildRockery(world, -34, 18, 1.3);
  buildRockery(world, -30, 30, 1.0);

  // Walled flower garden to the north-east
  buildGarden(world, 30, -34, 13);

  // Willows lining the pond shore (微微垂柳)
  buildWillow(world, -34, 26, 1.1);
  buildWillow(world, -20, 14, 1.0);
  buildWillow(world, -26, 36, 1.05);
  buildWillow(world, -36, 34, 0.95);
  buildWillow(world, 24, 33, 1.0);

  // Flower clusters dotted around the town edges & near garden
  buildFlowerBed(world, 24, -26, 3.0, 140);
  buildFlowerBed(world, 38, -30, 2.5, 100, ['petalYellow','petalWhite','petalPink']);
  buildFlowerBed(world, -20, 34, 2.2, 90, ['petalRed','petalPink']);
  buildFlowerBed(world, 18, 30, 2.4, 100);
  buildFlowerBed(world, 12, -30, 2.0, 80, ['petalYellow','petalWhite']);

  // Scatter small wind-swayed bushes
  const bushSpots = [[-12, 26],[10, 34],[-38, 8],[36, 8],[26, 20],[-24, -30],[30, -18],[-8, -34]];
  bushSpots.forEach(([bx, bz], i) => {
    if (Math.abs(bx) < 7 || Math.abs(bz) < 7) return;
    buildBush(world, bx, bz, 0.65 + (i % 3) * 0.18);
  });

  // --- pines, bamboo, waterfall, ceremonial props ---
  buildPine(world, -36, 22, 1.0);
  buildPine(world, -30, 38, 0.9);
  buildPine(world, 26, -38, 1.0);
  buildPine(world, 38, -24, 0.85);
  buildPine(world, -40, -18, 1.05);
  buildPine(world, 40, -2, 0.95);

  buildBamboo(world, -37, 6, 11, 1.0);
  buildBamboo(world, 36, 30, 9, 0.95);
  buildBamboo(world, -20, -36, 8, 0.9);

  // waterfall spilling off the rockery into a small basin
  buildWaterfall(world, -30, 1.5, 31.6, 2.0, 3.4, 0);

  // moored boat on the pond + lantern strings across the lanes + shop banners
  buildBoat(world, -21.5, 21.5, -0.7, 1.0);
  buildLanternString(world, -9, 10.5, 9, 10.5, 4.4, 9, 0.7);
  buildLanternString(world, -9, -10.5, 9, -10.5, 4.4, 9, 0.7);
  buildLanternString(world, 10.5, -9, 10.5, 9, 4.4, 9, 0.7);
  buildBanner(world, 6.4, 6.2, '酒', -0.4);
  buildBanner(world, -7.2, -6.4, '茶', 0.5);
  buildBanner(world, 15.4, -3.2, '客栈', -1.2);

  // plaza bronze ding + gate guardian lions
  buildBronzeDing(world, 3.6, 4.2, 0.9);
  buildStoneLion(world, -4.6, 43.2, 0.95, Math.PI);
  buildStoneLion(world, 4.6, 43.2, 0.95, Math.PI);

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
  const heroHouses = [
    ['house1', -8, -9, 0.35],
    ['house2',  9, -9, -0.3],
    ['building4', -9, 9, Math.PI + 0.2],
    ['building2s', 9, 9, Math.PI - 0.25],
  ];
  for (const [kind, x, z, rotY] of heroHouses) {
    if (!assets[kind]) continue;
    const s = sz(kind);
    const inst = instantiate(assets[kind], { x, z, rotY });
    parent.add(inst);
    addPropCollider(x, z, Math.max(s.x, 3.2), Math.max(s.z, 3.2), s.y, 'house');
  }

  SHOPS.forEach((shop, i) => {
    buildHouse(parent, shop.x, shop.z, 4.8, 3.4, 8.4, {
      rotY: shop.rotY, name: 'shop', stories: 3, roofH: 1.8,
      roofMat: i % 3 === 0 ? m.roofBrown : m.roofBlue,
      wallMat: i % 2 === 0 ? m.plasterWarm : m.plaster,
    });
  });
  buildCommerce(parent, colliders, buildBanner);

  // 3) Windmill + barn + chicken coop in the outskirts (characterful silhouettes)
  const farms = [
    ['windmill', -38, -8, 0.6, 9.0],
    ['barn', 39, 16, -0.4, 4.5],
    ['coop', 40, 30, 0.8, 2.0],
  ];
  for (const [kind, x, z, rotY, top] of farms) {
    if (!assets[kind]) continue;
    const s = sz(kind);
    parent.add(instantiate(assets[kind], { x, z, rotY }));
    addPropCollider(x, z, Math.max(s.x, 2.5), Math.max(s.z, 2.5), top, kind === 'windmill' ? 'tower' : 'house');
  }

  // 4) (FBX nature pack relies on external textures that FBX doesn't embed —
  //     those models render white, so we keep the richer PROCEDURAL colored
  //     trees instead and add extra procedural foliage for density.)

}
