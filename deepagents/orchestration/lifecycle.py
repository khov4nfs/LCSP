"""Root orchestration lifecycle hooks for LCSP specialist dispatch.

The root supervisor owns workflow transitions for every specialist. Agent-specific
constraints remain small policies beneath that root lifecycle; Legal Rule Triage uses
``TriageSingletonCoordinator`` only to enforce its global single-owner invariant.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from tools.common.capabilities.platform.logging import get_logger
from tools.triage.legal_rule_triage.singleton import TriageSingletonCoordinator

from .waiting_assessments import WaitingAssessmentRegistry


logger = get_logger(__name__)


@dataclass(frozen=True)
class RootSubagentReservation:
    """Root-owned dispatch state for one specialist invocation."""

    subagent_type: str
    status: str
    execution_id: str | None = None
    trigger: str | None = None


class RootOrchestrationLifecycle:
    """Own specialist begin/fail/complete transitions for the LCSP root supervisor."""

    def __init__(
        self,
        *,
        triage_coordinator: TriageSingletonCoordinator | None = None,
        waiting_registry: WaitingAssessmentRegistry | None = None,
    ) -> None:
        self._triage_coordinator = triage_coordinator or TriageSingletonCoordinator()
        self._waiting_registry = waiting_registry or WaitingAssessmentRegistry()

    def reserve_subagent(
        self,
        *,
        subagent_type: str,
        affected_rule_ids: list[str] | None = None,
        idempotency_key: str | None = None,
        trigger: str | None = None,
    ) -> RootSubagentReservation:
        """Apply root dispatch policy before a specialist is allowed to start."""
        normalized_type = str(subagent_type or "").strip()
        if normalized_type != "triage":
            return RootSubagentReservation(
                subagent_type=normalized_type,
                status="READY",
            )

        reservation = self._triage_coordinator.claim_or_observe(
            affected_rule_ids=list(affected_rule_ids or []),
            idempotency_key=idempotency_key,
            trigger=str(trigger or "SCHEDULED"),
        )
        return RootSubagentReservation(
            subagent_type="triage",
            status=reservation.status,
            execution_id=reservation.execution_id,
            trigger=str(trigger or "SCHEDULED"),
        )

    @staticmethod
    def owner_instruction(reservation: RootSubagentReservation) -> str:
        """Return root-owned execution instructions for a claimed specialist."""
        if reservation.subagent_type != "triage":
            return ""
        if reservation.status != "OWNER" or not reservation.execution_id:
            return ""
        return (
            "GLOBAL TRIAGE SINGLETON CLAIMED. "
            f"triageExecutionId={reservation.execution_id}. "
            "You are the only active Triage owner. Your first "
            "get_legal_rule_triage_work_items call MUST pass this exact "
            "triage_execution_id so it reads only the scope already claimed by Root "
            "Orchestration. Process only that claimed batch, then call "
            "finish_legal_rule_triage_execution once all returned work items are "
            "persisted. Concurrent requests return ALREADY_RUNNING; they are never "
            "queued, persisted for later, merged into this scope, or drained by this "
            "execution."
        )

    def fail_subagent(self, reservation: RootSubagentReservation) -> None:
        """Release specialist-specific runtime ownership after a failed dispatch."""
        if (
            reservation.subagent_type == "triage"
            and reservation.status == "OWNER"
            and reservation.execution_id
        ):
            self._triage_coordinator.abandon_execution(
                execution_id=reservation.execution_id
            )

    def complete_subagent(self, reservation: RootSubagentReservation) -> dict[str, Any]:
        """Apply root-owned transitions after a specialist returns successfully."""
        if reservation.subagent_type != "triage":
            return {
                "status": "COMPLETE",
                "subagentType": reservation.subagent_type,
            }
        if reservation.status != "OWNER" or not reservation.execution_id:
            return {
                "status": reservation.status,
                "subagentType": "triage",
                "triageExecutionId": reservation.execution_id,
            }

        active = self._triage_coordinator.active_status()
        if (
            active.get("active")
            and active.get("triageExecutionId") == reservation.execution_id
        ):
            self._triage_coordinator.abandon_execution(
                execution_id=reservation.execution_id
            )
            raise RuntimeError(
                "Triage agent returned before finish_legal_rule_triage_execution"
            )

        # Triage's finish tool only releases its own singleton. Workflow transitions
        # remain owned here by Root Orchestration, which can now safely re-enter every
        # Assessment waiting on EngineeringRule readiness.
        reconciliation = self._waiting_registry.reconcile_all()
        result = {
            "status": "COMPLETE",
            "subagentType": "triage",
            "triageExecutionId": reservation.execution_id,
            "assessmentReconciliation": reconciliation,
        }
        logger.info(
            "ROOT_ORCHESTRATION_TRIAGE_COMPLETED",
            triage_execution_id=reservation.execution_id,
            **reconciliation,
        )
        return result
