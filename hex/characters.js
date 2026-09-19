// VIS-01 · 原创 32 × 48 像素人物。用整数像素绘制，一次生成纹理，不依赖远程素材。
// 人物的发型、廓形、衣着和配件分别设计；四向步态共享动作节奏，而不共享人物轮廓。
import { Assets, Rectangle, Texture } from 'pixi.js';

// Optional local-only art review. `hex/vite.config.js` disables publicDir, so
// these files never enter the production bundle; a missing file uses the
// generated characters below.
const LPC_SELFTEST_ROOT = '/selftest/lpc/';
const LPC_FRAME = 64;
const LPC_ROWS = { down: 2, up: 0, left: 3, right: 1 };

export const CHARACTER_DESIGNS = {
  YOU: { hair: '#35323d', hairLight: '#55505d', skin: '#e3b694', skinShade: '#ba836d', coat: '#88b5a6', coatLight: '#b6d5c1', coatShade: '#557e79', pants: '#536b81', shoe: '#e3dac7', style: 'hoodie', cut: 'messy', accent: '#b6d5c1' },
  A: { hair: '#4b3833', hairLight: '#765345', skin: '#d8a682', skinShade: '#ad755e', coat: '#b7aa8d', coatLight: '#d9ceb5', coatShade: '#827664', pants: '#414551', shoe: '#6b4c42', style: 'coat', cut: 'part', accent: '#d9ceb5' },
  B: { hair: '#844f42', hairLight: '#b67554', skin: '#edc4a4', skinShade: '#c68f79', coat: '#a99abc', coatLight: '#d2bbd5', coatShade: '#77698c', pants: '#4b485c', shoe: '#443c46', style: 'cardigan', cut: 'bob', accent: '#c4abd0' },
  C: { hair: '#382f32', hairLight: '#635046', skin: '#bf8e6a', skinShade: '#936649', coat: '#c28c60', coatLight: '#e0b184', coatShade: '#966349', pants: '#687375', shoe: '#e0d4b6', style: 'jacket', cut: 'curl', accent: '#d9a277' },
  Z: { hair: '#4b443d', hairLight: '#746452', skin: '#d2ae89', skinShade: '#ad8269', coat: '#5d838c', coatLight: '#87a6aa', coatShade: '#3f616d', pants: '#827b6c', shoe: '#403f48', style: 'utility', cut: 'cap', accent: '#8bafb6' },
};
const INK = '#302d39';
const CREAM = '#f1e4cc';

// Scanline polygon: Canvas vector edges would soften a pixel character at fractional diagonals.
function pixelPolygon(ctx, points, color) {
  ctx.fillStyle = color;
  const ys = points.map((p) => p[1]);
  for (let y = Math.min(...ys); y < Math.max(...ys); y += 1) {
    const xs = [];
    for (let i = 0; i < points.length; i += 1) {
      const a = points[i];
      const b = points[(i + 1) % points.length];
      if ((a[1] <= y + 0.5 && b[1] > y + 0.5) || (b[1] <= y + 0.5 && a[1] > y + 0.5)) {
        xs.push(a[0] + ((y + 0.5 - a[1]) * (b[0] - a[0])) / (b[1] - a[1]));
      }
    }
    xs.sort((a, b) => a - b);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const left = Math.round(xs[i]);
      ctx.fillRect(left, y, Math.round(xs[i + 1]) - left, 1);
    }
  }
}

