from unittest.mock import MagicMock, patch

from tools.common.capabilities.reporting.gap.gap_analysis_boundary import GapAnalysisBoundary
from tools.common.capabilities.reporting.gap.gap_analysis_generator import GapAnalysisGenerator
from tools.common.capabilities.reporting.report.final_report.output_guardrail import OutputGuardrail


def _context() -> dict:
    return {
        "document_request": {
            "id": "doc123",
            "assessment_id": "assessment-1",
            "classification_result_id": "classification-1",
            "document_type": "GAP_ANALYSIS",
        },
        "assessment": {"id": "assessment-1", "name": "Test Assessment"},
        "classification_result": {
            "id": "classification-1",
            "guardrail_status": "PASSED",
            "classification_data": {
                "mode": "ENGINEERING_RULE_EVALUATION",
                "summary": {
                    "compliant": 0,
                    "non_compliant": 1,
                    "unknown": 1,
                    "total": 2,
                },
                "legal_rule_catalog_version_id": "catalog-1",
                "legal_corpus_version_id": "corpus-1",
                "evaluations": [
                    {
                        "engineering_rule_id": "eng-fail",
                        "legal_rule_id": "legal-fail",
                        "concept": "HUMAN_REVIEW",
                        "status": "NON_COMPLIANT",
                        "reason": "Required engineering control is not evidenced.",
                        "evidence_refs": ["graph:path:1"],
                        "source_chunk_ids": ["LAW:A1"],
                        "source_locators": ["art-1::cl-1"],
                        "limitations": [],
                    },
                    {
                        "engineering_rule_id": "eng-unknown",
                        "legal_rule_id": "legal-unknown",
                        "concept": "DYNAMIC_PROVIDER",
                        "status": "UNKNOWN",
                        "reason": "Dynamic path cannot be resolved statically.",
                        "evidence_refs": [],
                        "source_chunk_ids": ["LAW:A2"],
                        "source_locators": ["art-2::cl-1"],
                        "limitations": ["DYNAMIC_PATH_UNRESOLVED"],
                    },
                ],
                "limitations": ["SCAN_COVERAGE_PARTIAL"],
            },
        },
        "technical_evidence_report": {
            "id": "evidence-1",
            "snapshot_id": "snapshot-1",
        },
        "repository_snapshot": {
            "id": "snapshot-1",
            "commit_sha": "abc123",
        },
    }


def _boundary():
    document_client = MagicMock()
    document_client.get_generation_context.return_value = _context()
    return (
        GapAnalysisBoundary(
            config=MagicMock(),
            document_client=document_client,
        ),
        document_client,
    )


def test_t01_valid_result_ready():
    boundary, document_client = _boundary()
    with patch(
        "tools.common.capabilities.reporting.gap.gap_analysis_boundary.StorageUploader.upload_document",
        return_value="https://url",
    ):
        boundary.handle({"documentRequestId": "doc123"}, "corr-id")
    document_client.get_generation_context.assert_called_once_with("doc123")
    document_client.post_document_callback.assert_called_once_with(
        "doc123", status="READY", document_url="https://url"
    )


def test_t02_content_contains_certified():
    assert OutputGuardrail.check("This is certified.") is True
    boundary, document_client = _boundary()
    with patch(
        "tools.common.capabilities.reporting.gap.gap_analysis_boundary.GapAnalysisGenerator.generate",
        return_value="We are certified.",
    ):
        boundary.handle({"documentRequestId": "doc123"}, "corr-id")
    kwargs = document_client.post_document_callback.call_args.kwargs
    assert kwargs["status"] == "BLOCKED"
    assert kwargs["error_code"] == "GAP_ANALYSIS_OVERCLAIM_BLOCKED"


def test_t03_no_raw_source_code():
    content = GapAnalysisGenerator.generate(
        "Name",
        "Ctx",
        ["ev1"],
        ["engineering-rule-result"],
        ["missing-evidence"],
        ["recommendation"],
    )
    assert "class " not in content
    assert "def " not in content


def test_t04_upload_fails_with_safe_reason():
    boundary, document_client = _boundary()
    with patch(
        "tools.common.capabilities.reporting.gap.gap_analysis_boundary.StorageUploader.upload_document",
        side_effect=Exception("S3 secret internal detail"),
    ):
        boundary.handle({"documentRequestId": "doc123"}, "corr-id")
    kwargs = document_client.post_document_callback.call_args.kwargs
    assert kwargs["status"] == "FAILED"
    assert kwargs["error_code"] == "GAP_ANALYSIS_UPLOAD_FAILED"
    assert "S3 secret internal detail" not in kwargs["blocked_reason"]


def test_t05_title_inspection():
    content = GapAnalysisGenerator.generate("Name", "Ctx", [], [], [], [])
    lines = content.split("\n")
    assert lines[0] == "# Gap Analysis — Name"
    assert lines[1] == "**Basis: Program Evidence Graph + EngineeringRule evaluation**"
    assert "certified" not in lines[0].lower()
    assert "legally compliant" not in lines[1].lower()


def test_t06_no_llm_calls():
    import inspect

    sig = inspect.signature(GapAnalysisGenerator.generate)
    assert "llm_client" not in sig.parameters


def test_t07_context_guardrail_failure_stops_generation():
    boundary, document_client = _boundary()
    context = _context()
    context["classification_result"]["guardrail_status"] = "BLOCKED"
    document_client.get_generation_context.return_value = context
    with patch(
        "tools.common.capabilities.reporting.gap.gap_analysis_boundary.GapAnalysisGenerator.generate"
    ) as generate:
        boundary.handle({"documentRequestId": "doc123"}, "corr-id")
    generate.assert_not_called()
    kwargs = document_client.post_document_callback.call_args.kwargs
    assert kwargs["status"] == "FAILED"
    assert kwargs["error_code"] == "DOCUMENT_GENERATION_CONTEXT_INVALID"


def test_t08_planner_audit_metadata_is_not_sent_to_gap_prompt():
    boundary, document_client = _boundary()
    context = _context()
    data = context["classification_result"]["classification_data"]
    data["planner"] = {"authority": "TECHNICAL_INVESTIGATION_SCOPE_ONLY"}
    data["planner_decisions"] = [
        {
            "engineering_rule_id": "eng-skipped",
            "final_decision": "SKIP",
            "reason_code": "NO_SCOPE_SIGNAL",
        }
    ]
    data["evaluations"][0]["planner_decision"] = {"final_decision": "SELECT"}
    document_client.get_generation_context.return_value = context

    with (
        patch(
            "tools.common.capabilities.reporting.gap.gap_analysis_boundary.GapAnalysisGenerator.generate",
            return_value="Gap content.",
        ) as generate,
        patch(
            "tools.common.capabilities.reporting.gap.gap_analysis_boundary.StorageUploader.upload_document",
            return_value="https://url",
        ),
    ):
        boundary.handle({"documentRequestId": "doc123"}, "corr-id")

    serialized_prompt_inputs = "\n".join(
        str(value)
        for value in generate.call_args.kwargs.values()
    )
    assert "planner_decisions" not in serialized_prompt_inputs
    assert "TECHNICAL_INVESTIGATION_SCOPE_ONLY" not in serialized_prompt_inputs
    assert "eng-skipped" not in serialized_prompt_inputs
    assert "planner_decision" not in serialized_prompt_inputs
