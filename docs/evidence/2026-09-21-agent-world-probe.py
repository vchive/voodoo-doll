"""Temporary in-memory audit: public SinglePlayerGame flow with a counting fake adapter.
No real model, HTTP service, credentials or player database are used.
"""
from pathlib import Path
import copy
import hashlib
import json
import socket
import sys
from datetime import datetime, timezone
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from backend.app.agents.base import ProviderResult
from backend.app.domain.world import WorldKernel
from backend.app.gameplay import SinglePlayerGame
from backend.app.signal_story import SIGNAL_TEMPLATE_ID
from backend.app.store.event_store import EventStore

class CountingAdapter:
    def __init__(self):
        self.requests = []
    def propose_request(self, request):
        self.requests.append(copy.deepcopy(request.as_dict()))
        return ProviderResult(actor=request.actor_id, action='answer', target='YOU',
                              text='这是计数实验的本地替身回应。', source='audit-fake')

def run_case(template):
    adapter = CountingAdapter()
    store = EventStore(':memory:')
    label = 'signal' if template else 'custom'
    kernel = WorldKernel(world_id='audit-' + label, store=store, agent=adapter)
    game = SinglePlayerGame(kernel, 'audit-session-' + label)
    body = {'dollName': '审查娃娃', 'story': '我来到办公室，与林川讨论今天的工作。', 'names': {'A': '林川', 'B': '沈青', 'C': '周野'}}
    if template:
        body['templateId'] = template
    draft = game.story_draft(body)
    game.confirm_story(draft['draftId'], {'expectedVersion': draft['worldVersion']})
    def turn(text, request_id):
        preview = game.intent({'text': text, 'requestId': request_id,
                               'expectedVersion': kernel.state.world_version})
        calls_at_preview = len(adapter.requests)
        result = game.confirm_intent(preview['turnId'])
        return result, calls_at_preview
    turn('去办公室', label + '-move')
    assert game.snapshot()['roomId'] == 'office'
    assert 'A' in game.snapshot()['present']
    before = len(adapter.requests)
    # Synthetic memory sentinels belong only to this disposable in-memory fixture.
    kernel.state.agents['A'].memory.append({'summary': 'AUDIT_A_PRIVATE_SENTINEL'})
    kernel.state.agents['B'].memory.append({'summary': 'AUDIT_B_PRIVATE_SENTINEL'})
    result, calls_at_preview = turn('问林川：你今天工作怎么样？', label + '-ask')
    delta = len(adapter.requests) - before
    answer = next(event for event in result['events'] if event.get('actor') == 'A')
    output = {'template': template or 'custom', 'room': game.snapshot()['roomId'],
              'presentBeforeAskIncludesA': True, 'callsBeforeAsk': before,
              'callsAtPreview': calls_at_preview, 'callsAfterConfirm': len(adapter.requests),
              'confirmCallDelta': delta, 'responseSource': answer.get('source'),
              'responseAction': answer.get('action'), 'responseText': answer['payload']['text']}
    if template:
        assert delta == 0
        assert answer.get('source') == 'local'
    else:
        assert delta == 1
        context = adapter.requests[-1]['context']
        encoded = json.dumps(context, ensure_ascii=False)
        assert context['viewer'] == 'A'
        assert 'AUDIT_A_PRIVATE_SENTINEL' in encoded
        assert 'AUDIT_B_PRIVATE_SENTINEL' not in encoded
        assert answer.get('source') == 'audit-fake'
        persisted = store.load_state(kernel.state.world_id) if hasattr(store, 'load_state') else store.initialize(kernel.state)
        assert any(item.get('eventId') == answer['eventId'] for item in persisted.agents['A'].memory)
        assert not any(item.get('eventId') == answer['eventId'] for item in persisted.agents['B'].memory)
        output.update({'contextKeys': sorted(context), 'contextViewer': context['viewer'],
                       'ownMemoryIncluded': True, 'otherPrivateMemoryExcluded': True,
                       'confirmedAnswerPersistedToOwnMemory': True,
                       'outOfRoomBDoesNotReceiveAnswerMemory': True,
                       'characterTraitsInContext': 'traits' in context,
                       'characterGoalsInContext': 'goals' in context})
    assert calls_at_preview == before
    return output

with patch('socket.socket.connect', side_effect=AssertionError('Audit forbids external network')):
    cases = [run_case(SIGNAL_TEMPLATE_ID), run_case(None)]
files = ['backend/app/gameplay.py', 'backend/app/domain/world.py', 'backend/app/domain/perception.py',
         'backend/app/domain/memory.py', 'backend/app/signal_story.py', 'backend/app/agents/gateway.py']
report = {'testedAt': datetime.now(timezone.utc).isoformat(), 'scope': 'SinglePlayerGame public methods with disposable in-memory EventStore and injected counting adapter; no HTTP or real model/network',
          'memorySentinels': 'Injected only into isolated test WorldState, never user data', 'networkBlocked': True,
          'sources': {name: hashlib.sha256((ROOT / name).read_bytes()).hexdigest() for name in files},
          'cases': cases, 'pass': True}
result = Path(__file__).with_name('2026-09-21-agent-world-probe.json')
result.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
print(json.dumps(report, ensure_ascii=False, indent=2))
