import * as THREE from 'three';

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

// ─────────────────────────────────────────────────────────────
// 键位映射
//   W/S      前后
//   A/D      左右
//   E/Q      上/下
//   Shift    加速
//   方向键    同 WASD
// ─────────────────────────────────────────────────────────────
const KEY_ACTIONS = {
  KeyW: 'forward',
  ArrowUp: 'forward',
  KeyS: 'back',
  ArrowDown: 'back',
  KeyA: 'left',
  ArrowLeft: 'left',
  KeyD: 'right',
  ArrowRight: 'right',
  // 上升 / 下降：空格升起，Ctrl 下降（E/Q 作为备用，方便单手操作）
  Space: 'up',
  ControlLeft: 'down',
  ControlRight: 'down',
  KeyE: 'up',
  KeyQ: 'down',
  ShiftLeft: 'boost',
  ShiftRight: 'boost',
};

// 这些键要拦掉浏览器默认行为：
//   空格 = 滚动页面 / 触发按钮，方向键 = 滚动页面，Ctrl+组合键 = 浏览器快捷键
const PREVENT_DEFAULT = new Set([
  'Space',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
]);

// ─────────────────────────────────────────────────────────────
// 自由飞行相机
//
// 设计要点：
//   - 速度用指数插值平滑，按下/松开都不会瞬间起停（不会有顿感）
//   - 朝向用 yaw/pitch 自己维护，避免和 OrbitControls 的四元数打架
//   - 进入时从当前相机姿态接管，退出时把控制权交回跟随相机
// ─────────────────────────────────────────────────────────────
export class FreeFlyCamera {
  constructor(camera, domElement, {
    speed = 15, // 巡航速度（单位/秒）
    boost = 2.6, // Shift 加速倍率
    accel = 7, // 速度收敛速度，越大起步越快
    lookSpeed = 0.0024, // 鼠标灵敏度（弧度/像素）
    idleDelay = 2.5, // 多久无操作后交还控制权
    bounds = null, // { x, y, z } 活动范围，null 表示不限制
    minY = -Infinity,
    maxY = Infinity,
    onEnter = null,
    onExit = null,
  } = {}) {
    this.camera = camera;
    this.dom = domElement;
    this.speed = speed;
    this.boost = boost;
    this.accel = accel;
    this.lookSpeed = lookSpeed;
    this.idleDelay = idleDelay;
    this.bounds = bounds;
    this.minY = minY;
    this.maxY = maxY;
    this.onEnter = onEnter;
    this.onExit = onExit;

    this.active = false;
    this.suspended = false; // 开屏页期间挂起，不响应任何输入
    this.keys = new Set();
    this.velocity = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.idleTime = 0;

    this.dragging = false;
    this.lastX = 0;
    this.lastY = 0;
    this.pointerId = null;

    this._onKeyDown = this._handleKeyDown.bind(this);
    this._onKeyUp = this._handleKeyUp.bind(this);
    this._onPointerDown = this._handlePointerDown.bind(this);
    this._onPointerMove = this._handlePointerMove.bind(this);
    this._onPointerUp = this._handlePointerUp.bind(this);
    this._onBlur = this._handleBlur.bind(this);

    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    window.addEventListener('blur', this._onBlur);
    this.dom.addEventListener('pointerdown', this._onPointerDown);
    window.addEventListener('pointermove', this._onPointerMove);
    window.addEventListener('pointerup', this._onPointerUp);
    window.addEventListener('pointercancel', this._onPointerUp);
  }

  // ── 挂起 / 恢复：开屏页期间不响应输入 ──
  suspend() {
    this.suspended = true;
    this.keys.clear();
    this.dragging = false;
    if (this.active) this.exit();
  }

  resume() {
    this.suspended = false;
  }

  // ── 进入自由飞行：从当前相机姿态接管 ──
  enter() {
    if (this.active || this.suspended) return;
    this.active = true;
    this.idleTime = 0;
    this.velocity.set(0, 0, 0);

    // 从当前相机四元数解出 yaw / pitch，保证视角不跳
    const euler = new THREE.Euler().setFromQuaternion(this.camera.quaternion, 'YXZ');
    this.yaw = euler.y;
    this.pitch = clamp(euler.x, -Math.PI / 2 + 0.02, Math.PI / 2 - 0.02);

    if (this.onEnter) this.onEnter();
  }

  // ── 退出：交还控制权 ──
  exit() {
    if (!this.active) return;
    this.active = false;
    this.keys.clear();
    this.velocity.set(0, 0, 0);
    this.dragging = false;
    this.pointerId = null;
    if (this.onExit) this.onExit();
  }

