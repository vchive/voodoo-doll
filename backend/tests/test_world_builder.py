import copy
import json
import os
import sqlite3
import tempfile
import threading
import unittest
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch

from backend.app.domain.models import ValidationError, VersionConflict
from backend.app.domain.world import WorldKernel
from backend.app.store import EventStore
from backend.app.world.clock import default_clock


def office_draft():
    return {
        "narrative": "A 在办公室工作，桌上有一盏灯，偶尔会端起咖啡。",
        "entities": [{
            "id": "deskLamp", "type": "object", "location": {"roomId": "office", "zoneId": "desk"},
            "state": {"actions": ["on", "off"]}, "affordances": ["use_object", "toggle"],
        }],
        "schedules": [{
            "id": "A-office", "agentId": "A", "startMinute": 540, "endMinute": 1020,
            "recurrence": {"kind": "daily", "days": [1, 2, 3, 4, 5]},
            "location": {"roomId": "office", "zoneId": "desk"}, "activity": "work", "priority": 20,
        }],
        "encounters": [{
            "id": "coffee-break", "roomId": "office", "zoneId": "desk", "agentIds": ["A"],
            "weight": 2, "summary": "A 端起咖啡。",
        }],
    }


def metro_compound_draft():
    return {
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


class WorldBuilderTests(unittest.TestCase):
    def make_kernel(self):
        handle = tempfile.NamedTemporaryFile(suffix=".sqlite", delete=False)
        handle.close()
        self.addCleanup(lambda: os.unlink(handle.name) if os.path.exists(handle.name) else None)
        store = EventStore(handle.name)
        self.addCleanup(store.close)
        kernel = WorldKernel(store=store)
        kernel.state.metadata["clock"] = default_clock(now=1000)
        return kernel

    def reopen(self, kernel):
        store = EventStore(kernel.store.filename)
        self.addCleanup(store.close)
        return WorldKernel(store=store)

    def test_preview_is_isolated_and_lists_all_declarations(self):
        kernel = self.make_kernel()
        before = kernel.state.to_dict()
        result = kernel.create_world_draft(office_draft(), "office-build")
        preview = result["compiled"]["preview"]
        self.assertEqual((preview["entityCount"], preview["scheduleCount"], preview["encounterCount"]), (1, 1, 1))
        self.assertEqual(kernel.state.to_dict(), before)
        self.assertEqual(kernel.store.events(kernel.state.world_id), [])
        result["compiled"]["schedules"][0]["location"]["roomId"] = "home"
        fetched = kernel.world_draft("office-build")
        self.assertEqual(fetched["compiled"]["schedules"][0]["location"]["roomId"], "office")
        fetched["compiled"]["encounters"].clear()
        self.assertEqual(len(kernel.world_draft("office-build")["compiled"]["encounters"]), 1)

    def test_confirm_atomically_publishes_schedule_and_encounter_without_agent_calls(self):
        kernel = self.make_kernel()
        kernel.create_world_draft(office_draft(), "office-build")
        with patch.object(kernel.agent, "propose", side_effect=AssertionError("no model before interest")):
            result = kernel.publish_world_draft("office-build", 0)
            projection = kernel.advance_world(now=1000)
        self.assertEqual(result["worldVersion"], 1)
        self.assertEqual(len(result["events"]), 1)
        self.assertEqual(len(result["events"][0]["payload"]["declarations"]["schedules"]), 1)
        self.assertEqual(result["publishedWorld"]["encounters"]["version"], 1)
        self.assertEqual(projection["presenceProjections"]["A"]["roomId"], "office")
        activated = kernel.update_interest("office-visitor", "office", "desk", now=1000)["activated"]
        self.assertEqual(activated[0]["encounter"]["candidateId"], "coffee-break")
        self.assertEqual(kernel.heartbeat("office-visitor", now=1001)["activated"], [])

    def test_confirm_receipt_survives_restart_and_later_turns(self):
        kernel = self.make_kernel()
        kernel.create_world_draft(office_draft(), "office-build")
        published = kernel.publish_world_draft("office-build", 0)
        kernel.submit_tool({"toolId": "move", "args": {"roomId": "hall"}})
        restarted = self.reopen(kernel)
        version = restarted.state.world_version
        self.assertEqual(restarted.publish_world_draft("office-build", 0), published)
        self.assertEqual(restarted.state.world_version, version)
        self.assertEqual(len([event for event in restarted.store.events("local-world") if event.action == "world_registry_published"]), 1)
        self.assertEqual(restarted.state.metadata["schedules"]["blocks"][0]["id"], "A-office")
        with self.assertRaises(ValidationError):
            restarted.create_world_draft(office_draft(), "office-build")
        with self.assertRaises(ValidationError):
            restarted.cancel_world_draft("office-build")

    def test_compound_action_is_inert_until_confirmed_then_published_idempotently(self):
        kernel = self.make_kernel()
        draft = kernel.create_world_draft(metro_compound_draft(), "metro-build")
        self.assertEqual(draft["compiled"]["preview"]["compoundActionCount"], 1)
        self.assertNotIn("compoundActions", kernel.state.metadata.get("publishedWorld", {}))
        self.assertEqual(kernel.store.events("local-world"), [])

        published = kernel.publish_world_draft("metro-build", 0)
        actions = published["publishedWorld"]["compoundActions"]
        self.assertEqual(actions["version"], 1)
        self.assertEqual(actions["items"], draft["compiled"]["compoundActions"])
        event = published["events"][0]
        self.assertEqual(event["action"], "world_registry_published")
        self.assertEqual(event["payload"]["compoundActionVersion"], 1)
        self.assertEqual(event["payload"]["declarations"]["compoundActions"], actions["items"])

        restarted = self.reopen(kernel)
        version = restarted.state.world_version
        self.assertEqual(restarted.publish_world_draft("metro-build", 0), published)
        self.assertEqual(restarted.state.world_version, version)
        self.assertEqual(restarted.state.metadata["publishedWorld"]["compoundActions"], actions)
        self.assertEqual(len([item for item in restarted.store.events("local-world") if item.action == "world_registry_published"]), 1)

    def test_unconfirmed_draft_restores_after_restart_and_cancel_does_not_publish(self):
        kernel = self.make_kernel()
        kernel.create_world_draft(office_draft(), "office-build")
        restarted = self.reopen(kernel)
        self.assertEqual(restarted.world_draft("office-build")["status"], "draft")
        restarted.cancel_world_draft("office-build")
        self.assertEqual(restarted.store.world_drafts("local-world"), [])
        self.assertNotIn("deskLamp", restarted._published_registry().entities)
        self.assertEqual(restarted.store.events("local-world"), [])

    def test_stale_world_or_registry_does_not_partially_publish(self):
        kernel = self.make_kernel()
        kernel.create_world_draft(office_draft(), "office-build")
        kernel.submit_tool({"toolId": "move", "args": {"roomId": "hall"}})
        before = kernel.state.to_dict()
        with self.assertRaises(ValidationError) as stale:
            kernel.publish_world_draft("office-build")
        self.assertEqual(stale.exception.code, "version_conflict")
        self.assertEqual(kernel.state.to_dict(), before)
        kernel.create_world_draft({"narrative": "仅确认当前布景。"}, "other-build")
        kernel.publish_world_draft("other-build", 1)
        with self.assertRaises(ValidationError) as changed:
            kernel.publish_world_draft("office-build", 2)
        self.assertEqual(changed.exception.code, "registry_version_conflict")
        self.assertNotIn("deskLamp", kernel._published_registry().entities)
        self.assertNotIn("schedules", kernel.state.metadata)

    def test_invalid_declarations_never_persist_a_partial_draft(self):
        kernel = self.make_kernel()
        bad_values = []
        for key, value in (("schedules", {}), ("encounters", "bad"), ("entities", None), ("metadata", []), ("rooms", [{"id": "newRoom"}])):
            raw = office_draft()
            raw[key] = value
            bad_values.append(raw)
        for key, value in (("agentId", "YOU"), ("agentId", []), ("startMinute", True), ("endMinute", 1500), ("recurrence", {"days": [1, 1]}), ("exceptions", ["tomorrow"]), ("visibility", "private")):
            raw = office_draft()
            raw["schedules"][0][key] = value
            bad_values.append(raw)
        for key, value in (("weight", 0), ("weight", True), ("agentIds", ["ENV"]), ("roomId", "unknown"), ("relationshipDelta", {"trust": 100})):
            raw = office_draft()
            raw["encounters"][0][key] = value
            bad_values.append(raw)
        for key in ("entities", "schedules", "encounters"):
            raw = office_draft()
            raw[key].append(copy.deepcopy(raw[key][0]))
            bad_values.append(raw)
        for index, raw in enumerate(bad_values):
            with self.subTest(index=index), self.assertRaises(ValidationError):
                kernel.create_world_draft(raw, "invalid-build")
            self.assertEqual(kernel.store.world_drafts("local-world"), [])
        self.assertEqual(kernel.state.world_version, 0)
        self.assertEqual(kernel.store.events("local-world"), [])

    def test_hash_and_compiler_version_are_rechecked_at_confirmation(self):
        kernel = self.make_kernel()
        kernel.create_world_draft(office_draft(), "office-build")
        draft = kernel.world_draft("office-build")
        draft["compiled"]["schedules"][0]["location"]["roomId"] = "home"
        with kernel.store._connection:
            kernel.store._connection.execute("UPDATE world_build_drafts SET payload_json = ? WHERE world_id = ? AND draft_id = ?", (json.dumps(draft), "local-world", "office-build"))
        restarted = self.reopen(kernel)
        with self.assertRaises(ValidationError) as tampered:
            restarted.publish_world_draft("office-build")
        self.assertEqual(tampered.exception.code, "world_draft_hash_mismatch")
        draft["compiled"]["compilerVersion"] = "tool-compiler-1"
        with kernel.store._connection:
            kernel.store._connection.execute("UPDATE world_build_drafts SET payload_json = ? WHERE world_id = ? AND draft_id = ?", (json.dumps(draft), "local-world", "office-build"))
        restarted = self.reopen(kernel)
        with self.assertRaises(ValidationError) as old:
            restarted.publish_world_draft("office-build")
        self.assertEqual(old.exception.code, "stale_compiler_version")
        self.assertEqual(restarted.state.world_version, 0)

    def test_store_failure_rolls_back_all_definitions_and_retains_draft(self):
        kernel = self.make_kernel()
        kernel.create_world_draft(office_draft(), "office-build")
        before = kernel.state.to_dict()
        stored = kernel.store.load_state("local-world").to_dict()
        kernel.store._connection.execute("CREATE TRIGGER fail_publish BEFORE INSERT ON events BEGIN SELECT RAISE(ABORT, 'simulated failure'); END")
        with self.assertRaises(sqlite3.IntegrityError):
            kernel.publish_world_draft("office-build")
        self.assertEqual(kernel.state.to_dict(), before)
        self.assertEqual(kernel.store.load_state("local-world").to_dict(), stored)
        self.assertEqual(kernel.store.events("local-world"), [])
        self.assertEqual(kernel.world_draft("office-build")["status"], "draft")
        kernel.store._connection.execute("DROP TRIGGER fail_publish")
        self.assertEqual(kernel.publish_world_draft("office-build")["worldVersion"], 1)

    def test_draft_delete_failure_rolls_back_publication_and_receipt(self):
        kernel = self.make_kernel()
        kernel.create_world_draft(office_draft(), "office-build")
        before = kernel.state.to_dict()
        stored = kernel.store.load_state("local-world").to_dict()
        kernel.store._connection.execute("CREATE TRIGGER fail_draft_delete BEFORE DELETE ON world_build_drafts BEGIN SELECT RAISE(ABORT, 'simulated delete failure'); END")
        with self.assertRaises(sqlite3.IntegrityError):
            kernel.publish_world_draft("office-build")
        self.assertEqual(kernel.state.to_dict(), before)
        self.assertEqual(kernel.store.load_state("local-world").to_dict(), stored)
        self.assertEqual(kernel.store.events("local-world"), [])
        self.assertEqual(len(kernel.store.world_drafts("local-world")), 1)
        restarted = self.reopen(kernel)
        kernel.store._connection.execute("DROP TRIGGER fail_draft_delete")
        published = restarted.publish_world_draft("office-build")
        self.assertEqual(kernel.publish_world_draft("office-build"), published)
        self.assertEqual(restarted.state.world_version, 1)
        self.assertEqual(len(restarted.store.events("local-world")), 1)
        self.assertEqual(restarted.store.world_drafts("local-world"), [])

    def test_concurrent_draft_creation_preserves_the_first_preview(self):
        kernel = self.make_kernel()
        other = self.reopen(kernel)
        ready = threading.Barrier(2)

        def create(owner, narrative):
            ready.wait(timeout=5)
            try:
                return owner.create_world_draft({"narrative": narrative}, "same-id")
            except ValidationError as error:
                return error

        with ThreadPoolExecutor(max_workers=2) as executor:
            futures = [executor.submit(create, owner, narrative) for owner, narrative in ((kernel, "first"), (other, "second"))]
            outcomes = [future.result(timeout=10) for future in futures]
        successes = [item for item in outcomes if isinstance(item, dict)]
        failures = [item for item in outcomes if isinstance(item, ValidationError)]
        self.assertEqual(len(successes), 1)
        self.assertEqual([error.code for error in failures], ["draft_conflict"])
        self.assertEqual(kernel.world_draft("same-id"), successes[0])
        self.assertEqual(other.world_draft("same-id"), successes[0])
        self.assertEqual(len(kernel.store.world_drafts("local-world")), 1)

    def test_cancelled_draft_is_not_visible_or_publishable_by_another_kernel(self):
        kernel = self.make_kernel()
        other = self.reopen(kernel)
        draft = kernel.create_world_draft(office_draft(), "office-build")
        self.assertEqual(other.world_draft("office-build"), draft)
        other.cancel_world_draft("office-build")
        for operation in (kernel.world_draft, kernel.publish_world_draft):
            with self.assertRaises(ValidationError) as missing:
                operation("office-build")
            self.assertEqual(missing.exception.code, "unknown_world_draft")
        self.assertEqual(kernel.store.events("local-world"), [])

    def test_cancel_winning_after_confirmation_read_cannot_revive_draft(self):
        kernel = self.make_kernel()
        other = self.reopen(kernel)
        kernel.create_world_draft(office_draft(), "office-build")
        before = kernel.state.to_dict()
        ready, release = threading.Event(), threading.Event()
        commit = kernel.store.publish_world_draft

        def delayed_commit(*args):
            ready.set()
            self.assertTrue(release.wait(timeout=5))
            return commit(*args)

        with patch.object(kernel.store, "publish_world_draft", side_effect=delayed_commit), ThreadPoolExecutor(max_workers=1) as executor:
            future = executor.submit(kernel.publish_world_draft, "office-build")
            try:
                self.assertTrue(ready.wait(timeout=5))
                other.cancel_world_draft("office-build")
            finally:
                release.set()
            with self.assertRaises(ValidationError) as cancelled:
                future.result(timeout=10)
        self.assertEqual(cancelled.exception.code, "unknown_world_draft")
        self.assertEqual(kernel.state.to_dict(), before)
        self.assertEqual(kernel.store.world_drafts("local-world"), [])
        self.assertEqual(kernel.store.events("local-world"), [])

    def test_confirm_winning_before_cancel_returns_published_conflict(self):
        kernel = self.make_kernel()
        other = self.reopen(kernel)
        kernel.create_world_draft(office_draft(), "office-build")
        ready, release = threading.Event(), threading.Event()
        cancel = other.store.delete_world_draft

        def delayed_cancel(*args):
            ready.set()
            self.assertTrue(release.wait(timeout=5))
            return cancel(*args)

        with patch.object(other.store, "delete_world_draft", side_effect=delayed_cancel), ThreadPoolExecutor(max_workers=1) as executor:
            future = executor.submit(other.cancel_world_draft, "office-build")
            try:
                self.assertTrue(ready.wait(timeout=5))
                published = kernel.publish_world_draft("office-build")
            finally:
                release.set()
            with self.assertRaises(ValidationError) as committed:
                future.result(timeout=10)
        self.assertEqual(committed.exception.code, "world_draft_already_published")
        self.assertEqual(other.publish_world_draft("office-build"), published)
        self.assertEqual(other.state.world_version, 1)
        self.assertIn("deskLamp", other._published_registry().entities)
        self.assertEqual(len(kernel.store.events("local-world")), 1)

    def test_concurrent_confirmations_return_one_receipt_across_connections(self):
        kernel = self.make_kernel()
        other = self.reopen(kernel)
        kernel.create_world_draft(office_draft(), "office-build")
        ready = threading.Barrier(2)
        original = [owner.world_builder._validate_compiled for owner in (kernel, other)]

        def validate(index, compiled):
            checked = original[index](compiled)
            ready.wait(timeout=5)
            return checked

        with patch.object(kernel.world_builder, "_validate_compiled", side_effect=lambda raw: validate(0, raw)), patch.object(other.world_builder, "_validate_compiled", side_effect=lambda raw: validate(1, raw)), ThreadPoolExecutor(max_workers=2) as executor:
            futures = [executor.submit(owner.publish_world_draft, "office-build") for owner in (kernel, other)]
            results = [future.result(timeout=10) for future in futures]
        self.assertEqual(results[0], results[1])
        self.assertEqual(kernel.state.world_version, 1)
        self.assertEqual(other.state.world_version, 1)
        self.assertEqual(len(kernel.store.events("local-world")), 1)
        self.assertEqual(kernel.store.world_drafts("local-world"), [])

    def test_concurrent_confirmations_on_one_kernel_are_idempotent(self):
        kernel = self.make_kernel()
        kernel.create_world_draft(office_draft(), "office-build")
        ready = threading.Barrier(2)

        def confirm():
            ready.wait(timeout=5)
            return kernel.publish_world_draft("office-build")

        with ThreadPoolExecutor(max_workers=2) as executor:
            futures = [executor.submit(confirm) for _ in range(2)]
            results = [future.result(timeout=10) for future in futures]
        self.assertEqual(results[0], results[1])
        self.assertEqual(kernel.state.world_version, 1)
        self.assertEqual(len(kernel.store.events("local-world")), 1)

    def test_persisted_draft_change_after_validation_blocks_publication(self):
        kernel = self.make_kernel()
        other = self.reopen(kernel)
        kernel.create_world_draft(office_draft(), "office-build")
        original = kernel.store.publish_world_draft

        def modify_then_commit(*args):
            changed = other.world_draft("office-build")
            changed["compiled"]["narrative"] = "modified after validation"
            with other.store._connection:
                other.store._connection.execute("UPDATE world_build_drafts SET payload_json = ? WHERE world_id = ? AND draft_id = ?", (json.dumps(changed), "local-world", "office-build"))
            return original(*args)

        with patch.object(kernel.store, "publish_world_draft", side_effect=modify_then_commit), self.assertRaises(ValidationError) as changed:
            kernel.publish_world_draft("office-build")
        self.assertEqual(changed.exception.code, "world_draft_hash_mismatch")
        self.assertEqual(kernel.state.world_version, 0)
        self.assertEqual(kernel.store.events("local-world"), [])
        self.assertEqual(len(kernel.store.world_drafts("local-world")), 1)

    def test_world_version_is_checked_inside_publication_transaction(self):
        kernel = self.make_kernel()
        other = self.reopen(kernel)
        kernel.create_world_draft(office_draft(), "office-build")
        original = kernel.store.publish_world_draft

        def advance_then_commit(*args):
            other.submit_tool({"toolId": "move", "args": {"roomId": "hall"}})
            return original(*args)

        with patch.object(kernel.store, "publish_world_draft", side_effect=advance_then_commit), self.assertRaises(VersionConflict):
            kernel.publish_world_draft("office-build")
        stored = kernel.store.load_state("local-world")
        self.assertEqual(stored.world_version, 1)
        self.assertNotIn("worldBuilds", stored.metadata)
        self.assertNotIn("deskLamp", stored.objects)
        self.assertEqual(len(kernel.store.world_drafts("local-world")), 1)

    def test_later_publication_merges_ids_without_erasing_prior_definitions(self):
        kernel = self.make_kernel()
        kernel.create_world_draft(office_draft(), "office-build")
        kernel.publish_world_draft("office-build")
        second = office_draft()
        second["entities"] = []
        second["schedules"][0].update(id="B-office", agentId="B")
        second["encounters"][0]["weight"] = 5
        kernel.create_world_draft(second, "office-update")
        result = kernel.publish_world_draft("office-update")
        self.assertEqual(kernel.state.metadata["schedules"]["version"], 2)
        self.assertEqual([item["id"] for item in kernel.state.metadata["schedules"]["blocks"]], ["A-office", "B-office"])
        encounters = result["publishedWorld"]["encounters"]
        self.assertEqual(encounters["version"], 2)
        self.assertEqual(len(encounters["items"]), 1)
        self.assertEqual(encounters["items"][0]["weight"], 5)
        self.assertIn("deskLamp", kernel._published_registry().entities)

    def test_republished_vehicle_replaces_runtime_route_kind_and_location(self):
        kernel = self.make_kernel()
        kernel.create_world_draft({"narrative": "车辆迁到会客厅，新增前往车站的路线。", "entities": [{
            "id": "cityBike", "type": "vehicle", "location": {"roomId": "parlor"},
            "state": {"kind": "car", "destinations": ["station"]}, "affordances": ["operate_vehicle"],
        }]}, "vehicle-update")
        kernel.publish_world_draft("vehicle-update")
        vehicle = kernel.state.objects["cityBike"]
        self.assertEqual(vehicle["kind"], "car")
        self.assertEqual(vehicle["destinations"], ["station"])
        self.assertEqual(vehicle["roomId"], "parlor")
        self.assertIsNone(vehicle["zoneId"])
        with self.assertRaises(ValidationError) as removed_route:
            kernel.submit_tool({"toolId": "operate_vehicle", "args": {"entityId": "cityBike", "destinationId": "office"}})
        self.assertEqual(removed_route.exception.code, "unknown_destination")
        result = kernel.submit_tool({"toolId": "operate_vehicle", "args": {"entityId": "cityBike", "destinationId": "station"}})
        self.assertEqual(result["events"][0]["payload"]["mobility"]["kind"], "car")
        self.assertEqual(kernel.state.agents["YOU"].room_id, "station")
        self.assertEqual(self.reopen(kernel).state.objects["cityBike"]["destinations"], ["station"])

    def test_republished_transit_replaces_runtime_stations(self):
        kernel = self.make_kernel()
        kernel.create_world_draft({"narrative": "地铁只服务中央站和公司。", "entities": [{
            "id": "cityMetro", "type": "transit", "location": {"roomId": "station"},
            "state": {"kind": "train", "stations": ["central", "office"]}, "affordances": ["board", "travel", "alight"],
        }]}, "transit-update")
        kernel.publish_world_draft("transit-update")
        kernel.submit_tool({"toolId": "move", "args": {"roomId": "station"}})
        kernel.submit_tool({"toolId": "board", "args": {"entityId": "cityMetro", "stationId": "central"}})
        with self.assertRaises(ValidationError) as removed_stop:
            kernel.submit_tool({"toolId": "travel", "args": {"entityId": "cityMetro", "destinationId": "home"}})
        self.assertEqual(removed_stop.exception.code, "unknown_destination")
        result = kernel.submit_tool({"toolId": "travel", "args": {"entityId": "cityMetro", "destinationId": "office"}})
        self.assertEqual(result["events"][0]["payload"]["mobility"]["kind"], "train")
        self.assertEqual(kernel.state.objects["cityMetro"]["stations"], ["central", "office"])


if __name__ == "__main__":
    unittest.main()
