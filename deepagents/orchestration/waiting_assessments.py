"""Root-owned checkpoints for Assessments waiting on EngineeringRules.

The registry belongs to Root Orchestration, not to the Legal Rule Triage specialist.
It intentionally stores only the accepted evidence/workflow checkpoint required to
re-enter the Assessment readiness gate. Triage never reads these records and incoming
LegalRule scope is never queued, merged, or persisted here.
"""

from __future__ import annotations

import fcntl
import hashlib
import json
import os
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Callable, Iterator
from uuid import uuid4

from tools.common.capabilities.platform.config import default_legal_source_storage_root
from tools.common.capabilities.platform.logging import get_logger
from tools.triage.legal_rule_triage.singleton import TRIAGE_RUNTIME_DIR


logger = get_logger(__name__)
WAITING_ASSESSMENTS_FILE = "waiting-assessments.json"
WAITING_ASSESSMENTS_LOCK_FILE = "waiting-assessments.lock"


class WaitingAssessmentRegistry:
    """Store and reconcile Assessment checkpoints under Root Orchestration ownership."""

    def __init__(self, *, storage_root: Path | None = None) -> None:
        root = storage_root
        if root is None:
            configured = os.getenv("LEGAL_SOURCE_STORAGE_ROOT")
            root = (
                Path(configured)
                if configured
                else Path(default_legal_source_storage_root())
            )
        # Keep the on-disk location stable across this ownership refactor so a deploy
        # cannot orphan checkpoints written by the previous implementation. The file
        # is now read/written only by Root Orchestration code.
        self.runtime_root = root.resolve() / TRIAGE_RUNTIME_DIR
        self.state_path = self.runtime_root / WAITING_ASSESSMENTS_FILE
        self.lock_path = self.runtime_root / WAITING_ASSESSMENTS_LOCK_FILE

    def register(
        self,
        *,
        evidence_report_id: str,
        workflow_run_id: str,
        source_correlation_id: str,
    ) -> str:
        """Upsert one privacy-safe resume checkpoint for a WAITING Assessment."""
        evidence_report_id = str(evidence_report_id or "").strip()
        if not evidence_report_id:
            raise ValueError("waiting Assessment checkpoint requires evidence_report_id")
        workflow_run_id = str(workflow_run_id or evidence_report_id).strip()
        source_correlation_id = str(source_correlation_id or "").strip()
        checkpoint_id = self._checkpoint_id(evidence_report_id, workflow_run_id)
        now = _now()

        with self._locked_state():
            state = self._read_state_unlocked()
            existing = state.get(checkpoint_id)
            registered_at = (
                str(existing.get("registeredAt"))
                if isinstance(existing, dict) and existing.get("registeredAt")
                else now
            )
            state[checkpoint_id] = {
                "checkpointId": checkpoint_id,
                "evidenceReportId": evidence_report_id,
                "workflowRunId": workflow_run_id,
                "sourceCorrelationId": source_correlation_id,
                "registeredAt": registered_at,
                "updatedAt": now,
            }
            self._write_state_unlocked(state)
        return checkpoint_id

    def pending(self) -> list[dict[str, str]]:
        """Return the currently registered root-orchestration checkpoints."""
        with self._locked_state():
            state = self._read_state_unlocked()
        return self._ordered_checkpoints(state)

    def take_all(self) -> list[dict[str, str]]:
        """Atomically detach the current checkpoint snapshot for reconciliation."""
        with self._locked_state():
            state = self._read_state_unlocked()
            checkpoints = self._ordered_checkpoints(state)
            self.state_path.unlink(missing_ok=True)
        return checkpoints

    def reconcile_all(
        self,
        *,
        invoker: Callable[[str, dict[str, Any], str], dict[str, Any]] | None = None,
        correlation_id_factory: Callable[[], str] | None = None,
    ) -> dict[str, Any]:
        """Re-enter every waiting Assessment from its accepted-evidence checkpoint.

        Root Orchestration calls this only after the active Triage specialist has
        returned and its singleton is already IDLE. Failures are re-registered instead
        of aborting the completed specialist transition. A fresh correlation ID is used
        so the readiness re-check is a new Assessment run rather than an idempotent
        redelivery of the prior WAITING classification.
        """
        checkpoints = self.take_all()
        if invoker is None:
            from tools.common.capabilities.managed.invocation import invoke_boundary

            invoker = invoke_boundary
        correlation_id_factory = correlation_id_factory or (
            lambda: f"engineering-rule-resume:{uuid4().hex}"
        )

        resumed = 0
        deferred = 0
        for checkpoint in checkpoints:
            try:
                invoker(
                    "engineering_assessment_requested",
                    {
                        "evidenceReportId": checkpoint["evidenceReportId"],
                        "workflowRunId": checkpoint["workflowRunId"],
                    },
                    correlation_id_factory(),
                )
                resumed += 1
            except Exception as error:
                deferred += 1
                self.register(
                    evidence_report_id=checkpoint["evidenceReportId"],
                    workflow_run_id=checkpoint["workflowRunId"],
                    source_correlation_id=checkpoint.get("sourceCorrelationId", ""),
                )
                logger.warning(
                    "WAITING_ENGINEERING_ASSESSMENT_RECONCILIATION_DEFERRED",
                    error_type=type(error).__name__,
                )

        result = {
            "status": "COMPLETE",
            "eligibleAssessmentCount": len(checkpoints),
            "resumedAssessmentCount": resumed,
            "deferredAssessmentCount": deferred,
        }
        logger.info("WAITING_ENGINEERING_ASSESSMENTS_RECONCILED", **result)
        return result

    @staticmethod
    def _checkpoint_id(evidence_report_id: str, workflow_run_id: str) -> str:
        raw = f"{evidence_report_id}\0{workflow_run_id}".encode("utf-8")
        return "engineering-rule-wait:" + hashlib.sha256(raw).hexdigest()

    @staticmethod
    def _ordered_checkpoints(state: dict[str, Any]) -> list[dict[str, str]]:
        checkpoints = [
            {str(key): str(value) for key, value in item.items() if value is not None}
            for item in state.values()
            if isinstance(item, dict)
        ]
        checkpoints.sort(
            key=lambda item: (
                item.get("registeredAt", ""),
                item.get("checkpointId", ""),
            )
        )
        return checkpoints

    def _read_state_unlocked(self) -> dict[str, Any]:
        if not self.state_path.is_file():
            return {}
        try:
            value = json.loads(self.state_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return {}
        return value if isinstance(value, dict) else {}

    def _write_state_unlocked(self, state: dict[str, Any]) -> None:
        temporary = self.state_path.with_suffix(f".{os.getpid()}.tmp")
        temporary.write_text(
            json.dumps(state, ensure_ascii=False, sort_keys=True, indent=2) + "\n",
            encoding="utf-8",
        )
        temporary.replace(self.state_path)

    @contextmanager
    def _locked_state(self) -> Iterator[None]:
        self.runtime_root.mkdir(parents=True, exist_ok=True)
        self.lock_path.touch(exist_ok=True)
        lock_file = self.lock_path.open("a+", encoding="utf-8")
        try:
            fcntl.flock(lock_file.fileno(), fcntl.LOCK_EX)
            yield
        finally:
            try:
                fcntl.flock(lock_file.fileno(), fcntl.LOCK_UN)
            finally:
                lock_file.close()


def _now() -> str:
    return datetime.now(UTC).isoformat()
