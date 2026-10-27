// 验证：撞墙时仍能急转，平时不急转
import * as THREE from 'three';
import { WhaleSwimmer } from '../src/whaleAI.js';

const root = new THREE.Group();
const sw = new WhaleSwimmer({
  root, bounds: { x: 62, y: 20, z: 62 }, margin: 12,
  speed: 4.2, turnRate: 1.05, turnGain: 2.0, turnAccel: 2.4,
  minY: -2, maxY: 9,
});

const dt = 1 / 60;
const SECONDS = 900; // 15 分钟，保证能采到足够的贴边样本
const SHARP = 0.7;

let sharpNear = 0, framesNear = 0;
let sharpFar = 0, framesFar = 0;
let maxYawNear = 0, maxYawFar = 0;
let violations = 0;
let maxDist = 0;

for (let i = 0; i < 60 * SECONDS; i++) {
  sw.update(dt);

  const room = Math.min(62 - Math.abs(sw.pos.x), 62 - Math.abs(sw.pos.z));
  const near = room < 20;
  const ay = Math.abs(sw.yawRate);

  if (near) {
    framesNear++;
    if (ay > SHARP) sharpNear++;
    maxYawNear = Math.max(maxYawNear, ay);
  } else {
    framesFar++;
    if (ay > SHARP) sharpFar++;
    maxYawFar = Math.max(maxYawFar, ay);
  }

  if (Math.abs(sw.pos.x) > 62.01 || Math.abs(sw.pos.z) > 62.01) violations++;
  maxDist = Math.max(maxDist, Math.hypot(sw.pos.x, sw.pos.z));
}

const pct = (a, b) => (b > 0 ? (a / b * 100).toFixed(1) : '0.0');

console.log(`=== ${SECONDS} 秒验证 ===\n`);
console.log('总体急转弯占比:', pct(sharpNear + sharpFar, framesNear + framesFar) + '%');
console.log('');
console.log('贴边时（<20）:');
console.log('  采样占比:', pct(framesNear, framesNear + framesFar) + '%');
console.log('  急转弯占比:', pct(sharpNear, framesNear) + '%   ← 这里应该偏高（撞墙要能急转）');
console.log('  最大角速度:', maxYawNear.toFixed(2), 'rad/s');
console.log('');
console.log('远离边界时（>=20）:');
console.log('  急转弯占比:', pct(sharpFar, framesFar) + '%   ← 这里应该很低（悠闲巡游）');
console.log('  最大角速度:', maxYawFar.toFixed(2), 'rad/s');
console.log('');
console.log('越界帧数:', violations, violations === 0 ? '✅' : '❌');
console.log('最远离中心:', maxDist.toFixed(1), '/ 62');
