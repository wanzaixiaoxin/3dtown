import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { loadFBX, instantiate, MODEL_SPECS, CHARACTER_PARTS, applyCharacterColors } from './assets.js';
import { CONFIG } from './config.js';
import { applyGait, createGaitState } from './npc.js';

const MODEL_CATEGORIES = new Set(['npc', 'people', 'buildings', 'objects']);
const TEXTURE_BASE = './assets/free_resources/polyhaven/textures/';
const HDRI_BASE = './assets/free_resources/polyhaven/hdri/';

const TEXTURE_SETS = {
  cobblestone_02:       { name: '青石板', desc: '街面 / 湿石板', source: 'Poly Haven · CC0' },
  brick_pavement_03:    { name: '砖铺地面', desc: '庭院 / 巷道', source: 'Poly Haven · CC0' },
  clean_pebbles:        { name: '卵石', desc: '池底 / 浅水区', source: 'Poly Haven · CC0' },
  grey_roof_tiles:      { name: '黛色筒瓦', desc: '民居屋顶', source: 'Poly Haven · CC0' },
  clay_roof_tiles_02:   { name: '陶瓦', desc: '楼阁屋顶', source: 'Poly Haven · CC0' },
  beige_wall_001:       { name: '白灰墙', desc: '墙面 / 做旧', source: 'Poly Haven · CC0' },
  japanese_cedar_planks:{ name: '老木板材', desc: '梁柱 / 门窗', source: 'Poly Haven · CC0' },
  chinese_cedar_bark:   { name: '杉树皮', desc: '树干近景', source: 'Poly Haven · CC0' },
  brick_moss_001:       { name: '苔藓青砖', desc: '假山 / 石阶', source: 'Poly Haven · CC0' },
  granite_tile_02:      { name: '花岗岩', desc: '台基 / 驳岸', source: 'Poly Haven · CC0' },
};

const HDRI_SETS = {
  qwantani_dusk_2_puresky: { name: '黄昏 · 纯天空', desc: '日落 / 暖橙', source: 'Poly Haven · CC0' },
  twilight_sunset:          { name: '暮色', desc: '暮光 / 紫蓝', source: 'Poly Haven · CC0' },
  aarfontein_dawn_2:        { name: '蓝调时刻', desc: '黎明 / 薄雾', source: 'Poly Haven · CC0' },
  courtyard_night:          { name: '月夜庭院', desc: '夜晚 / 月光', source: 'Poly Haven · CC0' },
};

const CATALOG = {
  npc: {
    label: 'NPC', subtitle: '动物与家畜', items: [
      ['cow', '黄牛', '农场家畜'], ['horse', '马', '农场家畜'], ['sheep', '绵羊', '农场家畜'],
      ['pig', '花猪', '农场家畜'], ['pug', '哈巴狗', '镇中动物'], ['fox', '狐狸', '野生动物'], ['bird', '飞鸟', '野生动物'],
    ],
  },
  people: {
    label: '人物', subtitle: '村民角色', items: [
      ['manA', '休闲装男子', '男性村民'], ['manB', '长袖衫男子', '男性村民'], ['woman', '便装女子', '女性村民'],
    ],
  },
  buildings: {
    label: '建筑', subtitle: '民居与农场', items: [
      ['house1', '斜顶民居', '单层建筑'], ['house2', '坡屋顶民居', '单层建筑'],
      ['building4', '临街楼房', '四层建筑'], ['building2s', '小型商铺', '单层建筑'],
      ['barn', '农场谷仓', '单层高顶建筑'], ['coop', '木制鸡舍', '农场建筑'],
    ],
  },
  objects: {
    label: '物体', subtitle: '陈设与设施', items: [
      ['well', '石井', '广场设施'], ['windmill', '风车', '农场设施'],
    ],
  },
  textures: {
    label: '材质', subtitle: 'CC0 PBR 贴图', items: Object.entries(TEXTURE_SETS).map(([id, v]) => [id, v.name, v.desc]),
  },
  hdri: {
    label: 'HDRI', subtitle: '环境光照', items: Object.entries(HDRI_SETS).map(([id, v]) => [id, v.name, v.desc]),
  },
};

