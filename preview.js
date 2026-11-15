import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { loadFBX, instantiate, MODEL_SPECS } from './assets.js';
import { applyGait, createGaitState } from './npc.js';

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
};

const dom = Object.fromEntries([
  'searchInput', 'categoryTitle', 'listCount', 'modelList', 'viewport', 'assetCategory', 'assetName',
  'liveBadge', 'loading', 'loadingText', 'loadError', 'errorText', 'retryButton', 'assetFile',
  'assetSize', 'assetClips', 'clipSelect', 'speedInput', 'speedValue', 'playButton', 'rotateInput', 'resetButton',
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
const templatePromises = new Map();

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

function itemEntries(category = activeCategory) {
  return CATALOG[category].items.map(([id, name, description]) => ({ id, name, description, category }));
}

function currentEntry() {
  return itemEntries().find(item => item.id === activeId) || null;
}

function renderList() {
  const query = dom.searchInput.value.trim().toLowerCase();
  const items = itemEntries().filter(item => `${item.name} ${item.description} ${MODEL_SPECS[item.id].file}`.toLowerCase().includes(query));
  dom.categoryTitle.textContent = `${CATALOG[activeCategory].label} · ${CATALOG[activeCategory].subtitle}`;
  dom.listCount.textContent = `${items.length} 个模型`;
  dom.modelList.replaceChildren();
  if (!items.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-list';
    empty.textContent = '没有匹配的模型';
    dom.modelList.append(empty);
    return;
  }
  for (const item of items) {
    const button = document.createElement('button');
    button.className = `model-item${item.id === activeId ? ' active' : ''}`;
    button.dataset.id = item.id;
    const animated = activeCategory === 'npc' || activeCategory === 'people';
    const index = itemEntries().findIndex(entry => entry.id === item.id) + 1;
    button.innerHTML = `<span class="model-index">${String(index).padStart(2, '0')}</span><span class="model-copy"><strong>${item.name}</strong><small>${item.description}</small></span><span class="model-kind${animated ? '' : ' static'}">${animated ? '动画' : '静态'}</span>`;
    dom.modelList.append(button);
  }
}

function setCategory(category) {
  if (!CATALOG[category]) return;
  activeCategory = category;
  dom.searchInput.value = '';
  document.querySelectorAll('.category').forEach(button => button.classList.toggle('active', button.dataset.category === category));
  selectModel(itemEntries()[0].id);
}

function updateLocation() {
  const url = new URL(location.href);
  url.searchParams.set('category', activeCategory);
  url.searchParams.set('id', activeId);
  history.replaceState(null, '', url);
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

function removeCurrentModel() {
  if (mixer) mixer.stopAllAction();
  if (currentModel) scene.remove(currentModel);
  currentModel = null;
  mixer = null;
  currentAction = null;
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

async function selectModel(id) {
  const entry = itemEntries().find(item => item.id === id);
  if (!entry || !MODEL_SPECS[id]) return;
  activeId = id;
  const serial = ++loadSerial;
  renderList();
  updateLocation();
  removeCurrentModel();
  dom.loading.hidden = false;
  dom.loadError.hidden = true;
  dom.loadingText.textContent = `正在加载${entry.name}…`;
  dom.assetCategory.textContent = `${CATALOG[activeCategory].label} / ${entry.description}`;
  dom.assetName.textContent = entry.name;
  dom.assetFile.textContent = MODEL_SPECS[id].file;
  dom.assetSize.textContent = '计算中';
  dom.assetClips.textContent = '读取中';
  dom.liveBadge.textContent = '加载中';
  dom.liveBadge.classList.add('static');
  dom.clipSelect.disabled = true;
  dom.playButton.disabled = true;
  dom.speedInput.disabled = true;
  dom.viewport.dataset.model = id;

  try {
    const template = await getTemplate(id);
    if (serial !== loadSerial) return;
    currentModel = instantiate(template);
    if (activeCategory === 'npc' || activeCategory === 'people') {
      currentModel.gait = createGaitState(currentModel, activeCategory === 'people' ? 'villager' : 'animal');
    }
    scene.add(currentModel);
    const size = currentModel.userData.size;
    dom.assetSize.textContent = `${size.x.toFixed(2)} × ${size.y.toFixed(2)} × ${size.z.toFixed(2)} m`;
    dom.assetClips.textContent = currentModel.animations.length ? `${currentModel.animations.length} 个片段` : '无骨骼动画';
    setupAnimations();
    fitCamera();
    dom.loading.hidden = true;
    dom.viewport.dataset.ready = 'true';
  } catch (error) {
    if (serial !== loadSerial) return;
    dom.loading.hidden = true;
    dom.loadError.hidden = false;
    dom.errorText.textContent = `${entry.name}暂时无法显示，请检查网络后重试。`;
    dom.liveBadge.textContent = '加载失败';
    dom.viewport.dataset.ready = 'false';
    console.error('preview asset load failed', id, error);
  }
}

document.querySelectorAll('.category').forEach(button => button.addEventListener('click', () => setCategory(button.dataset.category)));
dom.modelList.addEventListener('click', event => {
  const button = event.target.closest('.model-item');
  if (button) selectModel(button.dataset.id);
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
dom.resetButton.addEventListener('click', fitCamera);
dom.retryButton.addEventListener('click', () => selectModel(activeId));

document.querySelectorAll('.category').forEach(button => button.classList.toggle('active', button.dataset.category === activeCategory));
if (!itemEntries().some(item => item.id === activeId)) activeId = itemEntries()[0].id;
renderList();
selectModel(activeId);

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
