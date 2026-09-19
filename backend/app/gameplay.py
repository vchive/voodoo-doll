"""Single-player product flow built on top of the authoritative WorldKernel.

This module is intentionally thin: it translates the small set of natural
language intents used by the first playable build into existing server actions.
It never edits the world directly and keeps story/intent drafts in the same
durable draft tables used by the Kernel.
"""

from __future__ import annotations

from typing import Any, Dict, Mapping, Optional
import copy
import re
import threading
import uuid

from .domain.models import ValidationError, WorldError, ROOM_IDS, WorldState
from .domain.world import WorldKernel
from .migrations.legacy import MigrationError, migrate_legacy_payload
from .world.clock import default_clock


ROOM_ALIASES = {
    "客厅": "parlor", "会客厅": "parlor", "卧室": "bedroom", "房间": "parlor",
    "走廊": "hall", "花园": "garden", "办公室": "office", "公司": "office",
    "家": "home", "厨房": "kitchen", "街上": "street", "街道": "street",
    "车站": "station", "地铁站": "station", "酒吧": "bar", "阁楼": "attic",
}
OBJECT_ALIASES = {
    "灯": "lamp", "台灯": "lamp", "铃": "bell", "铃铛": "bell", "门": "door",
    "窗": "window", "窗户": "window", "水壶": "kettle", "水壶": "kettle",
}


def _text(value: Any, name: str, limit: int) -> str:
    if not isinstance(value, str):
        raise ValidationError(f"{name} must be text", "invalid_%s" % name)
    value = value.strip()
    if not value or len(value) > limit:
        raise ValidationError(f"{name} length is invalid", "invalid_%s" % name)
    return value


def _safe_names(raw: Any) -> Dict[str, str]:
    if raw is None:
        return {}
    if not isinstance(raw, Mapping):
        raise ValidationError("names must be an object", "invalid_names")
    result = {}
    for key, value in raw.items():
        if key not in {"A", "B", "C"}:
            raise ValidationError("only A, B and C may be named", "invalid_name_slot")
        result[key] = _text(value, "name", 12)
    return result


