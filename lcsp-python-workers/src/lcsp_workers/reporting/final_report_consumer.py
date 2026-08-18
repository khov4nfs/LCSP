"""Generate final reports directly from EngineeringRule assessment artifacts."""
from __future__ import annotations

import json
from typing import Any

from lcsp_workers.llm.gateway_client import LLMGatewayClient
from lcsp_workers.platform.logging import get_logger
from lcsp_workers.platform.queue_consumer import ConsumerBase

from .document_runtime_client import DocumentRuntimeClient
from .final_report_generator import FinalReportGenerator
from .output_guardrail import OutputGuardrail
from .storage_uploader import StorageUploader


logger = get_logger(__name__)


class FinalReportConsumer(ConsumerBase):
    """Generate final reports without TechnicalProfile/AIUsageFlow/VerifiedProfile/LegalMatch."""

    queue_name = "reporting.document-final-report-requested"
    routing_key = "document.final-report-requested"
    requires_pbac = False

    def __init__(
        self,
        config,
        llm_client: LLMGatewayClient | None = None,
        document_client: DocumentRuntimeClient | None = None,
    ) -> None:
        super().__init__(config)
        if llm_client is None:
            raise ValueError(
                "FinalReportConsumer requires an injected llm_client from runtime configuration."
            )
        self._document_client = document_client or DocumentRuntimeClient(
            config.nestjs_api_base_url,
            config.worker_api_key,
        )
        self._generator = FinalReportGenerator(llm_client)

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
            evidence_report = self._record(context.get("technical_evidence_report"))
            snapshot = self._record(context.get("repository_snapshot"))
            evaluations = self._list_of_records(data.get("evaluations"))
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
        limitations = [str(item) for item in data.get("limitations") or [] if str(item)]
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
                        "mode": data.get("mode"),
                        "summary": data.get("summary") or {},
                        "legalRuleCatalogVersionId": data.get(
                            "legal_rule_catalog_version_id"
                        ),
                        "legalCorpusVersionId": data.get("legal_corpus_version_id"),
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
                        "legalRuleCatalogVersionId": data.get(
                            "legal_rule_catalog_version_id"
                        ),
                        "legalCorpusVersionId": data.get("legal_corpus_version_id"),
                    }
                ),
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
        request = FinalReportConsumer._record(context.get("document_request"))
        classification = FinalReportConsumer._record(
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
    def _list_of_records(value: object) -> list[dict[str, Any]]:
        if not isinstance(value, list):
            return []
        return [dict(item) for item in value if isinstance(item, dict)]

    @staticmethod
    def _json_text(value: object) -> str:
        return json.dumps(value, sort_keys=True, default=str, separators=(",", ":"))
