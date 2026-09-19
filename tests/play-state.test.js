import test from 'node:test';
import assert from 'node:assert/strict';

import { hasCompletedLocalWorld, normalizeLocalState, parseLocalState, restorePendingStoryDraft } from '../hex/play-state.ts';

test('旧的单人记录缺少日志和快照字段时会补齐可玩的默认值', () => {
  const state = normalizeLocalState({ profile: { dollName: '小墨', story: '旧故事', names: { A: '林川' } }, snapshot: { roomId: 'office' } });
  assert.equal(state.profile.dollName, '小墨');
  assert.equal(state.snapshot.roomId, 'office');
  assert.equal(state.snapshot.worldVersion, 0);
  assert.deepEqual(state.snapshot.present, ['YOU']);
  assert.deepEqual(state.log, []);
});

test('旧的扁平资料仍可恢复，非法地点、日志和 pending 不会进入运行态', () => {
  const state = normalizeLocalState({
    dollName: '旧娃娃', story: '从旧版本留下的故事', names: { A: '阿川', invalid: 1 },
    snapshot: { roomId: '../bad', present: 'everyone', clock: { day: -2, minute: 9999 } },
    log: [null, { who: '你', text: '还在这里' }, { who: '坏记录' }],
    pending: { kind: 'intent', id: 42 },
  });
  assert.equal(state.profile.dollName, '旧娃娃');
  assert.deepEqual(state.profile.names, { A: '阿川' });
  assert.equal(state.snapshot.roomId, 'parlor');
  assert.deepEqual(state.snapshot.clock, { day: 1, minute: 1439 });
  assert.deepEqual(state.log, [{ who: '你', text: '还在这里' }]);
  assert.equal(state.pending, undefined);
});

test('完全损坏或非对象的本机记录会被忽略', () => {
  assert.equal(parseLocalState('{broken'), null);
  assert.equal(parseLocalState('[]'), null);
  assert.equal(parseLocalState(null), null);
});

test('损坏缓存中的空关系和角色项会被清除，正常关系会保留', () => {
  const state = normalizeLocalState({
    profile: { dollName: '小墨', names: {} },
    snapshot: {
      relationships: { 'A:YOU': null, 'B:YOU': { summary: '仍在观察' } },
      agents: { A: null, B: { id: 'B', roomId: 'home' } },
    },
  });
  assert.deepEqual(state.snapshot.relationships, { 'B:YOU': { summary: '仍在观察' } });
  assert.deepEqual(state.snapshot.agents, { B: { id: 'B', roomId: 'home' } });
});

test('已完成的本机世界可在服务端会话变化时被识别并保留', () => {
  const state = normalizeLocalState({
    profile: { dollName: '小墨', story: '办公室里的旧故事', names: { A: '林川' } },
    snapshot: { worldVersion: 9, roomId: 'office', present: ['YOU', 'A'] },
  });
  assert.equal(hasCompletedLocalWorld(state), true);
  assert.equal(state.snapshot.worldVersion, 9);
  assert.equal(state.snapshot.roomId, 'office');
  assert.equal(hasCompletedLocalWorld(normalizeLocalState({ profile: { dollName: '小墨', names: {} } })), false);
});

test('刷新后可以恢复尚未确认的故事预览及其原始版本', () => {
  const state = normalizeLocalState({
    profile: { dollName: '', names: {} },
    snapshot: { worldVersion: 3 },
    pending: {
      kind: 'story',
      id: 'story-draft-1',
      worldVersion: 2,
      preview: { dollName: '小墨', story: '从会客厅开始', names: { A: '林川' }, roomLabels: ['会客厅'] },
    },
  });
  assert.deepEqual(restorePendingStoryDraft(state), {
    draftId: 'story-draft-1',
    worldVersion: 2,
    preview: { dollName: '小墨', story: '从会客厅开始', names: { A: '林川' }, roomLabels: ['会客厅'] },
  });
});
