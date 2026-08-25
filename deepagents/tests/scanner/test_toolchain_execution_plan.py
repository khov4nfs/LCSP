from __future__ import annotations

import pytest

from tools.common.capabilities.evidence.scanner.inventory.language.language_types import (
    LANGUAGE_JAVA,
    LANGUAGE_PYTHON,
    LANGUAGE_TYPESCRIPT,
    SUPPORT_BASIC,
    SUPPORT_FULL,
    LanguageClassification,
)
from tools.common.capabilities.evidence.scanner.toolchain.toolchain_execution import (
    APPROVED_TOOL_NAMES,
    TOOL_DISPOSITIONS,
    ToolchainExecutionPlanner,
)
from tools.common.capabilities.evidence.scanner.toolchain.tool_registry import ToolRegistry
from tools.common.capabilities.evidence.scanner.tools.common.tool_base import OUTCOME_SUCCESS, ToolExecutionResult
from tools.common.capabilities.evidence.scanner.tools.common.tool_base import OUTCOME_SKIPPED_UNSUPPORTED


def _classification(
    language: str,
    *,
    file_path: str,
    support_level: str = SUPPORT_FULL,
) -> LanguageClassification:
    return LanguageClassification(
        file_path=file_path,
        language=language,
        support_level=support_level,
        file_size_bytes=10,
        line_count=1,
        skip_reason=None,
        coverage_limitation=False,
    )


@pytest.mark.p0
def test_mixed_repository_plan_contains_every_approved_static_tool() -> None:
    plan = ToolchainExecutionPlanner().build(
        [
            _classification(LANGUAGE_PYTHON, file_path="service.py"),
            _classification(LANGUAGE_TYPESCRIPT, file_path="web.ts"),
            _classification(
                LANGUAGE_JAVA,
                file_path="Service.java",
                support_level=SUPPORT_BASIC,
            ),
        ]
    )

    assert {entry.tool_name for entry in plan.entries} == set(APPROVED_TOOL_NAMES.values())
    assert all(
        entry.disposition == TOOL_DISPOSITIONS["run"] for entry in plan.entries
    )
    assert plan.language_profile.languages == (
        LANGUAGE_JAVA,
        LANGUAGE_PYTHON,
        LANGUAGE_TYPESCRIPT,
    )


@pytest.mark.p0
def test_python_repository_plan_selects_python_specific_tools_only() -> None:
    plan = ToolchainExecutionPlanner().build(
        [_classification(LANGUAGE_PYTHON, file_path="service.py")]
    )
    dispositions = {entry.tool_name: entry.disposition for entry in plan.entries}

    assert dispositions[APPROVED_TOOL_NAMES["syft"]] == TOOL_DISPOSITIONS["run"]
    assert dispositions[APPROVED_TOOL_NAMES["deptry"]] == TOOL_DISPOSITIONS["run"]
    assert dispositions[APPROVED_TOOL_NAMES["python_ast"]] == TOOL_DISPOSITIONS["run"]
    assert dispositions[APPROVED_TOOL_NAMES["python_libcst"]] == TOOL_DISPOSITIONS["run"]
    assert dispositions[APPROVED_TOOL_NAMES["tree_sitter"]] == TOOL_DISPOSITIONS["run"]
    assert dispositions[APPROVED_TOOL_NAMES["semgrep"]] == TOOL_DISPOSITIONS["run"]
    assert dispositions[APPROVED_TOOL_NAMES["knip"]] == TOOL_DISPOSITIONS["skip"]
    assert dispositions[APPROVED_TOOL_NAMES["ts_morph"]] == TOOL_DISPOSITIONS["skip"]


@pytest.mark.p0
def test_typescript_repository_plan_selects_ts_js_specific_tools_only() -> None:
    plan = ToolchainExecutionPlanner().build(
        [_classification(LANGUAGE_TYPESCRIPT, file_path="web.ts")]
    )
    dispositions = {entry.tool_name: entry.disposition for entry in plan.entries}

    assert dispositions[APPROVED_TOOL_NAMES["knip"]] == TOOL_DISPOSITIONS["run"]
    assert dispositions[APPROVED_TOOL_NAMES["ts_morph"]] == TOOL_DISPOSITIONS["run"]
    assert dispositions[APPROVED_TOOL_NAMES["deptry"]] == TOOL_DISPOSITIONS["skip"]
    assert dispositions[APPROVED_TOOL_NAMES["python_ast"]] == TOOL_DISPOSITIONS["skip"]
    assert dispositions[APPROVED_TOOL_NAMES["python_libcst"]] == TOOL_DISPOSITIONS["skip"]


