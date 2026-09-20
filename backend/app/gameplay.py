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
import time
import uuid

from .domain.models import ValidationError, VersionConflict, WorldError, ROOM_IDS, WorldState
from .domain.actions import normalize_player_action
from .domain.world import WorldKernel
from .migrations.legacy import MigrationError, migrate_legacy_payload
from .world.clock import clock_snapshot, default_clock
from .world.schedule import project_presence
from .narrative import (TEMPLATE_ID, FULL_TEMPLATE_ID, TEMPLATE_STORY, FULL_TEMPLATE_STORY, DOOR_IDS, guidance, action_minutes,
                        template_schedules, full_template_schedules, validate_saved_narrative, clear_signal_props)
from .signal_story import (SIGNAL_TEMPLATE_ID, STORY_TITLE as SIGNAL_STORY_TITLE,
                           STORY_DESCRIPTION as SIGNAL_STORY_DESCRIPTION, signal_schedules,
                           action_minutes as signal_action_minutes)


ROOM_ALIASES = {
    "客厅": "parlor", "会客厅": "parlor", "卧室": "bedroom", "房间": "parlor",
    "走廊": "hall", "花园": "garden", "办公室": "office", "公司": "office",
    "家": "home", "厨房": "kitchen", "街上": "street", "街道": "street",
    "车站": "station", "地铁站": "station", "酒吧": "bar", "阁楼": "attic",
}
OBJECT_ALIASES = {
    "灯": "lamp", "台灯": "lamp", "铃": "bell", "铃铛": "bell", "门": "door",
    "窗": "window", "窗户": "window", "水壶": "kettle", "办公桌": "desk", "工作台": "desk",
    "事故档案夹": "dossier", "档案夹": "dossier", "交班簿": "handover-book", "交班卡": "handover-book",
    "信号机": "signal-lever", "信号机手柄": "signal-lever", "录音机": "recorder",
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
            "guidance": guidance(self.kernel.state),
            "narrative": copy.deepcopy(self.kernel.state.metadata.get("narrative")),
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

    def _lifecycle_only_since(self, version: int) -> bool:
        current = self.kernel.state.world_version
        if type(version) is not int or version < 0 or version >= current:
            return False
        events = self.kernel.store.events(self.kernel.state.world_id, version)
        allowed = {"clock_advanced", "presence_projected", "activation_started", "activation_quiescing",
                   "activation_stopped", "activation_expired", "chapter_completed", "chapter_reconciled"}
        return (bool(events) and all(event.source == "system" and event.action in allowed for event in events)
                and {event.world_version for event in events} == set(range(version + 1, current + 1)))

    def _renew_idle_interest(self) -> bool:
        lease = self.kernel.state.metadata.get("activation", {}).get("leases", {}).get(self.session_id)
        if not lease or float(lease.get("expiresAt", 0)) <= time.time():
            self._ensure_interest()
            return True
        return False

    def story_draft(self, body: Mapping[str, Any]) -> Dict[str, Any]:
        if not isinstance(body, Mapping):
            raise ValidationError("story request must be an object", "invalid_story_request")
        template_id = body.get("templateId")
        if template_id not in (None, TEMPLATE_ID, FULL_TEMPLATE_ID, SIGNAL_TEMPLATE_ID):
            raise ValidationError("story template is not supported", "unknown_story_template")
        doll_name = _text(body.get("dollName", "小墨"), "dollName", 12)
        story = (SIGNAL_STORY_DESCRIPTION if template_id == SIGNAL_TEMPLATE_ID else
                 FULL_TEMPLATE_STORY if template_id == FULL_TEMPLATE_ID else TEMPLATE_STORY) if template_id else _text(body.get("story"), "story", 600)
        names = _safe_names(body.get("names", {}))
        if template_id == SIGNAL_TEMPLATE_ID:
            names = {"A": "林川", "B": "沈青", "C": "周野", **names}
        elif template_id:
            names = {"A": "林川", "B": "沈青", "C": "周野", **names}
        schedules = []
        for agent_id, room_id, activity in (("A", "office", "work"), ("B", "home", "rest"), ("C", "bar", "watch")):
            schedules.append({
                "id": f"{agent_id}-default-day", "agentId": agent_id,
                "recurrence": {"kind": "daily", "days": [1, 2, 3, 4, 5, 6, 7]},
                "startMinute": 0, "endMinute": 1440,
                "location": {"roomId": room_id}, "activity": activity, "priority": 1,
            })
        if template_id == SIGNAL_TEMPLATE_ID:
            schedules = signal_schedules()
        elif template_id == FULL_TEMPLATE_ID:
            names = {"A": "林川", "B": "沈青", "C": "周野", **names}
            schedules = full_template_schedules()
        elif template_id:
            schedules = template_schedules()
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
            "metadata": {"singlePlayerProfile": profile, "templateId": template_id},
        }, draft_id)
        compiled = draft["compiled"]
        return {
            "draftId": draft_id, "status": "draft", "worldVersion": self.kernel.state.world_version,
            "preview": {"story": story, "dollName": doll_name, "names": names, "templateId": template_id,
                         "roomLabels": ["办公室", "家", "酒吧"],
                         "schedules": compiled["schedules"], "encounters": compiled["encounters"],
                         "title": SIGNAL_STORY_TITLE if template_id == SIGNAL_TEMPLATE_ID else ("雨停以前：明天已经发生" if template_id == FULL_TEMPLATE_ID else "雨停以前")},
        }

    def confirm_story(self, draft_id: str, body: Optional[Mapping[str, Any]] = None) -> Dict[str, Any]:
        identifier = _text(draft_id, "draft_id", 128)
        with self._lock:
            receipt = self._receipt("story", identifier)
            if receipt is not None:
                return receipt
            # A publication may have committed before the HTTP process died.
            # Profile, template clock and chapter state share that transaction.
            published = self.kernel.world_builder._published_receipt(identifier)
            if published is None:
                draft = self.kernel.world_draft(identifier)
                metadata = draft.get("compiled", {}).get("metadata", {})
                if not isinstance(metadata.get("singlePlayerProfile"), Mapping):
                    raise ValidationError("story draft has no player profile", "invalid_story_draft")
                expected = (body or {}).get("expectedVersion") if isinstance(body or {}, Mapping) else None
                base = draft.get("baseWorldVersion")
                if expected not in (None, base, self.kernel.state.world_version):
                    raise VersionConflict("expectedVersion does not match story preview")
                if base != self.kernel.state.world_version:
                    if not self._lifecycle_only_since(base):
                        raise VersionConflict("world changed after story preview")
                    expected = self.kernel.state.world_version
                self.kernel.publish_world_draft(identifier, expected)
            self._ensure_interest()
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
            # "门" is a fallback alias for the current registered doorway.
            # Require a known doorway phrase before accepting it; otherwise
            # inputs such as "不存在的暗门" would silently target the real
            # scene door and fabricate a successful preview.
            if object_id == "door" and label == "门":
                known_door_phrases = (
                    "开门", "打开门", "推开门", "关门", "关上门", "关闭门", "敲门",
                    "玻璃门", "家门", "房门", "这扇门", "这里的门", "门打开", "门关上",
                )
                if not any(phrase in text for phrase in known_door_phrases):
                    continue
            if label in text:
                return DOOR_IDS.get(self.kernel.state.agents["YOU"].room_id, object_id) if object_id == "door" else object_id
        return None

    def _followup_target(self) -> str:
        """Resolve short replies from confirmed, co-located conversation only."""
        projected = self.kernel.state.clone()
        project_presence(projected, clock_snapshot(projected.metadata))
        room = projected.agents["YOU"].room_id
        available = [actor for actor in projected.present if actor in ("A", "B", "C")
                     and projected.agents[actor].room_id == room]
        # Moving starts a new conversational context. Preview/cancel never
        # creates a YOU event, so it cannot steal the conversational target.
        for event in reversed(self.kernel.events(after_version=max(0, self.kernel.state.world_version - 100))):
            if event.get("actor") != "YOU":
                continue
            if event.get("action") == "move":
                break
            if event.get("action") in ("ask", "tell") and event.get("target") in ("A", "B", "C"):
                if event["target"] in available:
                    return event["target"]
                raise ValidationError("刚才交谈的人已经离开。请先选择当前在场的人。", "conversation_target_left")
        if len(available) == 1:
            return available[0]
        if available:
            raise ValidationError("这里有几个人，请先选择要对谁说。", "ambiguous_conversation_target")
        raise ValidationError("附近没有可以接话的人。请先去找人，或选择当前行动。", "missing_conversation_target")

    def _normalize_intent(self, text: str) -> Dict[str, Any]:
        # Directed dialogue wins over place/object words mentioned in speech.
        target = self._target_for_text(text)
        if target and (text.startswith(("问", "询问", "告诉", "和", "对")) or any(word in text for word in ("怎么样", "为什么", "相信", "隐瞒"))):
            return {"action": "ask", "targets": [target], "text": text}
        object_id = self._object_from_text(text)
        if object_id:
            is_door = object_id in DOOR_IDS.values() or object_id == "window"
            verbs = (("open" if is_door else "on", ("打开", "开门", "推开", "开灯", "开启")),
                     ("close" if is_door else "off", ("关闭", "关门", "关灯", "关掉", "关上")),
                     ("knock", ("敲",)), ("use", ("使用", "校对", "工作")),
                     ("look", ("看看", "看", "观察")), ("ring", ("摇铃", "按铃")), ("touch", ("摸", "碰")))
            for verb, words in verbs:
                if any(word in text for word in words):
                    return {"action": "use", "payload": {"objectId": object_id, "verb": verb}}
        sleep_match = re.fullmatch(r"(?:睡觉|睡一觉|(?:睡觉|睡|休息)到(?P<day>第二天|第三天|明天))[。！]?", text)
        if sleep_match:
            n = self.kernel.state.metadata.get("narrative", {})
            step = n.get("step")
            if n.get("templateId") != SIGNAL_TEMPLATE_ID or step not in ("sleep1", "sleep2"):
                raise ValidationError("先完成今天的调查，再回家选择睡觉。", "sleep_not_available")
            if self.kernel.state.agents["YOU"].room_id != "home":
                raise ValidationError("先回家，再睡觉开始下一天。", "sleep_requires_home")
            requested_day = sleep_match.group("day")
            if (requested_day == "第二天" and step != "sleep1") or (requested_day == "第三天" and step != "sleep2"):
                raise ValidationError("请使用当前推荐的睡觉行动，不能跳过调查日。", "invalid_sleep_day")
            return {"action": "observe", "payload": {"sleepUntil": "next-day", "waitMinutes": 120}}
        if re.fullmatch(r"(?:等待|等)(?:\d+|十|二十|三十)?(?:分钟|分)?[。！]?", text):
            match = re.search(r"(\d+)\s*(?:分钟|分)", text)
            minutes = min(120, max(1, int(match.group(1)))) if match else (30 if "三十" in text else 20 if "二十" in text else 10)
            return {"action": "observe", "payload": {"waitMinutes": minutes}}
        if re.fullmatch(r"(?:观察|看看|看一眼)(?:当前)?(?:周围|这里|房间|环境|场景)?[。！]?", text):
            return {"action": "observe", "payload": {}}
        room = self._room_from_text(text)
        if room and re.match(r"^(?:去|前往|走到|回|进入|到)", text):
            return {"action": "move", "payload": {"roomId": room}}
        # Deliberately bounded conversational follow-ups; unknown physical
        # actions must not be disguised as successful conversation or motion.
        followup = re.sub(r"[\s，,。.!！?？…]+", "", text)
        if followup in {"说什么", "你说什么", "什么意思", "你什么意思", "你说的是什么意思", "什么", "然后呢", "后来呢",
                        "继续", "继续说", "请继续", "请继续说", "说下去", "你继续说", "为什么", "为什么呢", "怎么了", "发生什么了",
                        "真的吗", "是吗", "你好", "今天怎么样", "那张告示呢", "告示上写了什么", "那三分钟呢"}:
            return {"action": "ask", "targets": [self._followup_target()], "text": text}
        raise ValidationError("这一步暂时还不能执行。请先选推荐行动，或说去哪里、问谁、打开什么。", "unsupported_intent")

    def intent(self, body: Mapping[str, Any]) -> Dict[str, Any]:
        if not isinstance(body, Mapping):
            raise ValidationError("intent request must be an object", "invalid_intent_request")
        text = _text(body.get("text"), "text", 240)
        normalized = self._normalize_intent(text)
        payload = normalized.setdefault("payload", {})
        minutes_for = (signal_action_minutes if self.kernel.state.metadata.get("narrative", {}).get("templateId") == SIGNAL_TEMPLATE_ID
                       else action_minutes)
        payload["gameMinutes"] = minutes_for(normalized["action"], payload)
        # Preview never spends action time or advances a chapter. A reader
        # returning after an expired lease may renew the server lifecycle;
        # validate first so unsupported input does not trigger that renewal.
        request = {"actor": "PLAYER_DOLL", "action": normalized["action"],
                   "payload": normalized.get("payload", {}), "targets": normalized.get("targets", []),
                   "text": normalized.get("text", text), "expectedVersion": body.get("expectedVersion"),
                   "turnId": body.get("requestId") or "intent-" + uuid.uuid4().hex[:16], "draft": True}
        projected = self.kernel.state.clone()
        project_presence(projected, clock_snapshot(projected.metadata))
        normalize_player_action(request, projected)
        if body.get("expectedVersion") is not None and body["expectedVersion"] != self.kernel.state.world_version:
            raise VersionConflict("expectedVersion does not match current worldVersion")
        if self._renew_idle_interest():
            request["expectedVersion"] = self.kernel.state.world_version
        result = self.kernel.submit_turn(request)
        targets = normalized.get("targets", [])
        ack = ("这句话会说给" + self.profile.get("names", {}).get(targets[0], targets[0]) + "，确认后开始交谈。") if targets else "我先把这一步排好了，确认后才会改变世界。"
        return {"turnId": result["turnId"], "status": "draft", "ack": ack,
                "preview": {"text": text, "action": normalized["action"], "payload": normalized.get("payload", {}),
                            "target": normalized.get("targets", [])},
                "worldVersion": self.kernel.state.world_version, "snapshot": self.snapshot()}

    def confirm_intent(self, turn_id: str, body: Optional[Mapping[str, Any]] = None) -> Dict[str, Any]:
        identifier = _text(turn_id, "turn_id", 128)
        with self._lock:
            receipt = self._receipt("intent", identifier)
            if receipt is not None:
                return receipt
            expected = (body or {}).get("expectedVersion") if isinstance(body or {}, Mapping) else None
            pending = self.kernel._pending_turns.get(identifier)
            if pending:
                pending_expected = pending["request"].get("expectedVersion")
                checked_expected = pending_expected if pending_expected is not None else expected
                if expected not in (None, checked_expected, self.kernel.state.world_version):
                    raise VersionConflict("expectedVersion does not match action preview")
                lifecycle_changed = checked_expected is not None and checked_expected != self.kernel.state.world_version
                if lifecycle_changed and not self._lifecycle_only_since(checked_expected):
                    raise VersionConflict("world changed after action preview")
                renewed = self._renew_idle_interest()
                if renewed or lifecycle_changed:
                    # Only lifecycle events may be rebased. A concurrent
                    # player action, import or publication still conflicts.
                    expected = self.kernel.state.world_version
                    pending["request"]["expectedVersion"] = expected
                    self.kernel.store.save_draft(self.kernel.state.world_id, identifier, pending["request"], pending["result"])
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
                "profile": self.profile, "snapshot": self.snapshot(),
                "narrative": copy.deepcopy(self.kernel.state.metadata.get("narrative"))}

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
        profile["dollName"] = _text(profile.get("dollName"), "dollName", 12)
        profile["names"] = _safe_names(profile.get("names", {}))
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
            # Public snapshots list only the current room. Other active cast
            # members must remain reachable after restoring that projection.
            working.present = list(dict.fromkeys(
                ["YOU", *[key for key, agent in working.agents.items() if agent.active and agent.profile.kind in ("person", "extra")],
                 *[str(item) for item in raw_present if item in working.agents and working.agents[item].active]]
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
        # Importing a custom/legacy save must not retain the previous template.
        previous_narrative = working.metadata.pop("narrative", None)
        saved_snapshot = payload.get("snapshot")
        saved_narrative = payload.get("narrative", saved_snapshot.get("narrative") if isinstance(saved_snapshot, Mapping) else None)
        if not isinstance(saved_narrative, Mapping) or saved_narrative.get("templateId") != SIGNAL_TEMPLATE_ID:
            clear_signal_props(working)
        if source_key == "voodoo-single-v1" and saved_narrative is not None:
            working.metadata["narrative"] = validate_saved_narrative(saved_narrative)
            saved_template = saved_narrative.get("templateId")
            schedule_blocks = (signal_schedules() if saved_template == SIGNAL_TEMPLATE_ID else
                               full_template_schedules() if saved_template == FULL_TEMPLATE_ID else template_schedules())
            working.metadata["schedules"] = {"version": 1 if saved_template == SIGNAL_TEMPLATE_ID else (2 if saved_template == FULL_TEMPLATE_ID else 1),
                                              "blocks": schedule_blocks}
            if saved_template == SIGNAL_TEMPLATE_ID:
                from .signal_story import install_props
                # The public save intentionally contains no arbitrary world
                # object registry. Recreate this template's canonical props
                # without initializing its clock, profile or story progress.
                install_props(working)
            else:
                # Reinstall the original template's authored desk description;
                # no Signal-Man text is allowed to leak into a legacy save.
                reveals = ("原稿、旧卡片柜索引和一张写着明天日期的通行证都在这里。" if saved_template == FULL_TEMPLATE_ID
                           else "今日待校对的是地铁停运告示，右下角留着一块擦除痕迹。")
                working.objects["desk"].update(label="校对办公桌", reveals=reveals)
            working.metadata.setdefault("publishedWorld", {})["schedules"] = copy.deepcopy(working.metadata["schedules"])
            working.metadata["activation"] = {"leases": {}, "agents": {}, "enabled": True}
            working.present = ["YOU", "A", "B", "C"]
            for actor in ("A", "B", "C"):
                working.agents[actor].active = True
        elif source_key == "voodoo-single-v1" and previous_narrative:
            # A backup made before starting a template has no narrative key.
            # Restore its baseline cast timetable rather than retaining the
            # short story's 10:00 deadline or its authored desk description.
            blocks = [{"id": f"{actor}-default-day", "agentId": actor,
                       "recurrence": {"kind": "daily", "days": list(range(1, 8))},
                       "startMinute": 0, "endMinute": 1440, "location": {"roomId": room},
                       "activity": activity, "priority": 1}
                      for actor, room, activity in (("A", "office", "work"), ("B", "home", "rest"), ("C", "bar", "watch"))]
            working.metadata["schedules"] = {"version": 1, "blocks": blocks}
            working.metadata["activation"] = {"leases": {}, "agents": {}, "enabled": True}
            if working.objects.get("desk", {}).get("label") == "校对办公桌":
                working.objects["desk"].pop("label", None)
                working.objects["desk"].pop("reveals", None)
        working.metadata["profile"] = profile
        working.metadata["content"] = {"level": "sfw", "policyVersion": "adult-1"}
        working.world_version = previous + 1
        self.kernel._save_transition(previous, working, [])
        self._ensure_interest()
        return {"status": "imported", "worldVersion": self.kernel.state.world_version,
                "snapshot": self.snapshot(), "profile": self.profile}


__all__ = ["SinglePlayerGame"]
