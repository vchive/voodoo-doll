import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DOLL_AGENT_ID,
  agentForActor,
  canPlayerControl,
  canRespond,
  capabilityFor,
} from '../shared/capabilities.js';
import {
  createInteractionRequest,
  eventsVisibleTo,
  normalizeInteractionEvent,
  validateInteractionEvent,
  validateInteractionRequest,
} from '../shared/interaction.js';
import { SceneRuntime, SceneRuntimeError } from '../server/scene-runtime.js';

const stage = { roomId: 'bedroom', present: ['YOU', 'A', 'B'] };

test('YOU and doll share one execution agent while NPCs keep independent agency', () => {
  assert.equal(agentForActor('YOU'), DOLL_AGENT_ID);
  assert.equal(agentForActor('doll'), DOLL_AGENT_ID);
  assert.equal(agentForActor('A'), 'A');
  assert.equal(capabilityFor('A').owner, 'A');
  assert.equal(canPlayerControl('YOU'), true);
  assert.equal(canPlayerControl('A'), false);
  assert.equal(canRespond('A', 'deny'), true);
  assert.equal(canRespond('A', 'move'), false);
});

test('player request can ask or invite an NPC but cannot author an NPC action', () => {
  assert.equal(validateInteractionRequest({ actor: 'YOU', action: 'ask', target: 'A', text: '你愿意解释吗？' }, stage).valid, true);
  assert.equal(validateInteractionRequest({ actor: 'A', action: 'answer', target: 'B', text: '我解释。' }, stage).valid, false);
  assert.ok(validateInteractionRequest({ actor: 'YOU', action: 'invite', target: 'Z', text: '过来一下。' }, stage).errors.includes('extra-cannot-be-invited-as-persistent-target'));
  assert.ok(validateInteractionRequest({ actor: 'YOU', action: 'ask', target: 'C', text: '你看见了吗？' }, stage).errors.includes('target-not-present'));
});

test('NPC can refuse, counter, or stay silent as its own response', () => {
  const request = createInteractionRequest({ action: 'ask', target: 'A', text: '请当面解释。' }, stage);
  const deny = normalizeInteractionEvent({ version: 1, id: 'e1', actor: 'A', target: 'YOU', action: 'deny', text: '我不想解释。', channel: 'public', source: 'agent' }, { stage, source: 'agent' });
  const silence = normalizeInteractionEvent({ version: 1, id: 'e2', actor: 'A', target: 'YOU', action: 'silence', channel: 'public', source: 'agent' }, { stage, source: 'agent' });
  assert.equal(deny.inReplyTo, undefined);
  assert.equal(silence.action, 'silence');
  assert.equal(validateInteractionEvent({ version: 1, actor: 'A', target: 'YOU', action: 'confront', text: '你们说清楚。', channel: 'public', source: 'agent' }, { stage, source: 'agent' }).valid, false);
  assert.equal(request.target, 'A');
});

test('private interaction is visible only to participants and doll, never unrelated NPCs', () => {
  const event = normalizeInteractionEvent({ version: 1, id: 'private-1', actor: 'A', target: 'B', action: 'tell', text: '只有你知道。', channel: 'private', source: 'agent', audience: ['A', 'B'] }, { stage, source: 'agent' });
  assert.equal(eventsVisibleTo([event], 'A', stage).length, 1);
  assert.equal(eventsVisibleTo([event], 'B', stage).length, 1);
  assert.equal(eventsVisibleTo([event], 'C', stage).length, 0);
  assert.equal(eventsVisibleTo([event], 'doll', stage).length, 1);
});

test('scene microturn preserves target agency, adds environment feedback, and returns memory deltas', async () => {
  const runtime = new SceneRuntime({
    stage,
    agents: new Map([['A', { respond: async () => ({ action: 'deny', text: '我不接受这个说法。' }) }]]),
    environment: { respond: async () => ({ action: 'feedback', text: '台灯闪了一下。' }) },
  });
  const result = await runtime.run({ actor: 'YOU', action: 'ask', target: 'A', text: '你愿意当面解释吗？' });
  assert.deepEqual(result.events.map((event) => event.actor), ['YOU', 'A']);
  assert.equal(result.events[1].action, 'deny');
  assert.equal(result.memories.A.length, 2);
  await assert.rejects(() => runtime.run({ actor: 'A', action: 'answer', target: 'B', text: '我说。' }), (error) => error instanceof SceneRuntimeError && error.code === 'INVALID_INTERACTION_REQUEST');
});
