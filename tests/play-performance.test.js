import test from 'node:test';
import assert from 'node:assert/strict';
import { performanceFromEvents, projectPerformance } from '../hex/play-performance.ts';

const snapshot = () => ({ worldVersion: 9, roomId: 'office', present: ['YOU', 'PLAYER_DOLL', 'A', 'B', 'A', 'Z'],
  agents: { A: { roomId: 'office', memory: [{ thought: '我其实很害怕。' }] }, B: { roomId: 'home' }, Z: { roomId: 'office' } },
  clock: { day: 2, minute: 560 } });
const line = (speakerId, kind = 'speech', text = '你来了。') => ({ speakerId, kind, text });
const event = (action, payload = {}, extra = {}) => ({ eventId: 'confirmed-turn:0', actor: 'YOU', action, payload, ...extra });

test('舞台只投影公开在场者，重复人物去重且房间矛盾优先过滤', () => {
  const world = snapshot();
  const before = structuredClone(world);
  const view = projectPerformance(world, line('A'));
  assert.deepEqual(view.castIds, ['A', 'Z']);
  assert.equal(view.speakerId, 'A');
  assert.equal(view.expression, 'neutral', '私密memory不能控制公开表情');
  assert.equal(projectPerformance(world, line('B')).speakerId, null, '旧缓存对白不能把离场者拉回舞台');
  assert.deepEqual(world, before);
});

test('旧存档缺少agents时仍可根据公开present展示，未出场者不能靠台词出现', () => {
  const oldSave = { worldVersion: 1, roomId: 'station', present: ['YOU', 'C'] };
  assert.deepEqual(projectPerformance(oldSave, line('C')).castIds, ['C']);
  assert.equal(projectPerformance(oldSave, line('A')).speakerId, null);
  assert.deepEqual(projectPerformance({ ...oldSave, agents: { C: {} } }, line('C')).castIds, ['C']);
});

test('娃娃是独立旁白，玩家沉思不生成对面立绘，NPC私密thought不能作表现来源', () => {
  const world = snapshot();
  assert.equal(projectPerformance(world, line('ENV', 'narration')).speakerId, 'PLAYER_DOLL');
  assert.equal(projectPerformance(world, line('A', 'narration')).speakerId, 'PLAYER_DOLL');
  assert.equal(projectPerformance(world, line('PLAYER_DOLL')).mode, 'speech');
  const thinking = projectPerformance(world, line('YOU', 'thought'));
  assert.equal(thinking.speakerId, 'YOU');
  assert.equal(thinking.mode, 'thought');
  assert.equal(thinking.expression, 'thinking');
  assert.ok(!thinking.castIds.includes('YOU') && !thinking.castIds.includes('PLAYER_DOLL'));
  const secret = projectPerformance(world, line('A', 'thought', '谢谢你，我其实很开心。'));
  assert.equal(secret.speakerId, null);
  assert.equal(secret.expression, 'neutral');
});

test('轻量表情只响应当前公开对白，不将叙事中的情绪词视为角色心理事实', () => {
  const world = snapshot();
  assert.equal(projectPerformance(world, line('A', 'speech', '谢谢你，愿意听我解释。')).expression, 'smile');
  assert.equal(projectPerformance(world, line('A', 'speech', '对不起，我晚到了。')).expression, 'concerned');
  assert.equal(projectPerformance(world, line('A', 'speech', '不用担心，这里不会有事。')).expression, 'neutral');
  assert.equal(projectPerformance(world, line('A', 'speech', '怎么会？')).expression, 'surprised');
  assert.equal(projectPerformance(world, line('A', 'speech', '够了，请停下。')).expression, 'angry');
  assert.equal(projectPerformance(world, line('A', 'speech', '我担心那份记录。')).expression, 'concerned');
  assert.equal(projectPerformance(world, line('ENV', 'narration', '谢谢，他显得很高兴。')).expression, 'neutral');
});

test('移动回执中的环境与生命周期反馈不会遮盖玩家实际动作或改变世界', () => {
  const events = [event('move', { roomId: 'station', text: '去地铁站' }),
    event('feedback', { text: '你来到地铁站。' }, { actor: 'ENV', eventId: 'confirmed-turn:1' }),
    event('clock_advanced', { minutes: 8 }, { actor: 'ENV', eventId: 'confirmed-turn:2' })];
  const before = structuredClone(events);
  assert.deepEqual(performanceFromEvents(events), { kind: 'move', label: '走向目的地', eventId: 'confirmed-turn:0' });
  assert.deepEqual(events, before);
  assert.equal(performanceFromEvents(events).eventId, performanceFromEvents(events).eventId, '重放回执保持同一个去重键');
});

test('已确认开关门、查看、校对、等待与对话各有明确表现，普通物品使用不冒充工作', () => {
  assert.equal(performanceFromEvents([event('use', { objectId: 'office-door', verb: 'open' })]).kind, 'open');
  assert.equal(performanceFromEvents([event('use', { objectId: 'office-door', verb: 'close' })]).kind, 'close');
  assert.equal(performanceFromEvents([event('use', { objectId: 'desk', verb: 'look' })]).kind, 'inspect');
  assert.equal(performanceFromEvents([event('use', { objectId: 'desk', verb: 'use' })]).kind, 'work');
  assert.equal(performanceFromEvents([event('use', { objectId: 'kettle', verb: 'use' })]), null);
  assert.equal(performanceFromEvents([event('observe', { waitMinutes: 10 })]).kind, 'wait');
  assert.equal(performanceFromEvents([event('observe', { sleepUntil: 'next-day', waitMinutes: 120 })]).label, '休息到次日');
  assert.equal(performanceFromEvents([event('observe')]).kind, 'inspect');
  assert.equal(performanceFromEvents([event('ask', { text: '明天你会开门吗？' })]).kind, 'speak');
});

test('未确认、无ID、旁白和未知动作均不触发；自由文本不能伪装成已发生动作', () => {
  assert.equal(performanceFromEvents([]), null);
  assert.equal(performanceFromEvents([event('move', {}, { proposalStatus: 'draft' })]), null);
  assert.equal(performanceFromEvents([event('move', {}, { proposalStatus: 'rejected' })]), null);
  assert.equal(performanceFromEvents([event('move', {}, { eventId: '' })]), null);
  assert.equal(performanceFromEvents([event('feedback', { text: '你打开了门并完成工作。' }, { actor: 'ENV' })]), null);
  assert.equal(performanceFromEvents([event('unknown', { text: '去办公室，打开门。' })]), null);
  assert.equal(performanceFromEvents([event('answer', { text: '我现在去办公室。' }, { actor: 'A' })]), null);
});
