// 002 · 人物、agent 与房间定义（前后端共用）
//
// 六个 agent 位（用户 2026-09-18 定稿）：
//
//   DOLL  巫毒娃娃 && 玩家角色。娃娃是 agent；玩家在戏里的身体（YOU）不是 agent，
//         只被娃娃调度。见 docs/decisions/0002-agent-split.md。
//   ENV   环境。它也是一个 agent：房间里的物件、天气、灯光都归它。
//         任何人跟环境交互，环境都要有反馈。见 docs/decisions/0003-environment-agent.md。
//   A/B/C 三个可自定义名字的人物，各自独立 agent。
//   Z     通用路人。每次出场换一个泛指身份（同事/酒保/邻居），不消耗模型调用。
//
// 数量上限先定为这 6 个；结构上允许再加（CAST 是表驱动的，加一行即可）。
//
// 这里的定义是**契约的一部分**：模型只能从这个名单里选角色，不能自己发明人物。

/**
 * 舞台上会出现的人物。
 * `agent: true` 的位会被单独调用模型；`renameable` 决定玩家能否改昵称。
 */
export const CAST = {
  YOU: {
    id: 'YOU',
    kind: 'player',
    archetype: '你',
    defaultName: '你',
    role: 'protagonist',
    // 玩家角色不是 agent：它是娃娃手里的一具身体，没有独立意志。
    agent: false,
    renameable: false,
  },
  A: {
    id: 'A',
    kind: 'named',
    archetype: '那个人',
    defaultName: '他',
    role: 'villain',
    agent: true,
    renameable: true,
  },
  B: {
    id: 'B',
    kind: 'named',
    archetype: '另一个人',
    defaultName: '她',
    role: 'rival',
    agent: true,
    renameable: true,
  },
  C: {
    id: 'C',
    kind: 'named',
    archetype: '知情者',
    defaultName: '知情的人',
    role: 'witness',
    agent: true,
    renameable: true,
  },
  Z: {
    id: 'Z',
    kind: 'extra',
    archetype: '路人',
    defaultName: '一个人',
    role: 'extra',
    agent: false,
    renameable: false,
  },
};

export const CAST_IDS = Object.keys(CAST);

// A-Y are reserved for meaningful, persistent character slots. Only slots
// currently present in CAST are active; Z remains a reusable passerby.
export const MEANINGFUL_ROLE_SLOT_IDS = Object.freeze(
  Array.from({ length: 25 }, (_, index) => String.fromCharCode(65 + index)),
);
export const REGISTERED_MEANINGFUL_ROLE_IDS = Object.freeze(
  MEANINGFUL_ROLE_SLOT_IDS.filter((id) => CAST[id]?.kind === 'named'),
);

/** 可以被玩家请上场、也可以被点名说话的人物（不含路人）。 */
export const STAGE_IDS = CAST_IDS.filter((id) => CAST[id].kind !== 'extra');

/** 可以改名的人物 */
export const RENAMEABLE_IDS = CAST_IDS.filter((id) => CAST[id].renameable);

/**
 * 不在舞台上、但会"说话"的 agent。
 * 'doll' 沿用小写是为了和早期存档兼容。
 */
export const VOICES = {
  doll: { id: 'doll', label: '娃娃', kind: 'doll' },
  ENV: { id: 'ENV', label: '环境', kind: 'env' },
};

/** 一切合法的说话者：舞台人物 + 娃娃 + 环境 */
export const SPEAKER_IDS = [...CAST_IDS, ...Object.keys(VOICES)];

export function isCastId(id) {
  return CAST_IDS.includes(id);
}

export function isSpeakerId(id) {
  return SPEAKER_IDS.includes(id);
}

/** 房间。多房间：玩家决定谁和谁在哪里碰面。 */
export const ROOMS = {
  bedroom: { id: 'bedroom', label: '卧室', tone: '私密' },
  kitchen: { id: 'kitchen', label: '厨房', tone: '日常' },
  corridor: { id: 'corridor', label: '走廊', tone: '过渡' },
  office: { id: 'office', label: '办公室', tone: '公开' },
  street: { id: 'street', label: '街上', tone: '公开' },
  bar: { id: 'bar', label: '酒吧', tone: '昏暗' },
};

export const ROOM_IDS = Object.keys(ROOMS);

/**
 * 每个房间有哪些站位可去。
 *
 * 这是「契约的一部分」：模型只能从这里选位置，不能凭空造一个。
 * 与前端 hex/rooms.js 的 spots 键保持一致——那边多了像素坐标，这边只要名字。
 */
export const ROOM_SPOT_KEYS = {
  bedroom: ['door', 'window', 'bed', 'middle', 'near', 'far', 'side'],
  kitchen: ['door', 'stove', 'table', 'middle', 'near', 'far', 'side'],
  corridor: ['far', 'near', 'side', 'middle', 'door', 'window'],
  office: ['door', 'desk', 'away', 'middle', 'near', 'far', 'side'],
  street: ['near', 'far', 'corner', 'middle', 'door', 'side'],
  bar: ['door', 'bar', 'corner', 'middle', 'near', 'far', 'side'],
};

/**
 * 舞台状态。
 * 玩家决定「谁在场、在哪个房间」，模型不能自作主张添加人物或换房间。
 */
export function emptyStage() {
  return {
    roomId: 'bedroom',
    present: ['YOU', 'A'], // 默认：你和他在卧室
    // 每个角色当前的站位，由剧本的 move 动作改变
    poses: {},
    // 环境状态：由 ENV agent 的 ambient 动作改变
    ambient: { weather: 'clear', light: 'on' },
  };
}

export const WEATHERS = ['clear', 'rain', 'night', 'snow'];
export const LIGHTS = ['on', 'dim', 'off'];

export function normalizeStage(raw) {
  const stage = emptyStage();
  if (!raw || typeof raw !== 'object') return stage;

  if (ROOM_IDS.includes(raw.roomId)) stage.roomId = raw.roomId;

  if (Array.isArray(raw.present)) {
    // 旧存档里的 'B' 曾经是玩家，现在 'B' 是另一个人：直接丢弃旧 id，回默认
    const ids = raw.present.filter((id) => STAGE_IDS.includes(id));
    stage.present = [...new Set(ids)].slice(0, STAGE_IDS.length);
    if (!stage.present.includes('YOU')) stage.present.unshift('YOU'); // 玩家总在场
    if (!stage.present.length) stage.present = ['YOU'];
  }

  if (raw.poses && typeof raw.poses === 'object') {
    for (const [id, pose] of Object.entries(raw.poses)) {
      if (CAST_IDS.includes(id) && typeof pose === 'string' && pose.length <= 12) {
        stage.poses[id] = pose;
      }
    }
  }

  if (raw.ambient && typeof raw.ambient === 'object') {
    if (WEATHERS.includes(raw.ambient.weather)) stage.ambient.weather = raw.ambient.weather;
    if (LIGHTS.includes(raw.ambient.light)) stage.ambient.light = raw.ambient.light;
  }

  return stage;
}
