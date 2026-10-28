"""Durable, callback-only recovery for usage-telemetry delivery.

The provider is never replayed from this store. Rows contain usage contract
payloads or invocation evidence (numeric usage and identities), never prompts or
model output. RECORDED evidence is retained and never drained as a callback.

Evaluation admission uses separate immutable run/attempt tables in this same
journal. They never drain as callbacks or debit customer credits. Historical
usage-only journals remain readable without retroactive reservations.
"""

from __future__ import annotations

import json
import logging
import sqlite3
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from tools.common.capabilities.platform.callback_schemas import (
    SettledUsagePayload,
)

_workers: set[str] = set()
_workers_lock = threading.Lock()
_logger = logging.getLogger(__name__)
# Contract rejections never heal by retrying the identical payload.
_PERMANENT_STATUSES = frozenset({400, 403, 404, 409, 422})
# Bounds the store while the API is down; telemetry must not fill the disk.
MAX_PENDING_ROWS = 1000


def usage_recovery_key(payload: SettledUsagePayload) -> str:
    """Stable per-invocation key; usage is idempotent on the API side.

    Business purpose: Identify a usage callback idempotently within its Assessment or Preparation run and invocation lifecycle.

    Business rules:
    - Include the owner, run and invocation identities; include attemptStatus when present so lifecycle receipts remain distinct.

    Execution flow:
    1. Build the stable usage key from the validated callback payload identities and optional attempt status.

    Failure cases:
    - Required identity shape is owned by SettledUsagePayload; this helper adds no fallback invocation identity.

    Side effects:
    - None: pure key construction without provider replay or accounting mutation.
    """
    return f"usage:{payload.assessmentId or payload.preparationRunId}:{payload.runId}:{payload.invocationId}" + (f":{payload.attemptStatus}" if payload.attemptStatus else "")


def enqueue_usage(path: str | Path, payload: SettledUsagePayload) -> None:
    _enqueue(
        path,
        "USAGE",
        usage_recovery_key(payload),
        payload.model_dump(mode="json"),
    )


def record_usage_evidence(path: str | Path, key: str, payload: dict[str, Any]) -> None:
    """Archive one invocation atomically; never drain it as an assessment callback.

    Business purpose: Durably retain invocation evidence independently of callback delivery.

    Business rules:
    - Evidence rows remain RECORDED and are never drained as provider work; an existing recovery key is not overwritten.

    Execution flow:
    1. Open the journal, require full synchronous durability, insert the evidence idempotently, commit and close the connection.

    Failure cases:
    - SQLite or JSON serialization failures propagate; the connection closes on every path and failed writes are not reported as committed.

    Side effects:
    - Creates/initializes the local journal as needed and commits one immutable-key EVIDENCE row.
    """
    db = _connect(path)
    try:
        db.execute("PRAGMA synchronous=FULL")
        db.execute(
            """INSERT INTO usage_recovery(kind, recovery_key, payload, state)
               VALUES ('EVIDENCE', ?, ?, 'RECORDED')
               ON CONFLICT(recovery_key) DO NOTHING""",
            (key, json.dumps(payload, separators=(",", ":"), sort_keys=True)),
        )
        db.commit()
    finally:
        db.close()


def read_usage_evidence(path: str | Path) -> list[dict[str, Any]]:
    """Read committed evidence without replaying providers or deleting records.

    Business purpose: Read committed invocation evidence for reconciliation without replaying providers or deleting history.

    Business rules:
    - Open the resolved journal in read-only mode and return EVIDENCE rows in insertion order.

    Execution flow:
    1. Connect read-only, decode each retained evidence payload, and close the connection.

    Failure cases:
    - Missing/unreadable journals, SQLite errors or malformed retained JSON propagate rather than inventing evidence.

    Side effects:
    - Read-only local SQLite access; no callbacks, provider requests or journal writes.
    """
    db = sqlite3.connect(f"{Path(path).resolve().as_uri()}?mode=ro", uri=True, timeout=10)
    try:
        return [json.loads(row[0]) for row in db.execute(
            "SELECT payload FROM usage_recovery WHERE kind = 'EVIDENCE' ORDER BY id"
        )]
    finally:
        db.close()


