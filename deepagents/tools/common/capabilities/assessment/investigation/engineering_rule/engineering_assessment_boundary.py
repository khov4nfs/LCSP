"""Consume accepted repository evidence and persist direct EngineeringRule evaluation results."""
from __future__ import annotations

import hashlib
import json
import os
from collections.abc import Callable
from dataclasses import replace
from pathlib import Path
from typing import Any

import pika

from model_policy import INVESTIGATOR_MODEL_SPEC, PLANNER_MODEL_SPEC
from tools.common.capabilities.platform.api_client import WorkerApiClient, WorkerCallbackError
from tools.common.capabilities.platform.callback_schemas import ClassificationCallbackPayload
from tools.common.capabilities.platform.logging import get_logger
from tools.common.capabilities.managed.boundary import AgentBoundaryBase, NonRetryableAgentBoundaryError
from tools.common.capabilities.evidence.scanner.snapshot.snapshot_service_client import (
    SnapshotArchiveRequest,
    SnapshotServiceClient,
)
from tools.common.capabilities.evidence.scanner.snapshot.workspace import ScannerWorkspace
from tools.triage.legal_rule_triage.contracts import LEGAL_RULE_TRIAGE_REQUEST_COMMAND

from .pipeline import EngineeringInvestigationPipeline
from .planned_pipeline import PlannedEngineeringInvestigationPipeline


logger = get_logger(__name__)
WAITING_ENGINEERING_INVESTIGATION_STATUSES = {"WAITING"}


class _AssessmentLegalPreparationDeferredDriver:
    """Prevent Assessment from performing legal preparation inside its reasoning path."""

    def run(self, message: dict[str, Any], correlation_id: str) -> dict[str, Any]:
        _ = message, correlation_id
        return {
            "status": "DEFERRED_TO_TRIAGE",
            "resumedRunCount": 0,
        }


