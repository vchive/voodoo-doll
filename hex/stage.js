// 002 · 房间渲染器（PixiJS）
//
// 关键约束：玩家不能直接控制人物。这个模块只对外暴露「让某个角色走到某处」
// 「让某个角色去碰某样东西」「环境在某处有反应」这类指令，全部由娃娃/环境（AI）发出。
// 没有拖拽、没有点选。
//
// VIS-01：五种原创现代人物与房间像素绘制；自测时可优先加载隔离的 LPC
// 比较层，任何加载失败都回退原创人物，不依赖历史第三方素材。
import { Application, Container, Sprite, Graphics, Text, TextStyle } from 'pixi.js';
import { findObject } from '../shared/environment.js';
import { buildGrid, findPath, isFree } from './pathfind.js';
import { createCharacterFrames, loadLpcCharacterFrames, CHARACTER_DESIGNS } from './characters.js';

export const TILE = 16;
const VIEW_W = 18;
const VIEW_H = 16;

function hash(x, y) {
  let n = x * 374761393 + y * 668265263;
  n = (n ^ (n >> 13)) * 1274126177;
  return ((n ^ (n >> 16)) >>> 0) / 4294967296;
}

export async function createStage(host, options = {}) {
  const app = new Application();
  await app.init({
    width: VIEW_W * TILE,
    height: VIEW_H * TILE,
    background: 0x1a1512,
    antialias: false,
    resolution: Math.min(2, window.devicePixelRatio || 1),
    autoDensity: true,
  });

  // The LPC sheets are an optional local visual comparison. Preload them
  // before the first model arrives so actor creation stays synchronous; any
  // missing/invalid sheet simply leaves that cast member on the original
  // generated renderer.
  const lpcFrameCache = new Map();
  if (options.useLpc === true) await Promise.all(Object.keys(CHARACTER_DESIGNS).map(async (castId) => {
    const loaded = await loadLpcCharacterFrames(castId);
    if (loaded) lpcFrameCache.set(castId, loaded);
  }));
  host.appendChild(app.canvas);
  app.canvas.style.width = '100%';
  app.canvas.style.height = 'auto';
  app.canvas.style.display = 'block';

  const layerFloor = new Container();
  const layerProps = new Container();
  const layerShadows = new Container();
  const layerActors = new Container();
  layerActors.sortableChildren = true;
  const layerFx = new Container();
  const layerAmbient = new Container(); // 天气与灯光叠层，盖在一切之上
  app.stage.addChild(layerFloor, layerShadows, layerProps, layerActors, layerFx, layerAmbient);
  app.stage.children.forEach((l) => {
    l.eventMode = 'none';
  });

  const actors = new Map(); // castId -> entry
  let roomId = null;
  let roomSpots = {};
  let grid = null;
  let ambient = { weather: 'clear', light: 'on' };

  // ---- 房间：原创像素地板与家具，所有碰撞仍来自 rooms/pathfind ----
  const ROOM_PALETTES = {
    bedroom: { floor: 0x756252, alt: 0x7b6858, line: 0x5b4b42, wall: 0x424654, trim: 0x878078, rug: 0x625f69 },
    kitchen: { floor: 0x718284, alt: 0x7a898a, line: 0x58686d, wall: 0x3f5158, trim: 0x9baba9, rug: 0x70746c },
    corridor: { floor: 0x737079, alt: 0x797680, line: 0x5b5965, wall: 0x454654, trim: 0x93929a, rug: 0x756770 },
    office: { floor: 0x797267, alt: 0x80786c, line: 0x625b55, wall: 0x48515b, trim: 0x9b9990, rug: 0x626e72 },
    street: { floor: 0x545d6a, alt: 0x59616f, line: 0x434c59, wall: 0x383e4d, trim: 0x7a8190, rug: 0x5d6875 },
    bar: { floor: 0x63524e, alt: 0x6b5852, line: 0x4d403f, wall: 0x424250, trim: 0x8e796d, rug: 0x796068 },
  };

  function drawProp(room, prop, index) {
    const g = new Graphics();
    const x = prop.x * TILE, y = prop.y * TILE, w = prop.w * TILE, h = prop.h * TILE;
    const rect = (rx, ry, rw, rh, color, alpha = 1) => g.rect(rx, ry, rw, rh).fill({ color, alpha });
    const furniture = (color = 0x9c7c60) => {
      rect(x + 3, y + 5, w, h, 0x252734, 0.25);
      rect(x, y, w, h, 0x4a4142); rect(x + 1, y + 1, w - 2, h - 5, color);
      rect(x + 2, y + 2, w - 4, 2, 0xd0b18a, 0.65);
      rect(x + 2, y + h - 4, w - 4, 3, 0x705646);
      rect(x + 4, y + h, 3, 3, 0x342f37); rect(x + w - 7, y + h, 3, 3, 0x342f37);
    };
    const window = () => {
      rect(x - 2, y - 2, w + 4, h + 4, 0x2c3446);
      rect(x, y, w, h, 0x82929e); rect(x + 3, y + 3, w - 6, h - 6, 0x34475d);
      rect(x + 4, y + 4, w - 8, h / 2 - 5, 0x47627b);
      for (let j = 0; j < 6; j += 1) rect(x + 6 + ((j * 11) % Math.max(8, w - 12)), y + 6 + ((j * 7) % Math.max(8, h - 12)), 1, 1, 0xf1dcaa, 0.7);
      rect(x + Math.floor(w / 2) - 1, y + 2, 2, h - 4, 0xb1b7ac);
      rect(x + 2, y + Math.floor(h / 2), w - 4, 2, 0xb1b7ac);
      rect(x - 3, y + h, w + 6, 3, 0xc2b59d);
      // Stepped light patch remains decorative and never changes the walk grid.
      rect(x - 7, y + h + 3, w + 8, 8, 0xadc6c8, 0.07);
      rect(x - 11, y + h + 11, w + 8, 8, 0xadc6c8, 0.035);
    };
    const plant = (px, py) => {
      rect(px + 2, py + 8, 8, 7, 0xab8066); rect(px + 1, py + 7, 10, 2, 0xd1a27e);
      rect(px + 5, py, 2, 8, 0x537e69); rect(px, py + 2, 6, 3, 0x789883); rect(px + 6, py - 2, 5, 4, 0x91ac8c);
    };
    if ((room.id === 'bedroom' && index === 1) || (room.id === 'kitchen' && index === 2)) {
      window();
    } else if (room.id === 'bedroom' && index === 0) {
      furniture(0x8c705d);
      rect(x + 4, y + 4, w - 8, h - 8, 0xd7cebb);
      rect(x + 5, y + 18, w - 10, h - 22, 0x8ba3a0);
      rect(x + 6, y + 19, w - 12, 3, 0xb7c7bb); rect(x + 6, y + h - 9, w - 12, 1, 0x657f80);
      rect(x + 8, y + 7, 20, 10, 0xf0e4cd); rect(x + 35, y + 7, 20, 10, 0xf0e4cd);
      rect(x + 9, y + 16, 18, 1, 0xb9b7aa); rect(x + 36, y + 16, 18, 1, 0xb9b7aa);
      for (let i = 0; i < 4; i += 1) rect(x + 10 + i * 13, y + 26, 1, 11, 0xb7c7bb, 0.3);
    } else if (room.id === 'bedroom' && index === 2) {
      furniture(); rect(x + 4, y + 9, 12, 16, 0x727c8c); rect(x + 5, y + 10, 2, 14, 0xb8c2b8);
      rect(x + 20, y + 13, 2, 12, 0x493b37); rect(x + 17, y + 7, 8, 7, 0xe3c599); rect(x + 19, y + 5, 4, 2, 0xe3c599);
    } else if (room.id === 'bedroom' && index === 3) {
      rect(x, y, w, h, 0x958773, 0.65); rect(x + 3, y + 3, w - 6, h - 6, 0x6e6b6a);
      for (let j = 0; j < w; j += 4) { rect(x + j, y - 2, 1, 2, 0x9c927e); rect(x + j, y + h, 1, 2, 0x9c927e); }
    } else if (room.id === 'kitchen' && index === 0) {
      furniture(0xc4c5af); rect(x + 4, y + 4, 27, h - 11, 0x4d6068);
      rect(x + 7, y + 7, 21, h - 17, 0x829495); rect(x + 18, y + 3, 2, 7, 0xe1dcc7);
      rect(x + 48, y + 4, 38, h - 10, 0x414752);
      for (const dx of [55, 73]) for (const dy of [8, 17]) { rect(x + dx, y + dy, 8, 6, 0x2f3541); rect(x + dx + 2, y + dy + 1, 4, 3, 0x82857e); }
    } else if (room.id === 'kitchen' && index === 1) {
      furniture(0xaa8a68); rect(x + 31, y + 3, 17, h - 8, 0xc3b69a);
      rect(x + 13, y + 12, 14, 12, 0xddd9c5); rect(x + 56, y + 15, 14, 12, 0xddd9c5);
      plant(x + 33, y + 11);
    } else if (room.id === 'corridor') {
      if (index < 2) {
        rect(x - 2, y - 2, w + 4, h + 4, 0x343744); rect(x, y, w, h, 0x877365);
        rect(x + 4, y + 4, w - 8, h - 8, 0x6c5f5a); rect(x + 7, y + 8, w - 14, h - 20, 0x827166);
        rect(x + w - 8, y + h / 2, 3, 3, 0xd6b783); rect(x + 10, y + 7, 10, 4, 0xb5aa91);
      } else {
        rect(x, y, w, h, 0x3d4451); rect(x + 3, y + 3, w - 6, h - 6, 0x77787a);
        rect(x + 8, y + 5, w - 16, 3, 0xb9c0b6);
      }
    } else if (room.id === 'office') {
      furniture(index === 2 ? 0x9b8e79 : 0xa99b80);
      if (index < 2) {
        rect(x + 12, y + 4, 30, 21, 0x343c49); rect(x + 14, y + 6, 26, 16, 0x627f8b);
        rect(x + 16, y + 8, 9, 2, 0xb0c1ba); rect(x + 16, y + 13, 19, 1, 0x829eaa);
        rect(x + 25, y + 25, 4, 4, 0x535968); rect(x + 16, y + 30, 25, 7, 0xd0cabb);
        for (let i = 0; i < 4; i += 1) rect(x + 18 + i * 5, y + 32, 3, 1, 0x8b938f);
        plant(x + w - 19, y + 7);
      } else {
        rect(x + 20, y + 3, 15, 8, 0xcecfbc); rect(x + 75, y + 3, 17, 8, 0x66788b);
        rect(x + 126, y + 4, 7, 5, 0xe0ccb1);
      }
    } else if (room.id === 'street') {
      if (index === 0) {
        rect(x, y, w, h, 0x444958); rect(x, y + h - 4, w, 4, 0x96938e);
        for (let j = 16; j < w; j += 38) { rect(j, 5, 22, 19, 0x293849); rect(j + 2, 7, 18, 14, 0xaa9d80); rect(j + 10, 7, 2, 14, 0x566272); }
      } else {
        furniture(0x927b64);
        for (let j = 5; j < h - 4; j += 6) rect(x + 3, y + j, w - 6, 1, 0x5e4e47);
        rect(x + 3, y + 2, 3, h - 5, 0x414854); rect(x + w - 6, y + 2, 3, h - 5, 0x414854);
      }
    } else if (room.id === 'bar') {
      if (index === 0) {
        rect(x, y, w, h, 0x41404c);
        for (let row = 0; row < 2; row += 1) {
          rect(15, 20 + row * 20, w - 30, 3, 0x91775f);
          for (let j = 0; j < 12; j += 1) { const bx = 24 + j * 20; rect(bx + 2, 9 + row * 20, 3, 3, 0xa6ac8f); rect(bx, 12 + row * 20, 7, 8, j % 3 ? 0x638279 : 0xab7967); }
        }
      } else {
        furniture(index === 3 ? 0x95745d : 0xa28a70);
        rect(x + 4, y + 4, w - 8, 1, 0xd3b68d);
        for (let j = 13; j < w - 10; j += 35) { rect(x + j, y + 8, 6, 6, 0xd8c9b6); rect(x + j + 2, y + 14, 2, 3, 0xb7ad9b); }
      }
    } else furniture();
    layerProps.addChild(g);
  }

  function buildRoom(room) {
    layerFloor.removeChildren().forEach((child) => child.destroy());
    layerProps.removeChildren().forEach((child) => child.destroy());
    roomId = room.id;
    roomSpots = room.spots || {};
    grid = buildGrid(room.id);
    const palette = ROOM_PALETTES[room.id] || ROOM_PALETTES.bedroom;
    const floor = new Graphics();
    floor.rect(0, 0, VIEW_W * TILE, VIEW_H * TILE).fill(palette.floor);
    const tiled = ['kitchen', 'corridor', 'street'].includes(room.id);
    for (let y = 0; y < VIEW_H; y += 1) for (let x = 0; x < VIEW_W; x += 1) {
      const tone = hash(x + room.seed, y) > 0.5 ? palette.alt : palette.floor;
      floor.rect(x * TILE, y * TILE, TILE, TILE).fill(tone);
      floor.rect(x * TILE, y * TILE + TILE - 1, TILE, 1).fill({ color: palette.line, alpha: 0.6 });
      if (tiled || (x + y) % 3 === 0) floor.rect(x * TILE, y * TILE, 1, TILE).fill({ color: palette.line, alpha: 0.45 });
      if (!tiled) floor.rect(x * TILE + 3, y * TILE + 5 + (x % 3), 10, 1).fill({ color: palette.line, alpha: 0.2 });
    }
    if (['bedroom', 'office', 'bar'].includes(room.id)) {
      floor.rect(87, 100, 125, 82).fill({ color: 0x33323f, alpha: 0.2 });
      floor.rect(84, 97, 125, 82).fill(palette.rug);
      floor.rect(87, 100, 119, 76).stroke({ width: 1, color: 0xb5aaa0, alpha: 0.3 });
      floor.rect(91, 104, 111, 68).stroke({ width: 1, color: 0xb5aaa0, alpha: 0.15 });
    }
    layerFloor.addChild(floor);
    const wall = new Graphics();
    wall.rect(0, 0, VIEW_W * TILE, 10).fill(palette.wall);
    wall.rect(0, 10, VIEW_W * TILE, 3).fill(palette.trim);
    wall.rect(0, 13, VIEW_W * TILE, 6).fill({ color: 0x232937, alpha: 0.18 });
    wall.rect(0, 0, 5, VIEW_H * TILE).fill(palette.wall);
    wall.rect(VIEW_W * TILE - 5, 0, 5, VIEW_H * TILE).fill(palette.wall);
    wall.rect(0, VIEW_H * TILE - 5, VIEW_W * TILE, 5).fill(palette.wall);
    layerProps.addChild(wall);
    (room.props || []).forEach((p, i) => drawProp(room, p, i));
    (room.candles || []).forEach((c) => {
      const candle = new Graphics();
      const cx = c.x * TILE, cy = c.y * TILE;
      candle.ellipse(cx, cy, 8, 3).fill({ color: 0x2e2b36, alpha: 0.25 });
      candle.rect(cx - 3, cy - 5, 6, 6).fill(0xd4c19f);
      candle.rect(cx - 2, cy - 5, 2, 5).fill(0xeee0bf);
      candle.rect(cx - 1, cy - 10, 2, 4).fill(0xe7bd7b);
      candle.rect(cx, cy - 9, 1, 2).fill(0xffebae);
      candle.circle(cx, cy - 8, 12).fill({ color: 0xe5b878, alpha: 0.07 });
      layerProps.addChild(candle);
    });
    // 小小的缝线娃娃始终在盒子的前沿，和玩家在戏里的身体不是同一个视觉对象。
    const doll = new Graphics();
    const dx = 132, dy = 235;
    doll.ellipse(dx, dy + 5, 7, 2).fill({ color: 0x242734, alpha: 0.35 });
    doll.rect(dx - 4, dy - 10, 8, 7).fill(0xba9a80);
    doll.rect(dx - 3, dy - 3, 6, 6).fill(0x998272);
    doll.rect(dx - 6, dy - 1, 2, 3).fill(0xba9a80); doll.rect(dx + 4, dy - 1, 2, 3).fill(0xba9a80);
    doll.rect(dx - 3, dy + 3, 2, 3).fill(0xba9a80); doll.rect(dx + 1, dy + 3, 2, 3).fill(0xba9a80);
    doll.rect(dx - 2, dy - 8, 1, 2).fill(0x413741); doll.rect(dx + 2, dy - 8, 1, 2).fill(0x413741);
    doll.rect(dx, dy - 1, 2, 2).fill(0xc77f73);
    layerProps.addChild(doll);
    renderAmbient();
  }

  // ---- 人物 ----
  const frameCache = {};
  function framesFor(castId) {
    if (!frameCache[castId]) {
      frameCache[castId] = lpcFrameCache.get(castId) || {
        frames: createCharacterFrames(castId),
        scale: 1,
        visual: 'original-pixel-32x48',
      };
    }
    return frameCache[castId];
  }

  const IDLE_ACTS = ['rest', 'drink', 'read', 'rest', 'rest'];
  function pickIdleAct(castId, frames) {
    const usable = IDLE_ACTS.filter((a) => frames[`${a}_0`] && frames[`${a}_1`]);
    if (!usable.length) return null;
    let n = 0;
    for (let i = 0; i < castId.length; i += 1) n = (n * 31 + castId.charCodeAt(i)) % 997;
    return usable[n % usable.length];
  }

  function buildActor(castId) {
    const { frames, scale } = framesFor(castId);
    if (!frames) return null;
    const first = frames.idle_down || frames.idle_0 || Object.values(frames)[0];
    const sprite = new Sprite(first);
    sprite.anchor.set(0.5, 1);
    sprite.scale.set(scale);
    layerActors.addChild(sprite);
    const shadow = new Graphics();
    shadow.ellipse(0, -1, 9, 3).fill({ color: 0x202534, alpha: 0.27 });
    shadow.ellipse(0, -1, 10, 4).stroke({ width: 0.7, color: CHARACTER_DESIGNS[castId]?.accent || '#a4a49d', alpha: 0.65 });
    layerShadows.addChild(shadow);
    return {
      sprite,
      shadow,
      frames,
      visual: framesFor(castId).visual,
      castId,
      moving: false,
      t: 0,
      facing: 'down',
      idleAct: pickIdleAct(castId, frames),
      actOffset: Math.floor(Math.random() * 9000),
      busyAct: null,
      busyUntil: 0,
      talkUntil: 0,
      pendingAct: null,
    };
  }

  function placeActor(entry, gx, gy) {
    entry.sprite.x = gx * TILE + TILE / 2;
    entry.sprite.y = gy * TILE + TILE;
    entry.gx = gx;
    entry.gy = gy;
    entry.path = null;
    entry.shadow.position.set(entry.sprite.x, entry.sprite.y);
    entry.sprite.zIndex = entry.sprite.y;
  }

  function dirKey(entry, facing) {
    const f = entry.frames;
    const d = facing === 'away' ? 'up' : facing;
    if (f[`idle_${d}`] || f[`walk_${d}_0`]) return d;
    return 'down';
  }

  function idleFrame(entry, d) {
    const f = entry.frames;
    const cycle = (entry.t + entry.actOffset) % 5400;
    const pose = cycle > 4900 && cycle < 5090 ? 'blink' : cycle < 1700 ? 'breathe' : 'idle';
    return f[`${pose}_${d}`] || f[`idle_${d}`] || f.idle_down || Object.values(f)[0];
  }

  function walkFrame(entry, d, time) {
    const f = entry.frames;
    const n = [0, 1, 2, 3].filter((i) => f[`walk_${d}_${i}`]).length;
    if (n) return f[`walk_${d}_${Math.floor(time / 140) % n}`];
    const g = [f.walk_0, f.walk_1].filter(Boolean);
    return g.length ? g[Math.floor(time / 140) % g.length] : idleFrame(entry, d);
  }

  /** 多帧循环的小动作（打字/喝水/干活……） */
  function actFrame(entry, act, time, period = 380) {
    const f = entry.frames;
    const fr = [0, 1, 2, 3].map((i) => f[`${act}_${i}`]).filter(Boolean);
    if (!fr.length) return null;
    return fr[Math.floor(time / period) % fr.length];
  }

  /** 待机小动作：播一小段，停一会儿。停顿比播放更重要，一直循环像抽搐。 */
  function idleActFrame(entry, time) {
    if (!entry.idleAct) return null;
    const fr = [entry.frames[`${entry.idleAct}_0`], entry.frames[`${entry.idleAct}_1`]].filter(Boolean);
    if (!fr.length) return null;
    const cycle = 6000 + fr.length * 700;
    const t = (time + entry.actOffset) % cycle;
    if (t > fr.length * 700) return null;
    return fr[Math.floor(t / 700) % fr.length];
  }

  // ---- 移动 ----

  /** 某格是否被别的角色站着或正要走过去 */
  function occupiedBy(gx, gy, exceptId) {
    for (const [id, e] of actors) {
      if (id === exceptId) continue;
      if (e.gx === gx && e.gy === gy) return true;
      const last = e.path && e.path.length ? e.path[e.path.length - 1] : null;
      if (last && last.x === gx && last.y === gy) return true;
    }
    return false;
  }

  /**
   * 目标格被人占了就挑它旁边最近的空格。
   * 三个人同时去拿吧台上的酒杯，不能都站进酒杯那一格——实测会叠成一个人。
   */
  function freeCellNear(gx, gy, exceptId) {
    if (isFree(grid, gx, gy) && !occupiedBy(gx, gy, exceptId)) return { x: gx, y: gy };
    const ring = [];
    for (let r = 1; r <= 3; r += 1) {
      for (let dy = -r; dy <= r; dy += 1) {
        for (let dx = -r; dx <= r; dx += 1) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const x = gx + dx;
          const y = gy + dy;
          if (isFree(grid, x, y) && !occupiedBy(x, y, exceptId)) ring.push({ x, y, d: Math.hypot(dx, dy) });
        }
      }
      if (ring.length) break;
    }
    if (!ring.length) return { x: gx, y: gy };
    ring.sort((a, b) => a.d - b.d);
    return { x: ring[0].x, y: ring[0].y };
  }

  function walkTo(castId, gx, gy, facing) {
    const entry = actors.get(castId);
    if (!entry) return;
    const target = freeCellNear(gx, gy, castId);
    const path = findPath(grid, { x: entry.gx, y: entry.gy }, target);
    if (!path || !path.length) {
      entry.moving = false;
      return;
    }
    entry.path = path;
    entry.targetFacing = facing || null;
    entry.moving = true;
  }

  /**
   * 去碰某样东西：走到它旁边，做一下动作。
   * 这是人物与环境交互在画面上的形态；环境的反馈由 envReact 表现。
   */
  function useObject(castId, objectId) {
    const entry = actors.get(castId);
    const obj = findObject(roomId, objectId);
    if (!entry || !obj) return;
    const spot = roomSpots[obj.spot] || roomSpots.middle;
    // 走到物件旁边（被占就挑邻格），不要求正好站进那一格
    if (spot) {
      const cell = freeCellNear(spot.x, spot.y, castId);
      if (entry.gx !== cell.x || entry.gy !== cell.y) walkTo(castId, cell.x, cell.y);
    }
    // 到了之后做一下：优先"干活"帧，没有就用说话帧
    entry.pendingAct = ['work', 'type', 'talk'].find((a) => entry.frames[`${a}_0`]) || null;
  }

  function setTex(entry, tex) {
    if (tex && entry.sprite.texture !== tex) entry.sprite.texture = tex;
  }

  // 移动按真实流逝的毫秒算，不按帧数。
  //
  // PixiJS 的 ticker 把单帧时长钳在 100ms（maxElapsedMS），窗口降频绘制时
  // 每次 RAF 只当作 6 帧，按帧数走位就会被饿死——实测三个人走了 13 秒才挪一格。
  // 用自己的时钟，并把上限放宽，走位就跟墙上的钟一致。
  app.ticker.maxElapsedMS = 1500;
  const WALK_PX_PER_MS = 0.036; // ≈ 2.2 格/秒
  let lastTick = performance.now();

  function tick() {
    const now = performance.now();
    // 上限放到 1.5 秒：预览窗格实测 RAF 只有约 1Hz，钳得太紧走位就跟不上台词的节奏
    const dtMs = Math.min(1500, now - lastTick);
    lastTick = now;

    actors.forEach((entry) => {
      entry.t += dtMs;

      if (entry.path && entry.path.length) {
        let budget = WALK_PX_PER_MS * dtMs;
        // 一帧里可能要跨好几格（降频时），所以循环消耗预算
        while (budget > 0 && entry.path.length) {
          const next = entry.path[0];
          const tx = next.x * TILE + TILE / 2;
          const ty = next.y * TILE + TILE;
          const dx = tx - entry.sprite.x;
          const dy = ty - entry.sprite.y;
          const dist = Math.hypot(dx, dy);
          if (dist > 0) entry.facing = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'away';
          if (dist <= budget) {
            entry.sprite.x = tx;
            entry.sprite.y = ty;
            entry.gx = next.x;
            entry.gy = next.y;
            entry.path.shift();
            budget -= dist;
            if (!entry.path.length) {
              entry.moving = false;
              if (entry.targetFacing) entry.facing = entry.targetFacing;
              entry.targetFacing = null;
            }
          } else {
            entry.sprite.x += (dx / dist) * budget;
            entry.sprite.y += (dy / dist) * budget;
            entry.facing = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'away';
            budget = 0;
          }
        }
        if (entry.path && !entry.path.length) entry.path = null;
        if (entry.path && entry.path.length) {
          setTex(entry, walkFrame(entry, dirKey(entry, entry.facing), entry.t));
          return;
        }
      }

      // 原地：先做该做的事（碰东西），再看是否在说话，最后才是待机小动作
      if (entry.pendingAct) {
        entry.busyAct = entry.pendingAct;
        entry.busyUntil = now + 1600;
        entry.pendingAct = null;
      }
      if (entry.busyAct && now < entry.busyUntil) {
        setTex(entry, actFrame(entry, entry.busyAct, entry.t) || idleFrame(entry, dirKey(entry, entry.facing)));
        return;
      }
      entry.busyAct = null;
      if (now < entry.talkUntil) {
        setTex(entry, actFrame(entry, 'talk', entry.t, 260) || idleFrame(entry, dirKey(entry, entry.facing)));
        return;
      }
      const direction = dirKey(entry, entry.facing);
      setTex(entry, (direction === 'down' && idleActFrame(entry, entry.t)) || idleFrame(entry, direction));
    });

    actors.forEach((entry) => {
      entry.shadow.position.set(entry.sprite.x, entry.sprite.y);
      entry.sprite.zIndex = entry.sprite.y;
    });
    if (ambient.weather === 'rain') drawRain(now);
  }

  app.ticker.add(() => tick());

  // ---- 特效 ----

  function spotPos(spotKey) {
    const s = roomSpots[spotKey] || roomSpots.middle || { x: 9, y: 8 };
    return { x: s.x * TILE + TILE / 2, y: s.y * TILE + TILE / 2 };
  }

  function ringsAt(x, y, color) {
    const g = new Graphics();
    g.circle(0, 0, 4).fill(color);
    g.x = x;
    g.y = y;
    const ring = new Graphics();
    ring.circle(0, 0, 5).stroke({ width: 2, color, alpha: 0.8 });
    ring.x = x;
    ring.y = y;
    layerFx.addChild(g, ring);
    let life = 0;
    const off = () => {
      life += 1;
      const t = life / 45;
      g.alpha = Math.max(0, 1 - t);
      g.scale.set(1 + t * 2);
      ring.alpha = Math.max(0, 0.9 - t);
      ring.scale.set(1 + t * 3.2);
      if (life > 45) {
        app.ticker.remove(off);
        g.destroy();
        ring.destroy();
      }
    };
    app.ticker.add(off);
  }

  function burstOn(castId, color = 0xcb5b4f) {
    const entry = actors.get(castId);
    ringsAt(entry ? entry.sprite.x : app.screen.width / 2, entry ? entry.sprite.y - 12 : app.screen.height / 2, color);
  }

  function shake(castId) {
    const entry = actors.get(castId);
    if (!entry) return;
    const base = entry.sprite.x;
    let n = 0;
    const off = () => {
      n += 1;
      entry.sprite.x = base + Math.sin(n * 0.9) * 2.5;
      if (n > 24) {
        app.ticker.remove(off);
        entry.sprite.x = base;
      }
    };
    app.ticker.add(off);
  }

  /**
   * 环境在某个物件处的反应。这是 ENV agent 在画面上的唯一形态。
   *   flicker  黄光一闪一闪（灯）
   *   knock    物件抖两下（门、桌）
   *   ring     扩散的环（电话、电梯）
   *   默认     柔和地亮一下，指认"是这件东西在响应"
   */
  function envReact(objectId, effect) {
    const obj = objectId ? findObject(roomId, objectId) : null;
    const p = obj ? spotPos(obj.spot) : { x: app.screen.width / 2, y: 12 };
    if (effect === 'ring') return ringsAt(p.x, p.y, 0xe5b878);
    const g = new Graphics();
    g.rect(-12, -12, 24, 24).fill({ color: effect === 'knock' ? 0xcb5b4f : 0xe5b878, alpha: 0.35 });
    g.x = p.x;
    g.y = p.y;
    layerFx.addChild(g);
    let life = 0;
    const off = () => {
      life += 1;
      if (effect === 'flicker') g.alpha = life % 10 < 5 ? 0.6 : 0.05;
      else if (effect === 'knock') g.x = p.x + Math.sin(life * 1.4) * 2;
      else g.alpha = 0.45 * Math.max(0, 1 - life / 50);
      if (life > 50) {
        app.ticker.remove(off);
        g.destroy();
      }
    };
    app.ticker.add(off);
    return undefined;
  }

  function bubble(x, y, text, name, muted) {
    const style = new TextStyle({ fontFamily: 'monospace', fontSize: 8, fill: muted ? 0x635a4f : 0x1b1614 });
    const nameStyle = new TextStyle({ fontFamily: 'monospace', fontSize: 7, fill: 0x7d4f42 });
    const label = new Text({ text: String(text).slice(0, 16), style });
    const nm = name ? new Text({ text: name, style: nameStyle }) : null;
    const w = Math.max(label.width, nm ? nm.width : 0) + 8;
    const h = nm ? 20 : 12;
    const box = new Container();
    const bg = new Graphics();
    bg.roundRect(-w / 2, -h - 2, w, h, 3).fill(muted ? 0xd8d0c0 : 0xe9ddc8);
    box.addChild(bg);
    if (nm) {
      nm.x = -w / 2 + 4;
      nm.y = -h - 1;
      box.addChild(nm);
      label.x = -w / 2 + 4;
      label.y = -h + 8;
    } else {
      label.anchor.set(0.5, 0.5);
      label.y = -h / 2 - 2;
    }
    box.addChild(label);
    box.x = Math.min(Math.max(x, w / 2 + 2), app.screen.width - w / 2 - 2);
    box.y = Math.max(h + 5, Math.min(y, app.screen.height - 4));
    layerFx.addChild(box);
    setTimeout(() => {
      if (!box.destroyed) box.destroy({ children: true });
    }, 2600);
  }

  function say(castId, text, displayName) {
    const entry = actors.get(castId);
    if (!entry) return;
    entry.talkUntil = performance.now() + 2200;
    entry.busyAct = null;
    bubble(entry.sprite.x, entry.sprite.y - entry.sprite.height - 6, text, displayName, false);
  }

  /** 环境说话：气泡挂在物件上；没有物件就挂在房间上沿 */
  function envSay(text, objectId) {
    const obj = objectId ? findObject(roomId, objectId) : null;
    const p = obj ? spotPos(obj.spot) : { x: app.screen.width / 2, y: 28 };
    bubble(p.x, p.y - 8, text, null, true);
    if (obj) envReact(objectId, undefined);
  }

  let focusTimer = 0;
  function focus(castId, holdMs = 2600) {
    actors.forEach((entry, id) => {
      entry.sprite.alpha = id === castId ? 1 : 0.55;
    });
    clearTimeout(focusTimer);
    focusTimer = setTimeout(() => actors.forEach((e) => (e.sprite.alpha = 1)), holdMs);
  }

  // ---- 天气与灯光 ----

  const weatherG = new Graphics();
  const lightG = new Graphics();
  layerAmbient.addChild(weatherG, lightG);

  function renderAmbient() {
    lightG.clear();
    if (ambient.light === 'dim') lightG.rect(0, 0, app.screen.width, app.screen.height).fill({ color: 0x0b0a14, alpha: 0.3 });
    if (ambient.light === 'off') lightG.rect(0, 0, app.screen.width, app.screen.height).fill({ color: 0x06060c, alpha: 0.6 });
    if (ambient.weather === 'night') lightG.rect(0, 0, app.screen.width, app.screen.height).fill({ color: 0x0e1024, alpha: 0.35 });
    weatherG.clear();
    if (ambient.weather === 'snow') {
      for (let i = 0; i < 60; i++) weatherG.rect((i * 71) % app.screen.width, (i * 43) % app.screen.height, 2, 2).fill({ color: 0xe9ddc8, alpha: 0.6 });
    }
  }

  function drawRain(now) {
    weatherG.clear();
    const off = (now / 12) % app.screen.height;
    for (let i = 0; i < 70; i++) {
      const x = (i * 61) % app.screen.width;
      const y = (i * 97 + off) % app.screen.height;
      weatherG.moveTo(x, y).lineTo(x - 2, y + 7).stroke({ width: 1, color: 0x6f8ba0, alpha: 0.45 });
    }
  }

  function setAmbient(next) {
    ambient = { ...ambient, ...(next || {}) };
    renderAmbient();
  }

  // ---- 对外接口 ----

  function setModel(next) {
    if (next.room && next.room.id !== roomId) {
      buildRoom(next.room);
      // 房间换了，重新放置路人；人物纹理从缓存复用。
      const z = actors.get('Z');
      if (z) {
        z.sprite.destroy();
        z.shadow.destroy();
        actors.delete('Z');
      }
    }
    if (next.ambient) setAmbient(next.ambient);

    const wanted = new Map((next.actors || []).map((a) => [a.castId, a]));
    actors.forEach((entry, id) => {
      if (!wanted.has(id)) {
        entry.sprite.destroy();
        entry.shadow.destroy();
        actors.delete(id);
      }
    });
    wanted.forEach((a, id) => {
      let entry = actors.get(id);
      if (!entry) {
        entry = buildActor(id);
        if (!entry) return;
        actors.set(id, entry);
        const spot = roomSpots[a.spot] || roomSpots.middle || { x: 9, y: 8 };
        placeActor(entry, a.gx ?? spot.x, a.gy ?? spot.y);
        entry.facing = a.facing || 'down';
        return;
      }
      if (a.gx !== undefined && a.gy !== undefined && !entry.path && (entry.gx !== a.gx || entry.gy !== a.gy)) {
        walkTo(id, a.gx, a.gy, a.facing);
      }
    });
  }

  const debug = () => ({
    roomId,
    ambient,
    floorTiles: layerFloor.children.length,
    propNodes: layerProps.children.length,
    fxNodes: layerFx.children.length,
    actors: [...actors.entries()].map(([id, e]) => ({
      id,
      x: Math.round(e.sprite.x),
      y: Math.round(e.sprite.y),
      gx: e.gx,
      gy: e.gy,
      alpha: e.sprite.alpha,
      moving: e.moving,
      idleAct: e.idleAct,
      busy: e.busyAct,
      frame: (() => {
        const uid = e.sprite.texture.uid;
        for (const [n, t] of Object.entries(e.frames)) if (t.uid === uid) return n;
        return '?';
      })(),
      frames: Object.keys(e.frames).length,
      visual: e.visual,
      facing: e.facing,
    })),
  });

  return { setModel, walkTo, useObject, envReact, envSay, setAmbient, burstOn, shake, say, focus, app, debug, view: { w: VIEW_W * TILE, h: VIEW_H * TILE } };
}
