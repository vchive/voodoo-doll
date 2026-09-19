"""Action proposal validation and normalization."""

from dataclasses import dataclass, field
from typing import Any, Dict, Iterable, List, Optional

from .models import (
    ALL_ACTIONS,
    CHANNELS,
    REQUEST_ACTIONS,
    RESPONSE_ACTIONS,
    PermissionDenied,
    ValidationError,
    WorldState,
    ROOM_IDS,
    canonical_id,
)


@dataclass(frozen=True)
class AgentProposal:
    """Provider-neutral proposal shape used by adapter contracts.

    The kernel still validates the proposal against the actor registry before
    materializing an Event; fields such as confidence and metadata are hints,
    never authoritative world state.
    """

    actor_id: str
    action: str
    target_id: Optional[str] = None
    channel: str = "public"
    payload: Dict[str, Any] = field(default_factory=dict)
    source: str = "local"
    trace_id: Optional[str] = None
    text: Optional[str] = None
    confidence: Optional[float] = None
    metadata: Dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class ActionProposal:
    actor: str
    action: str
    targets: List[str] = field(default_factory=list)
    channel: str = "public"
    text: Optional[str] = None
    payload: Dict[str, Any] = field(default_factory=dict)
    source: str = "player_doll"
    idempotency_key: Optional[str] = None
    expected_version: Optional[int] = None

    @property
    def target(self) -> Optional[str]:
        return self.targets[0] if self.targets else None


def _text(value: Any) -> Optional[str]:
    if value is None:
        return None
    if not isinstance(value, str):
        raise ValidationError("text must be a string", "invalid_text")
    value = value.strip()
    if not value or len(value) > 240:
        raise ValidationError("text must contain 1-240 characters", "invalid_text")
    return value


def normalize_player_action(raw: Dict[str, Any], state: WorldState) -> ActionProposal:
    """Turn a client intent into a YOU proposal; never trust client actor ids."""
    if not isinstance(raw, dict):
        raise ValidationError("request body must be an object", "invalid_request")
    raw_actor = canonical_id(raw.get("actor", "YOU"))
    if raw_actor not in ("YOU", "PLAYER_DOLL"):
        raise PermissionDenied("player commands must be submitted as YOU", "player_cannot_control_npc")
    action = raw.get("action")
    if action not in REQUEST_ACTIONS:
        raise ValidationError("unsupported player action", "unsupported_action")
    channel = raw.get("channel", "public")
    if channel not in ("public", "private"):
        raise ValidationError("player action channel is invalid", "unsupported_channel")
    raw_targets = raw.get("targets", raw.get("target"))
    if raw_targets is None:
        targets: List[str] = []
    elif isinstance(raw_targets, str):
        targets = [raw_targets]
    elif isinstance(raw_targets, list):
        targets = [str(item) for item in raw_targets]
    else:
        raise ValidationError("target must be a string or list", "invalid_target")
    targets = [canonical_id(item) for item in targets]
    if len(set(targets)) != len(targets):
        raise ValidationError("targets must be unique", "duplicate_target")
    if len(targets) > 4:
        raise ValidationError("at most four targets are supported", "too_many_targets")
    if action in ("move", "use", "observe") and targets:
        raise ValidationError("this action does not accept a person target", "target_not_allowed")
    for target in targets:
        if target not in state.agents or state.agents[target].profile.kind not in ("person", "extra"):
            raise ValidationError("target is not a registered person", "unknown_target")
        if action != "invite" and target not in state.present:
            raise ValidationError("target is not present in the room", "target_not_present")
        if action != "invite" and state.agents[target].room_id != state.agents["YOU"].room_id:
            raise ValidationError("target is outside the current room", "target_out_of_range")
        if action == "invite" and target == "Z":
            raise ValidationError("Z cannot become a persistent invite target", "z_invite_denied")
        if action in ("ask", "tell") and target in state.present:
            target_state = state.agents[target]
            actor_state = state.agents["YOU"]
            if target_state.room_id != actor_state.room_id:
                raise ValidationError("target is not in the same room", "target_not_in_room")
    if action in ("ask", "tell", "invite") and not targets:
        raise ValidationError("a person target is required for this action", "target_required")
    if action in ("ask", "tell", "invite") and not raw.get("text"):
        raise ValidationError("text is required for this action", "text_required")
    text = _text(raw.get("text"))
    payload = raw.get("payload", {})
    if not isinstance(payload, dict):
        raise ValidationError("payload must be an object", "invalid_payload")
    if action == "move":
        room = payload.get("roomId", payload.get("room"))
        if not isinstance(room, str) or room not in ROOM_IDS:
            raise ValidationError("room is not registered", "unknown_room")
        if room == state.agents["YOU"].room_id:
            raise ValidationError("YOU is already in that room", "already_in_room")
    if action == "use":
        object_id = payload.get("objectId", payload.get("object"))
        verb = payload.get("verb", "touch")
        if not isinstance(object_id, str) or object_id not in state.objects:
            raise ValidationError("object is not registered", "unknown_object")
        definition = state.objects[object_id]
        if definition.get("roomId") != state.agents["YOU"].room_id:
            raise ValidationError("object is not in the current room", "object_out_of_range")
        if not isinstance(verb, str) or verb not in definition.get("actions", ()):
            raise ValidationError("object does not support this action", "unsupported_object_action")
    expected = raw.get("expectedVersion", raw.get("expected_version"))
    if expected is not None and (not isinstance(expected, int) or expected < 0):
        raise ValidationError("expectedVersion must be a non-negative integer", "invalid_expected_version")
    key = raw.get("idempotencyKey", raw.get("idempotency_key", raw.get("requestId")))
    if key is not None and (not isinstance(key, str) or not key.strip() or len(key) > 120):
        raise ValidationError("idempotencyKey is invalid", "invalid_idempotency_key")
    turn_id = raw.get("turnId", raw.get("turn_id"))
    if turn_id is not None and (not isinstance(turn_id, str) or not turn_id.strip() or len(turn_id) > 120):
        raise ValidationError("turnId is invalid", "invalid_turn_id")
    return ActionProposal("YOU", action, targets, channel, text, dict(payload), "player_doll", key, expected)


def validate_agent_response(actor: str, action: str, target: Optional[str], text: Optional[str], state: WorldState) -> None:
    actor = canonical_id(actor)
    if actor not in state.agents or state.agents[actor].profile.kind not in ("person", "extra"):
        raise ValidationError("response actor is not a person", "invalid_response_actor")
    if action not in RESPONSE_ACTIONS:
        raise ValidationError("response action is not allowed", "invalid_response_action")
    if target not in ("YOU", "PLAYER_DOLL"):
        raise ValidationError("response target must be YOU", "invalid_response_target")
    if action in ("answer", "deny", "lie", "counter", "refuse") and not _text(text):
        raise ValidationError("response text is required", "response_text_required")


def response_actions() -> Iterable[str]:
    return RESPONSE_ACTIONS
