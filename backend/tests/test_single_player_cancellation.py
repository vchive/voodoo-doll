import asyncio
import tempfile
import threading
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest.mock import patch

import httpx

from backend.app.api.app import FastAPI, create_app
from backend.app.domain.models import WorldError
from backend.app.domain.world import WorldKernel
from backend.app.gameplay import SinglePlayerGame
from backend.app.store.event_store import EventStore


class SinglePlayerCancellationTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        clock = patch("time.time", return_value=1000)
        clock.start()
        self.addCleanup(clock.stop)

    def game(self, filename="world.sqlite3", world_id="owner"):
        store = EventStore(str(Path(self.directory.name) / filename))
        self.addCleanup(store.close)
        return SinglePlayerGame(WorldKernel(world_id=world_id, store=store), world_id + "-session")

    def assert_error(self, callback, code, status):
        with self.assertRaises(WorldError) as caught:
            callback()
        self.assertEqual((caught.exception.code, caught.exception.status), (code, status))

    def assert_unchanged(self, game, state, events):
        self.assertEqual(game.kernel.state.to_dict(), state)
        self.assertEqual(game.kernel.store.load_state(game.kernel.state.world_id).to_dict(), state)
        self.assertEqual(game.kernel.events(), events)

    def test_story_cancel_after_restart_rejects_committed_or_publish_only_receipt(self):
        for interrupted in (False, True):
            with self.subTest(product_receipt=not interrupted):
                filename = f"story-{interrupted}.sqlite3"
                game = self.game(filename)
                draft = game.story_draft({"templateId": "signal-rain-v1"})
                identifier = draft["draftId"]
                if interrupted:
                    with patch.object(game, "_save_receipt", side_effect=RuntimeError("process stopped")):
                        with self.assertRaises(RuntimeError):
                            game.confirm_story(identifier)
                else:
                    game.confirm_story(identifier)

                restarted = self.game(filename)
                self.assertEqual(restarted._receipt("story", identifier) is None, interrupted)
                state, events = restarted.kernel.state.to_dict(), restarted.kernel.events()
                self.assert_error(lambda: restarted.cancel_story(identifier), "story_already_committed", 409)
                self.assert_unchanged(restarted, state, events)
                recovered = restarted.confirm_story(identifier)
                self.assertEqual(restarted.confirm_story(identifier), recovered)
                self.assert_unchanged(restarted, state, events)
                self.assertEqual(sum(event["action"] == "world_registry_published" for event in events), 1)

    def test_intent_cancel_after_restart_rejects_committed_or_turn_only_receipt(self):
        for interrupted in (False, True):
            with self.subTest(product_receipt=not interrupted):
                filename = f"intent-{interrupted}.sqlite3"
                game = self.game(filename)
                story = game.story_draft({"templateId": "signal-rain-v1"})
                game.confirm_story(story["draftId"])
                identifier = game.intent({"text": "去办公室", "requestId": "move-office"})["turnId"]
                if interrupted:
                    with patch.object(game, "_save_receipt", side_effect=RuntimeError("process stopped")):
                        with self.assertRaises(RuntimeError):
                            game.confirm_intent(identifier)
                else:
                    game.confirm_intent(identifier)

                restarted = self.game(filename)
                self.assertEqual(restarted.kernel._turn_results, {})
                self.assertEqual(restarted._receipt("intent", identifier) is None, interrupted)
                state, events = restarted.kernel.state.to_dict(), restarted.kernel.events()
                self.assert_error(lambda: restarted.cancel_intent(identifier), "turn_already_committed", 409)
                self.assert_unchanged(restarted, state, events)
                recovered = restarted.confirm_intent(identifier)
                self.assertEqual(recovered["snapshot"]["roomId"], "office")
                self.assertEqual(restarted.confirm_intent(identifier), recovered)
                self.assert_unchanged(restarted, state, events)
                self.assertEqual(sum(event["turnId"] == identifier and event["actor"] == "YOU" for event in events), 1)

    def test_unconfirmed_story_and_intent_can_cancel_after_restart_without_world_changes(self):
        game = self.game()
        draft = game.story_draft({"templateId": "signal-rain-v1"})
        restarted = self.game()
        state, events = restarted.kernel.state.to_dict(), restarted.kernel.events()
        self.assertEqual(restarted.cancel_story(draft["draftId"])["status"], "cancelled")
        self.assert_error(lambda: restarted.confirm_story(draft["draftId"]), "unknown_world_draft", 404)
        self.assert_unchanged(restarted, state, events)

        draft = restarted.story_draft({"templateId": "signal-rain-v1"})
        restarted.confirm_story(draft["draftId"])
        identifier = restarted.intent({"text": "去办公室", "requestId": "cancel-move"})["turnId"]
        next_process = self.game()
        state, events = next_process.kernel.state.to_dict(), next_process.kernel.events()
        self.assertEqual(next_process.cancel_intent(identifier)["status"], "cancelled")
        self.assert_error(lambda: next_process.confirm_intent(identifier), "unknown_turn", 404)
        self.assert_unchanged(next_process, state, events)
        self.assertIsNone(next_process.kernel.store.get_draft("owner", identifier))
        self.assertEqual(self.game().kernel.state.to_dict(), state)

    def test_unknown_and_other_world_ids_cannot_be_cancelled_or_confirmed(self):
        owner, stranger = self.game(), self.game(world_id="stranger")
        story = owner.story_draft({"templateId": "signal-rain-v1"})
        story_id = story["draftId"]
        self.assert_error(lambda: stranger.cancel_story(story_id), "unknown_world_draft", 404)
        owner.confirm_story(story_id)
        self.assert_error(lambda: stranger.cancel_story(story_id), "unknown_world_draft", 404)
        self.assert_error(lambda: stranger.confirm_story(story_id), "unknown_world_draft", 404)

        turn_id = owner.intent({"text": "去办公室", "requestId": "private-move"})["turnId"]
        self.assert_error(lambda: stranger.cancel_intent(turn_id), "unknown_turn", 404)
        committed = owner.confirm_intent(turn_id)
        self.assert_error(lambda: stranger.cancel_intent(turn_id), "unknown_turn", 404)
        self.assert_error(lambda: stranger.confirm_intent(turn_id), "unknown_turn", 404)
        self.assertEqual(owner.confirm_intent(turn_id), committed)
        self.assert_error(lambda: owner.cancel_intent("missing"), "unknown_turn", 404)

    def test_cancel_waits_for_confirmation_on_the_shared_game_lock(self):
        for kind in ("story", "intent"):
            with self.subTest(kind=kind):
                game = self.game(f"race-{kind}.sqlite3")
                story_id = game.story_draft({"templateId": "signal-rain-v1"})["draftId"]
                if kind == "intent":
                    game.confirm_story(story_id)
                    identifier = game.intent({"text": "去办公室", "requestId": "racing-move"})["turnId"]
                else:
                    identifier = story_id
                other_request = SinglePlayerGame(game.kernel, game.session_id)
                receipt_started, finish_receipt, cancel_started = threading.Event(), threading.Event(), threading.Event()
                save_receipt = game._save_receipt

                def paused_receipt(*args):
                    receipt_started.set()
                    if not finish_receipt.wait(5):
                        raise AssertionError("confirmation did not resume")
                    return save_receipt(*args)

                def cancel():
                    cancel_started.set()
                    return getattr(other_request, "cancel_" + kind)(identifier)

                with ThreadPoolExecutor(max_workers=2) as executor, patch.object(game, "_save_receipt", side_effect=paused_receipt):
                    confirming = executor.submit(getattr(game, "confirm_" + kind), identifier)
                    self.assertTrue(receipt_started.wait(5))
                    cancelling = executor.submit(cancel)
                    try:
                        self.assertTrue(cancel_started.wait(5))
                        self.assertFalse(cancelling.done())
                    finally:
                        finish_receipt.set()
                    committed = confirming.result(timeout=5)
                    code = "story_already_committed" if kind == "story" else "turn_already_committed"
                    self.assert_error(lambda: cancelling.result(timeout=5), code, 409)
                self.assertEqual(getattr(game, "confirm_" + kind)(identifier), committed)


