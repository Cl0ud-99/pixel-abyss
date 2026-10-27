// 开屏页装饰：像素气泡 + 像素鲸鱼尾巴标志
// 纯 DOM 生成，不依赖 three.js，保证开屏瞬间就能看到

const TAU = Math.PI * 2;

// ── 背景气泡 ──
export function spawnBubbles(container, count = 26) {
  if (!container) return;
  for (let i = 0; i < count; i++) {
    const b = document.createElement('i');
    const size = 4 + Math.floor(Math.random() * 5) * 2; // 4,6,8,10,12
    b.style.width = size + 'px';
    b.style.height = size + 'px';
    b.style.left = Math.random() * 100 + '%';
    b.style.bottom = -20 - Math.random() * 30 + 'px';
    b.style.animationDuration = 7 + Math.random() * 9 + 's';
    b.style.animationDelay = -Math.random() * 12 + 's';
    b.style.opacity = 0.25 + Math.random() * 0.5;
    container.appendChild(b);
  }
}

// ── 像素鲸鱼标志（用方块拼一只侧面的蓝鲸）──
//   1 = 主体蓝  2 = 亮蓝高光  3 = 白（眼睛/水花）
export function buildLogoMark(container) {
  if (!container) return;

  // 18 x 12 点阵：侧面鲸鱼，头在左、尾在右，尾巴上翘
  const PATTERN = [
    '..................',
    '..............1...',
    '.............11...',
    '............111...',
    '...1111111111111..',
    '..111111111111111.',
    '.11111111111111111',
    '.1111111111111111.',
    '..11111111111111..',
    '...1111111111.....',
    '....1111111.......',
    '..................',
  ];

  const CELL = 8;
  const COLORS = {
    '1': '#4D6BFE',
    '2': '#7C93FF',
    '3': '#EAF0FF',
  };

  PATTERN.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const ch = row[x];
      if (ch === '.' || !COLORS[ch]) continue;
      const px = document.createElement('div');
      px.className = 'px';
      px.style.left = x * CELL + 'px';
      px.style.top = y * CELL + 'px';
      px.style.width = CELL + 'px';
      px.style.height = CELL + 'px';
      px.style.background = COLORS[ch];
      // 描边用 outline，保持像素方块感
      px.style.outline = '1px solid rgba(11, 16, 48, .55)';
      container.appendChild(px);
    }
  });

  // 眼睛
  const eye = document.createElement('div');
  eye.className = 'px';
  eye.style.left = 2 * CELL + 'px';
  eye.style.top = 6 * CELL + 'px';
  eye.style.width = CELL + 'px';
  eye.style.height = CELL + 'px';
  eye.style.background = '#EAF0FF';
  eye.style.outline = '1px solid rgba(11, 16, 48, .55)';
  eye.style.animation = 'none';
  container.appendChild(eye);

  container.style.width = 18 * CELL + 'px';
  container.style.height = 12 * CELL + 'px';
  container.style.filter = 'drop-shadow(4px 4px 0 rgba(4, 8, 26, .7))';
}

// ── 点击 / 回车开始 ──
export function bindStart(startBtn, splashEl, onStart) {
  let started = false;

  const start = () => {
    if (started) return;
    started = true;
    splashEl.classList.add('hide');
    // 等淡出动画结束再移除，避免挡住鼠标
    setTimeout(() => {
      splashEl.style.display = 'none';
    }, 600);
    onStart();
  };

  if (startBtn) startBtn.addEventListener('click', start);

  const onKey = (e) => {
    if (e.code === 'Enter' || e.code === 'Space') {
      // 空格在开屏页也是「开始」，进入游戏后才变成「升起」
      if (!started) {
        e.preventDefault();
        start();
      }
    }
  };
  window.addEventListener('keydown', onKey);

  return start;
}
