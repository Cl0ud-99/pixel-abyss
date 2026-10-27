import * as THREE from 'three';

// ─────────────────────────────────────────────────────────────
// 鲸鱼自主游动
//
// 转向用「角速度 + 角加速度」两级限制：
//   1. P 控制算出「期望角速度」
//   2. 实际角速度受加速度限制地逼近它 → 不会从 0 瞬间跳到最大
//   这样掉头是「加速转 → 匀速转 → 减速转」的曲线，而不是突然扭一下。
// ─────────────────────────────────────────────────────────────

const TAU = Math.PI * 2;

function wrapAngle(a) {
  while (a > Math.PI) a -= TAU;
  while (a < -Math.PI) a += TAU;
  return a;
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

// 平滑插值 0→1，两端导数为 0，避免突变
function smoothstep(t) {
  t = clamp(t, 0, 1);
  return t * t * (3 - 2 * t);
}

export class WhaleSwimmer {
  constructor({
    root, // 鲸鱼 Group
    bounds, // { x, y, z } 半尺寸，鲸鱼活动范围
    margin = 6, // 提前多少距离开始避让
    speed = 3.2, // 巡航速度
    turnRate = 1.15, // 最大角速度（弧度/秒）
    turnGain = 2.2, // P 控制增益：朝向偏差 → 期望角速度
    turnAccel = 3.0, // 角加速度上限（弧度/秒²），越小越柔和
    bankAmount = 0.26, // 转弯侧倾幅度
    maxBank = 0.42, // 侧倾上限（弧度）
    arriveRadius = 18, // 进入这个半径就开始绕行，不再直冲
    approachRange = 26, // 从直冲到绕行的过渡距离
    minY,
    maxY,
    tailPivot,
    finPivots = [],
  }) {
    this.root = root;
    // 体型缩放（供第一人称相机换算眼睛位置）
    this.scale = root.scale.x || 1;
    this.bounds = bounds;
    this.margin = margin;
    this.cruiseSpeed = speed;
    this.speed = speed;
    this.turnRate = turnRate;
    this.turnGain = turnGain;
    this.turnAccel = turnAccel;
    this.bankAmount = bankAmount;
    this.maxBank = maxBank;
    this.arriveRadius = arriveRadius;
    this.approachRange = approachRange;
    this.minY = minY;
    this.maxY = maxY;
    this.tailPivot = tailPivot;
    this.finPivots = finPivots;

    // 状态
    this.pos = new THREE.Vector3(0, 0, 0);
    this.heading = 0; // 水平朝向（绕 Y 轴）
    this.pitch = 0; // 俯仰
    this.roll = 0; // 侧倾（视觉）

    // 速度状态（带加速度限制）
    this.yawRate = 0;
    this.pitchRate = 0;
    this.rollVel = 0;

    this.target = new THREE.Vector3();
    this.targetTimer = 0;
    this.time = 0;

    // 起点：靠近中心
    this.pos.set(0, 0, 0);
    this._pickNewTarget();
  }

  // 选新目标点
  //   正常：沿大圆轨道巡游
  //   贴边：把目标点放到「场景内侧」，让鲸鱼朝开阔水域游走
  //
  // 之前试过「沿墙滑行」（目标点在墙的切向上），但当鲸鱼卡在两面墙的角落时，
  // 切向目标点会落在身边几单位处，鲸鱼就会原地打转、镜头一直晃。
  // 改成「朝内侧的远点」更稳。
  _pickNewTarget() {
    const b = this.bounds;
    const m = this.margin;
    const yMin = this.minY !== undefined ? this.minY : -b.y + m;
    const yMax = this.maxY !== undefined ? this.maxY : b.y - m;

    const roomX = b.x - Math.abs(this.pos.x);
    const roomZ = b.z - Math.abs(this.pos.z);
    const nearEdge = Math.min(roomX, roomZ) < m * 2;

    if (nearEdge) {
      // ── 朝内侧的远点 ──
      // 取一个「远离当前所在角落」的目标：把当前位置朝场景中心反射，
      // 再加一点随机偏移，避免每次都在正中心集合
      const inner = 0.45; // 目标落在半径 45% 的范围内
      const jitter = 0.3;
      this.target.set(
        clamp(-this.pos.x * inner + (Math.random() - 0.5) * b.x * jitter, -b.x + m, b.x - m),
        yMin + Math.random() * Math.max(0, yMax - yMin),
        clamp(-this.pos.z * inner + (Math.random() - 0.5) * b.z * jitter, -b.z + m, b.z - m)
      );

      // 万一目标离得太近，强行推到中心附近
      if (this.pos.distanceTo(this.target) < 22) {
        const a = Math.random() * Math.PI * 2;
        const r = Math.min(b.x, b.z) * 0.3;
        this.target.set(Math.cos(a) * r, this.target.y, Math.sin(a) * r);
      }

      this.targetTimer = 8 + Math.random() * 5;
      return;
    }

    // ── 正常巡游：在中心区域内选目标 ──
    // 之前是「沿大圆轨道」，鲸鱼会一直绕着圈游（角速度长期挂在档位上）。
    // 改成「在中心圆盘内随机取点」：
    //   - 大部分目标落在半径 55% 以内，鲸鱼自然待在中心区域
    //   - 目标是散点而不是圆周，转向方向经常变化，不会一直往一个方向拐
    //   - 同时保证新目标离当前位置足够远，避免原地小圈打转
    const coreR = Math.min(b.x, b.z) * 0.62; // 中心区域半径

    let tx = 0, tz = 0;
    for (let attempt = 0; attempt < 8; attempt++) {
      // 极坐标均匀取点，sqrt 让点在圆盘内分布均匀
      const a = Math.random() * Math.PI * 2;
      const rr = Math.sqrt(Math.random()) * coreR;
      tx = Math.cos(a) * rr;
      tz = Math.sin(a) * rr;
      // 离当前位置太近就重试（避免刚选完就到了、频繁重选）
      if (Math.hypot(tx - this.pos.x, tz - this.pos.z) > 32) break;
    }

    this.target.set(
      tx,
      yMin + Math.random() * Math.max(0, yMax - yMin),
      tz
    );
    this.targetTimer = 11 + Math.random() * 7;
  }

  // 边界推力：越靠近边界，往内推得越强
  //
  // 关键：不要把鲸鱼「推离边界」，而是让它「沿着边界滑」。
  // 直接反向推会让鲸鱼在边界附近来回摆（转向方向反复翻转），
  // 第一人称下就表现为镜头剧烈摇晃。
  _boundaryPush(p) {
    const b = this.bounds;
    const push = new THREE.Vector3();
    const limit = this.margin;

    const axis = (v, max) => {
      const room = max - Math.abs(v);
      if (room < limit) {
        // smoothstep 保证导数连续，不会有「突然开始推」的顿感
        const t = smoothstep(1 - Math.max(0, room) / limit);
        return -Math.sign(v || 1) * t * 2.2;
      }
      return 0;
    };

    push.x = axis(p.x, b.x);
    push.z = axis(p.z, b.z);

    // 垂直方向按「巡游高度区间」判定
    const yMin = this.minY !== undefined ? this.minY : -b.y + this.margin;
    const yMax = this.maxY !== undefined ? this.maxY : b.y - this.margin;
    const yBand = Math.max(2, (yMax - yMin) * 0.25);
    if (p.y < yMin + yBand) {
      push.y += smoothstep(1 - Math.max(0, p.y - yMin) / yBand) * 2.0;
    } else if (p.y > yMax - yBand) {
      push.y -= smoothstep(1 - Math.max(0, yMax - p.y) / yBand) * 2.0;
    }

    return push;
  }

  update(dt) {
    this.time += dt;

    const b = this.bounds;

    // ── 1. 选目标 ──
    // 加冷却时间：避免刚选完目标又因为「已到达」立刻重选，
    // 那样会让朝向反复跳变（第一人称下就是镜头抖）
    this.targetTimer -= dt;
    this.targetCooldown = Math.max(0, (this.targetCooldown || 0) - dt);
    const arrived = this.pos.distanceTo(this.target) < 3.5;
    if (this.targetCooldown <= 0 && (this.targetTimer <= 0 || arrived)) {
      this._pickNewTarget();
      this.targetCooldown = 1.2; // 至少 1.2 秒内不再重选
    }

    // ── 2. 期望方向 ──
    // 关键：不要直接瞄准远处的目标点（那会走成「直线 + 急转」的折线），
    // 而是在目标点周围绕一个「参考圆」，瞄准圆上当前的前导点。
    // 这样鲸鱼会沿着圆弧平滑地绕过去，转弯半径可控。
    const toTarget = new THREE.Vector3().subVectors(this.target, this.pos);
    const distToTarget = toTarget.length();
    const desired = new THREE.Vector3();

    if (distToTarget > this.arriveRadius) {
      // 目标点附近的切向 + 径向组合：绕行而不是直冲
      const radial = toTarget.clone().normalize();
      const tangent = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), radial).normalize();

      // 距离远时更偏向「直冲」，近时更偏向「绕行」
      const blend = smoothstep(1 - clamp((distToTarget - this.arriveRadius) / this.approachRange, 0, 1));
      desired.copy(radial).multiplyScalar(1 - blend * 0.72).addScaledVector(tangent, blend * 0.72);
      desired.normalize();
    } else {
      // 已经很近了：直接朝目标收尾
      desired.copy(toTarget).normalize();
    }

    if (desired.lengthSq() < 1e-6) desired.set(1, 0, 0);

    // ── 3. 边界避让：预判前方，提前转向 ──
    const lookahead = 8;
    const probe = this.pos.clone().addScaledVector(desired, lookahead);
    const push = this._boundaryPush(probe);
    if (push.lengthSq() > 1e-6) desired.addScaledVector(push, 1.0).normalize();

    const pushNow = this._boundaryPush(this.pos);
    if (pushNow.lengthSq() > 1e-6) desired.addScaledVector(pushNow, 0.8).normalize();

    // ── 4. 转向：角速度 + 角加速度两级限制 ──
    const desiredYaw = Math.atan2(desired.x, desired.z);
    const yawDiff = wrapAngle(desiredYaw - this.heading);

    // 角速度上限分两档：
    //   正常巡游 → 只用 turnRate 的 62%，转弯更缓、更像悠闲的鲸鱼
    //   贴近边界 → 放开到全速，保证能及时掉头不撞墙
    //
    // 注意：判定要用「离墙的实际距离」，不能用 push.length()。
    // push 是「前方 8 单位探针」的推力，鲸鱼离墙还有十几单位时探针根本够不到，
    // 会导致永远拿不到全速档（实测贴边时最大角速度反而比远处还低）。
    const roomX = b.x - Math.abs(this.pos.x);
    const roomZ = b.z - Math.abs(this.pos.z);
    const roomEdge = Math.min(roomX, roomZ);
    const edgeStart = this.margin * 2.2; // 从 26 左右开始逐渐放开
    const edgePressure = smoothstep(1 - clamp(roomEdge / edgeStart, 0, 1));
    const cruiseTurn = this.turnRate * 0.62;
    const maxTurn = cruiseTurn + (this.turnRate - cruiseTurn) * edgePressure;

    // P 控制 → 期望角速度
    // 加一个「死区」：朝向偏差很小时不再修正，避免在目标方向附近来回微调（会抖）
    const DEADZONE = 0.06; // 约 3.4°
    let yawErrForP = 0;
    if (Math.abs(yawDiff) > DEADZONE) {
      // 减掉死区，让过渡连续（不是硬开关）
      yawErrForP = Math.sign(yawDiff) * (Math.abs(yawDiff) - DEADZONE);
    }
    const desiredYawRate = clamp(yawErrForP * this.turnGain, -maxTurn, maxTurn);

    // 角速度带加速度限制地逼近期望值 → 不会瞬间跳到最大
    // 注意：不要额外乘衰减系数，否则和加速度限制互相拉锯，角速度会抖
    const maxAccel = this.turnAccel * dt;
    this.yawRate += clamp(desiredYawRate - this.yawRate, -maxAccel, maxAccel);
    // 硬限幅兜底，用「物理上限」而不是「当前档位上限」，
    // 否则档位切换时角速度会被反复截断（会出现卡在档位值上的锯齿）
    this.yawRate = clamp(this.yawRate, -this.turnRate, this.turnRate);
    // 超过当前档位时平滑收敛回去，而不是硬砍
    const overLimit = Math.abs(this.yawRate) - maxTurn;
    if (overLimit > 0) {
      this.yawRate -= Math.sign(this.yawRate) * overLimit * Math.min(1, dt * 3.5);
    }
    this.heading += this.yawRate * dt;

    // 供相机使用的平滑角速度：再低通一次，抹掉目标切换时的突变，
    // 第一人称的侧倾用这个值，镜头就不会跟着抖
    this.smoothYawRate = (this.smoothYawRate || 0) +
      (this.yawRate - (this.smoothYawRate || 0)) * (1 - Math.exp(-6 * dt));

    // 俯仰：同样两级限制
    const desiredPitch = clamp(Math.asin(clamp(desired.y, -1, 1)), -0.3, 0.3);
    const pitchDiff = desiredPitch - this.pitch;
    const desiredPitchRate = clamp(pitchDiff * 2.0, -0.7, 0.7);
    this.pitchRate += clamp(desiredPitchRate - this.pitchRate, -1.6 * dt, 1.6 * dt);
    this.pitch += this.pitchRate * dt;

    // ── 5. 推进：转弯时平滑减速 ──
    const turnFactor = 1 - 0.5 * Math.min(1, Math.abs(this.yawRate) / Math.max(0.001, this.turnRate));
    const edgeSlow = Math.min(1, Math.min(
      (b.x - Math.abs(this.pos.x)) / (this.margin * 1.6),
      (b.z - Math.abs(this.pos.z)) / (this.margin * 1.6)
    ));
    const targetSpeed = this.cruiseSpeed * turnFactor * Math.max(0.45, Math.min(1, edgeSlow));
    this.speed += (targetSpeed - this.speed) * Math.min(1, dt * 2.5);

    const dir = new THREE.Vector3(
      Math.sin(this.heading) * Math.cos(this.pitch),
      Math.sin(this.pitch),
      Math.cos(this.heading) * Math.cos(this.pitch)
    );
    this.pos.addScaledVector(dir, this.speed * dt);

    // ── 6. 硬约束兜底 ──
    this.pos.x = clamp(this.pos.x, -b.x, b.x);
    this.pos.y = clamp(this.pos.y, -b.y, b.y);
    this.pos.z = clamp(this.pos.z, -b.z, b.z);

    // ── 7. 应用到模型 ──
    // 模型头朝 -X，绕 Y 转 θ 后头指向 (-cosθ, sinθ)，令其等于 (sin h, cos h) → θ = π/2 + h
    // （tools/verify-heading.mjs 数值验证：点积 +0.973 ✅）
    this.root.position.copy(this.pos);
    this.root.rotation.order = 'YXZ';
    this.root.rotation.y = this.heading + Math.PI / 2;
    this.root.rotation.x = -this.pitch;

    // 侧倾：用临界阻尼弹簧，且限幅，避免甩成 80°
    const targetRoll = clamp(-this.yawRate * this.bankAmount, -this.maxBank, this.maxBank);
    const omega = 4.0; // 弹簧固有频率
    this.rollVel += (omega * omega * (targetRoll - this.roll) - 2 * omega * this.rollVel) * dt;
    this.roll += this.rollVel * dt;
    this.root.rotation.z = this.roll;

    // ── 8. 身体摆动 ──
    const t = this.time;
    const beat = 1.1 + this.speed * 0.22;
    if (this.tailPivot) {
      this.tailPivot.rotation.z = Math.sin(t * beat) * 0.34;
      this.tailPivot.rotation.y = Math.sin(t * beat + 1.0) * 0.13;
    }
    this.finPivots.forEach(({ pivot, side }) => {
      pivot.rotation.x = Math.sin(t * beat + 0.7) * 0.26 * side;
      pivot.rotation.z = Math.sin(t * beat * 0.6) * 0.1;
    });

    // 上下起伏（纯视觉，随体型缩放）
    this.root.position.y += Math.sin(t * 0.9) * 0.18 * this.scale;
  }
}

