"""Small, dependency-free domain models for the world kernel.

The models deliberately use dataclasses instead of a web framework.  This lets
the same authority run offline in tests and in the FastAPI adapter.
"""

from dataclasses import asdict, dataclass, field
from typing import Any, Dict, List, Optional, Tuple
import copy
import time


CHANNELS = ("public", "private", "doll_private", "environment", "system")
REQUEST_ACTIONS = ("ask", "tell", "invite", "move", "use", "observe")
RESPONSE_ACTIONS = ("answer", "deny", "lie", "counter", "silence", "leave", "accept", "refuse")
ALL_ACTIONS = REQUEST_ACTIONS + RESPONSE_ACTIONS
SOURCES = ("player_doll", "local", "pi", "deepseek", "claude", "environment", "system")
ROOM_IDS = ("parlor", "bedroom", "hall", "garden", "attic", "office", "home", "kitchen", "street", "station", "bar")
OBJECT_REGISTRY = {
    # Lists are intentional: snapshots and idempotent results must have the
    # same JSON-compatible shape before and after a SQLite round trip.
    "lamp": {"roomId": "parlor", "actions": ["on", "off", "toggle", "touch"]},
    "bell": {"roomId": "parlor", "actions": ["ring", "touch"]},
    "altar": {"roomId": "parlor", "actions": ["touch", "place", "clear"]},
    "door": {"roomId": "hall", "actions": ["open", "close", "knock"]},
    "window": {"roomId": "bedroom", "actions": ["open", "close", "look"]},
    "table": {"roomId": "parlor", "actions": ["touch", "look"]},
    "desk": {"roomId": "office", "actions": ["use", "look", "touch"]},
    "kettle": {"roomId": "kitchen", "actions": ["on", "off", "touch"]},
    "streetlight": {"roomId": "street", "actions": ["on", "off", "toggle", "look"]},
    # Mobility entities are still data-only definitions.  Their transitions
    # are resolved by the fixed mobility primitives, never by model code.
    "cityBike": {
        "roomId": "street",
        "zoneId": "bike-rack",
        "type": "vehicle",
        "kind": "bicycle",
        "destinations": ["street", "garden", "office", "home"],
        "affordances": ["operate_vehicle"],
    },
    "compactCar": {
        "roomId": "street",
        "zoneId": "curb",
        "type": "vehicle",
        "kind": "car",
        "destinations": ["street", "garden", "office", "home", "parlor", "station"],
        "affordances": ["operate_vehicle"],
    },
    "cityMetro": {
        "roomId": "station",
        "zoneId": "platform",
        "type": "transit",
        "kind": "metro",
        "stations": ["central", "office", "home", "street", "garden"],
        "affordances": ["board", "travel", "alight"],
    },
}


class WorldError(Exception):
    """Base error carrying a stable API error code and status."""

    code = "world_error"
    status = 400

    def __init__(self, message: str, code: Optional[str] = None, status: Optional[int] = None):
        super().__init__(message)
        if code:
            self.code = code
        if status:
            self.status = status


class ValidationError(WorldError):
    code = "validation_error"
    status = 422


class PermissionDenied(WorldError):
    code = "permission_denied"
    status = 422


class VersionConflict(WorldError):
    code = "version_conflict"
    status = 409


class IdempotencyConflict(WorldError):
    code = "idempotency_conflict"
    status = 409


@dataclass(frozen=True)
class AgentProfile:
    id: str
    kind: str
    age_status: str = "adult-fictional"
    goals: Tuple[str, ...] = ()
    traits: Tuple[str, ...] = ()
    outgoing: Tuple[str, ...] = REQUEST_ACTIONS
    incoming: Tuple[str, ...] = ("question", "invite", "accuse", "offer")
    memory_private: bool = True
    memory_retention: str = "session"

    @property
    def agent_id(self) -> str:
        """Execution identity; YOU and the doll intentionally share one agent."""
        return "PLAYER_DOLL" if self.id in ("YOU", "PLAYER_DOLL") else self.id

    def to_dict(self) -> Dict[str, Any]:
        result = asdict(self)
        result["goals"] = list(self.goals)
        result["traits"] = list(self.traits)
        result["outgoing"] = list(self.outgoing)
        result["incoming"] = list(self.incoming)
        return result


