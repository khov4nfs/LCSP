from __future__ import annotations

from pathlib import Path

import pytest
from pydantic import ValidationError

import harness
from middleware.model_governance import MODEL_GOVERNANCE_MIDDLEWARE
from middleware.runtime_context import inject_lcsp_runtime_context
from model_policy import (
    ALL_LCSP_MODEL_SPECS,
    CONTEXT_WIZARD_MODEL_SPEC,
    DEFAULT_CONTEXT_WIZARD_MODEL_SPEC,
    DEFAULT_INVESTIGATOR_MODEL_SPEC,
    DEFAULT_PLANNER_MODEL_SPEC,
    DEFAULT_RESOLVER_MODEL_SPEC,
    DEFAULT_ROOT_MODEL_SPEC,
    DEFAULT_TRIAGE_MODEL_SPEC,
    INVESTIGATOR_MODEL_SPEC,
    PLANNER_MODEL_SPEC,
    RESOLVER_MODEL_SPEC,
    ROOT_MODEL_SPEC,
    TRIAGE_MODEL_SPEC,
)
from subagents import FLOW_SUBAGENTS
from subagents.context_wizard.definition import ContextWizardQuestionRound, OUTPUT_MODEL


PROJECT_ROOT = Path(__file__).resolve().parents[1]


def _tool_names(subagent: dict[str, object]) -> tuple[str, ...]:
    return tuple(str(getattr(tool, "name")) for tool in subagent["tools"])


def test_subagents_follow_deep_agents_dictionary_contract() -> None:
    by_name = {item["name"]: item for item in FLOW_SUBAGENTS}
    assert tuple(by_name) == (
        "triage",
        "context_wizard",
        "planner",
        "investigator",
        "resolver",
    )

    expected_models = {
        "triage": TRIAGE_MODEL_SPEC,
        "context_wizard": CONTEXT_WIZARD_MODEL_SPEC,
        "planner": PLANNER_MODEL_SPEC,
        "investigator": INVESTIGATOR_MODEL_SPEC,
        "resolver": RESOLVER_MODEL_SPEC,
    }
    for name, subagent in by_name.items():
        assert {
            "name",
            "description",
            "system_prompt",
            "tools",
            "model",
            "middleware",
        } <= set(subagent)
        assert subagent["model"] == expected_models[name]
        assert "Tool guidance:" in str(subagent["system_prompt"])
        assert "Output contract:" in str(subagent["system_prompt"])
        assert len(str(subagent["description"])) >= 80
        assert subagent["middleware"] == [
            inject_lcsp_runtime_context,
            *MODEL_GOVERNANCE_MIDDLEWARE,
        ]


def test_pipeline_roles_do_not_bypass_context_wizard_hydration() -> None:
    by_name = {item["name"]: item for item in FLOW_SUBAGENTS}

    assert _tool_names(by_name["triage"]) == ("maintain_legal_catalog",)
    assert _tool_names(by_name["context_wizard"]) == (
        "get_assessment_context",
        "get_legal_corpus_readiness",
        "retrieve_legal_basis",
    )
    assert _tool_names(by_name["planner"]) == (
        "search_program_graph",
        "get_scan_coverage",
    )
    assert "retrieve_legal_basis" not in _tool_names(by_name["investigator"])
    assert "get_assessment_context" not in _tool_names(by_name["investigator"])
    assert _tool_names(by_name["resolver"]) == (
        "get_assessment_context",
        "compare_wizard_claim",
    )


def test_triage_is_not_an_assessment_pipeline_role() -> None:
    assessment_roles = {"context_wizard", "planner", "investigator", "resolver"}
    triage_prompt = str(
        next(item for item in FLOW_SUBAGENTS if item["name"] == "triage")["system_prompt"]
    )

    assert "triage" not in assessment_roles
    assert "LEGAL_MAINTENANCE" in triage_prompt
    assert "approved source manifests" in triage_prompt
    assert "Never select law for a customer assessment" in triage_prompt


