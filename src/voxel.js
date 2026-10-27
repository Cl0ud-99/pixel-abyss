// 体素建模基础工具（纯几何，不依赖 three.js）
// 所有生物都用这里的原语拼出来。

export const VOXEL = 0.1; // 单个素边长（世界单位）

const key = (x, y, z) => `${x},${y},${z}`;

export class Grid {
  constructor() {
    this.cells = new Map();
  }
  set(x, y, z, kind) {
    this.cells.set(key(x, y, z), { x, y, z, kind });
    return this;
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
  toArray() {
    return Array.from(this.cells.values());
  }
  bounds() {
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    let minZ = Infinity, maxZ = -Infinity;
    for (const v of this.cells.values()) {
      if (v.x < minX) minX = v.x;
      if (v.x > maxX) maxX = v.x;
      if (v.y < minY) minY = v.y;
      if (v.y > maxY) maxY = v.y;
      if (v.z < minZ) minZ = v.z;
      if (v.z > maxZ) maxZ = v.z;
    }
    return { minX, maxX, minY, maxY, minZ, maxZ };
  }
  // 按条件批量改色
  recolor(fn, kind) {
    for (const v of this.cells.values()) {
      if (fn(v)) v.kind = kind;
    }
    return this;
  }
  // 只保留满足条件的体素
  keep(fn) {
    for (const [k, v] of Array.from(this.cells.entries())) {
      if (!fn(v)) this.cells.delete(k);
    }
    return this;
  }
}

// ── 基本体 ──────────────────────────────────────────────

// 椭球
export function ellipsoid(grid, cx, cy, cz, rx, ry, rz, kind) {
  const x0 = Math.ceil(cx - rx), x1 = Math.floor(cx + rx);
  const y0 = Math.ceil(cy - ry), y1 = Math.floor(cy + ry);
  const z0 = Math.ceil(cz - rz), z1 = Math.floor(cz + rz);
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
  return grid;
}

// 沿两点堆椭球，形成锥形肢体（鳍、触手、腿）
export function taperedLimb(grid, from, to, r0, r1, kind) {
  const len = Math.hypot(to[0] - from[0], to[1] - from[1], to[2] - from[2]);
  const steps = Math.max(2, Math.ceil(len * 2));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const cx = from[0] + (to[0] - from[0]) * t;
    const cy = from[1] + (to[1] - from[1]) * t;
    const cz = from[2] + (to[2] - from[2]) * t;
    const r = r0 + (r1 - r0) * t;
    ellipsoid(grid, cx, cy, cz, r, r, r, kind);
  }
  return grid;
}

// 实心长方体
export function fillBox(grid, x0, y0, z0, x1, y1, z1, kind) {
  for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) {
    for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) {
      for (let z = Math.min(z0, z1); z <= Math.max(z0, z1); z++) {
        grid.set(x, y, z, kind);
      }
    }
  }
  return grid;
}

// 在 XY 平面上填充多边形（用于薄鳍），厚度为 z 方向若干层
export function fillPolyXY(grid, pts, zFrom, zTo, kind) {
  const ys = pts.map((p) => p[1]);
  const y0 = Math.floor(Math.min(...ys));
  const y1 = Math.ceil(Math.max(...ys));
  for (let y = y0; y <= y1; y++) {
    const py = y + 0.5;
    const xs = [];
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [xi, yi] = pts[i];
      const [xj, yj] = pts[j];
      if ((yi > py) !== (yj > py)) {
        xs.push(xi + ((py - yi) / (yj - yi)) * (xj - xi));
      }
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const xa = Math.ceil(xs[k] - 0.5);
      const xb = Math.floor(xs[k + 1] - 0.5);
      for (let x = xa; x <= xb; x++) {
        for (let z = zFrom; z <= zTo; z++) grid.set(x, y, z, kind);
      }
    }
  }
  return grid;
}

// 在 XZ 平面上填充多边形（用于水平展开的鳍、海星等）
export function fillPolyXZ(grid, pts, yFrom, yTo, kind) {
  const zs = pts.map((p) => p[1]);
  const z0 = Math.floor(Math.min(...zs));
  const z1 = Math.ceil(Math.max(...zs));
  for (let z = z0; z <= z1; z++) {
    const pz = z + 0.5;
    const xs = [];
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [xi, zi] = pts[i];
      const [xj, zj] = pts[j];
      if ((zi > pz) !== (zj > pz)) {
        xs.push(xi + ((pz - zi) / (zj - zi)) * (xj - xi));
      }
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const xa = Math.ceil(xs[k] - 0.5);
      const xb = Math.floor(xs[k + 1] - 0.5);
      for (let x = xa; x <= xb; x++) {
        for (let y = yFrom; y <= yTo; y++) grid.set(x, y, z, kind);
      }
    }
  }
  return grid;
}

// 把一批体素包成「部件」
export function part(name, grid, pivot) {
  return { name, voxels: grid.toArray(), pivot: pivot || [0, 0, 0] };
}
