"""MW-scan-py-009: AI invocation detector signal fusion tests."""

from __future__ import annotations

from dataclasses import asdict

import pytest

from tools.graph.scanner.analyzers.python_analyzer import AiCallSite, PythonAnalysisResult
from tools.graph.scanner.dependencies.dependency_fact import (
    DependencyUsageFact,
    PackageDependency,
    USAGE_USED,
)
from tools.graph.scanner.tools.semgrep_tool import SemgrepFinding, SemgrepRunResult
from tools.graph.scanner.tools.syft_tool import SBOMEntry, SyftRunResult
from tools.graph.scanner.tools.tool_base import (
    OUTCOME_SUCCESS,
    OUTCOME_TOOL_FAILURE,
    ToolExecutionResult,
)
from tools.graph.scanner.ts_js_bridge.bridge_types import (
    TsJsBridgeResult,
    TsJsFinding,
    TsJsUnsupportedDynamicFlow,
)


def _python_analysis(*sites: AiCallSite, flows: list[dict] | None = None) -> PythonAnalysisResult:
    return PythonAnalysisResult(
        files_analyzed=1,
        files_skipped=0,
        ai_call_sites=list(sites),
        import_map={"openai": "openai"},
        unsupported_dynamic_flows=list(flows or []),
        coverage_limitation=False,
    )


def _python_site(
    *,
    finding_type: str = "AI_PROVIDER_USAGE",
    rule_id: str = "py-openai-chat-completions",
    line_number: int = 10,
    kwarg_names: list[str] | None = None,
    has_dynamic_call: bool = False,
    function_name: str = "create",
) -> AiCallSite:
    return AiCallSite(
        file_path="src/ai.py",
        line_number=line_number,
        function_name=function_name,
        module_alias="client",
        matched_rule_id=rule_id,
        finding_type=finding_type,
        analysis_level="L1",
        call_args_schema=[],
        has_dynamic_call=has_dynamic_call,
        kwarg_names=list(kwarg_names or ["messages"]),
        confidence=0.9,
        evidence=[
            {
                "file": "src/ai.py",
                "line": line_number,
                "rule_id": rule_id,
                "call": "client.chat.completions.create",
                "kwarg_names": list(kwarg_names or ["messages"]),
            }
        ],
    )


def _semgrep_result(*findings: SemgrepFinding) -> SemgrepRunResult:
    return SemgrepRunResult(
        findings=list(findings),
        executions=[
            ToolExecutionResult(
                tool_name="semgrep_ai_usage",
                tool_version="semgrep 1.99.0",
                outcome=OUTCOME_SUCCESS,
                config_hash="sha256:semgrep-ai",
                messages=[],
            )
        ],
        redaction_applied=False,
    )


def _semgrep_finding(
    *,
    rule_id: str = "lcsp-openai-chat-completions-py",
    finding_type: str = "AI_PROVIDER_USAGE",
    line_start: int = 10,
    library_group: str | None = "openai",
) -> SemgrepFinding:
    return SemgrepFinding(
        rule_id=rule_id,
        signal_type="provider_integration",
        file_path="src/ai.py",
        line_start=line_start,
        line_end=line_start,
        message="OpenAI chat completions API call",
        severity="WARNING",
        finding_type=finding_type,
        base_confidence=0.9,
        library_group=library_group,
    )


def _ts_result(
    *findings: TsJsFinding,
    flows: list[TsJsUnsupportedDynamicFlow] | None = None,
) -> TsJsBridgeResult:
    return TsJsBridgeResult(
        files_analyzed=1,
        files_skipped=0,
        findings=list(findings),
        unsupported_dynamic_flows=list(flows or []),
        coverage_limitations=[],
        analyzer_version="1.0.0",
        execution=ToolExecutionResult(
            tool_name="ts_js_analyzer",
            tool_version="1.0.0",
            outcome=OUTCOME_SUCCESS,
            config_hash="sha256:ts",
            messages=[],
        ),
    )


def _package_dependency(
    name: str = "openai",
    source_tool: str = "knip",
) -> PackageDependency:
    return PackageDependency(
        name=name,
        version="1.0.0",
        ecosystem="pypi",
        purl=f"pkg:pypi/{name}@1.0.0",
        usage_facts=[
            DependencyUsageFact(
                package_name=name,
                version="1.0.0",
                ecosystem="pypi",
                usage_state=USAGE_USED,
                source_tool=source_tool,
                file_refs=["src/ai.py"],
                is_ai_relevant=True,
            )
        ],
        confidence_boost=0.05,
        is_ai_relevant=True,
    )


