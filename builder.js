// ============================================================================
//  builder.js — 我的城市 build module (place / select / delete / roads /
//  material editing / localStorage autosave). 1 unit = 1 meter.
//  Style: top-level functions + shared mutable exports (matches project idiom).
// ============================================================================
import * as THREE from 'three';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { M, trackGeo, disposables } from './materials.js';
import { PLOT, colliders, buildHouse } from './world.js';
import { instantiate, MODEL_SPECS } from './assets.js';
import {
  buildRealTree, buildPine, buildWillow, buildBamboo, buildBush,
  buildFlowerBed, buildPavilion, buildRockery, buildStoneLion,
  buildBronzeDing, buildBanner,
} from './scenery.js';
import { buildStandaloneShop } from './commerce.js';
import { PBR_CATALOG, loadSinglePBRSet } from './textures.js';

export const SAVE_KEY = 'town_builder_v1';
export const builderObjects = [];   // placed root groups (userData.builder = {...})
export const roadsMesh = { current: null };

let scene = null, camera = null, renderer = null, orbit = null;
let raycaster = null, groundPlane = null, gizmo = null;
let ghost = null, ghostValid = false, ghostDef = null;
let selected = null, tool = 'place', activeDefKey = null;
let builderEnabled = false;
let saveTimer = null;
let onChangeHook = null;            // main.js sets this to flip shadowMap.needsUpdate
let roadPainting = false, roadErase = false;
let lastRoadCell = null;
const roadCells = new Map();        // 'gx,gz' -> true
const ROAD_CELL = 2;

// ===========================================================================
//  PLACEABLE CATALOG — factory(parent, x, z, rotY) roots everything at (x,0,z)
// ===========================================================================
export const PLACE_DEFS = {
  // ---- buildings ----
  houseA: {
    label: '小民居', category: 'buildings', footprint: 3.2,
    factory: (p, x, z, ry) => buildHouse(p, x, z, 4.6, 4.0, 4.6, { rotY: ry, name: 'built-house', noCollider: true }),
  },
  houseB: {
    label: '双层楼阁', category: 'buildings', footprint: 4.0,
    factory: (p, x, z, ry) => buildHouse(p, x, z, 5.4, 4.6, 7.4, { rotY: ry, name: 'built-house', noCollider: true, stories: 3, roofH: 1.8 }),
  },
  pavilion: {
    label: '凉亭', category: 'buildings', footprint: 2.6,
    factory: (p, x, z, ry) => { const g = new THREE.Group(); g.rotation.y = ry; buildPavilion(g, 0, 0, 1.0); p.add(g); return g; },
  },
  rockery: {
    label: '假山', category: 'buildings', footprint: 1.6,
    factory: (p, x, z, ry) => { const g = new THREE.Group(); g.rotation.y = ry; buildRockery(g, 0, 0, 1.0); p.add(g); return g; },
  },
  // ---- vegetation ----
  treeRound: {
    label: '阔叶树', category: 'plants', footprint: 0.9,
    factory: (p, x, z) => { const g = new THREE.Group(); buildRealTree(g, 0, 0, 1.0, 'green'); p.add(g); return g; },
  },
  treeBlossom: {
    label: '花树', category: 'plants', footprint: 0.9,
    factory: (p, x, z) => { const g = new THREE.Group(); buildRealTree(g, 0, 0, 0.95, 'blossom'); p.add(g); return g; },
  },
  pine: {
    label: '松树', category: 'plants', footprint: 0.9,
    factory: (p, x, z) => { const g = new THREE.Group(); buildPine(g, 0, 0, 1.0); p.add(g); return g; },
  },
  willow: {
    label: '垂柳', category: 'plants', footprint: 1.0,
    factory: (p, x, z) => { const g = new THREE.Group(); buildWillow(g, 0, 0, 1.0); p.add(g); return g; },
  },
  bamboo: {
    label: '竹丛', category: 'plants', footprint: 0.8,
    factory: (p, x, z) => { const g = new THREE.Group(); buildBamboo(g, 0, 0, 6, 1.0); p.add(g); return g; },
  },
  bush: {
    label: '灌木', category: 'plants', footprint: 0.5,
    factory: (p, x, z) => { const g = new THREE.Group(); buildBush(g, 0, 0, 1.0); p.add(g); return g; },
  },
  flowers: {
    label: '花坛', category: 'plants', footprint: 1.0,
    factory: (p, x, z) => { const g = new THREE.Group(); buildFlowerBed(g, 0, 0, 1.2, 60); p.add(g); return g; },
  },
  // ---- decorations ----
  stoneLion: {
    label: '石狮', category: 'decor', footprint: 0.5,
    factory: (p, x, z, ry) => { const g = new THREE.Group(); g.rotation.y = ry; buildStoneLion(g, 0, 0, 0.9, 0); p.add(g); return g; },
  },
  bronzeDing: {
    label: '铜鼎', category: 'decor', footprint: 0.6,
    factory: (p, x, z, ry) => { const g = new THREE.Group(); g.rotation.y = ry; buildBronzeDing(g, 0, 0, 0.9); p.add(g); return g; },
  },
  banner: {
    label: '幌旗', category: 'decor', footprint: 0.4,
    factory: (p, x, z, ry) => { const g = new THREE.Group(); g.rotation.y = ry; buildBanner(g, 0, 0, '市', 0); p.add(g); return g; },
  },
  // ---- shops (招牌种类) ----
  shopJiu:   { label: '酒铺', category: 'shops', footprint: 2.8, shopSign: '酒' },
  shopCha:   { label: '茶铺', category: 'shops', footprint: 2.8, shopSign: '茶' },
  shopBu:    { label: '布铺', category: 'shops', footprint: 2.8, shopSign: '布' },
  shopYao:   { label: '药铺', category: 'shops', footprint: 2.8, shopSign: '药' },
  shopKezhan:{ label: '客栈', category: 'shops', footprint: 2.8, shopSign: '客栈' },
  shopShu:   { label: '书肆', category: 'shops', footprint: 2.8, shopSign: '书' },
};

