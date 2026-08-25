"""Generate gap analysis directly from persisted EngineeringRule evaluations."""
from __future__ import annotations

import json
from typing import Any

from tools.common.capabilities.platform.logging import get_logger
from tools.common.capabilities.managed.boundary import AgentBoundaryBase

from tools.common.capabilities.reporting.report.projection.classification_data_projection import (
    document_classification_context,
    document_evaluations,
)
from tools.common.capabilities.reporting.report.delivery.document_runtime_client import DocumentRuntimeClient
from .gap_analysis_generator import GapAnalysisGenerator
from tools.common.capabilities.reporting.report.final_report.output_guardrail import OutputGuardrail
from tools.common.capabilities.reporting.report.delivery.storage_uploader import StorageUploader


logger = get_logger(__name__)


class GapAnalysisBoundary(AgentBoundaryBase):
    """Generate deterministic gap documents without legacy profile/legal-match artifacts."""

    boundary_source = "reporting.document-gap-analysis-requested"
    source_event = "document.gap-analysis-requested"
    requires_pbac = False

    def __init__(
        self,
        config,
        pbac_client=None,
        document_client: DocumentRuntimeClient | None = None,
    ) -> None:
        super().__init__(config, pbac_client)
        self._document_client = document_client or DocumentRuntimeClient(
            config.nestjs_api_base_url,
            config.worker_api_key,
        )

    def handle(self, message: dict, correlationId: str) -> None:
        document_id = self._document_request_id(message)
        logger.info(
            "PROCESSING_GAP_ANALYSIS_REQUEST",
            document_id=document_id,
            correlationId=correlationId,
        )
        try:
            context = self._document_client.get_generation_context(document_id)
            self._assert_gap_context(context)
            assessment = self._record(context.get("assessment"))
            classification = self._record(context.get("classification_result"))
            data = self._record(classification.get("classification_data"))
            document_data = document_classification_context(data)
            evidence_report = self._record(context.get("technical_evidence_report"))
            snapshot = self._record(context.get("repository_snapshot"))
            evaluations = document_evaluations(data)
        except Exception as error:
            logger.error(
                "GAP_ANALYSIS_CONTEXT_FAILED",
                document_id=document_id,
                error_type=type(error).__name__,
            )
            self._document_client.post_document_callback(
                document_id,
                status="FAILED",
                error_code="DOCUMENT_GENERATION_CONTEXT_INVALID",
                blocked_reason="Direct EngineeringRule assessment artifacts are unavailable for gap analysis.",
            )
            return

        unknown = [
            item for item in evaluations if str(item.get("status") or "") == "UNKNOWN"
        ]
        failed = [
            item
            for item in evaluations
            if str(item.get("status") or "") == "NON_COMPLIANT"
        ]
        limitations = [
            str(item) for item in document_data.get("limitations") or [] if str(item)
        ]
        missing_evidence: list[str] = limitations + [
            self._json_text(
                {
                    "engineeringRuleId": item.get("engineering_rule_id"),
                    "concept": item.get("concept"),
                    "reason": item.get("reason"),
                    "limitations": item.get("limitations") or [],
                }
            )
            for item in unknown
        ]
        recommendations = [
            self._json_text(
                {
                    "engineeringRuleId": item.get("engineering_rule_id"),
                    "concept": item.get("concept"),
                    "action": "Review the referenced repository path and implement the missing engineering control, then re-scan the pinned repository.",
                    "evidenceRefs": item.get("evidence_refs") or [],
                }
            )
            for item in failed
        ]

        content = GapAnalysisGenerator.generate(
            assessment_name=str(assessment.get("name") or "Assessment"),
            assessment_context=self._json_text(
                {
                    "mode": document_data.get("mode"),
                    "summary": document_data.get("summary") or {},
                    "legalRuleCatalogVersionId": document_data.get(
                        "legal_rule_catalog_version_id"
                    ),
                    "legalCorpusVersionId": document_data.get(
                        "legal_corpus_version_id"
                    ),
                }
            ),
            technical_evidence=[
                self._json_text(
                    {
                        "technicalEvidenceReportId": evidence_report.get("id"),
                        "snapshotId": evidence_report.get("snapshot_id"),
                        "commitSha": snapshot.get("commit_sha"),
                    }
                )
            ],
            rule_evaluations=[self._json_text(item) for item in evaluations],
            missing_evidence=missing_evidence,
            recommendations=recommendations,
        )

        if OutputGuardrail.check(content):
            logger.warning(
                "GAP_ANALYSIS_GUARDRAIL_BLOCKED",
                document_id=document_id,
            )
            self._document_client.post_document_callback(
                document_id,
                status="BLOCKED",
                error_code="GAP_ANALYSIS_OVERCLAIM_BLOCKED",
                blocked_reason="Output guardrail blocked narrative legal overclaiming.",
            )
            return

        try:
            document_url = StorageUploader.upload_document(document_id, content)
        except Exception as error:
            logger.error(
                "GAP_ANALYSIS_UPLOAD_FAILED",
                document_id=document_id,
                error_type=type(error).__name__,
            )
            self._document_client.post_document_callback(
                document_id,
                status="FAILED",
                error_code="GAP_ANALYSIS_UPLOAD_FAILED",
                blocked_reason="Generated gap analysis could not be stored.",
            )
            return

        self._document_client.post_document_callback(
            document_id,
            status="READY",
            document_url=document_url,
        )
        logger.info(
            "GAP_ANALYSIS_READY",
            document_id=document_id,
            evaluation_count=len(evaluations),
            non_compliant_count=len(failed),
            unknown_count=len(unknown),
        )

    @staticmethod
    def _document_request_id(message: dict[str, Any]) -> str:
        value = (
            message.get("documentRequestId")
            or message.get("document_request_id")
            or message.get("document_id")
        )
        if not value:
            raise ValueError("missing documentRequestId")
        return str(value)

    @staticmethod
    def _assert_gap_context(context: dict[str, Any]) -> None:
        request = GapAnalysisBoundary._record(context.get("document_request"))
        classification = GapAnalysisBoundary._record(
            context.get("classification_result")
        )
        if str(request.get("document_type") or "").upper() != "GAP_ANALYSIS":
            raise ValueError("document request is not a gap analysis")
        if str(classification.get("guardrail_status") or "").upper() not in {
            "PASSED",
            "DEGRADED",
        }:
            raise ValueError("engineering assessment guardrail is blocked")

    @staticmethod
    def _record(value: object) -> dict[str, Any]:
        return value if isinstance(value, dict) else {}

    @staticmethod
    def _json_text(value: object) -> str:
        return json.dumps(value, sort_keys=True, default=str, separators=(",", ":"))
