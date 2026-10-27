import * as THREE from 'three';
import { InstancedGroup, flattenCreature } from './instancedGroup.js';

// ─────────────────────────────────────────────────────────────
// 伴游鱼群
//
// 一群小鱼跟在鲸鱼侧后方游动。
// 这是「主角有生态感」最划算的一笔——鲸鱼从孤零零一个模型变成
// 「带着鱼群游的鲸鱼」，而代码复用现成的 InstancedGroup，开销极低。
//
// 行为：
//   1. 每只小鱼有一个锚点，相对鲸鱼固定（侧后方 + 随机偏移）
//   2. 用临界阻尼弹簧靠近锚点，不僵硬
//   3. 叠加上下摆动和摆尾，看起来在主动游
//   4. 鲸鱼转向时小鱼因滞后会被「甩」一下，很自然
// ─────────────────────────────────────────────────────────────

const TAU = Math.PI * 2;

export class CompanionSchool {
  constructor({ build, scale = 1, count = 14, radius = 10, spread = 6 }) {
    this.group = new THREE.Group();
    this.count = count;
    this.radius = radius;
    this.spread = spread;

    const data = build();
    const voxels = flattenCreature(data);

    // 每只小鱼的锚点参数（相对鲸鱼的右后方）
    this.members = [];
    for (let i = 0; i < count; i++) {
      const along = 0.15 + Math.random() * 0.85; // 0=鲸鱼侧面, 1=正后方
      const sideSign = i % 2 === 0 ? 1 : -1;
      this.members.push({
        back: radius * (0.6 + along * 0.8),
        side: sideSign * (radius * 0.35 + Math.random() * this.spread),
        up: (Math.random() - 0.5) * this.spread * 1.2,
        pos: new THREE.Vector3(
          (Math.random() - 0.5) * 20,
          (Math.random() - 0.5) * 12,
          (Math.random() - 0.5) * 20
        ),
        vel: new THREE.Vector3(),
        scale: scale * (0.75 + Math.random() * 0.5),
        wobble: Math.random() * TAU,
        wag: 4.5 + Math.random() * 2.5,
        driftPhase: Math.random() * TAU,
        yaw: 0,
      });
    }

    this.batch = new InstancedGroup({ voxels, palette: data.palette, instances: this.members });
    this.batch.addTo(this.group);

    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._e = new THREE.Euler();
    this._p = new THREE.Vector3();
    this._s = new THREE.Vector3();
    this._desired = new THREE.Vector3();
    this._fwd = new THREE.Vector3();
    this._right = new THREE.Vector3();
    // 每帧复用的矩阵数组（避免在 update 里分配）
    this._mats = this.members.map(() => new THREE.Matrix4());
    this._initialized = false;
  }

  /**
   * @param {number} t
   * @param {number} dt
   * @param {import('./whaleAI.js').WhaleSwimmer} swimmer
   */
  update(t, dt, swimmer) {
    const pos = swimmer.pos;
    const heading = swimmer.heading;

    // 鲸鱼的前 / 右方向
    this._fwd.set(Math.sin(heading), 0, Math.cos(heading));
    this._right.set(Math.cos(heading), 0, -Math.sin(heading));

    const n = this.members.length;

    // 首次更新直接落到锚点，避免从远处飞过来
    if (!this._initialized) {
      this._initialized = true;
      for (const m of this.members) {
        this._anchor(m, pos, this._desired);
        m.pos.copy(this._desired);
      }
    }

    for (let i = 0; i < n; i++) {
      const m = this.members[i];

      // ── 期望位置：鲸鱼侧后方 + 缓慢漂移 ──
      this._anchor(m, pos, this._desired);
      this._desired.x += Math.sin(t * 0.7 + m.driftPhase) * 2.2;
      this._desired.y += Math.sin(t * 0.9 + m.driftPhase * 1.7) * 1.4;
      this._desired.z += Math.cos(t * 0.65 + m.driftPhase) * 2.2;

      // ── 临界阻尼弹簧 ──
      // omega 越小，鱼越「慢半拍」，鲸鱼急转时被甩的感觉越明显
      const omega = 2.6;
      m.vel.x += (omega * omega * (this._desired.x - m.pos.x) - 2 * omega * m.vel.x) * dt;
      m.vel.y += (omega * omega * (this._desired.y - m.pos.y) - 2 * omega * m.vel.y) * dt;
      m.vel.z += (omega * omega * (this._desired.z - m.pos.z) - 2 * omega * m.vel.z) * dt;

      m.pos.x += m.vel.x * dt;
      m.pos.y += m.vel.y * dt;
      m.pos.z += m.vel.z * dt;

      // ── 朝向 ──
      const vLen = Math.hypot(m.vel.x, m.vel.z);
      m.yaw = vLen > 0.6 ? Math.atan2(m.vel.x, m.vel.z) : heading;
      m.yaw += Math.sin(t * m.wag + m.wobble) * 0.22; // 摆尾

      this._e.set(
        Math.sin(t * 1.4 + m.wobble) * 0.12, // 点头
        m.yaw,
        Math.sin(t * 1.1 + m.wobble) * 0.14, // 侧倾
        'YXZ'
      );
      this._q.setFromEuler(this._e);
      this._s.setScalar(m.scale);
      this._mats[i].compose(m.pos, this._q, this._s);
    }

    // 一次性批量更新（InstancedGroup 每帧只调一次）
    this.batch.update((j) => this._mats[j]);
  }

  // 计算锚点，写入 out（避免每帧每只鱼都分配 Vector3）
  _anchor(m, whalePos, out) {
    out.set(
      whalePos.x - this._fwd.x * m.back + this._right.x * m.side,
      whalePos.y + m.up,
      whalePos.z - this._fwd.z * m.back + this._right.z * m.side
    );
    return out;
  }
}
