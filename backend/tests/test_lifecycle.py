import unittest
import time

from backend.app.domain.world import WorldKernel
from backend.app.domain.models import WorldError
from backend.app.store import EventStore
from backend.app.world.clock import default_clock
from backend.app.world.schedule import schedule_matches


class LifecycleTests(unittest.TestCase):
    def make_kernel(self):
        store = EventStore(":memory:")
        self.addCleanup(store.close)
        return WorldKernel(store=store)

    def test_clock_and_projection_are_server_owned_and_replayable(self):
        kernel = self.make_kernel()
        kernel.state.metadata["clock"] = default_clock(now=1000)
        kernel.state.metadata["schedules"] = {
            "version": 1,
            "blocks": [
                {
                    "id": "A-work",
                    "agentId": "A",
                    "recurrence": {"kind": "daily", "days": [1]},
                    "startMinute": 540,
                    "endMinute": 1020,
                    "location": {"roomId": "office", "zoneId": "desk"},
                    "activity": "work",
                    "priority": 20,
                },
                {
                    "id": "B-home",
                    "agentId": "B",
                    "recurrence": {"kind": "daily", "days": [1]},
                    "startMinute": 540,
                    "endMinute": 1020,
                    "location": {"roomId": "home", "zoneId": "kitchen"},
                    "activity": "rest",
                    "priority": 20,
                },
            ],
        }
        first = kernel.advance_world(now=1000)
        self.assertEqual(first["clock"]["minute"], 540)
        self.assertEqual(first["presenceProjections"]["A"]["roomId"], "office")
        self.assertEqual(kernel.state.agents["A"].room_id, "office")
        self.assertTrue(all(event["action"] in {"clock_advanced", "presence_projected"} for event in first["events"]))
        second = kernel.advance_world(now=1000)
        self.assertEqual(second["events"], [])
        after_work = kernel.advance_world(now=1000 + 9 * 60 * 60)
        self.assertEqual(after_work["clock"]["minute"], 1080)
        self.assertEqual(after_work["presenceProjections"]["A"]["roomId"], "parlor")

    def test_interest_activates_only_matching_present_roles_once(self):
        kernel = self.make_kernel()
        kernel.state.metadata["clock"] = default_clock(now=1000)
        kernel.state.metadata["schedules"] = {
            "version": 1,
            "blocks": [
                {"id": "A-work", "agentId": "A", "recurrence": {"days": [1]}, "startMinute": 0, "endMinute": 1440, "location": {"roomId": "office", "zoneId": "desk"}},
                {"id": "B-home", "agentId": "B", "recurrence": {"days": [1]}, "startMinute": 0, "endMinute": 1440, "location": {"roomId": "home", "zoneId": "kitchen"}},
            ],
        }
        first = kernel.update_interest("s-1", "office", "desk", ttl_seconds=60, now=1000)
        self.assertEqual([item["agentId"] for item in first["activated"]], ["A"])
        self.assertEqual(first["activated"][0]["encounterId"], "local-world:1:36:office:A:1")
        second = kernel.heartbeat("s-1", ttl_seconds=60, now=1001)
        self.assertEqual(second["activated"], [])
        self.assertEqual(len([event for event in kernel.store.events("local-world") if event.action == "activation_started"]), 1)
        self.assertEqual(kernel.state.metadata["activation"]["leases"]["s-1"]["roomId"], "office")
        moved = kernel.update_interest("s-1", "home", "kitchen", ttl_seconds=60, now=1002)
        self.assertEqual([item["agentId"] for item in moved["deactivated"]], ["A"])
        self.assertEqual([item["agentId"] for item in moved["activated"]], ["B"])
        self.assertEqual(kernel.state.metadata["activation"]["agents"]["A"]["status"], "dormant")

    def test_schedule_matches_half_open_and_cross_midnight_recurrence(self):
        workday = {
            "recurrence": {"days": [1]},
            "startMinute": 9 * 60,
            "endMinute": 17 * 60,
        }
        self.assertTrue(schedule_matches(workday, 1, 9 * 60))
        self.assertTrue(schedule_matches(workday, 1, 17 * 60 - 1))
        self.assertFalse(schedule_matches(workday, 1, 17 * 60))
        self.assertFalse(schedule_matches(workday, 1, 9 * 60 - 1))

        overnight = {
            "recurrence": {"days": [1]},
            "startMinute": 23 * 60,
            "endMinute": 60,
        }
        self.assertTrue(schedule_matches(overnight, 1, 23 * 60))
        self.assertTrue(schedule_matches(overnight, 2, 30))
        self.assertFalse(schedule_matches(overnight, 2, 60))
        self.assertFalse(schedule_matches(overnight, 2, 23 * 60))

    def _configure_full_day_roles(self, kernel):
        kernel.state.metadata["clock"] = default_clock(now=1000)
        kernel.state.metadata["schedules"] = {
            "version": 1,
            "blocks": [
                {"id": "A-office", "agentId": "A", "recurrence": {"days": [1]}, "startMinute": 0, "endMinute": 1440, "location": {"roomId": "office", "zoneId": "desk"}},
                {"id": "B-home", "agentId": "B", "recurrence": {"days": [1]}, "startMinute": 0, "endMinute": 1440, "location": {"roomId": "home", "zoneId": "kitchen"}},
            ],
        }

    def test_concrete_zone_does_not_match_missing_or_other_zone(self):
        kernel = self.make_kernel()
        self._configure_full_day_roles(kernel)
        self.assertEqual(kernel.update_interest("zone-wrong", "office", "window", now=1000)["activated"], [])
        self.assertEqual([item["agentId"] for item in kernel.update_interest("zone-right", "office", "desk", now=1000)["activated"]], ["A"])

    def test_expired_lease_quiesces_with_checkpoint_and_rejects_heartbeat(self):
        kernel = self.make_kernel()
        self._configure_full_day_roles(kernel)
        result = kernel.update_interest("expiring", "office", "desk", ttl_seconds=1, now=1000)
        self.assertEqual(result["lease"]["generation"], 1)
        kernel.advance_world(now=1002)
        activation = kernel.state.metadata["activation"]["agents"]["A"]
        self.assertEqual(activation["status"], "dormant")
        self.assertIn("checkpoint", activation)
        self.assertIn("summary", activation)
        self.assertTrue(any(item.action == "activation_quiescing" for item in kernel.store.events("local-world")))
        with self.assertRaises(WorldError) as error:
            kernel.heartbeat("expiring", now=1002)
        self.assertEqual(error.exception.code, "unknown_interest")

    def test_lease_generation_token_and_encounter_generation_revoke_stale_scope(self):
        kernel = self.make_kernel()
        self._configure_full_day_roles(kernel)
        first = kernel.update_interest("reenter", "office", "desk", ttl_seconds=60, now=1000)
        token = first["lease"]["token"]
        generation = first["lease"]["generation"]
        moved = kernel.update_interest("reenter", "home", "kitchen", ttl_seconds=60, now=1001)
        self.assertEqual(moved["lease"]["generation"], generation + 1)
        with self.assertRaises(WorldError) as error:
            kernel.heartbeat("reenter", ttl_seconds=60, now=1002, lease_generation=generation, lease_token=token)
        self.assertEqual(error.exception.code, "stale_interest_lease")
        returned = kernel.update_interest("reenter", "office", "desk", ttl_seconds=60, now=1002)
        self.assertTrue(returned["activated"][0]["encounterId"].endswith(":2"))

    def test_schedule_projection_change_quiesces_existing_lease(self):
        kernel = self.make_kernel()
        self._configure_full_day_roles(kernel)
        kernel.update_interest("watcher", "office", "desk", ttl_seconds=60, now=1000)
        kernel.state.metadata["schedules"]["blocks"][0]["location"] = {"roomId": "home", "zoneId": "kitchen"}
        result = kernel.advance_world(now=1001)
        self.assertEqual(kernel.state.metadata["activation"]["agents"]["A"]["status"], "dormant")
        self.assertTrue(any(item["action"] == "activation_stopped" for item in result["events"]))

    def test_default_location_comes_from_published_world_data(self):
        kernel = self.make_kernel()
        kernel.state.metadata["publishedWorld"]["defaultLocations"]["A"] = {"roomId": "garden", "zoneId": "bench"}
        kernel.state.agents["A"].room_id = "office"
        kernel.state.metadata["schedules"] = {"version": 1, "blocks": []}
        kernel.advance_world(now=1000)
        self.assertEqual(kernel.state.metadata["presenceProjections"]["A"]["roomId"], "garden")
        self.assertEqual(kernel.state.agents["A"].room_id, "garden")

    def test_turn_requires_active_lease_when_lifecycle_is_enabled(self):
        kernel = self.make_kernel()
        self._configure_full_day_roles(kernel)
        kernel.state.room_id = "office"
        kernel.state.agents["YOU"].room_id = "office"
        kernel.advance_world(now=1000)
        with self.assertRaises(WorldError) as error:
            kernel.submit_turn({"action": "ask", "target": "A", "text": "你在吗？"})
        self.assertEqual(error.exception.code, "activation_required")

    def test_turn_rejects_active_lease_after_player_leaves_scope(self):
        kernel = self.make_kernel()
        self._configure_full_day_roles(kernel)
        kernel.state.room_id = "office"
        kernel.state.agents["YOU"].room_id = "office"
        kernel.update_interest("scope", "office", "desk", ttl_seconds=60, now=1000)
        kernel.state.room_id = "home"
        kernel.state.agents["YOU"].room_id = "home"
        with self.assertRaises(WorldError) as error:
            kernel.submit_turn({"action": "ask", "target": "A", "text": "你在吗？"})
        self.assertEqual(error.exception.code, "target_out_of_range")


