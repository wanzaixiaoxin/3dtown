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
  await Promise.all(sets.map(async (key) => {
    const [color, normal, rough] = await Promise.all([
      loadTex(`${base}${key}_color.jpg`, THREE.SRGBColorSpace, aniso),
      loadTex(`${base}${key}_normal.jpg`, THREE.NoColorSpace, aniso),
      loadTex(`${base}${key}_roughness.jpg`, THREE.NoColorSpace, aniso),
    ]);
    if (color) out[key] = { color, normal, rough };
  }));
  return out;
}

// Load 4 HDRI environments, prefiltered through PMREM.
export async function loadHDRI(renderer, base = './assets/hdri/') {
  const rgbe = new RGBELoader();
  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();
  const map = {
    morning: 'spruit_sunrise.hdr',
    noon: 'kloppenheim_06_puresky.hdr',
    afternoon: 'sunset_jhbcentral.hdr',
    night: 'dikhololo_night.hdr',
  };
  const out = {};
  for (const [key, file] of Object.entries(map)) {
    try {
      const hdr = await rgbe.loadAsync(base + file);
      hdr.mapping = THREE.EquirectangularReflectionMapping;
      out[key] = pmrem.fromEquirectangular(hdr).texture;
      hdr.dispose();
    } catch (e) {
      console.warn('HDRI load failed', key, e);
    }
  }
  pmrem.dispose();
  return out;
}