export const CATEGORIES = [
  { key: 'buildings', label: '建筑' },
  { key: 'plants', label: '植被' },
  { key: 'shops', label: '商铺' },
  { key: 'decor', label: '装饰' },
];

// friendly names for shared materials when they show up in the parts list
const MAT_LABELS = {
  plaster: '墙体', plasterWarm: '墙体', wood: '木构件', woodDark: '深色木', woodRed: '红木',
  roofBlue: '屋顶', roofBrown: '屋顶', roofGrey: '屋顶', stoneLt: '石基', stoneDk: '石基',
  windowLit: '窗纸', lantern: '灯笼', lampGlow: '灯罩', gold: '鎏金', leaf: '树叶',
  leaf2: '树叶', leaf3: '树叶', trunk: '树干', willowLeaf: '柳叶', moss: '苔藓',
  rock: '山石', rockDark: '山石', pavilionRed: '亭柱', grass: '草', dirt: '土',
  stone: '石件', cobble: '卵石', water: '水面', petalPink: '花瓣', petalRed: '花瓣',
  petalYellow: '花瓣', petalWhite: '花瓣', flowerStem: '花茎', lotusPad: '荷叶',
  lotusFlower: '莲花',
};

const COLOR_INPUT = document.createElement('input');
COLOR_INPUT.type = 'color';

// ===========================================================================
//  INIT / TEARDOWN
// ===========================================================================
export function initBuilder({ scene: s, camera: c, renderer: r, orbit: o, onChange }) {
  scene = s; camera = c; renderer = r; orbit = o;
  onChangeHook = onChange || null;
  raycaster = new THREE.Raycaster();
  groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  gizmo = new TransformControls(camera, renderer.domElement);
  gizmo.setSize(0.8);
  gizmo.addEventListener('dragging-changed', (e) => {
    orbit.enabled = !builderEnabled ? orbit.enabled : (!e.value);
    if (!e.value) { syncFromGizmo(); markDirty(); }
  });
  gizmo.addEventListener('objectChange', () => markDirty());
  scene.add(gizmo);
  gizmo.enabled = false;
  gizmo.visible = false;
  bindBuilderEvents(renderer.domElement);
  loadLayout();   // restore saved town before first render
}