// ─────────────────────────────────────────────────────────────
// 相机跟随
//
// 关键：不要直接吃鲸鱼的瞬时朝向。相机自己维护一套「平滑朝向」，
// 用最短路径角度插值追过去。这样鲸鱼急转时相机是顺着弧线绕过去，
// 而不是跟着朝向的突变甩一下。
//
// 位置和目标点都用临界阻尼弹簧，不会有回弹抽搐。
// ─────────────────────────────────────────────────────────────
export class FollowCamera {
  constructor(camera, controls, {
    distance = 15,
    height = 5,
    sideOffset = 0.85, // 0 = 正后方，1 = 正侧方
    lookAhead = 4,
    posStiffness = 4.0, // 跟随鲸鱼位置的软硬
    headingStiffness = 1.6, // 朝向平滑：越小越「慢半拍」
    camStiffness = 2.4, // 相机位置收敛速度
    lookStiffness = 3.0, // 注视点收敛速度
    minCameraY, // 相机高度下限（避免钻进海床）
  } = {}) {
    this.camera = camera;
    this.controls = controls;
    this.distance = distance;
    this.height = height;
    this.sideOffset = sideOffset;
    this.lookAhead = lookAhead;
    this.posStiffness = posStiffness;
    this.headingStiffness = headingStiffness;
    this.camStiffness = camStiffness;
    this.lookStiffness = lookStiffness;
    this.minCameraY = minCameraY;

    this.enabled = true;
    this.userInteracting = false;
    this.idleTimer = 0;
    this.idleDelay = 2.5;

    this.smoothPos = new THREE.Vector3();
    this.smoothHeading = 0;
    this.currentTarget = new THREE.Vector3();
    this.desiredPos = new THREE.Vector3();
    this._initialized = false;

    const onStart = () => {
      this.userInteracting = true;
      this.idleTimer = 0;
      this.enabled = false;
    };
    const onEnd = () => {
      this.userInteracting = false;
      this.idleTimer = 0;
    };
    controls.addEventListener('start', onStart);
    controls.addEventListener('end', onEnd);
  }

