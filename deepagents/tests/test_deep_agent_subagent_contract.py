from __future__ import annotations

import importlib
from pathlib import Path

import pytest

import harness
import model_policy
from middleware.interview_runtime_context import inject_interview_runtime_context
from middleware.model_governance import MODEL_GOVERNANCE_MIDDLEWARE, TRIAGE_MODEL_GOVERNANCE_MIDDLEWARE
from middleware.triage_progress import require_triage_progress
from middleware.runtime_context import inject_lcsp_runtime_context
from model_policy import (
    ALL_LCSP_MODEL_SPECS,
    DEFAULT_INTERVIEW_MODEL_SPEC,
    DEFAULT_INVESTIGATOR_MODEL_SPEC,
    DEFAULT_NARRATOR_MODEL_SPEC,
    DEFAULT_PLANNER_MODEL_SPEC,
    DEFAULT_REASONING_EFFORT,
    DEFAULT_ROOT_MODEL_SPEC,
    DEFAULT_TRIAGE_MODEL_SPEC,
    INTERVIEW_MODEL_SPEC,
    INVESTIGATOR_MODEL_SPEC,
    NARRATOR_MODEL_SPEC,
    PLANNER_MODEL_SPEC,
    REASONING_EFFORT,
    RESPONSES_OUTPUT_VERSION,
    ROOT_MODEL_SPEC,
    TRIAGE_MODEL_SPEC,
    _model_spec,
    _reasoning_effort_status,
    effective_model_configs,
    model_init_kwargs_for_agent,
    openai_responses_base_init_kwargs,
    openai_responses_init_kwargs,
    reasoning_policy_for_agent,
    supports_openai_reasoning,
)
from subagents import FLOW_SUBAGENTS
from contracts.handoffs import (
    InterviewResult,
    InvestigatorRequirementMetClaim,
    InvestigatorResult,
    PlannerResult,
    ProvenanceRef,
    SPECIALIST_RESPONSE_FORMATS,
    TriageResult,
)


PROJECT_ROOT = Path(__file__).resolve().parents[1]


def _tool_names(subagent: dict[str, object]) -> tuple[str, ...]:
    return tuple(str(getattr(tool, "name")) for tool in subagent["tools"])


def test_subagents_follow_deep_agents_dictionary_contract() -> None:
    by_name = {item["name"]: item for item in FLOW_SUBAGENTS}
    assert tuple(by_name) == ("triage", "interview", "planner", "investigator")

    expected_models = {
        "triage": TRIAGE_MODEL_SPEC,
        "interview": INTERVIEW_MODEL_SPEC,
        "planner": PLANNER_MODEL_SPEC,
        "investigator": INVESTIGATOR_MODEL_SPEC,
    }
    for name, subagent in by_name.items():
        assert {
            "name",
            "description",
            "system_prompt",
            "tools",
            "model",
            "middleware",
            "response_format",
        } <= set(subagent)
        assert subagent["model"] == expected_models[name]
        assert "Tool guidance:" in str(subagent["system_prompt"])
        assert "Output contract:" in str(subagent["system_prompt"])
        assert len(str(subagent["description"])) >= 80
        expected_middleware = [*MODEL_GOVERNANCE_MIDDLEWARE]
        if name == "interview":
            expected_middleware = [
                inject_interview_runtime_context,
                *MODEL_GOVERNANCE_MIDDLEWARE,
            ]
        elif name == "triage":
            expected_middleware = [require_triage_progress, *TRIAGE_MODEL_GOVERNANCE_MIDDLEWARE]
        else:
            expected_middleware = [
                inject_lcsp_runtime_context,
                *MODEL_GOVERNANCE_MIDDLEWARE,
            ]
        assert subagent["middleware"] == expected_middleware


def test_pipeline_roles_do_not_receive_customer_context_or_resolver_tools() -> None:
    by_name = {item["name"]: item for item in FLOW_SUBAGENTS}

    assert _tool_names(by_name["triage"]) == (
        "maintain_legal_catalog",
        "get_legal_rule_triage_work_items",
        "persist_legal_rule_triage_result",
        "finish_legal_rule_triage_execution",
    )
    assert _tool_names(by_name["interview"]) == (
        "search_program_graph",
        "get_scan_coverage",
        "inspect_decision_path",
        "inspect_data_path",
        "inspect_human_review_path",
    )
    assert _tool_names(by_name["planner"]) == (
        "retrieve_verified_episodes",
        "search_program_graph",
        "get_scan_coverage",
    )
    assert _tool_names(by_name["investigator"]) == (
        "retrieve_verified_episodes",
        "search_program_graph",
        "trace_static_flow",
        "inspect_data_path",
        "inspect_decision_path",
        "inspect_human_review_path",
        "get_symbol_context",
        "find_provider_invocations",
    )
    for role in ("planner", "investigator"):
        assert "get_assessment_context" not in _tool_names(by_name[role])

    # LCSP-285: Interview must not receive EngineeringRule retrieval or verified episode tools
    for disallowed in ("get_finding_detail", "retrieve_verified_episodes", "retrieve_legal_basis"):
        assert disallowed not in _tool_names(by_name["interview"])


