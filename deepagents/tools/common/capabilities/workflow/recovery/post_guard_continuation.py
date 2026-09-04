"""Durable post-Interview-guard continuation state.

The Interview API is authoritative for guarded Customer context. This worker-side store
only records whether the downstream continuation for an already-accepted guard decision
is PENDING or COMPLETED, plus opaque continuation metadata needed for exact retry. It
contains no raw Customer answer or confirmed business-context values.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from threading import Lock
from typing import Any

import psycopg

from tools.common.capabilities.platform.graph_runtime import checkpoint_database_url

_TABLE = "lcsp_interview_post_guard_continuation"
_PENDING = "PENDING"
_COMPLETED = "COMPLETED"


@dataclass(frozen=True)
class PostGuardContinuationRecord:
    assessment_id: str
    context_revision: int
    outcome: str
    status: str
    payload: dict[str, Any]

    @property
    def completed(self) -> bool:
        return self.status == _COMPLETED


class PostGuardContinuationStore:
    """Persist retry state beside durable LangGraph checkpoints."""

    def __init__(self, database_url: str) -> None:
        self._database_url = database_url
        self._setup_done = False
        self._lock = Lock()

    @classmethod
    def from_config(cls, config: Any) -> "PostGuardContinuationStore | EphemeralPostGuardContinuationStore":
        database_url = checkpoint_database_url(
            getattr(config, "langgraph_checkpoint_database_url", None)
        )
        if not database_url:
            # Unit tests and deliberately checkpoint-free local harnesses use the same
            # state-machine semantics without pretending this is production durability.
            return EphemeralPostGuardContinuationStore()
        return cls(database_url)

    def get(
        self,
        *,
        assessment_id: str,
        context_revision: int,
        outcome: str,
    ) -> PostGuardContinuationRecord | None:
        self._setup()
        with psycopg.connect(self._database_url) as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    f"SELECT status, payload_json FROM {_TABLE} "
                    "WHERE assessment_id = %s AND context_revision = %s AND outcome = %s",
                    (assessment_id, context_revision, outcome),
                )
                row = cursor.fetchone()
        if row is None:
            return None
        status, payload_json = row
        return PostGuardContinuationRecord(
            assessment_id=assessment_id,
            context_revision=context_revision,
            outcome=outcome,
            status=str(status),
            payload=_payload(payload_json),
        )

    def begin(
        self,
        *,
        assessment_id: str,
        context_revision: int,
        outcome: str,
        payload: dict[str, Any] | None = None,
    ) -> PostGuardContinuationRecord:
        self._setup()
        serialized = json.dumps(payload or {}, sort_keys=True, separators=(",", ":"))
        with psycopg.connect(self._database_url) as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    f"INSERT INTO {_TABLE} "
                    "(assessment_id, context_revision, outcome, status, payload_json) "
                    "VALUES (%s, %s, %s, %s, %s) "
                    "ON CONFLICT (assessment_id, context_revision, outcome) DO UPDATE SET "
                    "payload_json = CASE "
                    f"WHEN {_TABLE}.status = '{_COMPLETED}' THEN {_TABLE}.payload_json "
                    "ELSE EXCLUDED.payload_json END, "
                    "updated_at = NOW()",
                    (
                        assessment_id,
                        context_revision,
                        outcome,
                        _PENDING,
                        serialized,
                    ),
                )
            connection.commit()
        record = self.get(
            assessment_id=assessment_id,
            context_revision=context_revision,
            outcome=outcome,
        )
        if record is None:
            raise RuntimeError("post-guard continuation was not durably persisted")
        return record

    def complete(
        self,
        *,
        assessment_id: str,
        context_revision: int,
        outcome: str,
    ) -> None:
        self._setup()
        with psycopg.connect(self._database_url) as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    f"UPDATE {_TABLE} SET status = %s, updated_at = NOW() "
                    "WHERE assessment_id = %s AND context_revision = %s AND outcome = %s",
                    (_COMPLETED, assessment_id, context_revision, outcome),
                )
                if cursor.rowcount != 1:
                    raise RuntimeError(
                        "post-guard continuation completion requires an existing pending record"
                    )
            connection.commit()

    def _setup(self) -> None:
        if self._setup_done:
            return
        with self._lock:
            if self._setup_done:
                return
            with psycopg.connect(self._database_url) as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        f"""
                        CREATE TABLE IF NOT EXISTS {_TABLE} (
                            assessment_id TEXT NOT NULL,
                            context_revision BIGINT NOT NULL,
                            outcome TEXT NOT NULL,
                            status TEXT NOT NULL,
                            payload_json TEXT NOT NULL,
                            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                            PRIMARY KEY (assessment_id, context_revision, outcome),
                            CHECK (status IN ('{_PENDING}', '{_COMPLETED}'))
                        )
                        """
                    )
                connection.commit()
            self._setup_done = True


class EphemeralPostGuardContinuationStore:
    """Checkpoint-free test implementation with identical pending/completed semantics."""

    def __init__(self) -> None:
        self._records: dict[tuple[str, int, str], PostGuardContinuationRecord] = {}

    def get(self, *, assessment_id: str, context_revision: int, outcome: str):
        return self._records.get((assessment_id, context_revision, outcome))

    def begin(
        self,
        *,
        assessment_id: str,
        context_revision: int,
        outcome: str,
        payload: dict[str, Any] | None = None,
    ) -> PostGuardContinuationRecord:
        key = (assessment_id, context_revision, outcome)
        current = self._records.get(key)
        if current is not None and current.completed:
            return current
        record = PostGuardContinuationRecord(
            assessment_id=assessment_id,
            context_revision=context_revision,
            outcome=outcome,
            status=_PENDING,
            payload=dict(payload or {}),
        )
        self._records[key] = record
        return record

    def complete(self, *, assessment_id: str, context_revision: int, outcome: str) -> None:
        key = (assessment_id, context_revision, outcome)
        current = self._records.get(key)
        if current is None:
            raise RuntimeError(
                "post-guard continuation completion requires an existing pending record"
            )
        self._records[key] = PostGuardContinuationRecord(
            assessment_id=assessment_id,
            context_revision=context_revision,
            outcome=outcome,
            status=_COMPLETED,
            payload=dict(current.payload),
        )


def _payload(value: Any) -> dict[str, Any]:
    if isinstance(value, dict):
        return dict(value)
    if not isinstance(value, str) or not value:
        return {}
    decoded = json.loads(value)
    return dict(decoded) if isinstance(decoded, dict) else {}


__all__ = [
    "EphemeralPostGuardContinuationStore",
    "PostGuardContinuationRecord",
    "PostGuardContinuationStore",
]
