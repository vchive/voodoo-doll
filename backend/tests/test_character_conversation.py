"""MW-43 / SP-28 / MW-AC-43: Lin Chuan's bounded life conversation.

The signal tutorial is reached through published recommendations and confirmed
player actions. Independent in-memory stores and mock transports never contact
a live model or mutate a player's save. Time is fixed; action costs still run.
"""

import copy
import json
import os
import unittest
from unittest.mock import patch

from backend.app.agents.gateway import GatewayAgent
from backend.app.domain.models import WorldError
from backend.app.domain.perception import build_context
from backend.app.domain.resolver import AgentProposal
from backend.app.domain.world import WorldKernel
from backend.app.gameplay import SinglePlayerGame
from backend.app.signal_story import SIGNAL_TEMPLATE_ID
from backend.app.store.event_store import EventStore


def completion(value):
    return {"choices": [{"message": {"content": json.dumps(value, ensure_ascii=False)}}]}


class CountingAdapter:
    """Record the actual adapter boundary, not calls to a routing helper."""

    provider = "local"

    def __init__(self):
        self.requests = []

    def propose_request(self, request):
        self.requests.append(copy.deepcopy(request.as_dict()))
        return AgentProposal(request.actor_id, "answer", "YOU", "我今天在整理手边的校对工作。")


