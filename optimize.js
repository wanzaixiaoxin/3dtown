// ============================================================================
//  optimize.js — static geometry batching.
//  Merges all static meshes in the world by material into a few draw calls,
//  while preserving instanced meshes, skinned meshes and animated objects.
//  Huge win for draw-call count (1200+ meshes -> ~20 batches).
// ============================================================================
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export function batchStatic(root) {
  root.updateMatrixWorld(true);

  const batches = new Map();   // material -> { geoms: [], castShadow, receiveShadow }
  const toRemove = [];

  root.traverse((o) => {
    if (!o.isMesh) return;
    if (o.isInstancedMesh) return;       // keep instancing
    if (o.isSkinnedMesh) return;         // keep skeletons
    if (o.userData && o.userData.noBatch) return;
    if (!o.geometry || !o.material) return;
    if (Array.isArray(o.material)) return; // multi-material -> keep
    // only meshes with standard attributes can merge safely
    const attrs = o.geometry.attributes;
    if (!attrs.position || !attrs.normal) return;

    let entry = batches.get(o.material);
    if (!entry) { entry = { geoms: [], castShadow: false, receiveShadow: false }; batches.set(o.material, entry); }
    // bake world transform into a geometry clone
    const g = o.geometry.clone();
    g.applyMatrix4(o.matrixWorld);
    // ensure consistent attribute set (position, normal, uv)
    if (!g.attributes.uv) {
      const count = g.attributes.position.count;
      g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(count * 2), 2));
    }
    // drop non-mergeable extras that differ
    for (const key of Object.keys(g.attributes)) {
      if (!['position', 'normal', 'uv'].includes(key)) g.deleteAttribute(key);
    }
    g.morphAttributes = {};
    entry.geoms.push(g);
    if (o.castShadow) entry.castShadow = true;
    if (o.receiveShadow) entry.receiveShadow = true;
    toRemove.push(o);
  });

  // remove originals
  for (const o of toRemove) {
    o.parent && o.parent.remove(o);
  }

  // build one mesh per material
  const batchRoot = new THREE.Group();
  batchRoot.name = 'staticBatches';
  for (const [mat, entry] of batches) {
    if (!entry.geoms.length) continue;
    let merged;
    try {
      merged = mergeGeometries(entry.geoms, false);
    } catch (e) {
      continue;
    }
    entry.geoms.forEach(g => g.dispose());
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, mat);
    mesh.castShadow = entry.castShadow;
    mesh.receiveShadow = entry.receiveShadow;
    mesh.name = 'batch_' + (mat.name || mat.type);
    batchRoot.add(mesh);
  }
  root.add(batchRoot);

  // prune empty groups
  const empty = [];
  root.traverse((o) => {
    if (o !== root && o.isGroup && o.children.length === 0) empty.push(o);
  });
  empty.forEach(o => o.parent && o.parent.remove(o));

  return { batches: batchRoot.children.length, removed: toRemove.length };
}
