"""Deterministic, registry-backed encounter selection.

Encounter selection is a world projection, not a model call.  The resolver
only reads the published encounter registry and returns a stable selection for
one world-clock bucket and scene.  Activation code records that selection in
the lifecycle event so reconnect/replay never draws again.
"""

from __future__ import annotations

import hashlib
import json
from typing import Any, Dict, Mapping, Optional

from ..domain.models import WorldState


def _clock_bucket(clock: Mapping[str, Any]) -> str:
    return f"{int(clock.get('day', 1))}:{int(clock.get('minute', 0)) // 15}"


def _scene_id(room_id: str, zone_id: Optional[str]) -> str:
    return f"{room_id}:{zone_id or '*'}"


def _seed(world_id: str, clock: Mapping[str, Any], scene_id: str, encounter_version: int) -> int:
    material = f"{world_id}:{int(clock.get('day', 1))}:{int(clock.get('minute', 0)) // 15}:{scene_id}:{encounter_version}"
    return int.from_bytes(hashlib.sha256(material.encode("utf-8")).digest()[:8], "big")


def _registry(state: WorldState) -> tuple[int, list[Dict[str, Any]]]:
    # Published world data is authoritative.  The top-level metadata fallback
    # keeps old snapshots readable while they migrate to the published shape.
    published = state.metadata.get("publishedWorld")
    source: Any = published.get("encounters") if isinstance(published, Mapping) else None
    if source is None:
        source = state.metadata.get("encounters")
    version = 1
    values: Any = source
    if isinstance(source, Mapping):
        version = int(source.get("version", 1))
        values = source.get("items", source.get("entries", []))
    if isinstance(published, Mapping) and isinstance(published.get("encounterVersion"), int):
        version = int(published["encounterVersion"])
    if not isinstance(values, list):
        values = []
    return version, [dict(item) for item in values if isinstance(item, Mapping)]


def _matches(candidate: Mapping[str, Any], room_id: str, zone_id: Optional[str], agent_id: Optional[str]) -> bool:
    if candidate.get("roomId") != room_id:
        return False
    candidate_zone = candidate.get("zoneId")
    if candidate_zone is not None and candidate_zone != zone_id:
        return False
    participants = candidate.get("agentIds", candidate.get("agents"))
    if participants is not None:
        if not isinstance(participants, list) or agent_id not in participants:
            return False
    return True


def resolve_encounter(
    state: WorldState,
    clock: Mapping[str, Any],
    room_id: str,
    zone_id: Optional[str],
    agent_id: Optional[str] = None,
) -> Optional[Dict[str, Any]]:
    """Choose one declared encounter with a stable weighted draw.

    The returned payload is safe to persist in an activation event: it only
    contains registry data, the seed inputs and the selected candidate.  A
    missing registry is a valid no-encounter result and never calls a model.
    """

    version, entries = _registry(state)
    candidates = [item for item in entries if _matches(item, room_id, zone_id, agent_id)]
    if not candidates:
        return None
    candidates.sort(key=lambda item: str(item.get("id", "")))
    scene_id = str(candidates[0].get("sceneId") or _scene_id(room_id, zone_id))
    seed = _seed(state.world_id, clock, scene_id, version)
    weights = [max(1, int(item.get("weight", 1))) for item in candidates]
    total = sum(weights)
    cursor = seed % total
    selected = candidates[0]
    for candidate, weight in zip(candidates, weights):
        if cursor < weight:
            selected = candidate
            break
        cursor -= weight
    candidate_id = str(selected.get("id"))
    # Hash the canonical selection so the identity remains stable even when a
    # display label or model-facing text is added to the registry later.
    identity = json.dumps(
        {"sceneId": scene_id, "candidateId": candidate_id, "version": version, "seed": seed},
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )
    encounter_id = hashlib.sha256(identity.encode("utf-8")).hexdigest()[:24]
    return {
        "encounterId": encounter_id,
        "candidateId": candidate_id,
        "sceneId": scene_id,
        "encounterVersion": version,
        "seed": seed,
        "clockBucket": _clock_bucket(clock),
        "agentId": agent_id,
        "summary": selected.get("summary", selected.get("title", "")),
    }
