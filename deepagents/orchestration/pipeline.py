"""Canonical LCSP assessment pipeline owned by the root orchestrator."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class FlowStep:
    name: str
    owner: str
    description: str


FLOW_STEPS: tuple[FlowStep, ...] = (
    FlowStep(
        "context_wizard",
        "context_wizard",
        "Hydrate pinned rules/context and proactively identify missing business facts.",
    ),
    FlowStep(
        "wizard_needs_input",
        "orchestrator",
        "Persist the generated Wizard clarification round and wait for user answers before planning.",
    ),
    FlowStep(
        "wizard_resume",
        "orchestrator",
        "Resume Context Wizard from checkpoint after Wizard answers are saved.",
    ),
    FlowStep(
        "plan",
        "planner",
        "Build the smallest bounded technical investigation plan from hydrated context and EngineeringRules.",
    ),
    FlowStep(
        "investigate",
        "investigator",
        "Collect provenance-backed technical evidence for the delegated plan.",
    ),
    FlowStep(
        "needs_input",
        "orchestrator",
        "Record an investigation-time unresolved fact and pause the current investigation branch.",
    ),
    FlowStep(
        "resolve",
        "resolver",
        "Resolve only the missing Wizard/business context required by the active investigation.",
    ),
    FlowStep(
        "resume",
        "orchestrator",
        "Resume the same investigation from checkpoint with the resolved fact.",
    ),
    FlowStep(
        "gate",
        "deterministic-runtime",
        "Validate claims and evaluate EngineeringRules deterministically.",
    ),
    FlowStep("gap", "application-runtime", "Build evidence-backed gaps from deterministic EngineeringRule outcomes."),
    FlowStep("report", "application-runtime", "Produce guarded report and audit artifacts."),
)

FLOW_ORDER: tuple[str, ...] = tuple(step.name for step in FLOW_STEPS)

ALLOWED_FLOW_TRANSITIONS: dict[str, frozenset[str]] = {
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


def assert_flow_transition(current: str, next_step: str) -> None:
    allowed = ALLOWED_FLOW_TRANSITIONS.get(current)
    if allowed is None:
        raise ValueError(f"unknown LCSP flow step: {current}")
    if next_step not in allowed:
        raise ValueError(
            f"invalid LCSP flow transition: {current} -> {next_step}; allowed={sorted(allowed)}"
        )


COMMON_TOOL_NAMES: tuple[str, ...] = (
    "get_assessment_context",
    "get_legal_corpus_readiness",
    "retrieve_legal_basis",
    "search_program_graph",
)

NODE_TOOL_NAMES: dict[str, tuple[str, ...]] = {
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

ORCHESTRATION_TOOL_NAMES: tuple[str, ...] = ("request_targeted_reanalysis",)

NON_MODEL_FLOW_STEPS: tuple[str, ...] = (
    "wizard_needs_input",
    "wizard_resume",
    "needs_input",
    "resume",
    "gate",
    "gap",
    "report",
)
