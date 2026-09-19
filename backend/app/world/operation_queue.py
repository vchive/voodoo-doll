"""Ordered operations with a server-side generation fence.

Agent calls can outlive the world state that produced their prompt.  This
module keeps those calls outside the domain transaction: an operation is
accepted only at the current fence, and its result is committed only while
the same fence is still current.  A late result is returned as a rejected
receipt and recorded as an audit item; it never mutates caller-owned state.

The queue intentionally has no model, database, or event-store dependency.
The WorldKernel can use it around an adapter call, while a durable worker can
persist the receipts/audits at its own boundary.
"""

from __future__ import annotations

from copy import deepcopy
from dataclasses import dataclass, field
import hashlib
import json
import threading
from typing import Any, Dict, List, Mapping, Optional


_UNSET = object()


def _non_negative_int(value: Any, name: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise ValueError("%s must be a non-negative integer" % name)
    return value


@dataclass(frozen=True)
class FenceSnapshot:
    """The generation values used to validate one operation."""

    world_generation: int
    activation_generations: Mapping[str, int] = field(default_factory=dict)

    def activation(self, key: Optional[str] = None) -> int:
        """Return a scoped activation generation, defaulting to zero."""
        scope = key or "__global__"
        return int(self.activation_generations.get(scope, 0))

    def to_dict(self) -> Dict[str, Any]:
        return {
            "worldGeneration": self.world_generation,
            "activationGenerations": dict(self.activation_generations),
        }


class GenerationFence:
    """Thread-safe monotonic world and per-activation generation counters."""

    def __init__(
        self,
        world_generation: int = 0,
        activation_generations: Optional[Mapping[str, int]] = None,
        activation_generation: Optional[int] = None,
    ) -> None:
        self._lock = threading.RLock()
        self._world_generation = _non_negative_int(world_generation, "world_generation")
        values = dict(activation_generations or {})
        if activation_generation is not None:
            values["__global__"] = _non_negative_int(activation_generation, "activation_generation")
        self._activation_generations: Dict[str, int] = {}
        for key, value in values.items():
            self._activation_generations[self._scope(key)] = _non_negative_int(value, "activation_generation")

    @staticmethod
    def _scope(key: Optional[str]) -> str:
        if key is None:
            return "__global__"
        if not isinstance(key, str) or not key.strip() or len(key) > 160:
            raise ValueError("activation_key must be a non-empty string")
        return key

    def snapshot(self) -> FenceSnapshot:
        with self._lock:
            return FenceSnapshot(self._world_generation, dict(self._activation_generations))

    def current_activation(self, key: Optional[str] = None) -> int:
        with self._lock:
            return int(self._activation_generations.get(self._scope(key), 0))

    def advance_world(self, generation: Optional[int] = None) -> FenceSnapshot:
        """Advance the world generation, rejecting rollback attempts."""
        with self._lock:
            next_generation = self._world_generation + 1 if generation is None else _non_negative_int(generation, "world_generation")
            if next_generation < self._world_generation:
                raise ValueError("world_generation cannot move backwards")
            self._world_generation = next_generation
            return self.snapshot()

    def advance_activation(self, key: Optional[str] = None, generation: Optional[int] = None) -> FenceSnapshot:
        """Advance one activation scope, rejecting rollback attempts."""
        scope = self._scope(key)
        with self._lock:
            current = int(self._activation_generations.get(scope, 0))
            next_generation = current + 1 if generation is None else _non_negative_int(generation, "activation_generation")
            if next_generation < current:
                raise ValueError("activation_generation cannot move backwards")
            self._activation_generations[scope] = next_generation
            return self.snapshot()

    def matches(
        self,
        world_generation: int,
        activation_generation: Optional[int] = None,
        activation_key: Optional[str] = None,
    ) -> bool:
        """Check a proposed fence against current server generations."""
        expected_world = _non_negative_int(world_generation, "world_generation")
        expected_activation = None if activation_generation is None else _non_negative_int(activation_generation, "activation_generation")
        with self._lock:
            if expected_world != self._world_generation:
                return False
            return expected_activation is None or expected_activation == self._activation_generations.get(self._scope(activation_key), 0)


@dataclass(frozen=True)
class QueuedOperation:
    """Immutable operation envelope passed to an adapter/worker."""

    operation_id: str
    input_sequence: int
    payload: Mapping[str, Any]
    world_generation: int
    activation_generation: Optional[int] = None
    activation_key: Optional[str] = None
    actor_id: Optional[str] = None
    idempotency_key: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "operationId": self.operation_id,
            "inputSequence": self.input_sequence,
            "payload": deepcopy(dict(self.payload)),
            "worldGeneration": self.world_generation,
            "activationGeneration": self.activation_generation,
            "activationKey": self.activation_key,
            "actorId": self.actor_id,
            "idempotencyKey": self.idempotency_key,
        }


