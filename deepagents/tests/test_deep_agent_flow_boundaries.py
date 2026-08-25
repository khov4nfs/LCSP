from __future__ import annotations

import importlib
import sys
from pathlib import Path

import pytest


PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT))

from harness import (
    HIDDEN_BUILTIN_TOOLS,
    LCSP_FILESYSTEM_PERMISSIONS,
    LCSP_HARNESS_PROFILE,
)
from subagents import (
    CONTEXT_WIZARD_TOOLS,
    FLOW_SUBAGENTS,
    INVESTIGATOR_TOOLS,
    PLANNER_TOOLS,
    RESOLVER_TOOLS,
    TRIAGE_TOOLS,
)


TRIAGE_TOOL_NAMES: tuple[str, ...] = ("maintain_legal_catalog",)
COMMON_TOOL_NAMES: tuple[str, ...] = (
    "get_assessment_context",
    "get_legal_corpus_readiness",
    "retrieve_legal_basis",
    "search_program_graph",
)
ORCHESTRATION_TOOL_NAMES: tuple[str, ...] = ("request_targeted_reanalysis",)
EXPECTED_ROLE_TOOL_NAMES: dict[str, tuple[str, ...]] = {
    "context_wizard": (
        "get_assessment_context",
        "get_legal_corpus_readiness",
        "retrieve_legal_basis",
    ),
    "planner": ("search_program_graph", "get_scan_coverage"),
    "investigator": (
        "search_program_graph",
        "trace_static_flow",
        "inspect_data_path",
        "inspect_decision_path",
        "inspect_human_review_path",
        "get_symbol_context",
        "find_provider_invocations",
    ),
    "resolver": ("get_assessment_context", "compare_wizard_claim"),
}


def _names(tools: list[object]) -> tuple[str, ...]:
    return tuple(str(getattr(tool, "name")) for tool in tools)


def _directory_names(path: Path) -> set[str]:
    return {
        entry.name
        for entry in path.iterdir()
        if entry.is_dir() and entry.name != "__pycache__"
    }


def _implementation_files(path: Path) -> set[str]:
    return {
        entry.name
        for entry in path.iterdir()
        if entry.is_file() and entry.suffix == ".py" and entry.name != "__init__.py"
    }


def _assessment_authored_tool_layout() -> dict[str, tuple[str, ...]]:
    return {
        "common": COMMON_TOOL_NAMES,
        "planner": ("get_scan_coverage",),
        "investigator": (
            "trace_static_flow",
            "inspect_data_path",
            "inspect_decision_path",
            "inspect_human_review_path",
            "get_symbol_context",
            "find_provider_invocations",
        ),
        "resolver": ("compare_wizard_claim",),
        "orchestration": ORCHESTRATION_TOOL_NAMES,
    }


def test_subagents_receive_fixed_minimal_tool_surfaces() -> None:
    assert _names(TRIAGE_TOOLS) == TRIAGE_TOOL_NAMES
    assert _names(CONTEXT_WIZARD_TOOLS) == EXPECTED_ROLE_TOOL_NAMES["context_wizard"]
    assert _names(PLANNER_TOOLS) == EXPECTED_ROLE_TOOL_NAMES["planner"]
    assert _names(INVESTIGATOR_TOOLS) == EXPECTED_ROLE_TOOL_NAMES["investigator"]
    assert _names(RESOLVER_TOOLS) == EXPECTED_ROLE_TOOL_NAMES["resolver"]

    by_name = {item["name"]: item for item in FLOW_SUBAGENTS}
    assert tuple(by_name) == (
        "triage",
        "context_wizard",
        "planner",
        "investigator",
        "resolver",
    )
    assert _names(by_name["triage"]["tools"]) == TRIAGE_TOOL_NAMES
    for role in ("context_wizard", "planner", "investigator", "resolver"):
        assert _names(by_name[role]["tools"]) == EXPECTED_ROLE_TOOL_NAMES[role]


def test_triage_is_specialist_not_assessment_pipeline_node() -> None:
    assert "triage" not in EXPECTED_ROLE_TOOL_NAMES
    triage_prompt = str(
        next(item for item in FLOW_SUBAGENTS if item["name"] == "triage")["system_prompt"]
    )
    assert "LEGAL_MAINTENANCE" in triage_prompt
    assert "Never select law for a customer assessment" in triage_prompt


def test_subagent_definitions_are_owned_by_role_directories() -> None:
    subagents_root = PROJECT_ROOT / "subagents"
    assert _directory_names(subagents_root) == {
        "triage",
        "context_wizard",
        "planner",
        "investigator",
        "resolver",
    }
    assert not (PROJECT_ROOT / "subagents.py").exists()
    for role in ("triage", "context_wizard", "planner", "investigator", "resolver"):
        assert (subagents_root / role / "definition.py").is_file()