const dom = Object.fromEntries([
  'searchInput', 'categoryTitle', 'listCount', 'modelList', 'viewport', 'assetCategory', 'assetName',
  'liveBadge', 'loading', 'loadingText', 'loadError', 'errorText', 'retryButton', 'assetFile',
  'assetSize', 'assetClips', 'clipSelect', 'speedInput', 'speedValue', 'playButton', 'rotateInput', 'resetButton',
  'detailLabel0', 'detailLabel1', 'detailLabel2',
  'palettePreset', 'paletteReset', 'paletteRandom', 'paletteSwatches',
].map(id => [id, document.getElementById(id)]));

const params = new URLSearchParams(location.search);
let activeCategory = CATALOG[params.get('category')] ? params.get('category') : 'npc';
let activeId = params.get('id');
let currentModel = null;
let mixer = null;
let currentAction = null;
let selectedGaitMode = null;
let playing = true;
let loadSerial = 0;
let previewObjects = [];
let previewResources = [];
let characterColors = {};   // 部位 key -> "#rrggbb"，当前预览的角色配色
let currentEnv = null;
const templatePromises = new Map();
const textureLoader = new THREE.TextureLoader();

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(42, 1, 0.02, 500);
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setClearColor(0x000000, 0);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
dom.viewport.prepend(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.07;
controls.autoRotate = dom.rotateInput.checked;
controls.autoRotateSpeed = 0.8;
controls.minPolarAngle = 0.08;
controls.maxPolarAngle = Math.PI / 2.04;

scene.add(new THREE.HemisphereLight(0xdde9e0, 0x293229, 2.1));
const keyLight = new THREE.DirectionalLight(0xffead3, 3.2);
keyLight.position.set(5, 9, 6);
keyLight.castShadow = true;
keyLight.shadow.mapSize.set(2048, 2048);
keyLight.shadow.camera.left = -12;
keyLight.shadow.camera.right = 12;
keyLight.shadow.camera.top = 12;
keyLight.shadow.camera.bottom = -12;
keyLight.shadow.camera.near = 0.1;
keyLight.shadow.camera.far = 35;
keyLight.shadow.bias = -0.0004;
scene.add(keyLight);
const rimLight = new THREE.DirectionalLight(0x9fc5d5, 1.4);
rimLight.position.set(-5, 4, -5);
scene.add(rimLight);

const ground = new THREE.Mesh(
  new THREE.CircleGeometry(30, 64),
  new THREE.MeshStandardMaterial({ color: 0x253029, roughness: 0.96, metalness: 0 }),
);
ground.rotation.x = -Math.PI / 2;
ground.position.y = -0.025;
ground.receiveShadow = true;
scene.add(ground);
const grid = new THREE.GridHelper(30, 30, 0x607267, 0x3b4940);
grid.position.y = -0.014;
grid.material.transparent = true;
grid.material.opacity = 0.25;
scene.add(grid);

function resize() {
  const width = dom.viewport.clientWidth;
  const height = dom.viewport.clientHeight;
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height);
}
new ResizeObserver(resize).observe(dom.viewport);
resize();

function isModelCategory() {
  return MODEL_CATEGORIES.has(activeCategory);
}

function assetFile(entry) {
  if (isModelCategory()) return MODEL_SPECS[entry.id]?.file || '';
  if (activeCategory === 'textures') return `${entry.id}_color.jpg / _normal.jpg / _roughness.jpg`;
  return `${entry.id}_1k.hdr`;
}

function assetSource(entry) {
  if (activeCategory === 'textures') return TEXTURE_SETS[entry.id].source;
  if (activeCategory === 'hdri') return HDRI_SETS[entry.id].source;
  return '';
}

function itemEntries(category = activeCategory) {
  return CATALOG[category].items.map(([id, name, description]) => ({ id, name, description, category }));
}

