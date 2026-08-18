"""Consume accepted repository evidence and persist direct EngineeringRule evaluation results."""
from __future__ import annotations

from typing import Any

from lcsp_workers.llm.fallback_client import LLMClientProtocol
from lcsp_workers.platform.api_client import WorkerApiClient, WorkerCallbackError
from lcsp_workers.platform.callback_schemas import ClassificationCallbackPayload
from lcsp_workers.platform.logging import get_logger
from lcsp_workers.platform.queue_consumer import ConsumerBase, NonRetryableWorkerError

from .pipeline import EngineeringInvestigationPipeline


logger = get_logger(__name__)


class EngineeringAssessmentConsumer(ConsumerBase):
    """Run the canonical post-scan assessment directly against Program Evidence Graph."""

    queue_name = "investigation.evidence-accepted"
    routing_key = "event.technical-evidence.accepted.v1"
    requires_pbac = False

    def __init__(
        self,
        config,
        pbac_client=None,
        api_client: WorkerApiClient | None = None,
        llm_client: LLMClientProtocol | None = None,
        investigation_pipeline: EngineeringInvestigationPipeline | None = None,
    ) -> None:
        super().__init__(config, pbac_client)
        self._api_client = api_client or WorkerApiClient(
            config.nestjs_api_base_url,
            config.worker_api_key,
        )
        if investigation_pipeline is not None:
            self._pipeline = investigation_pipeline
        elif llm_client is not None:
            self._pipeline = EngineeringInvestigationPipeline(
                api_client=self._api_client,
                llm_client=llm_client,
            )
        else:
            self._pipeline = None

    def handle(self, message: dict[str, Any], correlationId: str) -> None:
        evidence_report_id = self._evidence_report_id(message)
        evidence_report = self._api_client.get_accepted_technical_evidence_report(
            evidence_report_id
        )
        assessment_id = str(
            evidence_report.get("assessment_id")
            or evidence_report.get("assessmentId")
            or message.get("assessmentId")
            or message.get("assessment_id")
            or ""
        )
        if not assessment_id:
            raise ValueError("accepted evidence report is missing assessment_id")

        wizard_context = self._wizard_context(assessment_id, correlationId)
        if self._pipeline is None:
            result_data = {
                "mode": "ENGINEERING_RULE_EVALUATION",
                "status": "BLOCKED",
                "summary": {
                    "compliant": 0,
                    "non_compliant": 0,
                    "unknown": 0,
                    "total": 0,
                },
                "evaluations": [],
                "claims": [],
                "limitations": ["ENGINEERING_ASSESSMENT_LLM_RUNTIME_DISABLED"],
            }
            guardrail_status = "BLOCKED"
        else:
            result = self._pipeline.run(
                evidence_report=evidence_report,
                workflow_run_id=self._workflow_run_id(
                    message, evidence_report, evidence_report_id
                ),
                correlation_id=correlationId,
                wizard_context=wizard_context,
            )
            result_data = result.to_assessment_data()
            guardrail_status = self._guardrail_status(result.status)

        # correlationId is the direct assessment run identity. Re-delivery of the
        # same event remains idempotent; an explicit rerun receives a new correlation
        # ID and may persist a fresh result for the same pinned evidence report.
        result_data["run_id"] = correlationId
        result_data["technical_evidence_report_id"] = evidence_report_id
        snapshot_id = evidence_report.get("snapshot_id") or evidence_report.get(
            "snapshotId"
        )
        if snapshot_id:
            result_data["snapshot_id"] = str(snapshot_id)
        if wizard_context:
            result_data["wizard_context_used"] = True

        payload = ClassificationCallbackPayload(
            technical_evidence_report_id=evidence_report_id,
            assessment_id=assessment_id,
            schema_version="2.0.0",
            classification_data=result_data,
            guardrail_status=guardrail_status,
        )
        try:
            self._api_client.post_classification_callback(payload)
        except WorkerCallbackError as error:
            # WorkerApiClient already retries network/5xx failures internally. A
            # remaining callback 4xx is a deterministic payload/domain rejection;
            # replaying the expensive EngineeringRule/LLM run cannot heal it.
            if self._is_terminal_callback_client_error(error):
                raise NonRetryableWorkerError(str(error)) from error
            raise
        logger.info(
            "ENGINEERING_ASSESSMENT_SUBMITTED",
            assessment_id=assessment_id,
            evidence_report_id=evidence_report_id,
            guardrail_status=guardrail_status,
            evaluation_count=(result_data.get("summary") or {}).get("total", 0),
            correlationId=correlationId,
        )

    def _wizard_context(
        self,
        assessment_id: str,
        correlation_id: str,
    ) -> dict[str, Any] | None:
        try:
            profile = self._api_client.get_wizard_profile_for_assessment(assessment_id)
        except Exception as error:
            logger.info(
                "OPTIONAL_WIZARD_CONTEXT_UNAVAILABLE",
                assessment_id=assessment_id,
                error_type=type(error).__name__,
                correlationId=correlation_id,
            )
            return None

        if not isinstance(profile, dict):
            return None
        answers = profile.get("answers")
        if isinstance(answers, dict):
            return dict(answers)
        if isinstance(answers, list):
            result: dict[str, Any] = {}
            for row in answers:
                if not isinstance(row, dict):
                    continue
                question_id = row.get("questionId") or row.get("question_id")
                if question_id:
                    result[str(question_id)] = row.get("value")
            return result or None
        return None

    @staticmethod
    def _guardrail_status(status: str) -> str:
        normalized = str(status).upper()
        if normalized == "COMPLETE":
            return "PASSED"
        if normalized == "PARTIAL":
            return "DEGRADED"
        return "BLOCKED"

    @staticmethod
    def _evidence_report_id(message: dict[str, Any]) -> str:
        value = (
            message.get("evidenceReportId")
            or message.get("evidence_report_id")
            or message.get("technicalEvidenceReportId")
            or message.get("aggregateId")
        )
        if not value:
            raise ValueError("missing evidenceReportId")
        return str(value)

    @staticmethod
    def _workflow_run_id(
        message: dict[str, Any],
        evidence_report: dict[str, Any],
        evidence_report_id: str,
    ) -> str:
        return str(
            message.get("workflowRunId")
            or message.get("workflow_run_id")
            or evidence_report.get("scan_job_id")
            or evidence_report.get("scanJobId")
            or evidence_report_id
        )

    @staticmethod
    def _is_terminal_callback_client_error(error: WorkerCallbackError) -> bool:
        """Return whether WorkerApiClient reported a non-idempotent HTTP 4xx."""
        return "callback failed with client error 4" in str(error).lower()
