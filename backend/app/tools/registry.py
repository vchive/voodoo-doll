"""Fixed primitive tools and versioned published entity affordances.

The registry is deliberately data-only.  A model can reference a primitive
and supply JSON arguments, but it cannot introduce a resolver or executable
code at runtime.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, Iterable, Mapping, Optional
import copy
import re

from ..domain.models import OBJECT_REGISTRY, ROOM_IDS, ValidationError


SAFE_ID = re.compile(r"^[A-Za-z][A-Za-z0-9_.:-]{0,63}$")


@dataclass(frozen=True)
class PrimitiveSpec:
    tool_id: str
    version: str
    parameters: Mapping[str, str]
    resolver: str
    side_effects: tuple[str, ...] = ()
    input_schema: Mapping[str, Any] = field(default_factory=dict)
    output_schema: Mapping[str, Any] = field(default_factory=lambda: {"type": "object"})
    read_only: bool = False
    idempotent: bool = True
    destructive: bool = False

    def to_dict(self) -> Dict[str, Any]:
        return {
            "toolId": self.tool_id,
            "version": self.version,
            "parameters": dict(self.parameters),
            "inputSchema": copy.deepcopy(dict(self.input_schema or _schema_from_parameters(self.parameters))),
            "outputSchema": copy.deepcopy(dict(self.output_schema)),
            "resolver": self.resolver,
            "sideEffects": list(self.side_effects),
            "readOnly": self.read_only,
            "idempotent": self.idempotent,
            "destructive": self.destructive,
        }


def _schema_from_parameters(parameters: Mapping[str, str]) -> Dict[str, Any]:
    """Build a JSON Schema view for the legacy compact parameter map."""
    properties: Dict[str, Any] = {}
    required = []
    types = {"string": "string", "entity": "string", "room": "string", "zone": "string", "integer": "integer"}
    for name, kind in parameters.items():
        optional = kind.endswith("?")
        base = kind[:-1] if optional else kind
        schema: Dict[str, Any] = {"type": types.get(base, "string")}
        if base == "entity":
            schema["pattern"] = SAFE_ID.pattern
        if base == "room":
            schema["enum"] = list(ROOM_IDS)
        if base == "integer":
            schema["minimum"] = 0
        properties[name] = schema
        if not optional:
            required.append(name)
    result: Dict[str, Any] = {"type": "object", "additionalProperties": False, "properties": properties}
    if required:
        result["required"] = required
    return result


@dataclass(frozen=True)
class EntityDefinition:
    entity_id: str
    entity_type: str
    location: Mapping[str, Optional[str]]
    state: Mapping[str, Any] = field(default_factory=dict)
    affordances: tuple[str, ...] = ()
    immutable: bool = True

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.entity_id,
            "type": self.entity_type,
            "location": {"roomId": self.location.get("roomId"), "zoneId": self.location.get("zoneId")},
            "state": copy.deepcopy(dict(self.state)),
            "affordances": list(self.affordances),
            "immutable": self.immutable,
        }


class PrimitiveRegistry:
    """Stable allow-list of runtime capabilities."""

    version = "primitive-1"

    _SPECS: Dict[str, PrimitiveSpec] = {
        "look": PrimitiveSpec("look", "1", {"entityId": "entity"}, "environment.look", read_only=True),
        "move": PrimitiveSpec("move", "1", {"roomId": "room", "zoneId": "zone?"}, "world.move", ("location",), idempotent=True),
        "speak": PrimitiveSpec("speak", "1", {"text": "string"}, "social.speak", idempotent=False),
        "use_object": PrimitiveSpec("use_object", "1", {"entityId": "entity", "verb": "string"}, "environment.use_object", ("entity_state",), idempotent=False),
        "toggle": PrimitiveSpec("toggle", "1", {"entityId": "entity"}, "environment.toggle", ("entity_state",), idempotent=False),
        "board": PrimitiveSpec("board", "1", {"entityId": "entity", "stationId": "string"}, "mobility.board", ("location",), idempotent=False),
        "travel": PrimitiveSpec("travel", "1", {"entityId": "entity", "destinationId": "string"}, "mobility.travel", ("location", "clock"), idempotent=False),
        "alight": PrimitiveSpec("alight", "1", {"entityId": "entity", "stationId": "string"}, "mobility.alight", ("location",), idempotent=False),
        "operate_vehicle": PrimitiveSpec("operate_vehicle", "1", {"entityId": "entity", "destinationId": "string"}, "mobility.operate_vehicle", ("location", "clock"), idempotent=False),
        "wait": PrimitiveSpec("wait", "1", {"minutes": "integer"}, "world.wait", ("clock",), idempotent=False),
    }

    @classmethod
    def get(cls, tool_id: str) -> PrimitiveSpec:
        try:
            return cls._SPECS[tool_id]
        except KeyError as exc:
            raise ValidationError("tool is not registered", "unknown_tool") from exc

    @classmethod
    def all(cls) -> Dict[str, PrimitiveSpec]:
        return dict(cls._SPECS)

    @classmethod
    def validate_args(cls, tool_id: str, args: Mapping[str, Any]) -> Dict[str, Any]:
        spec = cls.get(tool_id)
        if not isinstance(args, Mapping):
            raise ValidationError("tool args must be an object", "invalid_tool_args")
        expected = dict(spec.parameters)
        unknown = set(args) - set(expected)
        if unknown:
            raise ValidationError("tool args contain unknown fields", "unknown_tool_argument")
        normalized: Dict[str, Any] = {}
        for key, kind in expected.items():
            optional = kind.endswith("?")
            base = kind[:-1] if optional else kind
            if key not in args:
                if optional:
                    continue
                raise ValidationError("tool arg is required", "missing_tool_argument")
            value = args[key]
            if base == "string" and (not isinstance(value, str) or not value.strip()):
                raise ValidationError("tool arg must be a string", "invalid_tool_argument")
            if base == "integer" and (not isinstance(value, int) or isinstance(value, bool) or value < 0):
                raise ValidationError("tool arg must be a non-negative integer", "invalid_tool_argument")
            if base == "entity" and (not isinstance(value, str) or not SAFE_ID.match(value)):
                raise ValidationError("tool entity id is invalid", "invalid_entity_id")
            if base == "room" and (not isinstance(value, str) or value not in ROOM_IDS):
                raise ValidationError("room is not registered", "unknown_room")
            if base == "zone" and (value is not None and (not isinstance(value, str) or not SAFE_ID.match(value))):
                raise ValidationError("zone id is invalid", "invalid_zone_id")
            normalized[key] = value.strip() if isinstance(value, str) else value
        return normalized


class PublishedRegistry:
    """Immutable snapshot of the registry visible to runtime resolvers."""

    def __init__(self, version: int = 1, entities: Optional[Iterable[EntityDefinition]] = None):
        self.version = int(version)
        self.entities: Dict[str, EntityDefinition] = {item.entity_id: item for item in (entities or self.default_entities())}

    @staticmethod
    def default_entities() -> Iterable[EntityDefinition]:
        for entity_id, raw in OBJECT_REGISTRY.items():
            actions = tuple(raw.get("actions", ()))
            affordances = tuple(raw.get("affordances", ()))
            if not affordances:
                affordances = ("use_object", "toggle") if any(item in actions for item in ("on", "off", "toggle")) else ("use_object",)
            state = {key: copy.deepcopy(value) for key, value in raw.items() if key not in {"roomId", "zoneId", "type", "affordances"}}
            if actions:
                state.setdefault("actions", list(actions))
            yield EntityDefinition(
                entity_id,
                str(raw.get("type", "object")),
                {"roomId": raw.get("roomId"), "zoneId": raw.get("zoneId")},
                state,
                affordances,
            )

    def entity(self, entity_id: str) -> EntityDefinition:
        try:
            return self.entities[entity_id]
        except KeyError as exc:
            raise ValidationError("entity is not published", "unknown_entity") from exc

    def validate_affordance(self, tool_id: str, entity_id: str) -> tuple[PrimitiveSpec, EntityDefinition]:
        spec = PrimitiveRegistry.get(tool_id)
        entity = self.entity(entity_id)
        if tool_id not in entity.affordances:
            raise ValidationError("entity does not expose this affordance", "unsupported_affordance")
        return spec, entity

    def publish(self, entities: Iterable[EntityDefinition]) -> "PublishedRegistry":
        merged = dict(self.entities)
        for entity in entities:
            merged[entity.entity_id] = entity
        return PublishedRegistry(self.version + 1, merged.values())

    def to_dict(self) -> Dict[str, Any]:
        return {
            "version": self.version,
            "primitiveVersion": PrimitiveRegistry.version,
            "primitives": [PrimitiveRegistry.all()[key].to_dict() for key in sorted(PrimitiveRegistry.all())],
            "entities": [self.entities[key].to_dict() for key in sorted(self.entities)],
        }

    @classmethod
    def from_dict(cls, value: Mapping[str, Any]) -> "PublishedRegistry":
        entities = []
        for raw in value.get("entities", []):
            location = raw.get("location", {})
            entities.append(EntityDefinition(str(raw["id"]), str(raw["type"]), {"roomId": location.get("roomId"), "zoneId": location.get("zoneId")}, raw.get("state", {}), tuple(raw.get("affordances", [])), bool(raw.get("immutable", True))))
        return cls(int(value.get("version", 1)), entities or None)