class EngineeringAssessmentBoundary(AgentBoundaryBase):
    """Run the canonical post-scan assessment directly against Program Evidence Graph."""

    boundary_source = "investigation.evidence-accepted"
    source_event = "event.technical-evidence.accepted.v1"
    requires_rbac = False
    retry_delays_seconds = (30, 120, 600)

    def __init__(
        self,
        config,
        rbac_client=None,
        api_client: WorkerApiClient | None = None,
        model: str = INVESTIGATOR_MODEL_SPEC,
        planner_model: str = PLANNER_MODEL_SPEC,
        investigation_pipeline: EngineeringInvestigationPipeline | None = None,
        snapshot_client: SnapshotServiceClient | None = None,
        code_workspace: ScannerWorkspace | None = None,
        triage_trigger_publisher: Callable[[dict[str, Any]], None] | None = None,
    ) -> None:
        super().__init__(config, rbac_client)
        self._api_client = api_client or WorkerApiClient(
            config.nestjs_api_base_url,
            config.worker_api_key,
        )
        self._snapshot_client = snapshot_client or SnapshotServiceClient(
            config.nestjs_api_base_url,
            config.worker_api_key,
        )
        self._code_workspace = code_workspace or ScannerWorkspace()
        self._triage_trigger_publisher = (
            triage_trigger_publisher or self._publish_legal_triage_command
        )
        if investigation_pipeline is not None:
            self._pipeline = investigation_pipeline
        else:
            self._pipeline = PlannedEngineeringInvestigationPipeline(
                api_client=self._api_client,
                model=model,
                planner_model=planner_model,
                corpus_recovery_driver=_AssessmentLegalPreparationDeferredDriver(),
            )

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
        user_id = str(
            evidence_report.get("user_id")
            or evidence_report.get("userId")
            or message.get("userId")
            or message.get("user_id")
            or ""
        )

        workflow_run_id = self._workflow_run_id(
            message, evidence_report, evidence_report_id
        )
        wizard_context = self._wizard_context(assessment_id, correlationId)
        workspace_job_id = f"investigation-{correlationId}"
        workspace_path = self._materialize_code_workspace(
            evidence_report=evidence_report,
            workspace_job_id=workspace_job_id,
            correlation_id=correlationId,
        )
        try:
            result = self._pipeline.run(
                evidence_report=evidence_report,
                workflow_run_id=workflow_run_id,
                correlation_id=correlationId,
                wizard_context=wizard_context,
                workspace_path=workspace_path,
                recovery_source_crawl_requests=self._source_crawl_requests(message),
                assessment_id=assessment_id,
                user_id=user_id or None,
            )
        finally:
            if workspace_path is not None:
                self._code_workspace.cleanup(workspace_job_id)

        result = self._as_waiting_for_triage(result)
        if result.status in WAITING_ENGINEERING_INVESTIGATION_STATUSES:
            self._emit_investigation_waiting_runtime_event(
                scan_job_id=str(
                    evidence_report.get("scan_job_id")
                    or evidence_report.get("scanJobId")
                    or ""
                )
                or None,
                evidence_report_id=evidence_report_id,
                workflow_run_id=workflow_run_id,
                result=result,
                correlation_id=correlationId,
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
                raise NonRetryableAgentBoundaryError(str(error)) from error
            raise

        # Do not start legal reasoning until the WAITING classification has been
        # durably submitted. The command contains no Assessment/customer content;
        # only the resume evidence reference stays in the orchestration envelope and
        # is never passed into Triage reasoning/tools.
        if result.status in WAITING_ENGINEERING_INVESTIGATION_STATUSES:
            self._dispatch_legal_triage_request(
                evidence_report_id=evidence_report_id,
                workflow_run_id=workflow_run_id,
                result=result,
                correlation_id=correlationId,
            )

        logger.info(
            "ENGINEERING_ASSESSMENT_SUBMITTED",
            assessment_id=assessment_id,
            evidence_report_id=evidence_report_id,
            guardrail_status=guardrail_status,
            evaluation_count=(result_data.get("summary") or {}).get("total", 0),
            observability=result_data.get("observability") or {},
            correlationId=correlationId,
        )

    @staticmethod
    def _source_crawl_requests(message: dict[str, Any]) -> list[dict[str, Any]] | None:
        """Retain input compatibility without allowing Assessment to run legal recovery."""
        value = message.get("sourceCrawlRequests", message.get("source_crawl_requests"))
        if value is None:
            return None
        if not isinstance(value, list) or any(not isinstance(item, dict) for item in value):
            raise NonRetryableAgentBoundaryError(
                "sourceCrawlRequests must be a list of objects"
            )
        return value

    def _materialize_code_workspace(
        self,
        *,
        evidence_report: dict[str, Any],
        workspace_job_id: str,
        correlation_id: str,
    ) -> Path | None:
        """Materialize pinned source only for the active assessment process.

        Program Evidence Graph remains sufficient for graph-only investigation. If
        source download/materialization is unavailable, the run continues without
        raw-source tools rather than persisting source or weakening snapshot guards.
        """
        snapshot_id = str(
            evidence_report.get("snapshot_id")
            or evidence_report.get("snapshotId")
            or ""
        )
        scan_job_id = str(
            evidence_report.get("scan_job_id")
            or evidence_report.get("scanJobId")
            or ""
        )
        if not snapshot_id or not scan_job_id:
            logger.info(
                "CODE_CONTEXT_SNAPSHOT_UNAVAILABLE",
                reason="snapshot_or_scan_job_id_missing",
                correlationId=correlation_id,
            )
            return None
        try:
            archive = self._snapshot_client.download_snapshot_archive(
                SnapshotArchiveRequest(
                    snapshot_id=snapshot_id,
                    scan_job_id=scan_job_id,
                    correlationId=correlation_id,
                )
            )
            materialized = self._code_workspace.materialize(
                workspace_job_id,
                archive,
                snapshot_id=snapshot_id,
            )
            logger.info(
                "CODE_CONTEXT_SNAPSHOT_MATERIALIZED",
                snapshot_id=snapshot_id,
                extracted_files=materialized.extracted_files,
                skipped_files=materialized.skipped_files,
                coverage_limited=materialized.coverage_limited,
                correlationId=correlation_id,
            )
            return materialized.workspace_path
        except Exception as error:
            try:
                self._code_workspace.cleanup(workspace_job_id)
            except Exception:
                pass
            logger.warning(
                "CODE_CONTEXT_SNAPSHOT_UNAVAILABLE",
                snapshot_id=snapshot_id,
                error_type=type(error).__name__,
                correlationId=correlation_id,
            )
            return None

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
    def _missing_legal_rule_ids(result) -> tuple[str, ...]:
        observability = getattr(result, "observability", {}) or {}
        preparation = (
            observability.get("engineering_rule_preparation")
            if isinstance(observability, dict)
            else None
        )
        if not isinstance(preparation, dict):
            return ()
        values = preparation.get("compile_skipped_legal_rule_ids") or []
        if not isinstance(values, list):
            return ()
        return tuple(dict.fromkeys(str(value) for value in values if str(value)))

    @classmethod
    def _as_waiting_for_triage(cls, result):
        missing_rule_ids = cls._missing_legal_rule_ids(result)
        if not missing_rule_ids:
            return result
        observability = dict(getattr(result, "observability", {}) or {})
        observability["legal_preparation"] = {
            "status": "WAITING",
            "reason": "ENGINEERING_RULE_NOT_READY",
            "trigger": "ENGINEERING_RULE_NOT_READY",
            "automatic": True,
            "missing_legal_rule_ids": list(missing_rule_ids),
        }
        if str(getattr(result, "status", "")).upper() == "WAITING":
            return replace(result, observability=observability)
        return replace(result, status="WAITING", observability=observability)

    def _emit_investigation_waiting_runtime_event(
        self,
        *,
        scan_job_id: str | None,
        evidence_report_id: str,
        workflow_run_id: str,
        result,
        correlation_id: str,
    ) -> None:
        if not scan_job_id:
            return
        post_runtime_event = getattr(self._api_client, "post_scan_runtime_event", None)
        if post_runtime_event is None:
            return

        trigger = self._legal_triage_trigger(result)
        output_summary: dict[str, Any] = {
            "kind": "LEGAL_PREPARATION_REQUEST",
            "scope": "LEGAL_MAINTENANCE",
            "requestedBy": "ASSESSMENT_READINESS_GATE",
            "reasonCode": trigger["reason"],
            "status": str(getattr(result, "status", "WAITING")),
            "legalRuleCatalogVersionId": trigger["legalRuleCatalogVersionId"],
            "legalCorpusVersionId": trigger["legalCorpusVersionId"],
            "limitations": list(getattr(result, "limitations", ())),
            "correlationId": correlation_id,
            "resumeEvidenceReportId": evidence_report_id,
            "resumeWorkflowRunId": workflow_run_id,
            "triageTrigger": {
                key: value
                for key, value in trigger.items()
                if key != "reason"
            },
        }
        if trigger["affectedLegalRuleIds"]:
            output_summary["missingLegalRuleIds"] = list(
                trigger["affectedLegalRuleIds"]
            )

        post_runtime_event(
            scan_job_id,
            {
                # The shared runtime vocabulary currently models WAITING transitions as
                # TOOL_WAITING_INPUT. This payload explicitly marks this wait as
                # automatic/system-owned; no user/admin input is required.
                "event_type": "TOOL_WAITING_INPUT",
                "run_status": "WAITING",
                "stage": "LEGAL_RETRIEVAL",
                "tool_name": "engineering_rule_readiness",
                "summary": (
                    "Assessment is waiting for READY EngineeringRules; automatic "
                    "Legal Rule Triage was requested."
                ),
                "waiting_reason": trigger["reason"],
                "output_summary": output_summary,
            },
        )

    def _dispatch_legal_triage_request(
        self,
        *,
        evidence_report_id: str,
        workflow_run_id: str,
        result,
        correlation_id: str,
    ) -> None:
        trigger = self._legal_triage_trigger(result)
        command = {
            "trigger": "ENGINEERING_RULE_NOT_READY",
            "affectedLegalRuleIds": trigger["affectedLegalRuleIds"],
            "legalRuleCatalogVersionId": trigger["legalRuleCatalogVersionId"],
            "legalCorpusVersionId": trigger["legalCorpusVersionId"],
            "idempotencyKey": trigger["idempotencyKey"],
            # Resume references are orchestration-only. LegalRuleTriageBoundary strips
            # them from the model/tool boundary and uses them only after Triage ends.
            "resumeEvidenceReportId": evidence_report_id,
            "resumeWorkflowRunId": workflow_run_id,
            "correlationId": correlation_id,
        }
        self._triage_trigger_publisher(command)
        logger.info(
            "LEGAL_RULE_TRIAGE_AUTOMATIC_TRIGGER_PUBLISHED",
            affected_rule_count=len(trigger["affectedLegalRuleIds"]),
            full_backlog=trigger["fullBacklog"],
            correlationId=correlation_id,
        )

    @classmethod
    def _legal_triage_trigger(cls, result) -> dict[str, Any]:
        missing_rule_ids = cls._missing_legal_rule_ids(result)
        reason = (
            "ENGINEERING_RULE_NOT_READY"
            if missing_rule_ids
            else "NO_ENGINEERING_RULE_SOURCE_RULES"
        )
        catalog_version_id = str(
            getattr(result, "legal_rule_catalog_version_id", "")
        )
        corpus_version_id = str(getattr(result, "legal_corpus_version_id", ""))
        return {
            "reason": reason,
            "mode": "LEGAL_MAINTENANCE",
            "trigger": "ENGINEERING_RULE_NOT_READY",
            "automatic": True,
            "affectedLegalRuleIds": list(missing_rule_ids),
            "fullBacklog": not bool(missing_rule_ids),
            "refreshLegalCatalog": not bool(missing_rule_ids),
            "legalRuleCatalogVersionId": catalog_version_id,
            "legalCorpusVersionId": corpus_version_id,
            "idempotencyKey": cls._triage_trigger_idempotency_key(
                reason=reason,
                catalog_version_id=catalog_version_id,
                corpus_version_id=corpus_version_id,
                legal_rule_ids=missing_rule_ids,
            ),
        }

    @staticmethod
    def _triage_trigger_idempotency_key(
        *,
        reason: str,
        catalog_version_id: str,
        corpus_version_id: str,
        legal_rule_ids: tuple[str, ...],
    ) -> str:
        # Assessment identity is deliberately excluded: legal preparation is reusable
        # and keyed only by governed legal scope/version state.
        payload = "|".join(
            [
                reason,
                catalog_version_id,
                corpus_version_id,
                *sorted(legal_rule_ids),
            ]
        )
        return "legal-triage:" + hashlib.sha256(payload.encode("utf-8")).hexdigest()

    @staticmethod
    def _publish_legal_triage_command(message: dict[str, Any]) -> None:
        rabbitmq_url = os.getenv("RABBITMQ_URL")
        if not rabbitmq_url:
            raise RuntimeError(
                "RABBITMQ_URL is required for automatic Legal Rule Triage dispatch"
            )
        exchange = os.getenv("RABBITMQ_EXCHANGE", "lcsp.events")
        connection = pika.BlockingConnection(pika.URLParameters(rabbitmq_url))
        try:
            channel = connection.channel()
            channel.exchange_declare(
                exchange=exchange,
                exchange_type="topic",
                durable=True,
            )
            channel.confirm_delivery()
            published = channel.basic_publish(
                exchange=exchange,
                routing_key=LEGAL_RULE_TRIAGE_REQUEST_COMMAND,
                body=json.dumps(message, ensure_ascii=False, sort_keys=True).encode("utf-8"),
                properties=pika.BasicProperties(
                    content_type="application/json",
                    delivery_mode=2,
                    correlation_id=str(message.get("correlationId") or ""),
                ),
                mandatory=True,
            )
            if published is False:
                raise RuntimeError("RabbitMQ did not confirm Legal Rule Triage command")
        finally:
            if connection.is_open:
                connection.close()

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
