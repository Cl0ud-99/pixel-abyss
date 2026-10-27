import * as THREE from 'three';
import { VOXEL } from './voxel.js';

// ─────────────────────────────────────────────────────────────
// 把一只生物的 parts 变成可动的 three.js 对象
// 每个 part 是一个 InstancedMesh，挂在自己的枢轴上
// ─────────────────────────────────────────────────────────────
export function buildCreatureObject(data, { scale = 1 } = {}) {
  const root = new THREE.Group();
  const parts = [];

  const boxGeo = new THREE.BoxGeometry(VOXEL * 0.96, VOXEL * 0.96, VOXEL * 0.96);
  const mat = new THREE.MeshStandardMaterial({
    flatShading: true,
    roughness: 0.62,
    metalness: 0.04,
  });

  const colorCache = new Map();
  const colorOf = (kind) => {
    if (colorCache.has(kind)) return colorCache.get(kind);
    const hex = data.palette[kind] || data.palette.body || data.palette.main || '#8A8A8A';
    const c = new THREE.Color(hex).convertSRGBToLinear();
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
