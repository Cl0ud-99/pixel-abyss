import * as THREE from 'three';

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

// ─────────────────────────────────────────────────────────────
// 鲸鱼第一人称视角
//
// 相机挂在鲸鱼头部（模型局部 x ≈ -14.6，略靠前、略偏上，模拟「眼睛」位置），
// 跟随鲸鱼的位置和朝向一起运动，所以看起来就是「你就是这条鲸鱼」。
//
// 额外的沉浸感：
//   - 轻微上下呼吸感（跟鲸鱼摆尾节奏同步）
//   - 转弯时视角有一点点延迟侧倾，像真的在游
//   - 可选显示「水花」前景（鲸鱼喷水时）
// ─────────────────────────────────────────────────────────────

// 鲸鱼模型最前端在局部 x = -19（头部体素），
// 相机放在吻端正前方一点，确保完全在体外、不会看到身体内部的体素。
const HEAD_OFFSET = new THREE.Vector3(-19.8, 1.4, 0); // 模型局部坐标
const VOXEL = 0.1;

export class FirstPersonCamera {
  constructor(camera, {
    eyeOffset = HEAD_OFFSET,
    fov = 72, // 第一人称视野更宽，更有沉浸感
    bobAmount = 0.06, // 呼吸起伏
    rollAmount = 0.2, // 转弯时视角侧倾（比第三人称稍强，但不要太大）
    maxRoll = 0.14, // 侧倾上限（约 8°），防止大幅摇摆
    rollSmooth = 4.5, // 侧倾平滑速度，越小越稳
    lagAmount = 0.22, // 朝向延迟
  } = {}) {
    this.camera = camera;
    this.eyeOffset = eyeOffset.clone();
    this.fov = fov;
    this.bobAmount = bobAmount;
    this.rollAmount = rollAmount;
    this.maxRoll = maxRoll;
    this.rollSmooth = rollSmooth;
    this.lagAmount = lagAmount;

    this.active = false;
    this.time = 0;
    this.smoothHeading = 0;
    this.smoothPitch = 0;
    this.smoothRoll = 0;
    this.camRoll = 0; // 实际应用的侧倾（平滑后）
    this.savedFov = camera.fov;

    this._tmpPos = new THREE.Vector3();
  }

  enter(swimmer) {
    if (this.active) return;
    this.active = true;
    this.time = 0;
    this.savedFov = this.camera.fov;
    this.smoothHeading = swimmer.heading;
    this.smoothPitch = swimmer.pitch;
    this.smoothRoll = swimmer.roll;
    this.camera.fov = this.fov;
    this.camera.updateProjectionMatrix();
  }

  exit() {
    if (!this.active) return;
    this.active = false;
    this.camera.fov = this.savedFov;
    this.camera.updateProjectionMatrix();
  }

  update(dt, swimmer) {
    if (!this.active) return;
    this.time += dt;

    // ── 平滑朝向（略滞后，转弯时有惯性感）──
    const k = 1 - Math.exp(-(1 / Math.max(0.001, this.lagAmount)) * dt);
    let dh = swimmer.heading - this.smoothHeading;
    while (dh > Math.PI) dh -= Math.PI * 2;
    while (dh < -Math.PI) dh += Math.PI * 2;
    this.smoothHeading += dh * k;
    this.smoothPitch += (swimmer.pitch - this.smoothPitch) * k;
    this.smoothRoll += (swimmer.roll - this.smoothRoll) * k;

    // ── 计算眼睛在世界里的位置 ──
    // 鲸鱼 root 的变换：先缩放，再按 YXZ 旋转，最后平移
    const euler = new THREE.Euler(-swimmer.pitch, swimmer.heading + Math.PI / 2, this.smoothRoll, 'YXZ');
    // 眼睛偏移必须乘上鲸鱼的缩放，否则放大的鲸鱼会把相机整个包进身体里
    const scale = swimmer.scale ?? 1;
    const local = this.eyeOffset.clone().multiplyScalar(VOXEL * scale);
    local.applyEuler(euler);
    this._tmpPos.copy(swimmer.pos).add(local);

    // 呼吸起伏（也随体型缩放）
    this._tmpPos.y += Math.sin(this.time * 1.35) * this.bobAmount * scale;

    this.camera.position.copy(this._tmpPos);

    // ── 朝向：沿鲸鱼前进方向，略微下俯 ──
    const lookDist = 26; // 鲸鱼放大 3 倍后同步加大注视距离
    const pitchBias = -0.14; // 稍微往下看，能看到海床、海草和珊瑚
    const p = this.smoothPitch + pitchBias;
    const forward = new THREE.Vector3(
      Math.sin(this.smoothHeading) * Math.cos(p),
      Math.sin(p),
      Math.cos(this.smoothHeading) * Math.cos(p)
    );
    const target = this.camera.position.clone().addScaledVector(forward, lookDist);

    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(target);

    // ── 转弯侧倾 ──
    // 用 swimmer.smoothYawRate（已经低通过一次），再自己平滑一次并限幅。
    // 直接用瞬时 yawRate 会在鲸鱼撞墙转向时来回翻转，导致镜头剧烈摇摆。
    const rawYawRate = (swimmer.smoothYawRate !== undefined)
      ? swimmer.smoothYawRate
      : swimmer.yawRate;
    const targetRoll = clamp(-rawYawRate * this.rollAmount, -this.maxRoll, this.maxRoll);
    const rk = 1 - Math.exp(-this.rollSmooth * dt);
    this.camRoll += (targetRoll - this.camRoll) * rk;
    this.camera.rotateZ(this.camRoll);
  }
}
