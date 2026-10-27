import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { buildWhale, PALETTE, VOXEL } from './whaleShape.js';
import {
  buildClownfish, buildBlueTang, buildYellowFish, buildAngelfish,
  buildJellyfish, buildTurtle, buildOctopus, buildStarfish,
  buildCoral, buildSeagrass,
} from './creatures.js';
import { FishSchool, JellyfishGroup, TurtleGroup, OctopusGroup, SeabedGroup } from './sea.js';
import { WhaleSwimmer, FollowCamera } from './whaleAI.js';
import { FreeFlyCamera } from './freeCam.js';
import { FirstPersonCamera } from './firstPerson.js';
import { spawnBubbles, buildLogoMark, bindStart } from './splash.js';

// ─────────────────────────────────────────────────────────────
// 世界尺寸：场景比之前大得多，鲸鱼才有地方真正游起来
// ─────────────────────────────────────────────────────────────
const WORLD = {
  x: 62, // 半宽（总长 124）
  y: 20, // 半高
  z: 62,
  seabedY: -24, // 海床高度
};

// ─────────────────────────────────────────────────────────────
// 渲染器
// ─────────────────────────────────────────────────────────────
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
// 关键：不显式设置时 three.js 会把颜色压得很暗
renderer.toneMapping = THREE.NoToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);
const canvas = renderer.domElement;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(40, 1, 0.5, 400);

// ─────────────────────────────────────────────────────────────
// 水下渐变背景
// ─────────────────────────────────────────────────────────────
function gradientTexture() {
  const c = document.createElement('canvas');
  c.width = 4;
  c.height = 256;
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0.0, '#1B3AA8');
  g.addColorStop(0.30, '#132C86');
  g.addColorStop(0.62, '#0B1B57');
  g.addColorStop(1.0, '#040A26');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 4, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  return tex;
}
scene.background = gradientTexture();
scene.fog = new THREE.Fog(0x0B1B57, 80, 260);

// ─────────────────────────────────────────────────────────────
// 光照
// ─────────────────────────────────────────────────────────────
scene.add(new THREE.HemisphereLight(0xE0ECFF, 0x2A3A8A, 3.4));

const key = new THREE.DirectionalLight(0xFFFFFF, 4.2);
key.position.set(-18, 26, 20);
scene.add(key);

const rim = new THREE.DirectionalLight(0xA8C0FF, 3.2);
rim.position.set(20, 10, -22);
scene.add(rim);

const fill = new THREE.DirectionalLight(0xC8D8FF, 2.2);
fill.position.set(6, -18, 14);
scene.add(fill);

const front = new THREE.DirectionalLight(0xFFFFFF, 2.0);
front.position.set(0, 4, 30);
scene.add(front);

// 海底补光：从上方照下来，让海床和静物看得清
const seabedLight = new THREE.DirectionalLight(0xBFD4FF, 1.6);
seabedLight.position.set(0, 26, 8);
scene.add(seabedLight);

// ─────────────────────────────────────────────────────────────
// 体素蓝鲸
// ─────────────────────────────────────────────────────────────
const { voxels } = buildWhale();

const colorOf = (kind) => new THREE.Color(PALETTE[kind] || PALETTE.mid).convertSRGBToLinear();

// 按部位分组，便于分别做动画
const groups = { body: [], tail: [], fin: [], eye: [], eyeHi: [], spout: [] };
for (const v of voxels) {
  const g = groups[v.kind === 'back' || v.kind === 'mid' || v.kind === 'lower' || v.kind === 'belly' ? 'body' : v.kind];
  (g || groups.body).push(v);
}

const TAIL_PIVOT_X = 11;

const whale = new THREE.Group();
scene.add(whale);

// 所有体素共用一个单位立方体几何
const unitBox = new THREE.BoxGeometry(VOXEL * 0.97, VOXEL * 0.97, VOXEL * 0.97);
const mat = new THREE.MeshStandardMaterial({
  flatShading: true,
  roughness: 0.62,
  metalness: 0.04,
});

