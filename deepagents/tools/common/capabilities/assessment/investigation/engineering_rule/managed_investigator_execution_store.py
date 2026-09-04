"""Durable registry for managed Investigator execution identity and immutable pins."""

from __future__ import annotations

import json
from dataclasses import dataclass
from threading import Lock
from typing import Any

import psycopg

_TABLE = "lcsp_managed_investigator_execution"
_WAITING = "WAITING"
_READY = "READY"


@dataclass(frozen=True)
class ManagedInvestigatorExecutionRecord:
    execution_id: str
    assessment_id: str
    thread_id: str
    checkpoint_id: str
    affected_rule_ids: tuple[str, ...]
    artifact_versions: dict[str, str]
    status: str


class ManagedInvestigatorExecutionStore:
    """Persist trusted execution pins independently of LangGraph checkpoint metadata."""

    def __init__(self, database_url: str) -> None:
        if not database_url:
            raise ValueError("managed Investigator execution store requires database_url")
        self._database_url = database_url
        self._setup_done = False
        self._lock = Lock()

    def get(self, execution_id: str) -> ManagedInvestigatorExecutionRecord | None:
        self._setup()
        with psycopg.connect(self._database_url) as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    f"SELECT assessment_id, thread_id, checkpoint_id, "
                    f"affected_rule_ids_json, artifact_versions_json, status FROM {_TABLE} "
                    "WHERE execution_id = %s",
                    (execution_id,),
                )
                row = cursor.fetchone()
        if row is None:
            return None
        (
            assessment_id,
            thread_id,
            checkpoint_id,
            affected_rule_ids_json,
            artifact_versions_json,
            status,
        ) = row
        return ManagedInvestigatorExecutionRecord(
            execution_id=execution_id,
            assessment_id=str(assessment_id),
            thread_id=str(thread_id),
            checkpoint_id=str(checkpoint_id),
            affected_rule_ids=_string_tuple(_decode_json(affected_rule_ids_json)),
            artifact_versions=_string_map(_decode_json(artifact_versions_json)),
            status=str(status),
        )

    def save(
        self,
        *,
        execution_id: str,
        assessment_id: str,
        thread_id: str,
        checkpoint_id: str,
        affected_rule_ids: tuple[str, ...],
        artifact_versions: dict[str, str],
        status: str,
    ) -> ManagedInvestigatorExecutionRecord:
        if status not in {_WAITING, _READY}:
            raise ValueError(f"unsupported managed Investigator execution status: {status}")
        if not execution_id or not assessment_id or not thread_id or not checkpoint_id:
            raise ValueError("managed Investigator execution identity is incomplete")
        if not affected_rule_ids:
            raise ValueError("managed Investigator execution requires affected rule pins")
        if not artifact_versions:
            raise ValueError("managed Investigator execution requires artifact pins")
        self._setup()
        rules_json = json.dumps(list(affected_rule_ids), separators=(",", ":"))
        artifacts_json = json.dumps(
            artifact_versions,
            sort_keys=True,
            separators=(",", ":"),
        )
        with psycopg.connect(self._database_url) as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    f"INSERT INTO {_TABLE} "
                    "(execution_id, assessment_id, thread_id, checkpoint_id, "
                    "affected_rule_ids_json, artifact_versions_json, status) "
                    "VALUES (%s, %s, %s, %s, %s, %s, %s) "
                    "ON CONFLICT (execution_id) DO UPDATE SET "
                    "checkpoint_id = EXCLUDED.checkpoint_id, "
                    "status = EXCLUDED.status, "
                    "updated_at = NOW() "
                    f"WHERE {_TABLE}.assessment_id = EXCLUDED.assessment_id "
                    f"AND {_TABLE}.thread_id = EXCLUDED.thread_id "
                    f"AND {_TABLE}.affected_rule_ids_json = EXCLUDED.affected_rule_ids_json "
                    f"AND {_TABLE}.artifact_versions_json = EXCLUDED.artifact_versions_json",
                    (
                        execution_id,
                        assessment_id,
                        thread_id,
                        checkpoint_id,
                        rules_json,
                        artifacts_json,
                        status,
                    ),
                )
                if cursor.rowcount != 1:
                    raise RuntimeError(
                        "managed Investigator execution registry rejected identity/pin drift"
                    )
            connection.commit()
        record = self.get(execution_id)
        if record is None:
            raise RuntimeError("managed Investigator execution was not durably persisted")
        return record

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
                            execution_id TEXT PRIMARY KEY,
                            assessment_id TEXT NOT NULL,
                            thread_id TEXT NOT NULL,
                            checkpoint_id TEXT NOT NULL,
                            affected_rule_ids_json TEXT NOT NULL,
                            artifact_versions_json TEXT NOT NULL,
                            status TEXT NOT NULL,
                            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                            CHECK (status IN ('{_WAITING}', '{_READY}'))
                        )
                        """
                    )
                connection.commit()
            self._setup_done = True


def _decode_json(value: Any) -> Any:
    if isinstance(value, str):
        return json.loads(value)
    return value


def _string_map(value: Any) -> dict[str, str]:
    if not isinstance(value, dict):
        return {}
    return {
        key: item
        for key, item in value.items()
        if isinstance(key, str) and isinstance(item, str) and item
    }


def _string_tuple(value: Any) -> tuple[str, ...]:
    if not isinstance(value, list):
        return ()
    return tuple(
        dict.fromkeys(item for item in value if isinstance(item, str) and item)
    )


__all__ = [
    "ManagedInvestigatorExecutionRecord",
    "ManagedInvestigatorExecutionStore",
]
