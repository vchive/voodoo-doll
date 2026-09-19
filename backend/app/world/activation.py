"""Interest leases and lazy role activation."""

from __future__ import annotations

import copy
import hashlib
import time
from typing import Any, Dict, Iterable, Optional

from ..domain.models import ValidationError, WorldState, ROOM_IDS
from .encounter import resolve_encounter


def _bucket(clock: Dict[str, Any]) -> str:
    return f"{clock.get('day', 1)}:{int(clock.get('minute', 0)) // 15}"


def active_projection_ids(state: WorldState, room_id: str, zone_id: Optional[str]) -> list[str]:
    projections = state.metadata.get("presenceProjections", {})
    result = []
    for agent_id, projection in projections.items() if isinstance(projections, dict) else []:
        agent = state.agents.get(agent_id)
        if not agent or (agent_id not in state.present and not agent.active):
            continue
        if projection.get("roomId") != room_id:
            continue
        # Concrete scopes require a concrete zone match. Room-only scopes are
        # the explicit coarse-grained fallback.
        if zone_id is not None and projection.get("zoneId") != zone_id:
            continue
        result.append(agent_id)
    return sorted(result)


def _clock_summary(clock: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    value = clock or {}
    return {"day": int(value.get("day", 1)), "minute": int(value.get("minute", 0)), "clockVersion": int(value.get("clockVersion", 0))}


def _lease_token(world_id: str, session_id: str, generation: int) -> str:
    return hashlib.sha256(f"{world_id}:{session_id}:{generation}".encode("utf-8")).hexdigest()[:32]


def _quiesce_agent(active: Dict[str, Any], clock: Optional[Dict[str, Any]], reason: str, projection: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    checkpoint = _clock_summary(clock)
    checkpoint.update({"roomId": active.get("roomId"), "zoneId": active.get("zoneId"), "encounterId": active.get("encounterId")})
    if projection:
        checkpoint["projectionVersion"] = projection.get("projectionVersion")
    before = active.get("status", "active")
    active["status"] = "quiescing"
    active["checkpoint"] = checkpoint
    active["quiescingReason"] = reason
    active["summary"] = {"encounterId": active.get("encounterId"), "lastCheckpointClock": _clock_summary(clock), "reason": reason}
    # Persist dormant after emitting the quiescing transition; stale model
    # results must not be able to resume the old activation.
    active["status"] = "dormant"
    return {"agentId": active.get("agentId"), "fromStatus": before, "toStatus": "dormant", "encounterId": active.get("encounterId"), "checkpoint": copy.deepcopy(checkpoint), "summary": copy.deepcopy(active["summary"]), "reason": reason}


def _encounter_key(state: WorldState, clock: Dict[str, Any], room_id: str, agent_id: str) -> str:
    return f"{state.world_id}:{int(clock.get('day', 1))}:{int(clock.get('minute', 0)) // 15}:{room_id}:{agent_id}"


def _start_agent(state: WorldState, active_agents: Dict[str, Any], agent_id: str, lease: Dict[str, Any], clock: Dict[str, Any]) -> Dict[str, Any]:
    counters = state.metadata.setdefault("activation", {}).setdefault("encounterGenerations", {})
    key = _encounter_key(state, clock, str(lease.get("roomId")), agent_id)
    generation = int(counters.get(key, 0)) + 1
    counters[key] = generation
    encounter_id = f"{key}:{generation}"
    projection = state.metadata.get("presenceProjections", {}).get(agent_id, {})
    encounter = resolve_encounter(state, clock, str(lease.get("roomId")), lease.get("zoneId"), agent_id)
    active_agents[agent_id] = {
        "agentId": agent_id,
        "status": "active",
        "roomId": lease.get("roomId"),
        "zoneId": lease.get("zoneId"),
        "sessionId": lease.get("sessionId"),
        "leaseGeneration": lease.get("generation"),
        "leaseToken": lease.get("token"),
        "encounterId": encounter_id,
        "encounterGeneration": generation,
        "encounterBucket": _bucket(clock),
        "encounter": copy.deepcopy(encounter),
        "agentIds": [agent_id],
        "checkpoint": {**_clock_summary(clock), "roomId": lease.get("roomId"), "zoneId": lease.get("zoneId")},
    }
    result = {"agentId": agent_id, "encounterId": encounter_id, "encounterGeneration": generation, "projection": copy.deepcopy(projection), "leaseGeneration": lease.get("generation")}
    if encounter is not None:
        result["encounter"] = copy.deepcopy(encounter)
    return result


def _reconcile_active_agents(state: WorldState, clock: Dict[str, Any], reason: str, now: Optional[float] = None) -> Dict[str, Any]:
    activation = state.metadata.setdefault("activation", {})
    leases = activation.setdefault("leases", {})
    active_agents = activation.setdefault("agents", {})
    transitions: list[Dict[str, Any]] = []
    expired = expire_leases(state, now, clock, transitions)
    for lease in leases.values():
        lease["agentIds"] = active_projection_ids(state, lease.get("roomId"), lease.get("zoneId"))
    leased_agents = {agent for lease in leases.values() for agent in lease.get("agentIds", [])}
    for _, active in list(active_agents.items()):
        if active.get("status") == "active" and active.get("agentId") not in leased_agents:
            transitions.append(_quiesce_agent(active, clock, reason, state.metadata.get("presenceProjections", {}).get(active.get("agentId"))))
    started: list[Dict[str, Any]] = []
    for _, lease in sorted(leases.items()):
        for agent_id in lease.get("agentIds", []):
            if agent_id not in state.agents:
                continue
            current = active_agents.get(agent_id)
            if current and current.get("status") == "active":
                continue
            started.append(_start_agent(state, active_agents, agent_id, lease, clock))
    return {"expiredSessions": expired, "started": started, "transitions": transitions}


def expire_leases(state: WorldState, now: Optional[float] = None, clock: Optional[Dict[str, Any]] = None, transitions: Optional[list[Dict[str, Any]]] = None) -> list[str]:
    now_value = float(time.time() if now is None else now)
    leases = state.metadata.setdefault("activation", {}).setdefault("leases", {})
    expired = [session_id for session_id, lease in leases.items() if float(lease.get("expiresAt", 0)) <= now_value]
    for session_id in expired:
        leases.pop(session_id, None)
    active_agents = state.metadata.setdefault("activation", {}).setdefault("agents", {})
    leased_agents = {agent for lease in leases.values() for agent in lease.get("agentIds", [])}
    for _, active in list(active_agents.items()):
        if active.get("status") == "active" and active.get("agentId") not in leased_agents:
            transition = _quiesce_agent(active, clock, "lease_expired")
            if transitions is not None:
                transitions.append(transition)
    return expired


def interest_update(
    state: WorldState,
    session_id: str,
    room_id: str,
    zone_id: Optional[str],
    ttl_seconds: int,
    clock: Dict[str, Any],
    now: Optional[float] = None,
    lease_generation: Optional[int] = None,
    lease_token: Optional[str] = None,
) -> Dict[str, Any]:
    if not isinstance(session_id, str) or not session_id.strip() or len(session_id) > 120:
        raise ValidationError("sessionId is invalid", "invalid_session")
    if room_id not in ROOM_IDS:
        raise ValidationError("room is not registered", "unknown_room")
    if zone_id is not None and (not isinstance(zone_id, str) or len(zone_id) > 80):
        raise ValidationError("zoneId is invalid", "invalid_zone")
    if not isinstance(ttl_seconds, int) or ttl_seconds < 1 or ttl_seconds > 3600:
        raise ValidationError("ttlSeconds must be between 1 and 3600", "invalid_ttl")
    now_value = float(time.time() if now is None else now)
    activation = state.metadata.setdefault("activation", {})
    leases = activation.setdefault("leases", {})
    previous = leases.get(session_id)
    if previous and float(previous.get("expiresAt", 0)) > now_value:
        if lease_generation is not None and int(previous.get("generation", 0)) != int(lease_generation):
            raise ValidationError("interest lease generation is stale", "stale_interest_lease", 409)
        if lease_token is not None and previous.get("token") != lease_token:
            raise ValidationError("interest lease token is stale", "stale_interest_lease", 409)
    transitions: list[Dict[str, Any]] = []
    expired = expire_leases(state, now_value, clock, transitions)
    agent_ids = active_projection_ids(state, room_id, zone_id)
    scope_changed = bool(previous and (previous.get("roomId") != room_id or previous.get("zoneId") != zone_id))
    generation = int(previous.get("generation", 0)) if previous else 0
    if not previous or float(previous.get("expiresAt", 0)) <= now_value or scope_changed:
        generation += 1
    token = _lease_token(state.world_id, session_id, generation)
    lease = {
        "sessionId": session_id,
        "roomId": room_id,
        "zoneId": zone_id,
        "expiresAt": now_value + ttl_seconds,
        "generation": generation,
        "token": token,
        "clock": {"day": clock["day"], "minute": clock["minute"], "clockVersion": clock["clockVersion"]},
        "agentIds": agent_ids,
    }
    leases[session_id] = lease
    active_agents = activation.setdefault("agents", {})
    leased_agents = {agent for current in leases.values() for agent in current.get("agentIds", [])}
    stopped = list(transitions)
    for _, active in list(active_agents.items()):
        if active.get("status") == "active" and active.get("agentId") not in leased_agents:
            stopped.append(_quiesce_agent(active, clock, "interest_scope_changed", state.metadata.get("presenceProjections", {}).get(active.get("agentId"))))
    started = []
    for agent_id in agent_ids:
        if agent_id not in state.agents:
            continue
        old = active_agents.get(agent_id)
        if not old or old.get("status") != "active" or agent_id not in (old.get("agentIds") or []):
            started.append(_start_agent(state, active_agents, agent_id, lease, clock))
    return {
        "lease": copy.deepcopy(lease),
        "started": started,
        "stopped": stopped,
        "expiredSessions": expired,
        "previous": copy.deepcopy(previous),
        "quiesced": stopped,
    }


def reconcile_leases(state: WorldState, clock: Dict[str, Any], now: Optional[float] = None, reason: str = "projection_changed") -> Dict[str, Any]:
    """Reconcile active leases after a clock or schedule projection update."""
    return _reconcile_active_agents(state, clock, reason, now)
