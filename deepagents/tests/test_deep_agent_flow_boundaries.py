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
    FLOW_SUBAGENTS,
    INTERVIEW_TOOLS,
    REPOSITORY_ANALYST_TOOLS,
)


INTERVIEW_TOOL_NAMES: tuple[str, ...] = ()
COMMON_TOOL_NAMES: tuple[str, ...] = (
    "get_legal_corpus_readiness",
    "retrieve_verified_episodes",
    "retrieve_legal_basis",
    "submit_rule_assessment",
)
# Typed queries over the repository's Codebase Memory graph (indexed per dispatch).
CODEBASE_MEMORY_GRAPH_TOOL_NAMES: tuple[str, ...] = (
    "search_code_graph",
    "trace_call_path",
    "get_code_snippet",
    "search_code_text",
    "get_repository_architecture",
)
EXPECTED_ROLE_TOOL_NAMES: dict[str, tuple[str, ...]] = {
    "interview": (),
    "repository-analyst": (
        *CODEBASE_MEMORY_GRAPH_TOOL_NAMES,
        "cite_repository_source",
        "submit_rule_assessment",
        "retrieve_verified_episodes",
    ),
}



def _names(tools: list[object]) -> tuple[str, ...]:
    return tuple(str(getattr(tool, "name")) for tool in tools)


def _directory_names(path: Path) -> set[str]:
    return {
        entry.name
        for entry in path.iterdir()
        if entry.is_dir() and entry.name != "__pycache__" and not entry.name.startswith(".")
    }


def _implementation_files(path: Path) -> set[str]:
    return {
        entry.name
        for entry in path.iterdir()
        if entry.is_file() and entry.suffix == ".py" and entry.name != "__init__.py"
    }


def _assessment_authored_tool_layout() -> dict[str, tuple[str, ...]]:
    return {"common": COMMON_TOOL_NAMES}


def test_specialist_tools_are_strictly_isolated() -> None:
    expected = {
        "interview": INTERVIEW_TOOL_NAMES,
        "repository-analyst": EXPECTED_ROLE_TOOL_NAMES["repository-analyst"],
    }
    for role, tool_names in expected.items():
        assert len(tool_names) == len(set(tool_names))
    # The analyst reports through the governed submit tool only; Interview never sees it.
    assert "submit_rule_assessment" not in INTERVIEW_TOOL_NAMES
    # LCSP-285: Interview must not have EngineeringRule retrieval or verified episode tools
    for disallowed in ("get_finding_detail", "retrieve_verified_episodes", "retrieve_legal_basis"):
        assert disallowed not in INTERVIEW_TOOL_NAMES


def test_subagents_receive_fixed_minimal_tool_surfaces() -> None:
    assert _names(INTERVIEW_TOOLS) == INTERVIEW_TOOL_NAMES
    assert _names(REPOSITORY_ANALYST_TOOLS) == EXPECTED_ROLE_TOOL_NAMES["repository-analyst"]

    by_name = {item["name"]: item for item in FLOW_SUBAGENTS}
    assert tuple(by_name) == ("interview", "repository-analyst")
    assert _names(by_name["interview"]["tools"]) == INTERVIEW_TOOL_NAMES
    assert _names(by_name["repository-analyst"]["tools"]) == EXPECTED_ROLE_TOOL_NAMES["repository-analyst"]


def test_subagent_definitions_are_owned_by_role_directories() -> None:
    subagents_root = PROJECT_ROOT / "subagents"
    assert _directory_names(subagents_root) == {
        "interview",
        "repository_analyst",
    }
    assert not (PROJECT_ROOT / "subagents.py").exists()
    for role in ("interview", "repository_analyst"):
        assert (subagents_root / role / "definition.py").is_file()


def test_root_and_analyst_have_no_targeted_reanalysis_or_planner_tools() -> None:
    # Retry is an explicit API-driven ruleScope rerun, never a model-callable root tool.
    assert not (PROJECT_ROOT / "tools" / "orchestration").exists()
    for names in EXPECTED_ROLE_TOOL_NAMES.values():
        assert "request_targeted_reanalysis" not in names


def test_legal_hydration_stops_before_the_repository_analyst() -> None:
    assert "retrieve_legal_basis" not in EXPECTED_ROLE_TOOL_NAMES["repository-analyst"]
    assert "get_assessment_context" not in EXPECTED_ROLE_TOOL_NAMES["repository-analyst"]
    assert not (PROJECT_ROOT / "tools" / "common" / "get_assessment_context").exists()


def test_agent_facing_assessment_tools_follow_node_tool_code_layout() -> None:
    for node, tool_names in _assessment_authored_tool_layout().items():
        for tool_name in tool_names:
            assert (PROJECT_ROOT / "tools" / node / tool_name / "code.py").is_file()



