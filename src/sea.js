import * as THREE from 'three';
import { StaticVoxelBatch, SwayVoxelBatch, swayUniforms } from './creatureBatch.js';
import { InstancedGroup, ArticulatedGroup, flattenCreature } from './instancedGroup.js';

// ─────────────────────────────────────────────────────────────
// 游动行为：绕一个大圈巡游 + 上下起伏 + 身体摆动
// 每种生物用自己的 waypoint 轨道，避免全部挤在一起
// ─────────────────────────────────────────────────────────────

const TAU = Math.PI * 2;

// 在环形轨道上取位置
function orbitPos(t, radiusX, radiusZ, height, phase, tilt = 0) {
  const a = t + phase;
  return new THREE.Vector3(
    Math.cos(a) * radiusX,
    height + Math.sin(a * 2 + phase) * 0.9 + Math.sin(a + tilt) * 0.5,
    Math.sin(a) * radiusZ
  );
}

// ─────────────────────────────────────────────────────────────
// 鱼群：绕场景游动，身体左右摆尾
// ─────────────────────────────────────────────────────────────
// 鱼群
//
// 优化：整群鱼合成 1 个 InstancedMesh（每条鱼 1 个体素实例）。
//   之前：46 条鱼 = 46 个 draw call
//   现在：1 个
// 鱼的「摆尾」通过每只生物的整体 yaw 微摆实现，够用且几乎零成本。
// ─────────────────────────────────────────────────────────────
export class FishSchool {
  constructor({ build, palette, scale, count, speed, radiusX, radiusZ, height, seed = 0 }) {
    this.group = new THREE.Group();
    this.speed = speed;
    this.radiusX = radiusX;
    this.radiusZ = radiusZ;
    this.height = height;

    const data = build();
    palette = palette || data.palette;
    const voxels = flattenCreature(data);

    // 每条鱼的轨道参数
    this.members = [];
    for (let i = 0; i < count; i++) {
      this.members.push({
        radiusX: radiusX + (Math.random() - 0.5) * radiusX * 0.24,
        radiusZ: radiusZ + (Math.random() - 0.5) * radiusZ * 0.24,
        height: height + (Math.random() - 0.5) * height * 0.6 + (Math.random() - 0.5) * 14,
        phase: (i / count) * TAU + seed,
        speed: speed * (0.85 + Math.random() * 0.3),
        wobble: Math.random() * TAU,
        scale: scale * (0.88 + Math.random() * 0.24),
      });
    }

    this.batch = new InstancedGroup({
      voxels,
      palette,
      instances: this.members,
    });
    this.batch.addTo(this.group);

    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._e = new THREE.Euler();
    this._p = new THREE.Vector3();
    this._s = new THREE.Vector3();
  }

  update(t) {
    this.batch.update((j) => {
      const m = this.members[j];
      const a = t * m.speed + m.phase;

      this._p.set(
        Math.cos(a) * m.radiusX,
        m.height + Math.sin(a * 2 + m.wobble) * 2.2,
        Math.sin(a) * m.radiusZ
      );

      // 朝向切线 + 摆尾
      const dx = -Math.sin(a) * m.radiusX;
      const dz = Math.cos(a) * m.radiusZ;
      const yaw = Math.atan2(dx, dz) + Math.PI / 2 + Math.sin(t * 6 + m.wobble) * 0.1;

      this._e.set(
        Math.sin(t * 1.6 + m.wobble) * 0.08, // 点头
        yaw,
        Math.sin(t * 2 + m.wobble) * 0.12, // 侧倾
        'YXZ'
      );
      this._q.setFromEuler(this._e);
      this._s.setScalar(m.scale);

      return this._m.compose(this._p, this._q, this._s);
    });
  }
}

// ─────────────────────────────────────────────────────────────
// 水母：缓慢上下漂浮，伞盖脉动，触手飘荡
//
// 优化：34 只水母 × 9 部件 = 306 个 draw call → 合并成 1 个。
// 每只水母的伞盖缩放和触手摆动都在 batch.update 里算。
// ─────────────────────────────────────────────────────────────
export class JellyfishGroup {
  constructor({ build, scale, count, height, seed = 0 }) {
    this.group = new THREE.Group();
    this.members = [];

    const data = build();
    const parts = data.parts.filter((p) => p.voxels?.length);

    for (let i = 0; i < count; i++) {
      const angle = (i / count) * TAU + seed;
      const radius = 32 + Math.random() * 26;
      this.members.push({
        base: new THREE.Vector3(
          Math.cos(angle) * radius,
          height + (Math.random() - 0.5) * 44,
          Math.sin(angle) * radius
        ),
        drift: Math.random() * TAU,
        speed: 0.16 + Math.random() * 0.12,
        pulse: Math.random() * TAU,
      });
    }

    this.batch = new ArticulatedGroup({
      data,
      count,
      scale,
      nameFilter: (n) => n === 'bell' || n.startsWith('tentacle'),
    });
    this.batch.addTo(this.group);

    // 记录每个部件是不是触手
    this.partIsTentacle = this.batch.parts.map((p) => p.name.startsWith('tentacle'));
    this.partIsBell = this.batch.parts.map((p) => p.name === 'bell');

    this._mats = this.members.map(() => new THREE.Matrix4());
    this._partLocals = this.members.map(() =>
      this.batch.parts.map(() => new THREE.Matrix4())
    );
    this._p = new THREE.Vector3();
    this._q = new THREE.Quaternion();
    this._s = new THREE.Vector3();
    this._e = new THREE.Euler();
  }

