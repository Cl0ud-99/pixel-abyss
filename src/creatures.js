// 海底生物群 —— 全部用体素堆出来
//
// 每个 build 函数返回：
//   { parts: [{ name, voxels:[{x,y,z,kind}], pivot:[x,y,z] }], palette: {...}, length }
// parts 里的 pivot 是摆动枢轴（世界坐标以体素为单位），没有摆动就给 [0,0,0]。

import {
  Grid,
  ellipsoid,
  taperedLimb,
  fillBox,
  fillPolyXY,
  fillPolyXZ,
} from './voxel.js';

// ─────────────────────────────────────────────────────────────
// 通用小鱼（热带鱼体型）：侧扁，尾鳍竖着张开
// 参数化尺寸，用来做多种不同大小的鱼
// ─────────────────────────────────────────────────────────────
function buildFish({
  len = 10, // 体长（体素）
  height = 6, // 体高
  thick = 1.6, // 体厚（侧扁）
  palette,
  pattern = 'plain', // plain | stripe | spot
  finScale = 1,
}) {
  const g = new Grid();
  const halfL = len / 2;
  const cy = 0;

  // 身体：侧扁的主椭球（厚只有长的 1/6 左右，鱼是扁的）
  const bodyThick = Math.max(1, thick * 0.72);
  ellipsoid(g, 0, cy, 0, halfL * 0.6, height / 2, bodyThick, 'body');
  ellipsoid(g, halfL * 0.36, cy + 0.2, 0, halfL * 0.38, (height / 2) * 0.8, bodyThick * 0.8, 'body');
  // 头部
  ellipsoid(g, -halfL * 0.56, cy + 0.1, 0, halfL * 0.32, (height / 2) * 0.84, bodyThick * 0.88, 'body');

  // 尾鳍：竖着张开的小三角（单层薄片，鱼尾是竖的）
  const tailX = halfL * 0.84;
  fillPolyXY(
    g,
    [
      [tailX - 0.5, -height * 0.24 * finScale],
      [tailX + len * 0.12, -height * 0.42 * finScale],
      [tailX + len * 0.14, 0],
      [tailX + len * 0.12, height * 0.42 * finScale],
      [tailX - 0.5, height * 0.24 * finScale],
    ],
    0,
    0,
    'fin'
  );

  // 背鳍（单层薄片）
  fillPolyXY(
    g,
    [
      [-len * 0.12, height * 0.38],
      [len * 0.16, height * 0.36],
      [len * 0.07, height * 0.58 * finScale],
      [-len * 0.05, height * 0.56 * finScale],
    ],
    0,
    0,
    'fin'
  );

  // 腹鳍（单层薄片）
  fillPolyXY(
    g,
    [
      [-len * 0.07, -height * 0.36],
      [len * 0.1, -height * 0.34],
      [len * 0.03, -height * 0.52 * finScale],
    ],
    0,
    0,
    'fin'
  );

  // 胸鳍（两侧小片，贴在身体侧面）
  for (const side of [-1, 1]) {
    fillPolyXY(
      g,
      [
        [-len * 0.1, -1.0],
        [len * 0.07, -1.4],
        [len * 0.02, 1.0],
        [-len * 0.12, 0.8],
      ],
      side > 0 ? Math.ceil(bodyThick * 0.7) : -Math.ceil(bodyThick * 0.7),
      side > 0 ? Math.ceil(bodyThick * 0.7) : -Math.ceil(bodyThick * 0.7),
      'finSide'
    );
  }

  // 眼睛：头部两侧
  const ex = -Math.round(halfL * 0.6);
  const ey = Math.round(height * 0.16);
  const ez = Math.ceil(bodyThick * 0.75);
  for (const side of [-1, 1]) {
    g.set(ex, ey, side * ez, 'eye');
    g.set(ex + 1, ey, side * ez, 'eye');
    g.set(ex, ey + 1, side * ez, 'eye');
  }

  // 花纹
  if (pattern === 'stripe') {
    for (let x = -Math.round(halfL * 0.3); x <= Math.round(halfL * 0.45); x += 3) {
      g.recolor((v) => v.x === x && v.kind === 'body', 'stripe');
    }
  } else if (pattern === 'spot') {
    const spots = [
      [-2, 1], [1, -1], [3, 1], [-4, -1],
    ];
    for (const [sx, sy] of spots) {
      g.recolor(
        (v) => v.kind === 'body' && Math.abs(v.x - sx) <= 1 && Math.abs(v.y - sy) <= 1,
        'spot'
      );
    }
  }

  // 上色：背部深、腹部浅
  g.recolor((v) => v.kind === 'body' && v.y > height * 0.12, 'back');
  g.recolor((v) => v.kind === 'body' && v.y < -height * 0.18, 'belly');

  return {
    parts: [{ name: 'main', voxels: g.toArray(), pivot: [0, 0, 0] }],
    palette,
    length: len,
  };
}

