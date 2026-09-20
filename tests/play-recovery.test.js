import test from 'node:test';
import assert from 'node:assert/strict';
import { latestConfirmedView } from '../hex/play-recovery.ts';

const view = (version, room = 'parlor', worldId = 'world-1') => ({
  snapshot: { worldId, worldVersion: version, roomId: room, present: ['YOU'] },
  profile: { dollName: '小墨', story: `版本 ${version}`, names: {} },
});

test('确认旧回执后采用其他标签已推进的最新在线地点与资料', () => {
  const receipt = view(3, 'station');
  const known = view(2);
  const refreshed = view(5, 'office');
  assert.equal(latestConfirmedView(receipt, known, refreshed), refreshed);
  assert.equal(receipt.snapshot.roomId, 'station', '历史日志仍可使用未修改的原回执');
});

test('确认后读会话失败或返回较旧状态，也不覆盖页面已知的新进度', () => {
  const receipt = view(3, 'station');
  const known = view(7, 'home');
  assert.equal(latestConfirmedView(receipt, known, null), known);
  assert.equal(latestConfirmedView(receipt, known, view(5, 'office')), known);
  assert.equal(latestConfirmedView(receipt, null, null), receipt);
});

test('恢复确认时拒绝其他世界的高版本，避免跨会话混入状态', () => {
  const receipt = view(3, 'station');
  assert.equal(latestConfirmedView(receipt, view(99, 'home', 'other-world'), view(100, 'office', 'other-world')), receipt);
});

test('同世界同版本优先新会话中的公开时钟与资料', () => {
  const receipt = view(3, 'station');
  const known = view(3, 'station');
  const refreshed = view(3, 'station');
  refreshed.snapshot.clock = { day: 1, minute: 555 };
  assert.equal(latestConfirmedView(receipt, known, refreshed), refreshed);
  assert.equal(latestConfirmedView(receipt, known, null), known);
});
