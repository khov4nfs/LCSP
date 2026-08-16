"""Consume final-report requests and publish guarded terminal document status."""
from __future__ import annotations

import json
from typing import Any

from lcsp_workers.dossiers.context_builder import ClassificationDossierBuilder
from lcsp_workers.llm.gateway_client import LLMGatewayClient
from lcsp_workers.platform.logging import get_logger
from lcsp_workers.platform.queue_consumer import ConsumerBase

from .document_runtime_client import DocumentRuntimeClient
from .final_report_generator import FinalReportGenerator
from .output_guardrail import OutputGuardrail
from .storage_uploader import StorageUploader


logger = get_logger(__name__)


class FinalReportConsumer(ConsumerBase):
    """Generate final reports from authoritative, source-pinned dossier inputs."""

    queue_name = "reporting.document-final-report-requested"
    routing_key = "document.final-report-requested"
    requires_pbac = False

    def __init__(
        self,
        config,
        llm_client: LLMGatewayClient | None = None,
        document_client: DocumentRuntimeClient | None = None,
        dossier_builder: ClassificationDossierBuilder | None = None,
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
        self._dossier_builder = dossier_builder or ClassificationDossierBuilder()
        self._generator = FinalReportGenerator(llm_client)

    def handle(self, message: dict, correlationId: str) -> None:
        """Resolve pinned artifacts, build a dossier, generate, guard, upload, callback."""
        document_id = self._document_request_id(message)
        logger.info(
            "PROCESSING_FINAL_REPORT_REQUEST",
            document_id=document_id,
            correlationId=correlationId,
        )

        try:
            context = self._document_client.get_generation_context(document_id)
            self._assert_final_report_context(context)
            dossier = self._dossier_builder.build(context)
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
                blocked_reason="Required assessment artifacts are unavailable for report generation.",
            )
            return

        sections = dossier.sections
        assessment = self._record(context.get("assessment"))
        verified = self._record(context.get("verified_profile"))
        verified_data = self._record(verified.get("profile_data"))
        legal_match = self._record(context.get("legal_rule_match"))

        try:
            content = self._generator.generate(
                assessment_name=str(assessment.get("name") or "Assessment"),
                assessment_context=self._json_text(
                    {
                        "systemIdentity": sections.get("systemIdentity"),
                        "intendedUse": sections.get("intendedUse"),
                        "dossierStatus": dossier.status,
                    }
                ),
                technical_evidence=self._technical_evidence_items(sections),
                verified_ai_usage=self._list_of_records(
                    verified_data.get("verified_claims")
                ),
                legal_rule_applicability=self._list_of_records(
                    legal_match.get("matches")
                ),
                citations=self._string_list(legal_match.get("citation_allowlist")),
                limitations=self._limitations_text(dossier),
                evidence_provenance=self._json_text(
                    {
                        "dossierId": dossier.dossier_id,
                        "dossierStatus": dossier.status,
                        "sourceArtifacts": dossier.source_artifacts.__dict__,
                        "provenance": dossier.provenance,
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
                blocked_reason="Report narration could not be generated within the configured safety and budget controls.",
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
                blocked_reason="Output guardrail blocked overclaiming terminology.",
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
            dossier_id=dossier.dossier_id,
            dossier_status=dossier.status,
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
        if str(classification.get("guardrail_status") or "").upper() != "PASSED":
            raise ValueError("classification guardrail is not passed")

    @staticmethod
    def _technical_evidence_items(sections: dict[str, Any]) -> list[str]:
        technical = FinalReportConsumer._record(sections.get("technicalAiProfile"))
        summary = {
            "programGraph": technical.get("program_graph_ref"),
            "aiDetected": technical.get("ai_detected"),
            "dataCategories": technical.get("data_categories") or [],
            "externalIntegrations": technical.get("external_integrations") or [],
            "businessActions": technical.get("business_actions") or [],
            "humanControls": technical.get("human_control_evidence") or {},
            "dependencyLicenses": technical.get("dependency_licenses") or [],
        }
        return [FinalReportConsumer._json_text(summary)]

    @staticmethod
    def _limitations_text(dossier) -> str:
        parts: list[str] = []
        if dossier.missing_requirements:
            parts.append(
                "Dossier requirements not yet available: "
                + ", ".join(dossier.missing_requirements)
            )
        unresolved = dossier.sections.get("unresolvedEvidence") or []
        if unresolved:
            parts.append(
                "Unresolved evidence: "
                + FinalReportConsumer._json_text(unresolved)
            )
        return "\n".join(parts) or "No known limitations recorded."

    @staticmethod
    def _record(value: object) -> dict[str, Any]:
        return value if isinstance(value, dict) else {}

    @staticmethod
    def _list_of_records(value: object) -> list[dict[str, Any]]:
        if not isinstance(value, list):
            return []
        return [dict(item) for item in value if isinstance(item, dict)]

    @staticmethod
    def _string_list(value: object) -> list[str]:
        if not isinstance(value, list):
            return []
        return [str(item) for item in value if item]

    @staticmethod
    def _json_text(value: object) -> str:
        return json.dumps(value, sort_keys=True, default=str, separators=(",", ":"))
