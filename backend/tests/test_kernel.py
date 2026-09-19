import unittest

from backend.app.domain.models import PermissionDenied, VersionConflict
from backend.app.domain.world import WorldKernel


class WorldKernelTests(unittest.TestCase):
    def setUp(self):
        self.world = WorldKernel()

    def test_multi_target_turn_keeps_each_character_autonomous(self):
        result = self.world.submit_turn({
            "actor": "YOU",
            "action": "ask",
            "targets": ["A", "B"],
            "text": "你们愿意当面解释吗？",
            "expectedVersion": 0,
            "idempotencyKey": "turn-1",
        })
        self.assertEqual(result["worldVersion"], 1)
        self.assertEqual([event["actor"] for event in result["events"]], ["YOU", "A", "YOU", "B"])
        self.assertTrue(all(event["actor"] != "A" or event["action"] != "confront" for event in result["events"]))
        self.assertTrue(any(event["actor"] == "A" and event["action"] in {"answer", "deny", "lie", "counter", "silence", "refuse"} for event in result["events"]))

    def test_player_cannot_submit_npc_action(self):
        with self.assertRaises(PermissionDenied) as error:
            self.world.submit_turn({"actor": "A", "action": "answer", "target": "B", "text": "我说。"})
        self.assertEqual(error.exception.code, "player_cannot_control_npc")

    def test_idempotent_retry_returns_original_result_after_version_moves(self):
        request = {"actor": "YOU", "action": "ask", "target": "A", "text": "你愿意解释吗？", "idempotencyKey": "same", "expectedVersion": 0}
        first = self.world.submit_turn(request)
        second = self.world.submit_turn(request)
        self.assertEqual(first, second)
        self.assertEqual(self.world.state.world_version, 1)

    def test_stale_version_has_no_side_effect(self):
        self.world.submit_turn({"actor": "YOU", "action": "ask", "target": "A", "text": "先问一次。", "expectedVersion": 0})
        with self.assertRaises(VersionConflict):
            self.world.submit_turn({"actor": "YOU", "action": "ask", "target": "B", "text": "过期请求。", "expectedVersion": 0})
        self.assertEqual(self.world.state.world_version, 1)

    def test_private_event_is_not_visible_to_unrelated_character(self):
        result = self.world.submit_turn({
            "actor": "YOU", "action": "tell", "target": "A", "channel": "private",
            "text": "这句话只给你。", "expectedVersion": 0,
        })
        event_ids = {event["eventId"] for event in result["events"]}
        visible_to_b = {event["eventId"] for event in self.world.events(0, "B")}
        self.assertFalse(event_ids & visible_to_b)
        self.assertTrue(event_ids & {event["eventId"] for event in self.world.events(0, "A")})

    def test_replay_does_not_call_model(self):
        class ExplodingAgent:
            def propose(self, *args, **kwargs):
                raise AssertionError("replay must not call an agent")

        self.world.submit_turn({"actor": "YOU", "action": "ask", "target": "A", "text": "一次。", "expectedVersion": 0})
        self.world.agent = ExplodingAgent()
        replay = self.world.replay()
        self.assertEqual(replay["snapshot"]["world_version"], 1)
        self.assertEqual(len(replay["events"]), 2)


if __name__ == "__main__":
    unittest.main()
