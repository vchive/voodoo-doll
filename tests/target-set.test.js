import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TARGET_SET_INTENSITIES,
  TARGET_SET_MEMBER_IDS,
  TARGET_SET_RELATION_NODES,
  PERSONAL_CONSEQUENCE_EFFECTS,
  canonicalTargetMembers,
  normalizePersonalConsequence,
  validatePersonalConsequence,
  createTargetSet,
  isTargetSetId,
  targetSetIdForMembers,
  validateTargetSet,
} from '../shared/target-set.js';
import { RELATION_ACTOR_IDS, RELATION_KINDS } from '../shared/relationship.js';

const targetSet = (overrides = {}) => ({
  id: 'pair-a-b',
  members: ['A', 'B'],
  relationNodes: ['tension', 'secret'],
  intensity: 'sharp',
  ...overrides,
});

test('目标集合复用关系契约的角色和关系节点，并限制 1 到 4 个成员', () => {
  assert.equal(TARGET_SET_MEMBER_IDS, RELATION_ACTOR_IDS);
  assert.equal(TARGET_SET_RELATION_NODES, RELATION_KINDS);
  assert.deepEqual(TARGET_SET_INTENSITIES, ['soft', 'steady', 'sharp']);
  assert.deepEqual(validateTargetSet(targetSet()), { valid: true, errors: [] });

  assert.ok(validateTargetSet(targetSet({ members: [] })).errors.includes('members-required'));
  assert.ok(validateTargetSet(targetSet({ members: ['A', 'B', 'C', 'Z', 'YOU'] })).errors.includes('too-many-members'));
  assert.ok(validateTargetSet(targetSet({ members: ['A', 'YOU'] })).errors.includes('unknown-member'));
  assert.ok(validateTargetSet(targetSet({ members: ['A', 'A'] })).errors.includes('duplicate-member'));
});

test('关系节点与表现强度必须来自受控枚举', () => {
  assert.ok(validateTargetSet(targetSet({ relationNodes: [] })).errors.includes('relation-nodes-required'));
  assert.ok(validateTargetSet(targetSet({ relationNodes: ['tension', 'romance'] })).errors.includes('unknown-relation-node'));
  assert.ok(validateTargetSet(targetSet({ relationNodes: ['secret', 'secret'] })).errors.includes('duplicate-relation-node'));
  assert.ok(validateTargetSet(targetSet({ intensity: 'extreme' })).errors.includes('unknown-intensity'));
});

test('成员顺序无关，id 由当前 meaningful 角色的稳定顺序唯一推导', () => {
  assert.deepEqual(canonicalTargetMembers(['C', 'A', 'B']), ['A', 'B', 'C']);
  assert.equal(targetSetIdForMembers(['A']), 'solo-a');
  assert.equal(targetSetIdForMembers(['B', 'A']), 'pair-a-b');
  assert.equal(targetSetIdForMembers(['C', 'A', 'B']), 'set-a-b-c');
  assert.equal(targetSetIdForMembers(['A', 'C', 'B']), 'set-a-b-c');
  assert.equal(targetSetIdForMembers(['Z', 'A']), null);
  assert.equal(targetSetIdForMembers(['A', 'A']), null);
  assert.equal(isTargetSetId('pair-a-b'), true);
  assert.equal(isTargetSetId('pair-b-a'), false);
});

test('规范化总是输出 canonical 成员与节点顺序，并拒绝伪造的 id', () => {
  assert.deepEqual(createTargetSet(targetSet({
    id: 'pair-a-b',
    members: ['B', 'A'],
    relationNodes: ['secret', 'tension'],
  })), {
    version: 1,
    id: 'pair-a-b',
    members: ['A', 'B'],
    relationNodes: ['tension', 'secret'],
    intensity: 'sharp',
  });

  const mismatch = validateTargetSet(targetSet({ id: 'solo-a' }));
  assert.equal(mismatch.valid, false);
  assert.ok(mismatch.errors.includes('target-set-id-mismatch'));
  assert.equal(createTargetSet(targetSet({ id: 'pair-b-a' })), null);
  assert.ok(validateTargetSet({ ...targetSet(), id: undefined }, { requireId: true }).errors.includes('target-set-id-required'));
});

test('个人后果只能作用于 options 提供的目标集合成员，并使用服务端来源事件', () => {
  assert.ok(PERSONAL_CONSEQUENCE_EFFECTS.length >= 4);
  const raw = { target: 'B', effect: PERSONAL_CONSEQUENCE_EFFECTS[0], intensity: 72 };
  assert.deepEqual(normalizePersonalConsequence(raw, {
    members: ['B', 'A'],
    sourceEvent: 'night-4-pair-a-b',
  }), {
    target: 'B',
    effect: PERSONAL_CONSEQUENCE_EFFECTS[0],
    intensity: 72,
    visibility: 'public',
    sourceEvent: 'night-4-pair-a-b',
  });
  assert.equal(normalizePersonalConsequence({ ...raw, target: 'C' }, {
    members: ['A', 'B'],
    sourceEvent: 'night-4-pair-a-b',
  }), null);
  assert.equal(normalizePersonalConsequence({ ...raw, sourceEvent: 'client-forged' }, {
    members: ['A', 'B'],
    sourceEvent: 'server-event-1',
  }).sourceEvent, 'server-event-1');
});

test('个人后果强制非负整数强度、白名单效果、安全来源和关系可见性', () => {
  const base = { target: 'A', effect: PERSONAL_CONSEQUENCE_EFFECTS[1], intensity: 20 };
  const options = { members: ['A', 'B'], sourceEvent: 'night-5-pair-a-b' };
  assert.ok(validatePersonalConsequence({ ...base, intensity: 20.5 }, options).errors.includes('intensity-must-be-integer'));
  assert.ok(validatePersonalConsequence({ ...base, intensity: 101 }, options).errors.includes('intensity-out-of-range'));
  assert.ok(validatePersonalConsequence({ ...base, effect: 'injury' }, options).errors.includes('unknown-effect'));
  assert.ok(validatePersonalConsequence({ ...base, visibility: 'private' }, options).errors.includes('private-visibility-recipients-required'));
  assert.deepEqual(normalizePersonalConsequence({ ...base, visibility: 'private', visibleTo: ['B', 'A', 'A'] }, options).visibleTo, ['A', 'B']);
  assert.ok(validatePersonalConsequence(base, { ...options, sourceEvent: '<script>bad</script>' }).errors.includes('invalid-source-event'));
  assert.ok(validatePersonalConsequence(base, { members: ['A', 'B'] }).errors.includes('invalid-source-event'));
});