class EncounterResolverTests(unittest.TestCase):
    def make_kernel(self):
        store = EventStore(":memory:")
        self.addCleanup(store.close)
        return WorldKernel(store=store)

    def configure(self, kernel):
        kernel.state.metadata["clock"] = default_clock(now=1000)
        kernel.state.metadata["schedules"] = {
            "version": 1,
            "blocks": [
                {"id": "A-office", "agentId": "A", "recurrence": {"days": [1]}, "startMinute": 0, "endMinute": 1440, "location": {"roomId": "office", "zoneId": "desk"}},
            ],
        }
        kernel.state.metadata["publishedWorld"]["encounters"] = {
            "version": 7,
            "items": [
                {"id": "coffee-spill", "roomId": "office", "zoneId": "desk", "agentIds": ["A"], "weight": 1, "summary": "咖啡差点洒在文件上"},
                {"id": "late-message", "roomId": "office", "zoneId": "desk", "agentIds": ["A"], "weight": 3, "summary": "手机收到一条迟到的消息"},
            ],
        }

    def test_registry_selection_is_stable_and_recorded_once(self):
        first = self.make_kernel()
        self.configure(first)
        activated = first.update_interest("encounter", "office", "desk", ttl_seconds=60, now=1000)["activated"]
        self.assertEqual(len(activated), 1)
        selected = activated[0]["encounter"]
        self.assertEqual(selected["encounterVersion"], 7)
        self.assertIn(selected["candidateId"], {"coffee-spill", "late-message"})
        event = [item for item in first.store.events(first.state.world_id) if item.action == "activation_started"][-1]
        self.assertEqual(event.payload["encounter"], selected)

        # Repeated heartbeat extends the same lease and does not draw/write a
        # second encounter event.
        repeated = first.heartbeat("encounter", ttl_seconds=60, now=1001)
        self.assertEqual(repeated["activated"], [])
        starts = [item for item in first.store.events(first.state.world_id) if item.action == "activation_started"]
        self.assertEqual(len(starts), 1)

        # A fresh kernel replaying the same snapshot computes the same choice.
        replay = self.make_kernel()
        replay.state = first.state.clone()
        from backend.app.world.encounter import resolve_encounter
        self.assertEqual(resolve_encounter(replay.state, {"day": 1, "minute": 540, "clockVersion": 1}, "office", "desk", "A"), selected)


if __name__ == "__main__":
    unittest.main()
