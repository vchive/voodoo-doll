"""Build isolated character contexts from authoritative events and memory."""

from typing import Any, Dict, Iterable, List

from .events import events_for_viewer
from .models import Event, WorldState, canonical_id


def build_context(state: WorldState, viewer: str, events: Iterable[Event] = ()) -> Dict[str, Any]:
    viewer = canonical_id(viewer) or viewer
    agent = state.agents.get(viewer)
    if agent is None:
        return {"viewer": viewer, "room": state.room_id, "present": [], "events": [], "memory": [], "capabilities": []}
    visible_events = events_for_viewer(events, viewer, state)
    public_present = [
        item for item in state.present
        if item in state.agents and state.agents[item].room_id == agent.room_id
    ]
    return {
        "viewer": viewer,
        "room": agent.room_id,
        "present": list(public_present),
        "environment": dict(state.environment),
        "relationships": {
            key: dict(value)
            for key, value in state.relationships.items()
            if viewer in set(key.split(":", 1))
            or value.get("visibility", "members") == "public"
            or viewer in set(value.get("audience", []))
        },
        "events": [event.to_dict() for event in visible_events],
        "memory": list(agent.memory),
        "short_memory": list(agent.short_memory),
        "capabilities": list(agent.profile.outgoing),
    }