@dataclass
class Event:
    event_id: str
    world_version: int
    turn_id: str
    actor: str
    action: str
    target: Optional[str]
    channel: str
    payload: Dict[str, Any]
    audience: List[str]
    source: str
    proposal_status: str = "accepted"
    schema_version: int = 4
    seed: Optional[int] = None
    resolver_version: str = "local-1"
    created_at: float = field(default_factory=time.time)

    def to_dict(self) -> Dict[str, Any]:
        value = asdict(self)
        value["eventId"] = value.pop("event_id")
        value["worldVersion"] = value.pop("world_version")
        value["turnId"] = value.pop("turn_id")
        value["proposalStatus"] = value.pop("proposal_status")
        value["schemaVersion"] = value.pop("schema_version")
        value["resolverVersion"] = value.pop("resolver_version")
        value["createdAt"] = value.pop("created_at")
        return value

    @classmethod
    def from_dict(cls, value: Dict[str, Any]) -> "Event":
        raw = copy.deepcopy(value)
        aliases = {
            "eventId": "event_id",
            "worldVersion": "world_version",
            "turnId": "turn_id",
            "proposalStatus": "proposal_status",
            "schemaVersion": "schema_version",
            "resolverVersion": "resolver_version",
            "createdAt": "created_at",
        }
        for source, target in aliases.items():
            if source in raw:
                raw[target] = raw.pop(source)
        return cls(**raw)


@dataclass
class AgentState:
    profile: AgentProfile
    room_id: str = "parlor"
    active: bool = True
    memory: List[Dict[str, Any]] = field(default_factory=list)
    short_memory: List[Dict[str, Any]] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "profile": self.profile.to_dict(),
            "room_id": self.room_id,
            "active": self.active,
            "memory": copy.deepcopy(self.memory),
            "short_memory": copy.deepcopy(self.short_memory),
        }


def default_objects() -> Dict[str, Dict[str, Any]]:
    from ..narrative import scene_objects
    return {**copy.deepcopy(OBJECT_REGISTRY), **scene_objects()}


@dataclass
class WorldState:
    world_id: str = "local-world"
    world_version: int = 0
    room_id: str = "parlor"
    present: List[str] = field(default_factory=lambda: ["YOU", "A", "B", "C"])
    agents: Dict[str, AgentState] = field(default_factory=dict)
    relationships: Dict[str, Dict[str, Any]] = field(default_factory=dict)
    environment: Dict[str, Any] = field(default_factory=lambda: {"light": "warm", "weather": "clear"})
    objects: Dict[str, Dict[str, Any]] = field(default_factory=default_objects)
    event_head: Optional[str] = None
    # Profile and migration data are server-owned metadata.  Keeping it on the
    # authoritative snapshot lets the Python world preserve the old browser
    # profile without putting it back into the client as world authority.
    metadata: Dict[str, Any] = field(default_factory=dict)

    def clone(self) -> "WorldState":
        return copy.deepcopy(self)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "world_id": self.world_id,
            "world_version": self.world_version,
            "room_id": self.room_id,
            "present": list(self.present),
            "agents": {key: value.to_dict() for key, value in self.agents.items()},
            "relationships": copy.deepcopy(self.relationships),
            "environment": copy.deepcopy(self.environment),
            "objects": copy.deepcopy(self.objects),
            "event_head": self.event_head,
            "metadata": copy.deepcopy(self.metadata),
        }

    @classmethod
    def from_dict(cls, value: Dict[str, Any]) -> "WorldState":
        agents: Dict[str, AgentState] = {}
        for key, raw in value.get("agents", {}).items():
            profile_raw = raw.get("profile", {})
            profile = AgentProfile(
                id=profile_raw.get("id", key),
                kind=profile_raw.get("kind", "person"),
                age_status=profile_raw.get("age_status", "adult-fictional"),
                goals=tuple(profile_raw.get("goals", [])),
                traits=tuple(profile_raw.get("traits", [])),
                outgoing=tuple(profile_raw.get("outgoing", REQUEST_ACTIONS)),
                incoming=tuple(profile_raw.get("incoming", ("question", "invite", "accuse", "offer"))),
                memory_private=bool(profile_raw.get("memory_private", True)),
                memory_retention=profile_raw.get("memory_retention", "session"),
            )
            agents[key] = AgentState(
                profile=profile,
                room_id=raw.get("room_id", "parlor"),
                active=bool(raw.get("active", True)),
                memory=copy.deepcopy(raw.get("memory", [])),
                short_memory=copy.deepcopy(raw.get("short_memory", [])),
            )
        return cls(
            world_id=value.get("world_id", "local-world"),
            world_version=int(value.get("world_version", 0)),
            room_id=value.get("room_id", "parlor"),
            present=list(value.get("present", ["YOU", "A", "B", "C"])),
            agents=agents,
            relationships=copy.deepcopy(value.get("relationships", {})),
            environment=copy.deepcopy(value.get("environment", {"light": "warm", "weather": "clear"})),
            objects={**default_objects(), **copy.deepcopy(value.get("objects", {}))},
            event_head=value.get("event_head"),
            metadata=copy.deepcopy(value.get("metadata", {})),
        )


