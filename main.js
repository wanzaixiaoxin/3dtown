// ============================================================================
//  古镇漫游 — main.js  (renderer, controller, camera, HUD, minimap)
//  three@0.160.0 · ES modules · 1 unit = 1 meter
// ============================================================================
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CONFIG } from './config.js';
import { M, disposables, setPBRTextures } from './materials.js';
import {
  TOWN, colliders, ladders, walkableLanes, world as worldRef, env,
  buildWorld, setupEnvironment, applyTime, getExposure, getTimeLabel, getNightAmount,
  setEnvMaps, setWeatherMode, setFogEnabled,
} from './world.js';
import { spawnNPCs, updateNPCs, updateNPCVisibility, npcs, applyGait } from './npc.js';
import { updateWind, windUniforms, updateWaterfall, updateBoats, updateMist, updateRain, setRain } from './scenery.js';
import { preloadAssets, mixers } from './assets.js';
import { loadPBRTextures, loadHDRIOne, HDRI_FILES } from './textures.js';
import { createPost } from './postprocessing.js';
import { CITY_ZONES, updateDistrictLOD } from './districts.js';
import { buildTraffic, updateTraffic, trafficStats } from './traffic.js';
import {
  initBuilder, enterBuilder, exitBuilder, isBuilderEnabled,
  setTool, selectDef, setGizmoMode, refreshPropsPanel, clearAll,
  CATEGORIES, PLACE_DEFS, builderDebug,
} from './builder.js';

const REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// player config (walkSpeed is user-adjustable via settings)
const PLAYER = { ...CONFIG.player.physics };

// user settings (persisted) — 默认值来自配置
const settings = { ...CONFIG.player.settings };
const SETTINGS_KEY = 'guzhen-settings-v3';
function loadSettings() {
  try { Object.assign(settings, JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}')); } catch {}
  PLAYER.walkSpeed = settings.walkSpeed;
}
function saveSettings() {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch {}
}

function targetPixelRatio() {
  if (settings.comfort) return Math.min(window.devicePixelRatio, 1.5);
  const cap = settings.quality === 'high' ? 1.25 : settings.quality === 'medium' ? 0.85 : 0.75;
  return Math.min(window.devicePixelRatio, cap);
}

// ---------------------------------------------------------------------------
//  COMFORT MODE (防眩晕) — sharper picture, zero camera lag, no grain/vignette.
//  Applied on toggle and at boot; manual FOV slider changes still win after.
// ---------------------------------------------------------------------------
function applyComfort(on) {
  settings.comfort = on;
  onResize();
  // 2) no film grain / vignette (biggest flicker offenders)
  if (post?.grade) {
    post.grade.uniforms.uGrain.value = on ? 0 : 0.012;
    post.grade.uniforms.uVignette.value = on ? 0 : 0.22;
  }
  // 3) wider default FOV reduces tunnel vision — only when the user hasn't
  //    manually picked another value this session (boot applies before bindUI)
  if (on && !settings.fovTouched) {
    settings.fov = Math.max(settings.fov, 75);
    camera.fov = settings.fov;
    camera.updateProjectionMatrix();
    const fovEl = document.getElementById('fov');
    const fovVal = document.getElementById('fovVal');
    if (fovEl) fovEl.value = settings.fov;
    if (fovVal) fovVal.textContent = settings.fov;
  }
  saveSettings();
}

let renderer, scene, camera, clock, orbit, world, post;
let pointerLocked = false;
let skipMouse = 0;
const keys = Object.create(null);
let view = 'top';
let running = false;
let currentTime = 'noon';

// 航拍巡航状态：auto=true 沿预设航线自动飞行，任意输入切回手动
const air = {
  yaw: Math.PI * 0.25, pitch: -0.42,
  pos: new THREE.Vector3(140, 120, 140),
  auto: true, t: 0, speed: 26,
};

const player = {
  pos: new THREE.Vector3(0, 0, 14),
  vel: new THREE.Vector3(),
  onGround: true, climbing: false,
  yaw: Math.PI, pitch: 0.0, lookYaw: Math.PI, lookPitch: 0.0, currentLadder: null,
};

// scratch
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3();
const _fpEye = new THREE.Vector3(), _fpDir = new THREE.Vector3();

// ===========================================================================
//  BOOT
// ===========================================================================
async function init() {
  loadSettings();

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0xc8d8e2);
  clock = new THREE.Clock();

  initRenderer();
  initCamera();

  setupEnvironment(scene);       // lights + sky + fog

  const loadText = document.getElementById('loadText');
  const envMaps = {};            // time key -> PMREM environment texture
  // 1) CC0 PBR textures (ambientCG) — must be ready before materials are built
  try {
    if (loadText) loadText.textContent = '正在载入 PBR 材质…';
    const pbr = await loadPBRTextures(renderer);
    setPBRTextures(pbr);
    // 2) HDRI environments (Poly Haven) for image-based lighting / reflections
    if (loadText) loadText.textContent = '正在载入天空环境…';
    // load only the current time-of-day HDRI first (fast first paint)
    const first = await loadHDRIOne(renderer, currentTime);
    if (first) envMaps[currentTime] = first;
    setEnvMaps(envMaps);
  } catch (e) { console.warn('PBR/HDRI load failed, using procedural fallback', e); }

  // 3) Third-party FBX models (Quaternius CC0)
  let assets = null;
  try {
    assets = await preloadAssets((pct, key) => {
      if (loadText) loadText.textContent = `正在载入模型… ${Math.round(pct * 100)}%`;
    });
  } catch (e) { console.warn('asset preload failed, falling back to procedural', e); }

  world = buildWorld(scene, assets);   // geometry (+ placed FBX buildings/props)
  buildTraffic(scene);                  // modern roads, signals and live vehicles
  spawnNPCs(scene, assets);            // animated villagers + animals
  window.__townAssets = assets;        // builder reads FBX templates from here
  applyTime(currentTime);
  renderer.toneMappingExposure = getExposure();
  document.querySelectorAll('[data-time]').forEach(b => b.classList.toggle('active', b.dataset.time === currentTime));

  initOrbit();
  frameTopDown();
  bindUI();
  initBuilder({
    scene, camera, renderer, orbit,
    onChange: () => { renderer.shadowMap.needsUpdate = true; },
  });
  bindBuilderUI();
  post = createPost(renderer, scene, camera, settings.quality);
  post.setQuality(settings.quality);
  if (settings.comfort) applyComfort(true);   // boot-time comfort restore (after post exists)
  onResize();
  window.addEventListener('resize', onResize);

  updateHUD();
  const loader = document.getElementById('loader');
  if (loader) { loader.style.opacity = '0'; setTimeout(() => loader.remove(), 600); }

  renderer.setAnimationLoop(animate);

  // lazy-load the remaining HDRIs in the background
  (async () => {
    for (const key of Object.keys(HDRI_FILES)) {
      if (envMaps[key]) continue;
      const tex = await loadHDRIOne(renderer, key);
      if (tex) envMaps[key] = tex;
    }
    // if the user switched time while loading, refresh the environment
    applyTime(currentTime);
  })();
}

