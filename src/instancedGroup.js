import * as THREE from 'three';
import { VOXEL } from './voxel.js';
import { SHARED_BOX, colorOfKind } from './creatureBatch.js';

// ─────────────────────────────────────────────────────────────
// 群体批处理
//
// 问题：原来每条鱼 = 1 个 InstancedMesh，每只水母 = 9 个。
//   46 条鱼 + 34 只水母（×9）+ 8 海龟（×8）+ 8 章鱼（×9）
//   = 约 500 个 draw call
//
// 方案：同一物种的所有个体合并进 **1 个** InstancedMesh，
// 每个体素一个实例。每帧只需要更新每个体素的最终世界矩阵。
//
// 这是用「每帧一次矩阵计算」换「几百个 draw call」，在 WebGL 里非常划算。
// ─────────────────────────────────────────────────────────────

const _m = new THREE.Matrix4();
const _mLocal = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _one = new THREE.Vector3(1, 1, 1);
const _euler = new THREE.Euler();

export class InstancedGroup {
  /**
   * @param {object} opts
   * @param {Array<{offset:THREE.Vector3, scale:number, pivot?:THREE.Vector3}>} opts.instances
   * @param {Array<{x,y,z,kind,pivot:[x,y,z]}>} opts.voxels  单只生物的体素
   * @param {object} opts.palette
   */
  constructor({ voxels, palette, instances }) {
    this.count = instances.length;

    // 每个实例 = 一只生物；每只生物有 voxels.length 个体素
    const total = voxels.length * instances.length;

    const geo = SHARED_BOX;
    const mat = new THREE.MeshStandardMaterial({
      flatShading: true,
      roughness: 0.62,
      metalness: 0.04,
    });

    this.mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, total));
    this.mesh.frustumCulled = false;

    // 预先写入颜色（颜色不随动画变）
    const c = colorOfKind(palette, voxels[0]?.kind ?? 'body');
    let idx = 0;
    for (let j = 0; j < instances.length; j++) {
      for (const v of voxels) {
        this.mesh.setColorAt(idx++, colorOfKind(palette, v.kind));
      }
    }
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;

    // 缓存体素的局部偏移（相对生物原点，已乘 VOXEL）
    this.localOffsets = new Float32Array(voxels.length * 3);
    voxels.forEach((v, i) => {
      this.localOffsets[i * 3 + 0] = (v.x - v.pivot[0]) * VOXEL;
      this.localOffsets[i * 3 + 1] = (v.y - v.pivot[1]) * VOXEL;
      this.localOffsets[i * 3 + 2] = (v.z - v.pivot[2]) * VOXEL;
    });
    this.pivotOffsets = voxels.map((v) =>
      new THREE.Vector3(v.pivot[0] * VOXEL, v.pivot[1] * VOXEL, v.pivot[2] * VOXEL)
    );

    this.voxelsPerInstance = voxels.length;
    this.instances = instances;

    // 每帧复用的蒙版：先算好每只生物的变换矩阵，再批量写入实例
    this._base = instances.map(() => new THREE.Matrix4());

    // InstancedMesh 创建后所有实例矩阵默认是单位矩阵（全叠在原点）。
    // 在第一次 update 之前，这些实例会聚成一坨出现在 (0,0,0)。
    // 先把它们移到一个极远处，等 update 写入真实位置。
    const hidden = new THREE.Matrix4().makeTranslation(0, -99999, 0);
    for (let i = 0; i < total; i++) {
      this.mesh.setMatrixAt(i, hidden);
    }
    this.mesh.instanceMatrix.needsUpdate = true;

    this._initialized = false;
  }

  /**
   * 每帧调用：instances 里的每只生物给出世界变换。
   * @param {(i:number) => THREE.Matrix4} getMatrix 返回第 i 只生物的世界矩阵
   */
  update(getMatrix) {
    let idx = 0;
    const n = this.instances.length;
    const vn = this.voxelsPerInstance;

    for (let j = 0; j < n; j++) {
      const base = getMatrix(j);
      for (let k = 0; k < vn; k++) {
        _p.set(
          this.localOffsets[k * 3 + 0],
          this.localOffsets[k * 3 + 1],
          this.localOffsets[k * 3 + 2]
        );
        _mLocal.compose(_p, _q, _one);
        _m.multiplyMatrices(base, _mLocal);
        this.mesh.setMatrixAt(idx++, _m);
      }
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  addTo(parent) {
    parent.add(this.mesh);
    return this;
  }
}

// ─────────────────────────────────────────────────────────────
// 把一只生物的 parts 压平成「体素 + 相对枢轴的偏移」列表。
// 用于 InstancedGroup 的输入。
// ─────────────────────────────────────────────────────────────
export function flattenCreature(data) {
  const voxels = [];
  for (const part of data.parts) {
    if (!part.voxels || !part.voxels.length) continue;
    for (const v of part.voxels) {
      voxels.push({ x: v.x, y: v.y, z: v.z, kind: v.kind, pivot: part.pivot });
    }
  }
  return voxels;
}

// ─────────────────────────────────────────────────────────────
// 多部件批量：支持每只生物内部有独立的可动部件（例如水母的触手、海龟的四鳍）
//
// 和 InstancedGroup 的区别：
//   InstancedGroup  —— 整只生物当刚体，只在生物级别做变换（适合鱼群）
//   ArticulatedGroup —— 每个部件有自己的局部变换（适合水母/海龟/章鱼）
//
// 数据布局：把所有生物的所有部件体素铺平到 1 个 InstancedMesh，
// 每帧对每个部件的每个体素算一次矩阵。
// ─────────────────────────────────────────────────────────────
export class ArticulatedGroup {
  /**
   * @param {object} data  build 出来的生物数据
   * @param {number} count 个体数量
   * @param {(i:number) => Array<{name:string, transform:THREE.Matrix4}>} getParts
   *        返回第 i 只生物各部件的局部变换（相对生物原点）
   * @param {(i:number) => THREE.Matrix4} getBase 返回第 i 只生物的世界矩阵
   */
  constructor({ data, count, scale, nameFilter }) {
    this.count = count;
    this.data = data;

    // 收集要渲染的部件
    this.parts = data.parts.filter(
      (p) => p.voxels?.length && (!nameFilter || nameFilter(p.name))
    );

    // 每个部件的体素数
    this.partSizes = this.parts.map((p) => p.voxels.length);
    const perCreature = this.partSizes.reduce((a, b) => a + b, 0);
    const total = perCreature * count;

    const geo = SHARED_BOX;
    const mat = new THREE.MeshStandardMaterial({
      flatShading: true,
      roughness: 0.62,
      metalness: 0.04,
    });

    this.mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, total));
    this.mesh.frustumCulled = false;

    // 预写颜色 + 缓存局部偏移（相对各自枢轴）
    this.partLocal = this.parts.map((part) => {
      const arr = new Float32Array(part.voxels.length * 3);
      part.voxels.forEach((v, i) => {
        arr[i * 3 + 0] = (v.x - part.pivot[0]) * VOXEL;
        arr[i * 3 + 1] = (v.y - part.pivot[1]) * VOXEL;
        arr[i * 3 + 2] = (v.z - part.pivot[2]) * VOXEL;
      });
      return arr;
    });
    this.partPivot = this.parts.map(
      (part) => new THREE.Vector3(part.pivot[0] * VOXEL, part.pivot[1] * VOXEL, part.pivot[2] * VOXEL)
    );

    let idx = 0;
    for (let j = 0; j < count; j++) {
      for (let pi = 0; pi < this.parts.length; pi++) {
        const part = this.parts[pi];
        for (const v of part.voxels) {
          this.mesh.setColorAt(idx++, colorOfKind(data.palette, v.kind));
        }
      }
    }
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;

    // 同上：先藏到极远处，避免第一帧聚成一坨出现在原点
    const hidden = new THREE.Matrix4().makeTranslation(0, -99999, 0);
    for (let i = 0; i < total; i++) {
      this.mesh.setMatrixAt(i, hidden);
    }
    this.mesh.instanceMatrix.needsUpdate = true;

    this.scale = scale;
    this._baseScale = new THREE.Matrix4().makeScale(scale, scale, scale);
    this._tmpA = new THREE.Matrix4();
    this._tmpB = new THREE.Matrix4();
    this._tmpC = new THREE.Matrix4();
    this._pos = new THREE.Vector3();
    this._q = new THREE.Quaternion();
    this._one = new THREE.Vector3(1, 1, 1);
    this._out = new THREE.Matrix4();
    // 每帧复用：每个部件一个矩阵
    this._partMatrices = this.parts.map(() => new THREE.Matrix4());
  }

  /**
   * @param {Array<THREE.Matrix4>} worldMats  每只生物的世界矩阵（长度 = count）
   * @param {Array<Array<THREE.Matrix4>|null>} partLocals
   *        每只生物各部件相对枢轴的局部旋转（null 表示不转）
   */
  update(worldMats, partLocals) {
    let idx = 0;
    const parts = this.parts;
    const nParts = parts.length;

    for (let j = 0; j < this.count; j++) {
      const base = worldMats[j];
      const locals = partLocals ? partLocals[j] : null;

      for (let pi = 0; pi < nParts; pi++) {
        // 部件变换 = 生物世界矩阵 × 缩放 × 平移(枢轴) × 局部旋转
        const pivot = this.partPivot[pi];
        this._tmpA.makeTranslation(pivot.x * this.scale, pivot.y * this.scale, pivot.z * this.scale);

        if (locals && locals[pi]) {
          this._tmpB.multiplyMatrices(this._tmpA, locals[pi]);
        } else {
          this._tmpB.copy(this._tmpA);
        }
        // 生物世界矩阵 × 缩放 × 部件变换
        this._tmpC.multiplyMatrices(this._baseScale, this._tmpB);
        this._tmpC.premultiply(base);

        const offsets = this.partLocal[pi];
        const vn = this.partSizes[pi];
        for (let k = 0; k < vn; k++) {
          this._pos.set(offsets[k * 3], offsets[k * 3 + 1], offsets[k * 3 + 2]);
          this._tmpA.makeTranslation(this._pos.x, this._pos.y, this._pos.z);
          this._out.multiplyMatrices(this._tmpC, this._tmpA);
          this.mesh.setMatrixAt(idx++, this._out);
        }
      }
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  addTo(parent) {
    parent.add(this.mesh);
    return this;
  }
}
