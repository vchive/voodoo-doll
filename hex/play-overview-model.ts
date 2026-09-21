import type { PlayProfile, PlaySnapshot } from './play-api';
// These are renderer-only furniture footprints, never world geometry.
// @ts-expect-error The retained legacy room catalogue is plain JavaScript.
import { ROOMS } from './rooms.js';

export const OVERVIEW_VIEW = { width: 288, height: 256 } as const;
export type OverviewPropKind = 'bed' | 'window' | 'cabinet' | 'rug' | 'counter' | 'table' | 'door' | 'desk' | 'bench' | 'building' | 'shelves' | 'sofa' | 'tree' | 'pond' | 'boxes' | 'tracks' | 'sign';
export type OverviewProp = { kind: OverviewPropKind; x: number; y: number; w: number; h: number; solid: boolean };
export type OverviewActor = {
  actorId: string;
  label: string;
  visual: 'pixel' | 'marker';
  gx: number;
  gy: number;
  /** Body centre, relative to the 288 x 256 drawing, not its letterboxed host. */
  xPercent: number;
  yPercent: number;
  footYPercent: number;
};
export type OverviewProjection = {
  worldKey: string;
  roomId: string;
  roomLabel: string;
  layoutKind: 'schematic';
  view: typeof OVERVIEW_VIEW;
  actors: OverviewActor[];
  props: OverviewProp[];
  palette: { floor: number; alternate: number; wall: number; trim: number };
  light: 'on' | 'dim' | 'off';
};

const LABELS: Record<string, string> = { home: '家', bedroom: '卧室', kitchen: '厨房', hall: '走廊', parlor: '客厅', garden: '花园', attic: '阁楼', office: '办公室', street: '街道', station: '地铁站', bar: '酒吧' };
const prop = (kind: OverviewPropKind, x: number, y: number, w: number, h: number, solid = true): OverviewProp => ({ kind, x, y, w, h, solid });
const existing = (roomId: string, kinds: OverviewPropKind[]): OverviewProp[] => ROOMS[roomId].props.map((p: Omit<OverviewProp, 'kind'>, i: number) => ({ kind: kinds[i], x: p.x, y: p.y, w: p.w, h: p.h, solid: p.solid }));

// Canonical scenes retain their own meaning. A station has rails and a
// platform; a parlor has a sofa. Neither is a renamed legacy bedroom.
const SCENERY: Record<string, OverviewProp[]> = {
  home: existing('bedroom', ['bed', 'window', 'cabinet', 'rug']),
  bedroom: existing('bedroom', ['bed', 'window', 'cabinet', 'rug']),
  kitchen: existing('kitchen', ['counter', 'table', 'window']),
  hall: existing('corridor', ['door', 'door', 'cabinet']),
  office: existing('office', ['desk', 'desk', 'table']),
  street: existing('street', ['building', 'bench', 'bench']),
  bar: existing('bar', ['shelves', 'counter', 'counter', 'table']),
  parlor: [prop('sofa', 1, 2, 6, 3), prop('window', 13, 1, 4, 2, false), prop('table', 7, 7, 4, 2), prop('rug', 5, 6, 8, 5, false), prop('cabinet', 14, 10, 3, 3)],
  garden: [prop('tree', 1, 2, 3, 3), prop('tree', 14, 1, 3, 4), prop('pond', 11, 9, 5, 4), prop('bench', 2, 11, 4, 2)],
  attic: [prop('boxes', 1, 2, 4, 3), prop('window', 8, 1, 3, 2, false), prop('boxes', 13, 2, 4, 3), prop('shelves', 13, 10, 4, 3), prop('table', 2, 11, 4, 2)],
  station: [prop('tracks', 1, 1, 16, 3), prop('sign', 2, 5, 3, 1, false), prop('bench', 2, 10, 3, 2), prop('bench', 12, 10, 3, 2)],
};