def test_all_specialists_expose_pydantic_response_formats() -> None:
    by_name = {item["name"]: item for item in FLOW_SUBAGENTS}

    assert by_name["triage"]["response_format"] is TriageResult
    assert by_name["interview"]["response_format"] is InterviewResult
    assert by_name["planner"]["response_format"] is PlannerResult
    assert by_name["investigator"]["response_format"] is InvestigatorResult
    assert SPECIALIST_RESPONSE_FORMATS == {
        "interview": InterviewResult,
        "planner": PlannerResult,
        "investigator": InvestigatorResult,
        "triage": TriageResult,
    }


def test_structured_handoffs_match_deep_research_report_fields() -> None:
    provenance = ProvenanceRef(
        ref="evidence:1",
        source_kind="PROGRAM_GRAPH",
        artifact_version="ter-1",
    )
    assert provenance.ref == "evidence:1"

    planner = PlannerResult(
        status="INVESTIGATE",
        engineering_rule_ids=["ENG-1"],
        artifact_versions={"technicalEvidenceReportId": "ter-1"},
        coverage_state="COMPLETE",
        selected_scope=[
            {
                "ref": "node:ai",
                "criterion": "AI invocation exists",
            }
        ],
        unresolved_facts=[],
        next_step="INVESTIGATE",
    )
    assert planner.coverage_state == "COMPLETE"

    investigator = InvestigatorResult(
        status="READY",
        artifact_versions={"technicalEvidenceReportId": "ter-1"},
        claims=[
            InvestigatorRequirementMetClaim(
                claim_id="claim-1",
                engineering_rule_id="ENG-1",
                claim_type="RULE_REQUIREMENT_MET",
                value=True,
                evidence_refs=["evidence:1"],
                confidence=0.9,
                criterion="AI invocation exists",
            )
        ],
        next_step="GATE",
    )
    assert investigator.next_step == "GATE"


def test_engineering_rules_are_pinned_inputs_not_subagent_discovery() -> None:
    context_source = (PROJECT_ROOT / "orchestration" / "context.py").read_text(
        encoding="utf-8"
    )
    instructions = (PROJECT_ROOT / "instructions.md").read_text(encoding="utf-8")
    planner_prompt = str(
        next(item for item in FLOW_SUBAGENTS if item["name"] == "planner")["system_prompt"]
    )

    assert "engineering_rule_ids" in context_source
    assert "already-selected" in instructions
    assert "EngineeringRule IDs" in instructions
    assert "Do not add, remove, reinterpret or re-rank EngineeringRules" in planner_prompt


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


def test_investigator_prompt_requires_seeded_flow_trace_before_closure() -> None:
    investigator_prompt = str(
        next(item for item in FLOW_SUBAGENTS if item["name"] == "investigator")[
            "system_prompt"
        ]
    )

    assert "substring node search, not path proof or absence proof" in investigator_prompt
    assert "Do not close a MET or NOT_MET technical claim based solely on `search_program_graph`" in investigator_prompt
    assert "`trace_static_flow` or `inspect_data_path` starting from concrete seed refs" in investigator_prompt
    assert "matchMode=SUBSTRING" in investigator_prompt
    assert "absenceProven=false" in investigator_prompt


def test_default_role_models_match_lcsp_cost_and_reasoning_policy() -> None:
    assert DEFAULT_ROOT_MODEL_SPEC == "openai:gpt-5-nano"
    assert DEFAULT_TRIAGE_MODEL_SPEC == "openai:gpt-5-nano"
    assert DEFAULT_PLANNER_MODEL_SPEC == "openai:gpt-5-nano"
    assert DEFAULT_INTERVIEW_MODEL_SPEC == "openai:gpt-5-nano"
    assert DEFAULT_INVESTIGATOR_MODEL_SPEC == "openai:gpt-5-nano"
    assert DEFAULT_NARRATOR_MODEL_SPEC == "openai:gpt-4.1-nano"
    assert DEFAULT_REASONING_EFFORT == "low"
    assert RESPONSES_OUTPUT_VERSION == "responses/v1"

    assert ROOT_MODEL_SPEC in ALL_LCSP_MODEL_SPECS
    assert TRIAGE_MODEL_SPEC in ALL_LCSP_MODEL_SPECS
    assert PLANNER_MODEL_SPEC in ALL_LCSP_MODEL_SPECS
    assert INTERVIEW_MODEL_SPEC in ALL_LCSP_MODEL_SPECS
    assert INVESTIGATOR_MODEL_SPEC in ALL_LCSP_MODEL_SPECS
    assert NARRATOR_MODEL_SPEC in ALL_LCSP_MODEL_SPECS


