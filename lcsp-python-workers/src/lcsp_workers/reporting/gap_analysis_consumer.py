"""Consume gap-analysis requests and publish guarded document callbacks."""

import requests
from lcsp_workers.platform.queue_consumer import ConsumerBase
from lcsp_workers.platform.logging import get_logger

from .gap_analysis_generator import GapAnalysisGenerator
from .output_guardrail import OutputGuardrail
from .storage_uploader import StorageUploader

logger = get_logger(__name__)


class GapAnalysisConsumer(ConsumerBase):
    """Generate deterministic gap-analysis documents for system events."""

    queue_name = "reporting.document-gap-analysis-requested"
    routing_key = "document.gap-analysis-requested"
    requires_pbac = False  # System event

    def handle(self, message: dict, correlationId: str) -> None:
        """Render, guard, upload, and callback one gap-analysis request.

        Args:
            message: Structured document-generation inputs from the API event.
            correlationId: End-to-end trace identifier for the delivery.
        """
        logger.info("PROCESSING_GAP_ANALYSIS_REQUEST", correlationId=correlationId)

        # 1. Fetch data. Assuming data is in the payload for now.
        document_id = message.get("document_id", "unknown-doc-id")
        assessment_name = message.get("assessment_name", "Unknown Assessment")
        assessment_context = message.get("assessment_context", "")
        technical_evidence = message.get("technical_evidence", [])
        ai_usage_claims = message.get("ai_usage_claims", [])
        applicable_rules = message.get("applicable_rules", [])
        missing_evidence = message.get("missing_evidence", [])
        recommendations = message.get("recommendations", [])

        # 2. Generate Document (Markdown)
        content = GapAnalysisGenerator.generate(
            assessment_name=assessment_name,
            assessment_context=assessment_context,
            technical_evidence=technical_evidence,
            ai_usage_claims=ai_usage_claims,
            applicable_rules=applicable_rules,
            missing_evidence=missing_evidence,
            recommendations=recommendations
        )

        # 3. Output Guardrail Check
        has_overclaim = OutputGuardrail.check(content)

        if has_overclaim:
            logger.warning("GAP_ANALYSIS_GUARDRAIL_BLOCKED", document_id=document_id)
            self._submit_callback(document_id, {
                "status": "BLOCKED",
                "blocked_reason": "Output guardrail blocked due to overclaiming terminology."
            })
            return

        # 5. Upload to Object Storage
        try:
            document_url = StorageUploader.upload_document(document_id, content)

            # 6. Submit Callback to API
            self._submit_callback(document_id, {
                "status": "READY",
                "document_url": document_url
            })
        except Exception as e:
            logger.error("GAP_ANALYSIS_UPLOAD_FAILED", document_id=document_id, error=str(e))
            self._submit_callback(document_id, {
                "status": "FAILED",
                "blocked_reason": f"Upload failed: {str(e)}"
            })

    def _submit_callback(self, document_id: str, payload: dict) -> None:
        """Patch the document request with its terminal generation result.

        Args:
            document_id: Document request identifier in the NestJS API.
            payload: READY, BLOCKED, or FAILED callback payload.

        Raises:
            requests.RequestException: If the callback cannot be delivered.
        """
        url = f"http://localhost:3000/internal/document-requests/{document_id}"

        logger.info("SUBMITTING_GAP_ANALYSIS_CALLBACK", document_id=document_id, status=payload.get("status"))
        try:
            # We use patch as specified in the business rules
            response = requests.patch(url, json=payload, timeout=10)
            response.raise_for_status()
            logger.info("GAP_ANALYSIS_CALLBACK_SUCCESS")
        except requests.RequestException as e:
            logger.error("GAP_ANALYSIS_CALLBACK_FAILED", error=str(e))
            raise
