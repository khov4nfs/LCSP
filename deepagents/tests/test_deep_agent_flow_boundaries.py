from __future__ import annotations

import importlib
import sys
from pathlib import Path

import pytest


PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT))

from flow import (
    ALLOWED_FLOW_TRANSITIONS,
    COMMON_TOOL_NAMES,
    FLOW_ORDER,
    NODE_TOOL_NAMES,
    NON_MODEL_FLOW_STEPS,
    ORCHESTRATION_TOOL_NAMES,
    assert_flow_transition,
)
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


def test_canonical_flow_separates_wizard_and_investigation_needs_input_loops() -> None:
    assert FLOW_ORDER == (
        "context_wizard",
        "wizard_needs_input",
        "wizard_resume",
        "plan",
        "investigate",
        "needs_input",
        "resolve",
        "resume",
        "gate",
        "gap",
        "report",
    )
    assert NON_MODEL_FLOW_STEPS == (
        "wizard_needs_input",
        "wizard_resume",
        "needs_input",
        "resume",
        "gate",
        "gap",
        "report",
    )


def test_canonical_flow_declares_only_expected_transitions() -> None:
    assert ALLOWED_FLOW_TRANSITIONS == {
        "context_wizard": frozenset({"plan", "wizard_needs_input"}),
        "wizard_needs_input": frozenset({"wizard_resume"}),
        "wizard_resume": frozenset({"context_wizard"}),
        "plan": frozenset({"investigate", "needs_input"}),
        "investigate": frozenset({"needs_input", "gate"}),
        "needs_input": frozenset({"resolve"}),
        "resolve": frozenset({"resume", "needs_input"}),
        "resume": frozenset({"investigate"}),
        "gate": frozenset({"gap"}),
        "gap": frozenset({"report"}),
        "report": frozenset(),
    }

    assert_flow_transition("context_wizard", "plan")
    assert_flow_transition("context_wizard", "wizard_needs_input")
    assert_flow_transition("wizard_needs_input", "wizard_resume")
    assert_flow_transition("wizard_resume", "context_wizard")
    assert_flow_transition("plan", "investigate")
    assert_flow_transition("plan", "needs_input")
    assert_flow_transition("investigate", "needs_input")
    assert_flow_transition("needs_input", "resolve")
    assert_flow_transition("resolve", "resume")
    assert_flow_transition("resolve", "needs_input")
    assert_flow_transition("resume", "investigate")
    assert_flow_transition("investigate", "gate")
    assert_flow_transition("gate", "gap")
    assert_flow_transition("gap", "report")

    with pytest.raises(ValueError, match="invalid LCSP flow transition"):
        assert_flow_transition("context_wizard", "investigate")
    with pytest.raises(ValueError, match="invalid LCSP flow transition"):
        assert_flow_transition("wizard_needs_input", "plan")
    with pytest.raises(ValueError, match="unknown LCSP flow step"):
        assert_flow_transition("unknown", "context_wizard")


def test_subagents_receive_fixed_minimal_tool_surfaces() -> None:
    assert _names(TRIAGE_TOOLS) == TRIAGE_TOOL_NAMES
    assert _names(CONTEXT_WIZARD_TOOLS) == NODE_TOOL_NAMES["context_wizard"]
    assert _names(PLANNER_TOOLS) == NODE_TOOL_NAMES["planner"]
    assert _names(INVESTIGATOR_TOOLS) == NODE_TOOL_NAMES["investigator"]
    assert _names(RESOLVER_TOOLS) == NODE_TOOL_NAMES["resolver"]

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
        assert _names(by_name[role]["tools"]) == NODE_TOOL_NAMES[role]


def test_triage_is_specialist_not_assessment_pipeline_node() -> None:
    assert "triage" not in NODE_TOOL_NAMES
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
        assert tool_name not in NODE_TOOL_NAMES["context_wizard"]
        assert tool_name not in NODE_TOOL_NAMES["planner"]
        assert tool_name not in NODE_TOOL_NAMES["investigator"]
        assert tool_name not in NODE_TOOL_NAMES["resolver"]


def test_legal_hydration_stops_before_planner_and_investigator() -> None:
    assert "retrieve_legal_basis" in NODE_TOOL_NAMES["context_wizard"]
    assert "retrieve_legal_basis" not in NODE_TOOL_NAMES["planner"]
    assert "retrieve_legal_basis" not in NODE_TOOL_NAMES["investigator"]
    assert "get_assessment_context" not in NODE_TOOL_NAMES["planner"]
    assert "get_assessment_context" not in NODE_TOOL_NAMES["investigator"]


def test_agent_facing_assessment_tools_follow_node_tool_code_layout() -> None:
    for node, tool_names in _assessment_authored_tool_layout().items():
        for tool_name in tool_names:
            assert (PROJECT_ROOT / "tools" / node / tool_name / "code.py").is_file()

    assert (
        PROJECT_ROOT / "tools" / "triage" / "maintain_legal_catalog" / "code.py"
    ).is_file()


def test_assessment_authored_tool_modules_use_canonical_envelope_and_import() -> None:
    for node, tool_names in _assessment_authored_tool_layout().items():
        for tool_name in tool_names:
            code_path = PROJECT_ROOT / "tools" / node / tool_name / "code.py"
            source = code_path.read_text(encoding="utf-8")
            assert "tools.common.dispatch" not in source
            assert "from tools.common import LcspToolEnvelope, dispatch_lcsp_tool" in source

            module = importlib.import_module(f"tools.{node}.{tool_name}.code")
            authored_tool = getattr(module, tool_name)
            assert getattr(authored_tool, "name") == tool_name


