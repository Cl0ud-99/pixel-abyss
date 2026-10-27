import * as THREE from 'three';
import { VOXEL } from './voxel.js';
import { SHARED_BOX, SHARED_MAT, colorOfKind } from './creatureBatch.js';

// ─────────────────────────────────────────────────────────────
// 把一只生物的 parts 变成可动的 three.js 对象
// 每个 part 是一个 InstancedMesh，挂在自己的枢轴上
//
// 注意：几何体和材质从 creatureBatch 共享，不要在这里 new。
// 之前每次都 new 一套，196 个生物实例 = 196 份重复几何体。
// ─────────────────────────────────────────────────────────────
export function buildCreatureObject(data, { scale = 1 } = {}) {
  const root = new THREE.Group();
  const parts = [];

  const boxGeo = SHARED_BOX;
  const mat = SHARED_MAT;

  const colorCache = new Map();
  const colorOf = (kind) => {
    if (colorCache.has(kind)) return colorCache.get(kind);
    const c = colorOfKind(data.palette, kind);
    colorCache.set(kind, c);
    return c;
  };

  for (const part of data.parts) {
    if (!part.voxels || !part.voxels.length) continue;

    const mesh = new THREE.InstancedMesh(boxGeo, mat, part.voxels.length);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const p = new THREE.Vector3();
    const one = new THREE.Vector3(1, 1, 1);

    part.voxels.forEach((v, i) => {
      // 相对于枢轴摆放，这样旋转枢轴就是正确的摆动
      p.set((v.x - part.pivot[0]) * VOXEL, (v.y - part.pivot[1]) * VOXEL, (v.z - part.pivot[2]) * VOXEL);
      m.compose(p, q, one);
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, colorOf(v.kind));
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.frustumCulled = false;

    const pivot = new THREE.Group();
    pivot.position.set(part.pivot[0] * VOXEL, part.pivot[1] * VOXEL, part.pivot[2] * VOXEL);
    pivot.add(mesh);
    root.add(pivot);

    parts.push({ name: part.name, pivot, mesh });
  }

  root.scale.setScalar(scale);
  return { root, parts };
}

// 找某类部件（按名字前缀）
export function findParts(parts, prefix) {
  return parts.filter((p) => p.name.startsWith(prefix));
}
