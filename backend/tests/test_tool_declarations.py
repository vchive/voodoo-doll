import unittest

from backend.app.domain.models import ValidationError
from backend.app.domain.world import WorldKernel
from backend.app.store import EventStore


class ToolDeclarationTests(unittest.TestCase):
    def make_kernel(self):
        store = EventStore(":memory:")
        self.addCleanup(store.close)
        return WorldKernel(store=store)

    def test_invalid_entity_state_or_routes_never_reach_publication(self):
        kernel = self.make_kernel()
        cases = [
            ("object", {"actions": None}, ["use_object"]),
            ("object", {"actions": 7}, ["use_object"]),
            ("object", {"actions": "on"}, ["use_object"]),
            ("object", {"actions": []}, ["use_object"]),
            ("object", {"actions": ["on"]}, ["toggle"]),
            ("object", {"actions": ["erase_world"]}, ["use_object"]),
            ("object", {"actions": ["touch"]}, ["operate_vehicle"]),
            ("vehicle", {"kind": "car", "destinations": ["unregistered-room"]}, ["operate_vehicle"]),
            ("vehicle", {"kind": "plane", "destinations": ["office"]}, ["operate_vehicle"]),
            ("vehicle", {"kind": "car", "destinations": None}, ["operate_vehicle"]),
            ("transit", {"kind": "metro", "stations": ["unregistered-station"]}, ["board"]),
        ]
        for kind, state, affordances in cases:
            with self.subTest(kind=kind, state=state), self.assertRaises(ValidationError):
                kernel.create_world_draft({"narrative": "新物件", "entities": [{
                    "id": "newObject", "type": kind, "location": {"roomId": "parlor"},
                    "state": state, "affordances": affordances,
                }]}, "invalid")
            self.assertEqual(kernel.store.world_drafts("local-world"), [])
            self.assertEqual(kernel.state.world_version, 0)

    def test_new_vehicle_route_is_published_and_usable(self):
        kernel = self.make_kernel()
        kernel.create_world_draft({"narrative": "院里有辆自行车", "entities": [{
            "id": "spareBike", "type": "vehicle", "location": {"roomId": "parlor"},
            "state": {"kind": "bicycle", "destinations": ["office"]}, "affordances": ["operate_vehicle"],
        }]}, "bike-build")
        kernel.publish_world_draft("bike-build")
        result = kernel.submit_tool({"toolId": "operate_vehicle", "args": {"entityId": "spareBike", "destinationId": "office"}})
        self.assertEqual(result["snapshot"]["roomId"], "office")

    def test_compound_vehicle_action_can_reference_an_entity_from_the_same_draft(self):
        kernel = self.make_kernel()
        draft = kernel.create_world_draft({
            "narrative": "A 骑院里的备用自行车去公司。",
            "entities": [{
                "id": "spareBike", "type": "vehicle", "location": {"roomId": "parlor"},
                "state": {"kind": "bicycle", "destinations": ["office"]},
                "affordances": ["operate_vehicle"],
            }],
            "compoundActions": [{
                "id": "bike-to-office", "actorId": "A", "summary": "A 骑车去公司",
                "startLocation": {"roomId": "parlor"},
                "steps": [{
                    "id": "ride-office", "toolId": "operate_vehicle",
                    "args": {"entityId": "spareBike", "destinationId": "office"},
                }],
            }],
        }, "bike-plan")
        action = draft["compiled"]["compoundActions"][0]
        self.assertEqual(action["preflight"], {
            "stepCount": 1,
            "endLocation": {"roomId": "office", "zoneId": None},
            "touchedEntityIds": ["spareBike"],
        })
        self.assertEqual(draft["compiled"]["preview"]["preflightedCompoundActionIds"], ["bike-to-office"])

    def test_compound_transit_preflight_requires_board_travel_and_alight(self):
        kernel = self.make_kernel()
        base = {
            "narrative": "A 从中央站乘地铁去公司。",
            "compoundActions": [{
                "id": "metro-to-office", "actorId": "A", "summary": "A 乘地铁去公司",
                "startLocation": {"roomId": "station", "zoneId": "platform"},
                "steps": [
                    {"id": "board-central", "toolId": "board", "args": {"entityId": "cityMetro", "stationId": "central"}},
                    {"id": "travel-office", "toolId": "travel", "args": {"entityId": "cityMetro", "destinationId": "office"}},
                    {"id": "alight-office", "toolId": "alight", "args": {"entityId": "cityMetro", "stationId": "office"}},
                ],
            }],
        }
        action = kernel.create_world_draft(base, "metro-plan")["compiled"]["compoundActions"][0]
        self.assertEqual(action["preflight"]["stepCount"], 3)
        self.assertEqual(action["preflight"]["endLocation"], {"roomId": "office", "zoneId": "platform"})
        self.assertEqual(action["preflight"]["touchedEntityIds"], ["cityMetro"])

        invalid = []
        travel_first = dict(base)
        travel_first["compoundActions"] = [dict(base["compoundActions"][0])]
        travel_first["compoundActions"][0]["steps"] = [base["compoundActions"][0]["steps"][1]]
        invalid.append((travel_first, "compound_transit_not_boarded"))

        no_alight = dict(base)
        no_alight["compoundActions"] = [dict(base["compoundActions"][0])]
        no_alight["compoundActions"][0]["steps"] = base["compoundActions"][0]["steps"][:2]
        invalid.append((no_alight, "compound_transit_incomplete"))

        out_of_scope = {
            "narrative": "A 在远处尝试开灯。",
            "compoundActions": [{
                "id": "remote-lamp", "actorId": "A", "summary": "远程开灯",
                "startLocation": {"roomId": "parlor"},
                "steps": [{"id": "toggle", "toolId": "toggle", "args": {"entityId": "streetlight"}}],
            }],
        }
        invalid.append((out_of_scope, "compound_entity_out_of_range"))

        unknown_entity = {
            "narrative": "A 尝试使用不存在的物件。",
            "compoundActions": [{
                "id": "unknown-entity", "actorId": "A", "summary": "使用未知物件",
                "startLocation": {"roomId": "parlor"},
                "steps": [{"id": "use", "toolId": "use_object", "args": {"entityId": "missingLamp", "verb": "on"}}],
            }],
        }
        invalid.append((unknown_entity, "unknown_entity"))

        unknown_tool = {
            "narrative": "A 尝试调用未注册能力。",
            "compoundActions": [{
                "id": "unknown-tool", "actorId": "A", "summary": "调用未知能力",
                "startLocation": {"roomId": "parlor"},
                "steps": [{"id": "teleport", "toolId": "teleport", "args": {}}],
            }],
        }
        invalid.append((unknown_tool, "unknown_tool"))

        wrong_affordance = {
            "narrative": "A 尝试把地铁当普通物件使用。",
            "compoundActions": [{
                "id": "wrong-affordance", "actorId": "A", "summary": "错误使用地铁",
                "startLocation": {"roomId": "station", "zoneId": "platform"},
                "steps": [{"id": "use", "toolId": "use_object", "args": {"entityId": "cityMetro", "verb": "on"}}],
            }],
        }
        invalid.append((wrong_affordance, "unsupported_affordance"))

        for index, (raw, code) in enumerate(invalid):
            with self.subTest(index=index, code=code), self.assertRaises(ValidationError) as error:
                kernel.create_world_draft(raw, f"invalid-compound-{index}")
            self.assertEqual(error.exception.code, code)

    def test_unsupported_schedule_tolerance_is_not_silently_ignored(self):
        kernel = self.make_kernel()
        with self.assertRaises(ValidationError) as error:
            kernel.create_world_draft({"narrative": "弹性上班", "schedules": [{
                "id": "flexible", "agentId": "A", "startMinute": 540, "endMinute": 1020,
                "location": {"roomId": "office"}, "toleranceMinutes": 15,
            }]})
        self.assertEqual(error.exception.code, "unsupported_schedule_tolerance")
        self.assertEqual(kernel.state.world_version, 0)

    def test_runtime_rechecks_legacy_route_before_writing_unknown_room(self):
        kernel = self.make_kernel()
        kernel.submit_tool({"toolId": "move", "args": {"roomId": "street", "zoneId": "bike-rack"}})
        kernel.state.objects["cityBike"]["destinations"] = ["unregistered-room"]
        before = kernel.state.to_dict()
        with self.assertRaises(ValidationError) as error:
            kernel.submit_tool({"toolId": "operate_vehicle", "args": {"entityId": "cityBike", "destinationId": "unregistered-room"}})
        self.assertEqual(error.exception.code, "unknown_destination")
        self.assertEqual(kernel.state.to_dict(), before)


if __name__ == "__main__":
    unittest.main()
