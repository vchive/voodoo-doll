// 002 · 网格寻路与碰撞
//
// 角色不能穿过实心家具，要绕行。用 BFS 而不是 A*：
// 地图只有 18×16 = 288 格，BFS 完全够快，而且不用维护启发函数。
//
// 关键约束：**站位必须可达**。如果目标点被家具围死，BFS 找不到路，
// 这时不能把角色留在原地不动（那看起来像卡住了），而应该退到最近的可达点。

import { ROOMS } from './rooms.js';

export const GRID_W = 18;
export const GRID_H = 16;

// 墙的厚度：渲染时四周有 7px 的墙沿，换算成格子大约占半格。
// 角色中心不能贴到最外圈，否则会看起来半个人在墙里。
const MARGIN = 1;

/**
 * 构建某个房间的阻挡表。
 * 只把 solid 的家具算进去——地毯、窗、门不挡人。
 */
export function buildGrid(roomId) {
  const room = ROOMS[roomId] || ROOMS.bedroom;
  const blocked = new Uint8Array(GRID_W * GRID_H);

  for (let y = 0; y < GRID_H; y++) {
    for (let x = 0; x < GRID_W; x++) {
      // 最外圈是墙
      if (x < MARGIN || y < MARGIN || x >= GRID_W - MARGIN || y >= GRID_H - MARGIN) {
        blocked[y * GRID_W + x] = 1;
      }
    }
  }

  (room.props || []).forEach((p) => {
    if (!p.solid) return;
    for (let y = p.y; y < p.y + p.h; y++) {
      for (let x = p.x; x < p.x + p.w; x++) {
        if (x >= 0 && y >= 0 && x < GRID_W && y < GRID_H) blocked[y * GRID_W + x] = 1;
      }
    }
  });

  return { blocked, room };
}

const DIRS = [
  [0, -1],
  [0, 1],
  [-1, 0],
  [1, 0],
];

function isBlocked(grid, x, y) {
  if (x < 0 || y < 0 || x >= GRID_W || y >= GRID_H) return true;
  return grid.blocked[y * GRID_W + x] === 1;
}

/**
 * 从起点到终点的路径。返回格坐标数组（含终点），不含起点。
 * 找不到路返回 null。
 */
export function findPath(grid, from, to) {
  if (from.x === to.x && from.y === to.y) return [];

  // 目标本身被占（比如站位改坏了）：退而求其次，找离它最近的可走格
  let target = to;
  if (isBlocked(grid, to.x, to.y)) {
    const near = nearestFree(grid, to, from);
    if (!near) return null;
    target = near;
  }

  const start = from.y * GRID_W + from.x;
  const goal = target.y * GRID_W + target.x;

  const prev = new Int32Array(GRID_W * GRID_H).fill(-1);
  const seen = new Uint8Array(GRID_W * GRID_H);
  const queue = [start];
  seen[start] = 1;

  let head = 0;
  while (head < queue.length) {
    const cur = queue[head++];
    if (cur === goal) break;

    const cx = cur % GRID_W;
    const cy = (cur - cx) / GRID_W;

    for (const [dx, dy] of DIRS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (isBlocked(grid, nx, ny)) continue;
      const ni = ny * GRID_W + nx;
      if (seen[ni]) continue;
      seen[ni] = 1;
      prev[ni] = cur;
      queue.push(ni);
    }
  }

  if (!seen[goal]) return null;

  const path = [];
  let cur = goal;
  while (cur !== start && cur !== -1) {
    const cx = cur % GRID_W;
    const cy = (cur - cx) / GRID_W;
    path.push({ x: cx, y: cy });
    cur = prev[cur];
  }
  path.reverse();
  return path;
}

/**
 * 找离某格最近的可走格（用于目标被占时兜底）。
 *
 * 按真实距离排序，而不是按方环扫到的第一个——
 * 方环扫描会先返回角落（比如 (1,1)），角色跑贴到墙上，看起来像嵌进墙里。
 */
function nearestFree(grid, cell, prefer) {
  const cands = [];
  for (let dy = -5; dy <= 5; dy++) {
    for (let dx = -5; dx <= 5; dx++) {
      const x = cell.x + dx;
      const y = cell.y + dy;
      if (isBlocked(grid, x, y)) continue;
      let d = Math.hypot(dx, dy);
      // 如果知道起点，优先选离起点近的——角色不用白跑一趟
      if (prefer) d += Math.hypot(x - prefer.x, y - prefer.y) * 0.3;
      cands.push({ x, y, d });
    }
  }
  if (!cands.length) return null;
  cands.sort((a, b) => a.d - b.d);
  return { x: cands[0].x, y: cands[0].y };
}

/** 某格是否可站立 */
export function isFree(grid, x, y) {
  return !isBlocked(grid, x, y);
}

/**
 * 房间视野内可达的格数。用于自检：如果可达区太小，说明家具把地图堵死了。
 */
export function reachableCount(grid, from) {
  if (isBlocked(grid, from.x, from.y)) return 0;
  const seen = new Uint8Array(GRID_W * GRID_H);
  const queue = [from.y * GRID_W + from.x];
  seen[queue[0]] = 1;
  let head = 0;
  while (head < queue.length) {
    const cur = queue[head++];
    const cx = cur % GRID_W;
    const cy = (cur - cx) / GRID_W;
    for (const [dx, dy] of DIRS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (isBlocked(grid, nx, ny)) continue;
      const ni = ny * GRID_W + nx;
      if (seen[ni]) continue;
      seen[ni] = 1;
      queue.push(ni);
    }
  }
  return queue.length;
}
