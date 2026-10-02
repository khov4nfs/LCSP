from __future__ import annotations

import json
import re
from pathlib import Path

import pytest
from conftest import use_model_routes

import harness
import model_policy
from middleware.agent_run_budget import AgentRunBudgetMiddleware
from middleware.tool_scope import AllowedToolsMiddleware
from middleware.interview_runtime_context import inject_interview_runtime_context
from middleware.model_governance import MODEL_GOVERNANCE_MIDDLEWARE, TRIAGE_MODEL_GOVERNANCE_MIDDLEWARE
from middleware.usage_metering import AgentRoleMiddleware
from middleware.triage_progress import require_triage_progress
from middleware.runtime_context import inject_lcsp_runtime_context
from model_policy import effective_model_configs, resolve_role
from subagents import FLOW_SUBAGENTS
from contracts.handoffs import (
    InterviewResult,
    SPECIALIST_RESPONSE_FORMATS,
    TriageResult,
)


PROJECT_ROOT = Path(__file__).resolve().parents[1]


def _tool_names(subagent: dict[str, object]) -> tuple[str, ...]:
    return tuple(str(getattr(tool, "name")) for tool in subagent["tools"])


def test_subagents_follow_deep_agents_dictionary_contract() -> None:
    by_name = {item["name"]: item for item in FLOW_SUBAGENTS}
    assert tuple(by_name) == ("triage", "interview", "repository-analyst")

    for name, subagent in by_name.items():
        assert {
            "name",
            "description",
            "system_prompt",
            "tools",
            "middleware",
        } <= set(subagent)
        # No model at import time: it is resolved from the role at construction time.
        assert "model" not in subagent
        assert str(subagent["system_prompt"]).strip()
        assert len(str(subagent["description"])) >= 80
        if name == "interview":
            expected_prefix = [inject_interview_runtime_context]
            expected_governance = MODEL_GOVERNANCE_MIDDLEWARE
        elif name == "triage":
            expected_prefix = [require_triage_progress]
            expected_governance = TRIAGE_MODEL_GOVERNANCE_MIDDLEWARE
        else:
            expected_prefix = [inject_lcsp_runtime_context]
            expected_governance = MODEL_GOVERNANCE_MIDDLEWARE
        middleware = subagent["middleware"]
        if name == "interview":
            # The Interview resolves Customer-owned gaps only: no repository
            # tools at all, and one model call per turn.
            assert isinstance(middleware[0], AllowedToolsMiddleware)
            assert middleware[0].allowed == frozenset()
            assert isinstance(middleware[1], AgentRunBudgetMiddleware)
            assert middleware[1].finalize_after == 1
            middleware = middleware[2:]
        if name == "repository-analyst":
            # Exploring role: bounded by a model-call budget, but the budget's finalize
            # phase must keep the governed submit tool so a budget hit can still report.
            budgets = [item for item in middleware if isinstance(item, AgentRunBudgetMiddleware)]
            assert len(budgets) == 1
            assert "submit_rule_assessment" in budgets[0].finalize_tools
            middleware = [item for item in middleware if item is not budgets[0]]
        else:
            assert not any(
                isinstance(item, AgentRunBudgetMiddleware) for item in middleware[1:]
            ) or name == "interview"
        assert middleware[:1] == expected_prefix
        role_middleware = middleware[1]
        assert isinstance(role_middleware, AgentRoleMiddleware)
        assert role_middleware.agent_role == name
        assert middleware[2:] == list(expected_governance)