  update(t) {
    for (let i = 0; i < this.members.length; i++) {
      const m = this.members[i];

      this._p.set(
        m.base.x + Math.sin(t * 0.3 + m.drift) * 1.6,
        m.base.y + Math.sin(t * m.speed * 2 + m.drift) * 2.2,
        m.base.z + Math.cos(t * 0.26 + m.drift) * 1.6
      );
      this._e.set(0, Math.sin(t * 0.2 + m.drift) * 0.4, 0, 'YXZ');
      this._q.setFromEuler(this._e);
      this._s.setScalar(1);
      this._mats[i].compose(this._p, this._q, this._s);

      // 各部件局部变换
      const pulse = 1 + Math.sin(t * 1.9 + m.pulse) * 0.09;
      for (let pi = 0; pi < this.batch.parts.length; pi++) {
        const local = this._partLocals[i][pi];
        if (this.partIsBell[pi]) {
          // 伞盖脉动
          local.makeScale(pulse, 1 / pulse * 0.92 + 0.08, pulse);
        } else {
          // 触手摆动
          const idx = pi;
          this._e.set(
            Math.sin(t * 1.1 + idx * 0.9 + m.pulse) * 0.28,
            0,
            Math.cos(t * 0.9 + idx * 0.7) * 0.24,
            'YXZ'
          );
          local.makeRotationFromEuler(this._e);
        }
      }
    }

    this.batch.update(this._mats, this._partLocals);
  }
}


// ─────────────────────────────────────────────────────────────
// 海龟：沿缓慢的大圈游动，四鳍划水
//
// 优化：8 只海龟 × 8 部件 = 64 个 draw call → 合并成 1 个
// ─────────────────────────────────────────────────────────────
export class TurtleGroup {
  constructor({ build, scale, count, seed = 0 }) {
    this.group = new THREE.Group();
    this.members = [];
    const data = build();

    for (let i = 0; i < count; i++) {
      this.members.push({
        // 轨道半径按放大后的场景缩放
        radiusX: 38 + i * 9,
        radiusZ: 32 + i * 7,
        height: 6 + i * 5.5,
        phase: seed + i * 2.1,
        speed: 0.11 + i * 0.012,
        wobble: Math.random() * TAU,
      });
    }

    this.batch = new ArticulatedGroup({ data, count, scale });
    this.batch.addTo(this.group);

    this.partIsLimb = this.batch.parts.map((p) => p.name.startsWith('fl'));
    this.partIsHead = this.batch.parts.map((p) => p.name === 'head');

    this._mats = this.members.map(() => new THREE.Matrix4());
    this._partLocals = this.members.map(() => this.batch.parts.map(() => new THREE.Matrix4()));
    this._p = new THREE.Vector3();
    this._q = new THREE.Quaternion();
    this._s = new THREE.Vector3(1, 1, 1);
    this._e = new THREE.Euler();
  }

  update(t) {
    for (let i = 0; i < this.members.length; i++) {
      const m = this.members[i];
      const a = t * m.speed + m.phase;

      this._p.set(
        Math.cos(a) * m.radiusX,
        m.height + Math.sin(a * 2 + m.wobble) * 1.1,
        Math.sin(a) * m.radiusZ
      );

      const dx = -Math.sin(a) * m.radiusX;
      const dz = Math.cos(a) * m.radiusZ;
      this._e.set(
        0,
        Math.atan2(dx, dz) + Math.PI / 2,
        Math.sin(t * 0.6 + m.wobble) * 0.1,
        'YXZ'
      );
      this._q.setFromEuler(this._e);
      this._mats[i].compose(this._p, this._q, this._s);

      // 各部件局部摆动
      for (let pi = 0; pi < this.batch.parts.length; pi++) {
        const local = this._partLocals[i][pi];
        if (this.partIsLimb[pi]) {
          const dir = pi % 2 === 0 ? 1 : -1;
          this._e.set(
            Math.cos(t * 1.1 + pi * 1.2) * 0.18,
            Math.sin(t * 1.1 + pi * 1.2) * 0.42 * dir,
            0,
            'YXZ'
          );
          local.makeRotationFromEuler(this._e);
        } else if (this.partIsHead[pi]) {
          this._e.set(0, Math.sin(t * 0.7) * 0.14, 0, 'YXZ');
          local.makeRotationFromEuler(this._e);
        } else {
          local.identity();
        }
      }
    }

    this.batch.update(this._mats, this._partLocals);
  }
}