// ─────────────────────────────────────────────────────────────
// 小丑鱼：橙白条纹，体型小
// ─────────────────────────────────────────────────────────────
export function buildClownfish() {
  return buildFish({
    len: 9,
    height: 5.2,
    thick: 2.0,
    pattern: 'stripe',
    finScale: 1.0,
    palette: {
      back: '#F97316',
      body: '#FB923C',
      belly: '#FDBA74',
      stripe: '#FFF7ED',
      fin: '#F97316',
      finSide: '#FDBA74',
      eye: '#0A0A0A',
    },
  });
}

// ─────────────────────────────────────────────────────────────
// 蓝吊（像「多莉」）：蓝色身体、黄色尾鳍
// ─────────────────────────────────────────────────────────────
export function buildBlueTang() {
  const fish = buildFish({
    len: 10,
    height: 7,
    thick: 1.9,
    pattern: 'plain',
    finScale: 1.05,
    palette: {
      back: '#1D4ED8',
      body: '#3B82F6',
      belly: '#93C5FD',
      fin: '#FACC15',
      finSide: '#2563EB',
      eye: '#0A0A0A',
    },
  });
  return fish;
}

// ─────────────────────────────────────────────────────────────
// 黄高鳍鱼（黄色小鱼）
// ─────────────────────────────────────────────────────────────
export function buildYellowFish() {
  return buildFish({
    len: 7,
    height: 5.5,
    thick: 1.6,
    pattern: 'plain',
    finScale: 1.15,
    palette: {
      back: '#EAB308',
      body: '#FACC15',
      belly: '#FDE68A',
      fin: '#F59E0B',
      finSide: '#FACC15',
      eye: '#0A0A0A',
    },
  });
}

// ─────────────────────────────────────────────────────────────
// 神仙鱼：高瘦、有长鳍（银蓝底 + 深色条纹）
// ─────────────────────────────────────────────────────────────
export function buildAngelfish() {
  return buildFish({
    len: 8,
    height: 9,
    thick: 1.2,
    pattern: 'stripe',
    finScale: 1.25,
    palette: {
      back: '#7FA8E8',
      body: '#A8C8F5',
      belly: '#DCEBFF',
      stripe: '#1E3A8A',
      fin: '#8FB4EA',
      finSide: '#A8C8F5',
      eye: '#0A0A0A',
    },
  });
}

