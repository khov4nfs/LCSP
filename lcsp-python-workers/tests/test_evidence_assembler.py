from __future__ import annotations

from dataclasses import replace

import pytest

from lcsp_workers.scanner.analyzers.python_analyzer import AiCallSite, PythonAnalysisResult
from lcsp_workers.scanner.dependencies.dependency_fact import PackageDependency
from lcsp_workers.scanner.evidence_assembler import (
    EvidenceAssembler,
    PrivacyAssertionError,
    PrivacyFlags,
)
from lcsp_workers.scanner.inventory.language_types import (
    LANGUAGE_PYTHON,
    LanguageClassification,
    SUPPORT_FULL,
)
from lcsp_workers.scanner.parsers.structural_types import StructuralFact
from lcsp_workers.scanner.program_graph.builder import ProgramGraphBuilder
from lcsp_workers.scanner.program_graph.semantic_ir import SemanticNodeFact, SemanticProgram
from lcsp_workers.scanner.tool_registry import ToolProvenance
from lcsp_workers.scanner.toolchain_execution import RepositoryLanguageProfile
from lcsp_workers.scanner.tools.semgrep_tool import SemgrepRunResult
from lcsp_workers.scanner.tools.syft_tool import SBOMEntry, SyftRunResult
from lcsp_workers.scanner.tools.tool_base import (
    OUTCOME_SUCCESS,
    OUTCOME_TOOL_FAILURE,
    ToolExecutionResult,
)
from lcsp_workers.scanner.ts_js_bridge.bridge_types import (
    TsJsBridgeResult,
    TsJsCoverageLimitation,
    TsJsFinding,
)


def _execution(name: str, outcome: str = OUTCOME_SUCCESS) -> ToolExecutionResult:
    return ToolExecutionResult(
        tool_name=name,
        tool_version="1.0.0",
        outcome=outcome,
        config_hash="sha256:config",
    )


def _provenance(name: str, outcome: str = OUTCOME_SUCCESS) -> ToolProvenance:
    return ToolProvenance(
        tool_name=name,
        tool_version="1.0.0",
        config_hash="sha256:config",
        ruleset_hash="sha256:rules",
        started_at="2026-07-03T00:00:00Z",
        ended_at="2026-07-03T00:00:01Z",
        language_profile=RepositoryLanguageProfile(
            languages=(LANGUAGE_PYTHON,),
            file_counts={LANGUAGE_PYTHON: 1},
        ),
        coverage_limitations=(
            () if outcome == OUTCOME_SUCCESS else ("tool failed in fixture",)
        ),
        outcome=outcome,
        disposition="RUN",
        evidence_eligible=outcome == OUTCOME_SUCCESS,
    )


def _python_analysis() -> PythonAnalysisResult:
    return PythonAnalysisResult(
        files_analyzed=1,
        files_skipped=0,
        ai_call_sites=[
            AiCallSite(
                file_path="src/app.py",
                line_number=8,
                function_name="client.responses.create",
                module_alias="openai",
                matched_rule_id="openai.responses.create",
                finding_type="AI_MODEL_INVOCATION",
                analysis_level="L1",
                call_args_schema=["input"],
                has_dynamic_call=False,
                kwarg_names=["input"],
                confidence=0.95,
                evidence=[{"file": "src/app.py", "line": 8}],
            )
        ],
        import_map={"openai": "openai"},
        unsupported_dynamic_flows=[],
        coverage_limitation=False,
    )


def _ts_analysis() -> TsJsBridgeResult:
    return TsJsBridgeResult(
        files_analyzed=1,
        files_skipped=0,
        findings=[
            TsJsFinding(
                finding_type="AI_MODEL_INVOCATION",
                file_path="src/app.ts",
                line_number=4,
                rule_id="openai.responses.create",
                import_source="openai",
                call_expression="client.responses.create",
                kwarg_names=["input"],
                analysis_level="L1",
                has_dynamic_call=False,
                confidence=0.95,
            )
        ],
        unsupported_dynamic_flows=[],
        coverage_limitations=[],
        analyzer_version="1.0.0",
        execution=_execution("ts-morph"),
    )


def _syft() -> SyftRunResult:
    return SyftRunResult(
        entries=[
            SBOMEntry(
                name="openai",
                version="1.0.0",
                ecosystem="python",
                purl="pkg:pypi/openai@1.0.0",
                location="requirements.txt",
                license="MIT",
            )
        ],
        execution=_execution("syft"),
    )


