"""Cookie-backed anonymous session ownership for the HTTP product boundary."""

from __future__ import annotations

import uuid
import threading
from typing import Any, Dict, Optional, Tuple

from .domain.world import WorldKernel
from .store.event_store import EventStore


SESSION_COOKIE = "voodoo_session"


class SessionManager:
    """Resolve one HttpOnly cookie to one durable world.

    The client never supplies an authoritative world id. A process-local kernel
    cache is only an optimization; EventStore remains the source of truth so a
    second process or a restart can reconstruct the same world.
    """

    def __init__(self, store: EventStore):
        self.store = store
        self._kernels: Dict[str, WorldKernel] = {}
        self._lock = threading.RLock()

    @staticmethod
    def _new_id(prefix: str) -> str:
        return f"{prefix}-{uuid.uuid4().hex}"

    def resolve(self, session_id: Optional[str]) -> Tuple[str, WorldKernel, bool]:
        with self._lock:
            created = False
            record = self.store.get_session(session_id) if isinstance(session_id, str) and session_id else None
            if record is None:
                session_id = self._new_id("s")
                world_id = self._new_id("w")
                self.store.create_session(session_id, world_id)
                created = True
            else:
                world_id = str(record["world_id"])
                self.store.touch_session(str(session_id))
            assert session_id is not None
            kernel = self._kernels.get(str(session_id))
            if kernel is None or kernel.state.world_id != world_id:
                kernel = WorldKernel(world_id=world_id, store=self.store)
                self._kernels[str(session_id)] = kernel
            return str(session_id), kernel, created