def test_common_and_orchestration_tools_are_classified_explicitly() -> None:
    assert COMMON_TOOL_NAMES == (
        "get_assessment_context",
        "get_legal_corpus_readiness",
        "retrieve_legal_basis",
        "search_program_graph",
    )
    assert ORCHESTRATION_TOOL_NAMES == ("request_targeted_reanalysis",)
    for tool_name in ORCHESTRATION_TOOL_NAMES:
        assert all(tool_name not in names for names in EXPECTED_ROLE_TOOL_NAMES.values())


def test_legal_hydration_stops_before_planner_and_investigator() -> None:
    assert "retrieve_legal_basis" in EXPECTED_ROLE_TOOL_NAMES["context_wizard"]
    assert "retrieve_legal_basis" not in EXPECTED_ROLE_TOOL_NAMES["planner"]
    assert "retrieve_legal_basis" not in EXPECTED_ROLE_TOOL_NAMES["investigator"]
    assert "get_assessment_context" not in EXPECTED_ROLE_TOOL_NAMES["planner"]
    assert "get_assessment_context" not in EXPECTED_ROLE_TOOL_NAMES["investigator"]


def test_agent_facing_assessment_tools_follow_node_tool_code_layout() -> None:
    for node, tool_names in _assessment_authored_tool_layout().items():
        for tool_name in tool_names:
            assert (PROJECT_ROOT / "tools" / node / tool_name / "code.py").is_file()

    assert (
        PROJECT_ROOT / "tools" / "triage" / "maintain_legal_catalog" / "code.py"
    ).is_file()


def test_assessment_authored_tool_modules_own_their_agentic_port_calls() -> None:
    for node, tool_names in _assessment_authored_tool_layout().items():
        for tool_name in tool_names:
            code_path = PROJECT_ROOT / "tools" / node / tool_name / "code.py"
            source = code_path.read_text(encoding="utf-8")
            assert "dispatch_lcsp_tool" not in source
            assert "from runtime" not in source
            assert "AgenticToolPort" not in source
            assert "_dispatch_agentic_tool" in source
            assert "AgenticToolRequest" in source

            module = importlib.import_module(f"tools.{node}.{tool_name}.code")
            authored_tool = getattr(module, tool_name)
            assert getattr(authored_tool, "name") == tool_name


def test_triage_tool_is_bounded_to_approved_legal_sources() -> None:
    code_path = PROJECT_ROOT / "tools" / "triage" / "maintain_legal_catalog" / "code.py"
    source = code_path.read_text(encoding="utf-8")

    assert "MaintainLegalCatalogInput" in source
    assert "MaintainLegalCatalogService" in source
    assert "max_runs" in source
    assert "correlation_id" in source
    assert "source_url" not in source
    assert "document_id" not in source
    assert "gateway_document_id" not in source

    module = importlib.import_module("tools.triage.maintain_legal_catalog.code")
    assert getattr(module.maintain_legal_catalog, "name") == "maintain_legal_catalog"


def test_tools_tree_contains_only_authored_agent_capabilities() -> None:
    assert _directory_names(PROJECT_ROOT / "tools") == {
        "common",
        "legal",
        "planner",
        "investigator",
        "resolver",
        "orchestration",
        "triage",
    }
    assert _directory_names(PROJECT_ROOT / "tools" / "common") == set(
        COMMON_TOOL_NAMES
    ) | {"capabilities"}
    assert _directory_names(PROJECT_ROOT / "tools" / "common" / "capabilities") == {
        "agentic_evidence",
        "assessment",
        "evidence",
        "managed",
        "package",
        "platform",
        "reporting",
        "scripts",
        "workflow",
    }
    assert _directory_names(PROJECT_ROOT / "tools" / "planner") == {"get_scan_coverage"}
    assert _directory_names(PROJECT_ROOT / "tools" / "investigator") == {
        "trace_static_flow",
        "inspect_data_path",
        "inspect_decision_path",
        "inspect_human_review_path",
        "get_symbol_context",
        "find_provider_invocations",
    }
    assert _directory_names(PROJECT_ROOT / "tools" / "resolver") == {"compare_wizard_claim"}
    assert _directory_names(PROJECT_ROOT / "tools" / "orchestration") == set(
        ORCHESTRATION_TOOL_NAMES
    )
    assert _directory_names(PROJECT_ROOT / "tools" / "triage") == set(TRIAGE_TOOL_NAMES)