def test_openai_model_policy_gates_reasoning_by_model_capability() -> None:
    assert openai_responses_base_init_kwargs() == {
        "use_responses_api": True,
        "output_version": "responses/v1",
    }

    kwargs = openai_responses_init_kwargs("openai:gpt-5-mini")

    assert kwargs == {
        "use_responses_api": True,
        "output_version": "responses/v1",
        "reasoning": {"effort": REASONING_EFFORT},
    }
    assert "reasoning_effort" not in kwargs
    assert openai_responses_init_kwargs("openai:gpt-4o-mini") == {
        "use_responses_api": True,
        "output_version": "responses/v1",
    }
    assert supports_openai_reasoning("openai:gpt-5-mini") is True
    assert supports_openai_reasoning("openai:gpt-5.1") is True
    assert supports_openai_reasoning("openai:gpt-5") is True
    assert supports_openai_reasoning("openai:gpt-5-chat-latest") is False
    assert supports_openai_reasoning("openai:gpt-4o-mini") is False
    assert supports_openai_reasoning("openai:gpt-4.1-nano") is False
    assert openai_responses_init_kwargs("openai:gpt-4.1-nano") == {
        "use_responses_api": True,
        "output_version": "responses/v1",
    }
    assert supports_openai_reasoning("anthropic:claude-sonnet-4-6") is False


def test_agent_reasoning_policy_is_role_and_model_scoped() -> None:
    assert (
        reasoning_policy_for_agent(
            agent_name="lcsp-engineering-rule-planner",
            model_spec="openai:gpt-5-mini",
        )
        == "enabled"
    )
    assert (
        reasoning_policy_for_agent(
            agent_name="lcsp-engineering-rule-planner",
            model_spec="openai:gpt-4o-mini",
        )
        == "unsupported_model"
    )
    assert (
        reasoning_policy_for_agent(
            agent_name="lcsp-final-report-narrator",
            model_spec="openai:gpt-5-mini",
        )
        == "disabled_for_agent"
    )
    assert "reasoning" not in model_init_kwargs_for_agent(
        agent_name="lcsp-final-report-narrator",
        model_spec="openai:gpt-5-mini",
    )
    assert "reasoning" not in model_init_kwargs_for_agent(
        agent_name="lcsp-engineering-rule-planner",
        model_spec="openai:gpt-4o-mini",
    )
    assert model_init_kwargs_for_agent(
        agent_name="lcsp-engineering-rule-planner",
        model_spec="openai:gpt-5-mini",
    )["reasoning"] == {"effort": REASONING_EFFORT}


def test_openai_non_reasoning_env_override_omits_reasoning(monkeypatch) -> None:
    monkeypatch.setenv("LCSP_TRIAGE_MODEL", "openai:gpt-4o-mini")

    try:
        reloaded = importlib.reload(model_policy)
        configs = {config.role: config for config in reloaded.effective_model_configs()}

        assert reloaded.TRIAGE_MODEL_SPEC == "openai:gpt-4o-mini"
        assert configs["triage"].client == "responses_api"
        assert configs["triage"].reasoning_effort == "unset"
        assert configs["triage"].reasoning_policy == "unsupported_model"
        assert "reasoning" not in reloaded.model_init_kwargs_for_agent(
            agent_name="triage",
            model_spec=reloaded.TRIAGE_MODEL_SPEC,
        )
    finally:
        monkeypatch.delenv("LCSP_TRIAGE_MODEL", raising=False)
        importlib.reload(model_policy)


def test_narrator_model_env_defaults_to_non_reasoning_model(monkeypatch) -> None:
    monkeypatch.setenv("LCSP_NARRATOR_MODEL", "openai:gpt-4o-mini")

    try:
        reloaded = importlib.reload(model_policy)
        configs = {config.role: config for config in reloaded.effective_model_configs()}

        assert reloaded.NARRATOR_MODEL_SPEC == "openai:gpt-4o-mini"
        assert configs["narrator"].client == "responses_api"
        assert configs["narrator"].reasoning_effort == "unset"
        assert configs["narrator"].reasoning_policy == "disabled_for_agent"
        assert "reasoning" not in reloaded.model_init_kwargs_for_agent(
            agent_name="lcsp-final-report-narrator",
            model_spec=reloaded.NARRATOR_MODEL_SPEC,
        )
    finally:
        monkeypatch.delenv("LCSP_NARRATOR_MODEL", raising=False)
        importlib.reload(model_policy)