class CharacterConversationTests(unittest.TestCase):
    def setUp(self):
        self.environment = patch.dict(os.environ, {}, clear=True)
        self.environment.start()
        self.addCleanup(self.environment.stop)
        self.clock = patch("time.time", return_value=1_800_000_000.0)
        self.clock.start()
        self.addCleanup(self.clock.stop)
        self.counter = 0
        self.start(CountingAdapter())

    def start(self, agent=None):
        store = EventStore(":memory:")
        self.addCleanup(store.close)
        self.kernel = WorldKernel(world_id="character-conversation", store=store, agent=agent)
        self.game = SinglePlayerGame(self.kernel, "character-session")
        self.adapter = agent
        draft = self.game.story_draft({"templateId": SIGNAL_TEMPLATE_ID})
        self.game.confirm_story(draft["draftId"], {"expectedVersion": draft["worldVersion"]})

    def preview(self, text):
        self.counter += 1
        return self.game.intent({"text": text, "requestId": "life-" + str(self.counter),
                                 "expectedVersion": self.kernel.state.world_version})

    def turn(self, text):
        return self.game.confirm_intent(self.preview(text)["turnId"])

    def action(self, identifier):
        actions = self.game.snapshot()["guidance"]["actions"]
        item = next((action for action in actions if action["id"] == identifier), None)
        self.assertIsNotNone(item, "missing recommendation " + identifier)
        return self.turn(item["intent"])

    def walk_to(self, target, *, route="trust", branch="station"):
        for _ in range(45):
            snapshot = self.game.snapshot()
            step = snapshot["narrative"]["step"]
            if step == target:
                return snapshot
            self.assertFalse(snapshot["guidance"]["completed"], "ended before " + target)
            identifier = {"day1-choice": "signal-" + route,
                          "day2-start": "signal-day2-" + branch,
                          "day3-decision": "signal-final-" + route}.get(step)
            if identifier:
                self.action(identifier)
            else:
                actions = [item for item in snapshot["guidance"]["actions"] if not item.get("hidden")]
                story = [item for item in actions if item["id"].startswith("signal-") or item.get("category") == "story"]
                self.assertTrue(story or actions, "no recommendation at " + step)
                self.turn((story or actions)[0]["intent"])
        self.fail("recommendations did not reach " + target)

    def answer(self, result):
        answers = [event for event in result["events"] if event["actor"] == "A"]
        self.assertEqual(len(answers), 1)
        self.assertTrue(answers[0]["payload"].get("text"))
        return answers[0]

    def test_work_and_memory_questions_reach_adapter_only_when_confirmed(self):
        self.turn("去办公室")
        before = copy.deepcopy(self.kernel.state.to_dict())
        draft = self.preview("问林川：你今天的工作忙吗？")
        self.assertEqual(self.adapter.requests, [])
        self.assertEqual(self.kernel.state.to_dict(), before)
        self.game.cancel_intent(draft["turnId"])
        self.assertEqual(self.adapter.requests, [])
        self.assertEqual(self.kernel.state.to_dict(), before)

        for text in ("问林川：你今天的工作忙吗？", "问林川：你还记得我刚才说过什么吗？"):
            with self.subTest(text=text):
                count = len(self.adapter.requests)
                minute = self.game.snapshot()["clock"]["minute"]
                result = self.turn(text)
                self.assertEqual(len(self.adapter.requests), count + 1)
                self.assertEqual(self.adapter.requests[-1]["actorId"], "A")
                self.assertEqual(self.adapter.requests[-1]["trigger"]["payload"]["text"], text)
                self.assertEqual(result["snapshot"]["clock"]["minute"], minute + 3)
                self.assertIn("校对工作", self.answer(result)["payload"]["text"])

    def test_repeated_confirmation_and_kernel_reload_do_not_repeat_model_or_memory(self):
        self.turn("去办公室")
        draft = self.preview("问林川：工作还顺利吗？")
        result = self.game.confirm_intent(draft["turnId"])
        committed = copy.deepcopy(self.kernel.state.to_dict())
        self.assertEqual(len(self.adapter.requests), 1)
        self.assertEqual(self.game.confirm_intent(draft["turnId"]), result)
        self.assertEqual(self.kernel.state.to_dict(), committed)

        reloaded = WorldKernel(world_id=self.kernel.state.world_id, store=self.kernel.store, agent=self.adapter)
        game = SinglePlayerGame(reloaded, "character-session")
        self.assertEqual(game.confirm_intent(draft["turnId"]), result)
        self.assertEqual(reloaded.state.to_dict(), committed)
        self.assertEqual(len(self.adapter.requests), 1)

    def test_gateway_receives_persona_and_current_schedule_without_other_private_memory(self):
        payloads = []

        def transport(_url, _headers, body, _timeout):
            payloads.append(json.loads(json.loads(body)["messages"][1]["content"]))
            return completion({"actor": "A", "action": "answer", "target": "YOU", "text": "我在校对，稍后要回家。"})

        self.start(GatewayAgent("http://model.test/v1", "test-key", "test-model", transport=transport))
        self.turn("回家")
        # A genuine private event in B's room supplies a privacy canary. No
        # narrative step, character location or memory is manufactured here.
        hidden = "只有沈青听过的蓝色风铃约定"
        self.kernel.submit_turn({"actor": "YOU", "action": "ask", "targets": ["B"],
                                 "channel": "private", "text": hidden, "turnId": "b-private-canary"})
        self.assertTrue(any(hidden in item["summary"] for item in self.kernel.state.agents["B"].memory))
        self.turn("去办公室")
        current = self.game.snapshot()["clock"]
        result = self.turn("问林川：今天的工作忙吗？")
        self.assertEqual(self.answer(result)["source"], "deepseek")
        self.assertEqual(len(payloads), 1)
        context = payloads[0]["context"]
        character = context["character"]
        self.assertEqual(set(character), {"id", "name", "persona", "traits", "goals"})
        self.assertEqual((character["id"], character["name"]), ("A", "林川"))
        self.assertIn("校对", character["persona"])
        self.assertTrue(character["traits"])
        self.assertTrue(character["goals"])
        self.assertEqual(context["situation"], {"roomId": "office", "activity": "signal-review",
                                                "clock": {"day": current["day"], "minute": current["minute"]}})
        for field in ("metadata", "narrative", "facts", "schedules", "agents", "presenceProjections"):
            self.assertNotIn(field, context)
        transmitted = json.dumps(payloads[0], ensure_ascii=False)
        for forbidden in (hidden, "明日回执不是预言", "提前送出的更正预约", "tapeHeard", "protect_secret"):
            self.assertNotIn(forbidden, transmitted)
        self.assertFalse(self.kernel.state.metadata["narrative"]["facts"]["tapeHeard"])

    def test_committed_conversation_survives_departure_and_kernel_reload(self):
        self.turn("去办公室")
        remembered = "问林川：我喜欢茉莉茶，你平时喝什么？"
        result = self.turn(remembered)
        event_id = next(event["eventId"] for event in result["events"] if event["actor"] == "YOU")
        self.turn("去花园")
        self.turn("去办公室")
        self.kernel = WorldKernel(world_id=self.kernel.state.world_id, store=self.kernel.store, agent=self.adapter)
        self.game = SinglePlayerGame(self.kernel, "character-session")
        self.turn("问林川：还记得我之前说过什么吗？")
        memory = self.adapter.requests[-1]["context"]["memory"]
        self.assertTrue(any(item["eventId"] == event_id and remembered in item["summary"] for item in memory))
        self.assertEqual(len(self.adapter.requests), 2)

    def test_gateway_discards_extra_nested_identity_and_schedule_fields(self):
        payloads = []

        def transport(_url, _headers, body, _timeout):
            payloads.append(json.loads(json.loads(body)["messages"][1]["content"]))
            return completion({"actor": "A", "action": "answer", "target": "YOU", "text": "我手头还有工作。"})

        def extra_context(*args, **kwargs):
            context = build_context(*args, **kwargs)
            context["character"]["unpublishedEnding"] = "身份嵌套隐藏结局"
            context["situation"]["tomorrow"] = "明天日程不该进入当前上下文"
            context["situation"]["clock"]["serverDetail"] = "时钟内部细节"
            return context

        self.start(GatewayAgent("http://model.test/v1", "test-key", "test-model", transport=transport))
        self.turn("去办公室")
        with patch("backend.app.domain.world.build_context", side_effect=extra_context):
            self.turn("问林川：现在忙吗？")
        self.assertEqual(len(payloads), 1)
        context = payloads[0]["context"]
        self.assertEqual(set(context["character"]), {"id", "name", "persona", "traits", "goals"})
        self.assertEqual(set(context["situation"]), {"roomId", "activity", "clock"})
        self.assertEqual(set(context["situation"]["clock"]), {"day", "minute"})
        sent = json.dumps(payloads[0], ensure_ascii=False)
        for hidden in ("身份嵌套隐藏结局", "明天日程不该进入当前上下文", "时钟内部细节"):
            self.assertNotIn(hidden, sent)

    def test_life_talk_does_not_advance_meeting_or_hearing(self):
        for step in ("meeting", "day3-hearing"):
            with self.subTest(step=step):
                self.start(CountingAdapter())
                self.walk_to(step)
                narrative = copy.deepcopy(self.kernel.state.metadata["narrative"])
                before = self.game.snapshot()["clock"]["minute"]
                result = self.turn("问林川：你今天工作忙吗？")
                self.assertEqual(result["snapshot"]["narrative"], narrative)
                self.assertEqual(result["snapshot"]["clock"]["minute"], before + 3)
                self.assertEqual(len(self.adapter.requests), 1)
                self.assertFalse(any(event["payload"].get("chapterTransition") for event in result["events"]))

    def test_questions_and_negations_never_select_a_stance(self):
        for step in ("day1-choice", "day3-decision"):
            with self.subTest(step=step):
                self.start(CountingAdapter())
                self.walk_to(step)
                narrative = copy.deepcopy(self.kernel.state.metadata["narrative"])
                for text in ("问林川：今天怎么样？", "问林川：共同署名是什么意思？", "问林川：我不想共同署名。",
                             "问林川：公开审计会怎么样？", "问林川：我不想保护你。"):
                    result = self.turn(text)
                    self.assertEqual(result["snapshot"]["narrative"], narrative, text)

    def test_everyday_advance_booking_and_source_words_do_not_skip_hearing(self):
        for text in ("问林川：你今天会提前下班吗？", "问林川：你预约牙医了吗？",
                     "问林川：你杯子里那种茶的来源是哪儿？"):
            with self.subTest(text=text):
                self.start(CountingAdapter())
                self.walk_to("day3-hearing")
                narrative = copy.deepcopy(self.kernel.state.metadata["narrative"])
                before = self.game.snapshot()["clock"]["minute"]
                result = self.turn(text)
                self.assertEqual(result["snapshot"]["narrative"], narrative)
                self.assertEqual(result["snapshot"]["clock"]["minute"], before + 3)
                self.assertEqual(len(self.adapter.requests), 1)
                self.assertFalse(any(event["payload"].get("chapterTransition") for event in result["events"]))
                self.action("signal-day3-hearing")
                self.assertEqual(self.game.snapshot()["narrative"]["step"], "day3-decision")
                self.assertEqual(len(self.adapter.requests), 1)

    def test_negated_or_reported_choices_do_not_commit_a_stance(self):
        for step in ("day1-choice", "day3-decision"):
            for text in ("问林川：我不愿意与你共同署名。", "问林川：别保存所有证据。",
                         "问林川：他说共同署名。", "问林川：我上次说共同署名。",
                         "问林川：共同署名的事明天再说。"):
                with self.subTest(step=step, text=text):
                    # Every example gets its own real playthrough, so normal
                    # action costs cannot silently turn this into a timeout.
                    self.start(CountingAdapter())
                    self.walk_to(step)
                    narrative = copy.deepcopy(self.kernel.state.metadata["narrative"])
                    before = self.game.snapshot()["clock"]["minute"]
                    result = self.turn(text)
                    self.assertEqual(result["snapshot"]["narrative"], narrative)
                    self.assertEqual(result["snapshot"]["clock"]["minute"], before + 3)
                    self.assertFalse(any(event["payload"].get("chapterTransition") for event in result["events"]))
                    choice = "signal-trust" if step == "day1-choice" else "signal-final-trust"
                    next_step = "day1-home" if step == "day1-choice" else "day3-home"
                    self.action(choice)
                    self.assertEqual(self.game.snapshot()["narrative"]["step"], next_step)
                    self.assertEqual(self.adapter.requests, [])

    def test_life_recommendations_follow_presence_and_enter_the_same_adapter(self):
        def available():
            return {item["id"] for item in self.game.snapshot()["guidance"]["actions"]}

        life_actions = {"chat-a-work", "chat-a-memory"}
        self.assertFalse(available() & life_actions)
        self.turn("去办公室")
        self.assertTrue(life_actions <= available())
        self.action("chat-a-work")
        self.action("chat-a-memory")
        self.assertEqual(len(self.adapter.requests), 2)
        self.turn("去花园")
        self.assertFalse(available() & life_actions)
        self.turn("去办公室")
        self.assertTrue(life_actions <= available())
        self.turn("等待60分钟")
        self.assertNotIn("A", self.game.snapshot()["present"])
        self.assertFalse(available() & life_actions)

    def test_recommended_story_routes_stay_authored_and_finish_without_adapter_calls(self):
        for route, branch in (("trust", "station"), ("audit", "station"), ("protect", "kitchen")):
            with self.subTest(route=route):
                self.start(CountingAdapter())
                final = self.walk_to("complete", route=route, branch=branch)
                self.assertEqual(final["narrative"]["ending"], route)
                self.assertTrue(final["guidance"]["completed"])
                self.assertEqual(self.adapter.requests, [])

    def test_missing_model_has_work_and_grounded_memory_responses(self):
        self.start()
        self.turn("去办公室")
        cancelled = self.preview("问林川：我喜欢黑巧克力，你呢？")
        self.game.cancel_intent(cancelled["turnId"])
        first = self.turn("问林川：你还记得我之前说过什么吗？")
        self.assertIn("没有记下", self.answer(first)["payload"]["text"])
        self.assertNotIn("黑巧克力", self.answer(first)["payload"]["text"])
        work = self.turn("问林川：工作忙吗？")
        self.assertEqual(self.answer(work)["source"], "local")
        self.assertIn("校对", self.answer(work)["payload"]["text"])
        self.turn("问林川：我喜欢茉莉茶，你平时喝什么？")
        self.turn("去花园")
        self.turn("去办公室")
        recalled = self.turn("问林川：还记得我之前说过什么吗？")
        self.assertIn("茉莉茶", self.answer(recalled)["payload"]["text"])
        self.assertNotIn("问林川：", self.answer(recalled)["payload"]["text"])
        repeated = self.turn("问林川：你还记得我上次说过什么吗？")
        self.assertIn("茉莉茶", self.answer(repeated)["payload"]["text"])
        self.assertNotIn("还记得我之前", self.answer(repeated)["payload"]["text"])
        self.assertEqual(recalled["snapshot"]["narrative"]["step"], "arrival")

    def test_local_life_response_changes_when_schedule_moves_lin_home(self):
        self.start()
        self.turn("去办公室")
        at_work = self.turn("问林川：现在工作忙吗？")
        self.assertIn("校对", self.answer(at_work)["payload"]["text"])
        self.turn("等待52分钟")
        self.assertNotIn("A", self.game.snapshot()["present"])
        self.turn("回家")
        self.assertIn("A", self.game.snapshot()["present"])
        at_home = self.turn("问林川：现在工作忙吗？")
        self.assertIn("不是我的办公时间", self.answer(at_home)["payload"]["text"])
        self.assertEqual(at_home["snapshot"]["narrative"]["ending"], "missed")

    def test_gateway_failure_or_invalid_output_remains_playable_without_world_mutations(self):
        for failure in ("offline", "wrong-actor", "move", "invalid-json"):
            with self.subTest(failure=failure):
                calls = []

                def transport(*_args):
                    calls.append(1)
                    if failure == "offline":
                        raise OSError("test offline")
                    if failure == "invalid-json":
                        return {"choices": [{"message": {"content": "not-json"}}]}
                    return completion({"actor": "B" if failure == "wrong-actor" else "A",
                                       "action": "move" if failure == "move" else "answer",
                                       "target": "YOU", "text": "我已经离开办公室。"})

                self.start(GatewayAgent("http://model.test/v1", "test-key", "test-model", transport=transport))
                self.walk_to("meeting")
                narrative = copy.deepcopy(self.kernel.state.metadata["narrative"])
                result = self.turn("问林川：你今天工作忙吗？")
                answer = self.answer(result)
                self.assertEqual(len(calls), 1)
                self.assertEqual(answer["source"], "local")
                self.assertIn("校对", answer["payload"]["text"])
                self.assertNotIn("已经离开", answer["payload"]["text"])
                self.assertEqual(result["snapshot"]["narrative"], narrative)
                self.assertEqual(self.kernel.state.agents["A"].room_id, "office")
                self.action("signal-meeting")
                self.assertEqual(self.game.snapshot()["narrative"]["step"], "day1-choice")
                self.assertEqual(len(calls), 1)

    def test_absent_character_is_rejected_without_model_or_memory_effect(self):
        for elapsed in (False, True):
            with self.subTest(schedule_departed=elapsed):
                self.start(CountingAdapter())
                if elapsed:
                    self.turn("去办公室")
                    self.turn("等待60分钟")
                before = copy.deepcopy(self.kernel.state.to_dict())
                with self.assertRaises(WorldError) as caught:
                    self.preview("问林川：今天工作忙吗？")
                self.assertIn(caught.exception.code, {"target_not_present", "target_out_of_range", "target_not_in_room"})
                self.assertEqual(self.adapter.requests, [])
                self.assertEqual(self.kernel.state.to_dict(), before)


if __name__ == "__main__":
    unittest.main()
