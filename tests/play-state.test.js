import test from 'node:test';
import assert from 'node:assert/strict';

import { appendLocalLogEntry, createLocalSaveEnvelope, createTutorialState, emptyLocalState, hasCompletedLocalWorld, nextTutorialStep, normalizeLocalState, parseLocalState, restorePendingStoryDraft, shouldKeepLocalBranch } from '../hex/play-state.ts';

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

test('行动记录保留未执行输入及巫柜提示，旧日志仍保持兼容', () => {
  const state = normalizeLocalState({
    log: [
      { who: '你', text: '巫柜', status: 'rejected' },
      { who: '巫柜', text: '这句话暂时无法执行。', status: 'notice' },
      { who: '环境', text: '门后传来雨声。' },
      { who: '系统', text: '坏状态', status: 'unknown' },
    ],
  });
  assert.deepEqual(state.log, [
    { who: '你', text: '巫柜', status: 'rejected' },
    { who: '巫柜', text: '这句话暂时无法执行。', status: 'notice' },
    { who: '环境', text: '门后传来雨声。' },
    { who: '系统', text: '坏状态' },
  ]);
});

test('行动记录会按事件 ID 去掉重试造成的重复回执', () => {
  const state = normalizeLocalState({
    log: [
      { eventId: 'turn:t-1', who: '你', text: '去办公室', status: 'accepted' },
      { eventId: 'event:e-1', who: '环境', text: '门开了。' },
      { eventId: 'event:e-1', who: '环境', text: '门开了。' },
      { who: '你', text: '同一句自由输入' },
      { who: '你', text: '同一句自由输入' },
    ],
  });
  assert.deepEqual(state.log, [
    { eventId: 'turn:t-1', who: '你', text: '去办公室', status: 'accepted' },
    { eventId: 'event:e-1', who: '环境', text: '门开了。' },
    { who: '你', text: '同一句自由输入' },
    { who: '你', text: '同一句自由输入' },
  ]);
});

test('新行动记录保留执行状态与发生时上下文，旧记录不被补造', () => {
  const state = normalizeLocalState({
    snapshot: { roomId: 'station', worldVersion: 7, clock: { day: 2, minute: 562 } },
    log: [
      { who: '环境', text: '旧版本反馈。' },
      { who: '你', text: '去办公室', status: 'accepted', kind: 'action', roomId: 'station', worldVersion: 7, clock: { day: 2, minute: 562 } },
      { who: '巫柜', text: '输入失败', status: 'notice', kind: 'error', roomId: 'not-a-room', worldVersion: -1, clock: { day: 0, minute: 5000 } },
    ],
  });
  assert.deepEqual(state.log, [
    { who: '环境', text: '旧版本反馈。' },
    { who: '你', text: '去办公室', status: 'accepted', kind: 'action', roomId: 'station', worldVersion: 7, clock: { day: 2, minute: 562 } },
    { who: '巫柜', text: '输入失败', status: 'notice', kind: 'error', worldVersion: 0, clock: { day: 1, minute: 1439 } },
  ]);
});

test('同一权威事件重复回放不会重复追加行动记录，无 id 的旧记录仍可并存', () => {
  const state = emptyLocalState();
  assert.equal(appendLocalLogEntry(state, { who: '你', text: '去办公室', eventId: 'turn-1', status: 'accepted' }), true);
  assert.equal(appendLocalLogEntry(state, { who: '你', text: '去办公室', eventId: 'turn-1', status: 'accepted' }), false);
  assert.equal(appendLocalLogEntry(state, { who: '环境', text: '门后传来雨声。' }), true);
  assert.deepEqual(state.log, [
    { who: '你', text: '去办公室', eventId: 'turn-1', status: 'accepted' },
    { who: '环境', text: '门后传来雨声。' },
  ]);
});