class SinglePlayerGame:
    """Product-facing flow for one anonymous world/session."""

    def __init__(self, kernel: WorldKernel, session_id: str):
        self.kernel = kernel
        self.session_id = _text(session_id, "session_id", 128)
        lock = getattr(kernel, "_single_player_lock", None)
        if lock is None:
            lock = threading.RLock()
            setattr(kernel, "_single_player_lock", lock)
        self._lock = lock

    def _receipt(self, kind: str, identifier: str) -> Optional[Dict[str, Any]]:
        reader = getattr(self.kernel.store, "get_gameplay_receipt", None)
        return reader(self.kernel.state.world_id, kind, identifier) if callable(reader) else None

    def _save_receipt(self, kind: str, identifier: str, result: Dict[str, Any]) -> Dict[str, Any]:
        writer = getattr(self.kernel.store, "save_gameplay_receipt", None)
        return writer(self.kernel.state.world_id, kind, identifier, result) if callable(writer) else result

    @property
    def profile(self) -> Dict[str, Any]:
        profile = self.kernel.state.metadata.get("profile", {})
        return copy.deepcopy(profile) if isinstance(profile, Mapping) else {}

    def snapshot(self) -> Dict[str, Any]:
        """Return only state the single-player client is allowed to render.

        The Kernel snapshot also carries registries, every dormant presence
        projection, activation tokens and internal metadata for diagnostics.
        Those fields are neither needed by the product client nor suitable for
        a public session response.
        """
        raw = self.kernel.snapshot("YOU")
        agents = raw.get("agents", {}) if isinstance(raw.get("agents"), Mapping) else {}
        return {
            "schemaVersion": raw.get("schemaVersion"),
            "worldId": raw.get("worldId"),
            "worldVersion": raw.get("worldVersion", 0),
            "roomId": raw.get("roomId", "parlor"),
            "present": copy.deepcopy(raw.get("present", ["YOU"])),
            "environment": copy.deepcopy(raw.get("environment", {})),
            "agents": {
                str(agent_id): {
                    "id": item.get("id", agent_id),
                    "kind": item.get("kind"),
                    "roomId": item.get("roomId"),
                }
                for agent_id, item in agents.items()
                if isinstance(item, Mapping)
            },
            "relationships": copy.deepcopy(raw.get("relationships", {})),
            "clock": copy.deepcopy(raw.get("clock")),
            "eventHead": raw.get("eventHead"),
        }

    def _save_profile(self, profile: Mapping[str, Any]) -> None:
        previous = self.kernel.state.world_version
        working = self.kernel.state.clone()
        working.metadata["profile"] = copy.deepcopy(dict(profile))
        self.kernel._save_transition(previous, working, [])

    def _ensure_interest(self, room_id: Optional[str] = None) -> None:
        room = room_id or self.kernel.state.agents["YOU"].room_id
        # No client clock is accepted here; update_interest uses the server
        # clock and is idempotent while the session remains in the same room.
        self.kernel.update_interest(self.session_id, room, self.kernel.state.metadata.get("playerZoneId"))

    def story_draft(self, body: Mapping[str, Any]) -> Dict[str, Any]:
        if not isinstance(body, Mapping):
            raise ValidationError("story request must be an object", "invalid_story_request")
        doll_name = _text(body.get("dollName"), "dollName", 12)
        story = _text(body.get("story"), "story", 600)
        names = _safe_names(body.get("names", {}))
        schedules = []
        for agent_id, room_id, activity in (("A", "office", "work"), ("B", "home", "rest"), ("C", "bar", "watch")):
            schedules.append({
                "id": f"{agent_id}-default-day", "agentId": agent_id,
                "recurrence": {"kind": "daily", "days": [1, 2, 3, 4, 5, 6, 7]},
                "startMinute": 0, "endMinute": 1440,
                "location": {"roomId": room_id}, "activity": activity, "priority": 1,
            })
        encounters = [{
            "id": "first-meeting", "roomId": "parlor", "agentIds": ["A"],
            "weight": 1, "summary": "有人在房间里抬头看了你一眼。",
        }]
        profile = {
            "dollName": doll_name, "story": story, "confirmedFacts": [story],
            "names": names, "onboardingPhase": "story-told", "nights": self.profile.get("nights", 0),
            "doubt": self.profile.get("doubt", 0), "contentLevel": "sfw", "profileVersion": 1,
        }
        draft_id = "story-" + uuid.uuid4().hex[:16]
        draft = self.kernel.create_world_draft({
            "narrative": story, "schedules": schedules, "encounters": encounters,
            "metadata": {"singlePlayerProfile": profile},
        }, draft_id)
        compiled = draft["compiled"]
        return {
            "draftId": draft_id, "status": "draft", "worldVersion": self.kernel.state.world_version,
            "preview": {"story": story, "dollName": doll_name, "names": names,
                         "roomLabels": ["办公室", "家", "酒吧"],
                         "schedules": compiled["schedules"], "encounters": compiled["encounters"]},
        }

    def confirm_story(self, draft_id: str, body: Optional[Mapping[str, Any]] = None) -> Dict[str, Any]:
        identifier = _text(draft_id, "draft_id", 128)
        with self._lock:
            receipt = self._receipt("story", identifier)
            if receipt is not None:
                return receipt
            draft = self.kernel.world_draft(identifier)
            compiled = draft.get("compiled", {})
            metadata = compiled.get("metadata", {}) if isinstance(compiled, Mapping) else {}
            profile = metadata.get("singlePlayerProfile") if isinstance(metadata, Mapping) else None
            if not isinstance(profile, Mapping):
                raise ValidationError("story draft has no player profile", "invalid_story_draft")
            expected = (body or {}).get("expectedVersion") if isinstance(body or {}, Mapping) else None
            self.kernel.publish_world_draft(identifier, expected)
            self._save_profile({**profile, "onboardingPhase": "names-confirmed"})
            self._ensure_interest("parlor")
            result = {"status": "confirmed", "draftId": identifier, "worldVersion": self.kernel.state.world_version,
                      "snapshot": self.snapshot(), "profile": self.profile, "source": "local"}
            return self._save_receipt("story", identifier, result)

    def cancel_story(self, draft_id: str) -> Dict[str, Any]:
        return self.kernel.cancel_world_draft(_text(draft_id, "draft_id", 128))

    def _target_for_text(self, text: str) -> Optional[str]:
        names = self.profile.get("names", {})
        for agent_id in ("A", "B", "C"):
            candidates = [names.get(agent_id), agent_id]
            if any(value and value in text for value in candidates):
                return agent_id
        return None

    def _room_from_text(self, text: str) -> Optional[str]:
        for label, room in sorted(ROOM_ALIASES.items(), key=lambda item: len(item[0]), reverse=True):
            if label in text:
                return room
        return None

    def _object_from_text(self, text: str) -> Optional[str]:
        for label, object_id in sorted(OBJECT_ALIASES.items(), key=lambda item: len(item[0]), reverse=True):
            if label in text:
                return object_id
        return None

    def _normalize_intent(self, text: str) -> Dict[str, Any]:
        room = self._room_from_text(text)
        if room:
            return {"action": "move", "payload": {"roomId": room}}
        object_id = self._object_from_text(text)
        if object_id and any(word in text for word in ("打开", "开灯", "开启")):
            return {"action": "use", "payload": {"objectId": object_id, "verb": "on"}}
        if object_id and any(word in text for word in ("关闭", "关掉", "关上")):
            return {"action": "use", "payload": {"objectId": object_id, "verb": "off"}}
        if "等" in text or "等待" in text:
            match = re.search(r"(\d+)\s*(?:分钟|分)", text)
            minutes = min(120, max(1, int(match.group(1)))) if match else 10
            return {"action": "observe", "payload": {"waitMinutes": minutes}}
        target = self._target_for_text(text)
        if target and any(word in text for word in ("问", "询问", "怎么样", "吗", "为什么", "告诉")):
            return {"action": "ask", "targets": [target], "text": text}
        if any(word in text for word in ("看看", "观察", "看一眼")):
            return {"action": "observe", "payload": {}}
        raise ValidationError("我还不知道这句话要做什么，请说去哪里、问谁或操作物件", "unsupported_intent")

    def intent(self, body: Mapping[str, Any]) -> Dict[str, Any]:
        if not isinstance(body, Mapping):
            raise ValidationError("intent request must be an object", "invalid_intent_request")
        text = _text(body.get("text"), "text", 240)
        normalized = self._normalize_intent(text)
        # Preview is deliberately read-only. Interest activation happened when
        # the player entered the room; re-entering it here would advance the
        # lifecycle version before the player confirms the intent.
        request = {"actor": "PLAYER_DOLL", "action": normalized["action"],
                   "payload": normalized.get("payload", {}), "targets": normalized.get("targets", []),
                   "text": normalized.get("text", text), "expectedVersion": body.get("expectedVersion"),
                   "turnId": body.get("requestId") or "intent-" + uuid.uuid4().hex[:16], "draft": True}
        result = self.kernel.submit_turn(request)
        return {"turnId": result["turnId"], "status": "draft", "ack": "我先把这一步排好了，确认后才会改变世界。",
                "preview": {"text": text, "action": normalized["action"], "payload": normalized.get("payload", {}),
                            "target": normalized.get("targets", [])},
                "worldVersion": self.kernel.state.world_version, "snapshot": self.kernel.snapshot("YOU")}

    def confirm_intent(self, turn_id: str, body: Optional[Mapping[str, Any]] = None) -> Dict[str, Any]:
        identifier = _text(turn_id, "turn_id", 128)
        with self._lock:
            receipt = self._receipt("intent", identifier)
            if receipt is not None:
                return receipt
            expected = (body or {}).get("expectedVersion") if isinstance(body or {}, Mapping) else None
            try:
                committed = self.kernel.confirm_turn(identifier, expected)
            except WorldError as error:
                if error.code == "unknown_turn":
                    raise WorldError(str(error), error.code, 404) from error
                raise
            interest = self.kernel.update_interest(
                self.session_id,
                self.kernel.state.agents["YOU"].room_id,
                self.kernel.state.metadata.get("playerZoneId"),
            )
            result = {
                **committed,
                "worldVersion": self.kernel.state.world_version,
                "events": [*committed.get("events", []), *interest.get("events", [])],
                "snapshot": self.snapshot(),
                "profile": self.profile,
                "source": committed.get("source", "local"),
            }
            return self._save_receipt("intent", identifier, result)

    def cancel_intent(self, turn_id: str) -> Dict[str, Any]:
        return self.kernel.cancel_turn(_text(turn_id, "turn_id", 128))

    def export_save(self) -> Dict[str, Any]:
        return {"schemaVersion": 1, "sourceKey": "voodoo-single-v1", "worldId": self.kernel.state.world_id,
                "profile": self.profile, "snapshot": self.snapshot()}

    def import_save(self, body: Mapping[str, Any]) -> Dict[str, Any]:
        if not isinstance(body, Mapping):
            raise ValidationError("save import must be an object", "invalid_save_import")
        source_key = _text(body.get("sourceKey"), "sourceKey", 80)
        payload = body.get("payload")
        if not isinstance(payload, Mapping):
            raise ValidationError("save payload must be an object", "invalid_save_payload")
        imported_world: Optional[WorldState] = None
        try:
            if source_key in ("voodoo-hex-v5", "voodoo-cabinet-v1"):
                migrated = migrate_legacy_payload(dict(payload), source_key, self.kernel.state.world_id)
                imported = migrated.world.metadata.get("profile", {})
                imported_world = migrated.world
            elif source_key == "voodoo-single-v1":
                imported = payload.get("profile", {})
            else:
                raise ValidationError("save source is not supported", "unsupported_save_source")
        except MigrationError as error:
            raise ValidationError(str(error), "invalid_save_payload") from error
        if not isinstance(imported, Mapping) or not imported.get("dollName"):
            raise ValidationError("save does not contain a profile", "invalid_save_payload")
        profile = copy.deepcopy(dict(imported))
        profile["contentLevel"] = "sfw"
        profile["onboardingPhase"] = "names-confirmed"

        previous = self.kernel.state.world_version
        if imported_world is not None:
            working = imported_world.clone()
            working.world_id = self.kernel.state.world_id
        else:
            working = self.kernel.state.clone()
            raw_snapshot = payload.get("snapshot", {})
            if not isinstance(raw_snapshot, Mapping):
                raise ValidationError("save snapshot must be an object", "invalid_save_payload")
            room_id = raw_snapshot.get("roomId")
            if room_id not in ROOM_IDS:
                raise ValidationError("save room is not supported", "invalid_save_payload")
            working.room_id = str(room_id)
            for actor_id in ("YOU", "PLAYER_DOLL"):
                if actor_id in working.agents:
                    working.agents[actor_id].room_id = str(room_id)
            raw_agents = raw_snapshot.get("agents", {})
            if not isinstance(raw_agents, Mapping):
                raise ValidationError("save agents must be an object", "invalid_save_payload")
            for actor_id, raw_agent in raw_agents.items():
                if actor_id not in working.agents or not isinstance(raw_agent, Mapping):
                    continue
                agent_room = raw_agent.get("roomId")
                if agent_room in ROOM_IDS:
                    working.agents[actor_id].room_id = str(agent_room)
            raw_present = raw_snapshot.get("present", [])
            if not isinstance(raw_present, list):
                raise ValidationError("save presence must be a list", "invalid_save_payload")
            working.present = list(dict.fromkeys(
                ["YOU", *[str(item) for item in raw_present if item in working.agents and working.agents[item].active]]
            ))
            raw_environment = raw_snapshot.get("environment", {})
            if not isinstance(raw_environment, Mapping):
                raise ValidationError("save environment must be an object", "invalid_save_payload")
            working.environment = {
                str(key): copy.deepcopy(value)
                for key, value in raw_environment.items()
                if key in {"light", "weather", "sound"} and isinstance(value, (str, int, float, bool, type(None)))
            }
            raw_relationships = raw_snapshot.get("relationships", {})
            if not isinstance(raw_relationships, Mapping):
                raise ValidationError("save relationships must be an object", "invalid_save_payload")
            working.relationships = {
                str(key): copy.deepcopy(value)
                for key, value in list(raw_relationships.items())[:64]
                if isinstance(key, str) and isinstance(value, Mapping)
            }
            raw_clock = raw_snapshot.get("clock")
            if raw_clock is not None:
                if not isinstance(raw_clock, Mapping):
                    raise ValidationError("save clock must be an object", "invalid_save_payload")
                day = raw_clock.get("day")
                minute = raw_clock.get("minute")
                if not isinstance(day, int) or not 1 <= day <= 100000 or not isinstance(minute, int) or not 0 <= minute < 1440:
                    raise ValidationError("save clock is invalid", "invalid_save_payload")
                imported_clock = default_clock()
                imported_clock.update({
                    "day": day,
                    "minute": minute,
                    "anchorDay": day,
                    "anchorMinute": minute,
                    "clockVersion": max(0, int(raw_clock.get("clockVersion", 0) or 0)),
                    "timezone": str(raw_clock.get("timezone", "Asia/Shanghai"))[:64],
                })
                working.metadata["clock"] = imported_clock
        working.metadata["profile"] = profile
        working.metadata["content"] = {"level": "sfw", "policyVersion": "adult-1"}
        working.world_version = previous + 1
        self.kernel._save_transition(previous, working, [])
        return {"status": "imported", "worldVersion": self.kernel.state.world_version,
                "snapshot": self.snapshot(), "profile": self.profile}


__all__ = ["SinglePlayerGame"]