def test_common_tools_own_non_model_callable_implementation_domains() -> None:
    runtime = PROJECT_ROOT / "runtime"
    assert not runtime.exists()
    common = PROJECT_ROOT / "tools" / "common" / "capabilities"
    assessment = common / "assessment"
    evidence = common / "evidence"
    legal = PROJECT_ROOT / "tools" / "legal"
    assert _directory_names(legal) == {
        "corpus",
        "retrieval",
        "sources",
    }
    assert _directory_names(evidence) == {"graph", "scanner"}
    assert _directory_names(assessment) == {
        "planning",
        "investigation",
        "claims",
        "evaluation",
    }
    assert _directory_names(common / "workflow") == {
        "recovery",
    }
    assert _directory_names(common / "reporting") == {"gap", "report"}

    assert _directory_names(assessment / "claims") == {
        "ai_usage_flow",
        "conflict_detection",
        "evidence_claim",
        "technical_profile",
        "verified_profile",
    }
    assert _directory_names(assessment / "evaluation") == {
        "classification",
        "engineering_rule",
    }
    assert _directory_names(assessment / "investigation") == {
        "engineering_rule",
    }
    assert _directory_names(assessment / "planning") == {
        "engineering_rule",
    }

    for category in (
        assessment / "claims",
        assessment / "evaluation",
        assessment / "investigation",
        assessment / "planning",
    ):
        assert _implementation_files(category) == set()

    assert (evidence / "graph" / "query" / "query_engine.py").is_file()
    assert (
        evidence / "scanner" / "scanning" / "scan_boundary.py"
    ).is_file()
    assert not (evidence / "scanner" / "program_graph").exists()
    assert (
        assessment
        / "planning"
        / "engineering_rule"
        / "engineering_rule_planner.py"
    ).is_file()
    assert (
        assessment
        / "evaluation"
        / "engineering_rule"
        / "rule_evaluator.py"
    ).is_file()
    assert (
        assessment
        / "investigation"
        / "engineering_rule"
        / "engineering_assessment_boundary.py"
    ).is_file()
    assert not (
        assessment
        / "evaluation"
        / "classification"
        / "classification_boundary.py"
    ).exists()
    assert (
        assessment
        / "claims"
        / "ai_usage_flow"
        / "ai_usage_flow_boundary.py"
    ).is_file()
    assert (
        assessment
        / "claims"
        / "evidence_claim"
        / "evidence_claim_validator.py"
    ).is_file()
    assert (
        legal / "sources" / "extraction" / "official_text_extraction.py"
    ).is_file()
    assert (
        PROJECT_ROOT
        / "tools"
        / "triage"
        / "maintain_legal_catalog"
        / "service.py"
    ).is_file()
    assert (
        common
        / "reporting"
        / "report"
        / "final_report"
        / "final_report_boundary.py"
    ).is_file()
    for historical_name in (
        "runtime",
        "graph",
        "scanner",
        "engineering_rule",
        "classification",
        "platform",
        "compat.py",
    ):
        assert not (PROJECT_ROOT / historical_name).exists()


@pytest.mark.parametrize(
    "legacy",
    (
        "tools.common.capabilities.assessment.claims.ai_usage_flow_rule_engine",
        "tools.common.capabilities.assessment.claims.conflict_detector",
        "tools.common.capabilities.assessment.claims.evidence_claim_validator",
        "tools.common.capabilities.assessment.claims.technical_profile_builder",
        "tools.common.capabilities.assessment.claims.verified_profile_boundary",
        "tools.common.capabilities.assessment.evaluation.classification_graph",
        "tools.common.capabilities.assessment.evaluation.rule_evaluator",
        "tools.common.capabilities.assessment.investigation.pipeline",
        "tools.common.capabilities.assessment.planning.engineering_rule_planner",
    ),
)
def test_assessment_flat_imports_are_not_supported(legacy: str) -> None:
    with pytest.raises(ModuleNotFoundError):
        importlib.import_module(legacy)


def test_generic_boundary_invocation_is_not_root_agent_surface() -> None:
    agent_source = (PROJECT_ROOT / "agent.py").read_text()
    assert "invoke_lcsp_boundary" not in agent_source
    assert "list_lcsp_invocation_boundaries" not in agent_source
    assert "resume_waiting_runs" not in agent_source


def test_default_general_purpose_subagent_is_disabled() -> None:
    assert LCSP_HARNESS_PROFILE.general_purpose_subagent is not None
    assert LCSP_HARNESS_PROFILE.general_purpose_subagent.enabled is False


def test_harness_hides_non_skill_filesystem_and_execute_tools() -> None:
    assert HIDDEN_BUILTIN_TOOLS == frozenset(
        {
            "ls",
            "write_file",
            "edit_file",
            "delete",
            "glob",
            "grep",
            "execute",
        }
    )
    assert "read_file" not in HIDDEN_BUILTIN_TOOLS
    assert "task" not in HIDDEN_BUILTIN_TOOLS
    assert "write_todos" not in HIDDEN_BUILTIN_TOOLS


def test_filesystem_permissions_only_allow_reading_managed_skills() -> None:
    assert len(LCSP_FILESYSTEM_PERMISSIONS) == 2

    skill_read, deny_all = LCSP_FILESYSTEM_PERMISSIONS
    assert skill_read.operations == ["read"]
    assert skill_read.paths == ["/skills/**"]
    assert skill_read.mode == "allow"

    assert deny_all.operations == ["read", "write"]
    assert deny_all.paths == ["/**"]
    assert deny_all.mode == "deny"
