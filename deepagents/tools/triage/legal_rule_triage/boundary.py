"""RabbitMQ adapter for automatic ENGINEERING_RULE_NOT_READY Legal Rule Triage."""

from __future__ import annotations

from typing import Any

from orchestration.dispatcher import RootSubagentDispatcher
from orchestration.lifecycle import RootOrchestrationLifecycle
from orchestration.waiting_assessments import WaitingAssessmentRegistry
from tools.common.capabilities.managed.boundary import AgentBoundaryBase
from tools.common.capabilities.platform.logging import get_logger

from .contracts import LEGAL_RULE_TRIAGE_REQUEST_COMMAND


logger = get_logger(__name__)


class LegalRuleTriageBoundary(AgentBoundaryBase):
    """Adapt a readiness command into a Root Orchestration Triage dispatch."""

    boundary_source = "legal.engineering-rule-readiness"
    source_event = LEGAL_RULE_TRIAGE_REQUEST_COMMAND
    requires_rbac = False
    retry_delays_seconds = (30, 120, 600)

    def __init__(
        self,
        config,
        rbac_client=None,
        waiting_registry=None,
        dispatcher=None,
    ) -> None:
        super().__init__(config, rbac_client)
        self._waiting_registry = waiting_registry or WaitingAssessmentRegistry()
        self._dispatcher = dispatcher or RootSubagentDispatcher(
            lifecycle=RootOrchestrationLifecycle(
                waiting_registry=self._waiting_registry,
            )
        )

    def handle(self, message: dict[str, Any], correlationId: str) -> None:
        trigger = str(message.get("trigger") or "")
        if trigger != "ENGINEERING_RULE_NOT_READY":
            raise ValueError("automatic triage boundary requires ENGINEERING_RULE_NOT_READY")

        legal_rule_ids = self._string_list(message.get("affectedLegalRuleIds"))
        idempotency_key = str(message.get("idempotencyKey") or "").strip()
        if not idempotency_key:
            raise ValueError("automatic triage boundary requires idempotencyKey")
        evidence_report_id = str(message.get("resumeEvidenceReportId") or "").strip()
        if not evidence_report_id:
            raise ValueError("automatic triage boundary requires resumeEvidenceReportId")
        workflow_run_id = str(
            message.get("resumeWorkflowRunId") or evidence_report_id
        ).strip()

        # Root Orchestration retains only the checkpoint required to re-run Assessment
        # readiness. It is not a Triage work queue and is never exposed to Triage.
        self._waiting_registry.register(
            evidence_report_id=evidence_report_id,
            workflow_run_id=workflow_run_id,
            source_correlation_id=correlationId,
        )

        instruction = (
            "Automatic ENGINEERING_RULE_NOT_READY legal-preparation request. "
            "Root Orchestration must dispatch only the Triage specialist for the "
            "claimed governed LegalRule scope. Process only that scope, persist every "
            "ready LegalRule result, and call finish_legal_rule_triage_execution before "
            "returning. Do not use or request Assessment/customer/repository context. "
            f"Idempotency key: {idempotency_key}."
        )
        result = self._dispatcher.dispatch(
            subagent_type="triage",
            instruction=instruction,
            affected_rule_ids=legal_rule_ids,
            idempotency_key=idempotency_key,
            trigger=trigger,
            metadata={
                "workflow_run_id": f"triage:{workflow_run_id}",
                "node_name": "automatic_engineering_rule_readiness_triage",
                "correlationId": correlationId,
                "trigger": trigger,
            },
            thread_id=f"triage:{idempotency_key}",
        )

        if result.get("status") == "ALREADY_RUNNING":
            logger.info(
                "LEGAL_RULE_TRIAGE_ALREADY_RUNNING",
                active_execution_id=result.get("executionId"),
                requested_rule_count=len(legal_rule_ids),
                waiting_assessment_checkpointed=True,
                correlationId=correlationId,
            )
            return
        if result.get("status") != "COMPLETED":
            raise RuntimeError(
                "unexpected Root Orchestration Triage dispatch status: "
                f"{result.get('status')}"
            )

        logger.info(
            "LEGAL_RULE_TRIAGE_OWNER_COMPLETED",
            triage_execution_id=result.get("executionId"),
            assessment_reconciliation="root_orchestration_lifecycle",
            correlationId=correlationId,
        )

    @staticmethod
    def _string_list(value: Any) -> list[str]:
        if value is None:
            return []
        if not isinstance(value, list):
            raise ValueError("affectedLegalRuleIds must be a list")
        return list(
            dict.fromkeys(
                str(item).strip()
                for item in value
                if str(item).strip()
            )
        )