def _syft_result(name: str = "openai") -> SyftRunResult:
    return SyftRunResult(
        entries=[
            SBOMEntry(
                name=name,
                version="1.0.0",
                ecosystem="pypi",
                location="requirements.txt",
                purl=f"pkg:pypi/{name}@1.0.0",
                license=None,
            )
        ],
        execution=ToolExecutionResult(
            tool_name="syft",
            tool_version="syft v1.0.0",
            outcome=OUTCOME_SUCCESS,
            config_hash="sha256:syft",
            messages=[],
        ),
    )


@pytest.mark.p0
def test_t01_fuses_semgrep_and_python_ast_with_direct_evidence() -> None:
    from tools.graph.scanner.analyzers.ai_invocation_detector import AIInvocationDetector

    result = AIInvocationDetector().detect(
        semgrep_result=_semgrep_result(_semgrep_finding()),
        python_analysis=_python_analysis(_python_site()),
    )

    provider = next(finding for finding in result if finding.finding_type == "AI_PROVIDER_USAGE")
    assert provider.file_path == "src/ai.py"
    assert provider.line_number == 10
    assert provider.source_tools == ["python_ast", "semgrep"]
    assert provider.confidence_components["base"] == 0.35
    assert provider.confidence_components["direct_evidence_bonus"] == 0.15
    assert provider.confidence == 0.50


@pytest.mark.p0
def test_t02_t03_sbom_and_dependency_usage_add_corroboration_bonus() -> None:
    from tools.graph.scanner.analyzers.ai_invocation_detector import AIInvocationDetector

    result = AIInvocationDetector().detect(
        semgrep_result=_semgrep_result(_semgrep_finding()),
        python_analysis=_python_analysis(_python_site()),
        syft_result=_syft_result(),
        package_dependencies=[_package_dependency(source_tool="knip")],
    )

    provider = next(finding for finding in result if finding.finding_type == "AI_PROVIDER_USAGE")
    assert provider.confidence_components["corroboration_bonus"] == 0.10
    assert provider.confidence == 0.60
    assert "sbom" in provider.source_tools
    assert "knip" in provider.source_tools


@pytest.mark.p0
def test_t04_dynamic_call_adds_ambiguity_penalty_and_l4_limitation() -> None:
    from tools.graph.scanner.analyzers.ai_invocation_detector import AIInvocationDetector

    result = AIInvocationDetector().detect(
        python_analysis=_python_analysis(
            _python_site(has_dynamic_call=True),
            flows=[{"file": "src/ai.py", "line": 10, "reason": "getattr dynamic call"}],
        )
    )

    provider = next(
        finding for finding in result if finding.finding_type == "AI_PROVIDER_USAGE"
    )
    dynamic = next(
        finding
        for finding in result
        if finding.finding_type == "UNSUPPORTED_DYNAMIC_FLOW"
    )
    assert provider.confidence_components["ambiguity_penalty"] == 0.20
    assert provider.confidence == 0.30
    assert dynamic.analysis_level == "L4"
    assert dynamic.confidence == 1.0


@pytest.mark.p0
def test_t05_t07_tool_failures_emit_coverage_limitations_and_apply_capped_penalty() -> None:
    from tools.graph.scanner.analyzers.ai_invocation_detector import AIInvocationDetector

    failures = [
        ToolExecutionResult(
            "semgrep_ai_usage",
            "x",
            OUTCOME_TOOL_FAILURE,
            "sha256:a",
            ["failed"],
        ),
        ToolExecutionResult(
            "ts_js_analyzer",
            "x",
            OUTCOME_TOOL_FAILURE,
            "sha256:b",
            ["failed"],
        ),
    ]

    result = AIInvocationDetector().detect(
        semgrep_result=_semgrep_result(_semgrep_finding()),
        python_analysis=_python_analysis(_python_site()),
        tool_executions=failures,
    )

    provider = next(
        finding for finding in result if finding.finding_type == "AI_PROVIDER_USAGE"
    )
    limitations = [
        finding
        for finding in result
        if finding.finding_type == "SCAN_COVERAGE_LIMITATION"
    ]
    assert provider.confidence_components["coverage_penalty"] == 0.30
    assert provider.confidence == 0.20
    assert len(limitations) == 2
    assert all(finding.confidence == 1.0 for finding in limitations)


