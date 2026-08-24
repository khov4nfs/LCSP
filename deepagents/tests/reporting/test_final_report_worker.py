from unittest.mock import MagicMock, patch

from tools.reports.reporting.final_report_boundary import FinalReportBoundary
from tools.reports.reporting.final_report_generator import FinalReportGenerator


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
            "classification_data": {
                "mode": "ENGINEERING_RULE_EVALUATION",
                "summary": {
                    "compliant": 1,
                    "non_compliant": 0,
                    "unknown": 1,
                    "total": 2,
                },
                "legal_rule_catalog_version_id": "catalog-1",
                "legal_corpus_version_id": "corpus-1",
                "evaluations": [
                    {
                        "engineering_rule_id": "eng-pass",
                        "legal_rule_id": "legal-pass",
                        "concept": "INCIDENT_LOGGING",
                        "status": "COMPLIANT",
                        "reason": "Required engineering control is evidenced.",
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


def _boundary(llm=None):
    llm = llm or MagicMock()
    llm.complete.return_value = MagicMock(content="Summary of system.")
    document_client = MagicMock()
    document_client.get_generation_context.return_value = _context()
    return (
        FinalReportBoundary(
            config=MagicMock(),
            llm_client=llm,
            document_client=document_client,
        ),
        document_client,
    )


def test_t01_authoritative_context_generates_ready_report():
    boundary, document_client = _boundary()
    with patch(
        "tools.reports.reporting.final_report_boundary.StorageUploader.upload_document",
        return_value="https://url",
    ):
        boundary.handle({"documentRequestId": "doc123"}, "corr-id")
    document_client.get_generation_context.assert_called_once_with("doc123")
    document_client.post_document_callback.assert_called_once_with(
        "doc123", status="READY", document_url="https://url"
    )


def test_t02_report_contains_certified_is_blocked():
    boundary, document_client = _boundary()
    with patch(
        "tools.reports.reporting.final_report_boundary.FinalReportGenerator.generate",
        return_value="The system is certified.",
    ):
        boundary.handle({"documentRequestId": "doc123"}, "corr-id")
    kwargs = document_client.post_document_callback.call_args.kwargs
    assert kwargs["status"] == "BLOCKED"
    assert kwargs["error_code"] == "FINAL_REPORT_OVERCLAIM_BLOCKED"


def test_t03_llm_failure_returns_safe_reason_without_exception_text():
    llm = MagicMock()
    llm.complete.side_effect = RuntimeError("secret internal provider detail")
    boundary, document_client = _boundary(llm)
    boundary.handle({"documentRequestId": "doc123"}, "corr-id")
    kwargs = document_client.post_document_callback.call_args.kwargs
    assert kwargs["status"] == "FAILED"
    assert kwargs["error_code"] == "FINAL_REPORT_GENERATION_FAILED"
    assert "secret internal provider detail" not in kwargs["blocked_reason"]


def test_t04_generation_context_guardrail_blocks_before_llm():
    llm = MagicMock()
    boundary, document_client = _boundary(llm)
    context = _context()
    context["classification_result"]["guardrail_status"] = "BLOCKED"
    document_client.get_generation_context.return_value = context
    boundary.handle({"documentRequestId": "doc123"}, "corr-id")
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
        rule_evaluations=["engineering-rule-result"],
        citations=["chunk-1::art-2", "chunk-5::art-9"],
        limitations="",
        evidence_provenance="",
    )
    assert "chunk-1::art-2" in content
    assert "chunk-5::art-9" in content
    assert "engineering-rule-result" in content


def test_t06_planner_audit_metadata_is_not_sent_to_final_report_prompt():
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
            "tools.reports.reporting.final_report_boundary.FinalReportGenerator.generate",
            return_value="Final report.",
        ) as generate,
        patch(
            "tools.reports.reporting.final_report_boundary.StorageUploader.upload_document",
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
