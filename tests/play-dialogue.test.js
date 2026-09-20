import test from 'node:test';
import assert from 'node:assert/strict';
import { advanceDialogue, dialogueAfterAction, normalizeDialoguePlayback, normalizeDialogueLines, restoreDialogue } from '../hex/play-dialogue.ts';
import { normalizeLocalState } from '../hex/play-state.ts';

const snapshot = () => ({ worldId: 'world-one', worldVersion: 4, roomId: 'office', present: ['YOU', 'A'],
  clock: { day: 1, minute: 560 }, guidance: { title: '雨停以前', chapter: '信', passage: '旧版旁白', dialogueId: 'talk', actions: [],
    dialogue: [{ speakerId: 'YOU', kind: 'thought', text: '他为什么一直看钟？' }, { speakerId: 'A', kind: 'speech', text: '十点我得走。' }] } });

test('逐句阅读、提前行动与刷新恢复只改变展示，不改变世界或时间', () => {
  const world = snapshot(); const original = structuredClone(world);
  let reading = restoreDialogue(world);
  reading = advanceDialogue(reading);
  assert.equal(reading.index, 1); assert.equal(reading.choicesOpen, false);
  const state = normalizeLocalState({ snapshot: world, dialogue: reading });
  assert.deepEqual(restoreDialogue(state.snapshot, state.dialogue), reading);
  reading = advanceDialogue(reading); assert.equal(reading.choicesOpen, true);
  assert.deepEqual(world, original);
  assert.deepEqual(restoreDialogue(world, { ...reading, index: 0, choicesOpen: true }).choicesOpen, true);
});

test('换世界、章节或地点不会串读句位置，生命周期版本变化不重播', () => {
  const world = snapshot(); const reading = advanceDialogue(restoreDialogue(world));
  assert.equal(restoreDialogue({ ...world, worldVersion: 5 }, reading).index, 1);
  assert.equal(restoreDialogue({ ...world, worldId: 'world-two' }, reading).index, 0);
  assert.equal(restoreDialogue({ ...world, roomId: 'home' }, reading).index, 0);
  assert.equal(restoreDialogue({ ...world, guidance: { ...world.guidance, dialogueId: 'choice' } }, reading).index, 0);
});

test('同章自由交谈显示本次回应，章节转场追加新对白且不重复整段旁白', () => {
  const world = snapshot(); const old = restoreDialogue(world);
  const events = [{ eventId: '1', actor: 'YOU', payload: { text: '问林川：你好' } },
    { eventId: '2', actor: 'A', payload: { text: '你来了。' } },
    { eventId: '3', actor: 'ENV', payload: { text: '旧的整段旁白', chapterTransition: true } }];
  assert.deepEqual(dialogueAfterAction(world, events, old).lines, [{ speakerId: 'A', kind: 'speech', text: '你来了。' }]);
  const changed = { ...world, guidance: { ...world.guidance, dialogueId: 'next' } };
  const reading = dialogueAfterAction(changed, events, old);
  assert.equal(reading.lines.length, 3); assert.equal(reading.lines[1].kind, 'thought');
  assert.deepEqual(restoreDialogue(changed, reading), reading);
});

test('损坏阅读位置会钳制，NPC私密心声不会进入公开对话，旧快照仍能阅读', () => {
  assert.deepEqual(normalizeDialogueLines([{ speakerId: 'A', kind: 'thought', text: '秘密' }]), []);
  const raw = { contextKey: 'x', index: 99, lines: snapshot().guidance.dialogue };
  assert.equal(normalizeDialoguePlayback(raw).index, 1);
  assert.equal(normalizeDialoguePlayback({ ...raw, index: -5 }).index, 0);
  assert.equal(normalizeDialoguePlayback({ ...raw, lines: [] }), undefined);
  const world = snapshot(); delete world.guidance.dialogue;
  assert.equal(restoreDialogue(world).lines[0].text, '旧版旁白');
});

test('离线移动只展示本地行动反馈，不播放旧场景的NPC对白', () => {
  const world = snapshot(); const previous = restoreDialogue(world);
  const moved = { ...world, roomId: 'garden', present: ['YOU'] };
  const reading = dialogueAfterAction(moved, [{ eventId: 'local', actor: 'ENV', payload: { text: '你来到花园。' } }], previous, false);
  assert.deepEqual(reading.lines, [{ speakerId: 'ENV', kind: 'narration', text: '你来到花园。' }]);
  assert.deepEqual(restoreDialogue(moved, reading), reading);
});
