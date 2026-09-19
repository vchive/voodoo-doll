// 房间定义（前端渲染用）
//
// 与 shared/cast.js 的 ROOMS 对应，这里补上像素坐标与家具。
// 房间 18 格宽 × 16 格高。
//
// 家具的 `solid` 决定它挡不挡人：
//   solid: true  —— 床、柜、桌椅这类有实体的，角色不能穿过，会绕行
//   solid: false —— 地毯、窗户、门、灯具这类贴着地面或墙面的，角色可以走过去
//
// 不区分的话，要么人穿床，要么人卡在地毯外面进不来。

export const ROOMS = {
  bedroom: {
    id: 'bedroom',
    label: '卧室',
    seed: 11,
    props: [
      { x: 1, y: 2, w: 4, h: 3, color: 0x8a7458, solid: true },   // 床
      { x: 14, y: 1, w: 3, h: 4, color: 0x6f8ba0, solid: false },  // 落地窗
      { x: 14, y: 11, w: 2, h: 2, color: 0x8a7458, solid: true },  // 床头柜
      { x: 6, y: 13, w: 6, h: 1, color: 0x7a6448, solid: false }, // 地毯
    ],
    candles: [{ x: 9, y: 14 }],
    spots: {
      door: { x: 2, y: 13 },
      window: { x: 13, y: 7 },
      bed: { x: 5, y: 2 },
      middle: { x: 9, y: 8 },
      near: { x: 7, y: 11 },
      far: { x: 11, y: 3 },
      side: { x: 15, y: 8 },
    },
  },
  kitchen: {
    id: 'kitchen',
    label: '厨房',
    seed: 23,
    props: [
      { x: 1, y: 1, w: 6, h: 2, color: 0x8a7458, solid: true },   // 灶台
      { x: 7, y: 8, w: 5, h: 3, color: 0x7a6448, solid: true },   // 餐桌
      { x: 13, y: 1, w: 4, h: 2, color: 0x6f8ba0, solid: false }, // 窗
    ],
    candles: [{ x: 9, y: 14 }],
    spots: {
      door: { x: 2, y: 13 },
      stove: { x: 4, y: 4 },
      table: { x: 9, y: 12 },
      middle: { x: 9, y: 7 },
      near: { x: 5, y: 6 },
      far: { x: 14, y: 5 },
      side: { x: 15, y: 10 },
    },
  },
  corridor: {
    id: 'corridor',
    label: '走廊',
    seed: 37,
    props: [
      { x: 1, y: 3, w: 2, h: 4, color: 0x8a7458, solid: false },  // 侧门
      { x: 15, y: 3, w: 2, h: 4, color: 0x8a7458, solid: false }, // 侧门
      { x: 7, y: 1, w: 4, h: 1, color: 0x7a6448, solid: false },  // 尽头
    ],
    candles: [{ x: 9, y: 14 }],
    spots: {
      far: { x: 9, y: 3 },
      near: { x: 9, y: 13 },
      side: { x: 4, y: 8 },
      middle: { x: 9, y: 8 },
      door: { x: 2, y: 12 },
      window: { x: 15, y: 8 },
    },
  },
  office: {
    id: 'office',
    label: '办公室',
    seed: 53,
    props: [
      { x: 1, y: 2, w: 5, h: 3, color: 0x8a7458, solid: true },   // 工位
      { x: 12, y: 2, w: 5, h: 3, color: 0x7a6448, solid: true }, // 工位
      { x: 4, y: 12, w: 10, h: 1, color: 0x7a6448, solid: true },// 会议桌
    ],
    candles: [{ x: 9, y: 14 }],
    spots: {
      door: { x: 2, y: 13 },
      desk: { x: 4, y: 6 },
      away: { x: 14, y: 6 },
      middle: { x: 9, y: 9 },
      near: { x: 6, y: 10 },
      far: { x: 13, y: 10 },
      side: { x: 16, y: 5 },
    },
  },
  street: {
    id: 'street',
    label: '街上',
    seed: 67,
    props: [
      { x: 0, y: 0, w: 18, h: 2, color: 0x3a3a44, solid: false }, // 楼体
      { x: 2, y: 10, w: 3, h: 2, color: 0x6b5a45, solid: true },  // 长椅
      { x: 12, y: 9, w: 4, h: 2, color: 0x6b5a45, solid: true }, // 长椅
    ],
    candles: [{ x: 16, y: 3 }],
    spots: {
      near: { x: 5, y: 12 },
      far: { x: 12, y: 5 },
      corner: { x: 2, y: 6 },
      middle: { x: 9, y: 8 },
      door: { x: 1, y: 13 },
      side: { x: 15, y: 12 },
    },
  },
  bar: {
    id: 'bar',
    label: '酒吧',
    seed: 79,
    props: [
      { x: 0, y: 0, w: 18, h: 3, color: 0x4a2f2a, solid: false }, // 背景墙
      // 吧台分两段，中间留一个过道口（x=9）——
      // 原来是一整条 16 格宽的吧台，把房间横切成两半，
      // 上半区只有 32 格可达，角色根本走不过去。
      { x: 1, y: 11, w: 8, h: 2, color: 0x7a6448, solid: true },  // 吧台左段
      { x: 10, y: 11, w: 7, h: 2, color: 0x7a6448, solid: true }, // 吧台右段
      { x: 6, y: 6, w: 6, h: 2, color: 0x5a4636, solid: true },   // 桌
    ],
    candles: [{ x: 3, y: 5 }, { x: 14, y: 5 }],
    spots: {
      door: { x: 2, y: 13 },
      bar: { x: 9, y: 10 },
      corner: { x: 15, y: 7 },
      // 桌子占 y=6..7、吧台占 y=11..12，中间 y=8..10 是主通道，x=9 是过道口。
      // 原来的 middle(9,7) 落在桌子里、side(16,12) 落在吧台里，两人会卡住。
      middle: { x: 9, y: 8 },
      near: { x: 5, y: 9 },
      far: { x: 13, y: 4 },
      side: { x: 16, y: 8 },
    },
  },
};

// 每个房间默认把几个人放在哪。用于开场和没给位置时的兜底。
export const DEFAULT_SPOTS = ['middle', 'near', 'far', 'side', 'door'];

/**
 * 给一组在场角色分配互不重叠的位置。
 * 这是「多角色不叠在一起」的保证，之前五个角色会全挤在中间。
 */
export function assignSpots(roomId, castIds) {
  const room = ROOMS[roomId] || ROOMS.bedroom;
  const available = DEFAULT_SPOTS.filter((k) => room.spots[k]);
  const out = {};
  castIds.forEach((id, i) => {
    const key = available[i % available.length];
    out[id] = key;
  });
  return out;
}
