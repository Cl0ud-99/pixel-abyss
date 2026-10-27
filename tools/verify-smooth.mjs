// 验证转向与相机的平滑度
//
// 关键指标：
//   1. 角速度变化率（角加速度）—— 越大越「突然掉头」
//   2. 相机每帧位移的突变 —— 越大越「抽搐」
//   3. 相机视线的角速度突变
import * as THREE from 'three';
import { WhaleSwimmer, FollowCamera } from '../src/whaleAI.js';

class FakeControls extends THREE.EventDispatcher {
  constructor() { super(); this.target = new THREE.Vector3(); }
  update() {}
}

const camera = new THREE.PerspectiveCamera(40, 1.5, 0.1, 500);
const controls = new FakeControls();
const root = new THREE.Group();

const sw = new WhaleSwimmer({
  root,
  bounds: { x: 62, y: 20, z: 62 },
  margin: 12,
  speed: 4.2,
  turnRate: 1.05,
  turnGain: 2.0,
  turnAccel: 2.4,
  bankAmount: 0.26,
  maxBank: 0.42,
  minY: 2,
  maxY: 14,
});

const fc = new FollowCamera(camera, controls, {
  distance: 15, height: 5, sideOffset: 0.85, lookAhead: 4,
  posStiffness: 4.5, headingStiffness: 1.5, camStiffness: 2.6, lookStiffness: 3.2,
});

const dt = 1 / 60;
const SECONDS = 120;
const steps = 60 * SECONDS;

let prevYawRate = 0;
let prevCamPos = null;
let prevLookDir = null;
let prevRoll = 0;

const yawAccels = [];
const camJumps = [];
const lookJumps = [];
const rollJumps = [];
const spikes = [];
let maxBankSeen = 0;
let minSpeed = 99;
let maxSpeed = -99;

for (let i = 0; i < steps; i++) {
  sw.update(dt);
  fc.update(dt, sw);

  // 角加速度
  const yawAccel = Math.abs(sw.yawRate - prevYawRate) / dt;
  yawAccels.push(yawAccel);
  prevYawRate = sw.yawRate;

  // 侧倾变化
  const rollJump = Math.abs(sw.roll - prevRoll) / dt;
  rollJumps.push(rollJump);
  prevRoll = sw.roll;
  maxBankSeen = Math.max(maxBankSeen, Math.abs(sw.roll));

  minSpeed = Math.min(minSpeed, sw.speed);
  maxSpeed = Math.max(maxSpeed, sw.speed);

  if (prevCamPos) {
    // 相机每帧位移（加速度突变会在这里体现）
    const jump = camera.position.distanceTo(prevCamPos) / dt;
    // 跳过启动前 2 秒的初始化瞬态（相机从初始位收敛到跟随位）
    const isWarmup = i * dt < 2;
    if (!isWarmup) {
      camJumps.push(jump);
      if (jump > 25) {
        spikes.push({
          t: (i * dt).toFixed(1),
          jump: jump.toFixed(1),
          yawRate: sw.yawRate.toFixed(2),
          heading: sw.heading.toFixed(2),
          smoothHeading: fc.smoothHeading.toFixed(2),
          headingDiff: (sw.heading - fc.smoothHeading).toFixed(2),
        });
      }
    }

    // 视线方向的角速度突变
    const dir = new THREE.Vector3();
    camera.getWorldDirection(dir);
    if (prevLookDir && !isWarmup) {
      const ang = prevLookDir.angleTo(dir) / dt;
      lookJumps.push(ang);
    }
    prevLookDir = dir;
  }
  prevCamPos = camera.position.clone();
}

const stats = (arr, name, unit) => {
  const sorted = [...arr].sort((a, b) => a - b);
  const p = (q) => sorted[Math.floor(sorted.length * q)];
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  console.log(
    `${name.padEnd(22)} 平均 ${mean.toFixed(2).padStart(7)}${unit}  ` +
    `p95 ${p(0.95).toFixed(2).padStart(7)}${unit}  ` +
    `最大 ${sorted[sorted.length - 1].toFixed(2).padStart(7)}${unit}`
  );
};

console.log(`=== ${SECONDS} 秒游动 + 相机跟随 ===\n`);
stats(yawAccels, '角加速度', ' rad/s²');
stats(rollJumps, '侧倾变化率', ' rad/s');
stats(camJumps, '相机移动速度', ' 单位/s');
stats(lookJumps, '视线角速度', ' rad/s');

console.log('');
console.log('侧倾最大幅度:', maxBankSeen.toFixed(3), 'rad =', (maxBankSeen * 180 / Math.PI).toFixed(1), '°');
console.log('速度范围:', minSpeed.toFixed(2), '~', maxSpeed.toFixed(2), '单位/s');

if (spikes.length) {
  console.log('\n=== 相机速度尖峰（>25 单位/s）===');
  console.log('共', spikes.length, '次，前 10 次：');
  spikes.slice(0, 10).forEach((s) => {
    console.log(
      `  t=${s.t}s 速度=${s.jump}  yawRate=${s.yawRate}  ` +
      `heading=${s.heading}  smooth=${s.smoothHeading}  差=${s.headingDiff}`
    );
  });
} else {
  console.log('\n✅ 无相机速度尖峰');
}

console.log('');
console.log('判定标准：');
console.log('  角加速度最大 < 4.0 rad/s²  → 转向无突变');
console.log('  相机移动速度最大 < 30 单位/s → 相机不抽搐');
console.log('  侧倾最大 < 0.5 rad (28.6°) → 不会甩过头');