test('失败输入也经过统一记录上限，但相同失败可作为两次尝试保留', () => {
  const state = emptyLocalState();
  for (let index = 0; index < 51; index += 1) {
    appendLocalLogEntry(state, { who: '你', text: '巫柜', status: 'rejected', kind: 'error' });
    appendLocalLogEntry(state, { who: '巫柜', text: '这句话暂时无法执行。', status: 'notice', kind: 'error' });
  }
  assert.equal(state.log.length, 100);
  assert.equal(state.log.every((entry) => entry.status === 'rejected' || entry.status === 'notice'), true);
  assert.equal(state.log.filter((entry) => entry.status === 'rejected').length, 50);
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

test('损坏或空白的 pending 不会保留下来锁死输入与恢复入口', () => {
  for (const pending of [
    { kind: 'intent', id: 'turn-1' },
    { kind: 'intent', id: 'turn-1', text: '   ' },
    { kind: 'story', id: 'story-1' },
    { kind: 'story', id: 'story-1', preview: { dollName: '小墨' } },
    { kind: 'story', id: 'story-1', preview: { dollName: ' '.repeat(32) + '小墨', story: '故事' } },
    { kind: 'story', id: 'story-1', preview: { dollName: '小墨', story: 42 } },
  ]) assert.equal(normalizeLocalState({ pending }).pending, undefined);

  const valid = normalizeLocalState({ pending: { kind: 'intent', id: 'turn-1', text: ' 去地铁站 ' } });
  assert.equal(valid.pending.text, '去地铁站');
  assert.equal(valid.pending.id, 'turn-1');
  assert.equal(hasCompletedLocalWorld(normalizeLocalState({ profile: { dollName: '小墨', story: 42 } })), false);
});

test('重连保留已确认离线探索、离线新故事以及尚未确认的本机预览', () => {
  const state = emptyLocalState();
  state.profile = { dollName: '小墨', story: '离线新故事', names: {} };
  state.snapshot.roomId = 'station';
  state.snapshot.worldVersion = 9;
  state.log = [{ who: '你', text: '去地铁站', status: 'accepted', eventId: 'turn:local-1' }];
  assert.equal(shouldKeepLocalBranch(state), true);
  state.offline = false;
  assert.equal(shouldKeepLocalBranch(state), false);
  state.pending = { kind: 'intent', id: 'local-1', text: '去地铁站' };
  assert.equal(shouldKeepLocalBranch(state), true, '旧缓存中错误的 online 标记不能改变本机预览的归属');
  state.pending = { kind: 'story', id: 'local-story-1', preview: { dollName: '小墨', story: '从房间开始', names: {} } };
  assert.equal(shouldKeepLocalBranch(state), true);
  state.pending = { kind: 'intent', id: 'server-1', text: '观察周围' };
  assert.equal(shouldKeepLocalBranch(state), false);
  assert.equal(shouldKeepLocalBranch(emptyLocalState()), false);
  assert.equal(shouldKeepLocalBranch(null), false);
});

test('离线备份恢复与导出保留实际地点、时钟、章节和独立行动记录', () => {
  const state = emptyLocalState();
  state.profile = { dollName: '小墨', story: '仍在离线调查', names: {} };
  state.snapshot = { ...state.snapshot, worldId: 'local-world', worldVersion: 7, roomId: 'station', clock: { day: 2, minute: 650 }, narrative: { templateId: 'signal-rain-v1', step: 'day2-station' } };
  state.log = [{ who: '你', text: '去地铁站', status: 'accepted', eventId: 'turn:local-1' }];
  const backup = parseLocalState(JSON.stringify(state));
  const exported = createLocalSaveEnvelope(backup);
  state.snapshot.roomId = 'parlor';
  state.log = [];
  assert.equal(backup.snapshot.roomId, 'station');
  assert.deepEqual(backup.snapshot.clock, { day: 2, minute: 650 });
  assert.equal(backup.log[0].eventId, 'turn:local-1');
  assert.equal(exported.payload.snapshot.roomId, 'station');
  assert.equal(exported.payload.narrative.step, 'day2-station');
});

test('新手章节只在完成当前目标后推进', () => {
  let tutorial = createTutorialState('observe');
  tutorial = nextTutorialStep(tutorial, { action: 'move', payload: { roomId: 'office' } });
  assert.equal(tutorial.step, 'observe');
  tutorial = nextTutorialStep(tutorial, { action: 'observe', payload: {} });
  assert.equal(tutorial.step, 'move');
  tutorial = nextTutorialStep(tutorial, { action: 'move', payload: { roomId: 'office' } });
  assert.equal(tutorial.step, 'talk');
  tutorial = nextTutorialStep(tutorial, { action: 'ask', text: '问林川：你现在在想什么？' });
  assert.equal(tutorial.step, 'choice');
  tutorial = nextTutorialStep(tutorial, { action: 'ask', text: '问林川：我相信你，继续说。' });
  assert.deepEqual(tutorial, { templateId: 'rainy-office-v1', step: 'complete', choice: 'trust' });
});

test('新手章节在刷新后恢复，损坏步骤被忽略', () => {
  const restored = normalizeLocalState({
    profile: { dollName: '小墨', story: '雨夜办公室', names: { A: '林川' } },
    tutorial: { templateId: 'rainy-office-v1', step: 'choice' },
  });
  assert.deepEqual(restored.tutorial, { templateId: 'rainy-office-v1', step: 'choice' });
  assert.equal(normalizeLocalState({ tutorial: { templateId: 'rainy-office-v1', step: 'broken' } }).tutorial, undefined);
});

test('恢复调查笔记时保留已核验记录与隐藏动作标记', () => {
  const restored = normalizeLocalState({ snapshot: { guidance: {
    title: '红灯下的第三次回声', chapter: '第二天',
    journal: [{ id: 'shen-tape', title: '沈青的录音', text: '已听过，仍标注不确定的声音。' }, null],
    actions: [{ id: 'compat', label: '旧动作', intent: '观察周围', hidden: true }],
  } } });
  assert.deepEqual(restored.snapshot.guidance.journal, [{ id: 'shen-tape', title: '沈青的录音', text: '已听过，仍标注不确定的声音。' }]);
  assert.equal(restored.snapshot.guidance.actions[0].hidden, true);
});
