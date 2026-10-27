// 验证跟随相机的三种状态：跟随中 / 用户拖拽中 / 松手后恢复
import * as THREE from 'three';
import { WhaleSwimmer, FollowCamera } from '../src/whaleAI.js';

// 简易的 OrbitControls 替身：只要能触发 start/end 事件即可
class FakeControls extends THREE.EventDispatcher {
  constructor() {
    super();
    this.target = new THREE.Vector3();
  }
  update() {}
}

const camera = new THREE.PerspectiveCamera(40, 1.6, 0.1, 500);
const controls = new FakeControls();
const root = new THREE.Group();
const sw = new WhaleSwimmer({
  root,
  bounds: { x: 62, y: 20, z: 62 },
  margin: 10,
  speed: 4.2,
  turnRate: 1.15,
  minY: -5,
  maxY: 11,
});
const fc = new FollowCamera(camera, controls, { distance: 14, height: 6 });

const dt = 1 / 60;
const log = [];

function step(n, label) {
  for (let i = 0; i < n; i++) {
    sw.update(dt);
    fc.update(dt, sw);
  }
  const d = camera.position.distanceTo(sw.pos);
  log.push(`${label.padEnd(22)} enabled=${String(fc.enabled).padEnd(5)} 相机-鲸鱼距离=${d.toFixed(2)}`);
}

// 1. 正常跟随 2 秒
step(120, '跟随 2s');

// 2. 模拟用户开始拖拽（按住不动）
controls.dispatchEvent({ type: 'start' });
step(60, '拖拽中 1s');
step(180, '拖拽中 4s(总)');

// 3. 用户松手
controls.dispatchEvent({ type: 'end' });
step(30, '松手 0.5s');
step(120, '松手 2.5s');
step(180, '松手 5.5s');

console.log('=== 相机状态机验证 ===');
log.forEach((l) => console.log(l));

// 检查：拖拽中不应重新启用
const draggingLogs = log.filter((l) => l.includes('拖拽中'));
const bad = draggingLogs.filter((l) => l.includes('enabled=true'));
console.log('\n拖拽中被抢控制权次数:', bad.length, bad.length === 0 ? '✅ 正常' : '❌ 有问题');

const afterRelease = log.filter((l) => l.includes('松手 5.5s'));
console.log('松手后是否恢复跟随:', afterRelease[0].includes('enabled=true') ? '✅ 是' : '❌ 否');
