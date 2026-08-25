"""Generate final reports directly from EngineeringRule assessment artifacts."""
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
from .final_report_generator import FinalReportGenerator
from .output_guardrail import OutputGuardrail
from tools.common.capabilities.reporting.report.delivery.storage_uploader import StorageUploader


logger = get_logger(__name__)


class FinalReportBoundary(AgentBoundaryBase):
    """Generate final reports without TechnicalProfile/AIUsageFlow/VerifiedProfile/LegalMatch."""

    boundary_source = "reporting.document-final-report-requested"
    source_event = "document.final-report-requested"
    requires_pbac = False

    def __init__(
        self,
        config,
        document_client: DocumentRuntimeClient | None = None,
    ) -> None:
        super().__init__(config)
        self._document_client = document_client or DocumentRuntimeClient(
            config.nestjs_api_base_url,
            config.worker_api_key,
        )
        self._generator = FinalReportGenerator()

    def handle(self, message: dict, correlationId: str) -> None:
        document_id = self._document_request_id(message)
        logger.info(
            "PROCESSING_FINAL_REPORT_REQUEST",
            document_id=document_id,
            correlationId=correlationId,
        )

        try:
            context = self._document_client.get_generation_context(document_id)
            self._assert_final_report_context(context)
            assessment = self._record(context.get("assessment"))
            classification = self._record(context.get("classification_result"))
            data = self._record(classification.get("classification_data"))
            document_data = document_classification_context(data)
            evidence_report = self._record(context.get("technical_evidence_report"))
            snapshot = self._record(context.get("repository_snapshot"))
            evaluations = document_evaluations(data)
        except Exception as error:
            logger.error(
                "FINAL_REPORT_CONTEXT_FAILED",
                document_id=document_id,
                error_type=type(error).__name__,
            )
            self._document_client.post_document_callback(
                document_id,
                status="FAILED",
                error_code="DOCUMENT_GENERATION_CONTEXT_INVALID",
                blocked_reason="Direct EngineeringRule assessment artifacts are unavailable for report generation.",
            )
            return

        citations = sorted(
            {
                str(ref)
                for evaluation in evaluations
                for key in ("source_chunk_ids", "source_locators", "evidence_refs")
                for ref in evaluation.get(key) or []
                if str(ref)
            }
        )
        unknown = [
            item for item in evaluations if str(item.get("status") or "") == "UNKNOWN"
        ]
        limitations = [
            str(item) for item in document_data.get("limitations") or [] if str(item)
        ]
        limitations.extend(
            str(value)
            for item in unknown
            for value in item.get("limitations") or []
            if str(value)
        )

        try:
            content = self._generator.generate(
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
                citations=citations,
                limitations="\n".join(dict.fromkeys(limitations))
                or "No known limitations recorded.",
                evidence_provenance=self._json_text(
                    {
                        "technicalEvidenceReportId": evidence_report.get("id"),
                        "snapshotId": evidence_report.get("snapshot_id"),
                        "commitSha": snapshot.get("commit_sha"),
                        "legalRuleCatalogVersionId": document_data.get(
                            "legal_rule_catalog_version_id"
                        ),
                        "legalCorpusVersionId": document_data.get(
                            "legal_corpus_version_id"
                        ),
                    }
                ),
                workflow_run_id=f"final-report:{document_id}:{correlationId}",
                node_name="final_report.executive_summary",
                correlationId=correlationId,
            )
        except Exception as error:
            logger.error(
                "FINAL_REPORT_GENERATION_FAILED",
                document_id=document_id,
                error_type=type(error).__name__,
            )
            self._document_client.post_document_callback(
                document_id,
                status="FAILED",
                error_code="FINAL_REPORT_GENERATION_FAILED",
                blocked_reason="Report narration could not be generated within configured safety and budget controls.",
            )
            return

        if OutputGuardrail.check(content):
            logger.warning(
                "FINAL_REPORT_GUARDRAIL_BLOCKED",
                document_id=document_id,
            )
            self._document_client.post_document_callback(
                document_id,
                status="BLOCKED",
                error_code="FINAL_REPORT_OVERCLAIM_BLOCKED",
                blocked_reason="Output guardrail blocked narrative legal overclaiming.",
            )
            return

        try:
            document_url = StorageUploader.upload_document(document_id, content)
        except Exception as error:
            logger.error(
                "FINAL_REPORT_UPLOAD_FAILED",
                document_id=document_id,
                error_type=type(error).__name__,
            )
            self._document_client.post_document_callback(
                document_id,
                status="FAILED",
                error_code="FINAL_REPORT_UPLOAD_FAILED",
                blocked_reason="Generated report could not be stored.",
            )
            return

        self._document_client.post_document_callback(
            document_id,
            status="READY",
            document_url=document_url,
        )
        logger.info(
            "FINAL_REPORT_READY",
            document_id=document_id,
            evaluation_count=len(evaluations),
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
    def _assert_final_report_context(context: dict[str, Any]) -> None:
        request = FinalReportBoundary._record(context.get("document_request"))
        classification = FinalReportBoundary._record(
            context.get("classification_result")
        )
        if str(request.get("document_type") or "").upper() != "FINAL_REPORT":
            raise ValueError("document request is not a final report")
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
