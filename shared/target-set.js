// 003 · 多目标集合契约（前后端共用）
//
// target set 是一次组合仪式的稳定标识。成员顺序不会影响 id：
// [B, A] 会生成 pair-a-b。成员只来自 relationship.js 注册的
// meaningful 长期角色槽位；可复用路人 Z 不进入持久目标集合。
// 关系节点与成员都复用 relationship.js 的白名单，避免两份契约分歧。

import {
  RELATION_ACTOR_IDS,
  RELATION_KINDS,
  isRelationActor,
  isRelationKind,
  isRelationVisibility,
} from './relationship.js';
import { isDangerous } from './script-contract.js';

export const TARGET_SET_VERSION = 1;
export const TARGET_SET_MIN_MEMBERS = 1;
export const TARGET_SET_MAX_MEMBERS = 4;

// 不在这里重新定义角色或关系种类；relationship.js 是唯一来源。
export const TARGET_SET_MEMBER_IDS = RELATION_ACTOR_IDS;
export const TARGET_SET_RELATION_NODES = RELATION_KINDS;
export const TARGET_SET_INTENSITIES = Object.freeze(['soft', 'steady', 'sharp']);
// 仅用于关系剧场的轻量、非伤害性后果；它们不会驱动物理或外部动作。
export const PERSONAL_CONSEQUENCE_EFFECTS = Object.freeze([
  'awkward_pause',
  'missed_message',
  'wrong_name',
  'cold_shoulder',
  'public_blush',
  'lost_thread',
]);

const PERSONAL_SOURCE_EVENT_MAX = 160;

const object = (value) => value && typeof value === 'object' && !Array.isArray(value);

export function isTargetSetMember(id) {
  return isRelationActor(id);
}

export function isTargetSetRelationNode(node) {
  return isRelationKind(node);
}

export function isTargetSetIntensity(intensity) {
  return typeof intensity === 'string' && TARGET_SET_INTENSITIES.includes(intensity);
}

// 返回稳定排序后的成员。非法、重复或数量越界的列表返回 null。
export function canonicalTargetMembers(members) {
  if (!Array.isArray(members)
    || members.length < TARGET_SET_MIN_MEMBERS
    || members.length > TARGET_SET_MAX_MEMBERS
    || members.some((member) => !isTargetSetMember(member))
    || new Set(members).size !== members.length) {
    return null;
  }

  return [...members].sort((left, right) => TARGET_SET_MEMBER_IDS.indexOf(left) - TARGET_SET_MEMBER_IDS.indexOf(right));
}

// 由合法成员唯一推导仪式 id。
export function targetSetIdForMembers(members) {
  const canonicalMembers = canonicalTargetMembers(members);
  if (!canonicalMembers) return null;

  const prefix = canonicalMembers.length === 1
    ? 'solo'
    : canonicalMembers.length === 2
      ? 'pair'
      : 'set';
  return prefix + '-' + canonicalMembers.map((member) => member.toLowerCase()).join('-');
}

export const createTargetSetId = targetSetIdForMembers;

// 验证一个 target set；未传 id 的草稿可由 normalizeTargetSet 生成 id。
export function validateTargetSet(raw, { requireId = false } = {}) {
  const errors = [];
  if (!object(raw)) return { valid: false, errors: ['invalid-target-set'] };

  if (!Array.isArray(raw.members) || !raw.members.length) {
    errors.push('members-required');
  } else {
    if (raw.members.length > TARGET_SET_MAX_MEMBERS) errors.push('too-many-members');
    if (raw.members.some((member) => !isTargetSetMember(member))) errors.push('unknown-member');
    if (new Set(raw.members).size !== raw.members.length) errors.push('duplicate-member');
  }

  if (!Array.isArray(raw.relationNodes) || !raw.relationNodes.length) {
    errors.push('relation-nodes-required');
  } else {
    if (raw.relationNodes.some((node) => !isTargetSetRelationNode(node))) errors.push('unknown-relation-node');
    if (new Set(raw.relationNodes).size !== raw.relationNodes.length) errors.push('duplicate-relation-node');
  }

  if (!isTargetSetIntensity(raw.intensity)) errors.push('unknown-intensity');

  const expectedId = targetSetIdForMembers(raw.members);
  if (requireId && raw.id === undefined) errors.push('target-set-id-required');
  if (raw.id !== undefined && (typeof raw.id !== 'string' || raw.id !== expectedId)) {
    errors.push('target-set-id-mismatch');
  }

  return { valid: errors.length === 0, errors };
}

