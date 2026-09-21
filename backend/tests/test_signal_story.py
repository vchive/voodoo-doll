"""Signal tutorial acceptance: real choices, local presence and earned evidence.

MW-28/29/30/31, SP-11–16, MW-AC-28–31. These tests drive the public game
flow, without changing narrative state to manufacture a route or ending.
"""
import copy
import unittest

from backend.app.domain.world import WorldKernel
from backend.app.domain.models import WorldError
from backend.app.gameplay import SinglePlayerGame
from backend.app.narrative import FULL_TEMPLATE_ID, TEMPLATE_ID
from backend.app.signal_story import SIGNAL_TEMPLATE_ID
from backend.app.store.event_store import EventStore


class SignalStoryTests(unittest.TestCase):
    def setUp(self):
        self.start()

    def start(self):
        self.kernel = WorldKernel(world_id="signal-story", store=EventStore(":memory:"))
        self.game = SinglePlayerGame(self.kernel, "signal-session")
        self.counter = 0
        draft = self.game.story_draft({"templateId": SIGNAL_TEMPLATE_ID})
        self.game.confirm_story(draft["draftId"], {"expectedVersion": draft["worldVersion"]})
        self.trace = [self.game.snapshot()]

    def turn(self, text):
        self.counter += 1
        preview = self.game.intent({"text": text, "requestId": "signal-" + str(self.counter),
                                    "expectedVersion": self.kernel.state.world_version})
        result = self.game.confirm_intent(preview["turnId"])
        self.trace.append(result["snapshot"])
        return result

    def action(self, identifier):
        available = self.game.snapshot()["guidance"]["actions"]
        action = next((item for item in available if item["id"] == identifier), None)
        self.assertIsNotNone(action, "missing action " + identifier)
        return self.turn(action["intent"])

    def walk_to(self, target, *, branch="station", first_choice="trust", final_choice="trust"):
        """Follow only exposed recommendations, just as a first-time player can."""
        for _ in range(45):
            snapshot = self.game.snapshot()
            step = snapshot["narrative"]["step"]
            if step == target:
                return snapshot
            self.assertFalse(snapshot["guidance"]["completed"], "story ended before " + target)
            wanted = {"day1-choice": "signal-" + first_choice,
                      "day2-start": "signal-day2-" + branch,
                      "day3-decision": "signal-final-" + final_choice}.get(step)
            if wanted:
                self.action(wanted)
            else:
                actions = [item for item in snapshot["guidance"]["actions"] if not item.get("hidden")]
                self.assertTrue(actions, "no way forward from " + step)
                story = [item for item in actions if item.get("category") == "story" or item["id"].startswith("signal-")]
                self.turn((story or actions)[0]["intent"])
        self.fail("recommended actions never reached " + target)

    def assert_local_dialogue(self, snapshot):
        for line in snapshot["guidance"]["dialogue"]:
            speaker = line["speakerId"]
            if speaker in ("A", "B", "C"):
                self.assertIn(speaker, snapshot["present"],
                              f"absent {speaker} speaks at {snapshot['narrative']['step']} in {snapshot['roomId']}")
            if line["kind"] == "thought":
                self.assertEqual(speaker, "YOU", "NPC private thought must not be public dialogue")

    def test_recommendations_finish_three_distinct_routes_with_both_investigation_branches(self):
        for route, branch in (("trust", "station"), ("audit", "station"), ("protect", "kitchen")):
            with self.subTest(route=route, branch=branch):
                self.start()
                final = self.walk_to("complete", branch=branch, first_choice=route, final_choice=route)
                self.assertEqual(final["narrative"]["ending"], route)
                self.assertEqual(final["narrative"]["finalChoice"], route)
                self.assertTrue(final["guidance"]["completed"])
                self.assertEqual(final["roomId"], "home")
                self.assertEqual(final["clock"]["day"], 3)
                self.assertIn("evidence-file", final["narrative"]["clues"])
                self.assertEqual(final["narrative"]["facts"]["tapeHeard"], branch == "kitchen")
                self.assertEqual(final["narrative"]["facts"]["manualWarning"], branch == "station")
                for snapshot in self.trace:
                    self.assert_local_dialogue(snapshot)

    def test_offline_move_import_uses_saved_room_over_stale_player_projections(self):
        for cached_doll in (False, True):
            with self.subTest(cached_doll=cached_doll):
                self.start()
                saved = self.game.export_save()
                # Older offline builds moved only the top-level room while
                # retaining YOU's previous public agent projection.
                saved["snapshot"]["roomId"] = "station"
                saved["snapshot"]["present"] = ["YOU"]
                saved["snapshot"]["worldVersion"] += 1
                self.assertEqual(saved["snapshot"]["agents"]["YOU"]["roomId"], "parlor")
                if cached_doll:
                    saved["snapshot"]["agents"]["PLAYER_DOLL"] = {"roomId": "home"}

                restored = self.game.import_save({"sourceKey": "voodoo-single-v1", "payload": saved})["snapshot"]
                self.assertEqual(restored["roomId"], "station")
                for actor in ("YOU", "PLAYER_DOLL"):
                    self.assertEqual(self.kernel.state.agents[actor].room_id, "station")
                self.assertEqual(restored["narrative"]["step"], "arrival")
                self.assertFalse(restored["narrative"]["facts"]["passSeen"])
                self.assertEqual(restored["guidance"]["actions"][0]["id"], "signal-return")
                self.assertEqual(restored["guidance"]["actions"][0]["intent"], "去客厅")
                self.assertIn("地铁站", restored["guidance"]["dialogue"][0]["text"])

                returned = self.action("signal-return")["snapshot"]
                self.assertEqual(returned["roomId"], "parlor")
                self.assertEqual(returned["narrative"]["step"], "arrival")
                self.assertFalse(returned["narrative"]["facts"]["passSeen"])
                final = self.walk_to("complete")
                self.assertEqual(final["narrative"]["ending"], "trust")
                self.assertTrue(final["guidance"]["completed"])

    def test_completed_story_exploration_and_chat_preserve_result_after_import(self):
        for route in ("trust", "audit", "protect"):
            with self.subTest(route=route):
                self.start()
                final = self.walk_to("complete", first_choice=route, final_choice=route)
                completed = copy.deepcopy(final["narrative"])
                self.assertIn("本篇已结束", final["guidance"]["objective"])
                self.assertIn("没有后续剧情任务", final["guidance"]["scheduleHint"])
                self.assertEqual(final["guidance"]["actions"][0]["label"], "观察这里")
                for text in ("观察周围", "开门", "问沈青：今天怎么样？", "去办公室", "问林川：今天怎么样？", "去酒吧", "问周野：今天怎么样？"):
                    before = self.game.snapshot()
                    result = self.turn(text)
                    self.assertGreater(result["snapshot"]["worldVersion"], before["worldVersion"])
                    self.assertGreater(result["snapshot"]["clock"]["minute"], before["clock"]["minute"])
                    self.assertEqual(result["snapshot"]["narrative"], completed)
                    self.assertEqual(result["snapshot"]["guidance"]["dialogueId"], final["guidance"]["dialogueId"])
                    self.assertEqual(result["snapshot"]["guidance"]["dialogue"], final["guidance"]["dialogue"])
                    self.assertFalse(any(event["payload"].get("chapterTransition") for event in result["events"]))
                    if text.startswith("问沈青"):
                        answer = next(event["payload"]["text"] for event in result["events"] if event["actor"] == "B")
                        self.assertNotIn("录音", answer)
                        self.assertNotIn("午饭", answer)
                    if text.startswith("问林川"):
                        answer = next(event["payload"]["text"] for event in result["events"] if event["actor"] == "A")
                        for ending_phrase in ("已经留下", "已经交出", "已经收好"):
                            self.assertNotIn(ending_phrase, answer)
                        # Ordinary life talk no longer repeats the ending;
                        # an explicit story question can still recall it.
                        recalled = self.turn("问林川：事故档案现在怎么样？")
                        self.assertEqual(recalled["snapshot"]["narrative"], completed)
                        ending_answer = next(event["payload"]["text"] for event in recalled["events"] if event["actor"] == "A")
                        self.assertIn({"trust": "已经留下", "audit": "已经交出", "protect": "已经收好"}[route], ending_answer)

                restored = SinglePlayerGame(WorldKernel(world_id="signal-complete-copy-" + route, store=EventStore(":memory:")), "complete-copy")
                imported = restored.import_save({"sourceKey": "voodoo-single-v1", "payload": self.game.export_save()})
                self.assertEqual(imported["snapshot"]["narrative"], completed)
                draft = restored.intent({"text": "去花园", "requestId": "complete-move"})
                moved = restored.confirm_intent(draft["turnId"])["snapshot"]
                self.assertEqual(moved["roomId"], "garden")
                self.assertEqual(moved["narrative"], completed)

    def test_open_door_and_small_talk_never_choose_first_or_final_stance(self):
        for target in ("day1-choice", "day3-decision"):
            with self.subTest(target=target):
                self.start()
                self.walk_to(target)
                before = copy.deepcopy(self.kernel.state.metadata["narrative"])
                for text in ("开门", "看看办公桌", "问林川：今天怎么样？"):
                    self.turn(text)
                    self.assertEqual(self.kernel.state.metadata["narrative"], before,
                                     "ordinary scene action chose a stance: " + text)

    def test_final_stance_can_differ_from_first_day_choice(self):
        final = self.walk_to("complete", first_choice="trust", final_choice="protect")
        self.assertEqual(final["narrative"]["ending"], "protect")
        self.assertEqual(final["narrative"]["finalChoice"], "protect")

    def test_missed_first_window_is_durable_during_free_exploration_and_reload(self):
        self.walk_to("day1-choice")
        late = self.turn("等待60分钟")["snapshot"]
        self.assertEqual(late["narrative"]["ending"], "missed")
        self.assertIn("day1-meeting", late["narrative"]["missedWindows"])
        self.assertNotIn("A", late["present"])
        self.assert_local_dialogue(late)
        for text in ("开门", "回家", "问林川：公开审计，所有证据一起入档。"):
            self.turn(text)
            self.assertEqual(self.game.snapshot()["narrative"]["ending"], "missed")
        saved = self.game.export_save()
        restored = SinglePlayerGame(WorldKernel(world_id="signal-missed-copy", store=EventStore(":memory:")), "copy")
        loaded = restored.import_save({"sourceKey": "voodoo-single-v1", "payload": saved})
        self.assertEqual(loaded["snapshot"]["narrative"]["ending"], "missed")
        self.assertTrue(loaded["snapshot"]["guidance"]["completed"])

    def test_detour_and_departed_npcs_never_speak_in_current_scene(self):
        self.walk_to("meeting")
        detour = self.turn("去花园")["snapshot"]
        self.assert_local_dialogue(detour)
        self.assertFalse(set(detour["present"]) & {"A", "B", "C"})
        self.start()
        self.walk_to("day2-station")
        late = self.turn("等待60分钟")["snapshot"]
        self.assertNotIn("C", late["present"])
        self.assert_local_dialogue(late)
        self.assertFalse(late["narrative"]["facts"]["tapeHeard"])
        self.assertFalse(late["narrative"]["facts"]["manualWarning"])
        final = self.walk_to("complete", final_choice="audit")
        self.assertTrue(final["guidance"]["completed"])

    def test_evidence_routes_do_not_claim_uncollected_tape_or_handover_card(self):
        for branch in ("station", "kitchen"):
            with self.subTest(branch=branch):
                self.start()
                self.walk_to("complete", branch=branch, final_choice="audit")
                for snapshot in self.trace:
                    text = snapshot["guidance"].get("passage", "") + "".join(
                        line["text"] for line in snapshot["guidance"]["dialogue"])
                    text += "".join(item["label"] for item in snapshot["guidance"]["actions"])
                    # These assertions target the false collective acquisition
                    # statements found while actually playing the prior build.
                    if not snapshot["narrative"]["facts"].get("tapeHeard"):
                        self.assertNotIn("录音、交班卡和原稿", text)
                        self.assertNotIn("交班卡、录音摘要和事故档案夹被放在", text)
                    if not snapshot["narrative"]["facts"].get("manualWarning"):
                        self.assertNotIn("交班卡和原稿进入公开审计", text)
                        self.assertNotIn("把交班卡、录音和原稿放在一起", text)
                self.turn("去办公室")
                response = self.turn("问林川：现在怎么样？")
                speech = "".join(event["payload"].get("text", "") or ""
                                 for event in response["events"] if event["actor"] == "A")
                self.assertNotIn("录音、交班卡和原稿终于会在同一份档案里", speech)

    def test_waiting_and_looking_at_recorder_do_not_collect_recording(self):
        self.walk_to("day2-kitchen", branch="kitchen")
        for text in ("等待10分钟", "看看录音机", "观察周围"):
            result = self.turn(text)["snapshot"]
            self.assertFalse(result["narrative"]["facts"]["tapeHeard"])
            self.assertNotIn("shen-tape", result["narrative"]["clues"])
            self.assertEqual(result["narrative"]["step"], "day2-kitchen")
        heard = self.action("signal-day2-tape")["snapshot"]
        self.assertTrue(heard["narrative"]["facts"]["tapeHeard"])

    def test_waiting_at_initial_scene_also_misses_first_window(self):
        late = self.turn("等待60分钟")["snapshot"]
        self.assertEqual(late["narrative"]["ending"], "missed")
        self.assertTrue(late["guidance"]["completed"])
        self.assertFalse(late["narrative"]["facts"]["passSeen"])
        self.assertNotIn("tomorrow-review", late["narrative"]["clues"])

    def test_day_three_timeout_finishes_without_fabricating_npc_choice(self):
        self.walk_to("day3-hearing")
        self.turn("等待120分钟")
        late = self.turn("等待60分钟")["snapshot"]
        self.assertEqual(late["narrative"]["ending"], "missed")
        self.assertTrue(late["guidance"]["completed"])
        self.assertIn("day3-hearing", late["narrative"]["missedWindows"])
        self.assertNotIn("A", late["present"])
        self.assert_local_dialogue(late)
        self.assertTrue(late["guidance"]["actions"], "timeout must leave exploration available")

    def test_sleep_preview_cancel_is_inert_and_sleep_requires_home(self):
        self.walk_to("sleep1")
        before = self.kernel.state.to_dict()
        preview = self.game.intent({"text": "睡觉到第二天", "requestId": "sleep-preview"})
        self.assertEqual(self.kernel.state.to_dict(), before)
        self.game.cancel_intent(preview["turnId"])
        self.assertEqual(self.kernel.state.to_dict(), before)
        self.turn("去办公室")
        before_clock = self.game.snapshot()["clock"]
        with self.assertRaises(WorldError) as error:
            self.game.intent({"text": "睡觉到第二天", "requestId": "sleep-at-office"})
        self.assertEqual(error.exception.code, "sleep_requires_home")
        self.assertEqual(self.game.snapshot()["clock"], before_clock,
                         "sleep outside home must not consume time")

    def test_sleep_clock_event_and_character_projection_match_the_next_morning(self):
        mornings = (("sleep1", "signal-sleep1", 2, 600,
                     {"A": "home", "B": "kitchen", "C": "station"}),
                    ("sleep2", "signal-sleep2", 3, 540,
                     {"A": "office", "B": "home", "C": "bar"}))
        for step, action_id, day, minute, locations in mornings:
            with self.subTest(step=step):
                self.walk_to(step)
                if self.game.snapshot()["roomId"] != "home":
                    self.action("signal-day2-home")
                before = self.game.snapshot()["clock"]
                result = self.action(action_id)
                after = result["snapshot"]["clock"]
                self.assertEqual((after["day"], after["minute"]), (day, minute))
                elapsed = (after["day"] - before["day"]) * 1440 + after["minute"] - before["minute"]
                clock_events = [event for event in result["events"] if event["action"] == "clock_advanced"]
                self.assertEqual(len(clock_events), 1)
                self.assertEqual(clock_events[0]["payload"]["minutes"], elapsed)
                self.assertEqual(clock_events[0]["payload"]["clock"], after)
                self.assertGreater(elapsed, 120)
                feedback = [event["payload"] for event in result["events"] if event["actor"] == "ENV"]
                self.assertTrue(any(item.get("ambient") == "rest" for item in feedback))
                self.assertFalse(any("等了120分钟" in item.get("text", "") for item in feedback))
                projections = self.kernel.state.metadata["presenceProjections"]
                for actor, room in locations.items():
                    self.assertEqual(projections[actor]["roomId"], room)
                    self.assertEqual(self.kernel.state.agents[actor].room_id, room)
                    self.assertEqual(actor in result["snapshot"]["present"], room == "home")

    def test_replacing_signal_story_by_publish_or_import_cleans_only_its_authored_props(self):
        for method in ("publish", "import"):
            for template in (TEMPLATE_ID, FULL_TEMPLATE_ID, None):
                with self.subTest(method=method, template=template):
                    self.start()
                    story = {"templateId": template} if template else {"story": "我在办公室遇见了一个朋友。"}
                    if method == "publish":
                        draft = self.game.story_draft(story)
                        self.game.confirm_story(draft["draftId"], {"expectedVersion": draft["worldVersion"]})
                    else:
                        source = SinglePlayerGame(WorldKernel(world_id="source", store=EventStore(":memory:")), "source")
                        draft = source.story_draft(story)
                        source.confirm_story(draft["draftId"], {"expectedVersion": draft["worldVersion"]})
                        self.game.import_save({"sourceKey": "voodoo-single-v1", "payload": source.export_save()})
                    for identifier in ("signal-lever", "handover-book", "dossier", "recorder"):
                        self.assertNotIn(identifier, self.kernel.state.objects)
                    desk = self.kernel.state.objects["desk"]
                    self.assertNotEqual(desk.get("label"), "档案馆事故档案桌")
                    self.assertNotIn("06-17", desk.get("reveals", ""))
                    self.assertNotEqual(self.kernel.state.environment.get("sound"), "distant-trains")
                    metadata = self.kernel.state.metadata
                    self.assertEqual(metadata.get("narrative", {}).get("templateId"), template)
                    for schedules in (metadata.get("schedules", {}), metadata.get("publishedWorld", {}).get("schedules", {})):
                        self.assertFalse(any("-signal-" in block.get("id", "") for block in schedules.get("blocks", [])))
                    if template:
                        self.assertEqual(desk.get("label"), "校对办公桌")

    def test_missing_shens_kitchen_window_does_not_award_the_recording(self):
        self.walk_to("day2-kitchen", branch="kitchen")
        late = self.turn("等待120分钟")["snapshot"]
        self.assertNotIn("B", late["present"])
        self.assertIn("day2-kitchen", late["narrative"]["missedWindows"])
        self.assertFalse(late["narrative"]["facts"]["tapeHeard"])
        self.assertNotIn("shen-tape", late["narrative"]["clues"])
        self.assert_local_dialogue(late)
        final = self.walk_to("complete", final_choice="audit")
        self.assertTrue(final["guidance"]["completed"])
        self.assertFalse(final["narrative"]["facts"]["tapeHeard"])

    def test_mid_story_save_import_preserves_props_clues_and_can_finish(self):
        self.walk_to("day2-kitchen", branch="kitchen")
        saved = self.game.export_save()
        restored = SinglePlayerGame(WorldKernel(world_id="signal-restored", store=EventStore(":memory:")), "restored")
        result = restored.import_save({"sourceKey": "voodoo-single-v1", "payload": saved})
        self.assertEqual(result["snapshot"]["narrative"], self.game.snapshot()["narrative"])
        self.kernel, self.game = restored.kernel, restored
        final = self.walk_to("complete", branch="kitchen", final_choice="audit")
        self.assertEqual(final["narrative"]["ending"], "audit")
        self.assertTrue(final["narrative"]["facts"]["tapeHeard"])


if __name__ == "__main__":
    unittest.main()
