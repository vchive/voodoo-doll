// 003 · 开放关系世界注册表（前后端共用）
//
// 这个模块只描述「世界里允许出现什么」。它不保存某个会话的当前状态，
// 也不让模型直接改变世界。房间、站位和物件沿用 002 的共享表；这里补充
// 房间连接、统一的引用校验，以及供服务端/离线站使用的注册表视图。

import {
  CAST,
  LIGHTS,
  ROOM_IDS,
  ROOM_SPOT_KEYS,
  ROOMS,
  SPEAKER_IDS,
  STAGE_IDS,
  WEATHERS,
} from './cast.js';
import {
  AMBIENT_FIELDS,
  DOLL_NUDGES,
  ROLE_AFFORDANCES as ENV_ROLE_AFFORDANCES,
  ROOM_OBJECTS,
  findObject,
  objectsOf,
} from './environment.js';

export const WORLD_REGISTRY_VERSION = 1;

/**
 * 可通行的房间边。边是无向的；运行时只能在这张表里切换房间。
 * `via` 是给剧本和界面看的入口提示，不是新的物件注册表。
 */
export const ROOM_CONNECTIONS = Object.freeze([
  Object.freeze({ id: 'bedroom-corridor', from: 'bedroom', to: 'corridor', via: 'door' }),
  Object.freeze({ id: 'corridor-kitchen', from: 'corridor', to: 'kitchen', via: 'door' }),
  Object.freeze({ id: 'corridor-office', from: 'corridor', to: 'office', via: 'door' }),
  Object.freeze({ id: 'corridor-street', from: 'corridor', to: 'street', via: 'door' }),
  Object.freeze({ id: 'street-bar', from: 'street', to: 'bar', via: 'door' }),
]);

// 这些别名让调用方可以使用「edge」或「connection」的术语，而不复制一份数组。
export const WORLD_EDGES = ROOM_CONNECTIONS;
export const ROOM_EDGES = ROOM_CONNECTIONS;

/**
 * 动作层级的 affordance。具体物件 verb 仍以 environment.js 为准；这里仅
 * 声明哪些契约动作可以在世界注册表中出现，以及它们能由谁发起。
 */
export const ACTION_AFFORDANCES = Object.freeze({
  move: Object.freeze({ actors: STAGE_IDS, scope: 'room', requires: ['spot'] }),
  speak: Object.freeze({ actors: SPEAKER_IDS, scope: 'stage', requires: ['text'] }),
  use: Object.freeze({ actors: [...STAGE_IDS, 'doll'], scope: 'object', requires: ['objectId', 'verb'] }),
  ambient: Object.freeze({ actors: ['ENV'], scope: 'environment', requires: ['field', 'value'] }),
  burst: Object.freeze({ actors: [...SPEAKER_IDS].filter((id) => id !== 'ENV'), scope: 'stage' }),
  shake: Object.freeze({ actors: [...SPEAKER_IDS].filter((id) => id !== 'ENV'), scope: 'stage' }),
  focus: Object.freeze({ actors: STAGE_IDS, scope: 'stage' }),
});

export const ACTION_AFFORDANCE_IDS = Object.freeze(Object.keys(ACTION_AFFORDANCES));

/**
 * Canonical registry view. `rooms`/`objects` point at the 002 tables on purpose:
 * adding a room or prop remains a data change in its owning module, not a second
 * list that can silently drift.
 */
export const WORLD_REGISTRY = Object.freeze({
  version: WORLD_REGISTRY_VERSION,
  rooms: ROOMS,
  roomIds: ROOM_IDS,
  roomSpots: ROOM_SPOT_KEYS,
  connections: ROOM_CONNECTIONS,
  objects: ROOM_OBJECTS,
  actionAffordances: ACTION_AFFORDANCES,
  roleAffordances: ENV_ROLE_AFFORDANCES,
  dollNudges: DOLL_NUDGES,
  weather: WEATHERS,
  light: LIGHTS,
});

// `WORLD` is a concise compatibility alias used by local stations.
export const WORLD = WORLD_REGISTRY;

export function isRoomId(roomId) {
  return typeof roomId === 'string' && ROOM_IDS.includes(roomId);
}

export const isValidRoomId = isRoomId;

export function isConnectionId(connectionId) {
  return typeof connectionId === 'string' && ROOM_CONNECTIONS.some((edge) => edge.id === connectionId);
}

export function getConnection(connectionId) {
  return ROOM_CONNECTIONS.find((edge) => edge.id === connectionId) || null;
}

/** 无向图查询：from/to 任一方向都能通过。 */
export function areRoomsConnected(fromRoomId, toRoomId) {
  if (!isRoomId(fromRoomId) || !isRoomId(toRoomId) || fromRoomId === toRoomId) return false;
  return ROOM_CONNECTIONS.some(
    (edge) =>
      (edge.from === fromRoomId && edge.to === toRoomId) ||
      (edge.from === toRoomId && edge.to === fromRoomId),
  );
}

export const isConnected = areRoomsConnected;

export function connectedRooms(roomId) {
  if (!isRoomId(roomId)) return [];
  return ROOM_CONNECTIONS.reduce((result, edge) => {
    if (edge.from === roomId) result.push(edge.to);
    if (edge.to === roomId) result.push(edge.from);
    return result;
  }, []);
}

export const getConnectedRooms = connectedRooms;

export function spotsOf(roomId) {
  return isRoomId(roomId) ? [...ROOM_SPOT_KEYS[roomId]] : [];
}

export function isSpot(roomId, spot) {
  return isRoomId(roomId) && typeof spot === 'string' && ROOM_SPOT_KEYS[roomId].includes(spot);
}

export const isValidSpot = isSpot;

