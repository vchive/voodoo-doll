import unittest

from backend.app.agents.base import AdapterLimits, ProviderError, ProviderRegistry, StructuredProviderAdapter
from backend.app.agents.model_adapter import ResilientAgent
from backend.app.domain.world import WorldKernel


class ProviderAdapterTests(unittest.TestCase):
    def test_registered_providers_share_structured_contract(self):
        seen = []

        def transport(payload):
            seen.append(payload)
            return {"actor": "A", "action": "answer", "target": "YOU", "text": "我会自己说。"}

        adapter = StructuredProviderAdapter("deepseek", transport, AdapterLimits(max_output_chars=100))
        result = adapter.propose("A", type("Request", (), {"as_dict": lambda self: {"actorId": "A", "context": {}}})(), None)
        self.assertEqual(result.source, "deepseek")
        self.assertEqual(result.actor, "A")
        self.assertEqual(seen[0]["limits"]["maxOutputChars"], 100)

        registry = ProviderRegistry()
        registry.register(adapter)
        self.assertEqual(registry.names(), ("deepseek",))
        self.assertIs(registry.get("deepseek"), adapter)

    def test_invalid_provider_output_falls_back_to_local(self):
        def transport(_payload):
            return {"actor": "B", "action": "answer", "target": "YOU", "text": "错误角色"}

        adapter = StructuredProviderAdapter("claude", transport)
        kernel = WorldKernel(agent=ResilientAgent(adapter))
        result = kernel.submit_turn({"action": "ask", "target": "A", "text": "请回应。"})
        self.assertEqual(result["events"][1]["source"], "local")

    def test_provider_budget_failure_is_explicit(self):
        adapter = StructuredProviderAdapter(
            "pi",
            lambda _payload: {"actor": "A", "action": "answer", "target": "YOU", "text": "x" * 10},
            AdapterLimits(max_output_chars=3),
        )
        with self.assertRaises(ProviderError):
            adapter.propose("A", type("Request", (), {"as_dict": lambda self: {"actorId": "A"}})(), None)


if __name__ == "__main__":
    unittest.main()
