import test from 'node:test';
import assert from 'node:assert/strict';
import {
  RELATION_KINDS,
  applyRelationChange,
  canSeeRelation,
  createRelationEvent,
  normalizeRelationEdge,
  relationKey,
  validateRelationChange,
  validateRelationEdge,
} from '../shared/relationship.js';

const edge = (overrides = {}) => ({
  from: 'A',
  to: 'B',
  kind: 'tension',
  value: 42,
  sourceEvent: 'night-3-pair-a-b',
  visibility: 'public',
  targetSetId: 'pair-a-b',
  ...overrides,
});

test('关系边只接纳注册角色、三种关系类型、范围内数值和来源事件', () => {
  assert.deepEqual(RELATION_KINDS, ['trust', 'tension', 'secret']);
  assert.deepEqual(validateRelationEdge(edge()), { valid: true, errors: [] });
  assert.equal(normalizeRelationEdge(edge()).value, 42);

  const invalid = validateRelationEdge(edge({ from: 'YOU', to: 'A', kind: 'romance', value: 101 }));
  assert.equal(invalid.valid, false);
  assert.ok(invalid.errors.includes('unknown-from'));
  assert.ok(invalid.errors.includes('unknown-kind'));
  assert.ok(invalid.errors.includes('value-out-of-range'));
  assert.ok(validateRelationEdge(edge({ from: 'A', to: 'A' })).errors.includes('self-relation'));
  assert.ok(validateRelationEdge(edge({ sourceEvent: '<script>bad</script>' })).errors.includes('invalid-source-event'));
});

test('私密关系显式列出可见者，公开和成员关系按可见性读取', () => {
  const privateEdge = normalizeRelationEdge(edge({
    kind: 'secret',
    visibility: 'private',
    visibleTo: ['B', 'A', 'A'],
  }));
  assert.deepEqual(privateEdge.visibleTo, ['A', 'B']);
  assert.equal(canSeeRelation(privateEdge, 'A'), true);
  assert.equal(canSeeRelation(privateEdge, 'C'), false);
  assert.equal(canSeeRelation(normalizeRelationEdge(edge({ visibility: 'members' })), 'A'), true);
  assert.equal(canSeeRelation(normalizeRelationEdge(edge({ visibility: 'members' })), 'C'), false);
  assert.equal(canSeeRelation(normalizeRelationEdge(edge()), 'C'), true);
  assert.ok(validateRelationEdge(edge({ visibility: 'private' })).errors.includes('private-visibility-recipients-required'));
});

test('关系变更生成新边，数值夹紧，当前边和定向键不被篡改', () => {
  const current = normalizeRelationEdge(edge({ value: 95 }));
  const change = {
    operation: 'delta',
    from: 'A',
    to: 'B',
    kind: 'tension',
    delta: 20,
    sourceEvent: 'night-4-pair-a-b',
  };
  assert.deepEqual(validateRelationChange(change), { valid: true, errors: [] });
  const next = applyRelationChange(current, change);
  assert.equal(next.value, 100);
  assert.equal(next.sourceEvent, 'night-4-pair-a-b');
  assert.equal(current.value, 95);
  assert.equal(relationKey(current), 'A:B:tension');
  assert.equal(relationKey(edge({ from: 'B', to: 'A' })), 'B:A:tension');
  assert.equal(applyRelationChange(current, { ...change, to: 'C' }), null);
});

test('撤回和纠正是可追溯事件；撤回不携带新值且不就地修改历史', () => {
  const current = normalizeRelationEdge(edge());
  const retract = {
    operation: 'retract',
    from: 'A',
    to: 'B',
    kind: 'tension',
    sourceEvent: 'night-3-pair-a-b',
    reason: '玩家撤回这项关系后果',
  };
  assert.deepEqual(validateRelationChange(retract), { valid: true, errors: [] });
  assert.equal(applyRelationChange(current, retract), null);
  assert.equal(current.value, 42);
  assert.deepEqual(createRelationEvent(retract), {
    version: 1,
    operation: 'retract',
    from: 'A',
    to: 'B',
    kind: 'tension',
    sourceEvent: 'night-3-pair-a-b',
    reason: '玩家撤回这项关系后果',
  });
  assert.ok(validateRelationChange({ ...retract, value: 0 }).errors.includes('retract-cannot-have-value'));
  assert.equal(applyRelationChange(current, {
    operation: 'correct', from: 'A', to: 'B', kind: 'tension', value: 14, sourceEvent: 'night-5-correction',
  }).value, 14);
});
