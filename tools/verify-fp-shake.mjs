// 量化第一人称在边界处的镜头抖动
import * as THREE from 'three';
import { WhaleSwimmer } from '../src/whaleAI.js';
import { FirstPersonCamera } from '../src/firstPerson.js';

const camera = new THREE.PerspectiveCamera(45, 1.6, 0.1, 500);
const root = new THREE.Group();
const swimmer = new WhaleSwimmer({
  root, bounds: { x: 62, y: 20, z: 62 }, margin: 12,
  speed: 4.2, turnRate: 1.05, turnGain: 2.0, turnAccel: 2.4,
  bankAmount: 0.26, maxBank: 0.42, minY: -2, maxY: 9,
});
const fp = new FirstPersonCamera(camera, { fov: 74 });
fp.enter(swimmer);

const dt = 1 / 60;
const SECONDS = 180;

let prevQuat = null;
let prevYawRate = 0;
let prevRight = null;

const quatJerk = [];   // 相机朝向每帧角速度
const quatAccel = [];  // 角速度的变化率（越大越抖）
const yawRateJerk = [];
const rollJerk = [];
const spikes = [];
let signFlips = 0;
let lastSign = 0;

// 只统计靠近边界时的数据
const nearEdge = [];

for (let i = 0; i < 60 * SECONDS; i++) {
  swimmer.update(dt);
  fp.update(dt, swimmer);

  const q = camera.quaternion.clone();
  const right = new THREE.Vector3(1, 0, 0).applyQuaternion(q);

  if (prevQuat) {
    const ang = prevQuat.angleTo(q) / dt; // rad/s
    quatJerk.push(ang);

    // 角速度的突变
    if (quatJerk.length > 1) {
      const acc = Math.abs(ang - quatJerk[quatJerk.length - 2]) / dt;
      quatAccel.push(acc);
      if (acc > 5) {
        spikes.push({
          t: (i * dt).toFixed(2),
          acc: acc.toFixed(1),
          yawRate: swimmer.yawRate.toFixed(3),
          roll: (right.y).toFixed(3),
          edge: Math.min(62 - Math.abs(swimmer.pos.x), 62 - Math.abs(swimmer.pos.z)).toFixed(1),
        });
      }
    }

    // 侧倾（右向量的 y 分量）
    if (prevRight) {
      const rollDelta = Math.abs(right.y - prevRight.y) / dt;
      rollJerk.push(rollDelta);
    }
  }

  const yawAcc = Math.abs(swimmer.yawRate - prevYawRate) / dt;
  yawRateJerk.push(yawAcc);

  // 转向方向翻转次数（撞墙时会来回翻）
  const s = Math.sign(swimmer.yawRate);
  if (s !== 0 && lastSign !== 0 && s !== lastSign) signFlips++;
  if (s !== 0) lastSign = s;

  // 记录离边界很近的时刻
  const edgeDist = Math.min(62 - Math.abs(swimmer.pos.x), 62 - Math.abs(swimmer.pos.z));
  if (edgeDist < 14) nearEdge.push({ t: i * dt, yawAcc, roll: Math.abs(right.y), yawRate: swimmer.yawRate });

  prevQuat = q;
  prevRight = right;
  prevYawRate = swimmer.yawRate;
}

const stat = (arr, name, unit) => {
  if (!arr.length) return;
  const s = [...arr].sort((a, b) => a - b);
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  const p95 = s[Math.floor(s.length * 0.95)];
  const p99 = s[Math.floor(s.length * 0.99)];
  console.log(
    `${name.padEnd(20)} 平均 ${mean.toFixed(3).padStart(7)}${unit}  p95 ${p95.toFixed(3).padStart(7)}${unit}  ` +
    `p99 ${p99.toFixed(3).padStart(7)}${unit}  最大 ${s[s.length - 1].toFixed(3).padStart(7)}${unit}`
  );
};

console.log(`=== 第一人称 ${SECONDS} 秒镜头稳定性 ===\n`);
stat(quatJerk, '相机角速度', ' rad/s');
stat(quatAccel, '相机角加速度', ' rad/s²');
stat(rollJerk, '侧倾变化率', ' /s');
stat(yawRateJerk, '鲸鱼转向加速度', ' rad/s²');

console.log('');
// 鲸鱼正常巡游也会换向，所以这里只做参考，不作为判定依据。
// 真正的抖动判据是上面的「相机角加速度」和「尖峰数」。
console.log('转向方向翻转次数:', signFlips, '（参考值：正常巡游也会换向，不作为抖动判据）');
console.log('贴近边界(<14)的采样:', nearEdge.length, '个');

if (nearEdge.length) {
  const nearRoll = nearEdge.map((e) => e.roll);
  const nearYawAcc = nearEdge.map((e) => e.yawAcc);
  console.log('  边界附近 侧倾最大值:', Math.max(...nearRoll).toFixed(3));
  console.log('  边界附近 转向加速度最大:', Math.max(...nearYawAcc).toFixed(2), 'rad/s²');
}

if (spikes.length) {
  console.log('');
  console.log('=== 相机角加速度尖峰（>5 rad/s²）===');
  console.log('共', spikes.length, '次，前 8 次：');
  spikes.slice(0, 8).forEach((s) => {
    console.log(
      `  t=${s.t}s  角加速度=${s.acc}  yawRate=${s.yawRate}  侧倾=${s.roll}  离边界=${s.edge}`
    );
  });
} else {
  console.log('\n✅ 无角加速度尖峰');
}
