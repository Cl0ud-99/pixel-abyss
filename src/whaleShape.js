// 像素蓝鲸 —— DeepSeek 鲸鱼形象的三维体素模型
//
// 思路：不再「挤出侧视轮廓」，而是直接在三维体素网格里用椭球体堆出鲸鱼。
// 这样从任何角度看都是圆的，不会出现「侧面像鲸鱼、俯视像木板」的问题。
//
//   身体   = 一串半径渐变的椭球（头大尾细）
//   尾鳍   = 水平展开的扇形（鲸尾是横着的）
//   胸鳍   = 两侧斜向下的小椭球
//   眼睛   = 头部的深色像素
//   水柱   = 头顶向上的锥形

export const VOXEL = 0.1; // 单个体素边长（世界单位）

// 体素网格范围
export const GRID = {
  x: [-22, 22], // 长（头 -X，尾 +X）
  y: [-11, 11], // 高
  z: [-9, 9], // 宽
};

// DeepSeek 蓝，从背部到腹部渐变
export const PALETTE = {
  back: '#2A42C8',
  mid: '#4D6BFE',
  lower: '#7C93FF',
  belly: '#C9D6FF',
  fin: '#3550D8',
  eye: '#070C24',
  eyeHi: '#FFFFFF',
  spout: '#DCE6FF',
  spoutDeep: '#9DB4FF',
};

// ── 三维工具 ──────────────────────────────────────────────
const key = (x, y, z) => `${x},${y},${z}`;

class Grid {
  constructor() {
    this.cells = new Map();
  }
  set(x, y, z, kind) {
    this.cells.set(key(x, y, z), { x, y, z, kind });
  }
  has(x, y, z) {
    return this.cells.has(key(x, y, z));
  }
  get size() {
    return this.cells.size;
  }
  values() {
    return this.cells.values();
  }
}

// 在网格里填充椭球
function ellipsoid(grid, cx, cy, cz, rx, ry, rz, kind) {
  const x0 = Math.ceil(cx - rx);
  const x1 = Math.floor(cx + rx);
  const y0 = Math.ceil(cy - ry);
  const y1 = Math.floor(cy + ry);
  const z0 = Math.ceil(cz - rz);
  const z1 = Math.floor(cz + rz);
  for (let x = x0; x <= x1; x++) {
    for (let y = y0; y <= y1; y++) {
      for (let z = z0; z <= z1; z++) {
        const dx = (x - cx) / rx;
        const dy = (y - cy) / ry;
        const dz = (z - cz) / rz;
        if (dx * dx + dy * dy + dz * dz <= 1) grid.set(x, y, z, kind);
      }
    }
  }
}

// 沿曲线堆椭球，形成锥形肢体（尾柄、胸鳍等）
function taperedLimb(grid, from, to, r0, r1, kind) {
  const steps = Math.max(2, Math.ceil(Math.hypot(to[0] - from[0], to[1] - from[1], to[2] - from[2]) * 2));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const cx = from[0] + (to[0] - from[0]) * t;
    const cy = from[1] + (to[1] - from[1]) * t;
    const cz = from[2] + (to[2] - from[2]) * t;
    const r = r0 + (r1 - r0) * t;
    ellipsoid(grid, cx, cy, cz, r, r, r, kind);
  }
}

export function buildWhale() {
  const grid = new Grid();

  // ── 身体：一串椭球，头部饱满、尾部收细 ──
  // [cx, cy, cz, rx, ry, rz]
  const BODY = [
    [-15.0, 0.0, 0.0, 4.6, 4.4, 4.2], // 头部前端（钝圆）
    [-12.0, 0.0, 0.0, 5.2, 5.2, 4.8],
    [-8.0, 0.0, 0.0, 5.6, 5.6, 5.2], // 最宽处
    [-3.0, 0.2, 0.0, 5.4, 5.4, 4.9],
    [2.0, 0.4, 0.0, 4.8, 4.8, 4.2],
    [6.5, 0.6, 0.0, 3.8, 3.8, 3.2],
    [10.0, 0.8, 0.0, 2.8, 2.8, 2.4],
    [12.5, 0.9, 0.0, 2.0, 2.0, 1.7], // 尾柄
  ];
  for (const [cx, cy, cz, rx, ry, rz] of BODY) {
    ellipsoid(grid, cx, cy, cz, rx, ry, rz, 'body');
  }

  // ── 尾鳍：水平展开的扇形，中间带凹口 ──
  for (let i = 0; i <= 12; i++) {
    const u = i / 12;
    const cx = 12.5 + u * 8.5;
    const halfSpan = 1.2 + u * 6.4; // 根部窄、末端宽
    const ry = 1.0 - u * 0.45; // 越往外越薄
    const notch = u > 0.78 ? (u - 0.78) / 0.22 : 0;
    for (let z = -Math.ceil(halfSpan); z <= Math.ceil(halfSpan); z++) {
      if (Math.abs(z) > halfSpan) continue;
      if (notch > 0 && Math.abs(z) < notch * 2.0) continue; // 末端凹口
      for (let y = -1; y <= 1; y++) {
        if (Math.abs(y) > ry) continue;
        grid.set(Math.round(cx), y + 1, z, 'tail');
      }
    }
  }

  // ── 胸鳍：两侧斜向后下方 ──
  for (const side of [-1, 1]) {
    taperedLimb(
      grid,
      [-9.5, -3.2, side * 3.2],
      [-3.0, -6.4, side * 5.4],
      2.2,
      1.2,
      'fin'
    );
  }

  // ── 眼睛：头部两侧的深色像素 ──
  for (const side of [-1, 1]) {
    const ex = -13;
    const ey = 0;
    const ez = side * 4;
    for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
      grid.set(ex + dx, ey + dy, ez, 'eye');
    }
    grid.set(ex, ey + 1, ez + side, 'eyeHi');
  }

  // ── 水柱：头顶喷出的锥形水花 ──
  // 主柱：从头顶升起
  taperedLimb(grid, [-14.0, 3.5, 0], [-14.0, 9.5, 0], 1.3, 1.5, 'spout');
  // 顶部向四周散开的水花
  taperedLimb(grid, [-14.0, 9.0, 0], [-17.0, 12.5, 0], 1.2, 0.9, 'spout');
  taperedLimb(grid, [-14.0, 9.0, 0], [-11.0, 12.5, 0], 1.2, 0.9, 'spout');
  taperedLimb(grid, [-14.0, 9.0, 0], [-14.0, 13.5, 0], 1.2, 0.9, 'spout');
  taperedLimb(grid, [-14.0, 9.0, 0], [-14.0, 12.0, 1.8], 1.0, 0.7, 'spout');
  taperedLimb(grid, [-14.0, 9.0, 0], [-14.0, 12.0, -1.8], 1.0, 0.7, 'spout');

  // ── 上色：按高度做背部→腹部渐变 ──
  const voxels = [];
  for (const v of grid.values()) {
    let kind = v.kind;
    if (kind === 'body') {
      const t = (v.y + 6) / 12; // 0 底部, 1 顶部
      if (t > 0.72) kind = 'back';
      else if (t > 0.42) kind = 'mid';
      else if (t > 0.16) kind = 'lower';
      else kind = 'belly';
    }
    voxels.push({ x: v.x, y: v.y, z: v.z, kind });
  }

  return { voxels };
}