function drawCharacter(design, direction, phase, action) {
  const canvas = document.createElement('canvas');
  canvas.width = 32;
  canvas.height = 48;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  if (direction === 'left') { ctx.translate(32, 0); ctx.scale(-1, 1); }
  const side = direction === 'left' || direction === 'right';
  const back = direction === 'up';
  const walking = action === 'walk';
  const step = walking ? [0, 2, 0, -2][phase % 4] : 0;
  const bob = walking ? [0, -1, 0, -1][phase % 4] : action === 'breathe' ? -1 : 0;
  const raised = ['talk', 'work', 'drink', 'read'].includes(action) && phase % 2;
  const d = design;
  const r = (x, y, w, h, color) => { ctx.fillStyle = color; ctx.fillRect(x, y, w, h); };
  const p = (points, color) => pixelPolygon(ctx, points, color);
  // Legs are rooted to the floor; opposite feet move on the same frame.
  if (side) {
    r(12 - step, 34, 5, 10 + Math.max(0, step), d.pants);
    r(13 - step, 44 + Math.max(0, step), 7, 2, INK);
    r(13 + step, 34, 5, 10 - Math.max(0, step), d.pants);
    r(14 + step, 43 - Math.max(0, step), 7, 3, d.shoe);
    r(14 + step, 46 - Math.max(0, step), 7, 1, INK);
  } else {
    r(10, 34, 5, 10 + Math.min(0, step), d.pants);
    r(18, 34, 5, 10 + Math.min(0, -step), d.pants);
    r(10, 35, 1, 8 + Math.min(0, step), d.coatShade);
    r(18, 35, 1, 8 + Math.min(0, -step), d.coatShade);
    r(9, 43 + Math.min(0, step), 6, 3, d.shoe);
    r(18, 43 + Math.min(0, -step), 6, 3, d.shoe);
    r(9, 46 + Math.min(0, step), 6, 1, INK);
    r(18, 46 + Math.min(0, -step), 6, 1, INK);
    if (d.style === 'hoodie' || d.style === 'jacket') {
      r(9, 43 + Math.min(0, step), 3, 1, CREAM);
      r(18, 43 + Math.min(0, -step), 3, 1, CREAM);
    }
  }
  ctx.save();
  ctx.translate(0, bob);
  // Distinct jacket silhouettes; all clothes are contemporary, everyday clothing.
  const left = side ? 10 : d.style === 'coat' ? 7 : 8;
  const right = side ? 23 : d.style === 'hoodie' ? 25 : 24;
  const hem = d.style === 'coat' ? 38 : d.style === 'cardigan' ? 34 : 35;
  p([[left + 3, 22], [right - 3, 22], [right, 26], [right - 1, hem], [left + 1, hem], [left, 26]], INK);
  p([[left + 3, 23], [right - 3, 23], [right - 1, 26], [right - 2, hem - 1], [left + 2, hem - 1], [left + 1, 26]], d.coat);
  r(left + 2, 26, 2, hem - 28, d.coatLight);
  r(right - 4, 26, 2, hem - 27, d.coatShade);
  r(13, 21, 7, 4, d.skinShade);
  if (!back) {
    if (d.style === 'coat') {
      p([[13, 23], [20, 23], [19, 35], [14, 35]], CREAM);
      p([[11, 23], [15, 25], [14, 29], [17, 32], [12, 29]], d.coatShade);
      p([[22, 23], [18, 25], [19, 29], [17, 32], [21, 29]], d.coatLight);
      r(16, 25, 2, 8, '#75535d');
      r(10, 33, 3, 1, d.coatShade);
      r(21, 34, 1, 1, CREAM);
    } else if (d.style === 'hoodie') {
      p([[11, 23], [14, 26], [19, 26], [22, 23], [20, 28], [13, 28]], d.coatShade);
      r(13, 27, 1, 3, CREAM); r(20, 27, 1, 3, CREAM);
      r(13, 31, 7, 2, d.coatShade); r(14, 31, 5, 1, d.coatLight);
    } else if (d.style === 'cardigan') {
      r(14, 24, 6, 8, CREAM); r(13, 24, 1, 10, d.coatLight);
      r(20, 24, 1, 10, d.coatShade); r(21, 28, 1, 1, CREAM);
      p([[11, 33], [22, 33], [25, 39], [8, 39]], d.pants);
      r(12, 35, 1, 3, '#777084'); r(20, 35, 1, 3, '#343341');
    } else if (d.style === 'jacket') {
      r(14, 24, 6, 9, CREAM); r(12, 25, 2, 3, d.coatLight);
      r(20, 25, 2, 3, d.coatShade); r(10, 30, 3, 2, d.coatShade);
    } else {
      r(14, 24, 5, 4, CREAM); r(16, 28, 1, 6, d.coatShade);
      r(10, 28, 3, 3, d.coatShade);
    }
  } else if (d.style === 'hoodie') {
    p([[11, 23], [22, 23], [22, 27], [17, 30], [11, 27]], d.coatShade);
    r(12, 24, 9, 3, d.coatLight);
  } else {
    r(left + 4, 25, right - left - 8, 1, d.coatLight);
    r(16, 28, 1, Math.max(3, hem - 30), d.coatShade);
  }
  // Swinging sleeves and hands. Keep the nearer arm separate on side views.
  const armShift = walking ? Math.sign(step) : 0;
  if (!side) {
    r(left, 26 + armShift, 3, 7, d.coatShade);
    r(left, 32 + armShift, 3, 3, d.skin);
  }
  const armY = raised ? 26 : 32 - armShift;
  r(right - 2, 26, 3, raised ? 4 : 7 - armShift, d.coat);
  r(right - 2, armY, 3, 3, d.skin);
  r(right, armY, 1, 2, d.skinShade);
  if (d.style === 'utility') {
    p([[11, 23], [13, 23], [23, 34], [21, 35]], '#dbccb1');
    r(21, 32, 7, 8, INK); r(22, 32, 5, 7, '#caba95'); r(23, 34, 3, 1, '#eddfbb');
  }
  // Head: ears, chin shadow and restrained facial detail at a readable proportion.
  const hx = side ? 12 : 9;
  const hw = side ? 12 : 15;
  r(hx + 2, 10, hw - 4, 2, d.skin);
  r(hx, 12, hw, 8, d.skin);
  r(hx + 2, 20, hw - 4, 2, d.skinShade);
  r(hx - 1, 15, 2, 3, d.skinShade);
  if (!side) r(hx + hw - 1, 15, 2, 3, d.skinShade);
  else r(hx + hw, 16, 2, 3, d.skin);
  r(hx + 3, 13, side ? 7 : 9, 6, d.skin);
  // Each hair shape uses its own outline rather than tinting a shared sheet.
  if (d.cut === 'messy') {
    p([[7, 13], [8, 8], [11, 8], [12, 5], [16, 7], [21, 7], [25, 10], [25, 16], [22, 17], [22, 12], [18, 13], [15, 11], [11, 14]], d.hair);
    r(10, 9, 5, 2, d.hairLight); r(16, 8, 4, 1, d.hairLight);
    if (back) { r(9, 12, 15, 8, d.hair); r(11, 20, 11, 2, d.hair); }
  } else if (d.cut === 'part') {
    p([[8, 14], [8, 9], [12, 6], [20, 6], [25, 10], [25, 19], [22, 18], [22, 12], [18, 10], [12, 13]], d.hair);
    r(11, 8, 8, 2, d.hairLight); r(20, 9, 2, 2, d.hairLight);
    if (back) { r(9, 12, 15, 8, d.hair); r(11, 20, 11, 2, d.hair); }
  } else if (d.cut === 'bob') {
    p([[6, 15], [7, 9], [11, 6], [21, 6], [25, 10], [26, 23], [21, 24], [22, 13], [18, 11], [11, 14], [11, 24], [6, 23]], d.hair);
    r(9, 9, 4, 2, d.hairLight); r(7, 15, 2, 6, d.hairLight); r(23, 14, 1, 7, d.hairLight);
    r(22, 13, 2, 1, '#e3be80');
    if (back) { r(9, 10, 15, 13, d.hair); r(12, 10, 2, 12, d.hairLight); r(19, 11, 1, 11, d.hairLight); }
  } else if (d.cut === 'curl') {
    p([[6, 15], [6, 10], [8, 10], [8, 7], [12, 7], [12, 5], [18, 5], [18, 6], [22, 6], [22, 8], [25, 8], [26, 13], [24, 18], [21, 14], [18, 12], [14, 13], [10, 15]], d.hair);
    r(9, 9, 3, 2, d.hairLight); r(14, 7, 3, 2, d.hairLight); r(20, 9, 3, 2, d.hairLight);
    if (back) { r(8, 12, 17, 7, d.hair); r(10, 19, 13, 3, d.hair); }
  } else {
    r(9, 9, 15, 7, d.hair); r(9, 8, 15, 5, '#485668');
    r(11, 6, 11, 3, '#647488'); r(10, 9, 12, 2, '#728297');
    r(side ? 16 : 11, 12, side ? 13 : 15, 2, '#343e50');
    r(15, 9, 3, 2, '#c4b794');
    if (back) { r(10, 14, 13, 6, d.hair); r(14, 13, 5, 2, d.skinShade); }
  }
  if (!back) {
    const eyeY = 16;
    if (action === 'blink') { r(side ? 22 : 12, eyeY, 2, 1, INK); if (!side) r(20, eyeY, 2, 1, INK); }
    else { r(side ? 22 : 12, eyeY, 1, 2, INK); if (!side) r(20, eyeY, 1, 2, INK); }
    if (d.cut === 'curl') {
      r(side ? 20 : 10, 15, 5, 1, '#695e56'); r(side ? 20 : 10, 18, 5, 1, '#695e56');
      if (!side) { r(18, 15, 5, 1, '#695e56'); r(18, 18, 5, 1, '#695e56'); r(15, 16, 3, 1, '#695e56'); }
    }
    r(side ? 22 : 16, 20, raised && action === 'talk' ? 2 : 1, 1, '#a57065');
    if (!side) { r(10, 19, 2, 1, '#d99883'); r(22, 19, 1, 1, '#d99883'); }
  }
  if (raised && action === 'drink') { r(22, 24, 5, 5, CREAM); r(23, 24, 3, 1, '#886b54'); }
  if (action === 'read') { r(18, 30, 9, 6, '#536577'); r(19, 30, 6, 1, '#e6d5b5'); r(22, 31, 1, 4, '#a2b0b5'); }
  ctx.restore();
  return canvas;
}