export function isObjectId(roomId, objectId) {
  return isRoomId(roomId) && typeof objectId === 'string' && Boolean(findObject(roomId, objectId));
}

export const isValidObjectId = isObjectId;

export function objectOf(roomId, objectId) {
  return isObjectId(roomId, objectId) ? findObject(roomId, objectId) : null;
}

export function objectsIn(roomId) {
  return isRoomId(roomId) ? [...objectsOf(roomId)] : [];
}

/** 检查房间内的物件和站位是否仍与各自的 canonical 表一致。 */
export function isObjectSpotValid(roomId, objectId) {
  const object = objectOf(roomId, objectId);
  return Boolean(object && isSpot(roomId, object.spot));
}

/**
 * `actor` 可以是 CAST id（A/B/C/YOU/Z），也可以是角色类型
 * （villain/protagonist/...）。这样编排器和已有 canUse() 都能复用。
 */
function roleAffordancesFor(actor) {
  if (actor === 'doll') return DOLL_NUDGES;
  if (typeof actor !== 'string') return [];
  const role = CAST[actor]?.role || actor;
  return ENV_ROLE_AFFORDANCES[role] || [];
}

export function isAffordance(actor, verb) {
  return typeof verb === 'string' && roleAffordancesFor(actor).includes(verb);
}

export const isValidAffordance = isAffordance;

export function canUseWorldObject(roomId, actor, objectId, verb) {
  const object = objectOf(roomId, objectId);
  return Boolean(object && isAffordance(actor, verb) && object.verbs.includes(verb));
}

export function isActionAffordance(action, actor) {
  const affordance = ACTION_AFFORDANCES[action];
  return Boolean(affordance && typeof actor === 'string' && affordance.actors.includes(actor));
}

export function isAmbientField(field, value) {
  return (
    (field === 'weather' && WEATHERS.includes(value) && AMBIENT_FIELDS.weather.includes(value)) ||
    (field === 'light' && LIGHTS.includes(value) && AMBIENT_FIELDS.light.includes(value))
  );
}

/**
 * 校验一个跨模块的世界引用。返回结构化结果，便于服务端记录 reasonCode；
 * 只要有一项未知就整体拒绝，不返回部分可信的引用。
 */
export function validateWorldReference(raw) {
  const errors = [];
  const value = raw && typeof raw === 'object' ? raw : {};

  if (!isRoomId(value.roomId)) errors.push('unknown-room');

  if (value.toRoomId !== undefined) {
    if (!isRoomId(value.toRoomId)) errors.push('unknown-destination-room');
    else if (!areRoomsConnected(value.roomId, value.toRoomId)) errors.push('rooms-not-connected');
  }

  if (value.objectId !== undefined && !isObjectId(value.roomId, value.objectId)) {
    errors.push('unknown-object');
  }
  if (value.spot !== undefined && !isSpot(value.roomId, value.spot)) errors.push('unknown-spot');
  if (value.action !== undefined && !ACTION_AFFORDANCE_IDS.includes(value.action)) {
    errors.push('unknown-action');
  }
  if (value.action !== undefined && value.actor !== undefined && !isActionAffordance(value.action, value.actor)) {
    errors.push('actor-cannot-perform-action');
  }
  if (value.verb !== undefined && !canUseWorldObject(value.roomId, value.actor, value.objectId, value.verb)) {
    errors.push('invalid-object-affordance');
  }
  if (value.field !== undefined && !isAmbientField(value.field, value.value)) {
    errors.push('invalid-ambient-field');
  }

  return { valid: errors.length === 0, errors };
}

export const validateWorldRef = validateWorldReference;

/**
 * 自检注册表的数据完整性。应用启动时可调用；测试和离线站不必依赖异常。
 */
export function validateWorldRegistry(registry = WORLD_REGISTRY) {
  const errors = [];
  const rooms = registry && registry.rooms && typeof registry.rooms === 'object' ? registry.rooms : {};
  const roomIds = Array.isArray(registry?.roomIds) ? registry.roomIds : [];

  if (registry?.version !== WORLD_REGISTRY_VERSION) errors.push('unsupported-version');
  if (roomIds.length < 6) errors.push('too-few-rooms');
  for (const roomId of roomIds) {
    if (!rooms[roomId]) errors.push(`missing-room:${roomId}`);
    if (!Array.isArray(registry?.roomSpots?.[roomId]) || !registry.roomSpots[roomId].length) {
      errors.push(`missing-spots:${roomId}`);
    }
    if (!Array.isArray(registry?.objects?.[roomId])) errors.push(`missing-objects:${roomId}`);
    for (const object of registry?.objects?.[roomId] || []) {
      if (!object || typeof object.id !== 'string') errors.push(`invalid-object:${roomId}`);
      else if (!registry.roomSpots[roomId].includes(object.spot)) errors.push(`invalid-object-spot:${roomId}:${object.id}`);
      if (!Array.isArray(object?.verbs) || object.verbs.length === 0) errors.push(`missing-object-verbs:${roomId}`);
    }
  }

  for (const edge of registry?.connections || []) {
    if (!isRoomId(edge.from) || !isRoomId(edge.to) || edge.from === edge.to) {
      errors.push(`invalid-connection:${edge.id || 'unknown'}`);
    }
  }

  return { valid: errors.length === 0, errors };
}

export function isWorldRegistryValid(registry = WORLD_REGISTRY) {
  return validateWorldRegistry(registry).valid;
}

// Fail fast during development if a canonical 002 table drifts out of sync.
const registryCheck = validateWorldRegistry();
if (!registryCheck.valid) {
  throw new Error(`Invalid world registry: ${registryCheck.errors.join(', ')}`);
}
