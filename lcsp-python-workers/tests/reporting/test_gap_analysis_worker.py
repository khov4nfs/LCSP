from unittest.mock import MagicMock, patch

from lcsp_workers.dossiers.models import Dossier, DossierSourceArtifacts
from lcsp_workers.reporting.gap_analysis_consumer import GapAnalysisConsumer
from lcsp_workers.reporting.gap_analysis_generator import GapAnalysisGenerator
from lcsp_workers.reporting.output_guardrail import OutputGuardrail


def _context() -> dict:
    return {
        "document_request": {
            "id": "doc123",
            "assessment_id": "assessment-1",
            "organization_id": "org-1",
            "classification_result_id": "classification-1",
            "document_type": "GAP_ANALYSIS",
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
        "legal_rule_match": {"matches": []},
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
                "human_control_evidence": {},
            },
            "unresolvedEvidence": ["dynamic provider target"],
            "remediation": [],
        },
        missing_requirements=("gaps", "remediation"),
        provenance={"contentHash": "sha256:abc"},
    )


def _consumer():
    document_client = MagicMock()
    document_client.get_generation_context.return_value = _context()
    dossier_builder = MagicMock()
    dossier_builder.build.return_value = _dossier()
    return (
        GapAnalysisConsumer(
            config=MagicMock(),
            document_client=document_client,
            dossier_builder=dossier_builder,
        ),
        document_client,
    )


def test_t01_valid_result_ready():
    consumer, document_client = _consumer()
    with patch(
        "lcsp_workers.reporting.gap_analysis_consumer.StorageUploader.upload_document",
        return_value="https://url",
    ):
        consumer.handle({"documentRequestId": "doc123"}, "corr-id")
    document_client.get_generation_context.assert_called_once_with("doc123")
    document_client.post_document_callback.assert_called_once_with(
        "doc123", status="READY", document_url="https://url"
    )


def test_t02_content_contains_certified():
    assert OutputGuardrail.check("This is certified.") is True
    consumer, document_client = _consumer()
    with patch(
        "lcsp_workers.reporting.gap_analysis_consumer.GapAnalysisGenerator.generate",
        return_value="We are certified.",
    ):
        consumer.handle({"documentRequestId": "doc123"}, "corr-id")
    kwargs = document_client.post_document_callback.call_args.kwargs
    assert kwargs["status"] == "BLOCKED"
    assert kwargs["error_code"] == "GAP_ANALYSIS_OVERCLAIM_BLOCKED"


def test_t03_no_raw_source_code():
    content = GapAnalysisGenerator.generate("Name", "Ctx", ["ev1"], [], [], [], [])
    assert "class " not in content
    assert "def " not in content


def test_t04_upload_fails_with_safe_reason():
    consumer, document_client = _consumer()
    with patch(
        "lcsp_workers.reporting.gap_analysis_consumer.StorageUploader.upload_document",
        side_effect=Exception("S3 secret internal detail"),
    ):
        consumer.handle({"documentRequestId": "doc123"}, "corr-id")
    kwargs = document_client.post_document_callback.call_args.kwargs
    assert kwargs["status"] == "FAILED"
    assert kwargs["error_code"] == "GAP_ANALYSIS_UPLOAD_FAILED"
    assert "S3 secret internal detail" not in kwargs["blocked_reason"]


def test_t05_title_inspection():
    content = GapAnalysisGenerator.generate("Name", "Ctx", [], [], [], [], [])
    lines = content.split("\n")
    assert "Title: Gap Analysis" in lines[0]
    assert "Label: Wizard Readiness and Legal Gap Analysis" in lines[1]
    assert "certified" not in lines[0].lower()
    assert "compliant" not in lines[1].lower()


def test_t06_no_llm_calls():
    import inspect

    sig = inspect.signature(GapAnalysisGenerator.generate)
    assert "llm_client" not in sig.parameters


def test_t07_context_guardrail_failure_stops_generation():
    consumer, document_client = _consumer()
    context = _context()
    context["classification_result"]["guardrail_status"] = "BLOCKED"
    document_client.get_generation_context.return_value = context
    with patch(
        "lcsp_workers.reporting.gap_analysis_consumer.GapAnalysisGenerator.generate"
    ) as generate:
        consumer.handle({"documentRequestId": "doc123"}, "corr-id")
    generate.assert_not_called()
    kwargs = document_client.post_document_callback.call_args.kwargs
    assert kwargs["status"] == "FAILED"
    assert kwargs["error_code"] == "DOCUMENT_GENERATION_CONTEXT_INVALID"
