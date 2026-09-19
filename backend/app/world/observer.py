"""Deterministic world invariants; no model observer is required."""

from typing import Any, Dict, List

from ..domain.models import ROOM_IDS, WorldState


def audit_state(state: WorldState) -> Dict[str, Any]:
    issues: List[Dict[str, Any]] = []
    projections = state.metadata.get("presenceProjections", {})
    for agent_id, projection in projections.items() if isinstance(projections, dict) else []:
        if projection.get("roomId") not in ROOM_IDS:
            issues.append({"code": "projection_unknown_room", "agentId": agent_id})
    for agent_id, agent in state.agents.items():
        if agent.room_id not in ROOM_IDS:
            issues.append({"code": "agent_unknown_room", "agentId": agent_id, "roomId": agent.room_id})
    blocks = state.metadata.get("schedules", {}).get("blocks", []) if isinstance(state.metadata.get("schedules"), dict) else []
    by_agent: Dict[str, List[Dict[str, Any]]] = {}
    for block in blocks if isinstance(blocks, list) else []:
        by_agent.setdefault(str(block.get("agentId")), []).append(block)
    for agent_id, values in by_agent.items():
        for left_index, left in enumerate(values):
            for right in values[left_index + 1:]:
                if int(left.get("priority", 0)) != int(right.get("priority", 0)):
                    continue
                if int(left.get("startMinute", 0)) < int(right.get("endMinute", 0)) and int(right.get("startMinute", 0)) < int(left.get("endMinute", 0)):
                    issues.append({"code": "schedule_conflict", "agentId": agent_id, "scheduleIds": [left.get("id"), right.get("id")]})
    return {"ok": not issues, "observerVersion": "deterministic-1", "issues": issues}
