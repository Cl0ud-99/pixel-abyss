// 验证：鲸鱼在扩大后的场景里是否真的在游动（不是原地打转）
import * as THREE from 'three';
import { WhaleSwimmer } from '../src/whaleAI.js';

const WORLD = { x: 62, y: 20, z: 62 };
const root = new THREE.Group();
const sw = new WhaleSwimmer({
  root,
  bounds: { x: WORLD.x, y: WORLD.y, z: WORLD.z },
  margin: 10,
  speed: 4.2,
  turnRate: 1.15,
  minY: 2,
  maxY: 14,
});

const dt = 1 / 60;
const STEPS = 60 * 600; // 10 分钟

let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9, minZ = 1e9, maxZ = -1e9;
let violations = 0;
let totalDistance = 0;
let prev = sw.pos.clone();
let yawFlips = 0;
let lastSign = 0;
let yOutOfRange = 0;

// 覆盖率：把水平面切成格子，看鲸鱼去过多少
const GRID = 10;
const visited = new Set();

for (let i = 0; i < STEPS; i++) {
  sw.update(dt);
  const p = sw.pos;
  minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
  minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
  minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
  if (Math.abs(p.x) > WORLD.x + 1e-6 || Math.abs(p.z) > WORLD.z + 1e-6) violations++;
  if (p.y < -12.5 || p.y > 12.5) yOutOfRange++;
  totalDistance += p.distanceTo(prev);
  prev.copy(p);
  const s = Math.sign(sw.yawVel);
  if (s !== 0 && s !== lastSign) { yawFlips++; lastSign = s; }
  visited.add(`${Math.floor(p.x / 12)},${Math.floor(p.z / 12)}`);
}

console.log('=== 10 分钟游动统计 ===');
console.log('活动范围 X:', minX.toFixed(1), '..', maxX.toFixed(1), ' (边界 ±' + WORLD.x + ')');
console.log('活动范围 Y:', minY.toFixed(1), '..', maxY.toFixed(1), ' (限制 -12..12)');
console.log('活动范围 Z:', minZ.toFixed(1), '..', maxZ.toFixed(1), ' (边界 ±' + WORLD.z + ')');
console.log('越界帧数:', violations, ' 高度越限帧数:', yOutOfRange);
console.log('总游动距离:', totalDistance.toFixed(0), '单位');
console.log('平均速度:', (totalDistance / (STEPS * dt)).toFixed(2), '单位/秒');
console.log('转向次数:', yawFlips);
console.log('水平覆盖率:', visited.size, '个格子 (共约', Math.ceil((WORLD.x * 2 / 12) ** 2), '个)');