def test_effective_model_config_logs_responses_api_defaults() -> None:
    configs = effective_model_configs()

    assert tuple(config.role for config in configs) == (
        "root",
        "triage",
        "planner",
        "interview",
        "investigator",
        "narrator",
    )
    assert all(config.provider == "openai" for config in configs)
    assert tuple(config.model for config in configs) == (
        "gpt-5-nano",
        "gpt-5-nano",
        "gpt-5-nano",
        "gpt-5-nano",
        "gpt-5-nano",
        "gpt-4.1-nano",
    )
    assert all(config.source in {"default", "env"} for config in configs)
    assert all(config.client == "responses_api" for config in configs)
    assert all(config.tools is True for config in configs)
    assert tuple(config.reasoning_effort for config in configs) == (
        REASONING_EFFORT,
        REASONING_EFFORT,
        REASONING_EFFORT,
        REASONING_EFFORT,
        REASONING_EFFORT,
        "unset",
    )
    assert tuple(config.reasoning_policy for config in configs) == (
        "enabled",
        "enabled",
        "enabled",
        "enabled",
        "enabled",
        "disabled_for_agent",
    )
    assert all(config.output_version == "responses/v1" for config in configs)


def test_reasoning_effort_defaults_to_low(monkeypatch) -> None:
    for env_name in (
        "LCSP_REASONING_EFFORT",
        "OPENAI_REASONING_EFFORT",
        "REASONING_EFFORT",
    ):
        monkeypatch.delenv(env_name, raising=False)

    assert _reasoning_effort_status() == "low"


def test_invalid_reasoning_effort_fails_closed(monkeypatch) -> None:
    monkeypatch.setenv("LCSP_REASONING_EFFORT", "turbo")

    with pytest.raises(RuntimeError, match="supported reasoning efforts"):
        _reasoning_effort_status()


def test_blank_model_env_does_not_override_default(monkeypatch) -> None:
    monkeypatch.setenv("LCSP_TRIAGE_MODEL", "  ")

    model_spec, source = _model_spec("LCSP_TRIAGE_MODEL", "openai:gpt-5-mini")

    assert model_spec == "openai:gpt-5-mini"
    assert source == "default"


def test_harness_registers_openai_provider_and_every_role_profile(monkeypatch) -> None:
    provider_registrations: list[tuple[str, object]] = []
    harness_registrations: list[tuple[str, object]] = []

    monkeypatch.setattr(
        harness,
        "register_provider_profile",
        lambda key, profile: provider_registrations.append((key, profile)),
    )
    monkeypatch.setattr(
        harness,
        "register_harness_profile",
        lambda model_spec, profile: harness_registrations.append((model_spec, profile)),
    )

    harness.configure_lcsp_harness()

    assert tuple(key for key, _ in provider_registrations) == (
        "openai",
        *ALL_LCSP_MODEL_SPECS,
    )
    profiles = {key: profile for key, profile in provider_registrations}
    assert dict(harness.LCSP_OPENAI_PROVIDER_PROFILE.init_kwargs) == (
        openai_responses_base_init_kwargs()
    )
    assert dict(profiles["openai"].init_kwargs) == openai_responses_base_init_kwargs()
    assert dict(profiles[ROOT_MODEL_SPEC].init_kwargs) == openai_responses_init_kwargs(
        ROOT_MODEL_SPEC
    )
    assert dict(profiles[TRIAGE_MODEL_SPEC].init_kwargs) == openai_responses_init_kwargs(
        TRIAGE_MODEL_SPEC
    )
    assert dict(profiles[NARRATOR_MODEL_SPEC].init_kwargs) == (
        openai_responses_base_init_kwargs()
    )
    assert tuple(model_spec for model_spec, _ in harness_registrations) == (
        ALL_LCSP_MODEL_SPECS
    )
    assert all(
        profile is harness.LCSP_HARNESS_PROFILE
        for _, profile in harness_registrations
    )


def test_root_agent_uses_managed_instructions_context_and_todos() -> None:
    source = (PROJECT_ROOT / "agent.py").read_text(encoding="utf-8")
    instructions = (PROJECT_ROOT / "instructions.md").read_text(encoding="utf-8")

    assert "system_prompt=" not in source
    assert "context_schema=LCSPRunContext" in source
    assert "TodoListMiddleware()" in source
    assert "inject_lcsp_runtime_context" in source
    assert "validate_lcsp_specialist_task_handoff" in source
    assert "MODEL_GOVERNANCE_MIDDLEWARE" in source

    assert "LEGAL_MAINTENANCE" in instructions
    assert "triage" in instructions
    assert "planner" in instructions
    assert "investigator" in instructions
    assert "write_todos" in instructions
    assert "deterministic gate" in instructions


def test_multi_tenant_agent_does_not_enable_deployment_shared_mda_memory() -> None:
    assert not (PROJECT_ROOT / "memory.py").exists()
    assert not (PROJECT_ROOT / "orchestration" / "memory.py").exists()
