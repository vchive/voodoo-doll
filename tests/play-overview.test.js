import test from 'node:test';
import assert from 'node:assert/strict';
import { OVERVIEW_VIEW, projectOverview } from '../hex/play-overview-model.ts';

const profile = { dollName: '小柜', names: { A: '林川', B: '沈青', C: '周野', D: '自定义同事' } };
const world = (roomId = 'office', present = ['YOU', 'A']) => ({ worldId: 'world-one', worldVersion: 7, roomId, present, agents: {}, clock: { day: 1, minute: 565 } });

test('俯视只用公开在场和房间，旧档可显示，私密记忆及无几何协议坐标都不读取', () => {
  const snapshot = world('office', ['YOU', 'A', 'A', 'B', 'PLAYER_DOLL', 'ENV']);
  snapshot.agents = { A: { roomId: 'office', get memory() { throw new Error('私密记忆不得读取'); } }, B: { roomId: 'home' } };
  Object.defineProperty(snapshot, 'positions', { get() { throw new Error('世界坐标不能当作16px格子'); } });
  const view = projectOverview(snapshot, profile);
  assert.deepEqual(view.actors.map((a) => a.actorId), ['YOU', 'A']);
  assert.equal(view.layoutKind, 'schematic');
  assert.deepEqual(view.view, OVERVIEW_VIEW);
  assert.deepEqual(projectOverview(world('station', ['C']), profile).actors.map((a) => a.actorId), ['C']);
});

test('11个canonical场景各保留语义，地铁不是走廊，客厅不是卧室', () => {
  const station = projectOverview(world('station'), profile);
  assert.equal(station.roomId, 'station');
  assert.equal(station.roomLabel, '地铁站');
  assert.ok(station.props.some((p) => p.kind === 'tracks'));
  const parlor = projectOverview(world('parlor'), profile);
  assert.ok(parlor.props.some((p) => p.kind === 'sofa'));
  assert.ok(!parlor.props.some((p) => p.kind === 'bed'));
  for (const roomId of ['home', 'bedroom', 'kitchen', 'hall', 'parlor', 'garden', 'attic', 'office', 'street', 'station', 'bar']) {
    const view = projectOverview(world(roomId), profile);
    assert.equal(view.roomId, roomId);
    assert.notEqual(view.roomLabel, '当前场景');
    assert.ok(view.props.length > 0);
  }
  const unknown = projectOverview(world('custom-observatory'), profile);
  assert.equal(unknown.roomId, 'custom-observatory');
  assert.deepEqual(unknown.props, [], '未知场景用空示意场景而不是冒充卧室');
});

test('人物热点跟随实际绘制的身体中心，所有内置布局不落在实心家具里', () => {
  for (const roomId of ['home', 'bedroom', 'kitchen', 'hall', 'parlor', 'garden', 'attic', 'office', 'street', 'station', 'bar']) {
    const view = projectOverview(world(roomId, ['YOU', 'A', 'B', 'C', 'Z']), profile);
    const spots = new Set();
    for (const actor of view.actors) {
      assert.ok(actor.xPercent > 0 && actor.xPercent < 100);
      assert.ok(actor.yPercent > 0 && actor.footYPercent < 100);
      assert.equal(actor.xPercent, (actor.gx * 16 + 8) / 288 * 100);
      assert.equal(actor.yPercent, (actor.gy * 16 - 4) / 256 * 100);
      assert.ok(!view.props.some((p) => p.solid && actor.gx >= p.x && actor.gx < p.x + p.w && actor.gy >= p.y && actor.gy < p.y + p.h), `${roomId}/${actor.actorId}被家具挡住`);
      assert.ok(!spots.has(`${actor.gx},${actor.gy}`), `${roomId}人物重叠`);
      spots.add(`${actor.gx},${actor.gy}`);
    }
  }
});

test('换房间/换世界重建展示投影，不保留离场者，未知角色是姓名标记不是A', () => {
  const before = projectOverview(world('office', ['YOU', 'A']), profile);
  const after = projectOverview({ ...world('station', ['YOU', 'C', 'D']), worldId: 'world-two' }, profile);
  assert.equal(after.worldKey, 'world-two');
  assert.equal(after.roomId, 'station');
  assert.deepEqual(after.actors.map((a) => a.actorId), ['YOU', 'C', 'D']);
  assert.equal(after.actors.find((a) => a.actorId === 'D').visual, 'marker');
  assert.equal(after.actors.find((a) => a.actorId === 'D').label, '自定义同事');
  assert.equal(after.actors.find((a) => a.actorId === 'C').visual, 'pixel');
  assert.deepEqual(before.actors.map((a) => a.actorId), ['YOU', 'A']);
});

test('展示不推进时间、不改存档、不保留上次场景灯光，并且重复投影稳定', () => {
  const snapshot = { ...world(), environment: { light: 'off' }, narrative: { step: 'arrival' } };
  const original = structuredClone(snapshot);
  const originalProfile = structuredClone(profile);
  const first = projectOverview(snapshot, profile);
  assert.deepEqual(projectOverview(snapshot, profile), first);
  assert.equal(first.light, 'off');
  assert.equal(projectOverview(world('home'), profile).light, 'on');
  assert.deepEqual(snapshot, original);
  assert.deepEqual(profile, originalProfile);
});