def drain(path: str | Path, api_client: Any) -> int:
    """Deliver pending callbacks in order; return the number removed.

    Transient failures remain pending. Permanent contract failures are retained
    as POISON for reconciliation, never replayed as provider work.

    Business purpose: Recover and deliver durable usage callbacks while retaining invocation evidence and poisoned records.

    Business rules:
    - Reconstruct missing lifecycle callbacks from MODEL_ATTEMPT evidence; never replay model inference.
    - Permanent contract/invalid-payload failures become POISON; transient failures remain pending and do not block unrelated rows.

    Execution flow:
    1. Rebuild missing USAGE callbacks from committed evidence and read pending rows in order.
    2. Normalize and deliver each usage payload, quarantining permanent failures and retaining transient ones.
    3. Mark lifecycle callbacks DELIVERED or delete legacy delivered rows, committing each success and returning the delivered count.

    Failure cases:
    - Invalid JSON/schema rows are quarantined; transient callback failures remain pending; journal/reconstruction errors propagate with connection cleanup.

    Side effects:
    - Sends usage API callbacks, inserts recovered callback rows and updates/deletes delivery rows; retains EVIDENCE and performs no provider work.
    """
    db = _connect(path)
    delivered = 0
    try:
        # Recover a crash between the evidence commit and callback enqueue.
        for (raw,) in db.execute("SELECT payload FROM usage_recovery WHERE kind='EVIDENCE'").fetchall():
            record = json.loads(raw)
            if record.get("event") != "MODEL_ATTEMPT" or not (record.get("assessmentId") or record.get("preparationRunId")):
                continue
            payload = SettledUsagePayload.model_validate({k: v for k, v in record.items() if k != "event"})
            db.execute("INSERT INTO usage_recovery(kind,recovery_key,payload) VALUES ('USAGE',?,?) ON CONFLICT(recovery_key) DO NOTHING",
                (usage_recovery_key(payload), payload.model_dump_json()))
        db.commit()
        rows = db.execute(
            """
            SELECT id, kind, payload
            FROM usage_recovery
            WHERE state = 'PENDING'
            ORDER BY id
            """
        ).fetchall()
        for row_id, kind, raw_payload in rows:
            try:
                payload = json.loads(raw_payload)
                if kind == "USAGE":
                    payload = _normalize_usage_recovery_payload(payload)
                if kind == "USAGE":
                    api_client.post_settled_usage(
                        SettledUsagePayload.model_validate(payload)
                    )
            except (ValueError, TypeError) as error:
                # Corrupt row or payload that no longer satisfies the contract: it can
                # never be delivered, and must not block the rows behind it.
                _dead_letter(db, row_id, f"INVALID_PAYLOAD:{type(error).__name__}")
                _logger.error("Usage callback quarantined id=%s reason=INVALID_PAYLOAD", row_id)
                continue
            except Exception as error:
                reason = _permanent_callback_failure(error)
                if reason is not None:
                    _dead_letter(db, row_id, reason)
                    _logger.error(
                        "Usage callback quarantined id=%s kind=%s reason=%s",
                        row_id, kind, reason,
                    )
                    continue
                # One poisoned callback must not block unrelated users. The
                # row remains pending for retry/quarantine by the API contract.
                continue
            if kind == "USAGE" and payload.get("attemptStatus"):
                db.execute("UPDATE usage_recovery SET state='DELIVERED' WHERE id=?", (row_id,))
            else:
                db.execute("DELETE FROM usage_recovery WHERE id = ?", (row_id,))
            db.commit()
            delivered += 1
    finally:
        db.close()
    return delivered


def start_background_worker(
    path: str | Path, api_client: Any, interval_seconds: float = 30.0
) -> None:
    """Start callback recovery independently of future model traffic."""
    key = str(Path(path).absolute())
    with _workers_lock:
        if key in _workers:
            return
        _workers.add(key)

    def run() -> None:
        while True:
            try:
                drain(path, api_client)
            except Exception:
                pass
            time.sleep(interval_seconds)

    threading.Thread(
        target=run,
        name="usage-recovery",
        daemon=True,
    ).start()