@unittest.skipIf(FastAPI is None, "install backend[api] to run HTTP boundary tests")
class SinglePlayerCancellationApiTests(unittest.TestCase):
    def test_restarted_public_cancel_reports_committed_and_preserves_session_isolation(self):
        async def run():
            with tempfile.TemporaryDirectory() as directory:
                filename = str(Path(directory) / "world.sqlite3")
                first_store, restarted_store = EventStore(filename), EventStore(filename)
                try:
                    first = create_app(WorldKernel(store=first_store))
                    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=first), base_url="http://test") as client:
                        draft = (await client.post("/api/v4/play/story", json={"templateId": "signal-rain-v1"})).json()
                        story_id = draft["draftId"]
                        self.assertEqual((await client.post(f"/api/v4/play/story/{story_id}/confirm")).status_code, 200)
                        turn = (await client.post("/api/v4/play/intent", json={"text": "去办公室", "requestId": "move-once"})).json()
                        turn_id = turn["turnId"]
                        committed = await client.post(f"/api/v4/play/intent/{turn_id}/confirm")
                        self.assertEqual(committed.status_code, 200)
                        cookie = client.cookies.get("voodoo_session")

                    restarted = create_app(WorldKernel(store=restarted_store))
                    transport = httpx.ASGITransport(app=restarted)
                    async with httpx.AsyncClient(transport=transport, base_url="http://test") as owner, httpx.AsyncClient(transport=transport, base_url="http://test") as stranger:
                        owner.cookies.set("voodoo_session", cookie)
                        await stranger.get("/api/v4/session")
                        before = (await owner.get("/api/v4/session")).json()
                        for kind, identifier, code in (("story", story_id, "story_already_committed"), ("intent", turn_id, "turn_already_committed")):
                            url = f"/api/v4/play/{kind}/{identifier}"
                            response = await owner.post(url + "/cancel")
                            self.assertEqual(response.status_code, 409, response.text)
                            self.assertEqual(response.json()["detail"]["code"], code)
                            self.assertEqual((await stranger.post(url + "/cancel")).status_code, 404)
                            self.assertEqual((await stranger.post(url + "/confirm")).status_code, 404)
                        self.assertEqual((await owner.get("/api/v4/session")).json(), before)
                        retry = await owner.post(f"/api/v4/play/intent/{turn_id}/confirm")
                        self.assertEqual(retry.json(), committed.json())
                finally:
                    first_store.close()
                    restarted_store.close()

        asyncio.run(run())