function currentEntry() {
  return itemEntries().find(item => item.id === activeId) || null;
}

function renderList() {
  const query = dom.searchInput.value.trim().toLowerCase();
  const items = itemEntries().filter(item =>
    `${item.name} ${item.description} ${assetFile(item)}`.toLowerCase().includes(query));
  dom.categoryTitle.textContent = `${CATALOG[activeCategory].label} · ${CATALOG[activeCategory].subtitle}`;
  dom.listCount.textContent = `${items.length} 个${isModelCategory() ? '模型' : '资产'}`;
  dom.modelList.replaceChildren();
  if (!items.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-list';
    empty.textContent = '没有匹配的资产';
    dom.modelList.append(empty);
    return;
  }
  for (const item of items) {
    const button = document.createElement('button');
    button.className = `model-item${item.id === activeId ? ' active' : ''}`;
    button.dataset.id = item.id;
    const animated = isModelCategory() && (activeCategory === 'npc' || activeCategory === 'people');
    const index = itemEntries().findIndex(entry => entry.id === item.id) + 1;
    const kind = isModelCategory() ? (animated ? '动画' : '静态') : (activeCategory === 'textures' ? 'PBR' : 'HDRI');
    button.innerHTML = `<span class="model-index">${String(index).padStart(2, '0')}</span><span class="model-copy"><strong>${item.name}</strong><small>${item.description}</small></span><span class="model-kind${animated ? '' : ' static'}">${kind}</span>`;
    dom.modelList.append(button);
  }
}

function setCategory(category) {
  if (!CATALOG[category]) return;
  activeCategory = category;
  dom.searchInput.value = '';
  document.querySelectorAll('.category').forEach(button => button.classList.toggle('active', button.dataset.category === category));
  selectAsset(itemEntries()[0].id);
}

function updateLocation() {
  const url = new URL(location.href);
  url.searchParams.set('category', activeCategory);
  url.searchParams.set('id', activeId);
  history.replaceState(null, '', url);
}

function setDetailLabels() {
  const labels = isModelCategory() ? ['文件', '尺寸', '动画'] :
    activeCategory === 'textures' ? ['贴图', '规格', '来源'] : ['文件', '规格', '来源'];
  labels.forEach((label, index) => { dom[`detailLabel${index}`].textContent = label; });
}

function setControlsForKind() {
  const show = isModelCategory();
  document.querySelectorAll('.model-only').forEach(el => { el.style.display = show ? '' : 'none'; });
  const isCharacter = activeCategory === 'people';
  document.querySelectorAll('.character-only').forEach(el => { el.style.display = isCharacter ? '' : 'none'; });
  dom.viewport.dataset.character = isCharacter ? '1' : '0';
}

// ---- 人物配色：预设来自 town.config.json，部位来自模型材质组 ----
const paletteParts = CHARACTER_PARTS.filter(part => part.key !== 'other');
const colorPresets = CONFIG.characters?.palettes || [];

function inputHex(value) {
  if (typeof value === 'number') return `#${value.toString(16).padStart(6, '0')}`;
  if (typeof value === 'string' && value.startsWith('0x')) return `#${value.slice(2)}`;
  return value;
}

function syncPaletteInputs() {
  paletteParts.forEach(({ key }) => {
    const input = dom.paletteSwatches.querySelector(`input[data-part="${key}"]`);
    if (input && characterColors[key]) input.value = characterColors[key];
  });
}

function applyPaletteToModel() {
  if (currentModel && activeCategory === 'people') applyCharacterColors(currentModel, characterColors);
}

// 某些模型定义了材质组但没有对应几何体（如 manA 的 Shoes）。
// 按实际 partId 分布灰显无效部位，避免取色器点了没反应。
function syncPaletteParts() {
  const present = new Set();
  currentModel?.traverse(mesh => {
    if (!mesh.isSkinnedMesh) return;
    const partAttr = mesh.geometry.getAttribute('partId');
    if (!partAttr) return;
    for (let i = 0; i < partAttr.count; i++) present.add(Math.round(partAttr.getX(i)));
  });
  paletteParts.forEach(part => {
    dom.paletteSwatches.querySelector(`[data-part="${part.key}"]`)
      ?.classList.toggle('unavailable', !present.has(part.id));
  });
}