@dataclass(frozen=True)
class OperationReceipt:
    """The only result a queue caller needs to persist or return to a client."""

    operation_id: str
    status: str
    input_sequence: Optional[int] = None
    result: Any = None
    audit: Optional[Mapping[str, Any]] = None

    @property
    def accepted(self) -> bool:
        return self.status in {"queued", "running", "completed"}

    def to_dict(self) -> Dict[str, Any]:
        value: Dict[str, Any] = {
            "operationId": self.operation_id,
            "status": self.status,
            "inputSequence": self.input_sequence,
        }
        if self.status == "completed":
            value["result"] = deepcopy(self.result)
        if self.audit is not None:
            value["audit"] = deepcopy(dict(self.audit))
        return value


class OperationQueue:
    """FIFO operation queue guarded by a world/activation generation fence.

    The queue permits one running operation at a time by default.  Callers
    advance the fence when a committed world transition or activation lease
    change occurs.  Any result arriving after that advance is rejected with a
    ``generation_fence_reject`` audit record.
    """

    def __init__(
        self,
        world_generation: int = 0,
        activation_generations: Optional[Mapping[str, int]] = None,
        activation_generation: Optional[int] = None,
        max_in_flight: int = 1,
    ) -> None:
        if isinstance(max_in_flight, bool) or not isinstance(max_in_flight, int) or max_in_flight < 1:
            raise ValueError("max_in_flight must be a positive integer")
        self._lock = threading.RLock()
        self.fence = GenerationFence(world_generation, activation_generations, activation_generation)
        self.max_in_flight = max_in_flight
        self._next_sequence = 1
        self._pending: Dict[str, QueuedOperation] = {}
        self._running: Dict[str, QueuedOperation] = {}
        self._receipts: Dict[str, OperationReceipt] = {}
        self._fingerprints: Dict[str, str] = {}
        self._audits: List[Dict[str, Any]] = []

    @staticmethod
    def _operation_id(value: Any) -> str:
        if not isinstance(value, str) or not value.strip() or len(value) > 200:
            raise ValueError("operation_id must be a non-empty string")
        return value

    @staticmethod
    def _fingerprint(
        operation_id: str,
        payload: Mapping[str, Any],
        world_generation: int,
        activation_generation: Optional[int],
        activation_key: Optional[str],
        actor_id: Optional[str],
        idempotency_key: Optional[str],
    ) -> str:
        data = {
            "operationId": operation_id,
            "payload": payload,
            "worldGeneration": world_generation,
            "activationGeneration": activation_generation,
            "activationKey": activation_key,
            "actorId": actor_id,
            "idempotencyKey": idempotency_key,
        }
        encoded = json.dumps(data, ensure_ascii=False, sort_keys=True, separators=(",", ":"), default=str)
        return hashlib.sha256(encoded.encode("utf-8")).hexdigest()

    def _audit(
        self,
        operation: QueuedOperation,
        reason: str,
        stage: str,
        expected: Optional[Mapping[str, Any]] = None,
    ) -> Dict[str, Any]:
        current = self.fence.snapshot()
        record = {
            "auditId": "%s:%s:%s" % (operation.operation_id, stage, len(self._audits) + 1),
            "kind": "generation_fence_reject",
            "reason": reason,
            "stage": stage,
            "operationId": operation.operation_id,
            "inputSequence": operation.input_sequence,
            "expected": dict(expected or {
                "worldGeneration": operation.world_generation,
                "activationGeneration": operation.activation_generation,
                "activationKey": operation.activation_key,
            }),
            "current": {
                "worldGeneration": current.world_generation,
                "activationGeneration": current.activation(operation.activation_key),
                "activationKey": operation.activation_key,
            },
        }
        self._audits.append(record)
        return record

    def _reject(self, operation: QueuedOperation, reason: str, stage: str) -> OperationReceipt:
        audit = self._audit(operation, reason, stage)
        receipt = OperationReceipt(operation.operation_id, "rejected", operation.input_sequence, audit=audit)
        self._receipts[operation.operation_id] = receipt
        return receipt

    def enqueue(
        self,
        operation_id: str,
        payload: Optional[Mapping[str, Any]] = None,
        *,
        world_generation: int,
        activation_generation: Optional[int] = None,
        activation_key: Optional[str] = None,
        actor_id: Optional[str] = None,
        idempotency_key: Optional[str] = None,
    ) -> OperationReceipt:
        """Queue one operation, or return its prior receipt on an exact retry."""
        operation_id = self._operation_id(operation_id)
        if payload is None:
            payload = {}
        if not isinstance(payload, Mapping):
            raise ValueError("payload must be an object")
        world_generation = _non_negative_int(world_generation, "world_generation")
        if activation_generation is not None:
            activation_generation = _non_negative_int(activation_generation, "activation_generation")
        if activation_key is not None:
            GenerationFence._scope(activation_key)
        payload_copy = deepcopy(dict(payload))
        fingerprint = self._fingerprint(operation_id, payload_copy, world_generation, activation_generation, activation_key, actor_id, idempotency_key)
        with self._lock:
            existing = self._receipts.get(operation_id)
            if existing is not None:
                if self._fingerprints.get(operation_id) != fingerprint:
                    raise ValueError("operation_id was already used by another request")
                return existing
            operation = QueuedOperation(
                operation_id=operation_id,
                input_sequence=self._next_sequence,
                payload=payload_copy,
                world_generation=world_generation,
                activation_generation=activation_generation,
                activation_key=activation_key,
                actor_id=actor_id,
                idempotency_key=idempotency_key,
            )
            self._next_sequence += 1
            self._fingerprints[operation_id] = fingerprint
            if not self.fence.matches(world_generation, activation_generation, activation_key):
                return self._reject(operation, "stale_generation_at_enqueue", "enqueue")
            self._pending[operation_id] = operation
            receipt = OperationReceipt(operation_id, "queued", operation.input_sequence)
            self._receipts[operation_id] = receipt
            return receipt

    submit = enqueue

    def get(self, operation_id: str) -> Optional[QueuedOperation]:
        with self._lock:
            operation = self._pending.get(operation_id) or self._running.get(operation_id)
            return deepcopy(operation) if operation is not None else None

    def pending(self) -> List[QueuedOperation]:
        with self._lock:
            return [deepcopy(item) for item in sorted(self._pending.values(), key=lambda item: item.input_sequence)]

    def running(self) -> List[QueuedOperation]:
        with self._lock:
            return [deepcopy(item) for item in sorted(self._running.values(), key=lambda item: item.input_sequence)]

    def receipt(self, operation_id: str) -> Optional[OperationReceipt]:
        with self._lock:
            receipt = self._receipts.get(operation_id)
            return deepcopy(receipt) if receipt is not None else None

    def start_next(self) -> Optional[QueuedOperation]:
        """Start the oldest operation that still passes the current fence."""
        with self._lock:
            if len(self._running) >= self.max_in_flight:
                return None
            for operation in self.pending():
                self._pending.pop(operation.operation_id, None)
                if not self.fence.matches(operation.world_generation, operation.activation_generation, operation.activation_key):
                    self._reject(operation, "stale_generation_before_start", "start")
                    continue
                self._running[operation.operation_id] = operation
                self._receipts[operation.operation_id] = OperationReceipt(operation.operation_id, "running", operation.input_sequence)
                return deepcopy(operation)
            return None

    def start(self, operation_id: str) -> Optional[QueuedOperation]:
        """Start a specific queued operation when it is next in FIFO order."""
        with self._lock:
            operation = self._pending.get(operation_id)
            if operation is None:
                return self._running.get(operation_id)
            oldest = min(self._pending.values(), key=lambda item: item.input_sequence)
            if oldest.operation_id != operation_id or self._running:
                return None
            return self.start_next()

    def complete(
        self,
        operation_id: str,
        result: Any = None,
        *,
        world_generation: Optional[int] = None,
        activation_generation: Any = _UNSET,
    ) -> OperationReceipt:
        """Commit a result only while its original generation fence is valid.

        Optional generation arguments are observations supplied by a worker;
        they cannot replace the generation captured when the operation was
        queued.  This prevents a late result from bypassing the fence by
        claiming the newer world generation.
        """
        with self._lock:
            operation = self._running.pop(operation_id, None)
            if operation is None:
                prior = self._receipts.get(operation_id)
                if prior is not None:
                    return prior
                raise KeyError("operation is not running: %s" % operation_id)
            explicit_activation = operation.activation_generation if activation_generation is _UNSET else activation_generation
            if world_generation is not None:
                world_generation = _non_negative_int(world_generation, "world_generation")
            if explicit_activation is not None:
                explicit_activation = _non_negative_int(explicit_activation, "activation_generation")
            # A worker may report what it observed, but it must match the
            # operation's immutable fence before the current fence is checked.
            observed_mismatch = (
                world_generation is not None and world_generation != operation.world_generation
            ) or (
                activation_generation is not _UNSET
                and explicit_activation != operation.activation_generation
            )
            expected_world = operation.world_generation
            expected_activation = operation.activation_generation
            if observed_mismatch or not self.fence.matches(expected_world, expected_activation, operation.activation_key):
                audit = self._audit(
                    operation,
                    "result_generation_mismatch" if observed_mismatch else "stale_generation_at_complete",
                    "complete",
                    expected={
                        "worldGeneration": expected_world,
                        "activationGeneration": expected_activation,
                        "activationKey": operation.activation_key,
                    },
                )
                receipt = OperationReceipt(operation_id, "rejected", operation.input_sequence, audit=audit)
                self._receipts[operation_id] = receipt
                return receipt
            receipt = OperationReceipt(operation_id, "completed", operation.input_sequence, result=deepcopy(result))
            self._receipts[operation_id] = receipt
            return receipt

    def cancel(self, operation_id: str, reason: str = "cancelled") -> OperationReceipt:
        with self._lock:
            operation = self._pending.pop(operation_id, None) or self._running.pop(operation_id, None)
            if operation is None:
                prior = self._receipts.get(operation_id)
                if prior is not None:
                    return prior
                raise KeyError("unknown operation: %s" % operation_id)
            receipt = OperationReceipt(operation_id, "cancelled", operation.input_sequence, audit={"reason": reason})
            self._receipts[operation_id] = receipt
            return receipt

    def advance_world(self, generation: Optional[int] = None) -> FenceSnapshot:
        with self._lock:
            return self.fence.advance_world(generation)

    def advance_activation(self, key: Optional[str] = None, generation: Optional[int] = None) -> FenceSnapshot:
        with self._lock:
            return self.fence.advance_activation(key, generation)

    def audits(self) -> List[Dict[str, Any]]:
        with self._lock:
            return deepcopy(self._audits)

    def snapshot(self) -> Dict[str, Any]:
        with self._lock:
            fence = self.fence.snapshot()
            return {
                "fence": fence.to_dict(),
                "nextInputSequence": self._next_sequence,
                "pending": [item.to_dict() for item in self.pending()],
                "running": [item.to_dict() for item in self.running()],
                "audits": self.audits(),
            }


__all__ = [
    "FenceSnapshot",
    "GenerationFence",
    "OperationQueue",
    "OperationReceipt",
    "QueuedOperation",
]