@pytest.mark.p1
def test_language_profile_is_deterministic_and_counts_supported_files() -> None:
    plan = ToolchainExecutionPlanner().build(
        [
            _classification(LANGUAGE_PYTHON, file_path="z.py"),
            _classification(LANGUAGE_TYPESCRIPT, file_path="web.ts"),
            _classification(LANGUAGE_PYTHON, file_path="a.py"),
        ]
    )

    assert plan.language_profile.languages == (
        LANGUAGE_PYTHON,
        LANGUAGE_TYPESCRIPT,
    )
    assert plan.language_profile.file_counts == {
        LANGUAGE_PYTHON: 2,
        LANGUAGE_TYPESCRIPT: 1,
    }


@pytest.mark.p0
def test_tool_registry_records_complete_per_run_provenance() -> None:
    profile = ToolchainExecutionPlanner().build(
        [_classification(LANGUAGE_PYTHON, file_path="service.py")]
    ).language_profile
    registry = ToolRegistry()

    registry.register(
        ToolExecutionResult(
            tool_name="deptry",
            tool_version="0.23.0",
            outcome=OUTCOME_SUCCESS,
            config_hash="sha256:deptry-config",
        ),
        ruleset_hash="sha256:not-applicable",
        started_at="2026-08-11T06:00:00Z",
        ended_at="2026-08-11T06:00:01Z",
        language_profile=profile,
        coverage_limitations=["one dynamic import was not resolved"],
    )

    provenance = registry.all()[0]
    assert provenance.tool_name == "deptry"
    assert provenance.tool_version == "0.23.0"
    assert provenance.config_hash == "sha256:deptry-config"
    assert provenance.ruleset_hash == "sha256:not-applicable"
    assert provenance.started_at == "2026-08-11T06:00:00Z"
    assert provenance.ended_at == "2026-08-11T06:00:01Z"
    assert provenance.language_profile == profile
    assert provenance.coverage_limitations == (
        "one dynamic import was not resolved",
    )


@pytest.mark.p0
def test_unsupported_tools_have_explicit_non_evidentiary_limitations() -> None:
    plan = ToolchainExecutionPlanner().build(
        [_classification(LANGUAGE_PYTHON, file_path="service.py")]
    )
    knip_entry = next(
        entry
        for entry in plan.entries
        if entry.tool_name == APPROVED_TOOL_NAMES["knip"]
    )

    assert knip_entry.disposition == TOOL_DISPOSITIONS["skip"]
    assert knip_entry.coverage_limitation is True
    assert knip_entry.reason == "unsupported_for_language_profile"

    registry = ToolRegistry()
    registry.register_skipped(
        knip_entry,
        language_profile=plan.language_profile,
        recorded_at="2026-08-11T06:00:00Z",
    )

    provenance = registry.all()[0]
    assert provenance.outcome == OUTCOME_SKIPPED_UNSUPPORTED
    assert provenance.evidence_eligible is False
    assert provenance.coverage_limitations == (
        "knip: unsupported_for_language_profile",
    )


@pytest.mark.p0
def test_basic_language_profile_runs_only_inventory_and_structural_tools() -> None:
    plan = ToolchainExecutionPlanner().build(
        [
            _classification(
                LANGUAGE_JAVA,
                file_path="Service.java",
                support_level=SUPPORT_BASIC,
            )
        ]
    )
    runnable = {
        entry.tool_name
        for entry in plan.entries
        if entry.disposition == TOOL_DISPOSITIONS["run"]
    }

    assert runnable == {
        APPROVED_TOOL_NAMES["syft"],
        APPROVED_TOOL_NAMES["tree_sitter"],
    }
    assert len(plan.coverage_limitations()) == 6
