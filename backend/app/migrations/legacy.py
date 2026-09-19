"""Read-only migration from the v5 night-theater and v1 doll saves.

The importer never mutates the input object and deliberately keeps the source
payload hash in server metadata.  Callers can retain the original browser key
as a backup and fall back to legacy-v2 if validation fails.
"""

from __future__ import annotations

from dataclasses import dataclass
import copy
import hashlib
import json
from typing import Any, Dict

from ..domain.models import WorldState, default_world


class MigrationError(ValueError):
    pass


@dataclass(frozen=True)
class MigrationResult:
    world: WorldState
    source_key: str
    source_hash: str
    status: str = "ready"


def _text(value: Any, limit: int) -> str:
    if not isinstance(value, str):
        return ""
    return value.strip()[:limit]


def _safe_facts(raw: Any) -> list[str]:
    values = raw if isinstance(raw, list) else [raw] if isinstance(raw, str) else []
    return list(dict.fromkeys(_text(item.get("text") if isinstance(item, dict) else item, 600) for item in values if _text(item.get("text") if isinstance(item, dict) else item, 600)))[:24]


def migrate_legacy_payload(payload: Dict[str, Any], source_key: str = "voodoo-hex-v5", world_id: str = "local-world") -> MigrationResult:
    if not isinstance(payload, dict):
        raise MigrationError("legacy payload must be an object")
    schema = payload.get("schemaVersion")
    if source_key == "voodoo-hex-v5" and schema != 5:
        raise MigrationError("only explicit v5 saves can be migrated")
    if source_key == "voodoo-cabinet-v1" and schema not in (None, 1):
        raise MigrationError("unexpected v1 save version")

    raw_bytes = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    source_hash = hashlib.sha256(raw_bytes).hexdigest()
    world = default_world(world_id)
    stage = payload.get("stage") if isinstance(payload.get("stage"), dict) else {}
    room = stage.get("roomId")
    if room in {"parlor", "bedroom", "hall", "garden", "attic"}:
        world.room_id = room
        for agent_id in world.present:
            if agent_id in world.agents:
                world.agents[agent_id].room_id = room
    present = stage.get("present")
    if isinstance(present, list):
        allowed = [item for item in present if item in world.agents and world.agents[item].active]
        world.present = list(dict.fromkeys(["YOU", *allowed]))

    facts = _safe_facts(payload.get("confirmedFacts"))
    if not facts and payload.get("onboardingPhase") == "names-confirmed":
        facts = _safe_facts(payload.get("story"))
    names = payload.get("names") if isinstance(payload.get("names"), dict) else {}
    memories = payload.get("memories") if isinstance(payload.get("memories"), dict) else {}
    profile = {
        "dollName": _text(payload.get("dollName") or payload.get("name"), 12),
        "avatar": payload.get("avatar") if isinstance(payload.get("avatar"), str) and payload.get("avatar", "").startswith("data:image/") else "",
        "confirmedFacts": facts,
        "names": {key: _text(value, 12) for key, value in names.items() if key in {"A", "B", "C", "Z"} and _text(value, 12)},
        "nights": max(0, min(999, int(payload.get("nights", 0) or 0))),
        "doubt": max(0, min(10, int(payload.get("doubt", 0) or 0))),
    }
    for agent_id, lines in memories.items():
        if agent_id not in world.agents or not isinstance(lines, list):
            continue
        world.agents[agent_id].memory = [{"summary": _text(line, 200), "channel": "public"} for line in lines if _text(line, 200)][-20:]
    world.metadata = {
        "profile": profile,
        "migration": {"from": source_key, "sourceHash": source_hash, "status": "ready", "schemaVersion": 4},
        "content": {"level": "sfw", "policyVersion": "adult-1"},
    }
    return MigrationResult(world=world, source_key=source_key, source_hash=source_hash)


__all__ = ["MigrationError", "MigrationResult", "migrate_legacy_payload"]