function applyPalettePreset(index) {
  if (!colorPresets.length) return;
  const i = ((index % colorPresets.length) + colorPresets.length) % colorPresets.length;
  const preset = colorPresets[i];
  characterColors = {};
  paletteParts.forEach(({ key }) => {
    const raw = preset.colors?.[key] ?? preset[key];
    if (raw !== undefined && raw !== null) characterColors[key] = inputHex(raw);
  });
  dom.palettePreset.value = String(i);
  syncPaletteInputs();
  applyPaletteToModel();
}

function randomizePalette() {
  if (!colorPresets.length) return;
  paletteParts.forEach(({ key }) => {
    const preset = colorPresets[Math.floor(Math.random() * colorPresets.length)];
    const raw = preset.colors?.[key] ?? preset[key];
    if (raw !== undefined && raw !== null) characterColors[key] = inputHex(raw);
  });
  syncPaletteInputs();
  applyPaletteToModel();
}

function initPaletteControls() {
  dom.palettePreset.innerHTML = colorPresets.map((p, i) => `<option value="${i}">${p.name}</option>`).join('');
  dom.paletteSwatches.innerHTML = paletteParts.map(part =>
    `<label class="palette-swatch" data-part="${part.key}" title="${part.label}"><input type="color" data-part="${part.key}" value="#d8a97f" /><span>${part.label}</span></label>`
  ).join('');
  dom.paletteSwatches.addEventListener('input', event => {
    const key = event.target.dataset.part;
    if (!key) return;
    characterColors[key] = event.target.value;
    applyPaletteToModel();
  });
  dom.palettePreset.addEventListener('change', () => applyPalettePreset(Number(dom.palettePreset.value)));
  dom.paletteReset.addEventListener('click', () => applyPalettePreset(CONFIG.characters?.defaultPalette ?? 0));
  dom.paletteRandom.addEventListener('click', randomizePalette);
}

function clearAsset() {
  if (mixer) mixer.stopAllAction();
  if (currentModel) scene.remove(currentModel);
  currentModel = null;
  mixer = null;
  currentAction = null;
  for (const object of previewObjects) {
    scene.remove(object);
    object.geometry?.dispose();
    if (Array.isArray(object.material)) object.material.forEach(m => m.dispose());
    else object.material?.dispose();
  }
  previewObjects = [];
  for (const resource of previewResources) resource.dispose?.();
  previewResources = [];
  if (currentEnv) {
    currentEnv.hdr?.dispose();
    currentEnv.env?.dispose();
    currentEnv = null;
  }
  scene.background = null;
  scene.environment = null;
  ground.visible = true;
  grid.visible = true;
}

function getTemplate(id) {
  if (!templatePromises.has(id)) {
    const spec = MODEL_SPECS[id];
    const promise = loadFBX(`./assets/models/${spec.file}`, spec).catch(error => {
      templatePromises.delete(id);
      throw error;
    });
    templatePromises.set(id, promise);
  }
  return templatePromises.get(id);
}

function fitCamera() {
  if (!currentModel) return;
  currentModel.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(currentModel);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const maxSize = Math.max(size.x, size.y, size.z, 0.5);
  const halfFov = Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5));
  const verticalDistance = size.y / (2 * halfFov);
  const horizontalDistance = Math.max(size.x, size.z) / (2 * halfFov * camera.aspect);
  const distance = Math.max(verticalDistance, horizontalDistance, 0.5) * 1.8;
  const direction = new THREE.Vector3(1.2, 0.62, 1.5).normalize();
  controls.target.copy(center);
  camera.position.copy(center).addScaledVector(direction, distance);
  controls.minDistance = Math.max(0.35, maxSize * 0.35);
  controls.maxDistance = Math.max(20, maxSize * 8);
  controls.update();
}

