"""Consume gap-analysis requests and publish guarded document callbacks."""
from __future__ import annotations

import json
from typing import Any

from lcsp_workers.dossiers.context_builder import ClassificationDossierBuilder
from lcsp_workers.platform.logging import get_logger
from lcsp_workers.platform.queue_consumer import ConsumerBase

from .document_runtime_client import DocumentRuntimeClient
from .gap_analysis_generator import GapAnalysisGenerator
from .output_guardrail import OutputGuardrail
from .storage_uploader import StorageUploader


logger = get_logger(__name__)


class GapAnalysisConsumer(ConsumerBase):
    """Generate deterministic gap documents from authoritative pinned artifacts."""

    queue_name = "reporting.document-gap-analysis-requested"
    routing_key = "document.gap-analysis-requested"
    requires_pbac = False

    def __init__(
        self,
        config,
        pbac_client=None,
        document_client: DocumentRuntimeClient | None = None,
        dossier_builder: ClassificationDossierBuilder | None = None,
    ) -> None:
        super().__init__(config, pbac_client)
        self._document_client = document_client or DocumentRuntimeClient(
            config.nestjs_api_base_url,
            config.worker_api_key,
        )
        self._dossier_builder = dossier_builder or ClassificationDossierBuilder()

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
            dossier = self._dossier_builder.build(context)
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
                blocked_reason="Required assessment artifacts are unavailable for gap analysis.",
            )
            return

        sections = dossier.sections
        assessment = self._record(context.get("assessment"))
        verified = self._record(context.get("verified_profile"))
        verified_data = self._record(verified.get("profile_data"))
        legal_match = self._record(context.get("legal_rule_match"))
        technical = self._record(sections.get("technicalAiProfile"))

        missing_evidence: list[object] = list(
            sections.get("unresolvedEvidence") or []
        )
        missing_evidence.extend(
            f"Dossier requirement unavailable: {key}"
            for key in dossier.missing_requirements
        )
        recommendations = (
            sections.get("remediation")
            if isinstance(sections.get("remediation"), list)
            else []
        )
        content = GapAnalysisGenerator.generate(
            assessment_name=str(assessment.get("name") or "Assessment"),
            assessment_context=self._json_text(
                {
                    "systemIdentity": sections.get("systemIdentity"),
                    "intendedUse": sections.get("intendedUse"),
                    "dossierStatus": dossier.status,
                }
            ),
            technical_evidence=[
                self._json_text(
                    {
                        "programGraph": technical.get("program_graph_ref"),
                        "dataCategories": technical.get("data_categories") or [],
                        "externalIntegrations": technical.get("external_integrations") or [],
                        "humanControls": technical.get("human_control_evidence") or {},
                    }
                )
            ],
            ai_usage_claims=self._list_of_records(
                verified_data.get("verified_claims")
            ),
            applicable_rules=self._list_of_records(legal_match.get("matches")),
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
                blocked_reason="Output guardrail blocked overclaiming terminology.",
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
    def _assert_gap_context(context: dict[str, Any]) -> None:
        request = GapAnalysisConsumer._record(context.get("document_request"))
        classification = GapAnalysisConsumer._record(
            context.get("classification_result")
        )
        if str(request.get("document_type") or "").upper() != "GAP_ANALYSIS":
            raise ValueError("document request is not a gap analysis")
        if str(classification.get("guardrail_status") or "").upper() != "PASSED":
            raise ValueError("classification guardrail is not passed")

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
