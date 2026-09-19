"""Event visibility and event construction helpers."""

from typing import Any, Dict, Iterable, List, Optional
import hashlib
import json
import uuid

from .models import CHANNELS, Event, WorldState, canonical_id


def stable_seed(turn_id: str, actor: str = "") -> int:
    digest = hashlib.sha256((turn_id + ":" + actor).encode("utf-8")).digest()
    return int.from_bytes(digest[:8], "big")


def event_id(turn_id: str, index: int) -> str:
    # UUID5 is stable for replay and makes duplicate confirmations easy to spot.
    return str(uuid.uuid5(uuid.NAMESPACE_URL, "voodoo-doll:event:" + turn_id + ":" + str(index)))


def visible_to(event: Event, viewer: str, state: WorldState) -> bool:
    viewer = canonical_id(viewer) or ""
    if event.channel == "doll_private":
        return viewer in ("PLAYER_DOLL", "YOU")
    if event.channel == "system":
        return viewer in ("PLAYER_DOLL", "YOU")
    if event.channel == "private":
        return viewer in set(event.audience)
    if event.channel in ("public", "environment"):
        # Audience is captured when the event is committed.  Looking at the
        # current roster here would leak old room events after a move.
        return viewer in set(event.audience)
    return False


def events_for_viewer(events: Iterable[Event], viewer: str, state: WorldState) -> List[Event]:
    return [event for event in events if visible_to(event, viewer, state)]


def make_event(
    turn_id: str,
    version: int,
    index: int,
    actor: str,
    action: str,
    target: Optional[str],
    channel: str,
    payload: Optional[Dict[str, Any]],
    audience: Iterable[str],
    source: str,
    seed: Optional[int] = None,
) -> Event:
    if channel not in CHANNELS:
        raise ValueError("unsupported channel")
    return Event(
        event_id=event_id(turn_id, index),
        world_version=version,
        turn_id=turn_id,
        actor=canonical_id(actor) or actor,
        action=action,
        target=canonical_id(target),
        channel=channel,
        payload=dict(payload or {}),
        audience=list(dict.fromkeys(canonical_id(value) or value for value in audience)),
        source=source,
        seed=seed,
    )


def event_summary(event: Event) -> str:
    text = event.payload.get("text")
    if event.action == "silence":
        return event.actor + "保持沉默。"
    if event.action == "leave":
        return event.actor + "离开了现场。"
    if text:
        return event.actor + "：" + str(text)
    return event.actor + "执行了" + event.action + "。"


# Compatibility name used by the early SQLite adapter draft.
WorldEvent = Event