// 输出可持久化的 canonical target set。伪造 id 会令整个集合无效。
export function normalizeTargetSet(raw) {
  const validation = validateTargetSet(raw);
  if (!validation.valid) return null;

  const members = canonicalTargetMembers(raw.members);
  return {
    version: TARGET_SET_VERSION,
    id: targetSetIdForMembers(members),
    members,
    relationNodes: [...raw.relationNodes].sort((left, right) => TARGET_SET_RELATION_NODES.indexOf(left) - TARGET_SET_RELATION_NODES.indexOf(right)),
    intensity: raw.intensity,
  };
}

export const createTargetSet = normalizeTargetSet;

export function isPersonalConsequenceEffect(effect) {
  return typeof effect === 'string' && PERSONAL_CONSEQUENCE_EFFECTS.includes(effect);
}

function validSourceEvent(sourceEvent) {
  return typeof sourceEvent === 'string'
    && sourceEvent.trim().length > 0
    && sourceEvent.trim().length <= PERSONAL_SOURCE_EVENT_MAX
    && !isDangerous(sourceEvent);
}

function membersForConsequence(options) {
  if (!object(options) || !Array.isArray(options.members)) return null;
  return canonicalTargetMembers(options.members);
}

/**
 * 校验目标集合中的个人后果。sourceEvent 只从服务端 options 注入，
 * 不采纳 raw.sourceEvent，避免模型或浏览器伪造审计来源。
 */
export function validatePersonalConsequence(raw, options = {}) {
  const errors = [];
  if (!object(raw)) return { valid: false, errors: ['invalid-personal-consequence'] };

  const members = membersForConsequence(options);
  if (!members) errors.push('members-required');

  if (typeof raw.target !== 'string' || !raw.target) errors.push('target-required');
  else if (!members || !members.includes(raw.target)) errors.push('target-not-in-set');

  if (!isPersonalConsequenceEffect(raw.effect)) errors.push('unknown-effect');

  if (!Number.isSafeInteger(raw.intensity)) errors.push('intensity-must-be-integer');
  else if (raw.intensity < 0 || raw.intensity > 100) errors.push('intensity-out-of-range');

  const visibility = raw.visibility === undefined ? 'public' : raw.visibility;
  if (!isRelationVisibility(visibility)) errors.push('unknown-visibility');

  if (raw.visibleTo !== undefined) {
    if (!Array.isArray(raw.visibleTo) || raw.visibleTo.some((id) => !members || !members.includes(id))) {
      errors.push('invalid-visibility-recipients');
    }
  } else if (visibility === 'private') {
    errors.push('private-visibility-recipients-required');
  }

  if (!validSourceEvent(options.sourceEvent)) errors.push('invalid-source-event');

  return { valid: errors.length === 0, errors };
}

/** 规范化个人后果；服务端 sourceEvent 作为唯一来源写入结果。 */
export function normalizePersonalConsequence(raw, options = {}) {
  const validation = validatePersonalConsequence(raw, options);
  if (!validation.valid) return null;

  const visibility = raw.visibility === undefined ? 'public' : raw.visibility;
  const result = {
    target: raw.target,
    effect: raw.effect,
    intensity: raw.intensity,
    visibility,
    sourceEvent: options.sourceEvent.trim(),
  };
  if (Array.isArray(raw.visibleTo) && raw.visibleTo.length) {
    result.visibleTo = [...new Set(raw.visibleTo)].sort();
  }
  return result;
}

export const createPersonalConsequence = normalizePersonalConsequence;

export function isTargetSetId(value) {
  if (typeof value !== 'string') return false;
  const parts = value.split('-');
  const prefix = parts.shift();
  const members = parts.map((member) => member.toUpperCase());
  const expectedPrefix = members.length === 1 ? 'solo' : members.length === 2 ? 'pair' : 'set';
  return prefix === expectedPrefix && targetSetIdForMembers(members) === value;
}