function fitPreviewCamera() {
  controls.target.set(0, 1.2, 0);
  camera.position.set(3.4, 2.5, 4.2);
  controls.minDistance = 1.8;
  controls.maxDistance = 14;
  controls.update();
}

function resetView() {
  if (isModelCategory()) fitCamera();
  else fitPreviewCamera();
}

function clipLabel(clip) {
  const name = clip.name.split('|').pop();
  const lower = name.toLowerCase();
  const labels = [
    ['idle', '待机'], ['walk', '行走'], ['run', '奔跑'], ['jump', '跳跃'],
    ['attack', '攻击'], ['death', '倒地'], ['eat', '进食'], ['sit', '坐下'],
  ];
  const match = labels.find(([key]) => lower.includes(key));
  return `${match ? match[1] : name.replaceAll('_', ' ')} · ${clip.duration.toFixed(1)}s`;
}

function setPlaying(value) {
  playing = value;
  dom.playButton.textContent = playing ? '暂停动画' : '继续动画';
}

function playClip(index) {
  if (!mixer || !currentModel.animations.length) return;
  const clip = currentModel.animations[index];
  if (!clip) return;
  const next = mixer.clipAction(clip);
  next.reset().setLoop(THREE.LoopRepeat, Infinity).play();
  next.timeScale = Number(dom.speedInput.value);
  if (currentAction && currentAction !== next) currentAction.fadeOut(0.16);
  currentAction = next;
  setPlaying(true);
}

function playSelection(value) {
  if (value.startsWith('gait:')) {
    selectedGaitMode = value.slice(5);
    const clips = currentModel.animations || [];
    const idleIndex = clips.findIndex(clip => clip.name.toLowerCase().includes('idle'));
    playClip(idleIndex >= 0 ? idleIndex : 0);
    return;
  }
  selectedGaitMode = null;
  playClip(Number(value.slice(5)));
}

function setupAnimations() {
  const clips = currentModel.animations || [];
  dom.clipSelect.replaceChildren();
  if (!clips.length) {
    const option = document.createElement('option');
    option.textContent = '无动画 · 可环绕查看';
    dom.clipSelect.append(option);
    dom.clipSelect.disabled = true;
    dom.playButton.disabled = true;
    dom.speedInput.disabled = true;
    dom.liveBadge.textContent = '静态模型';
    dom.liveBadge.classList.add('static');
    return;
  }
  const quadruped = activeCategory === 'npc' && currentModel.gait?.bones['FrontUpLegL'];
  if (quadruped) {
    for (const [value, label] of [['gait:walk', '行走 · 程序步态'], ['gait:run', '奔跑 · 程序步态']]) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      dom.clipSelect.append(option);
    }
  }
  clips.forEach((clip, index) => {
    const option = document.createElement('option');
    option.value = `clip:${index}`;
    option.textContent = clipLabel(clip);
    dom.clipSelect.append(option);
  });
  mixer = new THREE.AnimationMixer(currentModel);
  const walkIndex = clips.findIndex(clip => clip.name.toLowerCase().includes('walk'));
  const selectedIndex = walkIndex >= 0 ? walkIndex : 0;
  const selection = quadruped ? 'gait:walk' : `clip:${selectedIndex}`;
  dom.clipSelect.value = selection;
  dom.clipSelect.disabled = false;
  dom.playButton.disabled = false;
  dom.speedInput.disabled = false;
  dom.liveBadge.textContent = '动态预览';
  dom.liveBadge.classList.remove('static');
  playSelection(selection);
}

function loadTexture(url) {
  return new Promise((resolve, reject) => {
    textureLoader.load(url, resolve, undefined, () => reject(new Error(`加载失败: ${url}`)));
  });
}