def default_profiles() -> Dict[str, AgentProfile]:
    """Return stable registry entries; Z is registered but not initially present."""
    person_outgoing = ("ask", "tell", "move", "use")
    person_incoming = ("question", "invite", "accuse", "offer")
    profiles = {
        "PLAYER_DOLL": AgentProfile("PLAYER_DOLL", "player_doll", outgoing=("suggest", "move", "use", "observe"), incoming=("player-intent", "public-event", "private-event")),
        "YOU": AgentProfile("YOU", "player-body", outgoing=REQUEST_ACTIONS, incoming=()),
        "A": AgentProfile("A", "person", goals=("protect_secret",), traits=("defensive", "proud"), outgoing=person_outgoing, incoming=person_incoming),
        "B": AgentProfile("B", "person", goals=("keep_control",), traits=("charming", "evasive"), outgoing=person_outgoing, incoming=person_incoming),
        "C": AgentProfile("C", "person", goals=("observe",), traits=("curious", "cautious"), outgoing=person_outgoing, incoming=person_incoming),
        "Z": AgentProfile("Z", "extra", goals=("get_through_day",), traits=("busy",), outgoing=person_outgoing, incoming=person_incoming, memory_retention="scene"),
        "ENV": AgentProfile("ENV", "environment", outgoing=("feedback", "ambient"), incoming=("environment-event",), memory_private=False),
    }
    # A-Y are stable long-term slots. Only A-C are initially cast; the
    # remaining slots are registered and inactive until a future roster edit.
    for code in (chr(value) for value in range(ord("D"), ord("Y") + 1)):
        profiles[code] = AgentProfile(code, "person", goals=("find_a_place",), traits=("reserved",), outgoing=person_outgoing, incoming=person_incoming)
    return profiles


def default_world(world_id: str = "local-world") -> WorldState:
    profiles = default_profiles()
    agents = {
        key: AgentState(profile=profile, room_id="parlor", active=(key in ("PLAYER_DOLL", "YOU", "A", "B", "C", "ENV")))
        for key, profile in profiles.items()
    }
    # Default locations are published world data.  Schedule projection must
    # never infer them from a character's mutable runtime room.
    defaults = {
        key: {"roomId": "parlor", "zoneId": None}
        for key, profile in profiles.items()
        if profile.kind in ("person", "extra")
    }
    return WorldState(
        world_id=world_id,
        agents=agents,
        metadata={"publishedWorld": {"version": 1, "defaultLocations": defaults}},
    )


def canonical_id(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    aliases = {"DOLL": "PLAYER_DOLL", "doll": "PLAYER_DOLL", "player_doll": "PLAYER_DOLL"}
    return aliases.get(value, value)
