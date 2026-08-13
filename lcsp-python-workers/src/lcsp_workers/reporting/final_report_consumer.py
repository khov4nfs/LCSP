import requests
from lcsp_workers.platform.queue_consumer import ConsumerBase
from lcsp_workers.platform.logging import get_logger
from lcsp_workers.llm.gateway_client import LLMGatewayClient

from .final_report_generator import FinalReportGenerator
from .output_guardrail import OutputGuardrail
from .storage_uploader import StorageUploader

logger = get_logger(__name__)

class FinalReportConsumer(ConsumerBase):
    queue_name = "reporting.document-final-report-requested"
    routing_key = "document.final-report-requested"
    requires_pbac = False

    def __init__(self, config, llm_client: LLMGatewayClient = None):
        super().__init__(config)
        if llm_client is None:
            raise ValueError(
                "FinalReportConsumer requires an injected llm_client from runtime configuration."
            )
        self.llm_client = llm_client
        self.generator = FinalReportGenerator(self.llm_client)

    def handle(self, message: dict, correlation_id: str) -> None:
        """
        Handle document.final-report-requested event.
        """
        logger.info("PROCESSING_FINAL_REPORT_REQUEST", correlation_id=correlation_id)
        
        document_id = message.get("document_id", "unknown-doc-id")
        guardrail_status = message.get("guardrailStatus", "unknown")
        
        # 1. Verify guardrailStatus = passed
        if guardrail_status != "passed":
            logger.warning("FINAL_REPORT_BLOCKED_GUARDRAIL", document_id=document_id, status=guardrail_status)
            self._submit_callback(document_id, {
                "status": "BLOCKED",
                "blocked_reason": f"ClassificationResult guardrailStatus was not passed: {guardrail_status}"
            })
            return
            
        assessment_name = message.get("assessment_name", "Unknown Assessment")
        assessment_context = message.get("assessment_context", "")
        technical_evidence = message.get("technical_evidence", [])
        verified_ai_usage = message.get("verified_ai_usage", [])
        legal_rule_applicability = message.get("legal_rule_applicability", [])
        citations = message.get("citations", [])
        limitations = message.get("limitations", "No known limitations.")
        evidence_provenance = message.get("evidence_provenance", "Audit Trail: Complete")
        
        # 2. Generate Document (Markdown with LLM Executive Summary)
        try:
            content = self.generator.generate(
                assessment_name=assessment_name,
                assessment_context=assessment_context,
                technical_evidence=technical_evidence,
                verified_ai_usage=verified_ai_usage,
                legal_rule_applicability=legal_rule_applicability,
                citations=citations,
                limitations=limitations,
                evidence_provenance=evidence_provenance
            )
        except Exception as e:
            # Catch PromptSafetyViolation, BudgetExceeded, etc.
            logger.error("FINAL_REPORT_GENERATION_FAILED", document_id=document_id, error=str(e))
            self._submit_callback(document_id, {
                "status": "FAILED",
                "blocked_reason": f"LLM Generation Error: {str(e)}"
            })
            return
        
        # 3. Output Guardrail Check
        has_overclaim = OutputGuardrail.check(content)
        
        if has_overclaim:
            logger.warning("FINAL_REPORT_GUARDRAIL_BLOCKED", document_id=document_id)
            self._submit_callback(document_id, {
                "status": "BLOCKED",
                "blocked_reason": "Output guardrail blocked due to overclaiming terminology."
            })
            return
            
        # 4. Upload to Object Storage
        try:
            document_url = StorageUploader.upload_document(document_id, content)
            
            # 5. Submit Callback to API
            self._submit_callback(document_id, {
                "status": "READY",
                "document_url": document_url
            })
        except Exception as e:
            logger.error("FINAL_REPORT_UPLOAD_FAILED", document_id=document_id, error=str(e))
            self._submit_callback(document_id, {
                "status": "FAILED",
                "blocked_reason": f"Upload failed: {str(e)}"
            })

    def _submit_callback(self, document_id: str, payload: dict) -> None:
        """
        Submit results to NestJS API callback using PATCH /internal/document-requests/:id.
        """
        url = f"http://localhost:3000/internal/document-requests/{document_id}"
        
        logger.info("SUBMITTING_FINAL_REPORT_CALLBACK", document_id=document_id, status=payload.get("status"))
        try:
            response = requests.patch(url, json=payload, timeout=10)
            response.raise_for_status()
            logger.info("FINAL_REPORT_CALLBACK_SUCCESS")
        except requests.RequestException as e:
            logger.error("FINAL_REPORT_CALLBACK_FAILED", error=str(e))
            raise
