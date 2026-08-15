"""MW-scan-py-004: Evidence Report Assembly and Callback tests."""

from __future__ import annotations

from dataclasses import asdict

import pytest

from lcsp_workers.platform.callback_schemas import SCAN_CALLBACK_STATUSES
from lcsp_workers.scanner.evidence_assembler import (
    EvidenceAssembler,
    PrivacyAssertionError,
)
from lcsp_workers.scanner.inventory.language_types import (
    LANGUAGE_PYTHON,
    SUPPORT_FULL,
    LanguageClassification,
)
from lcsp_workers.scanner.tool_registry import ToolRegistry
from lcsp_workers.scanner.toolchain_execution import ToolchainExecutionPlanner
from lcsp_workers.scanner.analyzers.ai_invocation_detector import TechnicalFinding
from lcsp_workers.scanner.ts_js_bridge.bridge_types import TsJsBridgeResult, TsJsFinding
from lcsp_workers.scanner.tools.semgrep_tool import SemgrepFinding, SemgrepRunResult
from lcsp_workers.scanner.tools.syft_tool import SBOMEntry, SyftRunResult
from lcsp_workers.scanner.tools.tool_base import (
    OUTCOME_SKIPPED_UNSUPPORTED,
    OUTCOME_SUCCESS,
    OUTCOME_TOOL_FAILURE,
    ToolExecutionResult,
)
from lcsp_workers.scanner.graph.graph_builder import EvidenceGraphBuilder


def _syft_result(outcome: str = OUTCOME_SUCCESS) -> SyftRunResult:
    return SyftRunResult(
        entries=[
            SBOMEntry(
                name="openai",
                version="1.59.3",
                ecosystem="pypi",
                location="requirements.txt",
                purl="pkg:pypi/openai@1.59.3",
                license="Apache-2.0",
            )
        ]
        if outcome == OUTCOME_SUCCESS
        else [],
        execution=ToolExecutionResult(
            tool_name="syft",
            tool_version="syft v1.0.0",
            outcome=outcome,
            config_hash="sha256:syft",
            messages=[] if outcome == OUTCOME_SUCCESS else ["syft failed safely"],
        ),
    )


def _semgrep_result(outcome: str = OUTCOME_SUCCESS) -> SemgrepRunResult:
    return SemgrepRunResult(
        findings=[
            SemgrepFinding(
                rule_id="lcsp.openai-client",
                signal_type="provider_integration",
                file_path="src/app.py",
                line_start=3,
                line_end=3,
                message="OpenAI client import detected",
                severity="INFO",
            )
        ]
        if outcome == OUTCOME_SUCCESS
        else [],
        executions=[
            ToolExecutionResult(
                tool_name="semgrep_ai_usage",
                tool_version="semgrep 1.99.0",
                outcome=outcome,
                config_hash="sha256:semgrep-ai",
                messages=[] if outcome == OUTCOME_SUCCESS else ["semgrep failed safely"],
            ),
            ToolExecutionResult(
                tool_name="semgrep_secret_detect",
                tool_version="semgrep 1.99.0",
                outcome=outcome,
                config_hash="sha256:semgrep-secret",
                messages=[] if outcome == OUTCOME_SUCCESS else ["semgrep failed safely"],
            ),
        ],
        redaction_applied=outcome != OUTCOME_SUCCESS,
    )


def _ts_js_result() -> TsJsBridgeResult:
    return TsJsBridgeResult(
        files_analyzed=1,
        files_skipped=0,
        findings=[
            TsJsFinding(
                file_path="src/ai.ts",
                line_number=3,
                finding_type="AI_PROVIDER_USAGE",
                rule_id="ts-openai-chat-completions",
                import_source="openai",
                call_expression="client.chat.completions.create",
                kwarg_names=["model", "messages"],
                analysis_level="L1",
                has_dynamic_call=False,
                confidence=0.9,
            )
        ],
        unsupported_dynamic_flows=[],
        coverage_limitations=[],
        analyzer_version="1.0.0",
        execution=ToolExecutionResult(
            tool_name="ts_js_analyzer",
            tool_version="1.0.0",
            outcome=OUTCOME_SUCCESS,
            config_hash="sha256:ts-js",
            messages=[],
        ),
    )