def test_assessment_authored_tool_modules_own_their_agentic_port_calls() -> None:
    for node, tool_names in _assessment_authored_tool_layout().items():
        for tool_name in tool_names:
            code_path = PROJECT_ROOT / "tools" / node / tool_name / "code.py"
            source = code_path.read_text(encoding="utf-8")
            assert "dispatch_lcsp_tool" not in source
            assert "from runtime" not in source
            assert "AgenticToolPort" not in source
            if tool_name == "submit_rule_assessment":
                # Governed provenance tool: persists through the worker API client, never
                # through the agentic tool dispatcher.
                assert "put_rule_assessment" in source
                assert "dispatch_agentic_tool" not in source
                module = importlib.import_module(f"tools.{node}.{tool_name}.code")
                assert getattr(getattr(module, tool_name), "name") == tool_name
                continue
            if tool_name == "retrieve_verified_episodes":
                assert "retrieve_verified_episodes_from_gateway" in source
                assert "episode_retrieval_enabled" in source
                assert "artifact_versions" not in source.partition("class RetrieveVerifiedEpisodesRequest")[2].partition("def _runtime_context")[0]
            else:
                assert "dispatch_agentic_tool" in source
                assert "_dispatch_agentic_tool" not in source
                assert "trusted_request_from_model_input" in source
                assert "AgenticToolRequest" not in source

            module = importlib.import_module(f"tools.{node}.{tool_name}.code")
            authored_tool = getattr(module, tool_name)
            assert getattr(authored_tool, "name") == tool_name


def test_tools_tree_contains_only_authored_agent_capabilities() -> None:
    assert _directory_names(PROJECT_ROOT / "tools") == {
        "common",
        "legal",
    }
    assert _directory_names(PROJECT_ROOT / "tools" / "common") == set(
        COMMON_TOOL_NAMES
    ) | {"capabilities", "codebase_memory_graph"}
    assert _directory_names(PROJECT_ROOT / "tools" / "common" / "capabilities") == {
        "agentic_evidence",
        "assessment",
        "evidence",
            "agent_runtime",
        "package",
        "platform",
        "reporting",
        "scripts",
        "workflow",
    }
    assert not (PROJECT_ROOT / "tools" / "resolver").exists()
    assert not (PROJECT_ROOT / "tools" / "triage").exists()


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
    assert _directory_names(evidence) == {"graph", "repository_analysis"}
    assert _directory_names(assessment) == {
        "planning",
        "investigation",
        "claims",
        "evaluation",
        "rule_assessment",
    }
    assert _directory_names(common / "workflow") == {
        "recovery",
    }
    assert _directory_names(common / "reporting") == {"gap", "report"}

    assert _directory_names(assessment / "claims") == {
        "ai_usage_flow",
        "conflict_detection",
        "evidence_claim",
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

    # No LCSP-owned graph query engine or rule planner: analysis is the agent's job.
    assert not (evidence / "graph" / "query").exists()
    assert (assessment / "rule_assessment" / "run.py").is_file()
    assert (
        evidence / "repository_analysis" / "boundary.py"
    ).is_file()
    assert not (evidence / "scanner" / "program_graph").exists()
    assert not (
        assessment
        / "planning"
        / "engineering_rule"
        / "engineering_rule_planner.py"
    ).exists()
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


def test_default_general_purpose_subagent_uses_deepagents_default() -> None:
    assert LCSP_HARNESS_PROFILE.general_purpose_subagent is None


def test_harness_exposes_complete_deepagents_builtin_tool_surface() -> None:
    assert HIDDEN_BUILTIN_TOOLS == frozenset()


def test_harness_does_not_replace_deepagents_filesystem_permissions() -> None:
    assert LCSP_FILESYSTEM_PERMISSIONS == []


def test_root_agent_task_subagents_run_under_model_governance(monkeypatch) -> None:
    """Every `task` subagent of the root agent, general-purpose included, is governed."""
    from deepagents.middleware import subagents as deep_subagents

    monkeypatch.setenv("OPENAI_API_KEY", "test-openai-key")
    monkeypatch.setenv("LLM7_API_KEY", "test-llm7-key")
    root_agent_module = importlib.import_module("agent")
    compiled: dict[str, set[str]] = {}
    real_create_agent = deep_subagents.create_agent

    def recording_create_agent(model, **kwargs):
        compiled[kwargs["name"]] = {type(item).__name__ for item in kwargs["middleware"]}
        return real_create_agent(model, **kwargs)

    monkeypatch.setattr(deep_subagents, "create_agent", recording_create_agent)

    root_agent_module.create_root_agent()

    assert "general-purpose" in compiled
    governance = {
        "AgentRoleMiddleware",
        "ModelRetryMiddleware",
        "ProviderFallbackMiddleware",
        "TokenFallbackMiddleware",
        "UsageMeteringMiddleware",
    }
    for name, middleware in compiled.items():
        missing = governance - middleware
        assert not missing, f"subagent {name} runs without {sorted(missing)}"
