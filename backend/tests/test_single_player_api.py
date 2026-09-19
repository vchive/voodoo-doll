import asyncio
import os
import tempfile
import unittest
from unittest.mock import patch

import httpx

from backend.app.api.app import FastAPI, create_app
from backend.app.domain.world import WorldKernel
from backend.app.store.event_store import EventStore


@unittest.skipIf(FastAPI is None, "install backend[api] to run HTTP boundary tests")
class SinglePlayerApiTests(unittest.TestCase):
    @staticmethod
    async def _client(app):
        return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test")

    @staticmethod
    async def _onboard(client, story="我在办公室遇见了一个人"):
        had_cookie = bool(client.cookies.get("voodoo_session"))
        session = await client.get("/api/v4/session")
        assert session.status_code == 200
        if not had_cookie:
            assert "HttpOnly" in session.headers.get("set-cookie", "")
        draft_response = await client.post(
            "/api/v4/play/story",
            json={"dollName": "墨", "story": story, "names": {"A": "林川"}},
        )
        assert draft_response.status_code == 200, draft_response.text
        draft = draft_response.json()
        confirmed = await client.post(
            f"/api/v4/play/story/{draft['draftId']}/confirm",
            json={"expectedVersion": draft["worldVersion"]},
        )
        assert confirmed.status_code == 200, confirmed.text
        return confirmed.json()

    def test_cookie_sessions_are_isolated_and_client_world_id_is_ignored(self):
        async def run():
            store = EventStore(":memory:")
            app = create_app(WorldKernel(world_id="legacy", store=store))
            async with await self._client(app) as first, await self._client(app) as second:
                first_session = await first.get("/api/v4/session")
                second_session = await second.get("/api/v4/session")
                self.assertEqual(first_session.headers.get("cache-control"), "no-store")
                self.assertLess(len(first_session.content), 5000)
                self.assertNotIn("metadata", first_session.json()["snapshot"])
                self.assertNotIn("publishedRegistry", first_session.json()["snapshot"])
                self.assertNotIn("activations", first_session.json()["snapshot"])
                self.assertNotEqual(first_session.json()["snapshot"]["worldId"], second_session.json()["snapshot"]["worldId"])
                await self._onboard(first)
                # A forged body identity cannot select the first world.
                response = await second.post(
                    "/api/v4/play/story",
                    json={"worldId": first_session.json()["snapshot"]["worldId"], "dollName": "乙", "story": "另一段故事", "names": {}},
                )
                self.assertEqual(response.status_code, 200)
                own = await second.get("/api/v4/session")
                self.assertEqual(own.json()["profile"], {})
                self.assertNotEqual(own.json()["snapshot"]["worldId"], first_session.json()["snapshot"]["worldId"])

        asyncio.run(run())

    def test_preview_does_not_advance_version_and_confirm_is_idempotent(self):
        async def run():
            app = create_app(WorldKernel(world_id="single", store=EventStore(":memory:")))
            async with await self._client(app) as client:
                await self._onboard(client)
                before = (await client.get("/api/v4/session")).json()["snapshot"]["worldVersion"]
                draft = await client.post("/api/v4/play/intent", json={"text": "等十分钟", "requestId": "wait-1", "expectedVersion": before})
                self.assertEqual(draft.status_code, 200)
                self.assertEqual(draft.json()["worldVersion"], before)
                turn_id = draft.json()["turnId"]
                committed = await client.post(f"/api/v4/play/intent/{turn_id}/confirm")
                retry = await client.post(f"/api/v4/play/intent/{turn_id}/confirm")
                self.assertEqual(committed.status_code, 200)
                self.assertEqual(retry.status_code, 200)
                self.assertEqual(retry.json(), committed.json())

                story_retry = await client.post("/api/v4/play/story/missing/confirm")
                self.assertEqual(story_retry.status_code, 404)

        asyncio.run(run())

    def test_move_confirmation_activates_destination_for_next_character_turn(self):
        async def run():
            app = create_app(WorldKernel(world_id="move", store=EventStore(":memory:")))
            async with await self._client(app) as client:
                initial = await self._onboard(client)
                story_retry = await client.post(
                    f"/api/v4/play/story/{initial['draftId']}/confirm",
                    json={"expectedVersion": 0},
                )
                self.assertEqual(story_retry.status_code, 200)
                self.assertEqual(story_retry.json(), initial)

                version = initial["worldVersion"]
                move = (await client.post(
                    "/api/v4/play/intent",
                    json={"text": "去办公室", "requestId": "move-office", "expectedVersion": version},
                )).json()
                arrived = await client.post(f"/api/v4/play/intent/{move['turnId']}/confirm")
                self.assertEqual(arrived.status_code, 200, arrived.text)
                self.assertEqual(arrived.json()["snapshot"]["roomId"], "office")
                self.assertIn("A", arrived.json()["snapshot"]["present"])

                ask = await client.post(
                    "/api/v4/play/intent",
                    json={"text": "问林川今天怎么样", "requestId": "ask-a", "expectedVersion": arrived.json()["worldVersion"]},
                )
                self.assertEqual(ask.status_code, 200, ask.text)
                answer = await client.post(f"/api/v4/play/intent/{ask.json()['turnId']}/confirm")
                self.assertEqual(answer.status_code, 200, answer.text)
                self.assertTrue(any(event.get("actor") == "A" for event in answer.json()["events"]))

        asyncio.run(run())

    def test_restart_recovers_cookie_world_and_save_import(self):
        async def run():
            fd, filename = tempfile.mkstemp(suffix=".sqlite")
            os.close(fd)
            try:
                store = EventStore(filename)
                app = create_app(WorldKernel(world_id="restart-legacy", store=store))
                async with await self._client(app) as client:
                    onboarded = await self._onboard(client)
                    move = (await client.post(
                        "/api/v4/play/intent",
                        json={"text": "去办公室", "requestId": "export-office", "expectedVersion": onboarded["worldVersion"]},
                    )).json()
                    moved = await client.post(f"/api/v4/play/intent/{move['turnId']}/confirm")
                    self.assertEqual(moved.json()["snapshot"]["roomId"], "office")
                    cookie = client.cookies.get("voodoo_session")
                    exported = (await client.get("/api/v4/play/save")).json()
                restarted = create_app(WorldKernel(world_id="restart-legacy", store=EventStore(filename)))
                async with await self._client(restarted) as recovered:
                    recovered.cookies.set("voodoo_session", cookie)
                    session = await recovered.get("/api/v4/session")
                    self.assertEqual(session.json()["profile"]["dollName"], "墨")
                    imported = await recovered.post("/api/v4/play/save/import", json={"sourceKey": exported["sourceKey"], "payload": exported})
                    self.assertEqual(imported.status_code, 200)
                    self.assertEqual(imported.json()["profile"]["dollName"], "墨")
                    self.assertEqual(imported.json()["snapshot"]["roomId"], "office")
                    self.assertEqual(imported.json()["profile"]["contentLevel"], "sfw")
            finally:
                for suffix in ("", "-wal", "-shm"):
                    try:
                        os.unlink(filename + suffix)
                    except FileNotFoundError:
                        pass

        asyncio.run(run())

    def test_cancel_and_cross_session_draft_ids_cannot_commit(self):
        async def run():
            app = create_app(WorldKernel(world_id="cancel", store=EventStore(":memory:")))
            async with await self._client(app) as owner, await self._client(app) as stranger:
                story = (await owner.post(
                    "/api/v4/play/story",
                    json={"dollName": "墨", "story": "办公室里有一盏灯", "names": {"A": "林川"}},
                )).json()
                stranger_attempt = await stranger.post(f"/api/v4/play/story/{story['draftId']}/confirm")
                self.assertEqual(stranger_attempt.status_code, 404)
                cancelled = await owner.post(f"/api/v4/play/story/{story['draftId']}/cancel")
                self.assertEqual(cancelled.status_code, 200)
                self.assertEqual((await owner.post(f"/api/v4/play/story/{story['draftId']}/confirm")).status_code, 404)

                onboarded = await self._onboard(owner)
                intent = (await owner.post(
                    "/api/v4/play/intent",
                    json={"text": "去办公室", "requestId": "cancel-move", "expectedVersion": onboarded["worldVersion"]},
                )).json()
                self.assertEqual((await stranger.post(f"/api/v4/play/intent/{intent['turnId']}/confirm")).status_code, 404)
                self.assertEqual((await owner.post(f"/api/v4/play/intent/{intent['turnId']}/cancel")).status_code, 200)
                self.assertEqual((await owner.post(f"/api/v4/play/intent/{intent['turnId']}/confirm")).status_code, 404)
                current = (await owner.get("/api/v4/session")).json()
                self.assertEqual(current["snapshot"]["roomId"], "parlor")

        asyncio.run(run())

    def test_legacy_imports_are_sfw_and_invalid_import_is_atomic(self):
        async def run():
            app = create_app(WorldKernel(world_id="imports", store=EventStore(":memory:")))
            async with await self._client(app) as client:
                await client.get("/api/v4/session")
                legacy_v5 = {
                    "schemaVersion": 5,
                    "dollName": "旧夜",
                    "onboardingPhase": "names-confirmed",
                    "story": "旧房间里的故事",
                    "confirmedFacts": ["A 在卧室。"],
                    "names": {"A": "阿青"},
                    "stage": {"roomId": "bedroom", "present": ["YOU", "A"]},
                }
                imported_v5 = await client.post(
                    "/api/v4/play/save/import",
                    json={"sourceKey": "voodoo-hex-v5", "payload": legacy_v5},
                )
                self.assertEqual(imported_v5.status_code, 200, imported_v5.text)
                self.assertEqual(imported_v5.json()["snapshot"]["roomId"], "bedroom")
                self.assertEqual(imported_v5.json()["profile"]["dollName"], "旧夜")
                self.assertEqual(imported_v5.json()["profile"]["contentLevel"], "sfw")

                before = (await client.get("/api/v4/session")).json()
                invalid = await client.post(
                    "/api/v4/play/save/import",
                    json={"sourceKey": "voodoo-single-v1", "payload": {"profile": {"dollName": "篡改"}, "snapshot": {"roomId": "forbidden"}}},
                )
                self.assertEqual(invalid.status_code, 422)
                after = (await client.get("/api/v4/session")).json()
                self.assertEqual(after, before)

                imported_v1 = await client.post(
                    "/api/v4/play/save/import",
                    json={"sourceKey": "voodoo-cabinet-v1", "payload": {"name": "第一只", "fabric": "#000000"}},
                )
                self.assertEqual(imported_v1.status_code, 200, imported_v1.text)
                self.assertEqual(imported_v1.json()["profile"]["dollName"], "第一只")
                refreshed = (await client.get("/api/v4/session")).json()
                self.assertEqual(refreshed["profile"]["onboardingPhase"], "names-confirmed")

        asyncio.run(run())

    def test_http_boundary_rejects_cross_origin_large_bodies_and_unprotected_kernel_routes(self):
        async def run():
            with patch.dict(os.environ, {"WORLD_MAX_BODY_BYTES": "256", "WORLD_ADMIN_TOKEN": ""}):
                app = create_app(WorldKernel(world_id="boundary", store=EventStore(":memory:")))
            async with await self._client(app) as client:
                self.assertEqual((await client.get("/api/v4/world?viewer=A")).status_code, 404)
                self.assertEqual((await client.post("/internal/v4/world/tick")).status_code, 404)
                forbidden = await client.post(
                    "/api/v4/play/story",
                    headers={"Origin": "https://evil.example"},
                    json={"dollName": "墨", "story": "办公室里有一盏灯", "names": {}},
                )
                self.assertEqual(forbidden.status_code, 403)
                too_large = await client.post(
                    "/api/v4/play/story",
                    json={"dollName": "墨", "story": "很" * 300, "names": {}},
                )
                self.assertEqual(too_large.status_code, 413)

            with patch.dict(os.environ, {"WORLD_ADMIN_TOKEN": "test-admin", "WORLD_ALLOWED_ORIGINS": "https://allowed.example"}):
                protected = create_app(WorldKernel(world_id="protected", store=EventStore(":memory:")))
            async with await self._client(protected) as client:
                self.assertEqual((await client.get("/api/v4/world")).status_code, 403)
                self.assertEqual((await client.get("/api/v4/world", headers={"Authorization": "Bearer wrong"})).status_code, 403)
                self.assertEqual((await client.get("/api/v4/world", headers={"Authorization": "Bearer test-admin"})).status_code, 200)
                tick = await client.post(
                    "/internal/v4/world/tick",
                    headers={"Authorization": "Bearer test-admin", "Origin": "https://allowed.example"},
                )
                self.assertEqual(tick.status_code, 200, tick.text)

        asyncio.run(run())


if __name__ == "__main__":
    unittest.main()
