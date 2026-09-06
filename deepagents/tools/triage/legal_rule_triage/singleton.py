"""Global singleton coordination for the shared Legal Rule Triage agent.

At most one Legal Rule Triage execution may be RUNNING at any time. Scheduled and
readiness-triggered callers share the same long-lived logical agent. If a request
arrives while triage is already active, the request is not queued, merged, or persisted
for later; it receives ALREADY_RUNNING and may re-check readiness after the active
execution ends.
"""

from __future__ import annotations

import json
import os
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from threading import RLock
from time import sleep
from typing import Any, Iterator, TextIO
from uuid import uuid4

from tools.common.capabilities.platform.config import default_legal_source_storage_root
from tools.common.capabilities.platform.file_lock import (
    acquire_exclusive_lock,
    ensure_lock_file,
    release_file_lock,
)


TRIAGE_RUNTIME_DIR = "triage-runtime"
TRIAGE_EXECUTION_LOCK_FILE = "singleton.lock"
TRIAGE_STATE_LOCK_FILE = "state.lock"
TRIAGE_ACTIVE_FILE = "active.json"
_LOCAL_GUARD = RLock()
_ACTIVE_LEASES: dict[str, TextIO] = {}


@dataclass(frozen=True)
class TriageLeaseResult:
    """Bounded singleton state returned to orchestration/tool boundaries."""

    status: str
    execution_id: str | None
    affected_rule_ids: tuple[str, ...]
    full_backlog: bool
    include_completed: bool

    def to_dict(self) -> dict[str, Any]:
        return {
            "status": self.status,
            "triageExecutionId": self.execution_id,
            "affectedLegalRuleIds": list(self.affected_rule_ids),
            "fullBacklog": self.full_backlog,
            "includeCompleted": self.include_completed,
        }