def _graph():
    builder = ProgramGraphBuilder(
        ".",
        scan_job_id="scan-job-1",
        snapshot_id="snapshot-1",
        commit_sha="abc123",
    )
    builder.add_program(
        SemanticProgram(
            nodes=[
                SemanticNodeFact(
                    "file:src/app.py",
                    "FILE",
                    "src/app.py",
                    "src/app.py",
                    1,
                    1,
                    evidence_refs=("evidence:finding-1",),
                )
            ]
        )
    )
    return builder.build()


def _assemble(**overrides):
    values = dict(
        scan_job_id="scan-job-1",
        syft_result=_syft(),
        semgrep_result=SemgrepRunResult(
            findings=[],
            executions=[_execution("semgrep")],
            redaction_applied=True,
        ),
        coverage_notes=[],
        package_dependencies=[
            PackageDependency(
                name="openai",
                version="1.0.0",
                ecosystem="python",
                purl="pkg:pypi/openai@1.0.0",
                usage_facts=[],
                confidence_boost=0.0,
                is_ai_relevant=True,
                license_expression="MIT",
            )
        ],
        dependency_executions=[_execution("knip"), _execution("deptry")],
        python_analysis=_python_analysis(),
        ts_js_analysis=_ts_analysis(),
        technical_findings=[],
        structural_facts=[
            StructuralFact(
                file_path="src/app.py",
                graph_node_type="FUNCTION",
                name="generate",
                line_number=5,
                pattern_type="function",
                ai_finding_ids=[],
            )
        ],
        evidence_graph=_graph(),
        scan_coverage=[
            LanguageClassification(
                file_path="src/app.py",
                language=LANGUAGE_PYTHON,
                support_level=SUPPORT_FULL,
                file_size_bytes=128,
                line_count=12,
                skip_reason=None,
                coverage_limitation=False,
            )
        ],
        targeted_reanalysis=None,
        tool_provenance=[
            _provenance("syft"),
            _provenance("semgrep"),
            _provenance("knip"),
            _provenance("deptry"),
            _provenance("ts-morph"),
            _provenance("python-ast"),
            _provenance("libcst"),
            _provenance("tree-sitter"),
        ],
    )
    values.update(overrides)
    return EvidenceAssembler().assemble(**values)


def test_t01_builds_current_scan_callback_contract() -> None:
    report = _assemble()
    assert report.status == "SUCCESS"
    assert report.schema_version == "1.0.0"
    assert report.privacy_flags["containsSourceCode"] is False
    assert report.privacy_flags["secretsRedacted"] is True
    assert report.evidence_payload["package_dependencies"]
    assert report.evidence_payload["evidence_graph"]["schema_version"] == "3.0.0"
    assert report.evidence_payload["report_provenance"]["report_hash"].startswith(
        "sha256:"
    )


def test_t02_failed_tool_keeps_explicit_failure_and_coverage_provenance() -> None:
    failed = _execution("syft", OUTCOME_TOOL_FAILURE)
    report = _assemble(
        syft_result=SyftRunResult(entries=[], execution=failed),
        coverage_notes=["syft failed in fixture"],
        tool_provenance=[
            _provenance("syft", OUTCOME_TOOL_FAILURE),
            _provenance("semgrep"),
        ],
    )
    assert report.status == "PARTIAL"
    assert report.evidence_payload["coverage_notes"] == ["syft failed in fixture"]
    assert report.evidence_payload["tool_failures"][0]["tool_name"] == "syft"
    assert report.evidence_payload["tool_provenance"][0]["coverage_limitations"]


def test_t03_source_code_privacy_flag_fails_closed() -> None:
    assembler = EvidenceAssembler()
    flags = PrivacyFlags(
        contains_source_code=True,
        secrets_redacted=True,
        source_stripped_from_findings=True,
    )
    with pytest.raises(PrivacyAssertionError):
        assembler._assert_privacy(flags, [], [])


def test_t04_unredacted_secret_privacy_flag_fails_closed() -> None:
    assembler = EvidenceAssembler()
    flags = PrivacyFlags(
        contains_source_code=False,
        secrets_redacted=False,
        source_stripped_from_findings=True,
    )
    with pytest.raises(PrivacyAssertionError):
        assembler._assert_privacy(flags, [], [])


