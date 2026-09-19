"""Persistence adapters.

The first kernel implementation historically lived in ``app/store.py`` while
the package layout was being introduced. Re-exporting the class here keeps
``from backend.app.store import EventStore`` stable and makes the package the
single import boundary.
"""

from .event_store import EventStore

__all__ = ["EventStore"]
