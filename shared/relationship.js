// 003 · 关系边契约（前后端共用）
//
// 关系状态是已确认世界的一部分。模型和浏览器只能提交经过这个模块
// 校验的边/变化；历史事件由服务端追加，不能通过修改当前值来抹掉。

import { CAST, REGISTERED_MEANINGFUL_ROLE_IDS } from './cast.js';
import { isDangerous } from './script-contract.js';

export const RELATIONSHIP_VERSION = 1;
export const RELATION_KINDS = Object.freeze(['trust', 'tension', 'secret']);
export const RELATION_VISIBILITIES = Object.freeze(['public', 'members', 'private']);
export const RELATION_OPERATIONS = Object.freeze(['set', 'delta', 'retract', 'correct']);
export const RELATION_VALUE_MIN = 0;
export const RELATION_VALUE_MAX = 100;
// Stable relationships belong to meaningful A-Y character slots. Z is a
// reusable extra and can appear in a scene, but never owns a lasting edge.
export const RELATION_ACTOR_IDS = Object.freeze(
  REGISTERED_MEANINGFUL_ROLE_IDS.filter((id) => CAST[id]?.kind === 'named'),
);

const MAX_SOURCE_EVENT = 160;
const MAX_TARGET_SET = 100;
const MAX_REASON = 240;

const object = (value) => value && typeof value === 'object' && !Array.isArray(value);
const integer = (value) => Number.isSafeInteger(value);

export function isRelationActor(id) {
  return typeof id === 'string' && RELATION_ACTOR_IDS.includes(id);
}

export function isRelationKind(kind) {
  return typeof kind === 'string' && RELATION_KINDS.includes(kind);
}

export function isRelationVisibility(visibility) {
  return typeof visibility === 'string' && RELATION_VISIBILITIES.includes(visibility);
}

export function clampRelationValue(value) {
  return Math.max(RELATION_VALUE_MIN, Math.min(RELATION_VALUE_MAX, Math.trunc(value)));
}

function safeText(value, max, label) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max || isDangerous(value)) {
    return `${label}-invalid`;
  }
  return null;
}

function relationErrors(raw, { allowDelta = false, allowOperation = false } = {}) {
  const errors = [];
  if (!object(raw)) return ['invalid-relation'];
  if (!isRelationActor(raw.from)) errors.push('unknown-from');
  if (!isRelationActor(raw.to)) errors.push('unknown-to');
  if (raw.from === raw.to && raw.from !== undefined) errors.push('self-relation');
  if (!isRelationKind(raw.kind)) errors.push('unknown-kind');
  if (raw.value !== undefined && (!integer(raw.value) || raw.value < RELATION_VALUE_MIN || raw.value > RELATION_VALUE_MAX)) {
    errors.push('value-out-of-range');
  }
  if (allowDelta && raw.delta !== undefined && (!integer(raw.delta) || raw.delta < -RELATION_VALUE_MAX || raw.delta > RELATION_VALUE_MAX)) {
    errors.push('delta-out-of-range');
  }
  const operation = allowOperation ? raw.operation : undefined;
  // 撤回只需要指出原始来源；它不重新写一个当前关系值。
  if (operation !== 'retract' && raw.value === undefined && (!allowDelta || raw.delta === undefined)) {
    errors.push('missing-value');
  }
  if (safeText(raw.sourceEvent, MAX_SOURCE_EVENT, 'source-event')) errors.push('invalid-source-event');
  if (raw.visibility !== undefined && !isRelationVisibility(raw.visibility)) errors.push('unknown-visibility');
  const visibility = raw.visibility || 'public';
  if (visibility === 'private') {
    if (!Array.isArray(raw.visibleTo) || !raw.visibleTo.length || raw.visibleTo.some((id) => !isRelationActor(id))) {
      errors.push('private-visibility-recipients-required');
    }
  } else if (raw.visibleTo !== undefined && (!Array.isArray(raw.visibleTo) || raw.visibleTo.some((id) => !isRelationActor(id)))) {
    errors.push('invalid-visibility-recipients');
  }
  if (raw.targetSetId !== undefined && safeText(raw.targetSetId, MAX_TARGET_SET, 'target-set')) errors.push('invalid-target-set');
  if (raw.reason !== undefined && safeText(raw.reason, MAX_REASON, 'reason')) errors.push('invalid-reason');
  if (allowOperation && raw.operation !== undefined && !RELATION_OPERATIONS.includes(raw.operation)) errors.push('unknown-operation');
  return errors;
}

/** 返回结构化错误，不改变输入，供 API/模型输出校验使用。 */
export function validateRelationEdge(raw) {
  const errors = relationErrors(raw);
  return { valid: errors.length === 0, errors };
}