// ─────────────────────────────────────────────────────────────
// 水母：伞盖 + 飘动的触手
// ─────────────────────────────────────────────────────────────
export function buildJellyfish() {
  const bell = new Grid();
  // 伞盖：扁半球（用椭球切掉下半部）
  const r = 4.6;
  ellipsoid(bell, 0, 0, 0, r, r * 0.55, r, 'bell');
  bell.keep((v) => v.y >= -0.5);
  // 伞盖内壁颜色
  bell.recolor((v) => v.y < 0, 'bellInner');

  // 触手：从伞盖边缘垂下，细而长
  const tentacles = [];
  const N = 8;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    const tx = Math.cos(a) * r * 0.62;
    const tz = Math.sin(a) * r * 0.62;
    const len = 9 + (i % 4) * 3.5;
    const tg = new Grid();
    // 两段：先直下，末端微微散开
    taperedLimb(tg, [0, 0, 0], [Math.cos(a) * 0.5, -len * 0.65, Math.sin(a) * 0.5], 0.6, 0.48, 'tentacle');
    taperedLimb(
      tg,
      [Math.cos(a) * 0.5, -len * 0.65, Math.sin(a) * 0.5],
      [Math.cos(a) * 1.3, -len, Math.sin(a) * 1.3],
      0.48,
      0.32,
      'tentacle'
    );
    tentacles.push({ voxels: tg.toArray(), pivot: [tx, -0.4, tz], phase: (i / N) * Math.PI * 2 });
  }

  return {
    parts: [
      { name: 'bell', voxels: bell.toArray(), pivot: [0, 0, 0] },
      ...tentacles.map((t, i) => ({ name: 'tentacle' + i, voxels: t.voxels, pivot: t.pivot })),
    ],
    palette: {
      bell: '#C084FC',
      bellInner: '#E9D5FF',
      tentacle: '#A855F7',
    },
    length: 9,
  };
}

// ─────────────────────────────────────────────────────────────
// 海龟：背甲 + 四肢 + 头
// ─────────────────────────────────────────────────────────────
export function buildTurtle() {
  const shell = new Grid();

  // 背甲：扁椭球
  ellipsoid(shell, 0, 0, 0, 6.2, 2.2, 5.4, 'shell');
  // 甲壳纹路
  shell.recolor((v) => v.kind === 'shell' && (v.x + v.z) % 4 === 0, 'shellLine');

  // 腹甲
  const belly = new Grid();
  ellipsoid(belly, 0, -1.9, 0, 5.4, 0.8, 4.6, 'bellyPlate');

  // 头
  const head = new Grid();
  ellipsoid(head, -7.0, -0.4, 0, 2.2, 1.8, 1.8, 'skin');
  head.set(-8, 0, 2, 'eye');
  head.set(-8, 0, -2, 'eye');

  // 四肢：四只鳍状肢，从甲壳边缘向外伸出
  // 关键：起点要在甲壳外侧（背甲 x:-6..6, z:-5..5），否则整条肢体会被甲壳包住看不见
  const limbs = [];
  const limbDefs = [
    // 前肢：长而向外张开，像海龟的划水鳍（比甲壳长约 1.4 倍）
    { from: [-4.0, -1.0, 4.0], to: [-9.5, -2.6, 9.8], r0: 2.6, r1: 1.3, name: 'flFrontR' },
    { from: [-4.0, -1.0, -4.0], to: [-9.5, -2.6, -9.8], r0: 2.6, r1: 1.3, name: 'flFrontL' },
    // 后肢：稍短
    { from: [4.0, -1.0, 4.0], to: [8.6, -2.4, 9.0], r0: 2.2, r1: 1.1, name: 'flBackR' },
    { from: [4.0, -1.0, -4.0], to: [8.6, -2.4, -9.0], r0: 2.2, r1: 1.1, name: 'flBackL' },
  ];
  for (const d of limbDefs) {
    const lg = new Grid();
    taperedLimb(
      lg,
      [0, 0, 0],
      [d.to[0] - d.from[0], d.to[1] - d.from[1], d.to[2] - d.from[2]],
      d.r0,
      d.r1,
      'flipper'
    );
    limbs.push({ name: d.name, voxels: lg.toArray(), pivot: d.from });
  }

  // 小尾巴
  const tail = new Grid();
  ellipsoid(tail, 0, 0, 0, 1.4, 0.7, 0.9, 'skin');

  return {
    parts: [
      { name: 'shell', voxels: shell.toArray(), pivot: [0, 0, 0] },
      { name: 'bellyPlate', voxels: belly.toArray(), pivot: [0, 0, 0] },
      { name: 'head', voxels: head.toArray(), pivot: [0, 0, 0] },
      { name: 'tail', voxels: tail.toArray(), pivot: [6.0, -0.2, 0] },
      ...limbs,
    ],
    palette: {
      shell: '#3F6212',
      shellLine: '#365314',
      bellyPlate: '#FEF3C7',
      skin: '#65A30D',
      flipper: '#84CC16', // 鳍状肢比甲壳亮，场景里能分辨出来
      eye: '#0A0A0A',
    },
    length: 14,
  };
}