// ===========================================================================
//  MODE ENTER / EXIT
// ===========================================================================
export function isBuilderEnabled() { return builderEnabled; }

export function enterBuilder() {
  builderEnabled = true;
  gizmo.enabled = true;
  // camera: look at the plot from a 3/4 top-down angle
  orbit.target.set(PLOT.x, 0, PLOT.z);
  const dist = Math.max(PLOT.halfW, PLOT.halfD) * 2.6;
  const dir = new THREE.Vector3(0, 0.9, 0.45).normalize();
  camera.position.set(PLOT.x, 0, PLOT.z).addScaledVector(dir, dist);
  camera.lookAt(PLOT.x, 0, PLOT.z);
  orbit.minDistance = 6;
  orbit.maxDistance = 90;
  orbit.enabled = true;
  orbit.update();
  setTool('place');
  if (!activeDefKey) {
    const first = Object.keys(PLACE_DEFS)[0];
    selectDef(first);
  }
  showBuilderUI(true);
}

export function exitBuilder() {
  builderEnabled = false;
  detachGizmo();
  clearGhost();
  ghostDef = null;
  roadPainting = false;
  scene.remove(gizmo);
  // restore orbit bounds used by the roaming view
  orbit.minDistance = 20;
  orbit.maxDistance = 140;
  saveNow();
  showBuilderUI(false);
}

// Re-add the gizmo to the scene when re-entering (exitBuilder removes it).
export function reattachGizmo() {
  scene.add(gizmo);
  gizmo.enabled = true;
  gizmo.visible = false;
}

function detachGizmo() {
  if (selected) { selected.userData.builder.selected = false; selected = null; }
  gizmo.detach();
  gizmo.visible = false;
  refreshPropsPanel();
}

function showBuilderUI(on) {
  document.getElementById('builderUI').style.display = on ? 'flex' : 'none';
  document.getElementById('btnBuild').classList.toggle('active', on);
  document.body.classList.toggle('building', on);
  if (!on) refreshPropsPanel();
}

// ===========================================================================
//  TOOLS
// ===========================================================================
export function setTool(t) {
  tool = t;
  detachGizmo();
  clearGhost();
  if (t === 'place' && activeDefKey) makeGhost(activeDefKey);   // rebuild preview when returning to place
  document.querySelectorAll('#builderTools .tool-btn').forEach(b => b.classList.toggle('active', b.dataset.tool === t));
  document.getElementById('builderAssetBar').style.display = t === 'place' ? 'flex' : 'none';
  const hint = {
    place: '左键放置 · 拖拽旋转视角 · 滚轮缩放',
    select: '左键选中 · W/E/R 切换移动/旋转/缩放 · Delete 删除 · Esc 取消',
    erase: '左键点击删除物件',
    road: '左键拖拽铺路 · 右键(或按住Alt)拆除道路',
  }[t];
  document.getElementById('builderHint').textContent = hint;
}

// called from index UI: pick the asset to place
export function selectDef(key) {
  activeDefKey = key;
  document.querySelectorAll('#builderAssets .asset-btn').forEach(b => b.classList.toggle('active', b.dataset.def === key));
  setTool('place');   // clears ghost first, then rebuild for the new asset
  makeGhost(key);
}

export function setGizmoMode(mode) {
  if (gizmo.object) gizmo.setMode(mode);   // translate | rotate | scale
}

