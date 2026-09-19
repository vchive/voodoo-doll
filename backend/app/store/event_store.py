"""SQLite append-only store with a small, dependency-free API."""

import json
import sqlite3
import threading
import time
from typing import Any, Dict, Iterable, List, Optional, Tuple

from ..domain.models import Event, ValidationError, VersionConflict, WorldState


class EventStore:
    def __init__(self, filename: str = ":memory:"):
        self.filename = filename
        self._lock = threading.RLock()
        self._connection = sqlite3.connect(filename, check_same_thread=False)
        self._connection.row_factory = sqlite3.Row
        self._setup()

    def _setup(self) -> None:
        with self._connection:
            self._connection.executescript(
                """
                CREATE TABLE IF NOT EXISTS world_snapshots (
                  world_id TEXT PRIMARY KEY, world_version INTEGER NOT NULL,
                  state_json TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS sessions (
                  session_id TEXT PRIMARY KEY, world_id TEXT NOT NULL UNIQUE,
                  created_at REAL NOT NULL, last_seen_at REAL NOT NULL
                );
                CREATE INDEX IF NOT EXISTS sessions_last_seen ON sessions(last_seen_at);
                CREATE TABLE IF NOT EXISTS events (
                  world_id TEXT NOT NULL, event_id TEXT NOT NULL,
                  world_version INTEGER NOT NULL, turn_id TEXT NOT NULL,
                  payload_json TEXT NOT NULL,
                  PRIMARY KEY(world_id, event_id)
                );
                CREATE INDEX IF NOT EXISTS events_world_version ON events(world_id, world_version);
                CREATE TABLE IF NOT EXISTS idempotency_keys (
                  world_id TEXT NOT NULL, idempotency_key TEXT NOT NULL,
                  request_json TEXT NOT NULL, result_json TEXT NOT NULL,
                  PRIMARY KEY(world_id, idempotency_key)
                );
                CREATE TABLE IF NOT EXISTS turn_results (
                  world_id TEXT NOT NULL, turn_id TEXT NOT NULL,
                  request_json TEXT NOT NULL, result_json TEXT NOT NULL,
                  PRIMARY KEY(world_id, turn_id)
                );
                CREATE TABLE IF NOT EXISTS draft_turns (
                  world_id TEXT NOT NULL, turn_id TEXT NOT NULL,
                  request_json TEXT NOT NULL, result_json TEXT NOT NULL,
                  PRIMARY KEY(world_id, turn_id)
                );
                CREATE TABLE IF NOT EXISTS world_build_drafts (
                  world_id TEXT NOT NULL, draft_id TEXT NOT NULL,
                  payload_json TEXT NOT NULL,
                  PRIMARY KEY(world_id, draft_id)
                );
                CREATE TABLE IF NOT EXISTS gameplay_receipts (
                  world_id TEXT NOT NULL, receipt_type TEXT NOT NULL,
                  receipt_id TEXT NOT NULL, result_json TEXT NOT NULL,
                  PRIMARY KEY(world_id, receipt_type, receipt_id)
                );
                CREATE TABLE IF NOT EXISTS audit_events (
                  audit_id INTEGER PRIMARY KEY AUTOINCREMENT,
                  world_id TEXT NOT NULL,
                  world_version INTEGER NOT NULL,
                  event_type TEXT NOT NULL,
                  payload_json TEXT NOT NULL,
                  report_hash TEXT
                );
                CREATE INDEX IF NOT EXISTS audit_events_world_id ON audit_events(world_id, audit_id);
                """
            )
            # Serialize schema inspection and backfill across processes so two
            # workers cannot both try to upgrade the same pre-hash database.
            self._connection.execute("BEGIN IMMEDIATE")
            event_columns = self._connection.execute("PRAGMA table_info(events)").fetchall()
            event_pk = [row["name"] for row in sorted(event_columns, key=lambda row: int(row["pk"])) if int(row["pk"])]
            if event_pk != ["world_id", "event_id"]:
                # The first schema used event_id as a global primary key. A
                # shared database now serves many anonymous worlds, so the
                # world namespace must be part of identity. Preserve every
                # historical row; duplicate event IDs across worlds become
                # valid once copied into the composite-key table.
                self._connection.execute("DROP INDEX IF EXISTS events_world_version")
                self._connection.execute("ALTER TABLE events RENAME TO events_legacy")
                self._connection.execute(
                    """
                    CREATE TABLE events (
                      world_id TEXT NOT NULL, event_id TEXT NOT NULL,
                      world_version INTEGER NOT NULL, turn_id TEXT NOT NULL,
                      payload_json TEXT NOT NULL,
                      PRIMARY KEY(world_id, event_id)
                    )
                    """
                )
                self._connection.execute(
                    "INSERT INTO events(world_id, event_id, world_version, turn_id, payload_json) "
                    "SELECT world_id, event_id, world_version, turn_id, payload_json FROM events_legacy"
                )
                self._connection.execute("DROP TABLE events_legacy")
                self._connection.execute("CREATE INDEX events_world_version ON events(world_id, world_version)")
            columns = {row["name"] for row in self._connection.execute("PRAGMA table_info(audit_events)")}
            if "report_hash" not in columns:
                self._connection.execute("ALTER TABLE audit_events ADD COLUMN report_hash TEXT")
                # Keep the append-only history, including any old duplicates,
                # and let the earliest report own each persisted dedupe key.
                seen = set()
                rows = self._connection.execute(
                    "SELECT audit_id, world_id, payload_json FROM audit_events WHERE event_type = ? ORDER BY audit_id",
                    ("world_observer_report",),
                ).fetchall()
                for row in rows:
                    try:
                        payload = json.loads(row["payload_json"])
                    except (TypeError, ValueError):
                        continue
                    report_hash = payload.get("reportHash") if isinstance(payload, dict) else None
                    key = (row["world_id"], report_hash)
                    if not isinstance(report_hash, str) or not report_hash or key in seen:
                        continue
                    seen.add(key)
                    self._connection.execute(
                        "UPDATE audit_events SET report_hash = ? WHERE audit_id = ?",
                        (report_hash, row["audit_id"]),
                    )
            self._connection.execute(
                "CREATE UNIQUE INDEX IF NOT EXISTS audit_observer_report_hash "
                "ON audit_events(world_id, report_hash) "
                "WHERE event_type = 'world_observer_report' AND report_hash IS NOT NULL"
            )

    def initialize(self, state: WorldState) -> WorldState:
        with self._lock, self._connection:
            row = self._connection.execute("SELECT state_json FROM world_snapshots WHERE world_id = ?", (state.world_id,)).fetchone()
            if row:
                return WorldState.from_dict(json.loads(row["state_json"]))
            self._connection.execute(
                "INSERT INTO world_snapshots(world_id, world_version, state_json) VALUES (?, ?, ?)",
                (state.world_id, state.world_version, json.dumps(state.to_dict(), ensure_ascii=False, sort_keys=True)),
            )
            return state.clone()

    def get_session(self, session_id: str) -> Optional[Dict[str, Any]]:
        """Return the durable anonymous-session mapping, if it exists."""
        with self._lock:
            row = self._connection.execute(
                "SELECT session_id, world_id, created_at, last_seen_at FROM sessions WHERE session_id = ?",
                (session_id,),
            ).fetchone()
            return dict(row) if row else None

    def create_session(self, session_id: str, world_id: str, now: Optional[float] = None) -> Dict[str, Any]:
        timestamp = float(time.time() if now is None else now)
        with self._lock, self._connection:
            self._connection.execute(
                "INSERT INTO sessions(session_id, world_id, created_at, last_seen_at) VALUES (?, ?, ?, ?)",
                (session_id, world_id, timestamp, timestamp),
            )
        return {"session_id": session_id, "world_id": world_id, "created_at": timestamp, "last_seen_at": timestamp}

    def touch_session(self, session_id: str, now: Optional[float] = None) -> Optional[Dict[str, Any]]:
        timestamp = float(time.time() if now is None else now)
        with self._lock, self._connection:
            self._connection.execute("UPDATE sessions SET last_seen_at = ? WHERE session_id = ?", (timestamp, session_id))
            row = self._connection.execute(
                "SELECT session_id, world_id, created_at, last_seen_at FROM sessions WHERE session_id = ?",
                (session_id,),
            ).fetchone()
            return dict(row) if row else None

    def get_gameplay_receipt(self, world_id: str, receipt_type: str, receipt_id: str) -> Optional[Dict[str, Any]]:
        with self._lock:
            row = self._connection.execute(
                "SELECT result_json FROM gameplay_receipts WHERE world_id = ? AND receipt_type = ? AND receipt_id = ?",
                (world_id, receipt_type, receipt_id),
            ).fetchone()
            return json.loads(row["result_json"]) if row else None

    def save_gameplay_receipt(self, world_id: str, receipt_type: str, receipt_id: str, result: Dict[str, Any]) -> Dict[str, Any]:
        encoded = json.dumps(result, ensure_ascii=False, sort_keys=True)
        with self._lock, self._connection:
            self._connection.execute(
                "INSERT INTO gameplay_receipts(world_id, receipt_type, receipt_id, result_json) VALUES (?, ?, ?, ?) "
                "ON CONFLICT(world_id, receipt_type, receipt_id) DO NOTHING",
                (world_id, receipt_type, receipt_id, encoded),
            )
            row = self._connection.execute(
                "SELECT result_json FROM gameplay_receipts WHERE world_id = ? AND receipt_type = ? AND receipt_id = ?",
                (world_id, receipt_type, receipt_id),
            ).fetchone()
            return json.loads(row["result_json"])

    def save_turn(self, previous_version: int, state: WorldState, events: Iterable[Event], request: Dict[str, Any], result: Dict[str, Any], key: Optional[str]) -> None:
        with self._lock, self._connection:
            row = self._connection.execute("SELECT world_version FROM world_snapshots WHERE world_id = ?", (state.world_id,)).fetchone()
            actual = int(row["world_version"]) if row else 0
            if actual != previous_version:
                raise VersionConflict("world changed while resolving turn")
            self._connection.execute(
                "UPDATE world_snapshots SET world_version = ?, state_json = ? WHERE world_id = ?",
                (state.world_version, json.dumps(state.to_dict(), ensure_ascii=False, sort_keys=True), state.world_id),
            )
            for event in events:
                self._connection.execute(
                    "INSERT INTO events(world_id, event_id, world_version, turn_id, payload_json) VALUES (?, ?, ?, ?, ?)",
                    (state.world_id, event.event_id, event.world_version, event.turn_id, json.dumps(event.to_dict(), ensure_ascii=False, sort_keys=True)),
                )
            self._connection.execute(
                "INSERT INTO turn_results(world_id, turn_id, request_json, result_json) VALUES (?, ?, ?, ?)",
                (state.world_id, result["turnId"], json.dumps(request, ensure_ascii=False, sort_keys=True), json.dumps(result, ensure_ascii=False, sort_keys=True)),
            )
            if key:
                self._connection.execute(
                    "INSERT INTO idempotency_keys(world_id, idempotency_key, request_json, result_json) VALUES (?, ?, ?, ?)",
                    (state.world_id, key, json.dumps(request, ensure_ascii=False, sort_keys=True), json.dumps(result, ensure_ascii=False, sort_keys=True)),
                )

    def save_transition(self, previous_version: int, state: WorldState, events: Iterable[Event]) -> None:
        """Persist a server-owned clock/projection transition.

        Lifecycle changes do not represent a player turn, so they must update
        the snapshot without creating a fake turn result or idempotency key.
        """
        with self._lock, self._connection:
            row = self._connection.execute("SELECT world_version FROM world_snapshots WHERE world_id = ?", (state.world_id,)).fetchone()
            actual = int(row["world_version"]) if row else 0
            if actual != previous_version:
                raise VersionConflict("world changed while applying lifecycle transition")
            self._connection.execute(
                "UPDATE world_snapshots SET world_version = ?, state_json = ? WHERE world_id = ?",
                (state.world_version, json.dumps(state.to_dict(), ensure_ascii=False, sort_keys=True), state.world_id),
            )
            for event in events:
                self._connection.execute(
                    "INSERT INTO events(world_id, event_id, world_version, turn_id, payload_json) VALUES (?, ?, ?, ?, ?)",
                    (state.world_id, event.event_id, event.world_version, event.turn_id, json.dumps(event.to_dict(), ensure_ascii=False, sort_keys=True)),
                )

    def load_state(self, world_id: str) -> Optional[WorldState]:
        with self._lock:
            row = self._connection.execute("SELECT state_json FROM world_snapshots WHERE world_id = ?", (world_id,)).fetchone()
            return WorldState.from_dict(json.loads(row["state_json"])) if row else None

    def get_idempotent(self, world_id: str, key: str) -> Optional[Tuple[Dict[str, Any], Dict[str, Any]]]:
        with self._lock:
            row = self._connection.execute("SELECT request_json, result_json FROM idempotency_keys WHERE world_id = ? AND idempotency_key = ?", (world_id, key)).fetchone()
            if not row:
                return None
            return json.loads(row["request_json"]), json.loads(row["result_json"])

    def get_turn_result(self, world_id: str, turn_id: str) -> Optional[Tuple[Dict[str, Any], Dict[str, Any]]]:
        with self._lock:
            row = self._connection.execute(
                "SELECT request_json, result_json FROM turn_results WHERE world_id = ? AND turn_id = ?",
                (world_id, turn_id),
            ).fetchone()
            if not row:
                return None
            return json.loads(row["request_json"]), json.loads(row["result_json"])

    def save_draft(self, world_id: str, turn_id: str, request: Dict[str, Any], result: Dict[str, Any]) -> None:
        """Persist a draft before any world event is written.

        Drafts are deliberately separate from `turn_results`: a restart can
        recover an unconfirmed draft, while replay still only consumes
        committed events.
        """
        with self._lock, self._connection:
            self._connection.execute(
                "INSERT OR REPLACE INTO draft_turns(world_id, turn_id, request_json, result_json) VALUES (?, ?, ?, ?)",
                (world_id, turn_id, json.dumps(request, ensure_ascii=False, sort_keys=True), json.dumps(result, ensure_ascii=False, sort_keys=True)),
            )

    def get_draft(self, world_id: str, turn_id: str) -> Optional[Tuple[Dict[str, Any], Dict[str, Any]]]:
        with self._lock:
            row = self._connection.execute(
                "SELECT request_json, result_json FROM draft_turns WHERE world_id = ? AND turn_id = ?",
                (world_id, turn_id),
            ).fetchone()
            if not row:
                return None
            return json.loads(row["request_json"]), json.loads(row["result_json"])

    def delete_draft(self, world_id: str, turn_id: str) -> None:
        with self._lock, self._connection:
            self._connection.execute(
                "DELETE FROM draft_turns WHERE world_id = ? AND turn_id = ?",
                (world_id, turn_id),
            )

    def drafts(self, world_id: str) -> List[Tuple[str, Dict[str, Any], Dict[str, Any]]]:
        with self._lock:
            rows = self._connection.execute(
                "SELECT turn_id, request_json, result_json FROM draft_turns WHERE world_id = ? ORDER BY rowid",
                (world_id,),
            ).fetchall()
            return [
                (str(row["turn_id"]), json.loads(row["request_json"]), json.loads(row["result_json"]))
                for row in rows
            ]

    def save_world_draft(self, world_id: str, draft_id: str, payload: Dict[str, Any]) -> None:
        """Create a draft once; an existing preview must never be replaced."""
        with self._lock, self._connection:
            self._connection.execute("BEGIN IMMEDIATE")
            if self._world_build_receipt(world_id, draft_id) is not None:
                raise ValidationError("world draft already exists", "draft_conflict", 409)
            inserted = self._connection.execute(
                "INSERT INTO world_build_drafts(world_id, draft_id, payload_json) VALUES (?, ?, ?) "
                "ON CONFLICT(world_id, draft_id) DO NOTHING",
                (world_id, draft_id, json.dumps(payload, ensure_ascii=False, sort_keys=True)),
            )
            if inserted.rowcount != 1:
                raise ValidationError("world draft already exists", "draft_conflict", 409)

    def _world_build_receipt(self, world_id: str, draft_id: str) -> Optional[Dict[str, Any]]:
        """Read a receipt under the caller's lock/transaction."""
        row = self._connection.execute("SELECT state_json FROM world_snapshots WHERE world_id = ?", (world_id,)).fetchone()
        state = json.loads(row["state_json"]) if row else {}
        for entry in state.get("metadata", {}).get("worldBuilds", []):
            if entry.get("draftId") == draft_id:
                if "result" not in entry:
                    raise ValidationError("legacy world draft is already published", "world_draft_already_published", 409)
                return entry["result"]
        return None

    def get_world_draft(self, world_id: str, draft_id: str) -> Optional[Dict[str, Any]]:
        with self._lock:
            row = self._connection.execute(
                "SELECT payload_json FROM world_build_drafts WHERE world_id = ? AND draft_id = ?",
                (world_id, draft_id),
            ).fetchone()
            return json.loads(row["payload_json"]) if row else None

    def delete_world_draft(self, world_id: str, draft_id: str) -> int:
        """Cancel an unpublished draft atomically with its receipt check."""
        with self._lock, self._connection:
            self._connection.execute("BEGIN IMMEDIATE")
            if self._world_build_receipt(world_id, draft_id) is not None:
                raise ValidationError("published world draft cannot be cancelled", "world_draft_already_published", 409)
            deleted = self._connection.execute("DELETE FROM world_build_drafts WHERE world_id = ? AND draft_id = ?", (world_id, draft_id))
            if deleted.rowcount != 1:
                raise ValidationError("world draft is not available", "unknown_world_draft", 404)
            row = self._connection.execute("SELECT world_version FROM world_snapshots WHERE world_id = ?", (world_id,)).fetchone()
            return int(row["world_version"]) if row else 0

    def publish_world_draft(
        self,
        draft_id: str,
        expected_draft: Dict[str, Any],
        previous_version: int,
        state: WorldState,
        events: Iterable[Event],
        result: Dict[str, Any],
    ) -> Tuple[Dict[str, Any], WorldState]:
        """Commit definitions, receipt and draft removal as one transition.

        The write lock is acquired before checking the receipt and draft, so
        confirmation, cancellation and another publisher have one winner.
        """
        with self._lock, self._connection:
            self._connection.execute("BEGIN IMMEDIATE")
            receipt = self._world_build_receipt(state.world_id, draft_id)
            if receipt is not None:
                row = self._connection.execute("SELECT state_json FROM world_snapshots WHERE world_id = ?", (state.world_id,)).fetchone()
                return receipt, WorldState.from_dict(json.loads(row["state_json"]))
            draft_row = self._connection.execute(
                "SELECT payload_json FROM world_build_drafts WHERE world_id = ? AND draft_id = ?",
                (state.world_id, draft_id),
            ).fetchone()
            if draft_row is None:
                raise ValidationError("world draft is not available", "unknown_world_draft", 404)
            expected_json = json.dumps(expected_draft, ensure_ascii=False, sort_keys=True)
            persisted_json = json.dumps(json.loads(draft_row["payload_json"]), ensure_ascii=False, sort_keys=True)
            if persisted_json != expected_json:
                raise ValidationError("world draft content has changed", "world_draft_hash_mismatch", 409)
            row = self._connection.execute("SELECT world_version FROM world_snapshots WHERE world_id = ?", (state.world_id,)).fetchone()
            if row is None or int(row["world_version"]) != previous_version:
                raise VersionConflict("world changed while publishing draft")
            self._connection.execute(
                "UPDATE world_snapshots SET world_version = ?, state_json = ? WHERE world_id = ?",
                (state.world_version, json.dumps(state.to_dict(), ensure_ascii=False, sort_keys=True), state.world_id),
            )
            for event in events:
                self._connection.execute(
                    "INSERT INTO events(world_id, event_id, world_version, turn_id, payload_json) VALUES (?, ?, ?, ?, ?)",
                    (state.world_id, event.event_id, event.world_version, event.turn_id, json.dumps(event.to_dict(), ensure_ascii=False, sort_keys=True)),
                )
            self._connection.execute(
                "DELETE FROM world_build_drafts WHERE world_id = ? AND draft_id = ?",
                (state.world_id, draft_id),
            )
            return result, state

    def world_drafts(self, world_id: str) -> List[Tuple[str, Dict[str, Any]]]:
        with self._lock:
            rows = self._connection.execute("SELECT draft_id, payload_json FROM world_build_drafts WHERE world_id = ? ORDER BY rowid", (world_id,)).fetchall()
            return [(str(row["draft_id"]), json.loads(row["payload_json"])) for row in rows]

    def events(self, world_id: str, after_version: int = 0, viewer: Optional[str] = None) -> List[Event]:
        with self._lock:
            rows = self._connection.execute("SELECT payload_json FROM events WHERE world_id = ? AND world_version > ? ORDER BY rowid", (world_id, after_version)).fetchall()
            return [Event.from_dict(json.loads(row["payload_json"])) for row in rows]

    def events_after_cursor(self, world_id: str, after_event_id: Optional[str] = None) -> List[Event]:
        """Read committed events after an opaque event cursor.

        Cursors are event ids rather than client supplied world versions.  The
        version remains part of each event for conflict checks, while the
        cursor lets SSE reconnect safely when one world version contains more
        than one event.
        """
        with self._lock:
            if not after_event_id:
                rows = self._connection.execute("SELECT payload_json FROM events WHERE world_id = ? ORDER BY rowid", (world_id,)).fetchall()
            else:
                cursor = self._connection.execute("SELECT rowid FROM events WHERE world_id = ? AND event_id = ?", (world_id, after_event_id)).fetchone()
                if cursor is None:
                    rows = self._connection.execute("SELECT payload_json FROM events WHERE world_id = ? ORDER BY rowid", (world_id,)).fetchall()
                else:
                    rows = self._connection.execute("SELECT payload_json FROM events WHERE world_id = ? AND rowid > ? ORDER BY rowid", (world_id, cursor["rowid"])).fetchall()
            return [Event.from_dict(json.loads(row["payload_json"])) for row in rows]

    def save_audit(self, world_id: str, world_version: int, event_type: str, payload: Dict[str, Any]) -> int:
        """Persist a redacted audit; identical observer reports share one id.

        The database constraint makes report retries safe across intervening
        reports, independent connections and process restarts. Other audit
        types remain append-only even if their payload includes reportHash.
        """
        report_hash = payload.get("reportHash") if event_type == "world_observer_report" else None
        if not isinstance(report_hash, str) or not report_hash:
            report_hash = None
        with self._lock, self._connection:
            result = self._connection.execute(
                "INSERT INTO audit_events(world_id, world_version, event_type, payload_json, report_hash) VALUES (?, ?, ?, ?, ?) "
                "ON CONFLICT(world_id, report_hash) WHERE event_type = 'world_observer_report' AND report_hash IS NOT NULL DO NOTHING",
                (world_id, int(world_version), event_type, json.dumps(payload, ensure_ascii=False, sort_keys=True), report_hash),
            )
            if result.rowcount == 0:
                row = self._connection.execute(
                    "SELECT audit_id FROM audit_events WHERE world_id = ? AND event_type = ? AND report_hash = ?",
                    (world_id, "world_observer_report", report_hash),
                ).fetchone()
                return int(row["audit_id"])
            return int(result.lastrowid)

    def audits(self, world_id: str, after_id: int = 0) -> List[Dict[str, Any]]:
        with self._lock:
            rows = self._connection.execute(
                "SELECT audit_id, world_version, event_type, payload_json FROM audit_events WHERE world_id = ? AND audit_id > ? ORDER BY audit_id",
                (world_id, int(after_id)),
            ).fetchall()
            return [
                {
                    "auditId": int(row["audit_id"]),
                    "worldVersion": int(row["world_version"]),
                    "eventType": row["event_type"],
                    "payload": json.loads(row["payload_json"]),
                }
                for row in rows
            ]

    def close(self) -> None:
        with self._lock:
            self._connection.close()
