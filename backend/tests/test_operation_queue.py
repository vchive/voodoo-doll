import unittest

from backend.app.world.operation_queue import GenerationFence, OperationQueue


class GenerationFenceTests(unittest.TestCase):
    def test_generations_only_move_forward_and_are_scoped(self):
        fence = GenerationFence(world_generation=2, activation_generations={"A": 3})
        self.assertTrue(fence.matches(2, 3, "A"))
        self.assertFalse(fence.matches(1, 3, "A"))
        self.assertFalse(fence.matches(2, 2, "A"))
        self.assertTrue(fence.matches(2, 0, "B"))
        fence.advance_world()
        fence.advance_activation("A")
        with self.assertRaises(ValueError):
            fence.advance_world(1)
        with self.assertRaises(ValueError):
            fence.advance_activation("A", 1)


class OperationQueueTests(unittest.TestCase):
    def test_completion_is_rejected_after_world_generation_moves(self):
        queue = OperationQueue(world_generation=4, activation_generations={"A": 2})
        queued = queue.enqueue("op-1", {"prompt": "hello"}, world_generation=4, activation_generation=2, activation_key="A")
        self.assertEqual(queued.status, "queued")
        operation = queue.start_next()
        self.assertEqual(operation.operation_id, "op-1")

        queue.advance_world()
        rejected = queue.complete("op-1", {"text": "late"})
        self.assertEqual(rejected.status, "rejected")
        self.assertEqual(rejected.audit["reason"], "stale_generation_at_complete")
        self.assertEqual(rejected.audit["current"]["worldGeneration"], 5)
        self.assertEqual(queue.audits(), [dict(rejected.audit)])

    def test_activation_generation_rejects_late_result_without_world_change(self):
        queue = OperationQueue(world_generation=1, activation_generations={"A": 7})
        queue.enqueue("op-activation", {}, world_generation=1, activation_generation=7, activation_key="A")
        queue.start_next()
        queue.advance_activation("A")
        rejected = queue.complete("op-activation", "late")
        self.assertEqual(rejected.status, "rejected")
        self.assertEqual(rejected.audit["reason"], "stale_generation_at_complete")
        self.assertEqual(rejected.audit["current"]["activationGeneration"], 8)

    def test_worker_cannot_bypass_original_fence_by_claiming_new_generation(self):
        queue = OperationQueue(world_generation=1)
        queue.enqueue("op-bypass", {}, world_generation=1)
        queue.start_next()
        queue.advance_world()
        rejected = queue.complete("op-bypass", "late", world_generation=2)
        self.assertEqual(rejected.status, "rejected")
        self.assertEqual(rejected.audit["reason"], "result_generation_mismatch")
        self.assertEqual(rejected.audit["expected"]["worldGeneration"], 1)

    def test_stale_enqueue_is_rejected_and_does_not_enter_pending(self):
        queue = OperationQueue(world_generation=3)
        rejected = queue.enqueue("old", {}, world_generation=2)
        self.assertEqual(rejected.status, "rejected")
        self.assertEqual(rejected.audit["reason"], "stale_generation_at_enqueue")
        self.assertEqual(queue.pending(), [])
        self.assertEqual(queue.receipt("old"), rejected)

    def test_fifo_idempotency_and_result_are_stable(self):
        queue = OperationQueue(world_generation=0)
        first = queue.enqueue("one", {"n": 1}, world_generation=0)
        retry = queue.enqueue("one", {"n": 1}, world_generation=0)
        self.assertEqual(first, retry)
        with self.assertRaises(ValueError):
            queue.enqueue("one", {"n": 2}, world_generation=0)

        queue.enqueue("two", {"n": 2}, world_generation=0)
        self.assertEqual(queue.start_next().operation_id, "one")
        self.assertIsNone(queue.start("two"))
        completed = queue.complete("one", {"ok": True})
        self.assertEqual(completed.status, "completed")
        self.assertEqual(completed.result, {"ok": True})
        self.assertEqual(queue.start_next().operation_id, "two")

    def test_snapshot_and_cancel_do_not_expose_mutable_payload(self):
        queue = OperationQueue()
        payload = {"nested": {"value": 1}}
        queue.enqueue("copy", payload, world_generation=0)
        payload["nested"]["value"] = 9
        self.assertEqual(queue.pending()[0].payload["nested"]["value"], 1)
        pending_operation = queue.pending()[0]
        pending_operation.payload["nested"]["value"] = 7
        self.assertEqual(queue.pending()[0].payload["nested"]["value"], 1)
        snapshot = queue.snapshot()
        snapshot["pending"][0]["payload"]["nested"]["value"] = 8
        self.assertEqual(queue.pending()[0].payload["nested"]["value"], 1)
        cancelled = queue.cancel("copy", "client_cancelled")
        self.assertEqual(cancelled.status, "cancelled")
        self.assertEqual(cancelled.audit["reason"], "client_cancelled")


if __name__ == "__main__":
    unittest.main()
