"""Canonical Assessment Interview runtime contract helpers.

This module contains orchestration guardrails around Interview Agent decisions.
The Interview Agent owns Customer-facing question selection, clarification strategy,
and sufficiency reasoning; these helpers only validate false-ready/false-resolved
states, stale continuation tokens, and Root-owned recovery boundaries.
"""

from __future__ import annotations

from dataclasses import dataclass, field, replace
from typing import Any, Literal


InterviewOutcome = Literal[
    "WAITING_FOR_CUSTOMER",
    "CONTEXT_READY",
    "CONTEXT_RESOLVED",
    "BLOCKED_OR_UNRESOLVED",
    "FAILED",
]
QuestionIntent = Literal["ASK", "CLARIFY"]
CoverageState = Literal["READY", "PARTIAL", "UNAVAILABLE"]
ContextAuthority = Literal[
    "CUSTOMER_STATED",
    "UNCERTAIN",
    "CONFLICTED",
    "CUSTOMER_CONFIRMED",
    "CONFIRMED",
    "SUPERSEDED",
]


@dataclass(frozen=True)
class TechnicalCoverage:
    state: CoverageState
    limitations: tuple[str, ...] = ()
    missing_evidence_refs: tuple[str, ...] = ()


@dataclass(frozen=True)
class InterviewQuestion:
    id: str
    intent: QuestionIntent
    prompt: str
    need_id: str | None = None
    control: str = "FREE_TEXT"


@dataclass(frozen=True)
class CustomerContextRevision:
    revision: int
    facts: dict[str, Any]
    authority: ContextAuthority
    confirmed_by_actor_id: str | None = None


@dataclass(frozen=True)
class BusinessContextNeed:
    need_id: str
    business_context_need: str
    resolution_criteria: tuple[str, ...]
    originating_investigation_reference: str
    affected_rule_ids: tuple[str, ...]


@dataclass(frozen=True)
class InvestigatorContinuation:
    token: str
    originating_investigation_reference: str
    investigator_execution_id: str
    affected_rule_ids: tuple[str, ...]
    artifact_versions: dict[str, str]
    consumed: bool = False


@dataclass(frozen=True)
class InterviewAgentDecision:
    outcome: InterviewOutcome
    active_question: InterviewQuestion | None = None
    confirmed_context: dict[str, Any] = field(default_factory=dict)
    context_revision: int = 0
    flags: tuple[str, ...] = ()
    blocked_actions: tuple[str, ...] = ()
    rationale: str | None = None


@dataclass(frozen=True)
class InterviewRuntimeState:
    outcome: InterviewOutcome
    active_question: InterviewQuestion | None = None
    confirmed_context: dict[str, Any] = field(default_factory=dict)
    context_revision: int = 0
    coverage_limitations: tuple[str, ...] = ()
    missing_evidence_is_absence_proof: bool = False
    flags: tuple[str, ...] = ()
    blocked_actions: tuple[str, ...] = ()
    orchestration_recovery_required: bool = False
    planner_can_start: bool = False
    engineering_rule_can_start: bool = False
    interview_payload: dict[str, Any] = field(default_factory=dict)
    resume: dict[str, Any] | None = None


def initial_interview(
    *,
    coverage: TechnicalCoverage,
    customer_revisions: tuple[CustomerContextRevision, ...],
    agent_decision: InterviewAgentDecision | None = None,
) -> InterviewRuntimeState:
    """Apply protected initial-Interview guardrails to an agent-authored decision."""
    if coverage.state == "UNAVAILABLE":
        raise ValueError("UNAVAILABLE coverage requires Root Orchestration recovery before Interview")

    latest = customer_revisions[-1] if customer_revisions else None
    if agent_decision is None:
        return InterviewRuntimeState(
            outcome="WAITING_FOR_CUSTOMER",
            coverage_limitations=coverage.limitations,
            flags=("INTERVIEW_AGENT_DECISION_REQUIRED",),
        )

    if agent_decision.outcome == "CONTEXT_READY":
        _assert_authoritative_revision(latest, "CONTEXT_READY")
        return InterviewRuntimeState(
            outcome="CONTEXT_READY",
            confirmed_context=dict(latest.facts if latest else agent_decision.confirmed_context),
            context_revision=latest.revision if latest else agent_decision.context_revision,
            coverage_limitations=coverage.limitations,
            missing_evidence_is_absence_proof=False,
            planner_can_start=True,
            engineering_rule_can_start=True,
            interview_payload=_decision_payload(agent_decision),
        )

    return _waiting_or_blocked(agent_decision, coverage_limitations=coverage.limitations)


