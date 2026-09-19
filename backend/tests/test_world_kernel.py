import json
import os
import sqlite3
import tempfile
import threading
import time
import unittest
from concurrent.futures import ThreadPoolExecutor

from backend.app.domain.models import PermissionDenied, ValidationError, VersionConflict, WorldError
from backend.app.domain.perception import build_context
from backend.app.domain.resolver import RuleAgent
from backend.app.domain.world import WorldKernel
from backend.app.store import EventStore
from backend.app.world.clock import default_clock
from backend.app.domain.events import make_event


class WorldKernelTests(unittest.TestCase):
    def make_kernel(self):
        self.temp = tempfile.NamedTemporaryFile(suffix=".sqlite", delete=False)
        self.temp.close()
        self.addCleanup(lambda: os.unlink(self.temp.name) if os.path.exists(self.temp.name) else None)
        self.store = EventStore(self.temp.name)
        self.addCleanup(self.store.close)
        return WorldKernel(store=self.store)

    def test_registry_and_player_control_boundary(self):
        kernel = self.make_kernel()
        self.assertEqual(kernel.state.agents["PLAYER_DOLL"].profile.kind, "player_doll")
        self.assertEqual(kernel.state.agents["Z"].profile.kind, "extra")
        self.assertEqual(set("DEFGHIJKLMNOPQRSTUVWXY"), set(kernel.state.agents) - {"PLAYER_DOLL", "YOU", "A", "B", "C", "Z", "ENV"})
        self.assertTrue(all(not kernel.state.agents[code].active for code in "DEFGHIJKLMNOPQRSTUVWXY"))
        self.assertFalse(set("DEFGHIJKLMNOPQRSTUVWXY") & set(kernel.state.present))
        with self.assertRaises(PermissionDenied):
            kernel.submit_turn({"actor": "A", "action": "tell", "target": "B", "text": "你说。"})

    def test_target_agent_responds_without_player_directing_it(self):
        kernel = self.make_kernel()
        result = kernel.submit_turn({"action": "ask", "target": "A", "text": "你愿意解释吗？", "idempotencyKey": "ask-a-1", "expectedVersion": 0})
        self.assertEqual(result["worldVersion"], 1)
        self.assertEqual([event["actor"] for event in result["events"]], ["YOU", "A"])
        self.assertIn(result["events"][1]["action"], {"answer", "deny", "lie", "counter", "silence", "refuse"})
        self.assertNotEqual(result["events"][1]["source"], "player_doll")

    def test_multi_target_responses_are_separate(self):
        kernel = self.make_kernel()
        result = kernel.submit_turn({"action": "ask", "targets": ["A", "B"], "text": "请当面说明。", "idempotencyKey": "ask-ab"})
        self.assertEqual([event["actor"] for event in result["events"][:4]], ["YOU", "A", "YOU", "B"])
        self.assertEqual(result["worldVersion"], 1)

    def test_private_event_is_not_visible_to_other_npc(self):
        kernel = self.make_kernel()
        result = kernel.submit_turn({"action": "ask", "target": "A", "channel": "private", "text": "只告诉我。", "idempotencyKey": "private-a"})
        events = kernel.store.events(kernel.state.world_id)
        context_a = build_context(kernel.state, "A", events)
        context_b = build_context(kernel.state, "B", events)
        self.assertEqual(len(context_a["events"]), 2)
        self.assertEqual(context_b["events"], [])
        self.assertTrue(all(item["channel"] == "private" for item in context_a["events"]))

    def test_environment_feedback_is_deterministic_and_committed(self):
        first = self.make_kernel()
        first_result = first.submit_turn({"action": "use", "payload": {"object": "bell", "verb": "ring"}, "idempotencyKey": "bell-1"})
        self.assertEqual(first_result["events"][-1]["actor"], "ENV")
        self.assertEqual(first_result["events"][-1]["source"], "environment")
        second = self.make_kernel()
        second_result = second.submit_turn({"action": "use", "payload": {"object": "bell", "verb": "ring"}, "idempotencyKey": "bell-1"})
        self.assertEqual(first_result["events"][-1]["payload"], second_result["events"][-1]["payload"])

    def test_expected_version_and_idempotency_are_atomic(self):
        kernel = self.make_kernel()
        request = {"action": "ask", "target": "A", "text": "一次就好。", "idempotencyKey": "once", "expectedVersion": 0}
        first = kernel.submit_turn(request)
        again = kernel.submit_turn(request)
        self.assertEqual(first, again)
        self.assertEqual(kernel.state.world_version, 1)
        with self.assertRaises(VersionConflict):
            kernel.submit_turn({"action": "ask", "target": "B", "text": "过期了。", "expectedVersion": 0})

    def test_replay_reads_store_without_calling_agent(self):
        kernel = self.make_kernel()
        kernel.submit_turn({"action": "observe", "idempotencyKey": "observe-1"})

        class ExplodingAgent:
            def propose(self, *args, **kwargs):
                raise AssertionError("replay must not call an agent")

        kernel.agent = ExplodingAgent()
        replay = kernel.replay()
        self.assertEqual(replay["snapshot"]["world_version"], 1)
        self.assertEqual(len(replay["events"]), 2)

    def test_object_and_room_affordances_are_server_validated(self):
        kernel = self.make_kernel()
        with self.assertRaises(ValidationError) as unknown:
            kernel.submit_turn({"action": "use", "payload": {"object": "knife", "verb": "cut"}})
        self.assertEqual(unknown.exception.code, "unknown_object")
        with self.assertRaises(ValidationError) as unsupported:
            kernel.submit_turn({"action": "use", "payload": {"object": "lamp", "verb": "ring"}})
        self.assertEqual(unsupported.exception.code, "unsupported_object_action")
        with self.assertRaises(ValidationError) as unknown_room:
            kernel.submit_turn({"action": "move", "payload": {"roomId": "secret-room"}})
        self.assertEqual(unknown_room.exception.code, "unknown_room")
        with self.assertRaises(ValidationError) as invalid_verb:
            kernel.submit_turn({"action": "use", "payload": {"object": "lamp", "verb": ["on"]}})
        self.assertEqual(invalid_verb.exception.code, "unsupported_object_action")

        kernel.submit_turn({"action": "move", "payload": {"roomId": "bedroom"}})
        with self.assertRaises(ValidationError) as out_of_range:
            kernel.submit_turn({"action": "use", "payload": {"object": "lamp", "verb": "on"}})
        self.assertEqual(out_of_range.exception.code, "object_out_of_range")
        with self.assertRaises(ValidationError) as distant_target:
            kernel.submit_turn({"action": "ask", "target": "A", "text": "你在哪里？"})
        self.assertEqual(distant_target.exception.code, "target_out_of_range")

    def test_draft_confirm_cancel_lifecycle_is_atomic(self):
        kernel = self.make_kernel()
        raw = {
            "action": "ask",
            "target": "A",
            "text": "先听我说。",
            "draft": True,
            "turnId": "draft-1",
            "expectedVersion": 0,
        }
        draft = kernel.submit_turn(raw)
        self.assertEqual(draft["status"], "draft")
        self.assertEqual(draft["worldVersion"], 0)
        self.assertEqual(kernel.state.world_version, 0)
        self.assertEqual(kernel.store.events(kernel.state.world_id), [])

        committed = kernel.confirm_turn("draft-1")
        self.assertEqual(committed["status"], "committed")
        self.assertEqual(committed["worldVersion"], 1)
        self.assertEqual(len(kernel.store.events(kernel.state.world_id)), 2)
        self.assertEqual(kernel.confirm_turn("draft-1"), committed)

        second = self.make_kernel()
        second.submit_turn({**raw, "turnId": "draft-cancel"})
        cancelled = second.cancel_turn("draft-cancel")
        self.assertEqual(cancelled["status"], "cancelled")
        self.assertEqual(second.state.world_version, 0)
        self.assertEqual(second.store.events(second.state.world_id), [])
        with self.assertRaises(WorldError) as unavailable:
            second.confirm_turn("draft-cancel")
        self.assertEqual(unavailable.exception.code, "unknown_turn")

    def test_draft_survives_kernel_restart_until_confirmed(self):
        kernel = self.make_kernel()
        raw = {
            "action": "ask",
            "target": "B",
            "text": "重启后仍然是同一幕。",
            "draft": True,
            "turnId": "persisted-draft",
            "expectedVersion": 0,
        }
        draft = kernel.submit_turn(raw)
        self.assertEqual(draft["status"], "draft")
        restarted = WorldKernel(store=self.store)
        self.assertEqual(restarted.confirm_turn("persisted-draft")["status"], "committed")
        self.assertEqual(restarted.state.world_version, 1)
        self.assertEqual(self.store.drafts(restarted.state.world_id), [])

    def test_snapshot_version_matches_committed_state(self):
        kernel = self.make_kernel()
        result = kernel.submit_turn({"action": "move", "payload": {"roomId": "bedroom"}})
        self.assertEqual(result["worldVersion"], result["snapshot"]["worldVersion"])
        self.assertEqual(kernel.snapshot()["worldVersion"], kernel.state.world_version)

    def test_turn_id_is_idempotent_after_kernel_restart(self):
        kernel = self.make_kernel()
        request = {
            "turnId": "persisted-turn",
            "action": "ask",
            "target": "A",
            "text": "这次只提交一次。",
            "expectedVersion": 0,
        }
        first = kernel.submit_turn(request)
        restarted = WorldKernel(store=self.store)
        again = restarted.submit_turn(request)
        self.assertEqual(first, again)
        self.assertEqual(len(self.store.events(kernel.state.world_id)), 2)

    def test_event_identity_is_scoped_to_world_and_old_schema_is_migrated(self):
        path = tempfile.NamedTemporaryFile(suffix=".sqlite", delete=False).name
        self.addCleanup(lambda: os.unlink(path) if os.path.exists(path) else None)
        connection = sqlite3.connect(path)
        connection.executescript(
            """
            CREATE TABLE world_snapshots (world_id TEXT PRIMARY KEY, world_version INTEGER NOT NULL, state_json TEXT NOT NULL);
            CREATE TABLE events (event_id TEXT PRIMARY KEY, world_id TEXT NOT NULL, world_version INTEGER NOT NULL, turn_id TEXT NOT NULL, payload_json TEXT NOT NULL);
            CREATE INDEX events_world_version ON events(world_id, world_version);
            """
        )
        for world_id in ("world-a", "world-b"):
            state = WorldKernel(world_id=world_id).state
            event = make_event("turn-" + world_id, 1, 0, "YOU", "observe", None, "public", {}, ["YOU"], "local")
            connection.execute("INSERT INTO world_snapshots VALUES (?, ?, ?)", (world_id, 0, json.dumps(state.to_dict())))
            connection.execute("INSERT INTO events VALUES (?, ?, ?, ?, ?)", (event.event_id, world_id, 1, event.turn_id, json.dumps(event.to_dict())))
        connection.commit()
        connection.close()
        store = EventStore(path)
        self.addCleanup(store.close)
        self.assertEqual(len(store.events("world-a")), 1)
        self.assertEqual(len(store.events("world-b")), 1)
        primary = [row["name"] for row in store._connection.execute("PRAGMA table_info(events)").fetchall() if row["pk"]]
        self.assertEqual(primary, ["world_id", "event_id"])

    def test_relationship_snapshot_is_viewer_filtered(self):
        kernel = self.make_kernel()
        kernel.submit_turn({"action": "ask", "target": "A", "text": "请回答。"})
        self.assertIn("A:YOU", kernel.snapshot("YOU")["relationships"])
        self.assertIn("A:YOU", kernel.snapshot("A")["relationships"])
        self.assertNotIn("A:YOU", kernel.snapshot("B")["relationships"])

    def test_late_agent_result_is_rejected_and_audited(self):
        kernel = self.make_kernel()

        class LateWorldAgent:
            def propose(self, actor, request, state):
                kernel.operation_queue.advance_world()
                return RuleAgent().propose(actor, request, state)

        kernel.agent = LateWorldAgent()
        result = kernel.submit_turn({"action": "ask", "target": "A", "text": "请回答。"})
        self.assertEqual(result["events"][1]["source"], "local")
        audits = kernel.store.audits(kernel.state.world_id)
        self.assertEqual(audits[-1]["eventType"], "generation_fence_reject")
        self.assertEqual(audits[-1]["payload"]["reason"], "result_generation_mismatch")
        self.assertNotIn("请回答", audits[-1]["payload"])

    def test_late_agent_result_is_rejected_after_encounter_generation_changes(self):
        kernel = self.make_kernel()
        kernel.state.metadata["clock"] = default_clock(now=1000)
        kernel.state.metadata["schedules"] = {
            "version": 1,
            "blocks": [
                {
                    "id": "A-office",
                    "agentId": "A",
                    "recurrence": {"days": [1]},
                    "startMinute": 0,
                    "endMinute": 1440,
                    "location": {"roomId": "office", "zoneId": "desk"},
                }
            ],
        }
        kernel.state.room_id = "office"
        kernel.state.agents["YOU"].room_id = "office"
        kernel.update_interest("late-encounter", "office", "desk", ttl_seconds=60, now=1000)
        # The test clock is deterministic while lease validation uses wall
        # time when a turn starts; keep this synthetic lease live for both.
        kernel.state.metadata["activation"]["leases"]["late-encounter"]["expiresAt"] = time.time() + 3600

        class LateEncounterAgent:
            def propose(self, actor, request, state):
                kernel.operation_queue.advance_activation("A")
                return RuleAgent().propose(actor, request, state)

        kernel.agent = LateEncounterAgent()
        result = kernel.submit_turn({"action": "ask", "target": "A", "text": "请回答。"})
        self.assertEqual(result["events"][1]["source"], "local")
        audits = kernel.store.audits(kernel.state.world_id)
        self.assertEqual(audits[-1]["eventType"], "generation_fence_reject")
        self.assertEqual(audits[-1]["payload"]["stage"], "complete")
        self.assertEqual(audits[-1]["payload"]["current"]["activationGeneration"], 2)

    def test_observer_report_is_persisted_without_world_mutation_or_duplicate_spam(self):
        kernel = self.make_kernel()
        kernel.state.metadata["schedules"] = {
            "version": 1,
            "blocks": [
                {
                    "id": "A-morning",
                    "agentId": "A",
                    "priority": 1,
                    "recurrence": {"days": [1]},
                    "startMinute": 0,
                    "endMinute": 120,
                    "location": {"roomId": "office", "zoneId": "desk"},
                },
                {
                    "id": "A-overlap",
                    "agentId": "A",
                    "priority": 1,
                    "recurrence": {"days": [1]},
                    "startMinute": 60,
                    "endMinute": 180,
                    "location": {"roomId": "home", "zoneId": "kitchen"},
                },
            ],
        }
        report = kernel.audit(now=1000)
        self.assertFalse(report["ok"])
        self.assertEqual(report["issues"][0]["code"], "schedule_conflict")
        version = kernel.state.world_version
        audits = kernel.store.audits(kernel.state.world_id)
        self.assertEqual(len(audits), 1)
        self.assertEqual(audits[0]["eventType"], "world_observer_report")
        self.assertEqual(audits[0]["worldVersion"], version)
        self.assertIn("reportHash", audits[0]["payload"])
        self.assertNotIn("prompt", str(audits[0]["payload"]).lower())

        repeated = kernel.audit(now=1000)
        self.assertEqual(repeated, report)
        self.assertEqual(kernel.state.world_version, version)
        self.assertEqual(len(kernel.store.audits(kernel.state.world_id)), 1)

        kernel.store.save_audit(kernel.state.world_id, version, "tool_proposal_rejected", {"reason": "test"})
        self.assertEqual(kernel.audit(now=1000), report)
        self.assertEqual(len(kernel.store.audits(kernel.state.world_id)), 2)

        # A different report can be observed at the same world version. An
        # eventual return to the original report must still reuse its record.
        overlap = kernel.state.metadata["schedules"]["blocks"].pop()
        clean = kernel.audit(now=1000)
        self.assertTrue(clean["ok"])
        kernel.state.metadata["schedules"]["blocks"].append(overlap)
        self.assertEqual(kernel.audit(now=1000), report)
        reports = [item for item in kernel.store.audits(kernel.state.world_id) if item["eventType"] == "world_observer_report"]
        self.assertEqual(len(reports), 2)
        self.assertEqual({item["worldVersion"] for item in reports}, {version})
        self.assertEqual(len({item["payload"]["reportHash"] for item in reports}), 2)

        restarted_store = EventStore(self.temp.name)
        self.addCleanup(restarted_store.close)
        restarted = WorldKernel(store=restarted_store)
        self.assertEqual(restarted.audit(now=1000), report)
        self.assertEqual(restarted_store.audits(kernel.state.world_id), kernel.store.audits(kernel.state.world_id))
        self.assertEqual(len(restarted_store.audits(kernel.state.world_id)), 3)

    def test_observer_report_deduplication_is_atomic_across_connections_and_world_scoped(self):
        kernel = self.make_kernel()
        other_store = EventStore(self.temp.name)
        self.addCleanup(other_store.close)
        ready = threading.Barrier(2)
        payload = {"observerVersion": "deterministic-1", "ok": True, "issues": [], "reportHash": "same-report"}

        def write(store):
            ready.wait(timeout=5)
            return store.save_audit(kernel.state.world_id, 7, "world_observer_report", payload)

        with ThreadPoolExecutor(max_workers=2) as executor:
            futures = [executor.submit(write, store) for store in (kernel.store, other_store)]
            audit_ids = [future.result(timeout=10) for future in futures]
        self.assertEqual(audit_ids[0], audit_ids[1])
        self.assertEqual(len(kernel.store.audits(kernel.state.world_id)), 1)

        other_world_id = other_store.save_audit("another-world", 7, "world_observer_report", payload)
        self.assertNotEqual(other_world_id, audit_ids[0])
        self.assertEqual(len(other_store.audits("another-world")), 1)
        first = kernel.store.save_audit(kernel.state.world_id, 7, "tool_proposal_rejected", payload)
        second = other_store.save_audit(kernel.state.world_id, 7, "tool_proposal_rejected", payload)
        self.assertNotEqual(first, second)
        self.assertEqual(len(kernel.store.audits(kernel.state.world_id)), 3)

    def test_observer_deduplication_migrates_existing_audits_without_removing_history(self):
        legacy_file = tempfile.NamedTemporaryFile(suffix=".sqlite", delete=False)
        legacy_file.close()
        self.addCleanup(lambda: os.unlink(legacy_file.name) if os.path.exists(legacy_file.name) else None)
        original = [
            ("world_observer_report", {"reportHash": "report-a", "ok": False}),
            ("world_observer_report", {"reportHash": "report-b", "ok": True}),
            ("world_observer_report", {"reportHash": "report-a", "ok": False}),
            ("tool_proposal_rejected", {"reportHash": "report-a", "reason": "test"}),
        ]
        with sqlite3.connect(legacy_file.name) as connection:
            connection.execute(
                "CREATE TABLE audit_events (audit_id INTEGER PRIMARY KEY AUTOINCREMENT, "
                "world_id TEXT NOT NULL, world_version INTEGER NOT NULL, event_type TEXT NOT NULL, payload_json TEXT NOT NULL)"
            )
            connection.executemany(
                "INSERT INTO audit_events(world_id, world_version, event_type, payload_json) VALUES (?, ?, ?, ?)",
                [("legacy-world", 7, event_type, json.dumps(payload)) for event_type, payload in original],
            )
        ready = threading.Barrier(2)

        def open_store():
            ready.wait(timeout=5)
            return EventStore(legacy_file.name)

        with ThreadPoolExecutor(max_workers=2) as executor:
            futures = [executor.submit(open_store) for _ in range(2)]
            migrated, other = [future.result(timeout=10) for future in futures]
        self.addCleanup(migrated.close)
        self.addCleanup(other.close)
        history = migrated.audits("legacy-world")
        self.assertEqual([(item["eventType"], item["payload"]) for item in history], original)
        self.assertEqual(migrated.save_audit("legacy-world", 7, "world_observer_report", original[0][1]), history[0]["auditId"])
        self.assertEqual(other.save_audit("legacy-world", 7, "world_observer_report", original[1][1]), history[1]["auditId"])
        self.assertEqual(migrated.audits("legacy-world"), history)


if __name__ == "__main__":
    unittest.main()
