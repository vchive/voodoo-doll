import asyncio
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import httpx

from backend.app.api.app import FastAPI, create_app
from backend.app.domain.world import WorldKernel
from backend.app.store.event_store import EventStore


@unittest.skipIf(FastAPI is None, "install backend[api] to run HTTP boundary tests")
class StaticServingTests(unittest.TestCase):
    def test_configured_frontend_is_served_after_health_and_api_routes(self):
        async def run():
            with tempfile.TemporaryDirectory() as directory:
                static_dir = Path(directory)
                (static_dir / "assets").mkdir(parents=True)
                (static_dir / "index.html").write_text("<h1>single player</h1>", encoding="utf-8")
                (static_dir / "assets" / "client.js").write_text("window.ready = true;", encoding="utf-8")

                store = EventStore(":memory:")
                self.addCleanup(store.close)
                with patch.dict(os.environ, {"WORLD_STATIC_DIR": directory, "WORLD_ADMIN_TOKEN": "test-admin"}):
                    app = create_app(WorldKernel(world_id="static-test", store=store))

                async with httpx.AsyncClient(
                    transport=httpx.ASGITransport(app=app), base_url="http://test",
                    headers={"Authorization": "Bearer test-admin"},
                ) as client:
                    homepage = await client.get("/")
                    asset = await client.get("/assets/client.js")
                    health = await client.get("/healthz")
                    world = await client.get("/api/v4/world")
                    unknown_api = await client.get("/api/v4/not-a-route")

                self.assertEqual(homepage.status_code, 200)
                self.assertIn("single player", homepage.text)
                self.assertEqual(asset.status_code, 200)
                self.assertEqual(asset.text, "window.ready = true;")
                self.assertEqual(health.status_code, 200)
                self.assertEqual(health.json()["status"], "ok")
                self.assertEqual(world.status_code, 200)
                self.assertEqual(world.json()["worldId"], "static-test")
                self.assertEqual(unknown_api.status_code, 404)
                self.assertNotIn("single player", unknown_api.text)

        asyncio.run(run())

    def test_missing_configured_frontend_does_not_block_api_startup(self):
        async def run():
            with tempfile.TemporaryDirectory() as directory:
                missing = str(Path(directory) / "not-built")
                store = EventStore(":memory:")
                self.addCleanup(store.close)
                with patch.dict(os.environ, {"WORLD_STATIC_DIR": missing, "WORLD_ADMIN_TOKEN": "test-admin"}):
                    app = create_app(WorldKernel(world_id="api-only", store=store))

                async with httpx.AsyncClient(
                    transport=httpx.ASGITransport(app=app), base_url="http://test"
                ) as client:
                    homepage = await client.get("/")
                    health = await client.get("/healthz")

                self.assertEqual(homepage.status_code, 404)
                self.assertEqual(health.status_code, 200)

        asyncio.run(run())

    def test_static_server_does_not_expose_sensitive_or_parent_paths(self):
        async def run():
            with tempfile.TemporaryDirectory() as directory:
                static_dir = Path(directory) / "public"
                (static_dir / "assets").mkdir(parents=True)
                (static_dir / "index.html").write_text("<h1>single player</h1>", encoding="utf-8")
                (static_dir / "assets" / "client.js").write_text("window.ready = true;", encoding="utf-8")
                (static_dir.parent / ".env").write_text("MODEL_API_KEY=must-not-leak", encoding="utf-8")
                (static_dir.parent / "world.sqlite3").write_bytes(b"sqlite-secret")

                store = EventStore(":memory:")
                self.addCleanup(store.close)
                with patch.dict(os.environ, {"WORLD_STATIC_DIR": str(static_dir), "WORLD_ADMIN_TOKEN": ""}):
                    app = create_app(WorldKernel(world_id="static-boundary", store=store))

                async with httpx.AsyncClient(
                    transport=httpx.ASGITransport(app=app), base_url="http://test"
                ) as client:
                    paths = (
                        "/.env",
                        "/backend/app/api/app.py",
                        "/data/world.sqlite3",
                        "/assets/",
                        "/%2e%2e/.env",
                        "/assets/%2e%2e/%2e%2e/world.sqlite3",
                    )
                    responses = [await client.get(path) for path in paths]

                for path, response in zip(paths, responses):
                    self.assertIn(response.status_code, {400, 404}, path)
                    self.assertNotIn("must-not-leak", response.text)
                    self.assertNotIn("sqlite-secret", response.text)

        asyncio.run(run())


if __name__ == "__main__":
    unittest.main()