// ===========================================================================
//  GHOST PREVIEW
// ===========================================================================
function makeGhost(defKey) {
  clearGhost();
  const def = PLACE_DEFS[defKey];
  if (!def) return;
  ghostDef = def;
  if (def.shopSign) {
    const { group } = buildStandaloneShop(def.shopSign, 0);
    group.traverse(o => { if (o.isMesh) o.castShadow = false; });
    ghost = group;
  } else if (MODEL_SPECS[defKey]) {
    ghost = instantiate(window.__townAssets?.[defKey], { x: 0, z: 0 });
  } else {
    const holder = new THREE.Group();
    def.factory(holder, 0, 0, 0);
    ghost = holder;
  }
  ghost.traverse(o => {
    if (o.isMesh || o.isInstancedMesh) {
      o.castShadow = false; o.receiveShadow = false;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      o.userData._ghostOrig = mats;
      o.material = mats.map(m => {
        const c = m.clone();
        c.transparent = true;
        c.opacity = 0.45;
        c.depthWrite = false;
        return c;
      });
    }
  });
  ghost.visible = false;
  scene.add(ghost);
}

function clearGhost() {
  if (!ghost) return;
  scene.remove(ghost);
  ghost.traverse(o => {
    if (o.isMesh || o.isInstancedMesh) {
      (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m.dispose?.());
    }
  });
  ghost = null;
  ghostValid = false;
}

function updateGhost(ndcX, ndcY) {
  if (!ghost) return;
  raycaster.setFromCamera({ x: ndcX, y: ndcY }, camera);
  const hit = new THREE.Vector3();
  if (!raycaster.ray.intersectPlane(groundPlane, hit)) { ghost.visible = false; return; }
  const inside = clampToPlot(hit);
  ghost.position.set(inside.x, 0, inside.z);
  ghost.visible = true;
  ghostValid = isPlacementValid(inside.x, inside.z, ghostDef);
  const tint = ghostValid ? 0x55ff88 : 0xff5544;
  ghost.traverse(o => {
    if (o.isMesh || o.isInstancedMesh) {
      (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m.color?.setHex(tint));
    }
  });
}

function clampToPlot(v) {
  return {
    x: Math.max(PLOT.x - PLOT.halfW + 0.6, Math.min(PLOT.x + PLOT.halfW - 0.6, Math.round(v.x * 2) / 2)),
    z: Math.max(PLOT.z - PLOT.halfD + 0.6, Math.min(PLOT.z + PLOT.halfD - 0.6, Math.round(v.z * 2) / 2)),
  };
}

function isPlacementValid(x, z, def) {
  const fp = def?.footprint || 2;
  const r = { minX: x - fp, maxX: x + fp, minZ: z - fp, maxZ: z + fp };
  for (const c of colliders) {
    if (r.maxX > c.minX + 0.1 && r.minX < c.maxX - 0.1 &&
        r.maxZ > c.minZ + 0.1 && r.minZ < c.maxZ - 0.1) return false;
  }
  return true;
}

// ===========================================================================
//  PLACE / DELETE
// ===========================================================================
function spawnObject(defKey, x, z, rotY = 0, scale = 1, savedMats = null) {
  const def = PLACE_DEFS[defKey];
  if (!def) return null;
  let root;
  if (def.shopSign) {
    const built = buildStandaloneShop(def.shopSign, rotY);
    root = built.group;
    root.userData.size = { x: built.footprint.hw * 2, y: built.footprint.top, z: built.footprint.hd * 2 };
  } else if (MODEL_SPECS[defKey]) {
    root = instantiate(window.__townAssets?.[defKey], { x: 0, z: 0, rotY, scale });
    root.position.set(x, 0, z);
    root.userData.size = window.__townAssets?.[defKey]?.userData.size || { x: 2, y: 2, z: 2 };
  } else {
    root = def.factory(scene, x, z, rotY);
    root.scale.setScalar(scale);
  }
  root.position.x = x; root.position.z = z;
  root.userData.builder = { defKey, collider: null };
  scene.add(root);
  refreshCollider(root);
  if (savedMats) applySavedMats(root, savedMats);
  builderObjects.push(root);
  return root;
}