def test_triage_tool_is_bounded_to_approved_legal_sources() -> None:
    code_path = PROJECT_ROOT / "tools" / "triage" / "maintain_legal_catalog" / "code.py"
    source = code_path.read_text(encoding="utf-8")

    assert "MaintainLegalCatalogInput" in source
    assert "LegalIntelligenceMaintenanceService" in source
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
        "planner",
        "investigator",
        "resolver",
        "orchestration",
        "triage",
    }
    assert _directory_names(PROJECT_ROOT / "tools" / "common") == set(COMMON_TOOL_NAMES)
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


def test_runtime_owns_non_model_callable_implementation_domains() -> None:
    runtime = PROJECT_ROOT / "runtime"
    assert _directory_names(runtime) == {
        "evidence",
        "legal",
        "assessment",
        "workflow",
        "reporting",
        "infrastructure",
    }
    assert _directory_names(runtime / "evidence") == {"graph", "scanner", "provenance"}
    assert _directory_names(runtime / "legal") == {
        "corpus",
        "retrieval",
        "sources",
        "maintenance",
    }
    assert _directory_names(runtime / "assessment") == {
        "planning",
        "investigation",
        "claims",
        "evaluation",
    }
    assert _directory_names(runtime / "workflow") == {
        "state",
        "checkpoint",
        "recovery",
        "resume",
    }
    assert _directory_names(runtime / "reporting") == {"gap", "report"}
    assert _directory_names(runtime / "infrastructure") == {
        "api",
        "auth",
        "llm",
        "dispatch",
    }

    assert _directory_names(runtime / "assessment" / "claims") == {
        "ai_usage_flow",
        "conflict_detection",
        "evidence_claim",
        "technical_profile",
        "verified_profile",
    }
    assert _directory_names(runtime / "assessment" / "evaluation") == {
        "classification",
        "engineering_rule",
    }
    assert _directory_names(runtime / "assessment" / "investigation") == {
        "engineering_rule",
    }
    assert _directory_names(runtime / "assessment" / "planning") == {
        "engineering_rule",
    }

    for category in (
        runtime / "assessment" / "claims",
        runtime / "assessment" / "evaluation",
        runtime / "assessment" / "investigation",
        runtime / "assessment" / "planning",
    ):
        assert _implementation_files(category) == set()

    assert (runtime / "evidence" / "graph" / "query" / "query_engine.py").is_file()
    assert (
        runtime / "evidence" / "scanner" / "scanning" / "scan_boundary.py"
    ).is_file()
    assert not (runtime / "evidence" / "scanner" / "program_graph").exists()
    assert (
        runtime
        / "assessment"
        / "planning"
        / "engineering_rule"
        / "engineering_rule_planner.py"
    ).is_file()
    assert (
        runtime
        / "assessment"
        / "evaluation"
        / "engineering_rule"
        / "rule_evaluator.py"
    ).is_file()
    assert (
        runtime
        / "assessment"
        / "evaluation"
        / "classification"
        / "classification_boundary.py"
    ).is_file()
    assert (
        runtime
        / "assessment"
        / "claims"
        / "ai_usage_flow"
        / "ai_usage_flow_boundary.py"
    ).is_file()
    assert (
        runtime
        / "assessment"
        / "claims"
        / "evidence_claim"
        / "evidence_claim_validator.py"
    ).is_file()
    assert (
        runtime / "legal" / "sources" / "extraction" / "official_text_extraction.py"
    ).is_file()
    assert (
        runtime / "legal" / "maintenance" / "service.py"
    ).is_file()
    assert (
        runtime
        / "reporting"
        / "report"
        / "final_report"
        / "final_report_boundary.py"
    ).is_file()
    assert (
        runtime / "infrastructure" / "dispatch" / "tool_dispatch.py"
    ).is_file()

    for historical_name in (
        "graph",
        "scanner",
        "engineering_rule",
        "classification",
        "orchestration",
        "platform",
        "compat.py",
    ):
        assert not (runtime / historical_name).exists()


@pytest.mark.parametrize(
    ("legacy", "canonical"),
    (
        (
            "runtime.assessment.claims.ai_usage_flow_rule_engine",
            "runtime.assessment.claims.ai_usage_flow.ai_usage_flow_rule_engine",
        ),
        (
            "runtime.assessment.claims.conflict_detector",
            "runtime.assessment.claims.conflict_detection.conflict_detector",
        ),
        (
            "runtime.assessment.claims.evidence_claim_validator",
            "runtime.assessment.claims.evidence_claim.evidence_claim_validator",
        ),
        (
            "runtime.assessment.claims.technical_profile_builder",
            "runtime.assessment.claims.technical_profile.technical_profile_builder",
        ),
        (
            "runtime.assessment.claims.verified_profile_boundary",
            "runtime.assessment.claims.verified_profile.verified_profile_boundary",
        ),
        (
            "runtime.assessment.evaluation.classification_graph",
            "runtime.assessment.evaluation.classification.classification_graph",
        ),
        (
            "runtime.assessment.evaluation.rule_evaluator",
            "runtime.assessment.evaluation.engineering_rule.rule_evaluator",
        ),
        (
            "runtime.assessment.investigation.pipeline",
            "runtime.assessment.investigation.engineering_rule.pipeline",
        ),
        (
            "runtime.assessment.planning.engineering_rule_planner",
            "runtime.assessment.planning.engineering_rule.engineering_rule_planner",
        ),
    ),
)
def test_assessment_flat_imports_route_to_capability_packages(
    legacy: str,
    canonical: str,
) -> None:
    legacy_module = importlib.import_module(legacy)
    canonical_module = importlib.import_module(canonical)
    assert Path(str(legacy_module.__file__)).resolve() == Path(
        str(canonical_module.__file__)
    ).resolve()


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
