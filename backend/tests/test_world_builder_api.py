import unittest
import os
from unittest.mock import patch

from backend.app.api.app import FastAPI, create_app
from backend.app.domain.world import WorldKernel
from backend.app.store import EventStore


@unittest.skipIf(FastAPI is None, "install backend[api] for API checks")
class WorldBuilderApiTests(unittest.TestCase):
    def test_draft_preview_confirm_retry_invalid_and_cancel_http_contract(self):
        from fastapi.testclient import TestClient

        store = EventStore(":memory:")
        self.addCleanup(store.close)
        kernel = WorldKernel(store=store)
        with patch.dict(os.environ, {"WORLD_ADMIN_TOKEN": "test-admin"}), TestClient(create_app(kernel), headers={"Authorization": "Bearer test-admin"}) as client:
            base = "/api/v4/world-builder/drafts"
            response = client.post(base, json={
                "draftId": "http-world", "narrative": "A 在办公室看书。",
                "schedules": [{"id": "A-work", "agentId": "A", "startMinute": 540, "endMinute": 1020, "location": {"roomId": "office"}}],
                "encounters": [{"id": "book", "roomId": "office", "agentIds": ["A"], "summary": "A 翻开书。"}],
            })
            self.assertEqual(response.status_code, 200, response.text)
            self.assertEqual(response.json()["compiled"]["preview"]["scheduleCount"], 1)
            self.assertEqual(client.get("/api/v4/world").json()["worldVersion"], 0)
            self.assertEqual(client.post(base + "/http-world/confirm", json={"expectedVersion": 42}).status_code, 409)
            confirmed = client.post(base + "/http-world/confirm", json={"expectedVersion": 0})
            self.assertEqual(confirmed.status_code, 200, confirmed.text)
            self.assertEqual(client.post(base + "/http-world/confirm", json={"expectedVersion": 0}).json(), confirmed.json())
            invalid = client.post(base, json={"narrative": "新房间", "rooms": [{"id": "unregistered"}]})
            self.assertEqual(invalid.status_code, 422, invalid.text)
            self.assertEqual(invalid.json()["detail"]["code"], "unsupported_room_declaration")
            self.assertEqual(client.post(base, json={"draftId": "cancel-http", "narrative": "待确认"}).status_code, 200)
            self.assertEqual(client.post(base + "/cancel-http/cancel").status_code, 200)
            self.assertEqual(client.post(base + "/cancel-http/confirm").status_code, 404)
            self.assertEqual(client.get("/api/v4/world").json()["worldVersion"], 1)


if __name__ == "__main__":
    unittest.main()