function initRenderer() {
  renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(targetPixelRatio());
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.autoUpdate = false;
  renderer.shadowMap.needsUpdate = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  document.getElementById('app').appendChild(renderer.domElement);
}

function initCamera() {
  camera = new THREE.PerspectiveCamera(settings.fov, window.innerWidth / window.innerHeight, 0.1, 1500);
  camera.position.set(0, 48, 52);
  camera.lookAt(0, 0, 0);
}

function initOrbit() {
  orbit = new OrbitControls(camera, renderer.domElement);
  orbit.enableDamping = true;
  orbit.dampingFactor = 0.08;
  orbit.minDistance = 20;
  orbit.maxDistance = 1200;
  orbit.maxPolarAngle = Math.PI / 2.12;
  orbit.minPolarAngle = 0.12;
  orbit.target.set(0, 0, 0);
  orbit.enabled = true;
  orbit.update();
}

// ===========================================================================
//  UI
// ===========================================================================
function bindUI() {
  // view
  document.getElementById('btnTop').addEventListener('click', () => setView('top'));
  document.getElementById('btnFp').addEventListener('click', () => setView('fp'));
  document.getElementById('btnAir').addEventListener('click', () => setView('air'));

  // time of day
  document.querySelectorAll('[data-time]').forEach(btn => {
    btn.addEventListener('click', () => {
      currentTime = btn.dataset.time;
      applyTime(currentTime);
      renderer.shadowMap.needsUpdate = true;
      document.querySelectorAll('[data-time]').forEach(b => b.classList.toggle('active', b === btn));
      renderer.toneMappingExposure = getExposure();
      updateHUD();
    });
  });

  // settings drawer
  const panel = document.getElementById('settings');
  document.getElementById('btnSettings').addEventListener('click', () => panel.classList.toggle('show'));
  document.getElementById('btnSettingsBack').addEventListener('click', () => panel.classList.remove('show'));

  const sens = document.getElementById('sens');
  const sensVal = document.getElementById('sensVal');
  sens.value = settings.sensitivity; sensVal.textContent = settings.sensitivity.toFixed(1);
  sens.addEventListener('input', () => {
    settings.sensitivity = parseFloat(sens.value);
    sensVal.textContent = settings.sensitivity.toFixed(1);
    saveSettings();
  });

  const fov = document.getElementById('fov');
  const fovVal = document.getElementById('fovVal');
  fov.value = settings.fov; fovVal.textContent = settings.fov;
  fov.addEventListener('input', () => {
    settings.fov = parseFloat(fov.value);
    settings.fovTouched = true;   // comfort mode no longer overrides FOV
    fovVal.textContent = settings.fov;
    camera.fov = settings.fov; camera.updateProjectionMatrix();
    saveSettings();
  });

  const spd = document.getElementById('spd');
  const spdVal = document.getElementById('spdVal');
  spd.value = settings.walkSpeed; spdVal.textContent = settings.walkSpeed.toFixed(1);
  spd.addEventListener('input', () => {
    settings.walkSpeed = parseFloat(spd.value);
    PLAYER.walkSpeed = settings.walkSpeed;
    spdVal.textContent = settings.walkSpeed.toFixed(1);
    saveSettings();
  });

  // weather selector
  const wbtns = document.querySelectorAll('[data-weather]');
  const wval = document.getElementById('weatherVal');
  function applyWeather(mode) {
    settings.weather = mode;
    setWeatherMode(mode);
    setRain(mode === 'rain');
    wbtns.forEach(b => b.classList.toggle('active', b.dataset.weather === mode));
    if (wval) wval.textContent = mode === 'rain' ? '雨' : '晴';
    renderer.toneMappingExposure = getExposure() * (mode === 'rain' ? 0.88 : 1);
    saveSettings();
  }
  wbtns.forEach(b => b.addEventListener('click', () => applyWeather(b.dataset.weather)));
  applyWeather(settings.weather);

  // quality selector
  const qbtns = document.querySelectorAll('[data-quality]');
  const qval = document.getElementById('qualityVal');
  function applyQuality(q) {
    settings.quality = q;
    if (post) post.setQuality(q);
    qbtns.forEach(b => b.classList.toggle('active', b.dataset.quality === q));
    const label = { high: '高', medium: '中', low: '低' }[q] || q;
    if (qval) qval.textContent = label;
    saveSettings();
    onResize();
  }
  qbtns.forEach(b => b.addEventListener('click', () => applyQuality(b.dataset.quality)));
  applyQuality(settings.quality);

  const showFps = document.getElementById('showFps');
  const fpsReadout = document.getElementById('fpsReadout');
  showFps.checked = settings.showFps !== false;
  fpsReadout.hidden = !showFps.checked;
  showFps.addEventListener('change', () => {
    settings.showFps = showFps.checked;
    fpsReadout.hidden = !showFps.checked;
    saveSettings();
  });

  const inv = document.getElementById('invertY');
  inv.checked = settings.invertY;
  inv.addEventListener('change', () => { settings.invertY = inv.checked; saveSettings(); });

  const fog = document.getElementById('fogEnabled');
  fog.checked = settings.fog;
  setFogEnabled(settings.fog);
  fog.addEventListener('change', () => {
    settings.fog = fog.checked;
    setFogEnabled(settings.fog);
    saveSettings();
  });

  // comfort mode (防眩晕)
  const comfort = document.getElementById('comfortMode');
  comfort.checked = settings.comfort;
  comfort.addEventListener('change', () => {
    applyComfort(comfort.checked);
    renderer.shadowMap.needsUpdate = true;
  });

  // keyboard
  window.addEventListener('keydown', (e) => {
    keys[e.code] = true;
    if (e.code === 'KeyV' && !isBuilderEnabled()) toggleView();
    if (e.code === 'KeyB') toggleBuilder();
    if (['Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.code)) e.preventDefault();
  });
  window.addEventListener('keyup', (e) => { keys[e.code] = false; });

  // pointer lock for FP mouse-look
  const canvas = renderer.domElement;
  canvas.addEventListener('click', () => {
    if (view === 'fp' && !pointerLocked) canvas.requestPointerLock?.();
  });
  document.addEventListener('pointerlockchange', () => {
    pointerLocked = document.pointerLockElement === canvas;
    if (pointerLocked) skipMouse = 12;   // swallow the lock-acquisition jump
  });
  document.addEventListener('mousemove', (e) => {
    if (view !== 'fp' || !pointerLocked) return;
    if (skipMouse > 0) { skipMouse--; return; }
    const s = settings.sensitivity * 0.0016;
    player.yaw -= e.movementX * s;
    player.pitch += (settings.invertY ? 1 : -1) * e.movementY * s;
    player.pitch = Math.max(-1.45, Math.min(1.45, player.pitch));
  });
}

// ===========================================================================
//  BUILDER UI (我的城市) — asset grid, tools, props panel are static DOM;
//  this wires events and populates the asset grid from PLACE_DEFS.
// ===========================================================================
let activeCategory = 'buildings';

function bindBuilderUI() {
  document.getElementById('btnBuild').addEventListener('click', () => toggleBuilder());

  const tabs = document.getElementById('builderTabs');
  const grid = document.getElementById('builderAssets');

  function renderGrid() {
    grid.innerHTML = '';
    for (const [key, def] of Object.entries(PLACE_DEFS)) {
      if (def.category !== activeCategory) continue;
      const b = document.createElement('button');
      b.className = 'btn asset-btn';
      b.dataset.def = key;
      b.textContent = def.label;
      b.addEventListener('click', () => { selectDef(key); });
      grid.appendChild(b);
    }
  }
  for (const cat of CATEGORIES) {
    const b = document.createElement('button');
    b.className = 'btn' + (cat.key === activeCategory ? ' active' : '');
    b.textContent = cat.label;
    b.addEventListener('click', () => {
      activeCategory = cat.key;
      tabs.querySelectorAll('.btn').forEach(x => x.classList.toggle('active', x === b));
      renderGrid();
    });
    tabs.appendChild(b);
  }
  renderGrid();

  document.querySelectorAll('#builderTools .tool-btn[data-tool]').forEach(b => {
    b.addEventListener('click', () => setTool(b.dataset.tool));
  });
  document.getElementById('btnBuilderExit').addEventListener('click', () => toggleBuilder());
  document.getElementById('btnBuilderClear').addEventListener('click', () => {
    if (confirm('清空所有已放置的物件与道路？')) clearAll();
  });
}

function toggleBuilder() {
  if (!isBuilderEnabled()) {
    if (document.pointerLockElement) document.exitPointerLock();
    enterBuilder();
    if (view !== 'top') setView('top');           // editor is top-down
    orbit.enabled = true;                          // setView('fp') would disable it
    refreshPropsPanel();
  } else {
    exitBuilder();
  }
}

// ===========================================================================
//  VIEW SWITCH
// ===========================================================================
function toggleView() {
  // V 键三态循环：俯视 → 第一人称 → 航拍 → 俯视
  setView(view === 'top' ? 'fp' : view === 'fp' ? 'air' : 'top');
}

function setView(v) {
  view = v;
  document.getElementById('btnTop').classList.toggle('active', v === 'top');
  document.getElementById('btnFp').classList.toggle('active', v === 'fp');
  const btnAir = document.getElementById('btnAir');
  if (btnAir) btnAir.classList.toggle('active', v === 'air');
  document.body.classList.toggle('fp', v === 'fp');

  if (v === 'top') {
    orbit.enabled = true;
    if (document.pointerLockElement) document.exitPointerLock();
    if (!isBuilderEnabled()) frameTopDown();
  } else if (v === 'air') {
    // 航拍：从当前相机位平滑接管，自动巡航；松开所有移动键避免残留速度
    for (const k of Object.keys(keys)) keys[k] = false;
    if (document.pointerLockElement) document.exitPointerLock();
    orbit.enabled = false;
    const pos = camera.position;
    // 相机太高或太远时，回落到城市上空合适的巡航高度
    if (pos.y < 30 || pos.y > 260 || Math.hypot(pos.x, pos.z) > 420) {
      air.pos.set(140, 120, 140);
      air.yaw = Math.PI * 0.25; air.pitch = -0.38;
    } else {
      air.pos.copy(pos);
      // 从 orbit 视角反推朝向，保持视线连续
      const dir = new THREE.Vector3();
      camera.getWorldDirection(dir);
      air.yaw = Math.atan2(-dir.x, -dir.z);
      air.pitch = Math.asin(THREE.MathUtils.clamp(dir.y, -1, 1));
    }
    air.auto = true; air.t = 0;
  } else {
    orbit.enabled = false;
    player.climbing = false;
    player.lookYaw = player.yaw;
    player.lookPitch = player.pitch;
    player.vel.set(0, 0, 0);
    if (player.pos.y > 3) player.pos.set(player.pos.x, 0, player.pos.z);
  }
  updateHUD();
}

function frameTopDown() {
  const box = new THREE.Box3().setFromObject(world);
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  const radius = Math.max(sphere.radius, 25);
  const fov = THREE.MathUtils.degToRad(camera.fov);
  const dist = Math.min((radius * 1.05) / Math.sin(fov / 2), 950);
  const center = sphere.center;
  orbit.target.copy(center);
  const dir = new THREE.Vector3(0, 0.82, 0.6).normalize();
  camera.position.copy(center).addScaledVector(dir, dist);
  camera.lookAt(center);
  orbit.update();
}

// ===========================================================================
//  COLLISION / GROUND
// ===========================================================================
function resolveCollisions(next) {
  const r = PLAYER.radius;
  for (const c of colliders) {
    if (c.water) continue; // handled separately (block at water level)
    if (next.y > c.top - 0.2) continue; // standing above it
    const cx = Math.max(c.minX, Math.min(next.x, c.maxX));
    const cz = Math.max(c.minZ, Math.min(next.z, c.maxZ));
    const dx = next.x - cx, dz = next.z - cz;
    const d2 = dx*dx + dz*dz;
    if (d2 < r*r) {
      if (d2 < 1e-6) {
        // degenerate: player center exactly inside box — push out via nearest face
        const left = next.x - c.minX, right = c.maxX - next.x;
        const front = next.z - c.minZ, back = c.maxZ - next.z;
        const m = Math.min(left, right, front, back);
        if (m === left) next.x = c.minX - r;
        else if (m === right) next.x = c.maxX + r;
        else if (m === front) next.z = c.minZ - r;
        else next.z = c.maxZ + r;
        continue;
      }
      const d = Math.sqrt(d2);
      const push = (r - d) / d;
      next.x += dx * push; next.z += dz * push;
    }
  }
  // water: block entry (treat as round obstacle)
  for (const c of colliders) {
    if (!c.water) continue;
    if (next.y > 0.6) continue;
    const cx = (c.minX + c.maxX)/2, cz = (c.minZ + c.maxZ)/2;
    const rr = (c.maxX - c.minX)/2 - 0.4;
    const dx = next.x - cx, dz = next.z - cz;
    const d = Math.hypot(dx, dz);
    if (d < rr + PLAYER.radius) {
      const push = (rr + PLAYER.radius - d) / (d || 0.0001);
      next.x += dx * push; next.z += dz * push;
    }
  }
  const lim = TOWN.half - 2;
  next.x = Math.max(-lim, Math.min(lim, next.x));
  next.z = Math.max(-lim, Math.min(lim, next.z));
}

function groundHeightAt(x, z, curY) {
  let top = 0;
  for (const c of colliders) {
    if (c.water) continue;
    if (x > c.minX - PLAYER.radius && x < c.maxX + PLAYER.radius &&
        z > c.minZ - PLAYER.radius && z < c.maxZ + PLAYER.radius) {
      if (curY >= c.top - 0.4 && c.top > top) top = c.top;
    }
  }
  return top;
}

// ===========================================================================
//  PLAYER PHYSICS
// ===========================================================================
function updatePlayer(dt) {
  if (isBuilderEnabled()) return;   // frozen during build mode
  if (view === 'air') { updateHUD(); return; }   // 航拍时相机由 updateAirCamera 驱动
  const forward = _v1.set(-Math.sin(player.yaw), 0, -Math.cos(player.yaw));
  const right = _v2.set(Math.cos(player.yaw), 0, -Math.sin(player.yaw));
  const wish = new THREE.Vector3();
  if (keys['KeyW'] || keys['ArrowUp']) wish.add(forward);
  if (keys['KeyS'] || keys['ArrowDown']) wish.sub(forward);
  if (keys['KeyD'] || keys['ArrowRight']) wish.add(right);
  if (keys['KeyA'] || keys['ArrowLeft']) wish.sub(right);
  const moving = wish.lengthSq() > 1e-4;
  if (moving) wish.normalize();
  running = !!(keys['ShiftLeft'] || keys['ShiftRight']);

  // ladder detection
  let near = null;
  for (const l of ladders) {
    const dx = player.pos.x - l.x, dz = player.pos.z - l.z;
    if (dx*dx + dz*dz < 1.9) { near = l; break; }
  }
  if (near && !player.climbing && keys['KeyW'] && player.pos.y < near.topY - 0.2) {
    player.climbing = true; player.currentLadder = near; player.vel.set(0,0,0);
  }

  if (player.climbing && player.currentLadder) {
    const l = player.currentLadder;
    player.pos.x += (l.x - player.pos.x) * Math.min(1, dt*9);
    player.pos.z += (l.z - player.pos.z) * Math.min(1, dt*9);
    player.vel.y = 0;
    if (keys['KeyW']) player.pos.y += PLAYER.climbSpeed * dt;
    if (keys['KeyS']) player.pos.y -= PLAYER.climbSpeed * dt;
    if (player.pos.y >= l.topY - 0.08) {
      player.pos.y = l.topY; player.climbing = false;
      player.pos.x = l.topLanding.x; player.pos.z = l.topLanding.z;
      player.currentLadder = null; player.onGround = true;
    }
    if (player.pos.y <= 0.03 && keys['KeyS']) {
      player.pos.y = 0; player.climbing = false; player.currentLadder = null;
    }
    updateHUD();
    return;
  }

  // horizontal
  const speed = (running ? PLAYER.runSpeed : PLAYER.walkSpeed) * (getNightAmount() > 0.5 ? 0.9 : 1);
  const accel = player.onGround ? 9 : 4;
  player.vel.x += (wish.x * speed - player.vel.x) * Math.min(1, accel * dt);
  player.vel.z += (wish.z * speed - player.vel.z) * Math.min(1, accel * dt);
  // deadzone: kill tiny residual velocity so the camera never drifts on its own
  if (!moving) {
    if (Math.abs(player.vel.x) < 0.08) player.vel.x = 0;
    if (Math.abs(player.vel.z) < 0.08) player.vel.z = 0;
  }

  if (keys['Space'] && player.onGround) { player.vel.y = PLAYER.jumpSpeed; player.onGround = false; }
  player.vel.y -= PLAYER.gravity * dt;

  const next = player.pos.clone();
  next.x += player.vel.x * dt; next.z += player.vel.z * dt;
  resolveCollisions(next);
  player.pos.x = next.x; player.pos.z = next.z;
  player.pos.y += player.vel.y * dt;

  const floor = groundHeightAt(player.pos.x, player.pos.z, player.pos.y);
  if (player.pos.y <= floor) { player.pos.y = floor; player.vel.y = 0; player.onGround = true; }
  else player.onGround = false;

  if (player.pos.y < -6) { player.pos.set(0, 0, 14); player.vel.set(0,0,0); }
  updateHUD();
}

// ===========================================================================
//  CAMERA
// ===========================================================================
function updateCamera(dt) {
  if (view === 'fp') {
    // comfort mode: mouse look snaps 1:1 (zero smoothing — reduces sim sickness)
    const blend = (REDUCED_MOTION || settings.comfort) ? 1 : 1 - Math.exp(-dt * 18);
    const yawDelta = Math.atan2(
      Math.sin(player.yaw - player.lookYaw),
      Math.cos(player.yaw - player.lookYaw),
    );
    player.lookYaw += yawDelta * blend;
    player.lookPitch += (player.pitch - player.lookPitch) * blend;
    _fpEye.set(player.pos.x, player.pos.y + PLAYER.eyeHeight, player.pos.z);
    camera.position.copy(_fpEye);
    _fpDir.set(
      -Math.sin(player.lookYaw) * Math.cos(player.lookPitch),
      Math.sin(player.lookPitch),
      -Math.cos(player.lookYaw) * Math.cos(player.lookPitch)
    );
    camera.lookAt(_fpEye.x + _fpDir.x, _fpEye.y + _fpDir.y, _fpEye.z + _fpDir.z);
  } else if (view === 'air') {
    updateAirCamera(dt);
  } else {
    orbit.update();
  }
}

// ---------------------------------------------------------------------------
//  航拍巡航：auto 模式沿平滑环线绕城飞行（视线扫过各功能区）；
//  任意 WASD/QE/鼠标输入立即切手动，2s 无输入后恢复自动。
// ---------------------------------------------------------------------------
const AIR_CITY_R = 180;          // 环线半径（覆盖内环全部街坊）
const AIR_HEIGHT = 95;           // 巡航基准高度
function updateAirCamera(dt) {
  const wish = _v1.set(0, 0, 0);
  const forward = _v2.set(-Math.sin(air.yaw), 0, -Math.cos(air.yaw));
  const right = _v2.clone().set(Math.cos(air.yaw), 0, -Math.sin(air.yaw));
  let input = false;
  if (keys['KeyW'] || keys['ArrowUp']) { wish.add(forward); input = true; }
  if (keys['KeyS'] || keys['ArrowDown']) { wish.sub(forward); input = true; }
  if (keys['KeyD'] || keys['ArrowRight']) { wish.add(right); input = true; }
  if (keys['KeyA'] || keys['ArrowLeft']) { wish.sub(right); input = true; }
  let vy = 0;
  if (keys['Space']) { vy += 1; input = true; }
  if (keys['KeyC'] || keys['ShiftLeft'] && keys['KeyC']) { vy -= 1; input = true; }
  if (keys['ShiftLeft'] || keys['ShiftRight']) input = true;  // shift 加速

  if (input) {
    if (air.auto) { air.auto = false; air.pos.copy(camera.position); }
    air.idle = 0;
  } else if (!air.auto) {
    air.idle = (air.idle || 0) + dt;
    if (air.idle > 2) { air.auto = true; air.t = 0; }
  }

  const speed = air.speed * ((keys['ShiftLeft'] || keys['ShiftRight']) ? 2.2 : 1);
  if (air.auto) {
    // 自动航线：绕城缓飞 + 缓慢升降，机头始终朝前进方向略下倾
    air.t += dt * 0.04;
    const a = air.t * Math.PI * 2;
    const r = AIR_CITY_R + Math.sin(air.t * Math.PI * 3) * 25;
    const targetX = Math.cos(a) * r;
    const targetZ = Math.sin(a) * r;
    const targetY = AIR_HEIGHT + Math.sin(air.t * Math.PI * 5) * 18;
    // 平滑追随航线点（似无人机跟拍）
    const k = Math.min(1, dt * 0.9);
    air.pos.x += (targetX - air.pos.x) * k;
    air.pos.z += (targetZ - air.pos.z) * k;
    air.pos.y += (targetY - air.pos.y) * k;
    // 朝向 = 航线切线方向 + 轻微下倾看城
    const tx = -Math.sin(a) * r, tz = Math.cos(a) * r;
    const targetYaw = Math.atan2(-tx, -tz);
    const targetPitch = -0.34;
    air.yaw += shortAngle(air.yaw, targetYaw) * Math.min(1, dt * 1.2);
    air.pitch += (targetPitch - air.pitch) * Math.min(1, dt * 1.2);
  } else {
    // 手动飞行：惯性平移 + 升降
    const moving = wish.lengthSq() > 1e-4;
    if (moving) wish.normalize();
    air.pos.addScaledVector(wish, speed * dt);
    air.pos.y = Math.max(12, Math.min(320, air.pos.y + vy * speed * 0.7 * dt));
    // 城界软约束：飞太远缓缓拉回
    const dist = Math.hypot(air.pos.x, air.pos.z);
    if (dist > 430) {
      air.pos.x *= 430 / dist; air.pos.z *= 430 / dist;
    }
  }
  camera.position.copy(air.pos);
  _fpDir.set(
    -Math.sin(air.yaw) * Math.cos(air.pitch),
    Math.sin(air.pitch),
    -Math.cos(air.yaw) * Math.cos(air.pitch)
  );
  camera.lookAt(air.pos.x + _fpDir.x, air.pos.y + _fpDir.y, air.pos.z + _fpDir.z);
}

function shortAngle(from, to) {
  return Math.atan2(Math.sin(to - from), Math.cos(to - from));
}

// ===========================================================================
//  HUD + MINIMAP
// ===========================================================================
let fpsAccum = 0, fpsFrames = 0;
const minimap = document.getElementById('minimap');
const mmCtx = minimap.getContext('2d');
let mmFrame = 0;

function updateHUD() {
  document.getElementById('statMode').textContent = view === 'top' ? '俯视' : view === 'air' ? '航拍' : '第一人称';
  document.getElementById('statTime').textContent = getTimeLabel();
  let state = '驻足';
  if (view === 'air') state = air.auto ? '自动巡航' : '手动飞行';
  else if (player.climbing) state = '攀爬';
  else if (!player.onGround) state = '跳跃';
  else if (running && (Math.abs(player.vel.x)+Math.abs(player.vel.z) > 0.5)) state = '奔跑';
  else if (Math.abs(player.vel.x)+Math.abs(player.vel.z) > 0.3) state = '行走';
  document.getElementById('statState').textContent = state;
  document.getElementById('statY').textContent = view === 'air' ? air.pos.y.toFixed(1) : player.pos.y.toFixed(1);
  document.getElementById('statNpc').textContent = npcs.length;
}

function drawMinimap() {
  const W = minimap.width, H = minimap.height;
  const cx = W/2, cy = H/2;
  const scale = (W/2 - 8) / TOWN.half;
  mmCtx.clearRect(0, 0, W, H);

  // background
  mmCtx.fillStyle = '#26301d';
  mmCtx.fillRect(0, 0, W, H);

  const toX = (x) => cx + x * scale;
  const toY = (z) => cy + z * scale;

  // districts and roads
  mmCtx.globalAlpha = 0.35;
  for (const zone of CITY_ZONES) {
    mmCtx.fillStyle = zone.color;
    mmCtx.fillRect(toX(zone.x - zone.w / 2), toY(zone.z - zone.d / 2), zone.w * scale, zone.d * scale);
  }
  mmCtx.globalAlpha = 1;
  for (const lane of walkableLanes) {
    mmCtx.strokeStyle = '#807363';
    mmCtx.lineWidth = Math.max(1, lane.half * 2 * scale);
    mmCtx.beginPath();
    if (lane.type === 'h') {
      mmCtx.moveTo(toX(-TOWN.half), toY(lane.offset || 0));
      mmCtx.lineTo(toX(TOWN.half), toY(lane.offset || 0));
    } else {
      mmCtx.moveTo(toX(lane.offset || 0), toY(-TOWN.half));
      mmCtx.lineTo(toX(lane.offset || 0), toY(TOWN.half));
    }
    mmCtx.stroke();
  }

  // pond
  mmCtx.fillStyle = '#3a6478';
  mmCtx.beginPath(); mmCtx.arc(toX(-16), toY(16), 7*scale, 0, Math.PI*2); mmCtx.fill();

  // plaza
  mmCtx.fillStyle = '#5a5548';
  mmCtx.beginPath(); mmCtx.arc(cx, cy, 11*scale, 0, Math.PI*2); mmCtx.fill();

  // buildings (from colliders of kind house)
  mmCtx.fillStyle = '#8a7a66';
  for (const c of colliders) {
    if (c.kind !== 'house') continue;
    const w = (c.maxX - c.minX) * scale, h = (c.maxZ - c.minZ) * scale;
    mmCtx.fillRect(toX(c.minX), toY(c.minZ), w, h);
  }
  // walls — four sides, each split into two segments leaving the gate gap
  mmCtx.strokeStyle = '#a89a86'; mmCtx.lineWidth = 2;
  const Hm = TOWN.half, g = 5;   // gate half-width (10m gap centred on lanes)
  const seg = (x1, z1, x2, z2) => { mmCtx.beginPath(); mmCtx.moveTo(toX(x1), toY(z1)); mmCtx.lineTo(toX(x2), toY(z2)); mmCtx.stroke(); };
  seg(-Hm, Hm, -g, Hm); seg(g, Hm, Hm, Hm);           // south (gate at z=H)
  seg(-Hm, -Hm, -g, -Hm); seg(g, -Hm, Hm, -Hm);       // north
  seg(Hm, -Hm, Hm, -g); seg(Hm, g, Hm, Hm);           // east
  seg(-Hm, -Hm, -Hm, -g); seg(-Hm, g, -Hm, Hm);       // west

  // NPCs
  for (const n of npcs) {
    mmCtx.fillStyle = (n.type === 'villager') ? '#7fd0e8' : '#e06b5a';
    mmCtx.beginPath(); mmCtx.arc(toX(n.pos.x), toY(n.pos.z), 2, 0, Math.PI*2); mmCtx.fill();
  }

  // player with facing arrow
  const px = toX(player.pos.x), py = toY(player.pos.z);
  mmCtx.save();
  mmCtx.translate(px, py);
  mmCtx.rotate(-player.yaw + Math.PI);
  mmCtx.fillStyle = '#e8b23b';
  mmCtx.beginPath();
  mmCtx.moveTo(0, -5); mmCtx.lineTo(3.5, 4); mmCtx.lineTo(0, 2); mmCtx.lineTo(-3.5, 4);
  mmCtx.closePath(); mmCtx.fill();
  mmCtx.restore();
  // player ring
  mmCtx.strokeStyle = 'rgba(232,178,59,0.5)'; mmCtx.lineWidth = 1;
  mmCtx.beginPath(); mmCtx.arc(px, py, 7, 0, Math.PI*2); mmCtx.stroke();
}

// ===========================================================================
//  LOOP
// ===========================================================================
function animate() {
  const rawDt = clock.getDelta();
  const dt = Math.min(rawDt, 0.1);

  fpsFrames++; fpsAccum += rawDt;
  if (fpsAccum >= 0.5) {
    document.getElementById('statFps').textContent = Math.round(fpsFrames / fpsAccum);
    fpsFrames = 0; fpsAccum = 0;
  }

  updatePlayer(dt);
  updateNPCs(dt, getNightAmount());
  updateNPCVisibility(camera);
  updateDistrictLOD(camera);
  updateTraffic(dt, npcs, getNightAmount());
  updateWind(clock.elapsedTime);
  // clouds drift (env.cloudDrift set by setupEnvironment)
  if (env?.cloudDrift) env.cloudDrift(dt);
  updateWaterfall(dt);
  updateBoats(clock.elapsedTime);
  updateMist(clock.elapsedTime);
  updateRain(camera);
  updateCamera(dt);

  // minimap at ~15fps
  mmFrame += dt;
  if (mmFrame > 0.066) { drawMinimap(); mmFrame = 0; }

  if (post) post.render(dt);
  else renderer.render(scene, camera);
}

function onResize() {
  const w = window.innerWidth, h = window.innerHeight;
  camera.aspect = w / h; camera.updateProjectionMatrix();
  renderer.setPixelRatio(targetPixelRatio());
  renderer.setSize(w, h);
  if (post) { post.setSize(w, h); }
}

// ===========================================================================
//  TEARDOWN
// ===========================================================================
window.__disposeTown = function () {
  renderer.setAnimationLoop(null);
  scene.traverse(o => {
    if (o.isMesh || o.isInstancedMesh) {
      o.geometry?.dispose?.();
      if (Array.isArray(o.material)) o.material.forEach(x => x.dispose?.()); else o.material?.dispose?.();
    }
  });
  disposables.geometries.forEach(g => g.dispose?.());
  disposables.materials.forEach(m => m.dispose?.());
  orbit?.dispose?.();
  renderer.dispose();
};

// debug hook for automated verification
window.__THREE = THREE; Object.defineProperty(window,'__renderer',{get:()=>renderer}); Object.defineProperty(window,'__post',{get:()=>post}); window.__wind = windUniforms; window.__traffic = trafficStats; window.__gait = applyGait; window.__setPost = (v)=>{ post = v; }; window.__town = { player, ladders, colliders, npcs, setView, applyTime, toggleBuilder, isBuilderEnabled, builderDebug, get view(){ return view; }, get camera(){ return camera; }, get scene(){ return scene; }, get world(){ return world; } };

// ===========================================================================
init().catch((e) => {
  console.error('init failed:', e);
  const fb = document.getElementById('fallback'), ld = document.getElementById('loader');
  if (ld) ld.style.display = 'none';
  if (fb) {
    fb.style.display = 'grid';
    fb.querySelector('p').textContent = `古镇初始化失败：${e.message}。请刷新页面后重试。`;
  }
});
