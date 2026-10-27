import * as THREE from 'three';
import { buildCreatureObject, findParts } from './creatureObject.js';

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
export class FishSchool {
  constructor({ build, palette, scale, count, speed, radiusX, radiusZ, height, seed = 0 }) {
    this.group = new THREE.Group();
    this.members = [];
    this.speed = speed;
    this.radiusX = radiusX;
    this.radiusZ = radiusZ;
    this.height = height;

    for (let i = 0; i < count; i++) {
      const data = build();
      const { root, parts } = buildCreatureObject(data, { scale });
      const phase = (i / count) * TAU + seed;
      // 每条鱼错开一点轨道和高度，形成鱼群感
      const jitter = {
        radiusX: radiusX + (Math.random() - 0.5) * 6,
        radiusZ: radiusZ + (Math.random() - 0.5) * 6,
        height: height + (Math.random() - 0.5) * 5,
        phase,
        speed: speed * (0.85 + Math.random() * 0.3),
        wobble: Math.random() * TAU,
      };
      this.group.add(root);
      this.members.push({ root, parts, ...jitter });
    }
  }

  update(t, dt) {
    for (const m of this.members) {
      const a = t * m.speed + m.phase;
      const x = Math.cos(a) * m.radiusX;
      const z = Math.sin(a) * m.radiusZ;
      const y = m.height + Math.sin(a * 2 + m.wobble) * 0.8;

      m.root.position.set(x, y, z);

      // 朝向切线方向
      const dx = -Math.sin(a) * m.radiusX;
      const dz = Math.cos(a) * m.radiusZ;
      m.root.rotation.y = Math.atan2(dx, dz) + Math.PI / 2;

      // 身体轻微侧倾 + 上下点头
      m.root.rotation.z = Math.sin(t * 2 + m.wobble) * 0.12;
      m.root.rotation.x = Math.sin(t * 1.6 + m.wobble) * 0.08;

      // 整条鱼左右摆（模拟尾鳍推进）
      m.root.children.forEach((c) => {
        // 只摆最外层容器，内部 mesh 保持
      });
      m.root.rotation.y += Math.sin(t * 6 + m.wobble) * 0.08;
    }
  }
}

// ─────────────────────────────────────────────────────────────
// 水母：缓慢上下漂浮，伞盖脉动，触手飘荡
// ─────────────────────────────────────────────────────────────
export class JellyfishGroup {
  constructor({ build, scale, count, height, seed = 0 }) {
    this.group = new THREE.Group();
    this.members = [];

    for (let i = 0; i < count; i++) {
      const data = build();
      const { root, parts } = buildCreatureObject(data, { scale });
      const bell = findParts(parts, 'bell')[0];
      const tentacles = findParts(parts, 'tentacle');

      const angle = (i / count) * TAU + seed;
      // 推到外围，避免挤在鲸鱼旁边
      const radius = 15 + Math.random() * 10;
      const member = {
        root,
        bell,
        tentacles,
        base: new THREE.Vector3(
          Math.cos(angle) * radius,
          height + (Math.random() - 0.5) * 10,
          Math.sin(angle) * radius
        ),
        drift: Math.random() * TAU,
        speed: 0.16 + Math.random() * 0.12,
        pulse: Math.random() * TAU,
      };
      this.group.add(root);
      this.members.push(member);
    }
  }

  update(t, dt) {
    for (const m of this.members) {
      // 缓慢上下漂
      m.root.position.set(
        m.base.x + Math.sin(t * 0.3 + m.drift) * 1.6,
        m.base.y + Math.sin(t * m.speed * 2 + m.drift) * 2.2,
        m.base.z + Math.cos(t * 0.26 + m.drift) * 1.6
      );

      // 伞盖脉动（缩放）
      const p = 1 + Math.sin(t * 1.9 + m.pulse) * 0.09;
      if (m.bell) {
        m.bell.pivot.scale.set(p, 1 / p * 0.92 + 0.08, p);
      }

      // 触手摆动
      m.tentacles.forEach((tp, i) => {
        tp.pivot.rotation.x = Math.sin(t * 1.1 + i * 0.9 + m.pulse) * 0.28;
        tp.pivot.rotation.z = Math.cos(t * 0.9 + i * 0.7) * 0.24;
      });

      m.root.rotation.y = Math.sin(t * 0.2 + m.drift) * 0.4;
    }
  }
}

