// ============================================================================
//  textures.js — load CC0 PBR texture sets (ambientCG) + HDRIs (Poly Haven)
// ============================================================================
import * as THREE from 'three';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';

const texLoader = new THREE.TextureLoader();

function loadTex(url, colorSpace, anisotropy = 4) {
  return new Promise((resolve) => {
    texLoader.load(url, (t) => {
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.colorSpace = colorSpace;
      t.anisotropy = anisotropy;
      t.needsUpdate = true;
      resolve(t);
    }, undefined, () => resolve(null));
  });
}

// Load 6 PBR sets: { key: { color, normal, rough } }
export async function loadPBRTextures(renderer, base = './assets/textures/') {
  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy?.() || 4);
  const sets = ['stone_paving', 'roof_tile', 'plaster', 'wood_plank', 'granite', 'brick'];
  const out = {};
  // sequential per set (3 maps in parallel inside) — avoids server connection resets
  for (const key of sets) {
    const [color, normal, rough] = await Promise.all([
      loadTex(`${base}${key}_color.jpg`, THREE.SRGBColorSpace, aniso),
      loadTex(`${base}${key}_normal.jpg`, THREE.NoColorSpace, aniso),
      loadTex(`${base}${key}_roughness.jpg`, THREE.NoColorSpace, aniso),
    ]);
    if (color) out[key] = { color, normal, rough };
  }
  return out;
}

// ---------------------------------------------------------------------------
//  On-demand single-set loader for the builder material editor.
//  PBR_CATALOG lists every CC0 set the UI offers; base path differs per origin.
// ---------------------------------------------------------------------------
export const PBR_CATALOG = {
  // ambientCG sets (main assets dir — preloaded at boot by loadPBRTextures)
  stone_paving: { label: '石板路', base: './assets/textures/' },
  roof_tile:    { label: '屋顶瓦', base: './assets/textures/' },
  plaster:      { label: '灰泥墙', base: './assets/textures/' },
  wood_plank:   { label: '木板', base: './assets/textures/' },
  granite:      { label: '花岗岩', base: './assets/textures/' },
  brick:        { label: '青砖', base: './assets/textures/' },
  // Poly Haven sets (free_resources — lazy-loaded on demand)
  cobblestone_02:           { label: '鹅卵石', base: './assets/free_resources/polyhaven/textures/' },
  brick_pavement_03:        { label: '砖铺地', base: './assets/free_resources/polyhaven/textures/' },
  clean_pebbles:            { label: '碎石滩', base: './assets/free_resources/polyhaven/textures/' },
  grey_roof_tiles:          { label: '灰瓦', base: './assets/free_resources/polyhaven/textures/' },
  clay_roof_tiles_02:       { label: '陶瓦', base: './assets/free_resources/polyhaven/textures/' },
  beige_wall_001:           { label: '米墙', base: './assets/free_resources/polyhaven/textures/' },
  japanese_cedar_planks:    { label: '杉木板', base: './assets/free_resources/polyhaven/textures/' },
  chinese_cedar_bark:       { label: '杉树皮', base: './assets/free_resources/polyhaven/textures/' },
  brick_moss_001:           { label: '苔砖', base: './assets/free_resources/polyhaven/textures/' },
  granite_tile_02:          { label: '石砖', base: './assets/free_resources/polyhaven/textures/' },
};

const _singleCache = new Map();   // key -> Promise<{ color, normal, rough } | null>

export function loadSinglePBRSet(renderer, key) {
  if (_singleCache.has(key)) return _singleCache.get(key);
  const entry = PBR_CATALOG[key];
  if (!entry) return Promise.resolve(null);
  const aniso = Math.min(8, renderer?.capabilities?.getMaxAnisotropy?.() || 4);
  const p = (async () => {
    const [color, normal, rough] = await Promise.all([
      loadTex(`${entry.base}${key}_color.jpg`, THREE.SRGBColorSpace, aniso),
      loadTex(`${entry.base}${key}_normal.jpg`, THREE.NoColorSpace, aniso),
      loadTex(`${entry.base}${key}_roughness.jpg`, THREE.NoColorSpace, aniso),
    ]);
    return color ? { color, normal, rough } : null;
  })();
  _singleCache.set(key, p);
  return p;
}

export const HDRI_FILES = {
  morning: 'spruit_sunrise.hdr',
  noon: 'kloppenheim_06_puresky.hdr',
  afternoon: 'sunset_jhbcentral.hdr',
  night: 'dikhololo_night.hdr',
};

let _rgbe = null, _pmrem = null;

// Load a single HDRI and prefilter it (PMREM kept alive for reuse).
export async function loadHDRIOne(renderer, key, base = './assets/hdri/') {
  const file = HDRI_FILES[key];
  if (!file) return null;
  try {
    if (!_rgbe) _rgbe = new RGBELoader();
    if (!_pmrem) { _pmrem = new THREE.PMREMGenerator(renderer); _pmrem.compileEquirectangularShader(); }
    const hdr = await _rgbe.loadAsync(base + file);
    hdr.mapping = THREE.EquirectangularReflectionMapping;
    const tex = _pmrem.fromEquirectangular(hdr).texture;
    hdr.dispose();
    return tex;
  } catch (e) {
    console.warn('HDRI load failed', key, e);
    return null;
  }
}

// Load all four (kept for completeness).
export async function loadHDRI(renderer, base = './assets/hdri/') {
  const out = {};
  for (const key of Object.keys(HDRI_FILES)) {
    out[key] = await loadHDRIOne(renderer, key, base);
  }
  return out;
}