def test_pipeline_roles_do_not_receive_customer_context_or_resolver_tools() -> None:
    by_name = {item["name"]: item for item in FLOW_SUBAGENTS}

    assert _tool_names(by_name["triage"]) == (
        "maintain_legal_catalog",
        "get_legal_rule_triage_work_items",
        "persist_legal_rule_triage_result",
        "finish_legal_rule_triage_execution",
    )
    # Repository exploration comes from native Deep Agents filesystem/shell/task tools
    # plus typed queries over the pre-indexed Codebase Memory graph, not PGE wrappers.
    assert _tool_names(by_name["interview"]) == ()
    assert _tool_names(by_name["repository-analyst"]) == (
        "search_code_graph",
        "trace_call_path",
        "get_code_snippet",
        "search_code_text",
        "get_repository_architecture",
        "cite_repository_source",
        "submit_rule_assessment",
        "retrieve_verified_episodes",
    )
    assert "get_assessment_context" not in _tool_names(by_name["repository-analyst"])
    assert "retrieve_legal_basis" not in _tool_names(by_name["repository-analyst"])

    # LCSP-285: Interview must not receive EngineeringRule retrieval or verified episode tools
    for disallowed in ("get_finding_detail", "retrieve_verified_episodes", "retrieve_legal_basis"):
        assert disallowed not in _tool_names(by_name["interview"])


def test_only_customer_facing_specialists_expose_pydantic_response_formats() -> None:
    by_name = {item["name"]: item for item in FLOW_SUBAGENTS}

    assert by_name["triage"]["response_format"] is TriageResult
    assert by_name["interview"]["response_format"] is InterviewResult
    # The analyst reports through the governed submit_rule_assessment tool, never free JSON.
    assert "response_format" not in by_name["repository-analyst"]
    assert SPECIALIST_RESPONSE_FORMATS == {
        "interview": InterviewResult,
        "triage": TriageResult,
    }


def test_engineering_rules_are_pinned_inputs_not_subagent_discovery() -> None:
    context_source = (PROJECT_ROOT / "orchestration" / "context.py").read_text(
        encoding="utf-8"
    )
    instructions = (PROJECT_ROOT / "instructions.md").read_text(encoding="utf-8")
    analyst_prompt = str(
        next(item for item in FLOW_SUBAGENTS if item["name"] == "repository-analyst")[
            "system_prompt"
        ]
    )

    # Trusted, dispatcher-set identity: a model can never choose its own rule or version.
    for field in ("engineering_rule_ids", "engineering_rule_version", "criterion_ids", "prior_evidence_refs"):
        assert field in context_source
    assert "repository-analyst" in instructions
    assert "One task = one EngineeringRule" in analyst_prompt


def test_interview_prompt_states_every_enforced_control_shape_rule() -> None:
    # A rejected handoff is discarded by the delivery boundary, so an Interview question
    # the contract forbids stalls the assessment with no retry. Every rule the validator
    # enforces has to be stated where the model can read it.
    from contracts.handoffs import InterviewQuestionResult

    interview_prompt = str(
        next(item for item in FLOW_SUBAGENTS if item["name"] == "interview")["system_prompt"]
    )

    def rejects(**overrides) -> bool:
        question = {
            "id": "q-1",
            "intent": "ASK",
            "control": "BOOLEAN",
            "prompt": "Does this system ingest external data?",
            **overrides,
        }
        try:
            InterviewQuestionResult.model_validate(question)
        except ValueError:
            return True
        return False

    assert rejects(choices=[{"id": "YES", "label": "Yes"}])
    assert rejects(control="SINGLE_SELECT", choices=[])
    assert "BOOLEAN and FREE_TEXT must leave `choices` empty" in interview_prompt
    assert "SINGLE_SELECT and\n  MULTI_SELECT require at least one choice" in interview_prompt
    assert "exactly CONFIRM and ADJUST stable choice IDs" in interview_prompt