class TriageSingletonCoordinator:
    """Guarantee one active Legal Rule Triage execution per shared runtime store."""

    def __init__(self, *, storage_root: Path | None = None) -> None:
        root = storage_root
        if root is None:
            configured = os.getenv("LEGAL_SOURCE_STORAGE_ROOT")
            root = (
                Path(configured)
                if configured
                else Path(default_legal_source_storage_root())
            )
        self.runtime_root = root.resolve() / TRIAGE_RUNTIME_DIR
        self.execution_lock_path = self.runtime_root / TRIAGE_EXECUTION_LOCK_FILE
        self.state_lock_path = self.runtime_root / TRIAGE_STATE_LOCK_FILE
        self.active_path = self.runtime_root / TRIAGE_ACTIVE_FILE

    def claim_or_observe(
        self,
        *,
        affected_rule_ids: list[str] | None,
        idempotency_key: str | None,
        trigger: str,
        include_completed: bool = False,
        execution_id: str | None = None,
    ) -> TriageLeaseResult:
        """Claim the singleton, or observe the existing RUNNING owner without enqueueing."""
        self._ensure_runtime_dir()
        if execution_id:
            self.assert_owner(execution_id)
            with self._locked_state():
                state = self._read_active_state_unlocked()
                self._assert_execution_state(state, execution_id)
                return self._lease_result("OWNER", state)

        lease_file = self.execution_lock_path.open("a+", encoding="utf-8")
        try:
            acquire_exclusive_lock(lease_file, non_blocking=True)
        except BlockingIOError:
            lease_file.close()
            return self._observe_running()

        new_execution_id = f"triage:{uuid4()}"
        with _LOCAL_GUARD:
            _ACTIVE_LEASES[new_execution_id] = lease_file
        try:
            with self._locked_state():
                normalized_ids = sorted(
                    dict.fromkeys(
                        str(value)
                        for value in (affected_rule_ids or [])
                        if str(value).strip()
                    )
                )
                now = _now()
                state = {
                    "executionId": new_execution_id,
                    "status": "RUNNING",
                    "trigger": str(trigger or "LEGAL_MAINTENANCE"),
                    "idempotencyKey": str(idempotency_key or "") or None,
                    "affectedLegalRuleIds": normalized_ids,
                    "fullBacklog": not normalized_ids,
                    "includeCompleted": bool(include_completed),
                    "activeBatchLegalRuleIds": [],
                    "completedLegalRuleIds": [],
                    "startedAt": now,
                    "updatedAt": now,
                }
                self._write_active_state_unlocked(state)
                return self._lease_result("OWNER", state)
        except Exception:
            self._release_file_lease(new_execution_id)
            raise

    def submit_or_continue(
        self,
        *,
        affected_rule_ids: list[str] | None,
        idempotency_key: str | None,
        trigger: str,
        include_completed: bool = False,
        execution_id: str | None = None,
    ) -> TriageLeaseResult:
        """Compatibility name for claim-or-observe; there is no pending scope to drain."""
        return self.claim_or_observe(
            affected_rule_ids=affected_rule_ids,
            idempotency_key=idempotency_key,
            trigger=trigger,
            include_completed=include_completed,
            execution_id=execution_id,
        )

    def assert_owner(self, execution_id: str) -> None:
        """Fail before protected work when caller is not the singleton owner."""
        self._assert_local_owner(execution_id)
        with self._locked_state():
            state = self._read_active_state_unlocked()
            self._assert_execution_state(state, execution_id)

    def set_batch_work(self, *, execution_id: str, legal_rule_ids: list[str]) -> None:
        """Record exact ready LegalRules assigned to the active owner batch."""
        self.assert_owner(execution_id)
        with self._locked_state():
            state = self._read_active_state_unlocked()
            self._assert_execution_state(state, execution_id)
            state["activeBatchLegalRuleIds"] = sorted(
                dict.fromkeys(
                    str(value) for value in legal_rule_ids if str(value).strip()
                )
            )
            self._write_active_state_unlocked(state)

    def mark_rule_completed(self, *, execution_id: str, legal_rule_id: str) -> None:
        """Remove one successfully persisted LegalRule from the owner batch."""
        self.assert_owner(execution_id)
        with self._locked_state():
            state = self._read_active_state_unlocked()
            self._assert_execution_state(state, execution_id)
            state["activeBatchLegalRuleIds"] = [
                value
                for value in (state.get("activeBatchLegalRuleIds") or [])
                if str(value) != str(legal_rule_id)
            ]
            completed = list(state.get("completedLegalRuleIds") or [])
            completed.append(str(legal_rule_id))
            state["completedLegalRuleIds"] = sorted(dict.fromkeys(completed))
            self._write_active_state_unlocked(state)

    def finish_or_drain(self, *, execution_id: str) -> TriageLeaseResult:
        """Release the singleton after its active batch; no queued scope exists."""
        self.assert_owner(execution_id)
        with self._locked_state():
            state = self._read_active_state_unlocked()
            self._assert_execution_state(state, execution_id)
            remaining = [
                str(value) for value in (state.get("activeBatchLegalRuleIds") or [])
            ]
            if remaining:
                raise RuntimeError(
                    "triage execution cannot finish while LegalRule work remains: "
                    + ",".join(remaining)
                )
            result = self._lease_result("COMPLETE", state)
            self.active_path.unlink(missing_ok=True)
        self._release_file_lease(execution_id)
        return result

    def abandon_execution(self, *, execution_id: str) -> None:
        """Release a failed owner without manufacturing a retry queue."""
        with _LOCAL_GUARD:
            owns_local_lease = execution_id in _ACTIVE_LEASES
        if not owns_local_lease:
            return
        with self._locked_state():
            state = self._read_active_state_unlocked()
            if state.get("executionId") == execution_id:
                self.active_path.unlink(missing_ok=True)
        self._release_file_lease(execution_id)

    def active_status(self) -> dict[str, Any]:
        """Return privacy-safe singleton state for observability/tests."""
        self._ensure_runtime_dir()
        with self._locked_state():
            state = self._read_active_state_unlocked()
        return {
            "active": bool(state.get("executionId")) and state.get("status") == "RUNNING",
            "status": state.get("status") or "IDLE",
            "triageExecutionId": state.get("executionId"),
            "trigger": state.get("trigger"),
            "activeBatchLegalRuleIds": list(state.get("activeBatchLegalRuleIds") or []),
        }

    def _observe_running(self) -> TriageLeaseResult:
        for _attempt in range(50):
            with self._locked_state():
                state = self._read_active_state_unlocked()
                if state.get("executionId") and state.get("status") == "RUNNING":
                    return TriageLeaseResult(
                        status="ALREADY_RUNNING",
                        execution_id=str(state["executionId"]),
                        affected_rule_ids=(),
                        full_backlog=False,
                        include_completed=False,
                    )
            sleep(0.01)
        return TriageLeaseResult(
            status="ALREADY_RUNNING",
            execution_id=None,
            affected_rule_ids=(),
            full_backlog=False,
            include_completed=False,
        )

    @staticmethod
    def _lease_result(status: str, state: dict[str, Any]) -> TriageLeaseResult:
        return TriageLeaseResult(
            status=status,
            execution_id=str(state.get("executionId") or "") or None,
            affected_rule_ids=tuple(
                str(value) for value in (state.get("affectedLegalRuleIds") or [])
            ),
            full_backlog=bool(state.get("fullBacklog")),
            include_completed=bool(state.get("includeCompleted")),
        )

    def _write_active_state_unlocked(self, state: dict[str, Any]) -> None:
        state = {**state, "updatedAt": _now()}
        temporary = self.active_path.with_suffix(f".{os.getpid()}.tmp")
        temporary.write_text(
            json.dumps(state, ensure_ascii=False, sort_keys=True, indent=2) + "\n",
            encoding="utf-8",
        )
        temporary.replace(self.active_path)

    def _read_active_state_unlocked(self) -> dict[str, Any]:
        if not self.active_path.is_file():
            return {}
        try:
            value = json.loads(self.active_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return {}
        return value if isinstance(value, dict) else {}

    @contextmanager
    def _locked_state(self) -> Iterator[None]:
        self._ensure_runtime_dir()
        state_file = self.state_lock_path.open("a+", encoding="utf-8")
        try:
            acquire_exclusive_lock(state_file)
            yield
        finally:
            try:
                release_file_lock(state_file)
            finally:
                state_file.close()

    def _release_file_lease(self, execution_id: str) -> None:
        with _LOCAL_GUARD:
            lease_file = _ACTIVE_LEASES.pop(execution_id, None)
        if lease_file is not None:
            try:
                release_file_lock(lease_file)
            finally:
                lease_file.close()

    def _assert_local_owner(self, execution_id: str) -> None:
        with _LOCAL_GUARD:
            if execution_id not in _ACTIVE_LEASES:
                raise RuntimeError("triage execution does not own the process lease")

    @staticmethod
    def _assert_execution_state(state: dict[str, Any], execution_id: str) -> None:
        if state.get("executionId") != execution_id or state.get("status") != "RUNNING":
            raise RuntimeError("triage execution does not match the active singleton lease")

    def _ensure_runtime_dir(self) -> None:
        self.runtime_root.mkdir(parents=True, exist_ok=True)
        ensure_lock_file(self.execution_lock_path)
        ensure_lock_file(self.state_lock_path)


def _now() -> str:
    return datetime.now(UTC).isoformat()