def targeted_interview(
    *,
    need: BusinessContextNeed,
    continuation: InvestigatorContinuation,
    customer_revisions: tuple[CustomerContextRevision, ...],
    agent_decision: InterviewAgentDecision | None = None,
) -> InterviewRuntimeState:
    """Apply targeted-Interview guardrails to an agent-authored sufficiency decision."""
    latest = customer_revisions[-1] if customer_revisions else None
    payload = {
        "needId": need.need_id,
        "businessContextNeed": need.business_context_need,
        "resolutionCriteria": list(need.resolution_criteria),
        "originatingInvestigationReference": need.originating_investigation_reference,
    }

    if agent_decision is None:
        return InterviewRuntimeState(
            outcome="WAITING_FOR_CUSTOMER",
            flags=("INTERVIEW_AGENT_DECISION_REQUIRED",),
            interview_payload=payload,
        )

    if agent_decision.outcome == "CONTEXT_RESOLVED":
        _assert_authoritative_revision(latest, "CONTEXT_RESOLVED")
        _assert_resolution_criteria_satisfied(need, latest)
        return InterviewRuntimeState(
            outcome="CONTEXT_RESOLVED",
            confirmed_context=dict(latest.facts if latest else agent_decision.confirmed_context),
            context_revision=latest.revision if latest else agent_decision.context_revision,
            flags=tuple(sorted({"DOWNSTREAM_IMPACT", *agent_decision.flags})),
            interview_payload={**payload, **_decision_payload(agent_decision)},
            resume={
                "investigatorExecutionId": continuation.investigator_execution_id,
                "originatingInvestigationReference": continuation.originating_investigation_reference,
                "affectedRuleIds": list(continuation.affected_rule_ids),
            },
        )

    state = _waiting_or_blocked(agent_decision)
    return replace(state, interview_payload={**payload, **state.interview_payload})


def validate_continuation(
    *,
    need: BusinessContextNeed,
    continuation: InvestigatorContinuation,
    current_artifact_versions: dict[str, str],
) -> InvestigatorContinuation:
    """Root Orchestration validates origin, freshness and one-shot resume."""
    if continuation.consumed:
        raise ValueError("duplicate continuation cannot be resumed")
    if (
        continuation.originating_investigation_reference
        != need.originating_investigation_reference
    ):
        raise ValueError("continuation origin does not match business context need")
    if continuation.affected_rule_ids != need.affected_rule_ids:
        raise ValueError("continuation affected rule scope changed")
    if continuation.artifact_versions != current_artifact_versions:
        raise ValueError("stale continuation requires orchestration revalidation")
    return replace(continuation, consumed=True)


def _assert_authoritative_revision(
    revision: CustomerContextRevision | None,
    outcome: str,
) -> None:
    if revision is None or revision.authority not in {"CUSTOMER_CONFIRMED", "CONFIRMED"}:
        raise ValueError(f"{outcome} requires an authoritative Customer context revision")


def _assert_resolution_criteria_satisfied(
    need: BusinessContextNeed,
    revision: CustomerContextRevision | None,
) -> None:
    facts = revision.facts if revision else {}
    missing = [
        str(item)
        for item in need.resolution_criteria
        if str(item) not in {str(key) for key in facts}
    ]
    if missing:
        raise ValueError(
            f"CONTEXT_RESOLVED requires satisfied resolution criteria: missing={missing}"
        )


def _waiting_or_blocked(
    decision: InterviewAgentDecision,
    *,
    coverage_limitations: tuple[str, ...] = (),
) -> InterviewRuntimeState:
    if decision.outcome == "BLOCKED_OR_UNRESOLVED":
        return InterviewRuntimeState(
            outcome="BLOCKED_OR_UNRESOLVED",
            blocked_actions=decision.blocked_actions
            or ("PROVIDE_MORE_CONTEXT", "CHECK_INTERNALLY", "SAVE_AND_EXIT"),
            coverage_limitations=coverage_limitations,
            interview_payload=_decision_payload(decision),
        )
    if decision.outcome != "WAITING_FOR_CUSTOMER" or decision.active_question is None:
        raise ValueError("Interview Agent must ask, block, or provide guarded authoritative context")
    return InterviewRuntimeState(
        outcome="WAITING_FOR_CUSTOMER",
        active_question=decision.active_question,
        coverage_limitations=coverage_limitations,
        interview_payload=_decision_payload(decision),
    )


def _decision_payload(decision: InterviewAgentDecision) -> dict[str, Any]:
    payload: dict[str, Any] = {}
    if decision.rationale:
        payload["agentRationale"] = decision.rationale
    return payload


__all__ = [
    "BusinessContextNeed",
    "CustomerContextRevision",
    "InterviewAgentDecision",
    "InterviewQuestion",
    "InterviewRuntimeState",
    "InvestigatorContinuation",
    "TechnicalCoverage",
    "initial_interview",
    "targeted_interview",
    "validate_continuation",
]