async function loadModelAsset(entry, serial) {
  const template = await getTemplate(entry.id);
  if (serial !== loadSerial) return;
  currentModel = instantiate(template);
  if (activeCategory === 'npc' || activeCategory === 'people') {
    currentModel.gait = createGaitState(currentModel, activeCategory === 'people' ? 'villager' : 'animal');
  }
  scene.add(currentModel);
  const size = currentModel.userData.size;
  dom.assetSize.textContent = `${size.x.toFixed(2)} × ${size.y.toFixed(2)} × ${size.z.toFixed(2)} m`;
  dom.assetClips.textContent = currentModel.animations.length ? `${currentModel.animations.length} 个片段` : '无骨骼动画';
  dom.liveBadge.textContent = '模型预览';
  dom.liveBadge.classList.add('static');
  if (activeCategory === 'people') {
    syncPaletteParts();
    applyPalettePreset(CONFIG.characters?.defaultPalette ?? 0);
  }
  setupAnimations();
  fitCamera();
}

async function loadTextureAsset(entry, serial) {
  const [color, normal, rough] = await Promise.all([
    loadTexture(`${TEXTURE_BASE}${entry.id}_color.jpg`),
    loadTexture(`${TEXTURE_BASE}${entry.id}_normal.jpg`),
    loadTexture(`${TEXTURE_BASE}${entry.id}_roughness.jpg`),
  ]);
  if (serial !== loadSerial) return;
  const aniso = renderer.capabilities.getMaxAnisotropy?.() || 4;
  for (const [index, texture] of [color, normal, rough].entries()) {
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.colorSpace = index === 0 ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    texture.anisotropy = aniso;
    texture.repeat.set(2, 2);
    texture.needsUpdate = true;
  }
  previewResources.push(color, normal, rough);

  const sphereMat = new THREE.MeshStandardMaterial({ map: color, normalMap: normal, roughnessMap: rough, roughness: 1, metalness: 0 });
  const sphere = new THREE.Mesh(new THREE.SphereGeometry(1.25, 64, 32), sphereMat);
  sphere.position.y = 1.3;
  sphere.castShadow = true;
  scene.add(sphere);
  previewObjects.push(sphere);

  const planeMaps = [color, normal, rough].map(texture => {
    const clone = texture.clone();
    clone.repeat.set(6, 6);
    clone.needsUpdate = true;
    return clone;
  });
  previewResources.push(...planeMaps);
  const planeMat = new THREE.MeshStandardMaterial({ map: planeMaps[0], normalMap: planeMaps[1], roughnessMap: planeMaps[2], roughness: 1, metalness: 0 });
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(5, 5), planeMat);
  plane.rotation.x = -Math.PI / 2;
  plane.position.y = 0.012;
  plane.receiveShadow = true;
  scene.add(plane);
  previewObjects.push(plane);

  dom.assetSize.textContent = '1K · 1024 × 1024';
  dom.assetClips.textContent = entry.source;
  dom.liveBadge.textContent = '材质预览';
  dom.liveBadge.classList.add('static');
  fitPreviewCamera();
}

async function loadHdriAsset(entry, serial) {
  const hdr = await new RGBELoader().loadAsync(`${HDRI_BASE}${entry.id}_1k.hdr`);
  if (serial !== loadSerial) { hdr.dispose(); return; }
  hdr.mapping = THREE.EquirectangularReflectionMapping;
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromEquirectangular(hdr).texture;
  pmrem.dispose();
  currentEnv = { hdr, env };
  scene.background = hdr;
  scene.environment = env;
  ground.visible = false;
  grid.visible = false;

  const sphere = new THREE.Mesh(
    new THREE.SphereGeometry(1.25, 64, 32),
    new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 1, roughness: 0.06 }),
  );
  sphere.position.y = 1.2;
  scene.add(sphere);
  previewObjects.push(sphere);

  dom.assetSize.textContent = '1K · equirectangular';
  dom.assetClips.textContent = entry.source;
  dom.liveBadge.textContent = 'HDRI 环境';
  dom.liveBadge.classList.add('static');
  fitPreviewCamera();
}