// ─────────────────────────────────────────────────────────────
// 章鱼：在海底附近缓慢漂移，触手扭动
//
// 优化：8 只章鱼 × 9 部件 = 72 个 draw call → 合并成 1 个
// ─────────────────────────────────────────────────────────────
export class OctopusGroup {
  constructor({ build, scale, count, seed = 0 }) {
    this.group = new THREE.Group();
    this.members = [];
    const data = build();

    for (let i = 0; i < count; i++) {
      const angle = (i / count) * TAU + seed + 0.6;
      this.members.push({
        base: new THREE.Vector3(
          Math.cos(angle) * 38,
          -16 + i * 3.5,
          Math.sin(angle) * 38
        ),
        drift: Math.random() * TAU,
        speed: 0.12 + Math.random() * 0.08,
      });
    }

    this.batch = new ArticulatedGroup({ data, count, scale });
    this.batch.addTo(this.group);

    this.partIsArm = this.batch.parts.map((p) => p.name.startsWith('arm'));
    this.partIsHead = this.batch.parts.map((p) => p.name === 'head');

    this._mats = this.members.map(() => new THREE.Matrix4());
    this._partLocals = this.members.map(() => this.batch.parts.map(() => new THREE.Matrix4()));
    this._p = new THREE.Vector3();
    this._q = new THREE.Quaternion();
    this._s = new THREE.Vector3(1, 1, 1);
    this._e = new THREE.Euler();
  }

  update(t) {
    for (let i = 0; i < this.members.length; i++) {
      const m = this.members[i];

      this._p.set(
        m.base.x + Math.sin(t * m.speed + m.drift) * 3.2,
        m.base.y + Math.sin(t * m.speed * 1.7 + m.drift) * 1.4,
        m.base.z + Math.cos(t * m.speed + m.drift) * 3.2
      );
      this._e.set(0, t * m.speed * 0.9 + m.drift, 0, 'YXZ');
      this._q.setFromEuler(this._e);
      this._mats[i].compose(this._p, this._q, this._s);

      for (let pi = 0; pi < this.batch.parts.length; pi++) {
        const local = this._partLocals[i][pi];
        if (this.partIsArm[pi]) {
          const p = pi * 0.8;
          this._e.set(
            Math.sin(t * 1.2 + p) * 0.3,
            0,
            Math.cos(t * 1.0 + p) * 0.3,
            'YXZ'
          );
          local.makeRotationFromEuler(this._e);
        } else if (this.partIsHead[pi]) {
          this._e.set(0, Math.sin(t * 0.5 + m.drift) * 0.2, 0, 'YXZ');
          local.makeRotationFromEuler(this._e);
        } else {
          local.identity();
        }
      }
    }

    this.batch.update(this._mats, this._partLocals);
  }
}

// ─────────────────────────────────────────────────────────────
// 海底静物：海星、珊瑚、海草
//
// 关键优化：静态的（海星、珊瑚）和摇摆的（海草）分别合批，
// 各自只产生 1 个 draw call。
//   之前：26 海星 + 40 珊瑚 + 66 海草×8 片叶子 = 594 个 draw call
//   现在：2 个
// ─────────────────────────────────────────────────────────────
export class SeabedGroup {
  constructor() {
    this.group = new THREE.Group();
    this.staticBatch = new StaticVoxelBatch();
    this.swayBatch = new SwayVoxelBatch();
    this._built = false;
  }

  // 放一个静物（海星、珊瑚）—— 只是记进批次，不立刻创建 mesh
  place(data, { position, scale = 1, rotationY = 0 }) {
    this.staticBatch.addCreature(data, { position, scale, rotationY });
    return null;
  }

  // 海草：也进批次，摆动交给着色器
  placeSeagrass(data, { position, scale = 1, rotationY = 0 }) {
    this.swayBatch.addCreature(data, { position, scale, rotationY });
    return null;
  }

  // 所有静物放完后调用一次，真正生成 2 个 InstancedMesh
  finalize() {
    if (this._built) return;
    this._built = true;

    if (this.staticBatch.items.length) {
      this.group.add(this.staticBatch.build());
    }
    if (this.swayBatch.items.length) {
      this.group.add(this.swayBatch.build());
    }
  }

  update(t) {
    // 海草摆动在顶点着色器里做，这里只需要推进时间
    swayUniforms.uTime.value = t;
  }
}
