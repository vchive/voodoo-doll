"""Authoritative world kernel and one-turn orchestration."""

from typing import Any, Dict, List, Optional
import copy
import hashlib
import json
import sqlite3
import time

from .actions import ActionProposal, normalize_player_action, validate_agent_response
from .events import events_for_viewer, make_event, stable_seed
from .memory import write_memories
from .models import Event, PermissionDenied, ValidationError, VersionConflict, WorldError, WorldState, canonical_id, default_world
from .perception import build_context
from .resolver import EnvironmentResolver, RuleAgent
from ..agents.base import AgentRequest
from ..agents.gateway import create_game_agent
from .models import ROOM_IDS
from ..world.activation import interest_update, reconcile_leases
from ..world.clock import advance_clock, clock_snapshot, default_clock
from ..world.observer import audit_state
from ..world.schedule import project_presence
from ..world.operation_queue import OperationQueue, OperationReceipt
from ..tools.registry import PrimitiveRegistry, PublishedRegistry
from ..tools.mobility import resolve_mobility
from ..world_builder import WorldBuilder
from ..narrative import advance_story, expire_story, reconcile_story, spend_minutes, story_response


class WorldKernel:
    schema_version = 4

    def __init__(self, world_id: str = "local-world", store: Any = None, agent: Any = None, environment: Any = None):
        from ..store import EventStore
        self.store = store or EventStore(":memory:")
        self.state = self.store.initialize(default_world(world_id))
        # Model credentials are read only by the server-side gateway.  When
        # configuration is absent, create_game_agent returns the deterministic
        # local RuleAgent so domain-only/offline runs remain playable.
        self.agent = agent or create_game_agent()
        self.environment = environment or EnvironmentResolver()
        activation_generations = self._activation_generations_from_state(self.state)
        self.operation_queue = OperationQueue(
            world_generation=self.state.world_version,
            activation_generations=activation_generations,
        )
        self._persisted_operation_audits = set()
        self._turn_results: Dict[str, Dict[str, Any]] = {}
        self._pending_turns: Dict[str, Dict[str, Any]] = {}
        draft_reader = getattr(self.store, "drafts", None)
        if callable(draft_reader):
            for turn_id, request, result in draft_reader(self.state.world_id):
                self._pending_turns[turn_id] = {"request": request, "result": result}
        self.world_builder = WorldBuilder(self)

    @staticmethod
    def _activation_generations_from_state(state: WorldState) -> Dict[str, int]:
        activation = state.metadata.get("activation", {}) if isinstance(state.metadata, dict) else {}
        agents = activation.get("agents", {}) if isinstance(activation, dict) else {}
        result: Dict[str, int] = {}
        for agent_id, active in agents.items() if isinstance(agents, dict) else []:
            if not isinstance(active, dict):
                continue
            generation = active.get("encounterGeneration")
            if isinstance(generation, int) and generation >= 0:
                result[str(agent_id)] = generation
        return result

    def _sync_operation_fence(self) -> None:
        """Keep the in-memory operation fence at least as new as world state."""
        current = self.operation_queue.fence.snapshot()
        if self.state.world_version > current.world_generation:
            self.operation_queue.advance_world(self.state.world_version)
        for agent_id, generation in self._activation_generations_from_state(self.state).items():
            if generation > self.operation_queue.fence.current_activation(agent_id):
                self.operation_queue.advance_activation(agent_id, generation)

    def _agent_operation_fence(self, target: str) -> Dict[str, Any]:
        """Return the encounter fence for an active target, when enabled."""
        activation = self.state.metadata.get("activation", {})
        active = activation.get("agents", {}).get(target, {}) if isinstance(activation, dict) else {}
        generation = active.get("encounterGeneration") if isinstance(active, dict) else None
        if not isinstance(generation, int) or generation < 0:
            return {"generation": None, "key": None}
        return {"generation": generation, "key": target}

    def _persist_operation_audit(self, receipt: OperationReceipt) -> None:
        """Persist queue rejections without storing prompts or model output."""
        audit = receipt.audit
        if not audit or audit.get("kind") != "generation_fence_reject":
            return
        audit_id = audit.get("auditId")
        if audit_id in self._persisted_operation_audits:
            return
        writer = getattr(self.store, "save_audit", None)
        if callable(writer):
            writer(
                self.state.world_id,
                self.state.world_version,
                "generation_fence_reject",
                {
                    "kind": audit.get("kind"),
                    "reason": audit.get("reason"),
                    "stage": audit.get("stage"),
                    "operationId": audit.get("operationId"),
                    "inputSequence": audit.get("inputSequence"),
                    "expected": audit.get("expected"),
                    "current": audit.get("current"),
                },
            )
        self._persisted_operation_audits.add(audit_id)

    def _resolve_agent_operation(
        self,
        operation_id: str,
        target: str,
        request_wrapper: AgentRequest,
        legacy_request: Event,
        working: WorldState,
    ) -> Any:
        """Run one provider call behind the FIFO generation-fenced queue."""
        authored = story_response(working, target, legacy_request)
        if authored is not None:
            from .resolver import AgentProposal
            return AgentProposal(target, "answer", "YOU", authored)
        self._sync_operation_fence()
        fence = self._agent_operation_fence(target)
        snapshot = self.operation_queue.fence.snapshot()
        queued = self.operation_queue.enqueue(
            operation_id,
            request_wrapper.as_dict(),
            world_generation=snapshot.world_generation,
            activation_generation=fence["generation"],
            activation_key=fence["key"],
            actor_id=target,
        )
        if not queued.accepted:
            self._persist_operation_audit(queued)
            raise WorldError("model operation was rejected by the generation fence", "stale_generation_result", 409)
        operation = self.operation_queue.start(operation_id)
        if operation is None:
            # This can only happen when another caller owns the FIFO head.  A
            # deterministic local fallback keeps the synchronous path usable.
            cancelled = self.operation_queue.cancel(operation_id, "queue_busy")
            self._persist_operation_audit(cancelled)
            raise WorldError("model operation queue is busy", "operation_queue_busy", 409)
        try:
            if callable(getattr(self.agent, "propose_request", None)):
                response = self.agent.propose_request(request_wrapper)
            else:
                try:
                    response = self.agent.propose(target, request_wrapper, working)
                except (TypeError, AttributeError):
                    response = self.agent.propose(target, legacy_request, working)
        except Exception:
            self.operation_queue.cancel(operation_id, "provider_error")
            raise
        current = self.operation_queue.fence.snapshot()
        completed = self.operation_queue.complete(
            operation_id,
            response,
            world_generation=current.world_generation,
            activation_generation=(current.activation(target) if fence["generation"] is not None else None),
        )
        if completed.status != "completed":
            self._persist_operation_audit(completed)
            raise WorldError("model operation result arrived after its world scope changed", "stale_generation_result", 409)
        return completed.result

    def snapshot(self, viewer: str = "YOU") -> Dict[str, Any]:
        return self._snapshot_for_state(self.state, viewer)

    def _snapshot_for_state(self, state: WorldState, viewer: str = "YOU") -> Dict[str, Any]:
        viewer = canonical_id(viewer) or "YOU"
        viewer_state = state.agents.get(viewer) or state.agents.get("YOU")
        viewer_room = viewer_state.room_id if viewer_state else state.room_id
        visible_agents = [
            item for item in state.present
            if item in state.agents and state.agents[item].room_id == viewer_room
        ]
        relationships = {}
        for key, relation in state.relationships.items():
            members = set(key.split(":", 1))
            visibility = relation.get("visibility", "members") if isinstance(relation, dict) else "members"
            audience = set(relation.get("audience", [])) if isinstance(relation, dict) else set()
            if visibility == "public" and viewer in ("YOU", "PLAYER_DOLL"):
                relationships[key] = copy.deepcopy(relation)
            elif viewer in members or viewer in audience or viewer in ("YOU", "PLAYER_DOLL") and visibility != "private":
                relationships[key] = copy.deepcopy(relation)
        return {
            "schemaVersion": self.schema_version,
            "worldId": state.world_id,
            "worldVersion": state.world_version,
            "roomId": state.room_id,
            "present": visible_agents,
            "environment": copy.deepcopy(state.environment),
            "objects": copy.deepcopy(state.objects),
            "agents": {
                item: {
                    "id": item,
                    "kind": state.agents[item].profile.kind,
                    "controller": state.agents[item].profile.agent_id,
                    "roomId": state.agents[item].room_id,
                    "memory": copy.deepcopy(state.agents[item].memory) if item == viewer else [],
                    "capabilities": list(state.agents[item].profile.outgoing),
                }
                for item in visible_agents
            },
            "relationships": relationships,
            "eventHead": state.event_head,
            "clock": clock_snapshot(state.metadata) if state.metadata.get("clock") else None,
            "presenceProjections": copy.deepcopy(state.metadata.get("presenceProjections", {})),
            "activations": copy.deepcopy(state.metadata.get("activation", {}).get("agents", {})),
            "metadata": copy.deepcopy(state.metadata) if viewer in ("YOU", "PLAYER_DOLL") else {},
            "publishedRegistry": self._published_registry().to_dict(),
        }

    def _published_registry(self) -> PublishedRegistry:
        raw = self.state.metadata.get("publishedRegistry")
        return PublishedRegistry.from_dict(raw) if isinstance(raw, dict) else PublishedRegistry()

    def create_world_draft(self, raw: Dict[str, Any], draft_id: Optional[str] = None) -> Dict[str, Any]:
        return self.world_builder.create_draft(raw, draft_id)

    def world_draft(self, draft_id: str) -> Dict[str, Any]:
        return self.world_builder.get_draft(draft_id)

    def publish_world_draft(self, draft_id: str, expected_version: Optional[int] = None) -> Dict[str, Any]:
        return self.world_builder.publish(draft_id, expected_version)

    def cancel_world_draft(self, draft_id: str) -> Dict[str, Any]:
        return self.world_builder.cancel(draft_id)

    def submit_tool(self, raw: Dict[str, Any]) -> Dict[str, Any]:
        """Validate and resolve a tool, persisting redacted rejection audits."""
        try:
            return self._submit_tool(raw)
        except WorldError as error:
            writer = getattr(self.store, "save_audit", None)
            if callable(writer):
                encoded = json.dumps(raw, ensure_ascii=False, sort_keys=True, default=str).encode("utf-8") if isinstance(raw, dict) else repr(raw).encode("utf-8")
                writer(
                    self.state.world_id,
                    self.state.world_version,
                    "tool_proposal_rejected",
                    {
                        "reason": error.code,
                        "actor": raw.get("actor", "YOU") if isinstance(raw, dict) else None,
                        "toolId": raw.get("toolId", raw.get("tool_id")) if isinstance(raw, dict) else None,
                        "inputHash": hashlib.sha256(encoded).hexdigest(),
                        "registryVersion": self._published_registry().version,
                    },
                )
            raise

    def _submit_tool(self, raw: Dict[str, Any]) -> Dict[str, Any]:
        """Validate and atomically resolve one fixed primitive tool proposal."""
        if not isinstance(raw, dict):
            raise ValidationError("tool proposal must be an object", "invalid_tool_proposal")
        actor = canonical_id(raw.get("actor", "YOU"))
        if actor not in ("YOU", "PLAYER_DOLL"):
            raise PermissionDenied("tool proposals must be submitted as YOU", "player_cannot_control_npc")
        tool_id = raw.get("toolId", raw.get("tool_id"))
        if not isinstance(tool_id, str):
            raise ValidationError("toolId is required", "invalid_tool_id")
        args = raw.get("args", {})
        normalized = PrimitiveRegistry.validate_args(tool_id, args)
        registry = self._published_registry()
        entity_id = normalized.get("entityId")
        entity = None
        if entity_id is not None:
            spec, entity = registry.validate_affordance(tool_id, entity_id)
            player_location = {"roomId": self.state.agents["YOU"].room_id, "zoneId": self.state.metadata.get("playerZoneId")}
            runtime_entity = self.state.objects.get(entity_id, {})
            entity_room = runtime_entity.get("roomId", entity.location.get("roomId"))
            entity_zone = runtime_entity.get("zoneId", entity.location.get("zoneId"))
            if entity_room != player_location["roomId"] or (entity_zone is not None and entity_zone != player_location["zoneId"]):
                raise ValidationError("entity is outside the current interest scope", "entity_out_of_range")
            if tool_id == "use_object":
                allowed = runtime_entity.get("actions", entity.state.get("actions", []))
                if normalized.get("verb") not in allowed:
                    raise ValidationError("entity does not support this action", "unsupported_object_action")
        key = raw.get("idempotencyKey", raw.get("idempotency_key"))
        if key:
            prior = self.store.get_idempotent(self.state.world_id, key)
            if prior:
                if not self._requests_match(prior[0], raw):
                    raise WorldError("idempotency key was already used by another request", "idempotency_conflict", 409)
                return prior[1]
        expected = raw.get("expectedVersion", raw.get("expected_version"))
        if expected is not None and expected != self.state.world_version:
            raise VersionConflict("expectedVersion does not match current worldVersion")
        turn_id = str(raw.get("turnId") or key or "tool-" + str(self.state.world_version + 1))
        previous = self.state.world_version
        working = self.state.clone()
        spec = PrimitiveRegistry.get(tool_id)
        preconditions = {"actor": actor, "location": {"roomId": working.agents["YOU"].room_id, "zoneId": working.metadata.get("playerZoneId")}}
        payload = {
            "eventType": "tool_event",
            "toolId": tool_id,
            "toolVersion": spec.version,
            "registryVersion": registry.version,
            "normalizedArgs": normalized,
            "preconditions": preconditions,
            "resolver": spec.resolver,
            "resolverVersion": "environment-1",
        }
        if tool_id == "move":
            room = normalized["roomId"]
            if room == working.agents["YOU"].room_id:
                raise ValidationError("YOU is already in that room", "already_in_room")
            working.room_id = room
            working.agents["YOU"].room_id = room
            working.metadata["playerZoneId"] = normalized.get("zoneId")
        elif tool_id in ("use_object", "toggle") and entity_id:
            verb = normalized.get("verb")
            if tool_id == "toggle":
                actions = entity.state.get("actions", []) if entity else []
                verb = "off" if working.objects.get(entity_id, {}).get("lastAction") == "on" else "on"
                if verb not in actions:
                    raise ValidationError("entity cannot be toggled", "unsupported_object_action")
            payload["verb"] = verb
            working.objects.setdefault(entity_id, {}).update({"lastAction": verb})
            if entity_id == "lamp" and verb in ("on", "off"):
                working.environment["light"] = "bright" if verb == "on" else "off"
        elif tool_id == "wait":
            payload["minutes"] = normalized["minutes"]
        elif tool_id in ("operate_vehicle", "board", "travel", "alight") and entity_id:
            mobility = resolve_mobility(tool_id, normalized, working, entity)
            payload.update(mobility.to_payload())
        payload["text"] = self.environment.feedback(Event("tool-preview", previous, turn_id, "YOU", tool_id, None, "environment", payload, ["YOU"], "environment"), working, stable_seed(turn_id, "ENV")).get("text")
        event = make_event(turn_id, previous + 1, 0, "YOU", tool_id, entity_id, "public", payload, self._room_audience(working, working.agents["YOU"].room_id), "player_doll", stable_seed(turn_id, "YOU"))
        env_payload = {"text": payload["text"], "toolId": tool_id, "toolVersion": spec.version, "registryVersion": registry.version, "resolver": spec.resolver, "normalizedArgs": normalized}
        if "mobility" in payload:
            env_payload["mobility"] = copy.deepcopy(payload["mobility"])
        env_event = make_event(turn_id, previous + 1, 1, "ENV", "feedback", entity_id, "environment", env_payload, self._room_audience(working, working.agents["YOU"].room_id), "environment", stable_seed(turn_id, "ENV"))
        events = [event, env_event]
        working.world_version = previous + 1
        working.event_head = env_event.event_id
        result = self._result(turn_id, events, working)
        self.store.save_turn(previous, working, events, raw, result, key)
        self.state = working
        return result

    @staticmethod
    def _room_audience(state: WorldState, room_id: str) -> List[str]:
        """Return active entities that can observe a public room event."""
        audience = [
            item for item in state.present
            if item in state.agents and state.agents[item].room_id == room_id
        ]
        # DOLL is the player's execution identity rather than a visible body,
        # so it observes the same public room as YOU.
        if "PLAYER_DOLL" in state.agents:
            audience.append("PLAYER_DOLL")
        # The environment is a logical observer even though it has no room UI.
        if "ENV" in state.agents:
            audience.append("ENV")
        return list(dict.fromkeys(audience))

    def _request_event(self, proposal: ActionProposal, target: Optional[str], turn_id: str, version: int, index: int, state: Optional[WorldState] = None) -> Event:
        state = state or self.state
        room_id = state.agents["YOU"].room_id
        audience = self._room_audience(state, room_id) if proposal.channel == "public" else ["YOU", "PLAYER_DOLL", target]
        payload = {"text": proposal.text, **proposal.payload}
        payload.setdefault("roomId", room_id)
        return make_event(
            turn_id, version, index, "YOU", proposal.action, target, proposal.channel,
            payload, audience, "player_doll", stable_seed(turn_id, "YOU"),
        )

    def _response_event(self, proposal: Any, request: Event, turn_id: str, version: int, index: int, state: Optional[WorldState] = None) -> Event:
        state = state or self.state
        validate_agent_response(proposal.actor, proposal.action, proposal.target, proposal.text, state)
        audience = ["YOU", "PLAYER_DOLL", proposal.actor]
        if request.channel == "public":
            audience = self._room_audience(state, request.payload.get("roomId", state.agents["YOU"].room_id))
        return make_event(turn_id, version, index, proposal.actor, proposal.action, "YOU", request.channel, {"text": proposal.text}, audience, proposal.source, stable_seed(turn_id, proposal.actor))

    def _apply_event_state(self, event: Event, state: Optional[WorldState] = None) -> None:
        state = state or self.state
        if event.actor == "YOU" and event.action == "move":
            room = event.payload.get("roomId", event.payload.get("room", state.room_id))
            if isinstance(room, str) and room:
                state.room_id = room
                state.agents["YOU"].room_id = room
        if event.actor == "YOU" and event.action == "use":
            object_id = event.payload.get("object", event.payload.get("objectId"))
            verb = event.payload.get("verb", "touch")
            if object_id in state.objects:
                state.objects[object_id]["lastAction"] = verb
                if verb in ("open", "close"):
                    state.objects[object_id]["isOpen"] = verb == "open"
                if object_id == "lamp" and verb in ("on", "off"):
                    state.environment["light"] = "bright" if verb == "on" else "off"
        if event.actor in state.agents and event.action == "leave":
            if event.actor in state.present:
                state.present.remove(event.actor)
            state.agents[event.actor].active = False
        if event.actor in state.agents and event.action == "accept" and event.actor not in state.present:
            state.present.append(event.actor)
            state.agents[event.actor].active = True

    def _update_relationship(self, event: Event, state: Optional[WorldState] = None) -> None:
        state = state or self.state
        if event.actor not in state.agents or not event.target or event.target not in state.agents:
            return
        members = sorted((event.actor, event.target))
        key = ":".join(members)
        relation = state.relationships.setdefault(key, {"trust": 0, "tension": 0, "lastEvent": None})
        if event.action in ("deny", "lie", "counter", "refuse"):
            relation["tension"] += 1
        elif event.action in ("answer", "accept"):
            relation["trust"] += 1
        relation["lastEvent"] = event.event_id

    def _result(self, turn_id: str, events: List[Event], state: WorldState) -> Dict[str, Any]:
        return {
            "turnId": turn_id,
            "status": "committed",
            "worldVersion": state.world_version,
            "events": [event.to_dict() for event in events],
            "snapshot": self._snapshot_for_state(state),
            "source": "local",
        }

    def _save_transition(self, previous_version: int, state: WorldState, events: List[Event]) -> None:
        """Commit a lifecycle snapshot through the same CAS boundary as turns."""
        saver = getattr(self.store, "save_transition", None)
        if callable(saver):
            saver(previous_version, state, events)
            self.state = state
            self._sync_operation_fence()
            return
        # Stores from the early adapter may not have the lifecycle method.  The
        # in-memory state remains correct, while production EventStore is used
        # by the HTTP service and persists the transition.
        self.state = state
        self._sync_operation_fence()

    def _lifecycle_event(self, action: str, turn_id: str, version: int, payload: Dict[str, Any], index: int = 0) -> Event:
        return make_event(
            turn_id,
            version,
            index,
            "ENV",
            action,
            None,
            "system",
            payload,
            ["YOU", "PLAYER_DOLL"],
            "system",
            stable_seed(turn_id, action),
        )

    def _ensure_lifecycle_metadata(self) -> None:
        self.state.metadata.setdefault("clock", default_clock())
        self.state.metadata.setdefault("schedules", {"version": 0, "blocks": []})
        self.state.metadata.setdefault("presenceProjections", {})
        activation = self.state.metadata.setdefault("activation", {"leases": {}, "agents": {}})
        activation.setdefault("leases", {})
        activation.setdefault("agents", {})
        activation["enabled"] = True

    def _validate_activation_targets(self, targets: List[str], now: Optional[float] = None) -> Dict[str, Dict[str, Any]]:
        """Require a live lease once the lifecycle subsystem is in use."""
        activation = self.state.metadata.get("activation")
        if not isinstance(activation, dict):
            return {}
        now_value = time.time() if now is None else float(now)
        leases = activation.get("leases", {})
        active_agents = activation.get("agents", {})
        player = self.state.agents.get("YOU")
        player_room = player.room_id if player else self.state.room_id
        guards: Dict[str, Dict[str, Any]] = {}
        for target in targets:
            active = active_agents.get(target) if isinstance(active_agents, dict) else None
            valid = None
            for lease in leases.values() if isinstance(leases, dict) else []:
                if target in lease.get("agentIds", []) and lease.get("roomId") == player_room and float(lease.get("expiresAt", 0)) > now_value and lease.get("token") == (active or {}).get("leaseToken") and lease.get("generation") == (active or {}).get("leaseGeneration"):
                    valid = lease
                    break
            if not valid or not isinstance(active, dict) or active.get("status") != "active":
                raise PermissionDenied("target requires an active interest lease", "activation_required", 409)
            guards[target] = {"generation": valid.get("generation"), "token": valid.get("token")}
        return guards

    def _activation_guard_valid(self, target: str, guard: Dict[str, Any], now: Optional[float] = None) -> bool:
        now_value = time.time() if now is None else float(now)
        activation = self.state.metadata.get("activation", {})
        active = activation.get("agents", {}).get(target, {})
        if active.get("status") != "active":
            return False
        for lease in activation.get("leases", {}).values():
            if target in lease.get("agentIds", []) and float(lease.get("expiresAt", 0)) > now_value and lease.get("generation") == guard.get("generation") and lease.get("token") == guard.get("token"):
                return True
        return False

    def advance_world(self, now: Optional[float] = None, reason: str = "tick") -> Dict[str, Any]:
        """Advance the server clock and deterministic presence projections."""
        self._ensure_lifecycle_metadata()
        previous_version = self.state.world_version
        working = self.state.clone()
        clock, clock_changed = advance_clock(working.metadata, now)
        projections, changed = project_presence(working, clock)
        lifecycle = reconcile_leases(working, clock, now, reason="lease_expired" if reason == "tick" else "projection_changed")
        events: List[Event] = []
        lifecycle_turn_id = f"clock-{clock['clockVersion']}-v{previous_version + 1}"
        expired_passage = expire_story(working, clock)
        if expired_passage:
            events.append(self._lifecycle_event("chapter_completed", lifecycle_turn_id, previous_version + 1,
                                                {"ending": "missed", "text": expired_passage}, len(events)))
        reconciliation = reconcile_story(working, clock)
        if reconciliation:
            events.append(self._lifecycle_event("chapter_reconciled", lifecycle_turn_id, previous_version + 1,
                                                reconciliation, len(events)))
        if clock_changed:
            events.append(self._lifecycle_event("clock_advanced", lifecycle_turn_id, previous_version + 1, {"clock": clock, "reason": reason}, len(events)))
        if changed:
            for index, item in enumerate(changed, start=len(events)):
                events.append(self._lifecycle_event("presence_projected", lifecycle_turn_id, previous_version + 1, item, index))
        for item in lifecycle.get("started", []):
            events.append(self._lifecycle_event("activation_started", lifecycle_turn_id, previous_version + 1, item, len(events)))
        for item in lifecycle.get("transitions", []):
            events.append(self._lifecycle_event("activation_quiescing", lifecycle_turn_id, previous_version + 1, item, len(events)))
            events.append(self._lifecycle_event("activation_stopped", lifecycle_turn_id, previous_version + 1, item, len(events)))
        if lifecycle.get("expiredSessions"):
            events.append(self._lifecycle_event("activation_expired", lifecycle_turn_id, previous_version + 1, {"sessions": lifecycle["expiredSessions"]}, len(events)))
        if events:
            working.world_version = previous_version + 1
            working.event_head = events[-1].event_id
        self._save_transition(previous_version, working, events)
        return {"clock": clock, "presenceProjections": projections, "events": [event.to_dict() for event in events], "worldVersion": working.world_version}

    def world_clock(self, now: Optional[float] = None) -> Dict[str, Any]:
        self._ensure_lifecycle_metadata()
        # Read-only callers still receive a current clock, but do not create a
        # world event.  Tick/interest commits the projection explicitly.
        return clock_snapshot(self.state.metadata, now)

    def update_interest(
        self,
        session_id: str,
        room_id: str,
        zone_id: Optional[str] = None,
        ttl_seconds: int = 90,
        now: Optional[float] = None,
        lease_generation: Optional[int] = None,
        lease_token: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Enter an interest scope and lazily activate matching projections."""
        if room_id not in ROOM_IDS:
            raise ValidationError("room is not registered", "unknown_room")
        self.advance_world(now, reason="interest")
        previous_version = self.state.world_version
        working = self.state.clone()
        clock = clock_snapshot(working.metadata, now)
        result = interest_update(
            working,
            session_id,
            room_id,
            zone_id,
            ttl_seconds,
            clock,
            now,
            lease_generation,
            lease_token,
        )
        events: List[Event] = []
        if result["started"]:
            turn_id = f"interest-{session_id}-{clock['clockVersion']}-v{previous_version + 1}"
            for index, item in enumerate(result["started"]):
                events.append(self._lifecycle_event("activation_started", turn_id, previous_version + 1, item, index))
        if result["stopped"]:
            turn_id = f"interest-{session_id}-{clock['clockVersion']}-v{previous_version + 1}"
            for item in result["stopped"]:
                events.append(self._lifecycle_event("activation_quiescing", turn_id, previous_version + 1, item, len(events)))
                events.append(self._lifecycle_event("activation_stopped", turn_id, previous_version + 1, item, len(events)))
        if result["expiredSessions"]:
            turn_id = f"interest-expire-{clock['clockVersion']}"
            events.append(self._lifecycle_event("activation_expired", turn_id, previous_version + 1, {"sessions": result["expiredSessions"]}, len(events)))
        if events:
            working.world_version = previous_version + 1
            working.event_head = events[-1].event_id
        self._save_transition(previous_version, working, events)
        return {
            "clock": clock,
            "lease": result["lease"],
            "activated": result["started"],
            "deactivated": result["stopped"],
            "expiredSessions": result["expiredSessions"],
            "presenceProjections": working.metadata.get("presenceProjections", {}),
            "worldVersion": working.world_version,
            "events": [event.to_dict() for event in events],
        }

    def heartbeat(self, session_id: str, ttl_seconds: int = 90, now: Optional[float] = None, lease_generation: Optional[int] = None, lease_token: Optional[str] = None) -> Dict[str, Any]:
        self._ensure_lifecycle_metadata()
        lease = self.state.metadata.get("activation", {}).get("leases", {}).get(session_id)
        if not lease:
            raise WorldError("interest lease is not available", "unknown_interest", 409)
        now_value = time.time() if now is None else float(now)
        if float(lease.get("expiresAt", 0)) <= now_value:
            # Expiry is a state transition. Reconcile it before rejecting the
            # stale heartbeat so the old lease cannot be revived by a retry.
            self.advance_world(now, reason="lease_expired")
            raise WorldError("interest lease has expired", "expired_interest", 409)
        return self.update_interest(
            session_id,
            lease["roomId"],
            lease.get("zoneId"),
            ttl_seconds,
            now,
            lease_generation if lease_generation is not None else lease.get("generation"),
            lease_token if lease_token is not None else lease.get("token"),
        )

    def audit(self, now: Optional[float] = None) -> Dict[str, Any]:
        self._ensure_lifecycle_metadata()
        self.advance_world(now, reason="audit")
        report = audit_state(self.state)
        self.state.metadata["lastAudit"] = report
        # Observer output is diagnostic data, not a world mutation. Persist a
        # redacted, versioned report so operators can replay what was seen
        # without advancing the authoritative world version or exposing model
        # prompts/private memory.
        writer = getattr(self.store, "save_audit", None)
        if callable(writer):
            payload = {
                "observerVersion": report.get("observerVersion", "deterministic-1"),
                "worldVersion": self.state.world_version,
                "ok": bool(report.get("ok")),
                "issues": copy.deepcopy(report.get("issues", [])),
            }
            digest = hashlib.sha256(json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()
            payload["reportHash"] = digest
            writer(self.state.world_id, self.state.world_version, "world_observer_report", payload)
        return report

    @staticmethod
    def _requests_match(left: Dict[str, Any], right: Dict[str, Any]) -> bool:
        """Compare retries while ignoring lifecycle-only draft metadata."""
        a = dict(left)
        b = dict(right)
        a.pop("draft", None)
        b.pop("draft", None)
        # A draft may have received a generated turnId during confirmation;
        # absence in the original request is not a semantic change.
        if "turnId" not in left or "turnId" not in right:
            a.pop("turnId", None)
            b.pop("turnId", None)
        return a == b

    def submit_turn(self, raw: Dict[str, Any]) -> Dict[str, Any]:
        validation_state = self.state
        if isinstance(raw.get("payload"), dict) and "gameMinutes" in raw["payload"]:
            validation_state = self.state.clone()
            project_presence(validation_state, clock_snapshot(validation_state.metadata))
        proposal = normalize_player_action(raw, validation_state)
        self._sync_operation_fence()
        key = proposal.idempotency_key
        if key:
            prior = self.store.get_idempotent(self.state.world_id, key)
            if prior:
                old_request, old_result = prior
                if not self._requests_match(old_request, raw):
                    raise WorldError("idempotency key was already used by another request", "idempotency_conflict", 409)
                return old_result
        requested_turn_id = raw.get("turnId", raw.get("turn_id"))
        turn_lookup = getattr(self.store, "get_turn_result", None)
        if requested_turn_id and callable(turn_lookup):
            prior_turn = turn_lookup(self.state.world_id, str(requested_turn_id))
            if prior_turn:
                old_request, old_result = prior_turn
                if not self._requests_match(old_request, raw):
                    raise WorldError("turnId was already used by another request", "turn_conflict", 409)
                return old_result
        activation_guards = self._validate_activation_targets(proposal.targets)
        if raw.get("draft") is True:
            turn_id = str(raw.get("turnId") or raw.get("turn_id") or key or "turn-" + str(self.state.world_version + 1))
            pending = self._pending_turns.get(turn_id)
            if pending:
                return pending["result"]
            if proposal.expected_version is not None and proposal.expected_version != self.state.world_version:
                raise VersionConflict("expectedVersion does not match current worldVersion")
            committed_request = dict(raw)
            committed_request.pop("draft", None)
            committed_request["turnId"] = turn_id
            result = {
                "turnId": turn_id,
                "status": "draft",
                "worldVersion": self.state.world_version,
                "snapshot": self.snapshot(),
                "events": [],
                "proposal": {
                    "actor": proposal.actor,
                    "action": proposal.action,
                    "targets": list(proposal.targets),
                    "channel": proposal.channel,
                    "text": proposal.text,
                },
            }
            self._pending_turns[turn_id] = {"request": committed_request, "result": result}
            draft_writer = getattr(self.store, "save_draft", None)
            if callable(draft_writer):
                draft_writer(self.state.world_id, turn_id, committed_request, result)
            return result
        if proposal.expected_version is not None and proposal.expected_version != self.state.world_version:
            raise VersionConflict("expectedVersion does not match current worldVersion")
        turn_id = str(raw.get("turnId") or raw.get("turn_id") or key or "turn-" + str(self.state.world_version + 1))
        if turn_id in self._turn_results:
            return self._turn_results[turn_id]
        previous_version = self.state.world_version
        new_version = previous_version + 1
        working = self.state.clone()
        events: List[Event] = []
        for target in proposal.targets or [None]:
            request = self._request_event(proposal, target, turn_id, new_version, len(events), working)
            events.append(request)
            if target:
                context = build_context(working, target, events_for_viewer(events, target, working))
                try:
                    # New providers receive only the filtered AgentRequest.
                    # Keep the old three-argument hook for legacy local/test
                    # adapters during the staged migration.
                    request_wrapper = AgentRequest(
                        actor_id=target,
                        context=context,
                        trigger=request.to_dict(),
                        trace_id=f"{turn_id}:{target}",
                    )
                    response = self._resolve_agent_operation(
                        f"{turn_id}:agent:{target}",
                        target,
                        request_wrapper,
                        request,
                        working,
                    )
                    if target in activation_guards and not self._activation_guard_valid(target, activation_guards[target]):
                        raise WorldError("activation lease changed while resolving turn", "stale_activation_result", 409)
                    response_event = self._response_event(response, request, turn_id, new_version, len(events), working)
                except Exception:
                    # A broken/late model can never block the turn; deterministic refusal is safe.
                    fallback_audience = (
                        self._room_audience(working, working.agents["YOU"].room_id)
                        if request.channel == "public"
                        else ["YOU", "PLAYER_DOLL", target]
                    )
                    response_event = make_event(turn_id, new_version, len(events), target, "refuse", "YOU", request.channel, {"text": "我现在不想谈这个。"}, fallback_audience, "local", stable_seed(turn_id, target))
                events.append(response_event)
        for event in list(events):
            self._apply_event_state(event, working)
            self._update_relationship(event, working)
        env_events: List[Event] = []
        for event in events:
            if event.actor == "YOU" and event.action in ("move", "use", "observe"):
                feedback = self.environment.feedback(event, working, stable_seed(turn_id, "ENV"))
                room_id = working.agents["YOU"].room_id
                env_event = make_event(turn_id, new_version, len(events) + len(env_events), "ENV", "feedback", event.target, "environment", feedback, self._room_audience(working, room_id), "environment", stable_seed(turn_id, "ENV"))
                env_events.append(env_event)
        events.extend(env_events)
        minutes = proposal.payload.get("gameMinutes")
        if type(minutes) is int and 0 < minutes <= 120:
            started_clock = clock_snapshot(working.metadata)
            clock = spend_minutes(working, minutes)
            passage = advance_story(working, events[0], started_clock)
            _, presence_changes = project_presence(working, clock)
            lifecycle = reconcile_leases(working, clock, reason="projection_changed")
            events.append(self._lifecycle_event("clock_advanced", turn_id, new_version,
                                               {"clock": clock, "reason": "player_action", "minutes": minutes}, len(events)))
            for item in presence_changes:
                events.append(self._lifecycle_event("presence_projected", turn_id, new_version, item, len(events)))
            for item in lifecycle.get("started", []):
                events.append(self._lifecycle_event("activation_started", turn_id, new_version, item, len(events)))
            for item in lifecycle.get("transitions", []):
                events.append(self._lifecycle_event("activation_quiescing", turn_id, new_version, item, len(events)))
                events.append(self._lifecycle_event("activation_stopped", turn_id, new_version, item, len(events)))
            if passage:
                events.append(make_event(turn_id, new_version, len(events), "ENV", "feedback", None, "environment",
                                         {"text": passage, "chapterTransition": True}, ["YOU", "PLAYER_DOLL"], "local"))
        working.world_version = new_version
        working.event_head = events[-1].event_id if events else None
        write_memories(working, events)
        result = self._result(turn_id, events, working)
        try:
            self.store.save_turn(previous_version, working, events, raw, result, key)
        except sqlite3.IntegrityError:
            # Two identical requests racing on the same idempotency key must
            # converge on the first committed result, never duplicate events.
            if key:
                prior = self.store.get_idempotent(self.state.world_id, key)
                if prior and self._requests_match(prior[0], raw):
                    return prior[1]
            persisted_turn = turn_lookup(self.state.world_id, turn_id) if callable(turn_lookup) else None
            if persisted_turn and self._requests_match(persisted_turn[0], raw):
                return persisted_turn[1]
            raise
        self.state = working
        self._sync_operation_fence()
        self._turn_results[turn_id] = result
        return result

    def confirm_turn(self, turn_id: str, expected_version: Optional[int] = None) -> Dict[str, Any]:
        if turn_id in self._turn_results:
            return self._turn_results[turn_id]
        committed_reader = getattr(self.store, "get_turn_result", None)
        if callable(committed_reader):
            persisted = committed_reader(self.state.world_id, turn_id)
            if persisted:
                result = persisted[1]
                self._turn_results[turn_id] = result
                return result
        pending = self._pending_turns.get(turn_id)
        if pending:
            if expected_version is not None and expected_version != self.state.world_version:
                raise VersionConflict("expectedVersion does not match current worldVersion")
            result = self.submit_turn(pending["request"])
            self._pending_turns.pop(turn_id, None)
            draft_deleter = getattr(self.store, "delete_draft", None)
            if callable(draft_deleter):
                draft_deleter(self.state.world_id, turn_id)
            return result
        raise WorldError("turn is not available for confirmation", "unknown_turn", 409)

    def cancel_turn(self, turn_id: str) -> Dict[str, Any]:
        if turn_id in self._turn_results:
            raise WorldError("committed turns cannot be cancelled", "turn_already_committed", 409)
        if turn_id in self._pending_turns:
            self._pending_turns.pop(turn_id, None)
            draft_deleter = getattr(self.store, "delete_draft", None)
            if callable(draft_deleter):
                draft_deleter(self.state.world_id, turn_id)
            return {"turnId": turn_id, "status": "cancelled", "worldVersion": self.state.world_version}
        return {"turnId": turn_id, "status": "cancelled", "worldVersion": self.state.world_version}

    def events(self, after_version: int = 0, viewer: str = "YOU") -> List[Dict[str, Any]]:
        events = self.store.events(self.state.world_id, after_version)
        return [event.to_dict() for event in events if event.world_version <= self.state.world_version and events_for_viewer([event], viewer, self.state)]

    def replay(self) -> Dict[str, Any]:
        """Return stored state/events without invoking any Agent adapter."""
        persisted = self.store.load_state(self.state.world_id) or self.state
        return {"snapshot": WorldState.from_dict(persisted.to_dict()).to_dict(), "events": [event.to_dict() for event in self.store.events(self.state.world_id)]}
