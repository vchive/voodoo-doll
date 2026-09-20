import test from 'node:test';
import assert from 'node:assert/strict';
import { advanceDialogue, dialogueAfterAction, guideDialogue, normalizeDialoguePlayback, normalizeDialogueLines, restoreDialogue } from '../hex/play-dialogue.ts';
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
  assert.equal(guideDialogue(world)[0].speakerId, 'PLAYER_DOLL');
  delete world.guidance;
  assert.equal(guideDialogue(world)[0].speakerId, 'PLAYER_DOLL');
});

test('离线移动只展示本地行动反馈，不播放旧场景的NPC对白', () => {
  const world = snapshot(); const previous = restoreDialogue(world);
  const moved = { ...world, roomId: 'garden', present: ['YOU'] };
  const reading = dialogueAfterAction(moved, [{ eventId: 'local', actor: 'ENV', payload: { text: '你来到花园。' } }], previous, false);
  assert.deepEqual(reading.lines, [{ speakerId: 'PLAYER_DOLL', kind: 'narration', text: '你来到花园。' }]);
  assert.deepEqual(restoreDialogue(moved, reading), reading);
});

test('旁白由娃娃讲述，旧缓存归属升级但阅读位置和已展开选项保留', () => {
  const world = snapshot();
  world.guidance.dialogue = [
    { speakerId: 'ENV', kind: 'narration', text: '林川合上了信。' },
    { speakerId: 'A', kind: 'speech', text: '我得回家了。' },
    { speakerId: 'YOU', kind: 'thought', text: '我还有一个问题。' },
    { speakerId: 'A', kind: 'narration', text: '椅子向后挪开。' },
  ];
  const legacy = { ...restoreDialogue(world), lines: structuredClone(world.guidance.dialogue), index: 2, choicesOpen: true };
  const original = structuredClone(legacy);
  const restored = restoreDialogue(world, legacy);
  assert.deepEqual(restored.lines.map(line => line.speakerId), ['PLAYER_DOLL', 'A', 'YOU', 'PLAYER_DOLL']);
  assert.equal(restored.index, 2);
  assert.equal(restored.choicesOpen, true);
  assert.equal(restored.contextKey, legacy.contextKey);
  assert.deepEqual(legacy, original, 'migration must not mutate the saved source');
  const reloaded = normalizeLocalState({ snapshot: world, dialogue: legacy });
  assert.deepEqual(restoreDialogue(reloaded.snapshot, reloaded.dialogue), restored);
});

test('新剧情段直接承接人物回应，去掉多层环境回声但保留真正对白', () => {
  const world = snapshot(); const previous = restoreDialogue(world);
  const next = { ...world, guidance: { ...world.guidance, dialogueId: 'choice', dialogue: [
    { speakerId: 'ENV', kind: 'narration', text: '他把未寄出的信推到你面前。' },
    { speakerId: 'A', kind: 'speech', text: '这一次，请你决定。' },
  ] } };
  const events = [
    { actor: 'YOU', payload: { text: '我想听解释。' } },
    { actor: 'ENV', payload: { text: '空气轻轻一动。' } },
    { actor: 'A', payload: { text: '是我改了记录。', chapterTransition: true } },
    { actor: 'PLAYER_DOLL', payload: { text: '先听他把话说完。' } },
    { actor: 'ENV', payload: { text: '他把未寄出的信推到你面前。', chapterTransition: true } },
  ];
  const reading = dialogueAfterAction(next, events, previous);
  assert.deepEqual(reading.lines, [
    { speakerId: 'A', kind: 'speech', text: '是我改了记录。' },
    { speakerId: 'PLAYER_DOLL', kind: 'speech', text: '先听他把话说完。' },
    { speakerId: 'PLAYER_DOLL', kind: 'narration', text: '他把未寄出的信推到你面前。' },
    { speakerId: 'A', kind: 'speech', text: '这一次，请你决定。' },
  ]);
  assert.equal(reading.index, 0);
  assert.equal(reading.choicesOpen, false);
});

test('同段探索保留行动结果，只有旧passage兜底时也不吞掉环境反馈', () => {
  const world = snapshot(); const previous = restoreDialogue(world);
  const events = [{ actor: 'ENV', payload: { text: '你打开了办公室的门。' } },
    { actor: 'A', action: 'silence', payload: { text: '林川没有回答，手指停在信封上。' } }];
  assert.deepEqual(dialogueAfterAction(world, events, previous).lines, [
    { speakerId: 'PLAYER_DOLL', kind: 'narration', text: '你打开了办公室的门。' },
    { speakerId: 'PLAYER_DOLL', kind: 'narration', text: '林川没有回答，手指停在信封上。' },
  ]);
  const legacy = { ...world, guidance: { ...world.guidance, dialogueId: 'legacy-next', dialogue: [] } };
  assert.deepEqual(dialogueAfterAction(legacy, events.slice(0, 1), previous).lines, [
    { speakerId: 'PLAYER_DOLL', kind: 'narration', text: '你打开了办公室的门。' },
    { speakerId: 'PLAYER_DOLL', kind: 'narration', text: '旧版旁白' },
  ]);
});