  // 无操作足够久 → 该交还控制权了
  isIdle() {
    return this.active && !this.dragging && this.keys.size === 0 && this.idleTime > this.idleDelay;
  }

  // ── 输入处理 ──
  _handleKeyDown(e) {
    if (this.suspended) return;
    const action = KEY_ACTIONS[e.code];
    if (!action) return;

    // 空格会滚动页面、方向键会滚动、Ctrl+字母可能触发浏览器快捷键，都拦掉
    if (PREVENT_DEFAULT.has(e.code) || e.code.startsWith('Control')) {
      e.preventDefault();
    }

    // 任何移动键都视为想自由飞
    if (action !== 'boost') this.enter();

    if (e.repeat) return;
    this.keys.add(action);
    this.idleTime = 0;
  }

  _handleKeyUp(e) {
    if (this.suspended) return;
    const action = KEY_ACTIONS[e.code];
    if (!action) return;
    // 空格松开也要拦，否则焦点在按钮上会触发点击
    if (PREVENT_DEFAULT.has(e.code) || e.code.startsWith('Control')) {
      e.preventDefault();
    }
    this.keys.delete(action);
    this.idleTime = 0;
  }

  _handleBlur() {
    // 切走窗口时松开所有键，避免「卡键」
    this.keys.clear();
    this.dragging = false;
  }

  _handlePointerDown(e) {
    if (!this.active) return;
    this.dragging = true;
    this.pointerId = e.pointerId;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    this.idleTime = 0;
    if (this.dom.setPointerCapture) {
      try { this.dom.setPointerCapture(e.pointerId); } catch { /* 忽略 */ }
    }
  }

  _handlePointerMove(e) {
    if (!this.active || !this.dragging) return;
    if (this.pointerId !== null && e.pointerId !== this.pointerId) return;

    const dx = e.clientX - this.lastX;
    const dy = e.clientY - this.lastY;
    this.lastX = e.clientX;
    this.lastY = e.clientY;

    this.yaw -= dx * this.lookSpeed;
    this.pitch = clamp(this.pitch - dy * this.lookSpeed, -Math.PI / 2 + 0.02, Math.PI / 2 - 0.02);
    this.idleTime = 0;
  }

  _handlePointerUp(e) {
    if (this.pointerId !== null && e.pointerId !== this.pointerId) return;
    this.dragging = false;
    this.pointerId = null;
    this.idleTime = 0;
  }

  // ── 每帧更新 ──
  update(dt) {
    if (!this.active) return;

    // 1. 由朝向算三个基向量
    const fwd = new THREE.Vector3(0, 0, -1).applyEuler(new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ'));
    const right = new THREE.Vector3(1, 0, 0).applyEuler(new THREE.Euler(0, this.yaw, 0, 'YXZ'));
    const up = new THREE.Vector3(0, 1, 0);

    // 2. 合成输入方向
    const dir = new THREE.Vector3();
    if (this.keys.has('forward')) dir.add(fwd);
    if (this.keys.has('back')) dir.sub(fwd);
    if (this.keys.has('right')) dir.add(right);
    if (this.keys.has('left')) dir.sub(right);
    if (this.keys.has('up')) dir.add(up);
    if (this.keys.has('down')) dir.sub(up);

    if (dir.lengthSq() > 1e-6) dir.normalize();

    // 3. 速度平滑：按下不瞬间满速，松开不瞬间停
    const targetSpeed = this.speed * (this.keys.has('boost') ? this.boost : 1);
    const targetVel = dir.multiplyScalar(targetSpeed);
    const k = 1 - Math.exp(-this.accel * dt);
    this.velocity.lerp(targetVel, k);

    // 4. 位移
    this.camera.position.addScaledVector(this.velocity, dt);

    // 5. 边界约束
    if (this.bounds) {
      const b = this.bounds;
      this.camera.position.x = clamp(this.camera.position.x, -b.x, b.x);
      this.camera.position.z = clamp(this.camera.position.z, -b.z, b.z);
    }
    this.camera.position.y = clamp(this.camera.position.y, this.minY, this.maxY);

    // 6. 应用朝向
    this.camera.quaternion.setFromEuler(new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ'));

    // 7. 空闲计时
    const moving = this.keys.size > 0 || this.dragging;
    if (moving) {
      this.idleTime = 0;
    } else {
      this.idleTime += dt;
    }
  }

  dispose() {
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
    window.removeEventListener('blur', this._onBlur);
    this.dom.removeEventListener('pointerdown', this._onPointerDown);
    window.removeEventListener('pointermove', this._onPointerMove);
    window.removeEventListener('pointerup', this._onPointerUp);
    window.removeEventListener('pointercancel', this._onPointerUp);
  }
}
