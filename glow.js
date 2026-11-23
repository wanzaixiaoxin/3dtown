import { M, disposables } from './materials.js';
import { CONFIG as ENV_CFG } from './config.js';

let updateCommercialGlowHook = null;
export function setCommercialGlowHook(fn) { updateCommercialGlowHook = fn; }
export function updateCommercialGlow(nightAmount) { updateCommercialGlowHook?.(nightAmount); }

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

export function windowVariant(x, z, floor, wx) {
  const list = initWindowVariants();
  const seed = Math.abs(Math.round((x * 31.7 + z * 17.3 + floor * 7.1 + wx * 53.3) * 10));
  return list[seed % list.length];
}
export const getWindowVariants = initWindowVariants;