const PALETTES: Record<string, OverviewProjection['palette']> = {
  home: { floor: 0x756252, alternate: 0x7b6858, wall: 0x424654, trim: 0xaaa192 },
  kitchen: { floor: 0x718284, alternate: 0x7a898a, wall: 0x3f5158, trim: 0x9baba9 },
  office: { floor: 0x797267, alternate: 0x80786c, wall: 0x48515b, trim: 0x9b9990 },
  street: { floor: 0x545d6a, alternate: 0x59616f, wall: 0x383e4d, trim: 0x7a8190 },
  station: { floor: 0x75868c, alternate: 0x7d8d92, wall: 0x364752, trim: 0xb4b4a4 },
  garden: { floor: 0x65795b, alternate: 0x6c805f, wall: 0x435a4b, trim: 0x99aa82 },
};

const PREFERRED: Record<string, [number, number]> = { YOU: [7, 12], A: [4, 7], B: [13, 7], C: [10, 6], Z: [13, 12] };
const PIXEL_IDS = new Set(['YOU', 'A', 'B', 'C', 'Z']);

/** Public presence is authoritative. Indoor geometry is not part of the
 * public API, so backend positions are deliberately NOT treated as 16px
 * cells. These local spots only arrange the overview and are never saved. */
export function projectOverview(snapshot: PlaySnapshot, profile: PlayProfile): OverviewProjection {
  const roomId = snapshot.roomId;
  const props = (SCENERY[roomId] || []).map((p) => ({ ...p }));
  const present = Array.isArray(snapshot.present) ? snapshot.present : [];
  const ids = [...new Set(present.filter((id) => id === 'YOU' || /^[A-Z]$/.test(id)))].filter((id) => {
    const room = snapshot.agents?.[id]?.roomId;
    return !room || room === roomId;
  }).sort((a, b) => a === 'YOU' ? -1 : b === 'YOU' ? 1 : a.localeCompare(b));
  const occupied: Array<{ gx: number; gy: number }> = [];
  const actors = ids.map((actorId, index): OverviewActor => {
    const [preferX, preferY] = PREFERRED[actorId] || [3 + (index % 4) * 4, 6 + Math.floor(index / 4) * 3];
    const free: Array<{ gx: number; gy: number; score: number }> = [];
    for (let gy = 5; gy <= 14; gy += 1) for (let gx = 2; gx <= 15; gx += 1) {
      if (props.some((p) => p.solid && gx >= p.x && gx < p.x + p.w && gy >= p.y && gy < p.y + p.h)) continue;
      if (occupied.some((p) => p.gx === gx && p.gy === gy)) continue;
      // Prefer enough room for separate body/hotspot targets, while still
      // retaining every public actor if a custom story has a larger cast.
      const crowd = occupied.reduce((n, p) => n + (Math.abs(p.gx - gx) < 3 && Math.abs(p.gy - gy) < 3 ? 40 : 0), 0);
      free.push({ gx, gy, score: Math.hypot(gx - preferX, gy - preferY) + crowd });
    }
    free.sort((a, b) => a.score - b.score || a.gy - b.gy || a.gx - b.gx);
    const { gx, gy } = free[0] || { gx: 9, gy: 8 };
    occupied.push({ gx, gy });
    const label = actorId === 'YOU' ? '你' : profile.names?.[actorId]?.trim() || (actorId === 'Z' ? '路人' : `角色 ${actorId}`);
    return { actorId, label, visual: PIXEL_IDS.has(actorId) ? 'pixel' : 'marker', gx, gy,
      xPercent: (gx * 16 + 8) / OVERVIEW_VIEW.width * 100,
      yPercent: (gy * 16 - 4) / OVERVIEW_VIEW.height * 100,
      footYPercent: (gy * 16 + 16) / OVERVIEW_VIEW.height * 100 };
  });
  const envLight = snapshot.environment?.light;
  return { worldKey: snapshot.worldId || 'local', roomId, roomLabel: LABELS[roomId] || '当前场景', layoutKind: 'schematic', view: OVERVIEW_VIEW,
    actors, props, palette: { ...(PALETTES[roomId] || PALETTES.home) },
    light: envLight === 'off' || envLight === 'dim' ? envLight : 'on' };
}
