import test from 'node:test';
import assert from 'node:assert/strict';

import { WorldEventReducer, createWorldApiClient } from '../hex/world-api.ts';

function snapshot() {
  return {
    schemaVersion: 4,
    worldId: 'test-world',
    worldVersion: 0,
    roomId: 'parlor',
    present: ['YOU', 'A', 'B'],
    environment: { light: 'warm' },
    objects: {},
    agents: {
      YOU: { id: 'YOU', kind: 'player-body', controller: 'PLAYER_DOLL', roomId: 'parlor', memory: [], capabilities: [] },
      A: { id: 'A', kind: 'person', controller: 'A', roomId: 'parlor', memory: [], capabilities: [] },
      B: { id: 'B', kind: 'person', controller: 'B', roomId: 'parlor', memory: [], capabilities: [] },
    },
    relationships: {},
    eventHead: null,
  };
}

function event(eventId, actor = 'A', action = 'answer', version = 1, text = '收到。') {
  return {
    eventId,
    worldVersion: version,
    turnId: 'turn-1',
    actor,
    action,
    target: 'YOU',
    channel: 'public',
    payload: { text },
    audience: ['YOU', 'A', 'B', 'ENV'],
    source: 'local',
  };
}

test('WorldEventReducer drops duplicate event ids and advances the view projection', () => {
  const reducer = new WorldEventReducer(snapshot());
  const answer = event('evt-answer');
  const leave = event('evt-leave', 'B', 'leave');

  assert.equal(reducer.applyEvent(answer), true);
  assert.equal(reducer.applyEvent(answer), false);
  assert.deepEqual(reducer.applyEvents([leave, leave]), [leave]);
  assert.equal(reducer.eventCount, 2);
  assert.equal(reducer.lastVersion, 1);
  assert.deepEqual(reducer.snapshot?.present, ['YOU', 'A']);
});

test('SSE reconnect backfills a complete turn and dedupes stream repeats', async () => {
  const streamed = event('evt-stream');
  const lateSibling = event('evt-sibling', 'B', 'deny', 1, '不谈。');
  const calls = [];
  let streamCount = 0;
  let subscription;
  const received = [];
  const fakeFetch = async (input) => {
    const url = String(input);
    calls.push(url);
    if (url.includes('/events/stream')) {
      streamCount += 1;
      // Keep the escaped separators emitted by the current Python stream
      // adapter. The client accepts them as well as standard SSE newlines.
      const frame = streamCount === 1
        ? `id: ${streamed.eventId}\\ndata: ${JSON.stringify(streamed)}\\n\\n`
        : '';
      return new Response(frame, { headers: { 'content-type': 'text/event-stream' } });
    }
    return new Response(JSON.stringify({
      events: [streamed, lateSibling],
      worldVersion: 1,
    }), { headers: { 'content-type': 'application/json' } });
  };

  subscription = createWorldApiClient('/api/v4').subscribeEvents({
    afterVersion: 0,
    minReconnectDelayMs: 100,
    maxReconnectDelayMs: 100,
    fetchImpl: fakeFetch,
    onEvent: (value) => {
      received.push(value.eventId);
      if (received.length === 2) setTimeout(() => subscription.close(), 350);
    },
  });
  await subscription.done;

  assert.deepEqual(received, ['evt-stream', 'evt-sibling']);
  assert.ok(streamCount >= 1);
  assert.ok(calls.some((url) => url.includes('/events?after=0')));
  assert.ok(calls.some((url) => url.includes('/events?after=1')));
});