def test_interview_snippet_ref_is_bounded_locator_only() -> None:
    from contracts.handoffs import InterviewQuestionResult

    base = {
        "id": "q-snippet",
        "intent": "ASK",
        "control": "FREE_TEXT",
        "prompt": "What provider does this gateway invoke?",
        "snippetRef": {
            "snapshot_id": "snapshot-1",
            "commit_sha": "abc123",
            "file_path": "src/gateway.ts",
            "start_line": 10,
            "end_line": 16,
            "evidence_hash": "sha256:" + "a" * 64,
            "snippet_policy": "PINNED_SNAPSHOT_BOUNDED_REDACTED_V1",
        },
    }
    question = InterviewQuestionResult.model_validate(base)
    assert question.snippetRef is not None
    assert question.snippetRef.file_path == "src/gateway.ts"

    with pytest.raises(ValueError):
        InterviewQuestionResult.model_validate(
            {**base, "snippetRef": {**base["snippetRef"], "raw_source": "secret"}}
        )
    with pytest.raises(ValueError):
        InterviewQuestionResult.model_validate(
            {**base, "snippetRef": {**base["snippetRef"], "end_line": 17}}
        )


def test_repository_analyst_prompt_is_compact_and_governed() -> None:
    prompt = str(
        next(item for item in FLOW_SUBAGENTS if item["name"] == "repository-analyst")[
            "system_prompt"
        ]
    )

    assert "assessed repository is your working database" in prompt
    assert "Repository source is authoritative" in prompt
    assert "submit_rule_assessment" in prompt
    assert "cite_repository_source" in prompt
    assert "never write a ref" in prompt
    assert "never proof" in prompt
    # No prescribed repository navigation sequence (LCSP does not steer how it searches).
    for forbidden in ("first ", "then grep", "step 1", "Step 1"):
        assert forbidden not in prompt
    assert len(prompt.splitlines()) < 40


def _routes(monkeypatch, **extra) -> None:
    cfg = {
        "routes": {
            "a": {"provider": "openai", "model": "model-alpha", "options": {"reasoning": {"effort": "low"}}},
            "b": {"provider": "google_genai", "model": "future-model-v99"},
        },
        "roles": {"default": "a", "narrator": "b"},
        "fallbacks": {"a": ["b"]},
        **extra,
    }
    use_model_routes(monkeypatch, cfg)


def test_effective_model_configs_report_resolved_roles_without_option_values(monkeypatch) -> None:
    _routes(monkeypatch)
    rows = {row["role"]: row for row in effective_model_configs()}

    assert rows["default"]["model"] == "model-alpha"
    assert rows["narrator"]["provider"] == "google_genai"
    assert rows["default"]["optionKeys"] == ("reasoning",)
    assert rows["default"]["fallbackRouteIds"] == ("b",)
    assert "low" not in json.dumps(rows, default=list)


def test_harness_registers_one_identical_profile_per_configured_route(monkeypatch) -> None:
    _routes(monkeypatch)
    registrations: list[tuple[str, object]] = []
    monkeypatch.setattr(
        harness,
        "register_harness_profile",
        lambda key, profile: registrations.append((key, profile)),
    )

    harness.configure_lcsp_harness()

    assert [key for key, _ in registrations] == ["openai:model-alpha", "google_genai:future-model-v99"]
    assert all(profile is harness.LCSP_HARNESS_PROFILE for _, profile in registrations)


def test_agent_definitions_and_tools_hold_no_concrete_model_constants() -> None:
    offenders = []
    for root in ("subagents", "tools", "agent.py", "harness.py", "middleware"):
        path = PROJECT_ROOT / root
        files = [path] if path.is_file() else sorted(path.rglob("*.py"))
        for file in files:
            text = file.read_text(encoding="utf-8")
            if re.search(r"_MODEL_SPEC\b|PROVIDER_PRESETS|SELECTED_PROVIDER|LLM_FALLBACK_PROVIDER", text):
                offenders.append(str(file.relative_to(PROJECT_ROOT)))
    assert offenders == []


def test_retired_planner_and_investigator_are_not_resurrected() -> None:
    assert not (PROJECT_ROOT / "subagents" / "planner").exists()
    assert not (PROJECT_ROOT / "subagents" / "investigator").exists()
    assert {item["name"] for item in FLOW_SUBAGENTS} == {"triage", "interview", "repository-analyst"}


