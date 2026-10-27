import * as THREE from 'three';
import { VOXEL } from './voxel.js';

// ─────────────────────────────────────────────────────────────
// 共享几何体和材质
//
// 之前每创建一只生物就 new 一套 BoxGeometry + MeshStandardMaterial，
// 项目里有 196 个生物实例 → 196 份重复的几何体（实测场景里有 220 个）。
// 这里提到模块顶层共享，几何体只需要 1 个。
// ─────────────────────────────────────────────────────────────
export const SHARED_BOX = new THREE.BoxGeometry(VOXEL * 0.96, VOXEL * 0.96, VOXEL * 0.96);

export const SHARED_MAT = new THREE.MeshStandardMaterial({
  flatShading: true,
  roughness: 0.62,
  metalness: 0.04,
});

export function colorOfKind(palette, kind) {
  const hex = palette[kind] || palette.body || palette.main || '#8A8A8A';
  return new THREE.Color(hex).convertSRGBToLinear();
}

// ─────────────────────────────────────────────────────────────
// 静态体素批处理
//
// 把「不会动」的东西（海星、珊瑚）合并成 1 个 InstancedMesh。
// 之前 26 个海星 + 40 丛珊瑚 = 66 个 draw call，合并后是 2 个。
// 矩阵在构建时算一次，之后不再更新，零 CPU 开销。
// ─────────────────────────────────────────────────────────────
export class StaticVoxelBatch {
  constructor() {
    this.items = []; // { matrix, color }
  }

  // 把一整只生物按世界变换烘焙进来
  addCreature(data, { position, scale = 1, rotationY = 0 }) {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotationY);
    const s = new THREE.Vector3(scale, scale, scale);
    const base = new THREE.Matrix4().compose(position, q, s);

    const local = new THREE.Matrix4();
    const p = new THREE.Vector3();
    const one = new THREE.Vector3(1, 1, 1);
    const iq = new THREE.Quaternion();

    for (const part of data.parts) {
      if (!part.voxels || !part.voxels.length) continue;
      for (const v of part.voxels) {
        p.set(v.x * VOXEL, v.y * VOXEL, v.z * VOXEL);
        local.compose(p, iq, one);
        m.multiplyMatrices(base, local);
        this.items.push({
          matrix: m.clone(),
          color: colorOfKind(data.palette, v.kind),
        });
      }
    }
    return this;
  }

  build() {
    const n = this.items.length;
    const mesh = new THREE.InstancedMesh(SHARED_BOX, SHARED_MAT, Math.max(1, n));
    for (let i = 0; i < n; i++) {
      mesh.setMatrixAt(i, this.items[i].matrix);
      mesh.setColorAt(i, this.items[i].color);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.frustumCulled = false;
    mesh.count = n;
    return mesh;
  }
}

// ─────────────────────────────────────────────────────────────
// 摇摆体素批处理（海草）
//
// 之前每片叶子是独立 mesh，为了让叶子独立摆动：
//   66 丛 × 8 片叶子 = 528 个 draw call（占整个场景的 64%）
//
// 现在全部合并成 1 个 InstancedMesh，摆动改在**顶点着色器**里做：
// 用实例的世界坐标当相位，高度当权重，GPU 免费算，不需要每帧更新矩阵。
// ─────────────────────────────────────────────────────────────
export const swayUniforms = { uTime: { value: 0 } };

export class SwayVoxelBatch {
  constructor() {
    this.items = [];
  }

  addCreature(data, { position, scale = 1, rotationY = 0 }) {
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotationY);
    const s = new THREE.Vector3(scale, scale, scale);
    const base = new THREE.Matrix4().compose(position, q, s);

    const local = new THREE.Matrix4();
    const m = new THREE.Matrix4();
    const p = new THREE.Vector3();
    const one = new THREE.Vector3(1, 1, 1);
    const iq = new THREE.Quaternion();

    for (const part of data.parts) {
      if (!part.voxels || !part.voxels.length) continue;
      for (const v of part.voxels) {
        p.set(v.x * VOXEL, v.y * VOXEL, v.z * VOXEL);
        local.compose(p, iq, one);
        m.multiplyMatrices(base, local);
        this.items.push({
          matrix: m.clone(),
          color: colorOfKind(data.palette, v.kind),
          height: v.y * VOXEL, // 局部高度，越高摆得越多
        });
      }
    }
    return this;
  }

  build() {
    const n = this.items.length;
    const geo = new THREE.BoxGeometry(VOXEL * 0.96, VOXEL * 0.96, VOXEL * 0.96);
    const mat = new THREE.MeshStandardMaterial({
      flatShading: true,
      roughness: 0.62,
      metalness: 0.04,
    });

    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = swayUniforms.uTime;
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
           uniform float uTime;`
        )
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
           // 用实例的世界坐标当相位，让每丛海草错开
           vec3 iPos = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
           float phase = iPos.x * 0.32 + iPos.z * 0.26;
           float sway = sin(uTime * 0.85 + phase) * 0.5
                      + sin(uTime * 0.52 + phase * 1.7) * 0.28;
           // 只让上半部分弯（transformed.y 是叶片高度）
           float bend = max(0.0, transformed.y) * 0.14;
           transformed.x += sway * bend;
           transformed.z += sway * bend * 0.62;`
        );
    };
    // 让 three.js 知道材质变了，需要重新编译
    mat.customProgramCacheKey = () => 'sway-v1';

    const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, n));
    for (let i = 0; i < n; i++) {
      mesh.setMatrixAt(i, this.items[i].matrix);
      mesh.setColorAt(i, this.items[i].color);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.frustumCulled = false;
    mesh.count = n;
    return mesh;
  }
}
