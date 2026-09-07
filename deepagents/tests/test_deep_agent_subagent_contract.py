from __future__ import annotations

from pathlib import Path

import harness
from middleware.model_governance import MODEL_GOVERNANCE_MIDDLEWARE
from middleware.runtime_context import inject_lcsp_runtime_context
from model_policy import (
    ALL_LCSP_MODEL_SPECS,
    DEFAULT_INTERVIEW_MODEL_SPEC,
    DEFAULT_INVESTIGATOR_MODEL_SPEC,
    DEFAULT_PLANNER_MODEL_SPEC,
    DEFAULT_ROOT_MODEL_SPEC,
    DEFAULT_TRIAGE_MODEL_SPEC,
    INTERVIEW_MODEL_SPEC,
    INVESTIGATOR_MODEL_SPEC,
    PLANNER_MODEL_SPEC,
    ROOT_MODEL_SPEC,
    TRIAGE_MODEL_SPEC,
)
from subagents import FLOW_SUBAGENTS
from contracts.handoffs import (
    InterviewResult,
    InvestigatorClaim,
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
        if name != "triage":
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
            InvestigatorClaim(
                claim_id="claim-1",
                engineering_rule_id="ENG-1",
                claim_type="RULE_REQUIREMENT_MET",
                value=True,
                evidence_refs=["evidence:1"],
                confidence=0.9,
            )
        ],
        next_step="GATE",
    )
    assert investigator.next_step == "GATE"


def test_engineering_rules_are_pinned_inputs_not_subagent_discovery() -> None:
    context_source = (PROJECT_ROOT / "orchestration" / "context.py").read_text()
    instructions = (PROJECT_ROOT / "instructions.md").read_text()
    planner_prompt = str(
        next(item for item in FLOW_SUBAGENTS if item["name"] == "planner")["system_prompt"]
    )

    assert "engineering_rule_ids" in context_source
    assert "already-selected" in instructions
    assert "EngineeringRule IDs" in instructions
    assert "Do not add, remove, reinterpret or re-rank EngineeringRules" in planner_prompt


def test_default_role_models_match_lcsp_cost_and_reasoning_policy() -> None:
    assert DEFAULT_ROOT_MODEL_SPEC == "openai:gpt-5.6-terra"
    assert DEFAULT_TRIAGE_MODEL_SPEC == "openai:gpt-5.6-sol"
    assert DEFAULT_PLANNER_MODEL_SPEC == "openai:gpt-5.6-sol"
    assert DEFAULT_INTERVIEW_MODEL_SPEC == "openai:gpt-5.6-sol"
    assert DEFAULT_INVESTIGATOR_MODEL_SPEC == "openai:gpt-5.6-terra"

    assert ROOT_MODEL_SPEC in ALL_LCSP_MODEL_SPECS
    assert TRIAGE_MODEL_SPEC in ALL_LCSP_MODEL_SPECS
    assert PLANNER_MODEL_SPEC in ALL_LCSP_MODEL_SPECS
    assert INTERVIEW_MODEL_SPEC in ALL_LCSP_MODEL_SPECS
    assert INVESTIGATOR_MODEL_SPEC in ALL_LCSP_MODEL_SPECS


def test_harness_profile_is_registered_for_every_role_model(monkeypatch) -> None:
    registered: list[tuple[str, object]] = []

    monkeypatch.setattr(
        harness,
        "register_harness_profile",
        lambda model_spec, profile: registered.append((model_spec, profile)),
    )

    harness.configure_lcsp_harness()

    assert tuple(model_spec for model_spec, _ in registered) == ALL_LCSP_MODEL_SPECS
    assert all(profile is harness.LCSP_HARNESS_PROFILE for _, profile in registered)


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
