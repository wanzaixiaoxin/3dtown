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
