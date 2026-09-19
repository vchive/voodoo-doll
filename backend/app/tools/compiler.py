"""Declaration-only world-building compiler."""

from __future__ import annotations

from typing import Any, Dict, Mapping
import copy
import hashlib
import json
from ..domain.models import ROOM_IDS, ValidationError, default_profiles
from .registry import EntityDefinition, PrimitiveRegistry, PublishedRegistry, SAFE_ID
from .mobility import STATION_ROOMS


class ToolCompilationError(ValidationError):
    code = "tool_compilation_failed"


class ToolCompiler:
    """Compile model output into inert, versioned JSON declarations."""

    FORBIDDEN_KEYS = {"code", "source", "script", "command", "exec", "executable", "file", "filepath", "path", "network", "url", "http", "resolver", "callback", "plugin"}
    TOP_LEVEL = {"narrative", "rooms", "entities", "schedules", "encounters", "compoundActions", "metadata"}
    version = "tool-compiler-3"

    def __init__(self, primitives: type[PrimitiveRegistry] = PrimitiveRegistry):
        self.primitives = primitives

    def _walk_forbidden(self, value: Any, path: str = "draft", depth: int = 0) -> None:
        if depth > 24:
            raise ToolCompilationError("world draft is too deeply nested", "invalid_world_draft")
        if isinstance(value, Mapping):
            for key, child in value.items():
                if not isinstance(key, str):
                    raise ToolCompilationError("declaration keys must be strings", "invalid_world_draft")
                normalized = str(key).lower().replace("_", "")
                if normalized in {item.replace("_", "") for item in self.FORBIDDEN_KEYS}:
                    raise ToolCompilationError(f"field {path}.{key} is not allowed", "forbidden_tool_draft_field")
                self._walk_forbidden(child, f"{path}.{key}", depth + 1)
        elif isinstance(value, list):
            for index, child in enumerate(value):
                self._walk_forbidden(child, f"{path}[{index}]", depth + 1)
        elif isinstance(value, str):
            lowered = value.lower()
            if lowered.startswith(("http://", "https://", "file://")) or "open(" in lowered or "socket" in lowered:
                raise ToolCompilationError(f"external operation in {path} is not allowed", "forbidden_tool_draft_value")

    @staticmethod
    def _fields(value: Any, allowed: set, required: set, label: str) -> None:
        if not isinstance(value, Mapping) or set(value) - allowed or required - set(value):
            raise ToolCompilationError(f"invalid {label} fields", "invalid_declaration_fields")

    @staticmethod
    def _integer(value: Any, low: int, high: int, label: str) -> int:
        if type(value) is not int or not low <= value <= high:
            raise ToolCompilationError(f"invalid {label}", "invalid_declaration_range")
        return value

    @staticmethod
    def _id(value: Any) -> str:
        if not isinstance(value, str) or not SAFE_ID.fullmatch(value):
            raise ToolCompilationError("declaration id is invalid", "invalid_declaration_id")
        return value

    @staticmethod
    def _text(value: Any, limit: int, label: str) -> str:
        if not isinstance(value, str) or not value.strip() or len(value) > limit:
            raise ToolCompilationError(f"invalid {label}", "invalid_declaration_text")
        return value.strip()

    def _location(self, value: Any) -> Dict[str, Any]:
        self._fields(value, {"roomId", "zoneId"}, {"roomId"}, "location")
        if not isinstance(value["roomId"], str) or value["roomId"] not in ROOM_IDS:
            raise ToolCompilationError("room is not registered", "unknown_room")
        zone = value.get("zoneId")
        return {"roomId": value["roomId"], "zoneId": self._id(zone) if zone is not None else None}

    def _declarations(self, raw: Mapping[str, Any], key: str) -> list:
        values = raw.get(key, [])
        if not isinstance(values, list) or len(values) > 256:
            raise ToolCompilationError(f"{key} must be a bounded list", "invalid_declaration_list")
        seen = set()
        for item in values:
            if not isinstance(item, Mapping):
                raise ToolCompilationError(f"{key} item must be an object", "invalid_declaration_fields")
            identifier = self._id(item.get("id"))
            if identifier in seen:
                raise ToolCompilationError(f"duplicate {key} id", "duplicate_declaration_id")
            seen.add(identifier)
        return values

    def _schedule(self, item: Mapping[str, Any], agents: set) -> Dict[str, Any]:
        required = {"id", "agentId", "startMinute", "endMinute", "location"}
        self._fields(item, required | {"recurrence", "activity", "priority", "toleranceMinutes", "visibility"}, required, "schedule")
        if not isinstance(item["agentId"], str) or item["agentId"] not in agents:
            raise ToolCompilationError("schedule actor is not a registered person", "unknown_schedule_agent")
        recurrence = item.get("recurrence", {})
        self._fields(recurrence, {"kind", "days"}, set(), "recurrence")
        days = recurrence.get("days", list(range(1, 8)))
        if recurrence.get("kind", "daily") != "daily" or not isinstance(days, list) or not days or len(days) > 7:
            raise ToolCompilationError("unsupported recurrence", "invalid_recurrence")
        days = [self._integer(day, 1, 7, "weekday") for day in days]
        if len(days) != len(set(days)):
            raise ToolCompilationError("duplicate weekday", "invalid_recurrence")
        start = self._integer(item["startMinute"], 0, 1439, "start minute")
        end = self._integer(item["endMinute"], 1, 1440, "end minute")
        if start == end:
            raise ToolCompilationError("schedule interval is empty", "invalid_schedule_interval")
        if item.get("visibility", "public") != "public":
            raise ToolCompilationError("private schedule publication is not supported", "unsupported_schedule_visibility")
        tolerance = self._integer(item.get("toleranceMinutes", 0), 0, 1440, "tolerance")
        if tolerance:
            raise ToolCompilationError("schedule tolerance is not supported yet", "unsupported_schedule_tolerance")
        return {
            "id": item["id"], "agentId": item["agentId"],
            "recurrence": {"kind": "daily", "days": sorted(days)},
            "startMinute": start, "endMinute": end, "location": self._location(item["location"]),
            "activity": self._text(item.get("activity", "present"), 80, "activity"),
            "priority": self._integer(item.get("priority", 0), -1000, 1000, "priority"),
            "toleranceMinutes": tolerance,
            "visibility": "public",
        }

    def _encounter(self, item: Mapping[str, Any], agents: set) -> Dict[str, Any]:
        self._fields(item, {"id", "roomId", "zoneId", "agentIds", "weight", "summary"}, {"id", "roomId", "agentIds", "summary"}, "encounter")
        participants = item["agentIds"]
        if not isinstance(participants, list) or not participants or len(participants) > 25:
            raise ToolCompilationError("encounter participants are required", "invalid_encounter_agents")
        if any(not isinstance(agent, str) or agent not in agents for agent in participants) or len(set(participants)) != len(participants):
            raise ToolCompilationError("encounter actor is not a registered person", "invalid_encounter_agents")
        return {
            "id": item["id"], **self._location({"roomId": item["roomId"], "zoneId": item.get("zoneId")}),
            "agentIds": sorted(participants),
            "weight": self._integer(item.get("weight", 1), 1, 10000, "encounter weight"),
            "summary": self._text(item["summary"], 500, "encounter summary"),
        }

    def _entity_state(self, entity_type: str, state: Any, affordances: list) -> Dict[str, Any]:
        allowed_tools = {
            "object": {"look", "use_object", "toggle"},
            "vehicle": {"look", "operate_vehicle"},
            "transit": {"look", "board", "travel", "alight"},
        }
        if not set(affordances) <= allowed_tools[entity_type]:
            raise ToolCompilationError("affordance is incompatible with entity type", "invalid_entity_affordance")
        fields = {"object": {"actions"}, "vehicle": {"kind", "destinations"}, "transit": {"kind", "stations"}}[entity_type]
        required = fields if entity_type != "object" else ({"actions"} if {"use_object", "toggle"} & set(affordances) else set())
        self._fields(state, fields, required, "entity state")
        if entity_type == "object":
            actions = state.get("actions", [])
            verbs = {"on", "off", "toggle", "touch", "ring", "place", "clear", "open", "close", "knock", "look", "use"}
            if not isinstance(actions, list) or len(actions) > len(verbs) or any(not isinstance(verb, str) or verb not in verbs for verb in actions):
                raise ToolCompilationError("object actions must be registered verbs", "invalid_object_actions")
            if "use_object" in affordances and not actions:
                raise ToolCompilationError("use_object requires actions", "invalid_object_actions")
            if "toggle" in affordances and not {"on", "off"} <= set(actions):
                raise ToolCompilationError("toggle requires on and off", "invalid_object_actions")
            return {"actions": sorted(set(actions))}
        key = "destinations" if entity_type == "vehicle" else "stations"
        candidates = state[key]
        allowed = ROOM_IDS if entity_type == "vehicle" else STATION_ROOMS
        kinds = ("bicycle", "car", "vehicle") if entity_type == "vehicle" else ("metro", "train", "transit")
        if state["kind"] not in kinds:
            raise ToolCompilationError("invalid mobility kind", "invalid_mobility_entity")
        if not isinstance(candidates, list) or not candidates or len(candidates) > len(allowed) or any(not isinstance(value, str) or value not in allowed for value in candidates):
            raise ToolCompilationError("mobility route contains an unregistered destination", "unknown_destination")
        return {"kind": state["kind"], key: sorted(set(candidates))}

    @staticmethod
    def _entity_location(entity: EntityDefinition, runtime_locations: Mapping[str, Mapping[str, Any]]) -> Dict[str, Any]:
        location = runtime_locations.get(entity.entity_id, entity.location)
        return {"roomId": location.get("roomId"), "zoneId": location.get("zoneId")}

    @staticmethod
    def _same_scope(left: Mapping[str, Any], right: Mapping[str, Any]) -> bool:
        if left.get("roomId") != right.get("roomId"):
            return False
        entity_zone = right.get("zoneId")
        return entity_zone is None or left.get("zoneId") == entity_zone

    def _compound_action(self, item: Mapping[str, Any], agents: set, entities: Mapping[str, EntityDefinition]) -> Dict[str, Any]:
        required = {"id", "actorId", "summary", "startLocation", "steps"}
        self._fields(item, required, required, "compound action")
        actor_id = item["actorId"]
        if not isinstance(actor_id, str) or actor_id not in agents:
            raise ToolCompilationError("compound action actor is not registered", "unknown_compound_actor")
        steps = item["steps"]
        if not isinstance(steps, list) or not steps or len(steps) > 32:
            raise ToolCompilationError("compound action steps are required", "invalid_compound_steps")

        location = self._location(item["startLocation"])
        runtime_locations: Dict[str, Dict[str, Any]] = {}
        active_transit: str | None = None
        active_station: str | None = None
        seen_steps = set()
        compiled_steps = []
        touched_entities = set()

        for raw_step in steps:
            self._fields(raw_step, {"id", "toolId", "args"}, {"id", "toolId", "args"}, "compound step")
            step_id = self._id(raw_step["id"])
            if step_id in seen_steps:
                raise ToolCompilationError("duplicate compound step id", "duplicate_compound_step_id")
            seen_steps.add(step_id)
            tool_id = raw_step["toolId"]
            if not isinstance(tool_id, str):
                raise ToolCompilationError("compound tool id is invalid", "invalid_tool_id")
            args = self.primitives.validate_args(tool_id, raw_step["args"])
            entity_id = args.get("entityId")
            entity = None
            if entity_id is not None:
                entity = entities.get(entity_id)
                if entity is None:
                    raise ToolCompilationError("compound action references an unpublished entity", "unknown_entity")
                if tool_id not in entity.affordances:
                    raise ToolCompilationError("compound action uses an unsupported affordance", "unsupported_affordance")
                touched_entities.add(entity_id)

            if tool_id == "move":
                if active_transit is not None:
                    raise ToolCompilationError("compound action cannot move while boarded", "compound_transit_active")
                location = {"roomId": args["roomId"], "zoneId": args.get("zoneId")}
            elif tool_id == "operate_vehicle" and entity is not None:
                if active_transit is not None:
                    raise ToolCompilationError("compound action cannot operate a vehicle while boarded", "compound_transit_active")
                entity_location = self._entity_location(entity, runtime_locations)
                if not self._same_scope(location, entity_location):
                    raise ToolCompilationError("vehicle is outside the compound action scope", "compound_entity_out_of_range")
                kind = str(entity.state.get("kind", ""))
                destination = args["destinationId"]
                destinations = entity.state.get("destinations", [])
                if kind not in {"bicycle", "car", "vehicle"} or destination not in destinations:
                    raise ToolCompilationError("compound vehicle route is not executable", "invalid_compound_route")
                location = {"roomId": destination, "zoneId": None}
                runtime_locations[entity_id] = copy.deepcopy(location)
            elif tool_id == "board" and entity is not None:
                if active_transit is not None:
                    raise ToolCompilationError("compound action already has active transit", "compound_transit_active")
                entity_location = self._entity_location(entity, runtime_locations)
                station_id = args["stationId"]
                stations = entity.state.get("stations", [])
                if not self._same_scope(location, entity_location):
                    raise ToolCompilationError("transit is outside the compound action scope", "compound_entity_out_of_range")
                if str(entity.state.get("kind", "")) not in {"metro", "train", "transit"} or station_id not in stations or STATION_ROOMS.get(station_id) != location["roomId"]:
                    raise ToolCompilationError("compound boarding step is not executable", "invalid_compound_station")
                active_transit = entity_id
                active_station = station_id
            elif tool_id == "travel" and entity is not None:
                destination = args["destinationId"]
                if active_transit != entity_id:
                    raise ToolCompilationError("compound action must board before travel", "compound_transit_not_boarded")
                if destination not in entity.state.get("stations", []) or destination not in STATION_ROOMS or destination == active_station:
                    raise ToolCompilationError("compound transit route is not executable", "invalid_compound_route")
                active_station = destination
            elif tool_id == "alight" and entity is not None:
                station_id = args["stationId"]
                if active_transit != entity_id or station_id != active_station or station_id not in STATION_ROOMS:
                    raise ToolCompilationError("compound alighting step is not executable", "invalid_compound_station")
                location = {"roomId": STATION_ROOMS[station_id], "zoneId": "platform"}
                runtime_locations[entity_id] = copy.deepcopy(location)
                active_transit = None
                active_station = None
            elif entity is not None:
                entity_location = self._entity_location(entity, runtime_locations)
                if not self._same_scope(location, entity_location):
                    raise ToolCompilationError("entity is outside the compound action scope", "compound_entity_out_of_range")
                if tool_id == "use_object" and args.get("verb") not in entity.state.get("actions", []):
                    raise ToolCompilationError("compound object action is unsupported", "unsupported_object_action")
                if tool_id == "toggle" and not {"on", "off"} <= set(entity.state.get("actions", [])):
                    raise ToolCompilationError("compound object cannot be toggled", "unsupported_object_action")

            compiled_steps.append({"id": step_id, "toolId": tool_id, "args": copy.deepcopy(args)})

        if active_transit is not None:
            raise ToolCompilationError("compound action must alight before it ends", "compound_transit_incomplete")
        return {
            "id": item["id"],
            "actorId": actor_id,
            "summary": self._text(item["summary"], 500, "compound action summary"),
            "startLocation": self._location(item["startLocation"]),
            "steps": compiled_steps,
            "preflight": {
                "stepCount": len(compiled_steps),
                "endLocation": copy.deepcopy(location),
                "touchedEntityIds": sorted(touched_entities),
            },
        }

    def compile(self, raw: Mapping[str, Any], published: PublishedRegistry, *, agent_ids: Any = None) -> Dict[str, Any]:
        if not isinstance(raw, Mapping):
            raise ToolCompilationError("world draft must be an object", "invalid_world_draft")
        self._walk_forbidden(raw)
        try:
            encoded_raw = json.dumps(raw, ensure_ascii=False, allow_nan=False)
        except (TypeError, ValueError) as exc:
            raise ToolCompilationError("world draft must contain JSON data", "invalid_world_draft") from exc
        if len(encoded_raw.encode("utf-8")) > 262144:
            raise ToolCompilationError("world draft is too large", "invalid_world_draft")
        unknown_top = set(raw) - self.TOP_LEVEL
        if unknown_top:
            raise ToolCompilationError("world draft contains unknown fields", "unknown_world_draft_field")
        narrative = raw.get("narrative")
        if not isinstance(narrative, str) or not narrative.strip() or len(narrative) > 12000:
            raise ToolCompilationError("narrative is required", "invalid_narrative")
        if raw.get("rooms", []) != []:
            raise ToolCompilationError("new room definitions are not supported yet", "unsupported_room_declaration")
        if not isinstance(raw.get("metadata", {}), Mapping):
            raise ToolCompilationError("metadata must be an object", "invalid_world_draft")
        agents = set(agent_ids) if agent_ids is not None else {key for key, profile in default_profiles().items() if profile.kind == "person"}
        entities = []
        for item in self._declarations(raw, "entities"):
            self._fields(item, {"id", "type", "location", "affordances", "state"}, {"id", "location", "affordances"}, "entity")
            entity_id = item.get("id")
            entity_type = item.get("type", "object")
            if entity_type not in ("object", "vehicle", "transit"):
                raise ToolCompilationError("entity type is invalid", "invalid_entity_type")
            location = self._location(item["location"])
            affordances = item.get("affordances", [])
            if not isinstance(affordances, list) or not affordances or len(affordances) > len(self.primitives.all()):
                raise ToolCompilationError("entity affordances are required", "missing_affordance")
            for tool_id in affordances:
                if not isinstance(tool_id, str):
                    raise ToolCompilationError("tool id is invalid", "invalid_tool_id")
                self.primitives.get(tool_id)
            state = self._entity_state(entity_type, item.get("state", {}), affordances)
            entities.append(EntityDefinition(entity_id, entity_type, location, copy.deepcopy(dict(state)), tuple(sorted(set(affordances)))))
        published_entities = dict(published.entities)
        published_entities.update({entity.entity_id: entity for entity in entities})
        compiled = {
            "compilerVersion": self.version,
            "primitiveVersion": self.primitives.version,
            "narrative": narrative.strip(),
            "entities": [entity.to_dict() for entity in entities],
            "schedules": [self._schedule(item, agents) for item in self._declarations(raw, "schedules")],
            "encounters": [self._encounter(item, agents) for item in self._declarations(raw, "encounters")],
            "compoundActions": [self._compound_action(item, agents, published_entities) for item in self._declarations(raw, "compoundActions")],
            "metadata": copy.deepcopy(raw.get("metadata", {})),
        }
        encoded = json.dumps(compiled, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
        compiled["draftHash"] = hashlib.sha256(encoded).hexdigest()
        compiled["preview"] = {
            "entityCount": len(entities),
            "scheduleCount": len(compiled["schedules"]),
            "encounterCount": len(compiled["encounters"]),
            "compoundActionCount": len(compiled["compoundActions"]),
            "newEntityIds": [entity.entity_id for entity in entities if entity.entity_id not in published.entities],
            "primitiveIds": sorted({tool_id for entity in entities for tool_id in entity.affordances}),
            "preflightedCompoundActionIds": [item["id"] for item in compiled["compoundActions"]],
        }
        return compiled