def test_context_wizard_output_is_typed_ready_or_needs_input_question_round() -> None:
    assert OUTPUT_MODEL is ContextWizardQuestionRound

    ready = ContextWizardQuestionRound(
        status="READY",
        assessment_context={"useCase": "AI assistant"},
        engineering_rules=[{"engineeringRuleId": "ENG-1"}],
        artifact_versions={"legalRuleCatalogVersionId": "catalog-1"},
        conflicts=[],
        unresolved_facts=[],
        questions=[],
        next_step="PLAN",
    )
    assert ready.status == "READY"
    assert ready.next_step == "PLAN"

    needs_input = ContextWizardQuestionRound(
        status="NEEDS_INPUT",
        assessment_context={},
        engineering_rules=[{"engineeringRuleId": "ENG-1"}],
        artifact_versions={"legalRuleCatalogVersionId": "catalog-1"},
        conflicts=[],
        unresolved_facts=["human review responsibility is missing"],
        questions=[
            {
                "question_id": "ctx:human-review-owner",
                "question_text": "Who is responsible for the final human review?",
                "target_field_name": "humanReviewOwner",
                "reason_code": "MISSING_BUSINESS_CONTEXT",
                "evidence_refs": [],
                "required": True,
            }
        ],
        next_step="WIZARD_NEEDS_INPUT",
    )
    assert needs_input.status == "NEEDS_INPUT"
    assert needs_input.questions[0].question_id == "ctx:human-review-owner"

    with pytest.raises(ValidationError):
        ContextWizardQuestionRound(
            status="READY",
            unresolved_facts=[],
            questions=[
                {
                    "question_id": "ctx:invalid",
                    "question_text": "This must not exist on READY.",
                    "reason_code": "MISSING_BUSINESS_CONTEXT",
                }
            ],
            next_step="PLAN",
        )

    with pytest.raises(ValidationError):
        ContextWizardQuestionRound(
            status="NEEDS_INPUT",
            unresolved_facts=["missing fact"],
            questions=[],
            next_step="WIZARD_NEEDS_INPUT",
        )


def test_engineering_rules_are_pinned_inputs_not_subagent_discovery() -> None:
    context_source = (PROJECT_ROOT / "orchestration" / "context.py").read_text()
    instructions = (PROJECT_ROOT / "instructions.md").read_text()
    planner_prompt = str(
        next(item for item in FLOW_SUBAGENTS if item["name"] == "planner")["system_prompt"]
    )
    context_wizard_prompt = str(
        next(item for item in FLOW_SUBAGENTS if item["name"] == "context_wizard")["system_prompt"]
    )

    assert "engineering_rule_ids" in context_source
    assert "already-selected EngineeringRule IDs" in instructions
    assert "Do not add, remove, reinterpret or re-rank EngineeringRules" in planner_prompt
    assert "Do not discover, select, invent or broaden the set of EngineeringRules" in (
        context_wizard_prompt
    )


def test_default_role_models_match_lcsp_cost_and_reasoning_policy() -> None:
    assert DEFAULT_ROOT_MODEL_SPEC == "openai:gpt-5.6-terra"
    assert DEFAULT_TRIAGE_MODEL_SPEC == "openai:gpt-5.6-sol"
    assert DEFAULT_CONTEXT_WIZARD_MODEL_SPEC == "openai:gpt-5.6-luna"
    assert DEFAULT_PLANNER_MODEL_SPEC == "openai:gpt-5.6-sol"
    assert DEFAULT_INVESTIGATOR_MODEL_SPEC == "openai:gpt-5.6-terra"
    assert DEFAULT_RESOLVER_MODEL_SPEC == "openai:gpt-5.6-luna"

    assert ROOT_MODEL_SPEC in ALL_LCSP_MODEL_SPECS
    assert TRIAGE_MODEL_SPEC in ALL_LCSP_MODEL_SPECS
    assert CONTEXT_WIZARD_MODEL_SPEC in ALL_LCSP_MODEL_SPECS
    assert PLANNER_MODEL_SPEC in ALL_LCSP_MODEL_SPECS
    assert INVESTIGATOR_MODEL_SPEC in ALL_LCSP_MODEL_SPECS
    assert RESOLVER_MODEL_SPEC in ALL_LCSP_MODEL_SPECS


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

    # Managed Deep Agents owns the system prompt through instructions.md.
    assert "system_prompt=" not in source
    assert "context_schema=LCSPRunContext" in source
    assert "TodoListMiddleware()" in source
    assert "inject_lcsp_runtime_context" in source
    assert "MODEL_GOVERNANCE_MIDDLEWARE" in source

    assert "LEGAL_MAINTENANCE" in instructions
    assert "triage" in instructions
    assert "context_wizard" in instructions
    assert "wizard_needs_input" in instructions
    assert "wizard_resume" in instructions
    assert "planner" in instructions
    assert "investigator" in instructions
    assert "resolver" in instructions
    assert "write_todos" in instructions
    assert "deterministic gate" in instructions


def test_multi_tenant_agent_does_not_enable_deployment_shared_mda_memory() -> None:
    assert not (PROJECT_ROOT / "memory.py").exists()
    assert not (PROJECT_ROOT / "orchestration" / "memory.py").exists()
