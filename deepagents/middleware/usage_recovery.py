"""Durable, callback-only recovery for usage-telemetry delivery.

The provider is never replayed from this store. Rows contain only the usage
contract payload (numeric usage and identities), never prompts or model output.

There is no reservation or release row: assessment execution never reserves or
debits credits, so the only durable side effect left to retry is provider
reported usage telemetry.
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
    """Stable per-invocation key; usage is idempotent on the API side."""
    return f"usage:{payload.assessmentId}:{payload.runId}:{payload.invocationId}"


def enqueue_usage(path: str | Path, payload: SettledUsagePayload) -> None:
    _enqueue(
        path,
        "USAGE",
        usage_recovery_key(payload),
        payload.model_dump(mode="json"),
    )


def drain(path: str | Path, api_client: Any) -> int:
    """Deliver pending callbacks in order; return the number removed.

    Transient failures remain pending. Permanent contract failures are retained
    as POISON for reconciliation, never replayed as provider work.
    """
    db = _connect(path)
    delivered = 0
    try:
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
    db = _connect(path)
    try:
        pending = db.execute(
            "SELECT COUNT(*) FROM usage_recovery WHERE state = 'PENDING'"
        ).fetchone()[0]
        if pending >= MAX_PENDING_ROWS:
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
    "drain",
    "start_background_worker",
]
