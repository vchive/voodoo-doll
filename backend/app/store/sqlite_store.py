"""SQLite event/snapshot store with append-only events and idempotency."""

from __future__ import annotations

import json
import sqlite3
from typing import Any, Dict, List, Optional

from ..domain.events import Event
from ..domain.models import WorldState


class SQLiteStore:
    def __init__(self, path: str = ":memory:", world_id: str = "local-world") -> None:
        self.world_id = world_id
        self.connection = sqlite3.connect(path, check_same_thread=False)
        self.connection.row_factory = sqlite3.Row
        self._create_tables()

    def _create_tables(self) -> None:
        self.connection.executescript(
            """
            CREATE TABLE IF NOT EXISTS world_snapshots (
              world_id TEXT PRIMARY KEY, world_version INTEGER NOT NULL, payload_json TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS events (
              event_id TEXT PRIMARY KEY, world_id TEXT NOT NULL, world_version INTEGER NOT NULL,
              turn_id TEXT NOT NULL, payload_json TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS events_world_version ON events(world_id, world_version);
            CREATE TABLE IF NOT EXISTS idempotency_keys (
              world_id TEXT NOT NULL, idempotency_key TEXT NOT NULL, result_json TEXT NOT NULL,
              PRIMARY KEY(world_id, idempotency_key)
            );
            """
        )
        self.connection.commit()

    def save_snapshot(self, state: WorldState) -> None:
        self.connection.execute(
            "INSERT INTO world_snapshots(world_id, world_version, payload_json) VALUES(?, ?, ?) "
            "ON CONFLICT(world_id) DO UPDATE SET world_version=excluded.world_version, payload_json=excluded.payload_json",
            (state.world_id, state.world_version, json.dumps(state.to_dict(), ensure_ascii=False)),
        )
        self.connection.commit()

    def load_snapshot(self, world_id: str) -> Optional[WorldState]:
        row = self.connection.execute("SELECT payload_json FROM world_snapshots WHERE world_id=?", (world_id,)).fetchone()
        return WorldState.from_dict(json.loads(row["payload_json"])) if row else None

    def append_events(self, events: List[Event]) -> None:
        self.connection.executemany(
            "INSERT INTO events(event_id, world_id, world_version, turn_id, payload_json) VALUES(?, ?, ?, ?, ?)",
            [(event.event_id, self.world_id, event.world_version, event.turn_id, json.dumps(event.to_dict(), ensure_ascii=False)) for event in events],
        )
        self.connection.commit()

    def events_after(self, world_id: str, version: int = 0) -> List[Dict[str, Any]]:
        rows = self.connection.execute(
            "SELECT payload_json FROM events WHERE world_id=? AND world_version>? ORDER BY world_version, event_id",
            (world_id, version),
        ).fetchall()
        return [json.loads(row["payload_json"]) for row in rows]

    def get_idempotent(self, world_id: str, key: Optional[str]) -> Optional[Dict[str, Any]]:
        if not key:
            return None
        row = self.connection.execute(
            "SELECT result_json FROM idempotency_keys WHERE world_id=? AND idempotency_key=?", (world_id, key)
        ).fetchone()
        return json.loads(row["result_json"]) if row else None

    def save_idempotent(self, world_id: str, key: Optional[str], result: Dict[str, Any]) -> None:
        if not key:
            return
        self.connection.execute(
            "INSERT OR REPLACE INTO idempotency_keys(world_id, idempotency_key, result_json) VALUES(?, ?, ?)",
            (world_id, key, json.dumps(result, ensure_ascii=False)),
        )
        self.connection.commit()
