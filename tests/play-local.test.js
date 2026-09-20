import test from 'node:test';
import assert from 'node:assert/strict';
import { parseLocalAction, applyLocalAction } from '../hex/play-local.ts';

const rooms = { parlor: '会客厅', station: '地铁站', office: '办公室' };
test('离线未知动作不再伪造已执行反馈；门交互优先于观察或地点提及', () => {
  assert.equal(parseLocalAction('去地下室取一把剑', rooms), null);
  assert.equal(parseLocalAction('问林川：办公室的门是谁关的', rooms), null);
  assert.deepEqual(parseLocalAction('去开门，看看里面有啥东西', rooms), { action: 'use', payload: { verb: 'open' } });
  assert.deepEqual(parseLocalAction('去地铁站', rooms), { action: 'move', payload: { roomId: 'station' } });
});
test('离线等待跨午夜保留日期；探索不修改权威章节或缓存对象', () => {
  const snapshot = { worldId: 'test', worldVersion: 5, roomId: 'office', present: ['YOU', 'A'], clock: { day: 2, minute: 1435 }, guidance: { chapter: '第三章' } };
  const result = applyLocalAction(snapshot, parseLocalAction('等待十分钟', rooms));
  assert.deepEqual(result.snapshot.clock, { day: 3, minute: 5 });
  assert.equal(result.snapshot.guidance.chapter, '第三章');
  assert.equal(snapshot.clock.minute, 1435);
  const moved = applyLocalAction(snapshot, parseLocalAction('去地铁站', rooms));
  assert.deepEqual(moved.snapshot.present, ['YOU']);
  assert.equal(snapshot.roomId, 'office');
});