// ─────────────────────────────────────────────────────────────
// 海龟：沿缓慢的大圈游动，四鳍划水
// ─────────────────────────────────────────────────────────────
export class TurtleGroup {
  constructor({ build, scale, count, seed = 0 }) {
    this.group = new THREE.Group();
    this.members = [];

    for (let i = 0; i < count; i++) {
      const data = build();
      const { root, parts } = buildCreatureObject(data, { scale });
      const limbs = parts.filter((p) => p.name.startsWith('fl'));
      const head = parts.find((p) => p.name === 'head');

      this.group.add(root);
      this.members.push({
        root,
        limbs,
        head,
        radiusX: 16 + i * 4,
        radiusZ: 13 + i * 3,
        height: 3 + i * 4.5,
        phase: seed + i * 2.1,
        speed: 0.19 + i * 0.02,
        wobble: Math.random() * TAU,
      });
    }
  }

  update(t) {
    for (const m of this.members) {
      const a = t * m.speed + m.phase;
      m.root.position.set(
        Math.cos(a) * m.radiusX,
        m.height + Math.sin(a * 2 + m.wobble) * 1.1,
        Math.sin(a) * m.radiusZ
      );

      // 朝向切线
      const dx = -Math.sin(a) * m.radiusX;
      const dz = Math.cos(a) * m.radiusZ;
      m.root.rotation.y = Math.atan2(dx, dz) + Math.PI / 2;
      m.root.rotation.z = Math.sin(t * 0.6 + m.wobble) * 0.1;

      // 四鳍划水
      m.limbs.forEach((lp, i) => {
        const dir = i % 2 === 0 ? 1 : -1;
        lp.pivot.rotation.y = Math.sin(t * 1.1 + i * 1.2) * 0.42 * dir;
        lp.pivot.rotation.x = Math.cos(t * 1.1 + i * 1.2) * 0.18;
      });

      if (m.head) {
        m.head.pivot.rotation.y = Math.sin(t * 0.7) * 0.14;
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────
// 章鱼：在海底附近缓慢漂移，触手扭动
// ─────────────────────────────────────────────────────────────
export class OctopusGroup {
  constructor({ build, scale, count, seed = 0 }) {
    this.group = new THREE.Group();
    this.members = [];

    for (let i = 0; i < count; i++) {
      const data = build();
      const { root, parts } = buildCreatureObject(data, { scale });
      const arms = parts.filter((p) => p.name.startsWith('arm'));
      const head = parts.find((p) => p.name === 'head');

      const angle = (i / count) * TAU + seed + 0.6;
      this.group.add(root);
      this.members.push({
        root,
        arms,
        head,
        base: new THREE.Vector3(
          Math.cos(angle) * 17,
          -7 + i * 2.5,
          Math.sin(angle) * 17
        ),
        drift: Math.random() * TAU,
        speed: 0.12 + Math.random() * 0.08,
      });
    }
  }

  update(t) {
    for (const m of this.members) {
      m.root.position.set(
        m.base.x + Math.sin(t * m.speed + m.drift) * 3.2,
        m.base.y + Math.sin(t * m.speed * 1.7 + m.drift) * 1.4,
        m.base.z + Math.cos(t * m.speed + m.drift) * 3.2
      );
      m.root.rotation.y = t * m.speed * 0.9 + m.drift;

      // 触手波浪式扭动
      m.arms.forEach((ap, i) => {
        const p = i * 0.8;
        ap.pivot.rotation.x = Math.sin(t * 1.2 + p) * 0.3;
        ap.pivot.rotation.z = Math.cos(t * 1.0 + p) * 0.3;
      });

      if (m.head) {
        m.head.pivot.rotation.y = Math.sin(t * 0.5 + m.drift) * 0.2;
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────
// 海底静物：海星、珊瑚、海草（海草轻微摆动）
// ─────────────────────────────────────────────────────────────
export class SeabedGroup {
  constructor() {
    this.group = new THREE.Group();
    this.swayers = [];
  }

  // 放一个静物
  place(data, { position, scale = 1, rotationY = 0 }) {
    const { root, parts } = buildCreatureObject(data, { scale });
    root.position.copy(position);
    root.rotation.y = rotationY;
    this.group.add(root);
    return { root, parts };
  }

  // 海草：每片叶子单独摆动
  placeSeagrass(data, { position, scale = 1 }) {
    const { root, parts } = buildCreatureObject(data, { scale });
    root.position.copy(position);
    this.group.add(root);
    parts.forEach((p, i) => {
      this.swayers.push({ pivot: p.pivot, phase: i * 1.3, amp: 0.16 + Math.random() * 0.1 });
    });
    return { root, parts };
  }

  update(t) {
    for (const s of this.swayers) {
      s.pivot.rotation.z = Math.sin(t * 0.9 + s.phase) * s.amp;
      s.pivot.rotation.x = Math.cos(t * 0.7 + s.phase) * s.amp * 0.6;
    }
  }
}