async function selectAsset(id) {
  const entry = itemEntries().find(item => item.id === id);
  if (!entry) return;
  activeId = id;
  const serial = ++loadSerial;
  renderList();
  updateLocation();
  clearAsset();
  dom.viewport.dataset.kind = isModelCategory() ? 'model' : activeCategory;
  dom.viewport.dataset.ready = 'false';
  dom.loading.hidden = false;
  dom.loadingText.textContent = `正在加载${entry.name}…`;
  dom.loadError.hidden = true;
  dom.assetCategory.textContent = `${CATALOG[activeCategory].label} / ${entry.description}`;
  dom.assetName.textContent = entry.name;
  dom.assetFile.textContent = assetFile(entry);
  dom.assetSize.textContent = '计算中';
  dom.assetClips.textContent = '读取中';
  dom.liveBadge.textContent = '加载中';
  dom.liveBadge.classList.add('static');
  dom.clipSelect.disabled = true;
  dom.playButton.disabled = true;
  dom.speedInput.disabled = true;
  setDetailLabels();
  setControlsForKind();

  try {
    if (isModelCategory()) await loadModelAsset(entry, serial);
    else if (activeCategory === 'textures') await loadTextureAsset(entry, serial);
    else await loadHdriAsset(entry, serial);
    if (serial !== loadSerial) return;
    dom.loading.hidden = true;
    dom.viewport.dataset.ready = 'true';
  } catch (error) {
    if (serial !== loadSerial) return;
    dom.loading.hidden = true;
    dom.loadError.hidden = false;
    dom.errorText.textContent = `${entry.name}暂时无法显示，请检查资源文件后重试。`;
    dom.liveBadge.textContent = '加载失败';
    dom.viewport.dataset.ready = 'false';
    console.error('preview asset load failed', id, error);
  }
}

document.querySelectorAll('.category').forEach(button => button.addEventListener('click', () => setCategory(button.dataset.category)));
dom.modelList.addEventListener('click', event => {
  const button = event.target.closest('.model-item');
  if (button) selectAsset(button.dataset.id);
});
dom.searchInput.addEventListener('input', renderList);
dom.clipSelect.addEventListener('change', () => playSelection(dom.clipSelect.value));
dom.playButton.addEventListener('click', () => setPlaying(!playing));
dom.speedInput.addEventListener('input', () => {
  const speed = Number(dom.speedInput.value);
  dom.speedValue.textContent = `${speed.toFixed(1)}×`;
  if (currentAction) currentAction.timeScale = speed;
});
dom.rotateInput.addEventListener('change', () => { controls.autoRotate = dom.rotateInput.checked; });
dom.resetButton.addEventListener('click', resetView);
dom.retryButton.addEventListener('click', () => selectAsset(activeId));

document.querySelectorAll('.category').forEach(button => button.classList.toggle('active', button.dataset.category === activeCategory));
if (!itemEntries().some(item => item.id === activeId)) activeId = itemEntries()[0].id;
initPaletteControls();
renderList();
selectAsset(activeId);

const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.05);
  if (mixer && playing) {
    mixer.update(dt);
    const gait = currentModel?.gait;
    if (gait) {
      const clipName = currentAction ? currentAction._clip.name.toLowerCase() : '';
      const clipMode = clipName.includes('run') ? 'run' : clipName.includes('walk') ? 'walk' :
        (activeCategory === 'npc' && currentModel.animations.length === 1 ? 'walk' : null);
      const mode = selectedGaitMode || clipMode;
      if (mode) {
        applyGait(gait, dt * Number(dom.speedInput.value), true, mode === 'run' ? 2.2 : 1.1, mode);
      } else {
        if (gait.walkBlend > 0) {
          gait.walkBlend = 0;
          for (const name in gait.rest) gait.bones[name].quaternion.copy(gait.rest[name]);
        }
        currentModel.position.y = 0;
      }
    }
  }
  controls.update();
  renderer.render(scene, camera);
});