function refreshCollider(root) {
  const b = root.userData.builder;
  if (b?.collider) {
    const i = colliders.indexOf(b.collider);
    if (i >= 0) colliders.splice(i, 1);
    b.collider = null;
  }
  const size = root.userData.size || measureSize(root);
  const fp = PLACE_DEFS[b.defKey]?.footprint || Math.max(size.x, size.z) / 2;
  const hw = Math.abs(size.x / 2) + fp * 0.15;
  const hd = Math.abs(size.z / 2) + fp * 0.15;
  const top = Math.max(size.y * root.scale.y, 0.4);
  b.collider = { minX: root.position.x - hw, maxX: root.position.x + hw, minZ: root.position.z - hd, maxZ: root.position.z + hd, top, kind: 'prop' };
  colliders.push(b.collider);
}

function measureSize(root) {
  const box = new THREE.Box3().setFromObject(root);
  return {
    x: Math.max(0.4, box.max.x - box.min.x),
    y: Math.max(0.4, box.max.y - box.min.y),
    z: Math.max(0.4, box.max.z - box.min.z),
  };
}

function deleteObject(root) {
  const i = builderObjects.indexOf(root);
  if (i < 0) return;
  builderObjects.splice(i, 1);
  const b = root.userData.builder;
  if (b?.collider) {
    const ci = colliders.indexOf(b.collider);
    if (ci >= 0) colliders.splice(ci, 1);
  }
  if (selected === root) detachGizmo();
  scene.remove(root);
  markDirty();
}

// ===========================================================================
//  POINTER EVENTS (canvas)
// ===========================================================================
function bindBuilderEvents(dom) {
  dom.addEventListener('pointermove', (e) => {
    if (!builderEnabled || !ghost) return;
    const n = ndc(e);
    updateGhost(n.x, n.y);
  });
  dom.addEventListener('pointerdown', (e) => {
    if (!builderEnabled) return;
    if (e.button === 0) {
      if (tool === 'place' && ghost && ghostDef) {
        if (ghostValid) {
          const root = spawnObject(activeDefKey, ghost.position.x, ghost.position.z, 0);
          selectObject(root);
          markDirty();
          onChangeHook?.();
        } else {
          flashHint('此处无法放置（与其他物体重叠或超出空地）');
        }
      } else if (tool === 'select') {
        trySelect(e);
      } else if (tool === 'erase') {
        const hit = pickObject(e);
        if (hit) deleteObject(hit);
      } else if (tool === 'road') {
        roadPainting = true; roadErase = e.altKey;
        paintRoadAt(e);
      }
    } else if (e.button === 2 && tool === 'road') {
      roadPainting = true; roadErase = true;
      paintRoadAt(e);
    }
  });
  dom.addEventListener('pointermove', (e) => {
    if (roadPainting && tool === 'road') paintRoadAt(e);
  });
  window.addEventListener('pointerup', () => {
    if (roadPainting) { roadPainting = false; roadErase = false; lastRoadCell = null; markDirty(); onChangeHook?.(); }
  });
  dom.addEventListener('contextmenu', (e) => {
    if (builderEnabled) e.preventDefault();
  });
  window.addEventListener('keydown', (e) => {
    if (!builderEnabled) return;
    if (e.code === 'Escape') { detachGizmo(); setTool('select'); }
    if (e.code === 'Delete' && selected) { deleteObject(selected); }
    if (e.code === 'KeyW' && selected) gizmo.setMode('translate');
    if (e.code === 'KeyE' && selected) gizmo.setMode('rotate');
    if (e.code === 'KeyR' && selected) gizmo.setMode('scale');
  });
}

function pickObject(e) {
  raycaster.setFromCamera(ndc(e), camera);
  const hits = raycaster.intersectObjects(builderObjects, true);
  if (!hits.length) return null;
  let o = hits[0].object;
  while (o && !o.userData.builder) o = o.parent;
  return o && o.userData.builder ? o : null;
}

function trySelect(e) {
  const hit = pickObject(e);
  if (hit) selectObject(hit);
  else detachGizmo();
}