// ─────────────────────────────────────────────────────────────
// 章鱼：圆脑袋 + 八条触手
// ─────────────────────────────────────────────────────────────
export function buildOctopus() {
  const head = new Grid();
  // 圆润的头：底部收窄的椭球
  ellipsoid(head, 0, 1.4, 0, 3.8, 4.4, 3.8, 'head');
  head.keep((v) => v.y >= -2.2);
  // 眼睛：大而突出
  for (const side of [-1, 1]) {
    ellipsoid(head, -1.8, 1.2, side * 3.2, 1.0, 1.1, 0.7, 'eye');
    head.set(-2, 1, side * 3, 'eyeHi');
  }

  const arms = [];
  const N = 8;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    const ag = new Grid();
    const dx = Math.cos(a);
    const dz = Math.sin(a);
    // 触手：先水平伸出，再垂下去，末端收细
    const midX = dx * 3.0;
    const midZ = dz * 3.0;
    taperedLimb(ag, [0, 0, 0], [midX, -0.8, midZ], 1.15, 0.9, 'arm');
    taperedLimb(ag, [midX, -0.8, midZ], [dx * 4.4, -3.6, dz * 4.4], 0.9, 0.7, 'arm');
    taperedLimb(ag, [dx * 4.4, -3.6, dz * 4.4], [dx * 5.2, -6.2, dz * 5.2], 0.7, 0.4, 'armTip');
    arms.push({
      name: 'arm' + i,
      voxels: ag.toArray(),
      pivot: [dx * 1.5, -1.6, dz * 1.5],
      phase: a,
    });
  }

  return {
    parts: [
      { name: 'head', voxels: head.toArray(), pivot: [0, 0, 0] },
      ...arms.map((a) => ({ name: a.name, voxels: a.voxels, pivot: a.pivot })),
    ],
    palette: {
      head: '#DB2777',
      arm: '#BE185D',
      armTip: '#9D174D',
      eye: '#0A0A0A',
      eyeHi: '#FFFFFF',
    },
    length: 12,
  };
}

// ─────────────────────────────────────────────────────────────
// 海星：五角星，躺在海床上
// ─────────────────────────────────────────────────────────────
export function buildStarfish() {
  const g = new Grid();
  const R = 5.2;
  const r = 1.7;
  const pts = [];
  const arms = 5;
  for (let i = 0; i < arms * 2; i++) {
    const a = (i / (arms * 2)) * Math.PI * 2 - Math.PI / 2;
    const rad = i % 2 === 0 ? R : r;
    pts.push([Math.cos(a) * rad, Math.sin(a) * rad]);
  }
  // 五角星本体：两层厚
  fillPolyXZ(g, pts, 0, 1, 'star');
  // 中心隆起成圆丘
  ellipsoid(g, 0, 1.4, 0, 2.2, 1.6, 2.2, 'starTop');
  // 每条臂中间隆起一条脊
  for (let i = 0; i < arms; i++) {
    const a = (i / arms) * Math.PI * 2 - Math.PI / 2;
    taperedLimb(
      g,
      [Math.cos(a) * 1.6, 1.0, Math.sin(a) * 1.6],
      [Math.cos(a) * (R - 1.2), 0.4, Math.sin(a) * (R - 1.2)],
      1.0,
      0.6,
      'starTop'
    );
  }
  // 表面斑点
  g.recolor((v) => v.kind === 'star' && (v.x * 3 + v.z * 5) % 7 === 0, 'starSpot');

  return {
    parts: [{ name: 'star', voxels: g.toArray(), pivot: [0, 0, 0] }],
    palette: {
      star: '#F97316',
      starTop: '#FB923C',
      starSpot: '#EA580C',
    },
    length: 11,
  };
}