@pytest.mark.p0
def test_t01_assembles_full_evidence_payload() -> None:
    payload = EvidenceAssembler().assemble(
        scan_job_id="scan-job-1",
        syft_result=_syft_result(),
        semgrep_result=_semgrep_result(),
        coverage_notes=["Workspace skipped 1 oversize file"],
    )

    assert payload.scan_job_id == "scan-job-1"
    assert payload.status == SCAN_CALLBACK_STATUSES["success"]
    assert payload.tools_version == {
        "syft": "syft v1.0.0",
        "semgrep_ai_usage": "semgrep 1.99.0",
        "semgrep_secret_detect": "semgrep 1.99.0",
    }
    assert payload.config_hash["syft"] == "sha256:syft"
    assert payload.privacy_flags == {
        "containsSourceCode": False,
        "secretsRedacted": True,
        "sourceStrippedFromFindings": True,
    }
    assert payload.evidence_payload["sbom_entries"] == [asdict(_syft_result().entries[0])]
    assert payload.evidence_payload["ai_usage_signals"] == [
        asdict(_semgrep_result().findings[0])
    ]
    assert payload.evidence_payload["coverage_notes"] == [
        "Workspace skipped 1 oversize file"
    ]
    assert payload.evidence_payload["report_provenance"]["hash_algorithm"] == "SHA-256"
    assert payload.evidence_payload["report_provenance"]["report_hash"].startswith(
        "sha256:"
    )


@pytest.mark.p0
def test_t01b_report_hash_is_deterministic_for_the_same_safe_artifact() -> None:
    first = EvidenceAssembler().assemble(
        scan_job_id="scan-job-1",
        syft_result=_syft_result(),
        semgrep_result=_semgrep_result(),
        coverage_notes=[],
    )
    second = EvidenceAssembler().assemble(
        scan_job_id="scan-job-1",
        syft_result=_syft_result(),
        semgrep_result=_semgrep_result(),
        coverage_notes=[],
    )

    assert (
        first.evidence_payload["report_provenance"]["report_hash"]
        == second.evidence_payload["report_provenance"]["report_hash"]
    )


@pytest.mark.p0
def test_t02_one_tool_failure_is_recorded_and_callback_payload_is_partial() -> None:
    payload = EvidenceAssembler().assemble(
        scan_job_id="scan-job-1",
        syft_result=_syft_result(outcome=OUTCOME_TOOL_FAILURE),
        semgrep_result=_semgrep_result(),
        coverage_notes=[],
    )

    assert payload.status == SCAN_CALLBACK_STATUSES["partial"]
    assert payload.evidence_payload["tool_failures"] == [
        {
            "tool_name": "syft",
            "tool_version": "syft v1.0.0",
            "outcome": "tool_failure",
            "messages": ["syft failed safely"],
        }
    ]


@pytest.mark.p0
def test_t03_all_tools_fail_still_assembles_failed_callback_payload() -> None:
    payload = EvidenceAssembler().assemble(
        scan_job_id="scan-job-1",
        syft_result=_syft_result(outcome=OUTCOME_TOOL_FAILURE),
        semgrep_result=_semgrep_result(outcome=OUTCOME_TOOL_FAILURE),
        coverage_notes=[],
    )

    assert payload.status == SCAN_CALLBACK_STATUSES["failed"]
    assert payload.error_code == "ALL_TOOLS_FAILED"
    assert payload.evidence_payload["sbom_entries"] == []
    assert payload.evidence_payload["ai_usage_signals"] == []
    assert len(payload.evidence_payload["tool_failures"]) == 3


@pytest.mark.p0
def test_t04_privacy_assertion_blocks_source_code_payload() -> None:
    semgrep_result = SemgrepRunResult(
        findings=[
            SemgrepFinding(
                rule_id="lcsp.model-call",
                signal_type="model_call",
                file_path="src/app.py",
                line_start=1,
                line_end=3,
                message="def call_model():\n    return client.chat.completions.create()",
                severity="INFO",
            )
        ],
        executions=_semgrep_result().executions,
        redaction_applied=False,
    )

    with pytest.raises(PrivacyAssertionError) as exc_info:
        EvidenceAssembler().assemble(
            scan_job_id="scan-job-1",
            syft_result=_syft_result(),
            semgrep_result=semgrep_result,
            coverage_notes=[],
        )

    assert exc_info.value.error_code == "PRIVACY_ASSERTION_FAILED"


