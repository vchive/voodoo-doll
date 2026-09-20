"""Playable chapter acceptance: authority, recovery and available actions."""
import copy
import tempfile
import unittest
from unittest.mock import patch

from backend.app.domain.models import WorldError
from backend.app.domain.world import WorldKernel
from backend.app.gameplay import SinglePlayerGame
from backend.app.narrative import FULL_TEMPLATE_ID, TEMPLATE_ID, guidance
from backend.app.store.event_store import EventStore


class NarrativeTests(unittest.TestCase):
    def setUp(self):
        self.kernel = WorldKernel(world_id="story", store=EventStore(":memory:"))
        self.game = SinglePlayerGame(self.kernel, "story-session")
        self.counter = 0
        self.full_session = 0
        self.start()

    def start(self):
        preview = self.game.story_draft({"templateId": TEMPLATE_ID, "dollName": "小墨", "names": {}})
        return self.game.confirm_story(preview["draftId"], {"expectedVersion": preview["worldVersion"]})

    def full_start(self):
        """Start the three-day tutorial without changing the v1 fixtures."""
        preview = self.game.story_draft({"templateId": FULL_TEMPLATE_ID, "dollName": "小墨", "names": {}})
        self.counter = 0
        self.full_session += 1
        return self.game.confirm_story(preview["draftId"], {"expectedVersion": preview["worldVersion"]})

    def full_action(self, action_id):
        """Confirm one authored v2 action by its stable guidance id."""
        action = next((item for item in self.game.snapshot()["guidance"]["actions"]
                       if item["id"] == action_id), None)
        self.assertIsNotNone(action, "missing v2 action " + action_id)
        self.counter += 1
        request_id = "v2-{}-{}-{}".format(self.full_session, self.counter, action_id)
        draft = self.game.intent({"text": action["intent"], "requestId": request_id,
                                  "expectedVersion": self.kernel.state.world_version})
        return self.game.confirm_intent(draft["turnId"])

    def full_to_day2(self, route="trust"):
        for action_id in ("full-arrival", "full-depart", "full-station", "full-station-clue",
                          "full-office", "full-work", "full-meeting", "full-" + route,
                          "full-day1-home"):
            self.full_action(action_id)
        self.assertEqual(self.kernel.state.metadata["narrative"]["step"], "day2-start")

    def full_to_complete(self, route="trust", branch="station"):
        self.full_to_day2(route)
        if branch == "station":
            actions = ("full-day2-station", "full-day2-station-arrived", "full-day2-station-clue",
                       "full-day2-office", "full-day2-office-card", "full-day2-audit", "full-day2-home")
        else:
            actions = ("full-day2-kitchen", "full-day2-kitchen-arrived", "full-day2-recording",
                       "full-day2-office", "full-day2-office-card", "full-day2-audit", "full-day2-home")
        for action_id in actions:
            self.full_action(action_id)
        for action_id in ("full-day3-archive", "full-day3-archive", "full-day3-hearing",
                          "full-final-" + route, "full-final-home"):
            self.full_action(action_id)
        self.assertTrue(self.game.snapshot()["guidance"]["completed"])
        return self.kernel.state.metadata["narrative"]

    def turn(self, text):
        self.counter += 1
        draft = self.game.intent({"text": text, "requestId": "play-" + str(self.counter), "expectedVersion": self.kernel.state.world_version})
        return self.game.confirm_intent(draft["turnId"])

    def play_to(self, target):
        for _ in range(15):
            if self.kernel.state.metadata["narrative"]["step"] == target:
                return
            self.turn(self.game.snapshot()["guidance"]["actions"][0]["intent"])
        self.fail("chapter did not reach " + target)

    def complete_main_story(self, branch="trust"):
        self.play_to("choice")
        action = next(item for item in self.game.snapshot()["guidance"]["actions"]
                      if item["id"] == "story-" + branch)
        self.turn(action["intent"])
        self.play_to("complete")

    def test_full_template_has_three_complete_routes_and_two_day_two_investigation_windows(self):
        outcomes = {}
        for route, branch in (("trust", "station"), ("audit", "station"), ("protect", "kitchen")):
            self.full_start()
            narrative = self.full_to_complete(route, branch)
            outcomes[route] = copy.deepcopy(narrative)
            self.assertEqual(narrative["templateId"], FULL_TEMPLATE_ID)
            self.assertEqual(narrative["version"], 2)
            self.assertEqual(narrative["ending"], route)
            self.assertEqual(narrative["route"], route)
            self.assertTrue(narrative["completed"])
            self.assertTrue(narrative["facts"]["passOrigin"])
            self.assertIn("future-register", narrative["clues"])
            self.assertIn("archive-card", narrative["clues"])
            if branch == "station":
                self.assertTrue(narrative["facts"]["umbrellaNumber"])
                self.assertIn("handover-card", narrative["clues"])
                self.assertFalse(narrative["facts"]["recordingHeard"])
            else:
                self.assertTrue(narrative["facts"]["recordingHeard"])
                self.assertIn("qing-recording", narrative["clues"])
                self.assertNotIn("handover-card", narrative["clues"])

        self.assertEqual({value["ending"] for value in outcomes.values()}, {"trust", "audit", "protect"})
        self.assertNotEqual(outcomes["trust"]["clues"], outcomes["audit"]["clues"])
        self.assertNotEqual(outcomes["trust"]["clues"], outcomes["protect"]["clues"])

    def test_full_template_final_decision_can_change_first_day_route(self):
        """The last Galgame choice must be real, not a cosmetic replay button."""
        self.full_start()
        self.full_to_day2("trust")
        for action_id in ("full-day2-station", "full-day2-station-arrived", "full-day2-station-clue",
                          "full-day2-office", "full-day2-office-card", "full-day2-audit", "full-day2-home",
                          "full-day3-archive", "full-day3-archive", "full-day3-hearing", "full-final-protect"):
            self.full_action(action_id)
        narrative = self.kernel.state.metadata["narrative"]
        self.assertEqual(narrative["day1Route"], "trust")
        self.assertEqual(narrative["finalChoice"], "protect")
        self.assertEqual(narrative["route"], "protect")
        self.assertEqual(narrative["ending"], "protect")

    def test_full_template_station_and_kitchen_paths_are_live_at_their_scheduled_times(self):
        for branch, expected_step, fact in (("station", "day2-station", "umbrellaNumber"),
                                             ("kitchen", "day2-kitchen", "recordingHeard")):
            self.full_start()
            self.full_to_day2("trust")
            self.assertEqual(self.kernel.state.metadata["narrative"]["step"], "day2-start")
            first = "full-day2-" + branch
            self.full_action(first)
            self.assertEqual(self.kernel.state.metadata["narrative"]["step"], expected_step)
            self.assertEqual(self.game.snapshot()["clock"]["day"], 2)
            expected_actor = "C" if branch == "station" else "B"
            expected_room = "station" if branch == "station" else "kitchen"
            self.assertEqual(self.kernel.state.agents[expected_actor].room_id, expected_room)
            self.assertIn(expected_actor, self.game.snapshot()["present"])
            self.full_action("full-day2-" + ("station-arrived" if branch == "station" else "kitchen-arrived"))
            self.full_action("full-day2-" + ("station-clue" if branch == "station" else "recording"))
            self.assertTrue(self.kernel.state.metadata["narrative"]["facts"][fact])

    def test_full_template_preview_and_cancel_never_advance_story(self):
        self.full_start()
        before = self.kernel.state.to_dict()
        before_events = self.kernel.events()
        preview = self.game.intent({"text": "观察周围", "requestId": "v2-preview"})
        self.assertEqual(preview["status"], "draft")
        self.assertEqual(preview["preview"]["action"], "observe")
        self.assertEqual(self.kernel.state.to_dict(), before)
        self.assertEqual(self.kernel.events(), before_events)
        self.game.cancel_intent("v2-preview")
        self.assertEqual(self.kernel.state.to_dict(), before)
        self.assertEqual(self.kernel.events(), before_events)
        self.assertEqual(self.kernel.state.metadata["narrative"]["step"], "arrival")

    def test_full_template_unknown_action_is_rejected_without_time_or_story_changes(self):
        self.full_start()
        before = self.kernel.state.to_dict()
        before_events = self.kernel.events()
        with self.assertRaises(WorldError) as error:
            self.game.intent({"text": "开一艘不存在的飞船", "requestId": "v2-unknown"})
        self.assertEqual(error.exception.code, "unsupported_intent")
        self.assertEqual(self.kernel.state.to_dict(), before)
        self.assertEqual(self.kernel.events(), before_events)

    def test_full_template_missing_day_one_window_records_missed_ending(self):
        self.full_start()
        for action_id in ("full-arrival", "full-depart", "full-station", "full-station-clue",
                          "full-office", "full-work", "full-meeting"):
            self.full_action(action_id)
        self.assertEqual(self.kernel.state.metadata["narrative"]["step"], "day1-choice")
        self.turn("等待60分钟")
        narrative = self.kernel.state.metadata["narrative"]
        self.assertEqual(narrative["ending"], "missed")
        self.assertEqual(narrative["choice"], "missed")
        self.assertEqual(narrative["step"], "day1-home")
        self.assertIn("day1-meeting", narrative["missedWindows"])
        self.assertFalse(narrative["completed"])

    def test_full_template_save_import_restores_mid_story_and_can_finish(self):
        self.full_start()
        self.full_to_day2("protect")
        self.full_action("full-day2-kitchen")
        self.full_action("full-day2-kitchen-arrived")
        self.full_action("full-day2-recording")
        saved = self.game.export_save()
        self.assertEqual(saved["narrative"]["templateId"], FULL_TEMPLATE_ID)
        self.assertEqual(saved["narrative"]["step"], "day2-office")

        restored = SinglePlayerGame(WorldKernel(world_id="v2-restored", store=EventStore(":memory:")),
                                    "v2-restored-session")
        imported = restored.import_save({"sourceKey": "voodoo-single-v1", "payload": saved})
        self.assertEqual(imported["snapshot"]["narrative"]["templateId"], FULL_TEMPLATE_ID)
        self.assertEqual(imported["snapshot"]["narrative"]["step"], "day2-office")
        self.assertTrue(imported["snapshot"]["narrative"]["facts"]["recordingHeard"])
        self.assertEqual(imported["snapshot"]["clock"]["day"], 2)

        self.kernel, self.game = restored.kernel, restored
        self.counter = 0
        for action_id in ("full-day2-office", "full-day2-office-card", "full-day2-audit", "full-day2-home", "full-day3-archive",
                          "full-day3-archive", "full-day3-hearing", "full-final-protect", "full-final-home"):
            self.full_action(action_id)
        self.assertEqual(self.kernel.state.metadata["narrative"]["ending"], "protect")
        self.assertTrue(self.game.snapshot()["guidance"]["completed"])

    def test_both_authored_choices_complete_and_work_has_real_state(self):
        for branch in ("trust", "question"):
            if branch == "question":
                self.start()
            self.play_to("choice")
            self.assertTrue(self.kernel.state.metadata["narrative"]["workDone"])
            self.assertEqual(self.kernel.state.objects["desk"]["lastAction"], "use")
            self.assertIn("已完成", self.game.snapshot()["guidance"]["playerRoutine"])
            action = next(item for item in guidance(self.kernel.state)["actions"] if item["id"] == "story-" + branch)
            result = self.turn(action["intent"])
            self.assertTrue(any(event["actor"] == "A" and event["payload"].get("text") for event in result["events"]))
            self.play_to("complete")
            self.assertEqual(self.game.snapshot()["guidance"]["ending"], branch)
            self.assertTrue(self.game.snapshot()["guidance"]["completed"])
            self.assertEqual(self.kernel.state.agents["YOU"].room_id, "home")
            self.assertTrue(self.kernel.state.objects["homeDoor"]["isOpen"])
            # Completion does not lock the world.
            self.assertEqual(self.turn("去地铁站")["snapshot"]["roomId"], "station")

    def test_every_recommended_action_previews_without_consuming_any_state(self):
        for _ in range(11):
            before = self.kernel.state.to_dict()
            for index, action in enumerate(self.game.snapshot()["guidance"]["actions"]):
                identifier = f"check-{self.counter}-{index}"
                preview = self.game.intent({"text": action["intent"], "requestId": identifier})
                self.assertEqual(preview["status"], "draft")
                self.assertEqual(before, self.kernel.state.to_dict())
                self.game.cancel_intent(identifier)
                self.assertEqual(before, self.kernel.state.to_dict())
            if self.kernel.state.metadata["narrative"]["step"] == "complete":
                break
            self.turn(self.game.snapshot()["guidance"]["actions"][0]["intent"])
        self.assertTrue(self.game.snapshot()["guidance"]["completed"])

    def test_unknown_input_does_not_consume_time_or_chapter_or_event(self):
        for text in ("开保险柜", "打开不存在的暗门", "我要召唤宇宙飞船看看", "我在家为什么不开心", "工作以后是不是去办公室"):
            before = self.kernel.state.to_dict()
            events = self.kernel.events()
            with self.assertRaises(WorldError) as error:
                self.game.intent({"text": text})
            self.assertEqual(error.exception.code, "unsupported_intent")
            self.assertEqual(self.kernel.state.to_dict(), before)
            self.assertEqual(self.kernel.events(), events)

    def test_open_door_resolves_current_scene_and_is_persistent(self):
        self.turn("去地铁站")
        before_minute = self.game.snapshot()["clock"]["minute"]
        preview = self.game.intent({"text": "去开门，看看里面有啥东西", "requestId": "station-door"})
        self.assertEqual(preview["preview"]["action"], "use")
        self.assertEqual(preview["preview"]["payload"]["objectId"], "stationDoor")
        self.assertEqual(preview["preview"]["payload"]["verb"], "open")
        result = self.game.confirm_intent("station-door")
        self.assertEqual(result["snapshot"]["clock"]["minute"], before_minute + 2)
        self.assertTrue(self.kernel.state.objects["stationDoor"]["isOpen"])
        text = "".join(event["payload"].get("text", "") or "" for event in result["events"])
        self.assertIn("换乘通道", text)
        self.assertNotIn("做了open", text)
        self.assertEqual(self.game.confirm_intent("station-door"), result)
        self.turn("关门")
        self.assertFalse(self.kernel.state.objects["stationDoor"]["isOpen"])

    def test_wait_closes_opportunity_and_npc_really_leaves_office(self):
        self.play_to("talk")
        self.assertIn("A", self.game.snapshot()["present"])
        result = self.turn("等待60分钟")
        self.assertNotIn("A", result["snapshot"]["present"])
        self.assertEqual(self.kernel.state.agents["A"].room_id, "home")
        self.assertEqual(result["snapshot"]["guidance"]["ending"], "missed")
        self.assertEqual(self.kernel.state.metadata["narrative"]["ending"], "missed")
        self.assertFalse(any(item["id"] == "talk-A" for item in result["snapshot"]["guidance"]["actions"]))
        with self.assertRaises(WorldError):
            self.game.intent({"text": "问林川：那封辞职信是怎么回事？"})

    def test_preview_before_deadline_cannot_confirm_after_character_departure(self):
        self.play_to("talk")
        anchor = self.kernel.state.metadata["clock"]["anchorEpoch"]
        self.kernel.state.metadata["clock"].update(minute=599, anchorMinute=599, anchorEpoch=anchor)
        draft = self.game.intent({"text": "问林川：辞职信是怎么回事？", "requestId": "late-ask"})
        before = self.kernel.state.to_dict()
        with patch("time.time", return_value=anchor + 61):
            with self.assertRaises(WorldError) as error:
                self.game.confirm_intent(draft["turnId"])
        self.assertIn(error.exception.code, ("target_out_of_range", "target_not_in_room", "target_not_present"))
        self.assertEqual(self.kernel.state.to_dict(), before)

    def test_store_failure_rolls_back_clock_object_work_and_chapter_together(self):
        self.play_to("work")
        draft = self.game.intent({"text": "使用办公桌", "requestId": "atomic-work"})
        before = self.kernel.state.to_dict()
        with patch.object(self.kernel.store, "save_turn", side_effect=RuntimeError("disk interrupted")):
            with self.assertRaises(RuntimeError):
                self.game.confirm_intent(draft["turnId"])
        self.assertEqual(self.kernel.state.to_dict(), before)
        self.assertEqual(self.kernel.store.load_state("story").to_dict(), before)
        result = self.game.confirm_intent(draft["turnId"])
        self.assertEqual(self.kernel.state.metadata["narrative"]["step"], "talk")
        self.assertTrue(self.kernel.state.metadata["narrative"]["workDone"])
        self.assertEqual(self.game.confirm_intent(draft["turnId"]), result)

    def test_restart_and_export_import_restore_server_chapter(self):
        with tempfile.TemporaryDirectory() as directory:
            filename = directory + "/world.sqlite3"
            self.kernel = WorldKernel(world_id="story", store=EventStore(filename))
            self.game = SinglePlayerGame(self.kernel, "story-session")
            self.start()
            self.play_to("work")
            draft = self.game.intent({"text": "使用办公桌", "requestId": "recover-work"})
            restarted = SinglePlayerGame(WorldKernel(world_id="story", store=EventStore(filename)), "story-session")
            self.assertEqual(restarted.snapshot()["guidance"]["chapter"], "第三章 · 你的名字在值班表上")
            result = restarted.confirm_intent(draft["turnId"])
            second = SinglePlayerGame(WorldKernel(world_id="story", store=EventStore(filename)), "story-session")
            self.assertEqual(second.confirm_intent(draft["turnId"]), result)
            saved = second.export_save()
            other = SinglePlayerGame(WorldKernel(world_id="other", store=EventStore(":memory:")), "other-session")
            imported = other.import_save({"sourceKey": "voodoo-single-v1", "payload": saved})
            self.assertEqual(other.kernel.state.metadata["narrative"], second.kernel.state.metadata["narrative"])
            self.assertEqual(imported["snapshot"]["guidance"]["chapter"], "第四章 · 未寄出的信")
            self.assertIn("已完成", imported["snapshot"]["guidance"]["playerRoutine"])

    def test_custom_story_never_receives_template_facts_or_resets_position(self):
        self.turn("去地铁站")
        before_clock = self.game.snapshot()["clock"]["minute"]
        custom = self.game.story_draft({"dollName": "墨", "story": "我住在一座安静的小城", "names": {"A": "阿原"}})
        result = self.game.confirm_story(custom["draftId"])
        self.assertNotIn("narrative", self.kernel.state.metadata)
        self.assertEqual(result["snapshot"]["roomId"], "station")
        self.assertEqual(result["snapshot"]["clock"]["minute"], before_clock)
        self.assertNotIn("辞职", str(result["snapshot"]["guidance"]))
        self.assertNotIn("playerRoutine", result["snapshot"]["guidance"])

    def test_new_template_resets_old_location_clock_and_can_recover_publish_crash(self):
        self.turn("去地铁站")
        self.turn("等待120分钟")
        draft = self.game.story_draft({"templateId": TEMPLATE_ID})
        # Simulate the API process stopping after the atomic publication,
        # before the product receipt is written.
        self.kernel.publish_world_draft(draft["draftId"], draft["worldVersion"])
        self.assertEqual(self.kernel.state.metadata["narrative"]["step"], "observe")
        result = self.game.confirm_story(draft["draftId"])
        self.assertEqual(result["snapshot"]["roomId"], "parlor")
        self.assertEqual(result["snapshot"]["clock"]["minute"], 540)
        self.assertFalse(result["snapshot"]["guidance"]["completed"])
        self.assertEqual(self.game.confirm_story(draft["draftId"]), result)

    def test_expired_reading_lease_renews_for_preview_and_confirmation(self):
        self.play_to("talk")
        original_minute = self.game.snapshot()["clock"]["minute"]
        original_narrative = copy.deepcopy(self.kernel.state.metadata["narrative"])
        anchor = self.kernel.state.metadata["clock"]["anchorEpoch"]
        with patch("time.time", return_value=anchor + 91):
            before = self.kernel.state.to_dict()
            with self.assertRaises(WorldError):
                self.game.intent({"text": "召唤飞船"})
            self.assertEqual(self.kernel.state.to_dict(), before)
            preview = self.game.intent({"text": "问林川：辞职信是怎么回事？", "requestId": "idle-read", "expectedVersion": before["world_version"]})
            self.assertEqual(self.kernel.state.metadata["narrative"], original_narrative)
            self.assertEqual(preview["snapshot"]["clock"]["minute"], original_minute + 1)
        with patch("time.time", return_value=anchor + 182):
            result = self.game.confirm_intent("idle-read", {"expectedVersion": preview["worldVersion"]})
            self.assertEqual(self.kernel.state.metadata["narrative"]["step"], "choice")
            self.assertTrue(any(event["actor"] == "A" for event in result["events"]))
            self.assertEqual(result["snapshot"]["clock"]["minute"], original_minute + 6)

    def test_missed_or_early_conversation_cannot_reveal_exclusive_story(self):
        self.turn("去办公室")
        early = self.turn("问林川：我相信你，辞职信有什么证据？")
        text = "".join(event["payload"].get("text", "") or "" for event in early["events"] if event["actor"] == "A")
        self.assertNotIn("擦掉", text)
        self.assertEqual(self.kernel.state.metadata["narrative"]["step"], "observe")
        self.turn("等待60分钟")
        self.turn("回家")
        late = self.turn("问林川：辞职信是怎么回事？")
        text = "".join(event["payload"].get("text", "") or "" for event in late["events"] if event["actor"] == "A")
        self.assertIn("约定已经过去", text)
        self.assertNotIn("三分钟", text)
        self.assertEqual(late["snapshot"]["guidance"]["ending"], "missed")

    def test_natural_deadline_persists_missed_without_player_action(self):
        anchor = self.kernel.state.metadata["clock"]["anchorEpoch"]
        with patch("time.time", return_value=anchor + 3601):
            result = self.kernel.advance_world()
            self.assertEqual(self.kernel.state.metadata["narrative"]["ending"], "missed")
            self.assertTrue(any(event["action"] == "chapter_completed" for event in result["events"]))
            self.assertEqual(self.kernel.store.load_state("story").metadata["narrative"]["ending"], "missed")

    def test_optional_postscript_completes_with_present_npc_and_preserves_ending(self):
        self.complete_main_story("trust")
        self.assertEqual(self.kernel.state.metadata["narrative"]["ending"], "trust")
        self.assertEqual(self.kernel.state.metadata["narrative"]["postscript"]["step"], "ready")
        self.assertIn("可选支线", self.game.snapshot()["guidance"]["objective"])
        ready_actions = self.game.snapshot()["guidance"]["actions"]
        self.assertEqual(ready_actions[0]["id"], "postscript-start")
        self.assertIn("观察周围", [item["intent"] for item in ready_actions])
        self.assertIn("等待10分钟", [item["intent"] for item in ready_actions])

        self.turn(ready_actions[0]["intent"])
        self.assertEqual(self.kernel.state.metadata["narrative"]["postscript"]["step"], "station")
        self.assertIn("C", self.game.snapshot()["present"])
        self.assertEqual(self.game.snapshot()["guidance"]["actions"][0]["id"], "postscript-station-talk")

        self.turn(self.game.snapshot()["guidance"]["actions"][0]["intent"])
        postscript = self.kernel.state.metadata["narrative"]["postscript"]
        self.assertEqual(postscript["step"], "office")
        self.assertIn("station-pass", postscript["clues"])
        self.assertEqual(self.kernel.state.metadata["narrative"]["ending"], "trust")

        self.turn(self.game.snapshot()["guidance"]["actions"][0]["intent"])
        self.assertEqual(self.kernel.state.metadata["narrative"]["postscript"]["step"], "office")
        self.turn(self.game.snapshot()["guidance"]["actions"][0]["intent"])
        self.assertEqual(self.kernel.state.metadata["narrative"]["postscript"]["step"], "home")
        self.turn(self.game.snapshot()["guidance"]["actions"][0]["intent"])
        self.assertEqual(self.kernel.state.metadata["narrative"]["postscript"]["step"], "home")
        self.turn(self.game.snapshot()["guidance"]["actions"][0]["intent"])
        postscript = self.kernel.state.metadata["narrative"]["postscript"]
        self.assertTrue(postscript["completed"])
        self.assertEqual(postscript["step"], "complete")
        self.assertIn("archive-card", postscript["clues"])
        self.assertEqual(self.kernel.state.metadata["narrative"]["ending"], "trust")
        self.assertTrue(self.game.snapshot()["guidance"]["completed"])

    def test_postscript_ready_keeps_current_scene_actions_available(self):
        self.complete_main_story("trust")
        view = self.game.snapshot()["guidance"]
        self.assertEqual(view["actions"][0]["id"], "postscript-start")
        self.assertIn("observe", [item["id"] for item in view["actions"]])
        self.assertIn("wait", [item["id"] for item in view["actions"]])
        self.assertTrue(any(item["intent"] == "去开门，看看里面有啥东西" for item in view["actions"]))

    def test_optional_postscript_uses_public_registration_when_npc_left(self):
        self.complete_main_story("question")
        schedules = self.kernel.state.metadata["schedules"]["blocks"]
        self.kernel.state.metadata["schedules"]["blocks"] = [
            block for block in schedules if block.get("agentId") != "C"
        ] + [{
            "id": "C-postscript-home", "agentId": "C", "startMinute": 0,
            "endMinute": 1440, "location": {"roomId": "home"},
            "recurrence": {"kind": "daily", "days": list(range(1, 8))},
            "activity": "rest", "priority": 99,
        }]

        self.turn("去地铁站")
        guidance_view = self.game.snapshot()["guidance"]
        self.assertNotIn("C", self.game.snapshot()["present"])
        self.assertEqual(guidance_view["actions"][0]["id"], "postscript-station-observe")
        self.assertTrue(all(line["speakerId"] in ("ENV", "YOU") for line in guidance_view["dialogue"]))

        self.turn(guidance_view["actions"][0]["intent"])
        self.assertEqual(self.kernel.state.metadata["narrative"]["postscript"]["step"], "office")
        self.assertIn("station-pass-late", self.kernel.state.metadata["narrative"]["postscript"]["clues"])

    def test_optional_postscript_save_import_and_old_save_compatibility(self):
        self.complete_main_story("trust")
        self.turn("去地铁站")
        self.turn("问周野：伞柄上的日期是什么？")
        self.turn("去办公室")
        saved = self.game.export_save()
        self.assertEqual(saved["narrative"]["postscript"]["step"], "office")
        self.assertEqual(saved["snapshot"]["roomId"], "office")

        restored = SinglePlayerGame(WorldKernel(world_id="restored-postscript", store=EventStore(":memory:")),
                                    "restored-postscript-session")
        imported = restored.import_save({"sourceKey": "voodoo-single-v1", "payload": saved})
        self.assertEqual(imported["snapshot"]["narrative"]["postscript"]["step"], "office")
        restored_action = imported["snapshot"]["guidance"]["actions"][0]["intent"]
        draft = restored.intent({"text": restored_action, "requestId": "restored-postscript-action"})
        restored.confirm_intent(draft["turnId"])
        self.assertEqual(restored.kernel.state.metadata["narrative"]["postscript"]["step"], "home")
        self.assertEqual(restored.kernel.state.metadata["narrative"]["ending"], "trust")

        old_save = self.game.export_save()
        old_save["narrative"].pop("postscript", None)
        compatible = SinglePlayerGame(WorldKernel(world_id="old-postscript", store=EventStore(":memory:")),
                                      "old-postscript-session")
        old_import = compatible.import_save({"sourceKey": "voodoo-single-v1", "payload": old_save})
        self.assertNotIn("postscript", old_import["snapshot"]["narrative"])
        draft = compatible.intent({"text": "去地铁站", "requestId": "old-postscript-start"})
        compatible.confirm_intent(draft["turnId"])
        self.assertEqual(compatible.kernel.state.metadata["narrative"]["postscript"]["step"], "station")

    def test_cached_snapshot_export_restores_cast_and_can_continue_playing(self):
        self.play_to("station-door")
        # The offline client only has the public profile and snapshot.
        envelope = {"profile": self.game.profile, "snapshot": self.game.snapshot()}
        other = SinglePlayerGame(WorldKernel(world_id="restored", store=EventStore(":memory:")), "restored-session")
        other.import_save({"sourceKey": "voodoo-single-v1", "payload": envelope})
        self.kernel, self.game = other.kernel, other
        self.play_to("complete")
        self.assertEqual(self.game.snapshot()["guidance"]["ending"], "trust")
        self.assertTrue(self.kernel.state.metadata["narrative"]["workDone"])

    def test_invalid_narrative_import_is_atomic(self):
        saved = self.game.export_save()
        saved["narrative"]["step"] = "invalid-chapter"
        before = self.kernel.state.to_dict()
        with self.assertRaises(WorldError) as error:
            self.game.import_save({"sourceKey": "voodoo-single-v1", "payload": saved})
        self.assertEqual(error.exception.code, "invalid_save_payload")
        self.assertEqual(self.kernel.state.to_dict(), before)

    def test_story_preview_survives_lifecycle_refresh_but_not_player_edits(self):
        draft = self.game.story_draft({"templateId": TEMPLATE_ID})
        anchor = self.kernel.state.metadata["clock"]["anchorEpoch"]
        with patch("time.time", return_value=anchor + 91):
            self.game._ensure_interest()
            result = self.game.confirm_story(draft["draftId"], {"expectedVersion": draft["worldVersion"]})
        self.assertEqual(result["snapshot"]["clock"]["minute"], 540)
        changed = self.game.story_draft({"templateId": TEMPLATE_ID})
        self.turn("去地铁站")
        before = self.kernel.state.to_dict()
        with self.assertRaises(WorldError) as error:
            self.game.confirm_story(changed["draftId"], {"expectedVersion": self.kernel.state.world_version})
        self.assertEqual(error.exception.code, "version_conflict")
        self.assertEqual(self.kernel.state.to_dict(), before)

    def test_action_preview_survives_lifecycle_refresh_but_not_concurrent_action(self):
        self.play_to("talk")
        draft = self.game.intent({"text": "问林川：辞职信是怎么回事？", "requestId": "refresh-action", "expectedVersion": self.kernel.state.world_version})
        anchor = self.kernel.state.metadata["clock"]["anchorEpoch"]
        with patch("time.time", return_value=anchor + 91):
            self.game._ensure_interest()
            self.game.confirm_intent(draft["turnId"], {"expectedVersion": draft["worldVersion"]})
        second = self.game.intent({"text": "问林川：我相信你", "requestId": "concurrent-action", "expectedVersion": self.kernel.state.world_version})
        self.turn("观察周围")
        before = self.kernel.state.to_dict()
        with self.assertRaises(WorldError) as error:
            self.game.confirm_intent(second["turnId"], {"expectedVersion": self.kernel.state.world_version})
        self.assertEqual(error.exception.code, "version_conflict")
        self.assertEqual(self.kernel.state.to_dict(), before)

    def test_pre_template_backup_restores_custom_cast_and_timetable(self):
        custom = self.game.story_draft({"dollName": "旧墨", "story": "平静的城市", "names": {"A": "阿原"}})
        self.game.confirm_story(custom["draftId"])
        self.turn("去地铁站")
        self.turn("等待120分钟")
        saved = self.game.export_save()
        self.start()
        restored = self.game.import_save({"sourceKey": "voodoo-single-v1", "payload": saved})
        self.assertIsNone(restored["snapshot"]["narrative"])
        self.assertEqual(restored["snapshot"]["roomId"], "station")
        arrived = self.turn("去办公室")
        self.assertIn("A", arrived["snapshot"]["present"])
        response = self.turn("问阿原：今天怎么样？")
        self.assertTrue(any(event["actor"] == "A" for event in response["events"]))
        self.assertNotIn("辞职", str(response["snapshot"]["guidance"]))

    def test_detour_guidance_always_returns_to_relevant_scene(self):
        for step in ("observe", "station-door", "work", "choice", "home-door"):
            self.start()
            self.play_to(step)
            self.turn("去花园")
            action = self.game.snapshot()["guidance"]["actions"][0]
            self.assertEqual(action["id"], "story-return")
            self.turn(action["intent"])
            self.assertEqual(self.kernel.state.metadata["narrative"]["step"], step)

    def test_dialogue_walkthrough_has_public_attributed_lines_without_world_effects(self):
        seen_kinds = set()
        seen_ids = set()
        for _ in range(11):
            before = self.kernel.state.to_dict()
            before_events = self.kernel.events()
            view = guidance(self.kernel.state)
            self.assertNotIn(view["dialogueId"], seen_ids)
            seen_ids.add(view["dialogueId"])
            self.assertGreaterEqual(len(view["dialogue"]), 3)
            self.assertLessEqual(len(view["dialogue"]), 5)
            for line in view["dialogue"]:
                self.assertEqual(set(line), {"speakerId", "kind", "text"})
                self.assertTrue(line["text"].strip())
                self.assertIn(line["kind"], ("speech", "thought", "narration"))
                seen_kinds.add(line["kind"])
                if line["kind"] == "thought":
                    self.assertEqual(line["speakerId"], "YOU")
                elif line["kind"] == "narration":
                    self.assertEqual(line["speakerId"], "ENV")
                elif line["speakerId"] not in ("YOU", "PLAYER_DOLL"):
                    self.assertIn(line["speakerId"], self.game.snapshot()["present"])
            self.assertEqual(before, self.kernel.state.to_dict())
            self.assertEqual(before_events, self.kernel.events())
            if view["completed"]:
                break
            self.turn(view["actions"][0]["intent"])
        self.assertEqual(seen_kinds, {"speech", "thought", "narration"})
        self.assertEqual(len(seen_ids), 11)

    def test_dialogue_reading_identity_survives_clock_preview_and_save_reload(self):
        original = self.game.snapshot()["guidance"]
        anchor = self.kernel.state.metadata["clock"]["anchorEpoch"]
        with patch("time.time", return_value=anchor + 91):
            self.game._ensure_interest()
            refreshed = self.game.snapshot()["guidance"]
            self.assertEqual(refreshed["dialogueId"], original["dialogueId"])
            self.assertEqual(refreshed["dialogue"], original["dialogue"])
        draft = self.game.intent({"text": "观察周围", "requestId": "read-preview"})
        self.assertEqual(draft["snapshot"]["guidance"]["dialogueId"], original["dialogueId"])
        self.game.cancel_intent("read-preview")
        self.assertEqual(self.game.snapshot()["guidance"]["dialogueId"], original["dialogueId"])
        self.turn("观察周围")
        confirmed = self.game.snapshot()["guidance"]
        self.assertNotEqual(confirmed["dialogueId"], original["dialogueId"])
        saved = self.game.export_save()
        restored = SinglePlayerGame(WorldKernel(world_id="read-restored", store=EventStore(":memory:")), "read-session")
        imported = restored.import_save({"sourceKey": "voodoo-single-v1", "payload": saved})
        self.assertEqual(imported["snapshot"]["guidance"]["dialogueId"], confirmed["dialogueId"])
        self.assertEqual(imported["snapshot"]["guidance"]["dialogue"], confirmed["dialogue"])

    def test_detour_dialogue_never_stages_an_absent_character(self):
        for step in ("observe", "station-door", "work", "talk", "choice", "home-door"):
            self.start()
            self.play_to(step)
            original = self.game.snapshot()["guidance"]
            detour = self.turn("去花园")["snapshot"]["guidance"]
            self.assertNotEqual(detour["dialogueId"], original["dialogueId"])
            self.assertIn("花园", detour["dialogue"][0]["text"])
            self.assertTrue(all(line["speakerId"] in ("ENV", "YOU") for line in detour["dialogue"]))
            self.assertFalse(any(line["kind"] == "speech" for line in detour["dialogue"]))
            returned = self.turn(detour["actions"][0]["intent"])["snapshot"]["guidance"]
            self.assertEqual(returned["dialogueId"], original["dialogueId"])

    def test_branch_and_ending_dialogue_are_distinct_and_never_reveal_npc_thoughts(self):
        result_ids, result_lines = set(), set()
        for branch in ("trust", "question", "missed"):
            self.start()
            if branch == "missed":
                self.turn("等待60分钟")
            else:
                self.play_to("choice")
                choice = next(action for action in self.game.snapshot()["guidance"]["actions"] if action["id"] == "story-" + branch)
                self.turn(choice["intent"])
                result_ids.add(self.game.snapshot()["guidance"]["dialogueId"])
                self.play_to("complete")
            end = self.game.snapshot()["guidance"]
            result_ids.add(end["dialogueId"])
            result_lines.add(tuple(line["text"] for line in end["dialogue"]))
            self.assertEqual(end["ending"], branch)
            self.assertTrue(all(line["speakerId"] == "YOU" for line in end["dialogue"] if line["kind"] == "thought"))
            self.assertTrue(all(line["speakerId"] not in ("A", "B", "C") for line in end["dialogue"]))
        self.assertEqual(len(result_ids), 5)
        self.assertEqual(len(result_lines), 3)

    def test_dialogue_uses_profile_names_without_renaming_speaker_ids(self):
        draft = self.game.story_draft({"templateId": TEMPLATE_ID, "dollName": "纸月", "names": {"A": "顾宁", "C": "许舟"}})
        self.game.confirm_story(draft["draftId"])
        self.play_to("choice")
        dialogue = self.game.snapshot()["guidance"]["dialogue"]
        self.assertTrue(any(line["speakerId"] == "A" for line in dialogue))
        self.assertTrue(any(line["speakerId"] == "PLAYER_DOLL" for line in dialogue))
        self.assertIn("顾宁", str(dialogue))
        self.assertNotIn("林川", str(dialogue))
        self.assertNotIn("小墨", str(dialogue))

    def test_authored_response_events_are_speech_without_stage_directions(self):
        responses = []

        def hear(text):
            result = self.turn(text)
            lines = [event["payload"]["text"] for event in result["events"] if event["actor"] == "A"]
            self.assertTrue(lines)
            responses.extend(lines)

        # Early, first explanation, both choices, post-choice, and missed
        # opportunities all use the same public speech event adapter.
        self.turn("去办公室")
        hear("问林川：辞职信是怎么回事？")
        self.start()
        self.play_to("talk")
        hear("问林川：辞职信是怎么回事？")
        hear("问林川：我相信你，请继续说。")
        hear("问林川：今天怎么样？")
        self.start()
        self.play_to("choice")
        hear("问林川：你隐瞒了什么？请给我证据。")
        self.turn("等待60分钟")
        self.turn("回家")
        # The agreed resolution remains valid even when the colleague leaves.
        hear("问林川：今天怎么样？")
        self.start()
        self.turn("等待60分钟")
        self.turn("回家")
        hear("问林川：辞职信是怎么回事？")
        for text in responses:
            self.assertNotIn("林川", text)
            self.assertNotIn("‘", text)
            self.assertNotIn("’", text)
            self.assertNotIn("他交出", text)
        self.assertTrue(any("擦掉名字的是我" in text for text in responses))
        self.assertTrue(any("约定已经过去" in text for text in responses))

    def test_custom_scene_dialogue_does_not_receive_authored_secrets(self):
        custom = self.game.story_draft({"dollName": "墨", "story": "平静的城市"})
        self.game.confirm_story(custom["draftId"])
        before = self.game.snapshot()["guidance"]
        self.assertEqual(before["dialogueId"], "free:dialogue-v1:parlor")
        self.assertNotIn("通行证", str(before["dialogue"]))
        self.assertNotIn("辞职", str(before["dialogue"]))
        arrived = self.turn("去地铁站")["snapshot"]["guidance"]
        self.assertNotEqual(arrived["dialogueId"], before["dialogueId"])
        self.assertIn("地铁站", arrived["dialogue"][0]["text"])

    def test_non_linear_tutorial_order_reconciles_from_confirmed_facts(self):
        # This reproduces the real save: the player opened the parlor door
        # several times before reading the note and leaving for the station.
        for index in range(3):
            self.turn("去开门，看看里面有啥东西")
        observed = self.turn("观察周围")
        self.assertTrue(self.kernel.state.metadata["narrative"]["facts"]["noteRead"])
        self.assertEqual(self.kernel.state.metadata["narrative"]["step"], "station")
        arrived = self.turn("去地铁站")
        narrative = arrived["snapshot"]["narrative"]
        self.assertEqual(arrived["snapshot"]["roomId"], "station")
        self.assertEqual(narrative["step"], "station-door")
        self.assertEqual(narrative["facts"], {"noteRead": True, "departed": True, "noticeRead": False})
        self.assertEqual(
            sum(event["action"] == "use" and event["payload"].get("text") == "去开门，看看里面有啥东西"
                for event in self.kernel.events()),
            3,
        )
        self.assertEqual(observed["snapshot"]["clock"]["minute"], 548)

    def test_lifecycle_reconciliation_is_audited_without_time_or_duplicate_changes(self):
        self.play_to("station-door")
        narrative = self.kernel.state.metadata["narrative"]
        # Simulate an old persisted chapter pointer while retaining the facts
        # and location already confirmed by the player.
        narrative["step"] = "observe"
        before_minute = self.kernel.state.metadata["clock"]["minute"]
        before_version = self.kernel.state.world_version
        first = self.kernel.advance_world(now=self.kernel.state.metadata["clock"]["anchorEpoch"])
        self.assertEqual(first["clock"]["minute"], before_minute)
        self.assertEqual(self.kernel.state.metadata["narrative"]["step"], "station-door")
        reconciled = [event for event in first["events"] if event["action"] == "chapter_reconciled"]
        self.assertEqual(len(reconciled), 1)
        self.assertEqual(reconciled[0]["payload"]["fromStep"], "observe")
        self.assertEqual(reconciled[0]["payload"]["toStep"], "station-door")
        second = self.kernel.advance_world(now=self.kernel.state.metadata["clock"]["anchorEpoch"])
        self.assertEqual(second["events"], [])
        self.assertEqual(self.kernel.state.world_version, before_version + 1)
        self.assertEqual(self.kernel.state.metadata["clock"]["minute"], before_minute)

    def test_short_followup_targets_the_only_present_conversation_partner(self):
        self.play_to("station-door")
        draft = self.game.intent({"text": "说什么", "requestId": "followup-c"})
        self.assertEqual(draft["preview"]["action"], "ask")
        self.assertEqual(draft["preview"]["target"], ["C"])
        self.assertIn("周野", draft["ack"])
        result = self.game.confirm_intent(draft["turnId"])
        lines = [event["payload"].get("text", "") for event in result["events"] if event["actor"] == "C"]
        self.assertTrue(any("门后那张停运告示" in line for line in lines))

    def test_short_followup_requires_disambiguation_and_rejects_departed_partner(self):
        self.play_to("station-door")
        # Put a second person in the same scene through the published
        # timetable so the parser must not guess a target.
        schedules = self.kernel.state.metadata["schedules"]["blocks"]
        self.kernel.state.metadata["schedules"]["blocks"] = [
            block for block in schedules if block.get("agentId") != "B"
        ] + [{
            "id": "B-followup-test", "agentId": "B", "startMinute": 0,
            "endMinute": 1440, "location": {"roomId": "station"},
            "recurrence": {"kind": "daily", "days": list(range(1, 8))},
            "activity": "present", "priority": 99,
        }]
        with self.assertRaises(WorldError) as error:
            self.game.intent({"text": "说什么", "requestId": "ambiguous-followup"})
        self.assertEqual(error.exception.code, "ambiguous_conversation_target")

        # Restore the original cast and confirm a conversation first; once
        # the schedule moves C away, the old conversational context is stale.
        # Make the current conversation partner leave during the next wait;
        # the production schedule projection is what invalidates the context.
        self.kernel.state.metadata["schedules"]["blocks"] = [
            block for block in schedules if block.get("agentId") != "C"
        ] + [
            {**block, "endMinute": 600} for block in schedules
            if block.get("agentId") == "C" and block.get("startMinute") == 540
        ] + [{
            "id": "C-followup-home", "agentId": "C", "startMinute": 600,
            "endMinute": 1440, "location": {"roomId": "home"},
            "recurrence": {"kind": "daily", "days": list(range(1, 8))},
            "activity": "rest", "priority": 10,
        }]
        self.turn("说什么")
        self.turn("等待120分钟")
        with self.assertRaises(WorldError) as error:
            self.game.intent({"text": "然后呢", "requestId": "departed-followup"})
        self.assertEqual(error.exception.code, "conversation_target_left")


if __name__ == "__main__":
    unittest.main()
