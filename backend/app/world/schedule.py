"""Published schedule blocks and deterministic presence projections."""

from __future__ import annotations

import copy
import hashlib
import json
from typing import Any, Dict, Iterable, Optional

from ..domain.models import ROOM_IDS, WorldState


def _days(block: Dict[str, Any]) -> set[int]:
    recurrence = block.get("recurrence", {})
    values = recurrence.get("days", [1, 2, 3, 4, 5, 6, 7])
    return {int(item) for item in values if isinstance(item, int) and 1 <= item <= 7}


def schedule_matches(block: Dict[str, Any], day: int, minute: int) -> bool:
    # Recurrence days are ISO-style 1..7; world clocks may expose an
    # unbounded day count, so normalize both the current and previous day.
    day = ((int(day) - 1) % 7) + 1
    previous_day = ((day - 2) % 7) + 1
    minute = int(minute)
    if not 0 <= minute < DAY_MINUTES:
        return False
    start = int(block.get("startMinute", 0))
    end = int(block.get("endMinute", DAY_MINUTES))
    if not (0 <= start < DAY_MINUTES and 0 < end <= DAY_MINUTES):
        return False
    days = _days(block)
    if start == end:
        # Equal endpoints describe an empty half-open interval.  A full-day
        # block uses the explicit endMinute=DAY_MINUTES form.
        return False
    if start < end:
        return day in days and start <= minute < end
    # A block crossing midnight is interpreted as two logical ranges without
    # mutating the registry.  The after-midnight range belongs to the
    # recurrence day on which the block started.
    return (day in days and minute >= start) or (previous_day in days and minute < end)


DAY_MINUTES = 24 * 60


def _projection_version(previous: Any, projections: Dict[str, Any]) -> int:
    encoded = json.dumps(projections, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    digest = hashlib.sha256(encoded.encode("utf-8")).hexdigest()[:12]
    return int(digest, 16)


def project_presence(state: WorldState, clock: Dict[str, Any]) -> tuple[Dict[str, Any], list[Dict[str, Any]]]:
    metadata = state.metadata
    published = metadata.get("publishedWorld")
    published_defaults = published.get("defaultLocations") if isinstance(published, dict) else None
    if not isinstance(published_defaults, dict):
        published_defaults = metadata.get("defaultLocations")
    # A legacy/custom state without a published registry still gets a stable
    # deterministic fallback. Do not derive or persist it from mutable rooms.
    default_locations = published_defaults if isinstance(published_defaults, dict) else {
        agent_id: {"roomId": "parlor", "zoneId": None}
        for agent_id, agent in state.agents.items()
        if agent.profile.kind in ("person", "extra")
    }
    blocks = metadata.get("schedules", {}).get("blocks", []) if isinstance(metadata.get("schedules"), dict) else []
    by_agent: Dict[str, list[Dict[str, Any]]] = {}
    for block in blocks if isinstance(blocks, list) else []:
        if not isinstance(block, dict) or block.get("agentId") not in state.agents:
            continue
        room = (block.get("location") or {}).get("roomId")
        if room not in ROOM_IDS:
            continue
        if schedule_matches(block, int(clock["day"]), int(clock["minute"])):
            by_agent.setdefault(str(block["agentId"]), []).append(block)

    previous = metadata.get("presenceProjections", {})
    next_projections: Dict[str, Any] = {}
    for agent_id, agent in state.agents.items():
        if agent.profile.kind not in ("person", "extra"):
            continue
        candidates = sorted(by_agent.get(agent_id, []), key=lambda item: (-int(item.get("priority", 0)), str(item.get("id", ""))))
        block = candidates[0] if candidates else None
        if block:
            location = block["location"]
            next_projections[agent_id] = {
                "agentId": agent_id,
                "roomId": location["roomId"],
                "zoneId": location.get("zoneId"),
                "activity": block.get("activity", "present"),
                "scheduleId": block.get("id", f"{agent_id}-default"),
                "startMinute": int(block.get("startMinute", 0)),
                "endMinute": int(block.get("endMinute", DAY_MINUTES)),
                "projectionVersion": 0,
            }
        else:
            default_location = default_locations.get(agent_id, {"roomId": "parlor", "zoneId": None})
            next_projections[agent_id] = {
                "agentId": agent_id,
                "roomId": default_location["roomId"],
                "zoneId": default_location.get("zoneId"),
                "activity": "available",
                "scheduleId": None,
                "startMinute": 0,
                "endMinute": DAY_MINUTES,
                "projectionVersion": 0,
            }
    version = _projection_version(previous, next_projections)
    changed: list[Dict[str, Any]] = []
    for agent_id, projection in next_projections.items():
        old = previous.get(agent_id) if isinstance(previous, dict) else None
        old_comparable = {key: value for key, value in old.items() if key != "projectionVersion"} if isinstance(old, dict) else old
        comparable = {key: value for key, value in projection.items() if key != "projectionVersion"}
        projection["projectionVersion"] = version
        if old_comparable != comparable:
            changed.append({"before": copy.deepcopy(old), "after": copy.deepcopy(projection)})
        if agent_id in state.agents and projection["roomId"] != state.agents[agent_id].room_id:
            state.agents[agent_id].room_id = projection["roomId"]
    metadata["presenceProjections"] = next_projections
    metadata["presenceVersion"] = version
    return next_projections, changed
