from unittest.mock import MagicMock, patch

from lcsp_workers.dossiers.models import Dossier, DossierSourceArtifacts
from lcsp_workers.reporting.final_report_consumer import FinalReportConsumer
from lcsp_workers.reporting.final_report_generator import FinalReportGenerator


def _context() -> dict:
    return {
        "document_request": {
            "id": "doc123",
            "assessment_id": "assessment-1",
            "organization_id": "org-1",
            "classification_result_id": "classification-1",
            "document_type": "FINAL_REPORT",
        },
        "assessment": {"id": "assessment-1", "name": "Test Assessment"},
        "classification_result": {
            "id": "classification-1",
            "guardrail_status": "PASSED",
        },
        "verified_profile": {
            "id": "verified-1",
            "profile_data": {"verified_claims": []},
        },
        "legal_rule_match": {
            "matches": [],
            "citation_allowlist": ["chunk-1::art-2"],
        },
    }


def _dossier() -> Dossier:
    sources = DossierSourceArtifacts(
        repository_snapshot_id="snapshot-1",
        program_evidence_graph_id="graph-1",
        technical_evidence_report_id="evidence-1",
        wizard_profile_id="wizard-1",
        verified_profile_id="verified-1",
        legal_corpus_version_id="corpus-1",
        legal_rule_catalog_version_id="catalog-1",
        classification_result_id="classification-1",
        gap_matrix_ref="matrix:classification-1",
    )
    return Dossier(
        dossier_id="dossier:1",
        dossier_type="AI_RISK_CLASSIFICATION",
        assessment_id="assessment-1",
        organization_id="org-1",
        version=1,
        status="INCOMPLETE",
        source_artifacts=sources,
        sections={
            "systemIdentity": {"assessmentId": "assessment-1"},
            "intendedUse": "assist staff",
            "technicalAiProfile": {
                "program_graph_ref": {"graphId": "graph-1"},
                "data_categories": [],
                "external_integrations": [],
                "business_actions": [],
                "human_control_evidence": {},
                "dependency_licenses": [],
            },
            "unresolvedEvidence": [],
        },
        missing_requirements=("gaps", "remediation"),
        provenance={"contentHash": "sha256:abc"},
    )


def _consumer(llm=None):
    llm = llm or MagicMock()
    llm.complete.return_value = MagicMock(content="Summary of system.")
    document_client = MagicMock()
    document_client.get_generation_context.return_value = _context()
    dossier_builder = MagicMock()
    dossier_builder.build.return_value = _dossier()
    return (
        FinalReportConsumer(
            config=MagicMock(),
            llm_client=llm,
            document_client=document_client,
            dossier_builder=dossier_builder,
        ),
        document_client,
    )


def test_t01_authoritative_context_generates_ready_report():
    consumer, document_client = _consumer()
    with patch(
        "lcsp_workers.reporting.final_report_consumer.StorageUploader.upload_document",
        return_value="https://url",
    ):
        consumer.handle({"documentRequestId": "doc123"}, "corr-id")
    document_client.get_generation_context.assert_called_once_with("doc123")
    document_client.post_document_callback.assert_called_once_with(
        "doc123", status="READY", document_url="https://url"
    )


def test_t02_report_contains_certified_is_blocked():
    consumer, document_client = _consumer()
    with patch(
        "lcsp_workers.reporting.final_report_consumer.FinalReportGenerator.generate",
        return_value="The system is certified.",
    ):
        consumer.handle({"documentRequestId": "doc123"}, "corr-id")
    kwargs = document_client.post_document_callback.call_args.kwargs
    assert kwargs["status"] == "BLOCKED"
    assert kwargs["error_code"] == "FINAL_REPORT_OVERCLAIM_BLOCKED"


def test_t03_llm_failure_returns_safe_reason_without_exception_text():
    llm = MagicMock()
    llm.complete.side_effect = RuntimeError("secret internal provider detail")
    consumer, document_client = _consumer(llm)
    consumer.handle({"documentRequestId": "doc123"}, "corr-id")
    kwargs = document_client.post_document_callback.call_args.kwargs
    assert kwargs["status"] == "FAILED"
    assert kwargs["error_code"] == "FINAL_REPORT_GENERATION_FAILED"
    assert "secret internal provider detail" not in kwargs["blocked_reason"]


def test_t04_generation_context_guardrail_blocks_before_llm():
    llm = MagicMock()
    consumer, document_client = _consumer(llm)
    context = _context()
    context["classification_result"]["guardrail_status"] = "BLOCKED"
    document_client.get_generation_context.return_value = context
    consumer.handle({"documentRequestId": "doc123"}, "corr-id")
    llm.complete.assert_not_called()
    kwargs = document_client.post_document_callback.call_args.kwargs
    assert kwargs["status"] == "FAILED"
    assert kwargs["error_code"] == "DOCUMENT_GENERATION_CONTEXT_INVALID"


def test_t05_citation_references():
    mock_llm = MagicMock()
    mock_llm.complete.return_value = MagicMock(content="Summary.")
    generator = FinalReportGenerator(mock_llm)
    content = generator.generate(
        assessment_name="Test",
        assessment_context="Ctx",
        technical_evidence=[],
        verified_ai_usage=[],
        legal_rule_applicability=[],
        citations=["chunk-1::art-2", "chunk-5::art-9"],
        limitations="",
        evidence_provenance="",
    )
    assert "chunk-1::art-2" in content
    assert "chunk-5::art-9" in content
