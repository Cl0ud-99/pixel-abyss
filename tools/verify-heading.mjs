// 数值验证鲸鱼朝向：头部（水柱/眼睛）在世界空间里指向哪
//
// 模型约定：头在 -X（水柱 x≈-14、眼睛 x≈-13），尾鳍在 +X（x≈12.5~21）
// 前进方向：dir = (sin h, 0, cos h)
//
// 绕 Y 轴旋转 θ 后，局部点 (px,py,pz) → 世界：
//   x' =  cosθ*px + sinθ*pz
//   z' = -sinθ*px + cosθ*pz
// 取头部 px=-14, pz=0：头部方向 = (-cosθ, sinθ)
// 要让它等于 (sin h, cos h) → θ = π/2 + h

import * as THREE from 'three';
import { buildWhale } from '../src/whaleShape.js';

const { voxels } = buildWhale();

// 头尾参考点：水柱在最前端，尾鳍在最后端
const spout = voxels.filter((v) => v.kind === 'spout');
const tail = voxels.filter((v) => v.kind === 'tail');

const centroid = (list) => {
  const c = new THREE.Vector3();
  list.forEach((v) => c.add(new THREE.Vector3(v.x, v.y, v.z)));
  return c.divideScalar(list.length);
};

const headLocal = centroid(spout);
const tailLocal = centroid(tail);

console.log('=== 模型本地坐标 ===');
console.log('头部（水柱）重心 x =', headLocal.x.toFixed(2), ' → 头在 -X 侧');
console.log('尾部（尾鳍）重心 x =', tailLocal.x.toFixed(2), ' → 尾在 +X 侧');

const root = new THREE.Group();
root.rotation.order = 'YXZ';

function headDirectionAfter(heading, formula) {
  root.rotation.set(0, 0, 0);
  root.rotation.y = formula(heading);
  root.updateMatrixWorld(true);

  const hw = headLocal.clone().applyMatrix4(root.matrixWorld);
  const tw = tailLocal.clone().applyMatrix4(root.matrixWorld);
  // 从尾指向头，就是「鲸鱼脸的朝向」
  const facing = hw.clone().sub(tw).normalize();
  return { facing, hw, tw };
}

const headings = [0, Math.PI / 2, Math.PI, -Math.PI / 2];

for (const [name, formula] of [
  ['θ = h + π/2', (h) => h + Math.PI / 2],
  ['θ = h - π/2', (h) => h - Math.PI / 2],
]) {
  console.log('\n=== ' + name + ' ===');
  let allOk = true;
  for (const h of headings) {
    const { facing } = headDirectionAfter(h, formula);
    const forward = new THREE.Vector3(Math.sin(h), 0, Math.cos(h));
    const dot = facing.dot(forward);
    // 头尾重心连线不完全平行于 X 轴（水柱略偏上、尾鳍有厚度），
    // 所以点积达不到 1.0，>0.9 就说明头朝前
    const ok = dot > 0.9;
    if (!ok) allOk = false;
    console.log(
      `  heading=${h.toFixed(2)}  脸的朝向=(${facing.x.toFixed(2)}, ${facing.z.toFixed(2)})` +
      `  前进=(${forward.x.toFixed(2)}, ${forward.z.toFixed(2)})` +
      `  点积=${dot.toFixed(3)}  ${ok ? '✅ 头朝前' : '❌ 倒着游'}`
    );
  }
  console.log('  结论:', allOk ? '✅ 这个公式正确' : '❌ 这个公式错误');
}