@pytest.mark.p0
@pytest.mark.parametrize(
    "unsafe_payload",
    [
        {"nested": {"prompt": "do not persist"}},
        {"nested": {"ast_body": "Module(...)"}},
        {"nested": {"api_key": "example"}},
        {"nested": {"message": "Bearer abcdefghijklmnopqrstuvwxyz"}},
        {"nested": {"message": "def call_model():\n    return client.run()"}},
    ],
)
def test_t05_privacy_gate_rejects_nested_forbidden_payloads(
    unsafe_payload: dict,
) -> None:
    with pytest.raises(PrivacyAssertionError):
        EvidenceAssembler().assemble(
            scan_job_id="scan-job-1",
            syft_result=_syft_result(),
            semgrep_result=_semgrep_result(),
            coverage_notes=[],
            targeted_reanalysis=unsafe_payload,
        )


@pytest.mark.p0
def test_t06_final_payload_redacts_secret_patterns_without_redacting_config_hash() -> None:
    semgrep_result = SemgrepRunResult(
        findings=[
            SemgrepFinding(
                rule_id="lcsp.llm-api-key-ref",
                signal_type="provider_integration",
                file_path="src/app.py",
                line_start=1,
                line_end=1,
                message="OpenAI api_key=sk-ant-secretvalue1234567890",
                severity="WARNING",
            )
        ],
        executions=_semgrep_result().executions,
        redaction_applied=True,
    )

    payload = EvidenceAssembler().assemble(
        scan_job_id="scan-job-1",
        syft_result=_syft_result(),
        semgrep_result=semgrep_result,
        coverage_notes=[],
    )

    assert payload.config_hash["semgrep_ai_usage"] == "sha256:semgrep-ai"
    finding = payload.evidence_payload["ai_usage_signals"][0]
    assert finding["message"] == "OpenAI api_key=[REDACTED:ANTHROPIC_KEY]"


@pytest.mark.p0
def test_t07_assembles_ts_js_analysis_and_tool_provenance() -> None:
    payload = EvidenceAssembler().assemble(
        scan_job_id="scan-job-1",
        syft_result=_syft_result(),
        semgrep_result=_semgrep_result(),
        coverage_notes=[],
        ts_js_analysis=_ts_js_result(),
    )

    assert payload.tools_version["ts_js_analyzer"] == "1.0.0"
    assert payload.config_hash["ts_js_analyzer"] == "sha256:ts-js"
    ts_js_analysis = payload.evidence_payload["ts_js_analysis"]
    assert ts_js_analysis["findings"][0]["rule_id"] == "ts-openai-chat-completions"
    assert "source_code" not in str(ts_js_analysis)


@pytest.mark.p0
def test_t08_assembles_technical_findings_without_source_content() -> None:
    technical_finding = TechnicalFinding(
        finding_id="finding-1",
        finding_type="AI_PROVIDER_USAGE",
        file_path="src/app.py",
        line_number=3,
        rule_ids=["lcsp-openai-chat-completions-py"],
        source_tools=["semgrep"],
        analysis_level="L1",
        confidence=0.35,
        confidence_components={
            "base": 0.35,
            "direct_evidence_bonus": 0.0,
            "corroboration_bonus": 0.0,
            "coverage_penalty": 0.0,
            "ambiguity_penalty": 0.0,
        },
        library_group="openai",
        kwarg_names=["messages"],
        has_dynamic_call=False,
        coverage_note=None,
    )

    payload = EvidenceAssembler().assemble(
        scan_job_id="scan-job-1",
        syft_result=_syft_result(),
        semgrep_result=_semgrep_result(),
        coverage_notes=[],
        technical_findings=[technical_finding],
    )

    assert payload.evidence_payload["technical_findings"][0]["finding_type"] == "AI_PROVIDER_USAGE"
    assert "source_code" not in str(payload.evidence_payload["technical_findings"])


@pytest.mark.p0
def test_t09_serializes_sanitized_versioned_evidence_graph() -> None:
    builder = EvidenceGraphBuilder(scan_job_id="scan-job-1", tool_version="graph-1")
    builder.add_node("FILE", "src/app.py", "src/app.py", evidence_refs=["evidence:finding-1"])
    payload = EvidenceAssembler().assemble(
        scan_job_id="scan-job-1", syft_result=_syft_result(), semgrep_result=_semgrep_result(),
        coverage_notes=[], evidence_graph=builder.build_scan_graph(),
    )
    graph = payload.evidence_payload["evidence_graph"]
    assert graph["schema_version"] == "1.0.0"
    assert graph["graph_hash"].startswith("sha256:")
    assert graph["nodes"][0]["evidence_refs"] == ["evidence:finding-1"]