  update(dt, swimmer) {
    // 用户正在拖拽：绝不抢控制权
    if (this.userInteracting) {
      this.idleTimer = 0;
      return;
    }

    if (!this.enabled) {
      this.idleTimer += dt;
      if (this.idleTimer > this.idleDelay) {
        this.enabled = true;
        this.idleTimer = 0;
        // 恢复跟随时重新对齐，避免从当前视角突然弹过去
        this._initialized = false;
      }
      return;
    }

    const pos = swimmer.pos;

    if (!this._initialized) {
      this.smoothPos.copy(pos);
      this.smoothHeading = swimmer.heading;
      this.currentTarget.copy(pos);
      this._initialized = true;
    }

    // ── 平滑位置（弹簧，帧率无关）──
    this.smoothPos.lerp(pos, 1 - Math.exp(-this.posStiffness * dt));

    // ── 平滑朝向：沿最短路径追过去 ──
    // 鲸鱼掉头时 heading 会快速变化，这里让相机慢半拍跟着转，
    // 视觉上是相机顺着弧线绕过去，而不是瞬间甩到另一侧
    const hDiff = wrapAngle(swimmer.heading - this.smoothHeading);
    this.smoothHeading += hDiff * (1 - Math.exp(-this.headingStiffness * dt));

    // ── 由平滑后的朝向算机位 ──
    const fwd = new THREE.Vector3(Math.sin(this.smoothHeading), 0, Math.cos(this.smoothHeading));
    const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize();

    this.desiredPos.copy(this.smoothPos)
      .addScaledVector(fwd, -this.distance * 0.55)
      .addScaledVector(right, this.distance * this.sideOffset);
    this.desiredPos.y += this.height;

    // ── 位置弹簧收敛 ──
    this.camera.position.lerp(this.desiredPos, 1 - Math.exp(-this.camStiffness * dt));

    // 别让相机钻到海床下面
    if (this.minCameraY !== undefined && this.camera.position.y < this.minCameraY) {
      this.camera.position.y = this.minCameraY;
    }

    // ── 注视点：鲸鱼前方一点，也做平滑 ──
    const lookAt = this.smoothPos.clone().addScaledVector(fwd, this.lookAhead);
    this.currentTarget.lerp(lookAt, 1 - Math.exp(-this.lookStiffness * dt));

    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(this.currentTarget);

    // 同步给 OrbitControls，用户接管时不会跳
    this.controls.target.copy(this.currentTarget);
  }
}