function selectObject(root) {
  if (selected) selected.userData.builder.selected = false;
  selected = root;
  selected.userData.builder.selected = true;
  gizmo.attach(root);
  gizmo.visible = true;
  gizmo.setMode('translate');
  refreshPropsPanel();
}

function syncFromGizmo() {
  if (!selected) return;
  const r = plotRectHalf();
  selected.position.x = Math.max(PLOT.x - r, Math.min(PLOT.x + r, selected.position.x));
  selected.position.z = Math.max(PLOT.z - r, Math.min(PLOT.z + r, selected.position.z));
  selected.position.y = 0;
  refreshCollider(selected);
  refreshPropsPanel();
}

function plotRectHalf() { return Math.min(PLOT.halfW, PLOT.halfD) - 0.5; }

function ndc(e) {
  return {
    x: (e.clientX / window.innerWidth) * 2 - 1,
    y: -(e.clientY / window.innerHeight) * 2 + 1,
  };
}

function flashHint(msg) {
  const el = document.getElementById('builderHint');
  if (!el) return;
  const prev = el.textContent;
  el.textContent = msg;
  el.style.color = '#ff9080';
  setTimeout(() => { el.textContent = prev; el.style.color = ''; }, 1400);
}

// ===========================================================================
//  ROADS — merged 2m tiles, no collision
// ===========================================================================
function paintRoadAt(e) {
  raycaster.setFromCamera(ndc(e), camera);
  const hit = new THREE.Vector3();
  if (!raycaster.ray.intersectPlane(groundPlane, hit)) return;
  const gx = Math.floor(hit.x / ROAD_CELL);
  const gz = Math.floor(hit.z / ROAD_CELL);
  const key = `${gx},${gz}`;
  if (key === lastRoadCell) return;
  lastRoadCell = key;
  const inside = gx * ROAD_CELL >= PLOT.x - PLOT.halfW && (gx + 1) * ROAD_CELL <= PLOT.x + PLOT.halfW &&
                 gz * ROAD_CELL >= PLOT.z - PLOT.halfD && (gz + 1) * ROAD_CELL <= PLOT.z + PLOT.halfD;
  if (!inside) return;
  if (roadErase) roadCells.delete(key);
  else roadCells.set(key, true);
  rebuildRoads();
}

function rebuildRoads() {
  const m = M();
  if (roadsMesh.current) {
    scene.remove(roadsMesh.current);
    roadsMesh.current.geometry.dispose();
    roadsMesh.current = null;
  }
  if (!roadCells.size) return;
  const geos = [];
  for (const key of roadCells.keys()) {
    const [gx, gz] = key.split(',').map(Number);
    const g = new THREE.PlaneGeometry(ROAD_CELL, ROAD_CELL);
    g.rotateX(-Math.PI / 2);
    // y=0.12 sits above the plot pad surface (pad top = 0.1) to avoid z-fighting
    g.translate(gx * ROAD_CELL + ROAD_CELL / 2, 0.12, gz * ROAD_CELL + ROAD_CELL / 2);
    geos.push(g);
  }
  // mergeGeometries keeps one draw call for the whole road network
  import('three/addons/utils/BufferGeometryUtils.js').then(({ mergeGeometries }) => {
    const merged = mergeGeometries(geos);
    geos.forEach(g => g.dispose());
    if (!merged) return;
    const mesh = new THREE.Mesh(trackGeo(merged), m.roadStone);
    mesh.receiveShadow = true;
    mesh.name = 'builderRoads';
    mesh.renderOrder = 1;
    scene.add(mesh);
    roadsMesh.current = mesh;
    onChangeHook?.();
  });
}

function restoreRoads(keys) {
  roadCells.clear();
  for (const k of keys || []) roadCells.set(k, true);
  rebuildRoads();
}