// ─────────────────────────────────────────────────────────────
// 珊瑚：分叉的枝状体
// ─────────────────────────────────────────────────────────────
export function buildCoral({ hue = 0 } = {}) {
  const g = new Grid();
  const palettes = [
    { main: '#F472B6', tip: '#FBCFE8' },
    { main: '#FB7185', tip: '#FECDD3' },
    { main: '#FBBF24', tip: '#FDE68A' },
    { main: '#A78BFA', tip: '#DDD6FE' },
  ];
  const p = palettes[hue % palettes.length];

  // 主干 + 递归分叉（更高更饱满）
  const branch = (x, y, z, dx, dy, dz, len, radius, depth) => {
    const ex = x + dx * len;
    const ey = y + dy * len;
    const ez = z + dz * len;
    taperedLimb(g, [x, y, z], [ex, ey, ez], radius, radius * 0.74, depth > 0 ? 'branch' : 'tip');
    if (depth > 0) {
      branch(ex, ey, ez, dx * 0.7 + 0.55, dy, dz * 0.7 + 0.45, len * 0.74, radius * 0.74, depth - 1);
      branch(ex, ey, ez, dx * 0.7 - 0.55, dy, dz * 0.7 - 0.45, len * 0.74, radius * 0.74, depth - 1);
      branch(ex, ey, ez, dx * 0.4, dy, dz * 0.95, len * 0.62, radius * 0.72, depth - 1);
      branch(ex, ey, ez, dx * 0.95, dy, dz * 0.3, len * 0.6, radius * 0.7, depth - 1);
    }
  };
  branch(0, 0, 0, 0, 1, 0, 4.2, 1.8, 3);

  // 底部基座，让它稳稳坐在沙地上
  ellipsoid(g, 0, 0.4, 0, 2.4, 0.9, 2.4, 'branch');

  return {
    parts: [{ name: 'coral', voxels: g.toArray(), pivot: [0, 0, 0] }],
    palette: { branch: p.main, tip: p.tip },
    length: 13,
  };
}

// ─────────────────────────────────────────────────────────────
// 海草：一丛摆动的长条
// ─────────────────────────────────────────────────────────────
export function buildSeagrass() {
  const blades = [];
  const N = 8;
  for (let i = 0; i < N; i++) {
    const g = new Grid();
    const h = 11 + (i % 5) * 4;
    const bend = ((i % 3) - 1) * 1.4;
    for (let y = 0; y <= h; y++) {
      const t = y / h;
      const x = Math.round(bend * t * t * 4);
      g.set(x, y, 0, y > h * 0.72 ? 'bladeTip' : 'blade');
      if (y < h * 0.35) g.set(x, y, 1, 'blade'); // 根部加厚
    }
    blades.push({
      name: 'blade' + i,
      voxels: g.toArray(),
      pivot: [0, 0, 0],
      offset: [(i - N / 2) * 1.3, 0, ((i % 2) - 0.5) * 1.3],
      phase: (i / N) * Math.PI * 2,
    });
  }

  return {
    parts: blades.map((b) => ({ name: b.name, voxels: b.voxels, pivot: b.pivot, offset: b.offset })),
    palette: { blade: '#22C55E', bladeTip: '#86EFAC' },
    length: 8,
  };
}

// ─────────────────────────────────────────────────────────────
// 导出目录：名字、构建函数、数量、体型缩放
// ─────────────────────────────────────────────────────────────
export const CREATURES = [
  { key: 'clownfish', label: '小丑鱼', build: buildClownfish, count: 6, scale: 1.0, speed: 1.5 },
  { key: 'blueTang', label: '蓝吊', build: buildBlueTang, count: 5, scale: 1.15, speed: 1.25 },
  { key: 'yellowFish', label: '黄高鳍鱼', build: buildYellowFish, count: 7, scale: 0.85, speed: 1.75 },
  { key: 'angelfish', label: '神仙鱼', build: buildAngelfish, count: 3, scale: 1.0, speed: 1.1 },
  { key: 'jellyfish', label: '水母', build: buildJellyfish, count: 4, scale: 1.3, speed: 0.35 },
  { key: 'turtle', label: '海龟', build: buildTurtle, count: 2, scale: 1.5, speed: 0.7 },
  { key: 'octopus', label: '章鱼', build: buildOctopus, count: 2, scale: 1.4, speed: 0.5 },
];