export function createCharacterFrames(castId) {
  const design = CHARACTER_DESIGNS[castId] || CHARACTER_DESIGNS.Z;
  const frames = {};
  const add = (name, dir, phase, action) => {
    const texture = Texture.from(drawCharacter(design, dir, phase, action));
    texture.source.scaleMode = 'nearest';
    frames[name] = texture;
  };
  for (const direction of ['down', 'up', 'left', 'right']) {
    add(`idle_${direction}`, direction, 0, 'idle');
    add(`breathe_${direction}`, direction, 0, 'breathe');
    add(`blink_${direction}`, direction, 0, 'blink');
    for (let phase = 0; phase < 4; phase += 1) add(`walk_${direction}_${phase}`, direction, phase, 'walk');
  }
  for (const action of ['talk', 'work', 'read', 'drink', 'rest']) {
    for (let phase = 0; phase < 2; phase += 1) add(`${action}_${phase}`, 'down', phase, action === 'rest' ? (phase ? 'blink' : 'idle') : action);
  }
  return frames;
}

/**
 * Load one optional LPC comparison sheet and expose the same frame contract
 * as createCharacterFrames. The sheet has 64px cells; the first four cells
 * of rows 0-3 are the four-direction idle/walk poses.
 */
export async function loadLpcCharacterFrames(castId, timeoutMs = 700) {
  if (!CHARACTER_DESIGNS[castId]) return null;
  const url = `${LPC_SELFTEST_ROOT}${encodeURIComponent(castId)}.png`;
  let timer;
  try {
    const texture = await Promise.race([
      Assets.load(url),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('self-test asset timeout')), timeoutMs); }),
    ]);
    if (!texture?.source || texture.source.pixelWidth < LPC_FRAME * 4 || texture.source.pixelHeight < LPC_FRAME * 4) return null;
    const frame = (col, row) => {
      const part = new Texture({
        source: texture.source,
        frame: new Rectangle(col * LPC_FRAME, row * LPC_FRAME, LPC_FRAME, LPC_FRAME),
        orig: new Rectangle(0, 0, LPC_FRAME, LPC_FRAME),
      });
      part.source.scaleMode = 'nearest';
      return part;
    };
    const frames = {};
    for (const [direction, row] of Object.entries(LPC_ROWS)) {
      frames[`idle_${direction}`] = frame(0, row);
      frames[`breathe_${direction}`] = frame(1, row);
      frames[`blink_${direction}`] = frame(2, row);
      for (let phase = 0; phase < 4; phase += 1) frames[`walk_${direction}_${phase}`] = frame(phase, row);
    }
    for (const action of ['talk', 'work', 'read', 'drink', 'rest']) {
      frames[`${action}_0`] = frame(0, LPC_ROWS.down);
      frames[`${action}_1`] = frame(1, LPC_ROWS.down);
    }
    return { frames, scale: 0.8, visual: 'lpc-selftest' };
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