// ===========================================================================
//  MATERIAL EDITING — clone-on-first-touch keeps the shared M() set safe
// ===========================================================================
function uniqueMats(root) {
  const seen = new Map();   // material -> mesh count
  root.traverse(o => {
    if (!o.isMesh && !o.isInstancedMesh) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      if (!m) continue;
      seen.set(m, (seen.get(m) || 0) + 1);
    }
  });
  return [...seen.keys()];
}

function matLabel(m) {
  if (m.userData?.builderLabel) return m.userData.builderLabel;
  for (const [key, label] of Object.entries(MAT_LABELS)) {
    if (m.name === key) return label;
  }
  // shared M() materials carry no name; identify by color+map heuristics is
  // unreliable, so fall back to a generic part name per index
  return '部件';
}

// The parts panel needs stable readable names; name each unique material once.
function nameParts(root) {
  const mats = uniqueMats(root);
  const used = new Set();
  mats.forEach((m, i) => {
    if (m.userData?.builderLabel) return;
    // try to resolve the shared-name via the M() singleton keys
    let label = null;
    const mset = M();
    for (const [k, v] of Object.entries(mset)) {
      if (v === m) { label = MAT_LABELS[k] || k; break; }
    }
    if (!label) label = `部件 ${i + 1}`;
    while (used.has(label)) label += '·';
    used.add(label);
    m.userData.builderLabel = label;
  });
  return mats;
}

function ensureCloned(mats) {
  const map = new Map();
  const mset = M();
  const shared = new Set(Object.values(mset).filter(v => v && v.isMaterial));
  return mats.map(m => {
    if (!shared.has(m)) return m;    // already an instance clone
    const c = m.clone();
    c.userData.builderLabel = m.userData?.builderLabel;
    map.set(m, c);
    return c;
  }).map(m => map.get(m) || m);
}

export function retargetMaterial(root, oldMat, newMat) {
  root.traverse(o => {
    if (!o.isMesh && !o.isInstancedMesh) return;
    if (Array.isArray(o.material)) {
      o.material = o.material.map(x => x === oldMat ? newMat : x);
    } else if (o.material === oldMat) {
      o.material = newMat;
    }
  });
}

export function applyColor(mat, hex) {
  mat.color.set(hex);
}

export function applyTexture(renderer, mat, texKey, repeat) {
  if (!texKey) {
    mat.map = null; mat.normalMap = null; mat.roughnessMap = null;
    mat.needsUpdate = true;
    return Promise.resolve(mat);
  }
  return loadSinglePBRSet(renderer, texKey).then(set => {
    if (!set) return mat;
    for (const kind of ['color', 'normal', 'rough']) {
      const t = set[kind]?.clone();
      if (!t) continue;
      t.needsUpdate = true;
      const r = repeat ?? 2;
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.repeat.set(r, r);
      if (kind === 'color') { t.colorSpace = THREE.SRGBColorSpace; mat.map = t; }
      if (kind === 'normal') mat.normalMap = t;
      if (kind === 'rough') mat.roughnessMap = t;
    }
    mat.needsUpdate = true;
    return mat;
  });
}

function applySavedMats(root, saved) {
  // saved: { partLabel: { color, texKey, repeat } }
  const mats = nameParts(root);
  const cloned = ensureCloned(mats);
  cloned.forEach((m, i) => {
    if (mats[i] !== m) retargetMaterial(root, mats[i], m);
  });
  for (const m of cloned) {
    const cfg = saved[m.userData.builderLabel];
    if (!cfg) continue;
    if (cfg.color) applyColor(m, cfg.color);
    if (cfg.texKey !== undefined) applyTexture(renderer, m, cfg.texKey, cfg.repeat);
  }
}