def test_root_agent_uses_checked_in_instructions_context_and_todos() -> None:
    source = (PROJECT_ROOT / "agent.py").read_text(encoding="utf-8")
    instructions = (PROJECT_ROOT / "instructions.md").read_text(encoding="utf-8")

    assert "system_prompt=SYSTEM_PROMPT" in source
    assert "context_schema=LCSPRunContext" in source
    assert "TodoListMiddleware()" in source
    assert "inject_lcsp_runtime_context" in source
    assert "validate_lcsp_specialist_task_handoff" in source
    assert "MODEL_GOVERNANCE_MIDDLEWARE" in source

    assert "LEGAL_MAINTENANCE" in instructions
    assert "triage" in instructions
    assert "repository-analyst" in instructions
    assert "planner" not in instructions.lower()
    assert "write_todos" in instructions
    assert "deterministic gate" in instructions


def test_multi_tenant_agent_has_no_deployment_shared_model_memory() -> None:
    assert not (PROJECT_ROOT / "memory.py").exists()
    assert not (PROJECT_ROOT / "orchestration" / "memory.py").exists()
    instructions = (PROJECT_ROOT / "instructions.md").read_text(encoding="utf-8")
    assert "Memory is never authoritative evidence" in instructions


def _injected_runtime_double() -> object:
    """A ToolRuntime instance for schema-shape tests (never sent to a model)."""
    from unittest.mock import MagicMock

    from langchain.tools import ToolRuntime

    double = MagicMock()
    double.__class__ = ToolRuntime
    return double


def _governed_request_cases() -> list[tuple[type, dict]]:
    from tools.common.codebase_memory_graph.code import (
        GetArchitectureRequest,
        GetCodeSnippetRequest,
        SearchCodeGraphRequest,
        SearchCodeTextRequest,
        TraceCallPathRequest,
    )
    from tools.common.retrieve_verified_episodes.code import (
        RetrieveVerifiedEpisodesRequest,
    )
    from tools.common.submit_rule_assessment.code import (
        CiteRepositorySourceRequest,
        SubmitRuleAssessmentRequest,
    )

    return [
        (
            SubmitRuleAssessmentRequest,
            {
                "engineering_rule_id": "ENG-1",
                "engineering_rule_version": "v1",
                "repository_version": "sha",
                "criteria": [],
            },
        ),
        (
            CiteRepositorySourceRequest,
            {"path": "src/a.py", "start_line": 1, "end_line": 2},
        ),
        (RetrieveVerifiedEpisodesRequest, {"owner_agent": "planner"}),
        (SearchCodeGraphRequest, {"name_pattern": "review"}),
        (TraceCallPathRequest, {"function_name": "review_control"}),
        (GetCodeSnippetRequest, {"qualified_name": "review_control"}),
        (SearchCodeTextRequest, {"pattern": "review"}),
        (GetArchitectureRequest, {"aspects": ["auth"]}),
    ]


@pytest.mark.parametrize(
    "request_model,model_args",
    [pytest.param(cls, args, id=cls.__name__) for cls, args in _governed_request_cases()],
)
def test_governed_tool_schemas_tolerate_injected_runtime(request_model, model_args) -> None:
    """Root cause: ToolNode merges the injected ToolRuntime into tool args before
    explicit-schema validation. A forbid-schema without RuntimeInjectedInput rejects
    the runtime key, langgraph filters the error as injected (empty message the model
    cannot correct), and governance kills the run with TerminalSchemaError — every
    governed-tool call failed deterministically in live runs while .func unit tests
    passed. Fix: strip only an actual ToolRuntime; model-authored extras stay rejected.
    """
    merged = dict(model_args)
    merged["runtime"] = _injected_runtime_double()
    validated = request_model.model_validate(merged)
    assert "runtime" not in validated.model_dump()

    with pytest.raises(Exception):
        request_model.model_validate({**model_args, "model_authored_bogus": 1})