@pytest.mark.p0
def test_t09b_assembles_complete_tool_run_provenance() -> None:
    profile = ToolchainExecutionPlanner().build(
        [
            LanguageClassification(
                file_path="src/app.py",
                language=LANGUAGE_PYTHON,
                support_level=SUPPORT_FULL,
                file_size_bytes=10,
                line_count=1,
                skip_reason=None,
                coverage_limitation=False,
            )
        ]
    ).language_profile
    registry = ToolRegistry()
    syft_result = _syft_result()
    registry.register(
        syft_result.execution,
        ruleset_hash="sha256:not-applicable",
        started_at="2026-08-11T06:00:00Z",
        ended_at="2026-08-11T06:00:01Z",
        language_profile=profile,
        coverage_limitations=[],
    )

    payload = EvidenceAssembler().assemble(
        scan_job_id="scan-job-1",
        syft_result=syft_result,
        semgrep_result=_semgrep_result(),
        coverage_notes=[],
        tool_provenance=registry.all(),
    )

    provenance = payload.evidence_payload["tool_provenance"][0]
    assert provenance["tool_name"] == "syft"
    assert provenance["ruleset_hash"] == "sha256:not-applicable"
    assert provenance["started_at"] == "2026-08-11T06:00:00Z"
    assert provenance["ended_at"] == "2026-08-11T06:00:01Z"
    assert provenance["language_profile"]["languages"] == (LANGUAGE_PYTHON,)


@pytest.mark.p0
def test_t10_unsupported_skip_yields_success_and_empty_tool_failures() -> None:
    """OUTCOME_SKIPPED_UNSUPPORTED is expected behaviour for language-profile-filtered
    tools (e.g. knip on a Python-only repo).  It must not inflate failure counts or
    appear in tool_failures — a repo whose non-applicable tools are all skipped should
    receive a success callback, not partial/failed."""
    semgrep_result = SemgrepRunResult(
        findings=[],
        executions=[
            ToolExecutionResult(
                tool_name="semgrep",
                tool_version="not-run",
                outcome=OUTCOME_SKIPPED_UNSUPPORTED,
                config_hash="sha256:not-executed",
                messages=["semgrep: unsupported_for_language_profile"],
            )
        ],
        redaction_applied=False,
    )

    payload = EvidenceAssembler().assemble(
        scan_job_id="scan-job-1",
        syft_result=_syft_result(),
        semgrep_result=semgrep_result,
        coverage_notes=[
            "SCAN_COVERAGE_LIMITATION: file=<tool:semgrep> "
            "reason=unsupported_for_language_profile"
        ],
    )

    # Skipped tools are not failures — status must be success
    assert payload.status == SCAN_CALLBACK_STATUSES["success"]
    assert payload.error_code is None
    # Skipped tools must not appear in tool_failures
    assert payload.evidence_payload["tool_failures"] == []


@pytest.mark.p0
def test_t11_failed_tool_without_messages_gets_default_failure_limitation() -> None:
    payload = EvidenceAssembler().assemble(
        scan_job_id="scan-job-1",
        syft_result=_syft_result(),
        semgrep_result=SemgrepRunResult(
            findings=[],
            executions=[
                ToolExecutionResult(
                    tool_name="semgrep_ai_usage",
                    tool_version="semgrep 1.99.0",
                    outcome=OUTCOME_TOOL_FAILURE,
                    config_hash="sha256:semgrep-ai",
                    messages=[],
                )
            ],
            redaction_applied=False,
        ),
        coverage_notes=[],
    )

    assert payload.status == SCAN_CALLBACK_STATUSES["partial"]
    assert payload.evidence_payload["tool_failures"] == [
        {
            "tool_name": "semgrep_ai_usage",
            "tool_version": "semgrep 1.99.0",
            "outcome": OUTCOME_TOOL_FAILURE,
            "messages": [
                "semgrep_ai_usage: tool_failure without diagnostic messages"
            ],
        }
    ]