def _enqueue(path: str | Path, kind: str, key: str, payload: dict[str, Any]) -> None:
    """Business purpose: Persist an idempotent callback while preventing telemetry backlog from exhausting disk.

    Business rules:
    - Existing recovery keys are preserved; a full pending queue rejects new lifecycle receipts but logs/drops legacy payloads without attempt status.

    Execution flow:
    1. Open the durable journal, count pending rows, apply the existing capacity policy, then insert/commit the callback and close.

    Failure cases:
    - A new lifecycle callback at capacity raises RuntimeError to stop further model work; SQLite/serialization failures propagate and connections close.

    Side effects:
    - Creates the local journal if needed and commits a pending row, or logs a legacy drop; never invokes a provider.
    """
    db = _connect(path)
    try:
        db.execute("PRAGMA synchronous=FULL")
        pending = db.execute(
            "SELECT COUNT(*) FROM usage_recovery WHERE state = 'PENDING'"
        ).fetchone()[0]
        if pending >= MAX_PENDING_ROWS and payload.get("attemptStatus"):
            if not db.execute("SELECT 1 FROM usage_recovery WHERE recovery_key=?", (key,)).fetchone():
                raise RuntimeError("Durable usage delivery queue is full; stop before further model work")
        elif pending >= MAX_PENDING_ROWS:
            _logger.error("Usage recovery store full; dropping key=%s", key)
            return
        db.execute(
            """
            INSERT INTO usage_recovery(kind, recovery_key, payload)
            VALUES (?, ?, ?)
            ON CONFLICT(recovery_key) DO NOTHING
            """,
            (kind, key, json.dumps(payload, separators=(",", ":"), sort_keys=True)),
        )
        db.commit()
    finally:
        db.close()


def _connect(path: str | Path) -> sqlite3.Connection:
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(target, timeout=10)
    db.execute("PRAGMA journal_mode=WAL")
    db.execute(
        """
        CREATE TABLE IF NOT EXISTS usage_recovery (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            kind TEXT NOT NULL,
            recovery_key TEXT NOT NULL UNIQUE,
            payload TEXT NOT NULL,
            state TEXT NOT NULL DEFAULT 'PENDING',
            dead_letter_reason TEXT,
            dead_lettered_at TEXT
        )
        """
    )
    _ensure_column(db, "state", "TEXT NOT NULL DEFAULT 'PENDING'")
    _ensure_column(db, "dead_letter_reason", "TEXT")
    _ensure_column(db, "dead_lettered_at", "TEXT")
    db.commit()
    return db


def _ensure_column(db: sqlite3.Connection, column: str, definition: str) -> None:
    rows = db.execute("PRAGMA table_info(usage_recovery)").fetchall()
    if any(row[1] == column for row in rows):
        return
    db.execute(
        f"ALTER TABLE usage_recovery ADD COLUMN {column} {definition}"
    )


def _dead_letter(db: sqlite3.Connection, row_id: int, reason: str) -> None:
    db.execute(
        """
        UPDATE usage_recovery
        SET state = 'POISON',
            dead_letter_reason = ?,
            dead_lettered_at = ?
        WHERE id = ?
        """,
        (
            reason,
            datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
            row_id,
        ),
    )
    db.commit()


def _permanent_callback_failure(error: BaseException) -> str | None:
    status_code = getattr(error, "status_code", None)
    code = getattr(error, "error_code", None)
    if status_code in _PERMANENT_STATUSES:
        return f"HTTP_{status_code}" + (f":{code}" if code else "")
    return None


def _normalize_usage_recovery_payload(payload: dict[str, Any]) -> dict[str, Any]:
    """Normalize legacy callback timestamps to the canonical UTC-Z contract."""
    occurred_at = payload.get("occurredAt")
    if not isinstance(occurred_at, str) or not occurred_at.strip():
        return payload
    normalized = occurred_at.strip().replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(normalized)
    except ValueError:
        return payload
    if parsed.tzinfo is None:
        return payload
    canonical = (
        parsed.astimezone(timezone.utc)
        .isoformat()
        .replace("+00:00", "Z")
    )
    if canonical == occurred_at:
        return payload
    return {**payload, "occurredAt": canonical}


__all__ = [
    "usage_recovery_key",
    "enqueue_usage",
    "record_usage_evidence",
    "read_usage_evidence",
    "drain",
    "start_background_worker",
]
