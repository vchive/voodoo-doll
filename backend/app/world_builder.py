"""World-building draft lifecycle and versioned publication."""

from __future__ import annotations

from typing import Any, Dict, Mapping, Optional
import copy
import threading
import time
import uuid

from .domain.events import make_event, stable_seed
from .domain.models import ValidationError
from .tools.compiler import ToolCompiler
from .tools.registry import EntityDefinition, PublishedRegistry, SAFE_ID


class WorldBuilder:
    def __init__(self, kernel: Any):
        self.kernel = kernel
        self.compiler = ToolCompiler()
        self._lock = threading.RLock()

    @property
    def registry(self) -> PublishedRegistry:
        raw = self.kernel.state.metadata.get("publishedRegistry")
        if isinstance(raw, Mapping):
            return PublishedRegistry.from_dict(raw)
        return PublishedRegistry()

    def create_draft(self, raw: Mapping[str, Any], draft_id: Optional[str] = None) -> Dict[str, Any]:
        compiled = self.compiler.compile(raw, self.registry, agent_ids=self._agent_ids())
        identifier = "world-draft-" + uuid.uuid4().hex[:16] if draft_id is None else draft_id
        if not isinstance(identifier, str) or not SAFE_ID.fullmatch(identifier):
            raise ValidationError("world draft id is invalid", "invalid_world_draft_id")
        payload = {
            "draftId": identifier, "status": "draft", "createdAt": time.time(), "compiled": compiled,
            "baseWorldVersion": self.kernel.state.world_version, "baseRegistryVersion": self.registry.version,
        }
        self.kernel.store.save_world_draft(self.kernel.state.world_id, identifier, payload)
        return copy.deepcopy(payload)

    def _agent_ids(self) -> set:
        return {key for key, agent in self.kernel.state.agents.items() if agent.profile.kind == "person"}

    def _published_receipt(self, draft_id: str) -> Optional[Dict[str, Any]]:
        # The receipt shares the snapshot transaction with publication and
        # draft removal. It also recovers retries handled by another worker.
        state = self.kernel.store.load_state(self.kernel.state.world_id) or self.kernel.state
        for entry in state.metadata.get("worldBuilds", []):
            if entry.get("draftId") == draft_id:
                if "result" not in entry:
                    raise ValidationError("legacy world draft is already published", "world_draft_already_published", 409)
                if state.world_version > self.kernel.state.world_version:
                    self.kernel.state = state
                    self.kernel._sync_operation_fence()
                return copy.deepcopy(entry["result"])
        return None

    def get_draft(self, draft_id: str) -> Dict[str, Any]:
        draft = self.kernel.store.get_world_draft(self.kernel.state.world_id, draft_id)
        if draft is None:
            raise ValidationError("world draft is not available", "unknown_world_draft", 404)
        return copy.deepcopy(draft)

    def cancel(self, draft_id: str) -> Dict[str, Any]:
        version = self.kernel.store.delete_world_draft(self.kernel.state.world_id, draft_id)
        return {"draftId": draft_id, "status": "cancelled", "worldVersion": version}

    @staticmethod
    def _merge(existing: list, incoming: list) -> list:
        merged = {item["id"]: copy.deepcopy(item) for item in existing}
        merged.update({item["id"]: copy.deepcopy(item) for item in incoming})
        return [merged[key] for key in sorted(merged)]

    def _validate_compiled(self, compiled: Mapping[str, Any]) -> Dict[str, Any]:
        if compiled.get("compilerVersion") != self.compiler.version:
            raise ValidationError("world draft must be regenerated with the current compiler", "stale_compiler_version", 409)
        declaration = {key: copy.deepcopy(compiled.get(key, [])) for key in ("entities", "schedules", "encounters", "compoundActions")}
        for entity in declaration["entities"]:
            entity.pop("immutable", None)
        for action in declaration["compoundActions"]:
            action.pop("preflight", None)
        declaration.update(narrative=compiled.get("narrative"), metadata=compiled.get("metadata", {}))
        checked = self.compiler.compile(declaration, self.registry, agent_ids=self._agent_ids())
        if checked["draftHash"] != compiled.get("draftHash"):
            raise ValidationError("world draft content has changed", "world_draft_hash_mismatch", 409)
        return checked

    def publish(self, draft_id: str, expected_version: Optional[int] = None) -> Dict[str, Any]:
        with self._lock:
            return self._publish(draft_id, expected_version)

    def _publish(self, draft_id: str, expected_version: Optional[int]) -> Dict[str, Any]:
        receipt = self._published_receipt(draft_id)
        if receipt is not None:
            return receipt
        try:
            draft = self.get_draft(draft_id)
        except ValidationError:
            # Another connection may have committed after the receipt read.
            receipt = self._published_receipt(draft_id)
            if receipt is not None:
                return receipt
            raise
        previous = self.kernel.state.world_version
        working = self.kernel.state.clone()
        expected = draft.get("baseWorldVersion") if expected_version is None else expected_version
        if type(expected) is not int or expected != previous:
            raise ValidationError("expectedVersion does not match current worldVersion", "version_conflict", 409)
        if draft.get("baseRegistryVersion") != self.registry.version:
            raise ValidationError("world registry changed after preview", "registry_version_conflict", 409)
        compiled = self._validate_compiled(draft["compiled"])
        entities = []
        for raw in compiled.get("entities", []):
            location = raw["location"]
            entities.append(EntityDefinition(raw["id"], raw["type"], location, raw.get("state", {}), tuple(raw.get("affordances", [])), True))
        registry = self.registry.publish(entities)
        working.metadata["publishedRegistry"] = registry.to_dict()
        published = working.metadata.setdefault("publishedWorld", {})
        published["version"] = int(published.get("version", 0)) + 1
        schedules = working.metadata.get("schedules", {"version": 0, "blocks": []})
        if compiled["schedules"]:
            schedules = {"version": int(schedules.get("version", 0)) + 1, "blocks": self._merge(schedules.get("blocks", []), compiled["schedules"])}
            working.metadata["schedules"] = schedules
        published["schedules"] = copy.deepcopy(schedules)
        if compiled["encounters"]:
            encounters = published.get("encounters", working.metadata.get("encounters", {"version": 0, "items": []}))
            old_items = encounters.get("items", encounters.get("entries", [])) if isinstance(encounters, dict) else encounters
            old_version = encounters.get("version", 0) if isinstance(encounters, dict) else 0
            version = int(published.get("encounterVersion", old_version)) + 1
            published["encounters"] = {"version": version, "items": self._merge(old_items, compiled["encounters"])}
            published["encounterVersion"] = version
        if compiled["compoundActions"]:
            actions = published.get("compoundActions", {"version": 0, "items": []})
            old_items = actions.get("items", []) if isinstance(actions, dict) else actions
            old_version = actions.get("version", 0) if isinstance(actions, dict) else 0
            version = int(published.get("compoundActionVersion", old_version)) + 1
            published["compoundActions"] = {"version": version, "items": self._merge(old_items, compiled["compoundActions"])}
            published["compoundActionVersion"] = version
        # Resolvers prefer runtime fields to registry defaults. Rebuild every
        # explicitly published entity so old routes/kinds/locations cannot
        # override the confirmed definition; preserve compatible live state.
        for entity in entities:
            prior = working.objects.get(entity.entity_id, {})
            projection = copy.deepcopy(dict(entity.state))
            projection.update({
                "type": entity.entity_type,
                "roomId": entity.location.get("roomId"),
                "zoneId": entity.location.get("zoneId"),
                "affordances": list(entity.affordances),
                "state": copy.deepcopy(dict(entity.state)),
            })
            if entity.entity_type == "object" and prior.get("lastAction") in entity.state.get("actions", []):
                projection["lastAction"] = prior["lastAction"]
            working.objects[entity.entity_id] = projection
        turn_id = "world-build-" + draft_id
        event = make_event(turn_id, previous + 1, 0, "ENV", "world_registry_published", None, "system", {
            "draftId": draft_id, "registryVersion": registry.version,
            "primitiveVersion": compiled["primitiveVersion"], "compilerVersion": compiled["compilerVersion"],
            "draftHash": compiled["draftHash"], "declarations": {
                key: copy.deepcopy(compiled[key]) for key in ("entities", "schedules", "encounters", "compoundActions")
            },
            "scheduleVersion": schedules.get("version", 0), "encounterVersion": published.get("encounterVersion", 0),
            "compoundActionVersion": published.get("compoundActionVersion", 0),
        }, ["YOU", "PLAYER_DOLL"], "system", stable_seed(turn_id, "registry"))
        working.world_version = previous + 1
        working.event_head = event.event_id
        result = {
            "draftId": draft_id, "status": "published", "registry": registry.to_dict(),
            "publishedWorld": copy.deepcopy(published), "worldVersion": working.world_version, "events": [event.to_dict()],
        }
        working.metadata.setdefault("worldBuilds", []).append({
            "draftId": draft_id, "registryVersion": registry.version, "draftHash": compiled["draftHash"],
            "result": copy.deepcopy(result),
        })
        result, committed = self.kernel.store.publish_world_draft(draft_id, draft, previous, working, [event], result)
        self.kernel.state = committed
        self.kernel._sync_operation_fence()
        return result