@pytest.mark.p0
def test_t08_model_invocation_confidence_clamps_to_one() -> None:
    from tools.graph.scanner.analyzers.ai_invocation_detector import AIInvocationDetector

    result = AIInvocationDetector().detect(
        python_analysis=_python_analysis(
            _python_site(finding_type="AI_MODEL_INVOCATION", rule_id="py-model-call")
        ),
        syft_result=_syft_result(),
        package_dependencies=[
            _package_dependency(source_tool="knip"),
            _package_dependency(source_tool="deptry"),
        ],
    )

    finding = next(item for item in result if item.finding_type == "AI_MODEL_INVOCATION")
    assert finding.confidence_components["base"] == 0.70
    assert finding.confidence_components["corroboration_bonus"] == 0.15
    assert finding.confidence == 1.0


@pytest.mark.p0
def test_t11_kwarg_names_are_names_only_and_extended_input_signal_is_emitted() -> None:
    from tools.graph.scanner.analyzers.ai_invocation_detector import AIInvocationDetector

    result = AIInvocationDetector().detect(
        python_analysis=_python_analysis(_python_site(kwarg_names=["model", "messages"]))
    )

    provider = next(item for item in result if item.finding_type == "AI_PROVIDER_USAGE")
    input_signal = next(item for item in result if item.finding_type == "AI_INPUT_SIGNAL")
    assert provider.kwarg_names == ["model", "messages"]
    assert "hello" not in str(asdict(provider))
    assert input_signal.confidence_components["base"] == 0.55


@pytest.mark.p0
def test_t12_findings_sort_limitations_first_then_confidence_descending() -> None:
    from tools.graph.scanner.analyzers.ai_invocation_detector import AIInvocationDetector

    result = AIInvocationDetector().detect(
        python_analysis=_python_analysis(
            _python_site(
                finding_type="AI_MODEL_INVOCATION",
                rule_id="py-model-call",
                line_number=1,
            ),
            _python_site(
                finding_type="AI_PROVIDER_USAGE",
                rule_id="py-provider",
                line_number=20,
            ),
        ),
        tool_executions=[
            ToolExecutionResult(
                "semgrep_ai_usage",
                "x",
                OUTCOME_TOOL_FAILURE,
                "sha256:a",
                ["failed"],
            )
        ],
    )

    assert result[0].finding_type == "SCAN_COVERAGE_LIMITATION"
    assert result[1].confidence >= result[2].confidence


@pytest.mark.p0
def test_t15_t17_t18_extended_display_and_decisive_signals_are_mutually_exclusive() -> None:
    from tools.graph.scanner.analyzers.ai_invocation_detector import AIInvocationDetector

    display_only = AIInvocationDetector().detect(
        python_analysis=_python_analysis(
            _python_site(function_name="return_summary", rule_id="py-display-only")
        )
    )
    decisive = AIInvocationDetector().detect(
        python_analysis=_python_analysis(
            _python_site(function_name="update_score", rule_id="py-user-impact")
        )
    )

    assert any(item.finding_type == "DISPLAY_ONLY_SIGNAL" for item in display_only)
    assert not any(item.finding_type == "USER_IMPACT_SIGNAL" for item in display_only)
    assert any(item.finding_type == "USER_IMPACT_SIGNAL" for item in decisive)
    assert not any(item.finding_type == "DISPLAY_ONLY_SIGNAL" for item in decisive)


@pytest.mark.p0
def test_t16_domain_and_harm_potential_from_packages_and_function_names() -> None:
    from tools.graph.scanner.analyzers.ai_invocation_detector import AIInvocationDetector

    result = AIInvocationDetector().detect(
        python_analysis=_python_analysis(_python_site(function_name="assess_risk")),
        syft_result=_syft_result("medspacy"),
    )

    assert any(item.finding_type == "DOMAIN_CONTEXT_SIGNAL" for item in result)
    assert any(item.finding_type == "HARM_POTENTIAL_SIGNAL" for item in result)
