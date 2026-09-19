import json
import os
import unittest
from unittest.mock import patch

from backend.app.agents.base import AgentRequest
from backend.app.agents.gateway import GatewayAgent, GatewayLimits, create_game_agent, draft_world_from_story
from backend.app.agents.rule_agent import RuleAgent


def completion(value):
    return {"choices": [{"message": {"content": json.dumps(value, ensure_ascii=False)}}]}


class GatewayTests(unittest.TestCase):
    def request(self, actor="A"):
        return AgentRequest(
            actor,
            {
                "viewer": actor,
                "room": "parlor",
                "present": ["YOU", actor],
                "avatarUrl": "https://private/avatar.png",
                "apiKey": "do-not-send",
                "memory": [{"text": "hello"}],
            },
            {"turnId": "t-1", "payload": {"text": "问候"}},
            "t-1:A",
        )

    def test_openai_compatible_request_is_filtered_and_structured(self):
        seen = []

        def fake(url, headers, body, timeout):
            seen.append((url, headers, json.loads(body), timeout))
            return completion({"actor": "A", "action": "answer", "target": "YOU", "text": "我听到了。"})

        gateway = GatewayAgent("http://model.test/v1", "secret-key", "small", transport=fake)
        result = gateway.propose("A", self.request(), state={"private": "must-not-send"})
        self.assertEqual(result.actor, "A")
        self.assertEqual(result.action, "answer")
        self.assertEqual(result.source, "deepseek")
        self.assertEqual(seen[0][0], "http://model.test/v1/chat/completions")
        self.assertEqual(seen[0][1]["Authorization"], "Bearer secret-key")
        user_payload = json.loads(seen[0][2]["messages"][1]["content"])
        self.assertNotIn("avatarUrl", user_payload["context"])
        self.assertNotIn("apiKey", user_payload["context"])
        self.assertNotIn("private", user_payload)
        self.assertEqual(seen[0][3], 8.0)

    def test_invalid_model_output_falls_back_without_escaping(self):
        def fake(*_):
            return completion({"actor": "B", "action": "answer", "target": "YOU", "text": "wrong"})

        fallback = RuleAgent()
        gateway = GatewayAgent("http://model.test", "k", "m", fallback=fallback, transport=fake)
        result = gateway.propose("A", self.request(), state=type("State", (), {"agents": {"A": type("Agent", (), {"profile": type("P", (), {"traits": ()})()})()}})())
        self.assertEqual(result.source, "local")
        self.assertEqual(result.actor, "A")

    def test_budget_and_transport_failures_use_local_agent(self):
        calls = []

        def fake(*_):
            calls.append(1)
            raise OSError("offline")

        gateway = GatewayAgent(
            "http://model.test", "k", "m",
            limits=GatewayLimits(daily_request_budget=1),
            transport=fake,
        )
        state = type("State", (), {"agents": {"A": type("Agent", (), {"profile": type("P", (), {"traits": ()})()})()}})()
        first = gateway.propose("A", self.request(), state)
        second = gateway.propose("A", self.request(), state)
        self.assertEqual(first.source, "local")
        self.assertEqual(second.source, "local")
        self.assertEqual(len(calls), 1)

    def test_create_game_agent_without_configuration_is_local(self):
        with patch.dict(os.environ, {}, clear=True):
            agent = create_game_agent()
        self.assertEqual(agent.provider, "local")

    def test_draft_world_is_compiled_and_invalid_draft_is_rejected(self):
        generated = {
            "narrative": "雨夜，客厅的灯亮着。",
            "entities": [{"id": "lamp2", "type": "object", "location": {"roomId": "parlor"}, "affordances": ["use_object"], "state": {"actions": ["on", "off"]}}],
            "schedules": [], "encounters": [], "metadata": {},
        }
        fake = lambda *_: completion(generated)
        env = {"MODEL_BASE_URL": "http://model.test", "MODEL_API_KEY": "key", "MODEL_NAME": "world"}
        with patch.dict(os.environ, env, clear=True), patch("backend.app.agents.gateway.GatewayAgent._default_transport", fake):
            # from_env gets the patched bound transport only when no explicit
            # transport is passed, so use a temporary constructor hook.
            with patch("backend.app.agents.gateway.GatewayAgent.from_env", return_value=GatewayAgent("http://model.test", "key", "world", transport=fake)):
                result = draft_world_from_story("雨夜，客厅的灯亮着。", ["A"])
        self.assertEqual(result["entities"][0]["id"], "lamp2")

        with patch.dict(os.environ, env, clear=True), patch("backend.app.agents.gateway.GatewayAgent.from_env", return_value=GatewayAgent("http://model.test", "key", "world", transport=lambda *_: completion({"narrative": "x", "entities": [{"id": "bad", "type": "object", "location": {"roomId": "parlor"}, "affordances": ["use_object"], "state": {"actions": ["on", "off"], "code": "exec"}}]}))):
            self.assertIsNone(draft_world_from_story("故事", ["A"]))


if __name__ == "__main__":
    unittest.main()