function makeMesh(list, material = mat) {
  const mesh = new THREE.InstancedMesh(unitBox, material, list.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const p = new THREE.Vector3();
  const one = new THREE.Vector3(1, 1, 1);
  list.forEach((v, i) => {
    p.set(v.x * VOXEL, v.y * VOXEL, v.z * VOXEL);
    m.compose(p, q, one);
    mesh.setMatrixAt(i, m);
    mesh.setColorAt(i, colorOf(v.kind));
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.frustumCulled = false;
  return mesh;
}

// 躯干 + 眼睛 + 水柱（不参与摆动）
whale.add(makeMesh(groups.body));
if (groups.eye.length) whale.add(makeMesh(groups.eye));
if (groups.eyeHi.length) whale.add(makeMesh(groups.eyeHi));
whale.add(makeMesh(groups.spout));

// 尾鳍：挂到枢轴上做上下摆动
const tailPivot = new THREE.Group();
tailPivot.position.set(TAIL_PIVOT_X * VOXEL, 0, 0);
whale.add(tailPivot);
const tailLocal = groups.tail.map((v) => ({ ...v, x: v.x - TAIL_PIVOT_X }));
tailPivot.add(makeMesh(tailLocal));

// 胸鳍：两侧各自摆动
const finPivots = [];
for (const side of [-1, 1]) {
  const list = groups.fin.filter((v) => Math.sign(v.z) === side);
  if (!list.length) continue;
  const pivot = new THREE.Group();
  pivot.position.set(-7 * VOXEL, -3 * VOXEL, side * 4 * VOXEL);
  whale.add(pivot);
  const local = list.map((v) => ({ ...v, x: v.x + 7, y: v.y + 3, z: v.z - side * 4 }));
  pivot.add(makeMesh(local));
  finPivots.push({ pivot, side });
}

// ─────────────────────────────────────────────────────────────
// 海底地面：细碎的体素沙地
// ─────────────────────────────────────────────────────────────
const SEABED_Y = WORLD.seabedY;
const seabedGroup = new THREE.Group();
scene.add(seabedGroup);

{
  const TILE = 1.6;
  const RANGE = 68;
  // 略微放大，让相邻砖块重叠，避免出现黑缝
  const sandGeo = new THREE.BoxGeometry(TILE * 1.04, 0.8, TILE * 1.04);
  const sandMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#6B7FA8').convertSRGBToLinear(),
    flatShading: true,
    roughness: 0.95,
  });

  const cells = [];
  for (let x = -RANGE; x <= RANGE; x += TILE) {
    for (let z = -RANGE; z <= RANGE; z += TILE) {
      const dist = Math.hypot(x, z);
      if (dist > RANGE) continue;
      // 边缘淡出，避免看到硬边
      if (dist > RANGE - 12 && Math.random() < (dist - (RANGE - 12)) / 12) continue;
      cells.push({ x, z, h: Math.random() * 0.5 });
    }
  }

  const sandMesh = new THREE.InstancedMesh(sandGeo, sandMat, cells.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const p = new THREE.Vector3();
  const one = new THREE.Vector3(1, 1, 1);
  cells.forEach((c, i) => {
    p.set(c.x, SEABED_Y - c.h, c.z);
    m.compose(p, q, one);
    sandMesh.setMatrixAt(i, m);
  });
  sandMesh.instanceMatrix.needsUpdate = true;
  sandMesh.frustumCulled = false;
  seabedGroup.add(sandMesh);
}

// ─────────────────────────────────────────────────────────────
// 海底静物：海星、珊瑚、海草
// ─────────────────────────────────────────────────────────────
const seabed = new SeabedGroup();
scene.add(seabed.group);

{
  // 海星：散落在沙地上
  for (let i = 0; i < 26; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = 8 + Math.random() * 48;
    seabed.place(buildStarfish(), {
      position: new THREE.Vector3(Math.cos(a) * r, SEABED_Y + 0.35, Math.sin(a) * r),
      scale: 0.8 + Math.random() * 0.6,
      rotationY: Math.random() * Math.PI * 2,
    });
  }

  // 珊瑚：成簇分布
  for (let c = 0; c < 16; c++) {
    const a = (c / 16) * Math.PI * 2 + Math.random() * 0.4;
    const r = 16 + Math.random() * 44;
    const cx = Math.cos(a) * r;
    const cz = Math.sin(a) * r;
    const hue = c % 4;
    for (let k = 0; k < 2 + Math.floor(Math.random() * 3); k++) {
      seabed.place(buildCoral({ hue: hue + k }), {
        position: new THREE.Vector3(
          cx + (Math.random() - 0.5) * 6,
          SEABED_Y + 0.3,
          cz + (Math.random() - 0.5) * 6
        ),
        scale: 1.0 + Math.random() * 0.9,
        rotationY: Math.random() * Math.PI * 2,
      });
    }
  }

  // 海草：一丛丛的
  for (let c = 0; c < 22; c++) {
    const a = (c / 22) * Math.PI * 2 + Math.random() * 0.3;
    const r = 10 + Math.random() * 52;
    const cx = Math.cos(a) * r;
    const cz = Math.sin(a) * r;
    for (let k = 0; k < 3; k++) {
      seabed.placeSeagrass(buildSeagrass(), {
        position: new THREE.Vector3(
          cx + (Math.random() - 0.5) * 4,
          SEABED_Y + 0.3,
          cz + (Math.random() - 0.5) * 4
        ),
        scale: 0.85 + Math.random() * 0.6,
      });
    }
  }
}

// ─────────────────────────────────────────────────────────────
// 鱼群
// ─────────────────────────────────────────────────────────────
const clownfishSchool = new FishSchool({
  build: buildClownfish, scale: 1.3, count: 14, speed: 0.24,
  radiusX: 30, radiusZ: 26, height: -2, seed: 0.4,
});
scene.add(clownfishSchool.group);

const blueTangSchool = new FishSchool({
  build: buildBlueTang, scale: 1.5, count: 9, speed: 0.2,
  radiusX: 40, radiusZ: 34, height: 6, seed: 2.1,
});
scene.add(blueTangSchool.group);

const yellowFishSchool = new FishSchool({
  build: buildYellowFish, scale: 1.15, count: 16, speed: 0.3,
  radiusX: 22, radiusZ: 20, height: -9, seed: 4.0,
});
scene.add(yellowFishSchool.group);

const angelfishSchool = new FishSchool({
  build: buildAngelfish, scale: 1.35, count: 7, speed: 0.16,
  radiusX: 48, radiusZ: 42, height: 11, seed: 5.6,
});
scene.add(angelfishSchool.group);

// ─────────────────────────────────────────────────────────────
// 水母 / 海龟 / 章鱼
// ─────────────────────────────────────────────────────────────
const jellyfishGroup = new JellyfishGroup({
  build: buildJellyfish, scale: 1.6, count: 12, height: 2, seed: 1.2,
});
scene.add(jellyfishGroup.group);

const turtleGroup = new TurtleGroup({
  build: buildTurtle, scale: 1.9, count: 3, seed: 0.8,
});
scene.add(turtleGroup.group);

const octopusGroup = new OctopusGroup({
  build: buildOctopus, scale: 1.7, count: 3, seed: 3.3,
});
scene.add(octopusGroup.group);

// ─────────────────────────────────────────────────────────────
// 气泡
// ─────────────────────────────────────────────────────────────
const BUBBLE_COUNT = 140;
const bubbleGeo = new THREE.BoxGeometry(1, 1, 1);
const bubbleMat = new THREE.MeshStandardMaterial({
  color: 0xB8D2FF,
  emissive: 0x2B45C9,
  emissiveIntensity: 0.35,
  roughness: 0.35,
  metalness: 0.0,
  transparent: true,
  opacity: 0.75,
  flatShading: true,
});
const bubbles = new THREE.InstancedMesh(bubbleGeo, bubbleMat, BUBBLE_COUNT);
bubbles.frustumCulled = false;
scene.add(bubbles);

const bubbleState = Array.from({ length: BUBBLE_COUNT }, () => ({
  x: (Math.random() - 0.5) * 115,
  y: (Math.random() - 0.5) * 70,
  z: (Math.random() - 0.5) * 115,
  speed: 1.2 + Math.random() * 3.2,
  // 气泡要小：0.05~0.15 世界单位
  size: 0.05 + Math.random() * 0.1,
  phase: Math.random() * Math.PI * 2,
}));

// ─────────────────────────────────────────────────────────────
// 光柱
// ─────────────────────────────────────────────────────────────
const rayGroup = new THREE.Group();
for (let i = 0; i < 11; i++) {
  const plane = new THREE.Mesh(
    new THREE.PlaneGeometry(4 + Math.random() * 7, 130),
    new THREE.MeshBasicMaterial({
      color: 0x6E8BFF,
      transparent: true,
      opacity: 0.045 + Math.random() * 0.04,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
  );
  plane.position.set(-56 + i * 11 + Math.random() * 4, 12, -40 - Math.random() * 30);
  plane.rotation.z = (Math.random() - 0.5) * 0.2;
  rayGroup.add(plane);
}
scene.add(rayGroup);

// ─────────────────────────────────────────────────────────────
// 鲸鱼自主游动 + 相机跟随
// ─────────────────────────────────────────────────────────────
const swimmer = new WhaleSwimmer({
  root: whale,
  bounds: { x: WORLD.x, y: WORLD.y, z: WORLD.z },
  margin: 12,
  speed: 4.2,
  turnRate: 1.05, // 最大角速度（弧度/秒）
  turnGain: 2.0, // P 控制增益
  turnAccel: 2.4, // 角加速度上限，越小转向越柔和
  bankAmount: 0.26,
  maxBank: 0.42,
  minY: -2, // 巡游高度：贴近海底一些，第一人称才看得到海床和生物
  maxY: 9,
  tailPivot,
  finPivots,
});

// ─────────────────────────────────────────────────────────────
// 交互 & 尺寸
// ─────────────────────────────────────────────────────────────
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.07;
controls.enablePan = false;
controls.minDistance = 9;
controls.maxDistance = 70;
controls.minPolarAngle = Math.PI * 0.08;
controls.maxPolarAngle = Math.PI * 0.9;
controls.target.set(0, 0.5, 0);
controls.autoRotate = false;

const followCam = new FollowCamera(camera, controls, {
  distance: 18,
  height: 3.5, // 接近平视：有水下代入感，鲸鱼轮廓清晰
  sideOffset: 0.85,
  lookAhead: 3,
  posStiffness: 4.5, // 位置跟得紧一点，但不抖
  headingStiffness: 1.5, // 朝向慢半拍 → 转弯时相机顺弧线绕
  camStiffness: 2.6,
  lookStiffness: 3.2,
  minCameraY: SEABED_Y + 12, // 别钻进海床
});

camera.position.set(0, 8, 20);
camera.lookAt(controls.target);

// ─────────────────────────────────────────────────────────────
// WASD 自由飞行相机
//   按 W/A/S/D 立刻接管；停手 2.5 秒后自动交还跟随相机
// ─────────────────────────────────────────────────────────────
const freeCam = new FreeFlyCamera(camera, canvas, {
  speed: 16,
  boost: 2.6,
  accel: 7,
  lookSpeed: 0.0024,
  idleDelay: 2.5,
  bounds: { x: WORLD.x + 8, z: WORLD.z + 8 },
  minY: SEABED_Y + 3,
  maxY: WORLD.y + 16,
  onEnter: () => {
    // 自由飞行期间停掉 OrbitControls，避免抢鼠标
    controls.enabled = false;
    followCam.enabled = false;
    followCam.userInteracting = true;
    fpCam.exit();
    setMode('自由飞行');
    setActiveViewBtn('free');
  },
  onExit: () => {
    controls.enabled = true;
    followCam.userInteracting = false;
    followCam.enabled = false; // 交给下面的 idle 逻辑平滑恢复
    followCam.idleTimer = 0;
    followCam._initialized = false;
    setMode('跟随中');
    setActiveViewBtn('follow');
  },
});

// ─────────────────────────────────────────────────────────────
// 鲸鱼第一人称视角
// ─────────────────────────────────────────────────────────────
const fpCam = new FirstPersonCamera(camera, {
  fov: 74,
  bobAmount: 0.07,
  rollAmount: 0.4,
  lagAmount: 0.24,
});

// ─────────────────────────────────────────────────────────────
// 视角模式管理
//   follow  第三人称跟随（默认）
//   first   鲸鱼第一人称
//   free    自由飞行
// ─────────────────────────────────────────────────────────────
let viewMode = 'follow';
const modeEl = document.getElementById('mode');
const modeTextEl = document.getElementById('modeText');
const viewBtnEls = Array.from(document.querySelectorAll('#viewBtns .pixel-btn'));

function setMode(text) {
  if (modeTextEl) modeTextEl.textContent = text;
  if (modeEl) {
    modeEl.classList.toggle('free', text === '自由飞行');
    modeEl.classList.toggle('fp', text === '第一人称');
  }
}

function setActiveViewBtn(mode) {
  viewBtnEls.forEach((b) => b.classList.toggle('active', b.dataset.view === mode));
}

function switchView(mode) {
  if (mode === viewMode) return;

  // 先清掉所有模式的独占状态
  if (freeCam.active) freeCam.exit();
  if (fpCam.active) fpCam.exit();

  viewMode = mode;

  if (mode === 'first') {
    // 第一人称：相机挂到鲸鱼头上，禁掉 OrbitControls
    controls.enabled = false;
    followCam.enabled = false;
    followCam.userInteracting = true;
    fpCam.enter(swimmer);
    setMode('第一人称');
  } else if (mode === 'follow') {
    controls.enabled = true;
    followCam.userInteracting = false;
    followCam.enabled = true;
    followCam._initialized = false;
    followCam.idleTimer = 0;
    setMode('跟随中');
  } else if (mode === 'free') {
    // 自由飞行由 freeCam.enter 自己处理
    freeCam.enter();
    setMode('自由飞行');
  }

  setActiveViewBtn(mode);
}

// 按钮点击
viewBtnEls.forEach((btn) => {
  btn.addEventListener('click', () => switchView(btn.dataset.view));
});

// V 键循环切换视角
window.addEventListener('keydown', (e) => {
  if (e.code !== 'KeyV' || !gameStarted) return;
  e.preventDefault();
  const order = ['follow', 'first', 'free'];
  const next = order[(order.indexOf(viewMode) + 1) % order.length];
  switchView(next);
});

// 开屏期间不响应移动键：把 freeCam 的监听临时摘掉，点了开始再挂上
freeCam.suspend();

let vw = 1;
let vh = 1;
function resize() {
  vw = Math.max(1, innerWidth);
  vh = Math.max(1, innerHeight);
  renderer.setSize(vw, vh, false);
  canvas.style.width = vw + 'px';
  canvas.style.height = vh + 'px';
  camera.aspect = vw / vh;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

// ─────────────────────────────────────────────────────────────
// 动画
// ─────────────────────────────────────────────────────────────
const clock = new THREE.Clock();
const dummy = new THREE.Object3D();
const statsEl = document.getElementById('stats');
const bootEl = document.getElementById('boot');

let frames = 0;
let acc = 0;

function animate() {
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;

  // 鲸鱼自主游动：前进 + 转向 + 提前避让边界
  swimmer.update(dt);

  // 鱼群
  clownfishSchool.update(t, dt);
  blueTangSchool.update(t, dt);
  yellowFishSchool.update(t, dt);
  angelfishSchool.update(t, dt);

  // 水母 / 海龟 / 章鱼 / 海草
  jellyfishGroup.update(t, dt);
  turtleGroup.update(t);
  octopusGroup.update(t);
  seabed.update(t);

  // 气泡上浮
  for (let i = 0; i < BUBBLE_COUNT; i++) {
    const b = bubbleState[i];
    b.y += b.speed * dt;
    if (b.y > 34) {
      b.y = -26;
      b.x = (Math.random() - 0.5) * 110;
      b.z = (Math.random() - 0.5) * 110;
    }
    dummy.position.set(b.x + Math.sin(t * 1.1 + b.phase) * 1.4, b.y, b.z);
    dummy.rotation.set(0, t * 0.5 + b.phase, 0);
    dummy.scale.setScalar(b.size);
    dummy.updateMatrix();
    bubbles.setMatrixAt(i, dummy.matrix);
  }
  bubbles.instanceMatrix.needsUpdate = true;

  // 光柱摇曳
  rayGroup.children.forEach((p, i) => {
    p.rotation.z = Math.sin(t * 0.3 + i) * 0.09;
    p.material.opacity = 0.05 + Math.sin(t * 0.7 + i * 1.6) * 0.03 + 0.03;
  });

  // ── 相机：按视角模式分派 ──
  if (viewMode === 'first') {
    // 第一人称：相机跟着鲸鱼头部走
    fpCam.update(dt, swimmer);
  } else {
    freeCam.update(dt);

    if (freeCam.active) {
      // 自由飞行中：完全由 freeCam 控制
      if (freeCam.isIdle()) freeCam.exit();
    } else {
      followCam.update(dt, swimmer);
      if (!followCam.enabled) {
        controls.update();
      }
    }
  }

  renderer.render(scene, camera);

  frames++;
  acc += dt;
  if (acc >= 0.5) {
    const spd = swimmer.speed.toFixed(1);
    const mode = viewMode === 'first' ? '第一人称'
      : freeCam.active ? '自由飞行'
      : followCam.enabled ? '跟随中' : '自由视角';
    statsEl.textContent = `${Math.round(frames / acc)} FPS · 鲸鱼 ${spd} 单位/秒 · ${mode}`;
    frames = 0;
    acc = 0;
  }
  // 首帧先给个占位，避免统计窗口没走完时出现空面板
  if (!statsEl.textContent) {
    statsEl.textContent = `— FPS · 鲸鱼 ${swimmer.speed.toFixed(1)} 单位/秒 · 跟随中`;
  }

  if (!window.__READY__) {
    window.__READY__ = true;
    if (bootEl) {
      bootEl.classList.add('done');
      setTimeout(() => bootEl.remove(), 600);
    }
    window.__INFO__ = { voxels: voxels.length, revision: THREE.REVISION };
  }

  requestAnimationFrame(animate);
}

// ─────────────────────────────────────────────────────────────
// 开屏页
//   场景在后台已经开始渲染（所以点开始是「无缝」进入），
//   但输入和 HUD 要等点了「开始游玩」才启用。
// ─────────────────────────────────────────────────────────────
let gameStarted = false;

const splashEl = document.getElementById('splash');
const splashBubbles = document.getElementById('splashBubbles');
const logoMark = document.getElementById('logoMark');
const startBtn = document.getElementById('startBtn');
const hudEl = document.getElementById('hud');

// 开屏装饰
spawnBubbles(splashBubbles, 28);
buildLogoMark(logoMark);

// 初始隐藏 HUD，开屏期间只显示开屏页
if (hudEl) hudEl.classList.remove('show');

bindStart(startBtn, splashEl, () => {
  gameStarted = true;
  if (hudEl) hudEl.classList.add('show');
  setActiveViewBtn(viewMode);
  // 让相机从当前状态平滑接管
  followCam._initialized = false;
  followCam.enabled = true;
  controls.enabled = true;
  freeCam.resume();
});

// ── 调试参数：?skip=1 跳过开屏，?view=first|free 直接进指定视角 ──
{
  const qs = new URLSearchParams(location.search);
  if (qs.get('skip') === '1') {
    splashEl.classList.add('hide');
    splashEl.style.display = 'none';
    gameStarted = true;
    if (hudEl) hudEl.classList.add('show');
    freeCam.resume();
    const v = qs.get('view');
    if (v === 'first' || v === 'free' || v === 'follow') {
      switchView(v);
    }
    setActiveViewBtn(viewMode);
  }
}

// 暴露给测试用
window.__GAME__ = {
  get started() { return gameStarted; },
  get viewMode() { return viewMode; },
  switchView,
};

animate();