// ===========================================================================
//  PROPERTIES PANEL (right side, built with plain DOM)
// ===========================================================================
export function refreshPropsPanel() {
  const panel = document.getElementById('builderProps');
  if (!panel) return;
  panel.innerHTML = '';
  if (!selected) {
    panel.innerHTML = '<p class="props-empty">选中一个物件后<br>可在此调整材质</p>';
    return;
  }
  const def = PLACE_DEFS[selected.userData.builder.defKey];
  const title = document.createElement('h4');
  title.textContent = def?.label || '物件';
  panel.appendChild(title);

  const mats = nameParts(selected);
  const cloned = ensureCloned(mats);
  cloned.forEach((m, i) => { if (mats[i] !== m) retargetMaterial(selected, mats[i], m); });
  onChangeHook?.();

  for (const m of cloned) {
    const row = document.createElement('div');
    row.className = 'mat-row';
    const label = document.createElement('span');
    label.className = 'mat-name';
    label.textContent = m.userData.builderLabel;

    const color = COLOR_INPUT.cloneNode();
    color.value = '#' + m.color.getHexString();
    color.addEventListener('input', () => {
      applyColor(m, color.value);
      markDirty(); onChangeHook?.();
    });

    const texSel = document.createElement('select');
    texSel.className = 'mat-tex';
    texSel.add(new Option('无贴图', ''));
    for (const [key, entry] of Object.entries(PBR_CATALOG)) texSel.add(new Option(entry.label, key));
    const currentTex = m.map?.userData?.builderTexKey || m.userData?.builderTexKey || '';
    texSel.value = currentTex;
    texSel.addEventListener('change', () => {
      m.userData.builderTexKey = texSel.value;
      const rep = parseFloat(repeatSlider.value) || 2;
      applyTexture(renderer, m, texSel.value, rep).then(() => { markDirty(); onChangeHook?.(); });
    });

    const repeatSlider = document.createElement('input');
    repeatSlider.type = 'range';
    repeatSlider.min = '0.5'; repeatSlider.max = '8'; repeatSlider.step = '0.5';
    repeatSlider.value = String(m.map?.repeat?.x ?? 2);
    repeatSlider.title = '贴图密度';
    repeatSlider.addEventListener('input', () => {
      const r = parseFloat(repeatSlider.value);
      for (const t of [m.map, m.normalMap, m.roughnessMap]) {
        if (t) { t.repeat.set(r, r); t.needsUpdate = true; }
      }
      markDirty();
    });

    row.append(label, color, texSel, repeatSlider);
    panel.appendChild(row);
  }
}

// ===========================================================================
//  SAVE / LOAD (localStorage autosave, debounced)
// ===========================================================================
function serializeMats(root) {
  const out = {};
  for (const m of uniqueMats(root)) {
    if (!m.userData?.builderLabel) continue;
    out[m.userData.builderLabel] = {
      color: '#' + m.color.getHexString(),
      texKey: m.userData.builderTexKey ?? '',
      repeat: m.map?.repeat?.x ?? 2,
    };
  }
  return out;
}

function serialize() {
  return {
    version: 1,
    roads: [...roadCells.keys()],
    objects: builderObjects.map(o => ({
      def: o.userData.builder.defKey,
      x: +o.position.x.toFixed(2),
      z: +o.position.z.toFixed(2),
      rotY: +o.rotation.y.toFixed(3),
      scale: +o.scale.x.toFixed(3),
      mats: serializeMats(o),
    })),
  };
}

function markDirty() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 800);
}

export function saveNow() {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(serialize()));
  } catch (e) { console.warn('builder save failed', e); }
}

function loadLayout() {
  let data = null;
  try { data = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null'); } catch {}
  if (!data) return;
  restoreRoads(data.roads);
  for (const o of data.objects || []) {
    const root = spawnObject(o.def, o.x, o.z, o.rotY, o.scale, o.mats);
    if (root) root.rotation.y = o.rotY || 0;
  }
}

export function clearAll() {
  for (const o of [...builderObjects]) deleteObject(o);
  roadCells.clear();
  rebuildRoads();
  localStorage.removeItem(SAVE_KEY);
  onChangeHook?.();
}

// debug hook
export function builderDebug() {
  return { count: builderObjects.length, roads: roadCells.size, selected: selected?.userData?.builder?.defKey ?? null, tool, save: serialize() };
}
