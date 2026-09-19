// 002 · 环境：房间里的物件、可做的动作、谁能做（前后端共用）
//
// 这是 ENV agent 的"身体"。它拥有房间里的每一样东西；
// 任何人对这些东西做了什么，它都要给反馈。
//
// 三张表：
//   ROOM_OBJECTS      每个房间有哪些物件、各自能被怎么用、在房间的哪个位置
//   ROLE_AFFORDANCES  每种身份的人能对环境做哪些动作（这就是「每个角色与环境交互的内容」）
//   DOLL_NUDGES       娃娃自己能对环境做的"暗手"——它不是人，能让灯闪、让电话响
//
// 表驱动的目的是少写业务逻辑：环境的反应交给 ENV agent 自己去说，
// 这里只定义"什么合法"。

/**
 * 物件。verbs 是它承受的动作；spot 是它在房间里的位置（与 ROOM_SPOT_KEYS 对齐）。
 * label 给模型和玩家看；id 进契约。
 */
export const ROOM_OBJECTS = {
  bedroom: [
    // flicker 是娃娃的暗手之一，屋里得有东西能"闪"，否则它在卧室没法施法
    { id: 'lamp', label: '台灯', verbs: ['off', 'on', 'knock', 'flicker'], spot: 'side' },
    { id: 'window', label: '窗', verbs: ['open', 'close', 'look'], spot: 'window' },
    { id: 'bed', label: '床', verbs: ['sit', 'lie', 'hit'], spot: 'bed' },
    { id: 'phone', label: '手机', verbs: ['ring', 'silence', 'throw', 'check'], spot: 'middle' },
    { id: 'door', label: '门', verbs: ['slam', 'open', 'lock', 'knock'], spot: 'door' },
  ],
  kitchen: [
    { id: 'kettle', label: '水壶', verbs: ['boil', 'pour', 'knock'], spot: 'stove' },
    { id: 'tap', label: '水龙头', verbs: ['run', 'stop'], spot: 'stove' },
    { id: 'cup', label: '杯子', verbs: ['drop', 'fill', 'hold'], spot: 'table' },
    { id: 'fridge', label: '冰箱', verbs: ['open', 'close'], spot: 'near' },
    { id: 'door', label: '门', verbs: ['slam', 'open', 'knock'], spot: 'door' },
  ],
  corridor: [
    { id: 'light', label: '走廊灯', verbs: ['flicker', 'off', 'on'], spot: 'middle' },
    { id: 'elevator', label: '电梯', verbs: ['ding', 'open', 'close'], spot: 'far' },
    { id: 'door', label: '门', verbs: ['slam', 'open', 'lock', 'knock'], spot: 'door' },
    { id: 'stairs', label: '楼梯', verbs: ['step', 'sit'], spot: 'near' },
  ],
  office: [
    { id: 'printer', label: '打印机', verbs: ['jam', 'print', 'kick'], spot: 'away' },
    { id: 'computer', label: '电脑', verbs: ['type', 'off', 'look'], spot: 'desk' },
    { id: 'chair', label: '椅子', verbs: ['sit', 'kick', 'push'], spot: 'desk' },
    { id: 'window', label: '窗', verbs: ['look', 'open'], spot: 'far' },
    { id: 'door', label: '门', verbs: ['slam', 'open', 'knock'], spot: 'door' },
  ],
  street: [
    { id: 'car', label: '车', verbs: ['horn', 'start', 'pass'], spot: 'far' },
    { id: 'rain', label: '雨', verbs: ['start', 'stop'], spot: 'middle' },
    { id: 'streetlight', label: '路灯', verbs: ['flicker', 'off', 'on'], spot: 'corner' },
    { id: 'bench', label: '长椅', verbs: ['sit', 'kick'], spot: 'near' },
  ],
  bar: [
    { id: 'glass', label: '酒杯', verbs: ['drop', 'refill', 'hold', 'slide'], spot: 'bar' },
    { id: 'music', label: '音乐', verbs: ['loud', 'stop', 'change'], spot: 'corner' },
    { id: 'lights', label: '灯', verbs: ['dim', 'on', 'flicker'], spot: 'middle' },
    { id: 'door', label: '门', verbs: ['slam', 'open'], spot: 'door' },
  ],
};

export function objectsOf(roomId) {
  return ROOM_OBJECTS[roomId] || ROOM_OBJECTS.bedroom;
}

export function findObject(roomId, objectId) {
  return objectsOf(roomId).find((o) => o.id === objectId) || null;
}

/**
 * 每种身份能对环境做的动作。
 *
 * 这不是权限系统，是**性格**：受害者会坐下、会摔手机、会关灯；
 * 反派会摔门、踢椅子、按喇叭；路人只会开门、打字、按电梯这类不带情绪的事。
 * 模型给出的 use 动作不在名单里就丢弃，避免路人突然摔杯子抢戏。
 */
export const ROLE_AFFORDANCES = {
  protagonist: ['sit', 'lie', 'look', 'off', 'on', 'throw', 'open', 'close', 'check', 'hold', 'drop', 'silence', 'stop'],
  villain: ['slam', 'kick', 'knock', 'off', 'look', 'drop', 'horn', 'push', 'hit', 'lock', 'loud', 'pour', 'refill'],
  rival: ['sit', 'look', 'refill', 'type', 'open', 'hold', 'check', 'fill', 'change', 'slide'],
  witness: ['look', 'type', 'open', 'sit', 'step', 'check'],
  extra: ['ding', 'run', 'horn', 'type', 'print', 'pass', 'open', 'close', 'step'],
};

/**
 * 娃娃的暗手。它不是人，不"用"东西，而是让东西自己出问题：
 * 灯闪、电话响、雨突然下起来、打印机卡纸。这是它施法的可见形态。
 */
export const DOLL_NUDGES = ['flicker', 'ring', 'start', 'stop', 'jam', 'dim', 'boil', 'ding', 'knock'];

/**
 * 校验一次 use：物件必须在这间房、动作必须是这个物件承受得起的、
 * 且这个身份被允许做这个动作。三条都过才算合法。
 */
export function canUse(roomId, castRole, objectId, verb) {
  const obj = findObject(roomId, objectId);
  if (!obj) return false;
  if (!obj.verbs.includes(verb)) return false;
  const allowed = castRole === 'doll' ? DOLL_NUDGES : ROLE_AFFORDANCES[castRole] || [];
  return allowed.includes(verb);
}

/**
 * 给模型看的房间清单：一行一个物件，列出它能承受的动作。
 * 单独抽出来是因为 ENV agent 与人物 agent 都要用同一份。
 */
export function describeRoomObjects(roomId) {
  return objectsOf(roomId)
    .map((o) => `${o.id}（${o.label}）：${o.verbs.join(' / ')}`)
    .join('\n');
}

/** 环境自身能变的状态；由 ENV 的 ambient 动作改，不由人物直接改。 */
export const AMBIENT_FIELDS = {
  weather: ['clear', 'rain', 'night', 'snow'],
  light: ['on', 'dim', 'off'],
};
