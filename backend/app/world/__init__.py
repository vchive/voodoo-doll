"""Deterministic world lifecycle services.

These modules intentionally contain no model calls.  They turn server time and
published registry data into replayable projections that the WorldKernel can
commit as events.
"""

from .clock import advance_clock, clock_snapshot, default_clock
from .schedule import project_presence, schedule_matches
from .activation import active_projection_ids, expire_leases, interest_update, reconcile_leases
from .observer import audit_state
from .operation_queue import FenceSnapshot, GenerationFence, OperationQueue, OperationReceipt, QueuedOperation

__all__ = [
    "advance_clock",
    "clock_snapshot",
    "default_clock",
    "project_presence",
    "schedule_matches",
    "active_projection_ids",
    "expire_leases",
    "interest_update",
    "reconcile_leases",
    "audit_state",
    "FenceSnapshot",
    "GenerationFence",
    "OperationQueue",
    "OperationReceipt",
    "QueuedOperation",
]