def test_t05_coverage_notes_are_preserved() -> None:
    report = _assemble(
        coverage_notes=["dynamic import cannot be resolved statically"]
    )
    assert any(
        "dynamic import" in value
        for value in report.evidence_payload["coverage_notes"]
    )


def test_t06_targeted_reanalysis_is_preserved() -> None:
    report = _assemble(
        targeted_reanalysis={
            "analyzer_id": "RUN_PYTHON_SEMANTIC_ANALYSIS",
            "path_prefixes": ["src/"],
        }
    )
    assert (
        report.evidence_payload["targeted_reanalysis"]["analyzer_id"]
        == "RUN_PYTHON_SEMANTIC_ANALYSIS"
    )


def test_t07_dependency_tool_executions_are_bound_to_callback_metadata() -> None:
    report = _assemble(
        dependency_executions=[_execution("knip"), _execution("deptry")]
    )
    assert report.tools_version["knip"] == "1.0.0"
    assert report.tools_version["deptry"] == "1.0.0"
    assert report.config_hash["knip"] == "sha256:config"
    assert report.config_hash["deptry"] == "sha256:config"


def test_t08_structural_facts_are_sanitized() -> None:
    facts = _assemble().evidence_payload["structural_facts"]
    assert facts
    assert facts[0]["file_path"] == "src/app.py"
    assert "source" not in facts[0]


def test_t09_serializes_sanitized_versioned_program_evidence_graph() -> None:
    graph_payload = _assemble(evidence_graph=_graph()).evidence_payload[
        "evidence_graph"
    ]
    assert graph_payload["schema_version"] == "3.0.0"
    assert graph_payload["snapshot_id"] == "snapshot-1"
    assert graph_payload["commit_sha"] == "abc123"
    assert graph_payload["graph_hash"].startswith("sha256:")

    # MINIMIZED callback payload fields to prevent 413 Request Entity Too Large
    assert not graph_payload["source_anchors"]
    assert not graph_payload["nodes"]
    assert graph_payload["evidence_graph_ref"]

    # Resolution checks: ProgramEvidenceGraph.from_dict correctly loads data from the ref file
    from lcsp_workers.scanner.program_graph.models import ProgramEvidenceGraph
    loaded_graph = ProgramEvidenceGraph.from_dict(graph_payload)
    assert loaded_graph.source_anchors
    assert loaded_graph.nodes
    assert "evidence:finding-1" in next(
        node for node in loaded_graph.to_dict()["nodes"] if node["node_type"] == "FILE"
    )["evidence_refs"]

    serialized = str(graph_payload).lower()
    assert "raw_source" not in serialized
    assert "full_ast" not in serialized
    assert "prompt_text" not in serialized


def test_t10_ts_js_coverage_limitations_are_preserved_in_semantic_result() -> None:
    ts = replace(
        _ts_analysis(),
        coverage_limitations=[
            TsJsCoverageLimitation(
                file_path="src/dynamic.ts",
                reason="dynamic import",
            )
        ],
    )
    report = _assemble(ts_js_analysis=ts)
    limitations = report.evidence_payload["ts_js_analysis"]["coverage_limitations"]
    assert any("dynamic import" in item["reason"] for item in limitations)


def test_t11_tool_provenance_is_complete_and_sanitized() -> None:
    rows = _assemble().evidence_payload["tool_provenance"]
    assert rows
    assert all(row["tool_name"] for row in rows)
    assert all(row["config_hash"] for row in rows)
    serialized = str(rows).lower()
    assert "authorization" not in serialized
    assert "api_key" not in serialized


def test_t12_source_identifier_named_secret_is_preserved_as_import_binding() -> None:
    python_analysis = replace(
        _python_analysis(),
        import_map={"openai": "openai", "secret": "secrets"},
    )
    report = _assemble(python_analysis=python_analysis)
    persisted = report.evidence_payload["python_analysis"]

    assert "import_map" not in persisted
    assert {"local_name": "secret", "package": "secrets"} in persisted[
        "import_bindings"
    ]


def test_t13_actual_forbidden_schema_key_still_fails_closed() -> None:
    with pytest.raises(PrivacyAssertionError, match="forbidden field secret"):
        _assemble(targeted_reanalysis={"secret": "must-not-persist"})
