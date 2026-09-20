import type { PlaySnapshot } from './play-api';

// This is an explicit offline exploration branch. It never advances the
// server-owned authored story or invents successful actions for unknown input.
export type LocalAction = { action: 'move' | 'observe' | 'use'; payload: { roomId?: string; waitMinutes?: number; verb?: string } };
export function parseLocalAction(value: string, roomLabels: Record<string, string>): LocalAction | null {
  if (/开门|打开.{0,8}门|推开.{0,8}门/.test(value)) return { action: 'use', payload: { verb: 'open' } };
  if (/关门|关上.{0,8}门/.test(value)) return { action: 'use', payload: { verb: 'close' } };
  if (/^(?:等待|等)(?:\s*(\d+|十)\s*分钟)?$/.test(value)) {
    const minutes = Number(value.match(/\d+/)?.[0] || 10);
    return { action: 'observe', payload: { waitMinutes: Math.min(120, Math.max(1, minutes)) } };
  }
  if (/^(?:观察周围|观察房间|看看周围|观察)$/.test(value)) return { action: 'observe', payload: {} };
  const destination = Object.entries(roomLabels).find(([, label]) => ['去', '前往', '走到', '回到'].some((verb) => value === verb + label));
  return destination ? { action: 'move', payload: { roomId: destination[0] } } : null;
}
export function applyLocalAction(snapshot: PlaySnapshot, action: LocalAction): { snapshot: PlaySnapshot; feedback: string } {
  const result: PlaySnapshot = structuredClone(snapshot);
  let feedback = '你环顾四周。离线时可以移动、开门和等待，完整人物剧情会在重新连接后继续。';
  if (action.action === 'move' && action.payload.roomId) {
    result.roomId = action.payload.roomId;
    result.present = ['YOU']; // Cached NPC positions are not a live schedule projection.
    feedback = '你和巫毒娃娃来到了新的地点。本机探索已记录。';
  } else if (action.action === 'use') {
    result.environment = { ...result.environment, localDoor: action.payload.verb };
    feedback = action.payload.verb === 'open' ? '你推开了眼前的门，停在门口向外看。' : '你把门轻轻关上。';
  }
  const wait = action.payload.waitMinutes || 0;
  if (wait) {
    const total = (result.clock?.minute || 0) + wait;
    result.clock = { ...result.clock, day: (result.clock?.day || 1) + Math.floor(total / 1440), minute: total % 1440 };
    feedback = `你在本机世界等了 ${wait} 分钟。`;
  }
  result.worldVersion += 1;
  return { snapshot: result, feedback };
}
