"""Post-commit memory projection."""

from typing import Iterable

from .events import event_summary
from .models import Event, WorldState


def write_memories(state: WorldState, events: Iterable[Event]) -> None:
    for event in events:
        if event.channel in ("doll_private", "system"):
            continue
        # Event audience is room-scoped for public/environment events and
        # explicitly scoped for private events.  Never fan out by current
        # roster: a later room move must not rewrite historical visibility.
        recipients = event.audience
        for recipient in recipients:
            agent = state.agents.get(recipient)
            if agent is None:
                continue
            item = {"eventId": event.event_id, "turnId": event.turn_id, "summary": event_summary(event), "channel": event.channel}
            agent.memory.append(item)
            agent.short_memory.append(item)
            if len(agent.memory) > 100:
                del agent.memory[:-100]
            if len(agent.short_memory) > 20:
                del agent.short_memory[:-20]
