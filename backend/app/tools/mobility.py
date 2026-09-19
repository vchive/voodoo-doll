"""Deterministic mobility resolvers for the fixed tool registry.

Mobility is intentionally data driven.  The resolver only changes a cloned
``WorldState`` after the caller has validated the published affordance and
interest scope; it never calls a model or evaluates user supplied code.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, Mapping

from ..domain.models import ROOM_IDS, ValidationError, WorldState


STATION_ROOMS = {
    "central": "station",
    "office": "office",
    "home": "home",
    "street": "street",
    "garden": "garden",
}


@dataclass(frozen=True)
class MobilityResult:
    """The state changes and audit data produced by one mobility operation."""

    tool_id: str
    kind: str
    from_room: str
    to_room: str
    mode: str
    station_id: str | None = None

    def to_payload(self) -> Dict[str, Any]:
        payload: Dict[str, Any] = {
            "mobility": {
                "kind": self.kind,
                "mode": self.mode,
                "fromRoom": self.from_room,
                "toRoom": self.to_room,
            }
        }
        if self.station_id is not None:
            payload["mobility"]["stationId"] = self.station_id
        return payload


def _entity_kind(entity: Any, runtime: Mapping[str, Any]) -> str:
    state = entity.state if entity is not None else {}
    return str(runtime.get("kind") or state.get("kind") or "")


def _allowed_destinations(entity: Any, runtime: Mapping[str, Any]) -> set[str]:
    state = entity.state if entity is not None else {}
    values = runtime.get("destinations", state.get("destinations", []))
    return {value for value in values if isinstance(value, str)} if isinstance(values, list) else set()


def _stations(entity: Any, runtime: Mapping[str, Any]) -> set[str]:
    state = entity.state if entity is not None else {}
    values = runtime.get("stations", state.get("stations", []))
    return {value for value in values if isinstance(value, str)} if isinstance(values, list) else set()


def _set_entity_location(state: WorldState, entity_id: str, room_id: str, zone_id: str | None = None) -> None:
    runtime = state.objects.setdefault(entity_id, {})
    runtime["roomId"] = room_id
    runtime["zoneId"] = zone_id


def resolve_mobility(
    tool_id: str,
    args: Mapping[str, Any],
    state: WorldState,
    entity: Any,
) -> MobilityResult:
    """Apply one fixed mobility primitive to ``state``.

    The caller passes a cloned state.  Invalid transitions raise a stable
    ``ValidationError`` before any state is changed.
    """

    entity_id = str(args["entityId"])
    runtime = state.objects.get(entity_id, {})
    kind = _entity_kind(entity, runtime)
    current_room = state.agents["YOU"].room_id
    mobility = state.metadata.setdefault("mobility", {})

    if tool_id == "operate_vehicle":
        if kind not in {"bicycle", "car", "vehicle"}:
            raise ValidationError("entity is not an operable vehicle", "invalid_mobility_entity")
        destination = str(args["destinationId"])
        if destination not in ROOM_IDS or destination not in _allowed_destinations(entity, runtime):
            raise ValidationError("vehicle route does not contain destination", "unknown_destination")
        to_room = destination
        from_room = current_room
        state.room_id = to_room
        state.agents["YOU"].room_id = to_room
        _set_entity_location(state, entity_id, to_room, runtime.get("zoneId"))
        mobility.update({"mode": "vehicle", "vehicleId": entity_id, "fromRoom": from_room, "toRoom": to_room})
        return MobilityResult(tool_id, kind, from_room, to_room, "vehicle")

    if kind not in {"metro", "train", "transit"}:
        raise ValidationError("entity is not public transit", "invalid_transit_entity")
    station_ids = _stations(entity, runtime)
    station_id = str(args.get("stationId", ""))

    if tool_id == "board":
        if station_id not in station_ids or STATION_ROOMS.get(station_id) != current_room:
            raise ValidationError("boarding station is not the current location", "invalid_boarding_station")
        if mobility.get("vehicleId"):
            raise ValidationError("already using a mobility entity", "mobility_already_active")
        mobility.update({"mode": "transit", "vehicleId": entity_id, "stationId": station_id, "fromRoom": current_room})
        return MobilityResult(tool_id, kind, current_room, current_room, "transit", station_id)

    if mobility.get("vehicleId") != entity_id or mobility.get("mode") != "transit":
        raise ValidationError("you must board this transit entity first", "transit_not_boarded")

    if tool_id == "travel":
        destination = str(args["destinationId"])
        if destination not in station_ids or destination not in STATION_ROOMS:
            raise ValidationError("transit route does not contain destination", "unknown_destination")
        if destination == mobility.get("stationId"):
            raise ValidationError("transit is already at that station", "already_at_station")
        mobility["stationId"] = destination
        mobility["toRoom"] = STATION_ROOMS[destination]
        return MobilityResult(tool_id, kind, current_room, current_room, "transit", destination)

    if tool_id == "alight":
        if station_id not in STATION_ROOMS or station_id not in station_ids or station_id != mobility.get("stationId"):
            raise ValidationError("alighting station does not match current transit stop", "invalid_alighting_station")
        to_room = STATION_ROOMS[station_id]
        from_room = current_room
        state.room_id = to_room
        state.agents["YOU"].room_id = to_room
        _set_entity_location(state, entity_id, to_room, "platform")
        mobility.clear()
        state.metadata.pop("mobility", None)
        return MobilityResult(tool_id, kind, from_room, to_room, "transit", station_id)

    raise ValidationError("unsupported mobility operation", "unsupported_mobility_operation")
