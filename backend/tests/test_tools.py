import os
import tempfile
import unittest

from backend.app.domain.models import ValidationError
from backend.app.domain.world import WorldKernel
from backend.app.store import EventStore
from backend.app.tools.compiler import ToolCompiler
from backend.app.tools.registry import PrimitiveRegistry, PublishedRegistry


class ToolCompilerTests(unittest.TestCase):
    def make_kernel(self):
        handle = tempfile.NamedTemporaryFile(suffix=".sqlite", delete=False)
        handle.close()
        store = EventStore(handle.name)
        self.addCleanup(store.close)
        self.addCleanup(lambda: os.unlink(handle.name) if os.path.exists(handle.name) else None)
        return WorldKernel(store=store)

    def test_compiler_only_accepts_registered_declarative_primitives(self):
        compiler = ToolCompiler()
        with self.assertRaises(ValidationError) as unknown:
            compiler.compile({"narrative": "x", "entities": [{"id": "x", "location": {"roomId": "parlor"}, "affordances": ["delete_world"]}]}, PublishedRegistry())
        self.assertEqual(unknown.exception.code, "unknown_tool")
        with self.assertRaises(ValidationError) as forbidden:
            compiler.compile({"narrative": "x", "code": "open('/tmp/x', 'w')"}, PublishedRegistry())
        self.assertEqual(forbidden.exception.code, "forbidden_tool_draft_field")

    def test_unconfirmed_world_draft_is_not_in_runtime_registry(self):
        kernel = self.make_kernel()
        draft = kernel.create_world_draft({
            "narrative": "A spare lamp appears.",
            "entities": [{"id": "spareLamp", "type": "object", "location": {"roomId": "parlor"}, "state": {"actions": ["on", "off"]}, "affordances": ["use_object", "toggle"]}],
        }, "draft-tools")
        self.assertEqual(draft["status"], "draft")
        self.assertNotIn("spareLamp", kernel._published_registry().entities)
        with self.assertRaises(ValidationError) as unknown:
            kernel.submit_tool({"toolId": "use_object", "args": {"entityId": "spareLamp", "verb": "on"}})
        self.assertEqual(unknown.exception.code, "unknown_entity")

    def test_confirm_publishes_version_and_runtime_event_is_auditable(self):
        kernel = self.make_kernel()
        kernel.create_world_draft({
            "narrative": "A spare lamp appears.",
            "entities": [{"id": "spareLamp", "type": "object", "location": {"roomId": "parlor"}, "state": {"actions": ["on", "off"]}, "affordances": ["use_object", "toggle"]}],
        }, "draft-tools")
        published = kernel.publish_world_draft("draft-tools", expected_version=0)
        self.assertEqual(published["status"], "published")
        self.assertEqual(published["registry"]["version"], 2)
        result = kernel.submit_tool({"toolId": "use_object", "args": {"entityId": "spareLamp", "verb": "on"}, "idempotencyKey": "lamp-1"})
        tool_event = result["events"][0]
        self.assertEqual(tool_event["payload"]["eventType"], "tool_event")
        self.assertEqual(tool_event["payload"]["registryVersion"], 2)
        self.assertEqual(tool_event["payload"]["normalizedArgs"], {"entityId": "spareLamp", "verb": "on"})
        self.assertEqual(kernel.submit_tool({"toolId": "use_object", "args": {"entityId": "spareLamp", "verb": "on"}, "idempotencyKey": "lamp-1"}), result)

    def test_tool_entity_affordance_and_interest_scope_are_server_validated(self):
        kernel = self.make_kernel()
        with self.assertRaises(ValidationError) as unsupported:
            kernel.submit_tool({"toolId": "operate_vehicle", "args": {"entityId": "lamp", "destinationId": "office"}})
        self.assertEqual(unsupported.exception.code, "unsupported_affordance")
        kernel.submit_turn({"action": "move", "payload": {"roomId": "bedroom"}})
        with self.assertRaises(ValidationError) as out_of_range:
            kernel.submit_tool({"toolId": "use_object", "args": {"entityId": "lamp", "verb": "on"}})
        self.assertEqual(out_of_range.exception.code, "entity_out_of_range")

    def test_primitive_argument_schema_rejects_unknown_fields(self):
        with self.assertRaises(ValidationError) as error:
            PrimitiveRegistry.validate_args("wait", {"minutes": 2, "network": "https://example.invalid"})
        self.assertEqual(error.exception.code, "unknown_tool_argument")

    def test_registry_exposes_json_schemas_and_runtime_metadata(self):
        registry = PublishedRegistry().to_dict()
        move = next(item for item in registry["primitives"] if item["toolId"] == "move")
        self.assertEqual(move["inputSchema"]["type"], "object")
        self.assertFalse(move["inputSchema"]["additionalProperties"])
        self.assertIn("roomId", move["inputSchema"]["properties"])
        self.assertIn("outputSchema", move)
        self.assertIn("idempotent", move)

    def test_event_cursor_and_rejection_audit_storage_do_not_change_world_version(self):
        kernel = self.make_kernel()
        result = kernel.submit_tool({"toolId": "toggle", "args": {"entityId": "lamp"}, "idempotencyKey": "cursor-1"})
        event_id = result["events"][-1]["eventId"]
        self.assertEqual([item.event_id for item in kernel.store.events_after_cursor(kernel.state.world_id, event_id)], [])
        audit_id = kernel.store.save_audit(kernel.state.world_id, kernel.state.world_version, "tool_proposal_rejected", {"reason": "test", "toolId": "unknown"})
        self.assertEqual(kernel.state.world_version, 1)
        audits = kernel.store.audits(kernel.state.world_id, audit_id - 1)
        self.assertEqual(audits[0]["eventType"], "tool_proposal_rejected")

    def test_rejected_tool_is_persisted_as_redacted_audit(self):
        kernel = self.make_kernel()
        with self.assertRaises(ValidationError):
            kernel.submit_tool({"toolId": "unknown_tool", "args": {"secret": "do-not-store"}})
        audits = kernel.store.audits(kernel.state.world_id)
        self.assertEqual(audits[-1]["eventType"], "tool_proposal_rejected")
        payload = audits[-1]["payload"]
        self.assertEqual(payload["reason"], "unknown_tool")
        self.assertNotIn("secret", str(payload))
        self.assertEqual(kernel.state.world_version, 0)

    def test_vehicle_resolver_moves_player_and_persists_route(self):
        kernel = self.make_kernel()
        kernel.submit_tool({"toolId": "move", "args": {"roomId": "street", "zoneId": "bike-rack"}})
        result = kernel.submit_tool({
            "toolId": "operate_vehicle",
            "args": {"entityId": "cityBike", "destinationId": "garden"},
            "idempotencyKey": "bike-garden",
        })
        self.assertEqual(result["snapshot"]["roomId"], "garden")
        mobility = result["events"][0]["payload"]["mobility"]
        self.assertEqual(mobility["kind"], "bicycle")
        self.assertEqual(mobility["fromRoom"], "street")
        self.assertEqual(mobility["toRoom"], "garden")
        self.assertEqual(result["events"][1]["payload"]["mobility"]["mode"], "vehicle")

    def test_transit_resolver_requires_board_travel_and_alight(self):
        kernel = self.make_kernel()
        kernel.submit_tool({"toolId": "move", "args": {"roomId": "station", "zoneId": "platform"}})
        with self.assertRaises(ValidationError) as not_boarded:
            kernel.submit_tool({"toolId": "travel", "args": {"entityId": "cityMetro", "destinationId": "office"}})
        self.assertEqual(not_boarded.exception.code, "transit_not_boarded")

        boarded = kernel.submit_tool({"toolId": "board", "args": {"entityId": "cityMetro", "stationId": "central"}})
        self.assertEqual(boarded["snapshot"]["metadata"]["mobility"]["stationId"], "central")
        travelled = kernel.submit_tool({"toolId": "travel", "args": {"entityId": "cityMetro", "destinationId": "office"}})
        self.assertEqual(travelled["snapshot"]["metadata"]["mobility"]["stationId"], "office")
        arrived = kernel.submit_tool({"toolId": "alight", "args": {"entityId": "cityMetro", "stationId": "office"}})
        self.assertEqual(arrived["snapshot"]["roomId"], "office")
        self.assertNotIn("mobility", arrived["snapshot"]["metadata"])

    def test_mobility_route_and_entity_kind_are_server_validated(self):
        kernel = self.make_kernel()
        kernel.submit_tool({"toolId": "move", "args": {"roomId": "street", "zoneId": "bike-rack"}})
        with self.assertRaises(ValidationError) as invalid_destination:
            kernel.submit_tool({"toolId": "operate_vehicle", "args": {"entityId": "cityBike", "destinationId": "attic"}})
        self.assertEqual(invalid_destination.exception.code, "unknown_destination")
        with self.assertRaises(ValidationError) as invalid_kind:
            kernel.submit_tool({"toolId": "operate_vehicle", "args": {"entityId": "streetlight", "destinationId": "office"}})
        self.assertEqual(invalid_kind.exception.code, "unsupported_affordance")


if __name__ == "__main__":
    unittest.main()