export const validateRelationship = validateRelationEdge;

/** 规范化一条当前关系边；非法数据返回 null。 */
export function normalizeRelationEdge(raw) {
  const result = validateRelationEdge(raw);
  if (!result.valid) return null;
  const edge = {
    from: raw.from,
    to: raw.to,
    kind: raw.kind,
    value: raw.value,
    sourceEvent: raw.sourceEvent.trim(),
    visibility: raw.visibility || 'public',
  };
  if (edge.visibility === 'private') edge.visibleTo = [...new Set(raw.visibleTo)].sort();
  else if (Array.isArray(raw.visibleTo) && raw.visibleTo.length) edge.visibleTo = [...new Set(raw.visibleTo)].sort();
  if (raw.targetSetId !== undefined) edge.targetSetId = raw.targetSetId.trim();
  return edge;
}

export const createRelationEdge = normalizeRelationEdge;

/** 用于存储键和幂等比较；方向有意义，A→B 与 B→A 是两条边。 */
export function relationKey(edgeOrParts, to, kind) {
  const from = typeof edgeOrParts === 'object' ? edgeOrParts?.from : edgeOrParts;
  const nextTo = typeof edgeOrParts === 'object' ? edgeOrParts?.to : to;
  const nextKind = typeof edgeOrParts === 'object' ? edgeOrParts?.kind : kind;
  if (!isRelationActor(from) || !isRelationActor(nextTo) || !isRelationKind(nextKind) || from === nextTo) return null;
  return `${from}:${nextTo}:${nextKind}`;
}

export function canSeeRelation(edge, viewerId) {
  if (!edge || !isRelationActor(viewerId)) return false;
  if (edge.visibility === 'public' || edge.visibility === 'members') return edge.visibility === 'public' || viewerId === edge.from || viewerId === edge.to;
  return Array.isArray(edge.visibleTo) && edge.visibleTo.includes(viewerId);
}

/**
 * 校验一条关系变化。delta 不直接落盘，服务端在事务内将它应用到当前边，
 * 同时追加不可变事件；retract/correct 仍要求 sourceEvent，因此可追溯。
 */
export function validateRelationChange(raw) {
  const errors = relationErrors(raw, { allowDelta: true, allowOperation: true });
  if (raw?.operation === 'retract' && (raw?.delta !== undefined || raw?.value !== undefined)) errors.push('retract-cannot-have-value');
  if (raw?.operation === 'set' && raw?.value === undefined) errors.push('set-requires-value');
  if (raw?.operation === 'delta' && raw?.delta === undefined) errors.push('delta-requires-delta');
  if (raw?.operation === 'correct' && raw?.value === undefined && raw?.delta === undefined) errors.push('correct-requires-value-or-delta');
  return { valid: errors.length === 0, errors };
}

/** 将变化应用于一条边；不会修改原对象。撤回返回 null，由存储层保留历史事件。 */
export function applyRelationChange(edge, change) {
  const validation = validateRelationChange(change);
  if (!validation.valid || !edge) return null;
  const current = normalizeRelationEdge(edge);
  if (!current || relationKey(current) !== relationKey(change)) return null;
  if (change.operation === 'retract') return null;
  const value = change.value !== undefined
    ? change.value
    : clampRelationValue(current.value + (change.delta || 0));
  return normalizeRelationEdge({
    ...current,
    value,
    sourceEvent: change.sourceEvent,
    visibility: change.visibility ?? current.visibility,
    visibleTo: change.visibleTo ?? current.visibleTo,
    targetSetId: change.targetSetId ?? current.targetSetId,
  });
}

export function relationEvent(raw) {
  const validation = validateRelationChange(raw);
  if (!validation.valid) return null;
  return {
    version: RELATIONSHIP_VERSION,
    operation: raw.operation || (raw.delta === undefined ? 'set' : 'delta'),
    from: raw.from,
    to: raw.to,
    kind: raw.kind,
    ...(raw.value === undefined ? {} : { value: raw.value }),
    ...(raw.delta === undefined ? {} : { delta: raw.delta }),
    sourceEvent: raw.sourceEvent.trim(),
    ...(raw.visibility ? { visibility: raw.visibility } : {}),
    ...(Array.isArray(raw.visibleTo) ? { visibleTo: [...new Set(raw.visibleTo)].sort() } : {}),
    ...(raw.targetSetId ? { targetSetId: raw.targetSetId.trim() } : {}),
    ...(raw.reason ? { reason: raw.reason.trim() } : {}),
  };
}

export const createRelationEvent = relationEvent;
