import test from 'node:test';
import assert from 'node:assert/strict';
import { isAtStoryEnd, isStoryAction, splitGuidanceActions } from '../hex/play-guidance.ts';

const action = (id) => ({ id, label: id, intent: id });

test('故事推进动作和场景探索动作分开显示', () => {
  assert.equal(isStoryAction(action('full-station')), true);
  assert.equal(isStoryAction(action('story-trust')), true);
  assert.equal(isStoryAction(action('postscript-start')), true);
  assert.equal(isStoryAction(action('signal-station')), true);
  assert.equal(isStoryAction(action('observe')), false);
  assert.equal(isStoryAction(action('talk-A')), false);

  assert.deepEqual(splitGuidanceActions([
    action('full-station'), action('observe'), { ...action('wait'), hidden: true }, action('story-trust'), action('talk-A'),
  ]), {
    story: [action('full-station'), action('story-trust')],
    exploration: [action('observe'), action('talk-A')],
  });
});

test('自由世界没有主线动作时仍保留场景动作', () => {
  const result = splitGuidanceActions([action('observe'), action('open-door')]);
  assert.equal(result.story.length, 0);
  assert.deepEqual(result.exploration.map(({ id }) => id), ['observe', 'open-door']);
});

test('完成态只在没有可玩后记时显示结尾出口', () => {
  assert.equal(isAtStoryEnd(undefined), false);
  assert.equal(isAtStoryEnd({ completed: false, actions: [action('observe')] }), false);
  assert.equal(isAtStoryEnd({ completed: true, actions: [action('observe'), action('talk-A')] }), true);
  assert.equal(isAtStoryEnd({ completed: true, actions: [action('postscript-start'), action('observe')] }), false);
  assert.equal(isAtStoryEnd({ completed: true, actions: [{ ...action('postscript-start'), hidden: true }, action('observe')] }), true);
});
