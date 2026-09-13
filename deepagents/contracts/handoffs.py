"""Structured specialist handoff contracts for LCSP Managed Deep Agents."""

from __future__ import annotations

import re
from typing import Any, Literal, Self

from pydantic import BaseModel, ConfigDict, Field, model_validator

from tools.common.capabilities.assessment.claims.evidence_claim.models import (
    ENGINEERING_EVIDENCE_CLAIM_TYPES,
    ENGINEERING_LIMITATION_CODES,
    MODEL_SELECTABLE_LIMITATION_CODES,
    EvidenceClaim,
)


_TARGETED_TEXT_LEAK_PATTERNS = (
    re.compile(r"\bEngineeringRule\b", re.IGNORECASE),
    re.compile(r"\bLegalRule\b", re.IGNORECASE),
    re.compile(r"\bcompliance classification\b", re.IGNORECASE),
    re.compile(r"\bEU AI Act\b", re.IGNORECASE),
    re.compile(r"\brisk category\b", re.IGNORECASE),
    re.compile(r"\b(?:ENG|ER|LR)-\d+\b", re.IGNORECASE),
    re.compile(r"\bcheckpoint(?:Id)?\b", re.IGNORECASE),
    re.compile(r"\bcontinuation(?: token)?\b", re.IGNORECASE),
    re.compile(r"\bLangGraph\b", re.IGNORECASE),
    re.compile(r"\bthread(?:Id)?\b", re.IGNORECASE),
    re.compile(
        r"\b[a-z0-9_.-]+/[a-z0-9_./-]+\.(?:ts|tsx|js|jsx|py|java|go|rs)\b",
        re.IGNORECASE,
    ),
)

MODEL_AUTHORED_INVESTIGATOR_LIMITATION_CODES = frozenset(
    MODEL_SELECTABLE_LIMITATION_CODES
)
_INVESTIGATOR_LIMITATION_CODE_VALUES = (
    *MODEL_SELECTABLE_LIMITATION_CODES,
    ENGINEERING_LIMITATION_CODES["engineering_investigation_failed"],
)
SYSTEM_AUTHORED_INVESTIGATOR_LIMITATION_CODES = frozenset(
    _INVESTIGATOR_LIMITATION_CODE_VALUES
)
SYSTEM_FAILED_INVESTIGATOR_CLAIM_PREFIX = "claim:failed:"


def _assert_neutral_targeted_text(*values: str | None) -> None:
    for value in values:
        if not value:
            continue
        if any(pattern.search(value) for pattern in _TARGETED_TEXT_LEAK_PATTERNS):
            raise ValueError(
                "targeted business-context text must not expose internal rule, legal, or checkpoint details"
            )


class GraphSeed(BaseModel):
    model_config = ConfigDict(extra="forbid")

    ref: str = Field(min_length=1, max_length=240)
    criterion: str = Field(min_length=1, max_length=500)
    rationale: str | None = Field(default=None, max_length=1_000)


class ProvenanceRef(BaseModel):
    """Stable model-facing reference to governed evidence/provenance."""

    model_config = ConfigDict(extra="forbid")

    ref: str = Field(min_length=1, max_length=240)
    source_kind: Literal["PROGRAM_GRAPH", "SOURCE_ANCHOR", "CUSTOMER_CONTEXT", "LEGAL_CHUNK", "SYSTEM"]
    artifact_version: str | None = Field(default=None, max_length=240)
    source_anchor_ref: str | None = Field(default=None, max_length=240)


class InterviewQuestionChoice(BaseModel):
    """One bounded Customer-facing Interview choice."""

    model_config = ConfigDict(extra="forbid")

    id: str = Field(min_length=1, max_length=160)
    label: str = Field(min_length=1, max_length=500)
    description: str | None = Field(default=None, max_length=1_000)
    requiresFreeText: bool = False


class InterviewFrontierResult(BaseModel):
    """Structured customer/technical frontier supporting the question."""

    model_config = ConfigDict(extra="forbid")

    owner: Literal["CUSTOMER", "TECHNICAL", "SYSTEM"]
    materiality: Literal["MATERIAL", "NON_MATERIAL"]
    description: str = Field(min_length=1, max_length=2_000)
    evidenceRefs: list[str] = Field(default_factory=list, max_length=50)


class InterviewQuestionResult(BaseModel):
    """Interview Agent-authored bounded Customer-facing question."""

    model_config = ConfigDict(extra="forbid")

    id: str = Field(min_length=1, max_length=240)
    intent: Literal["ASK", "CLARIFY"]
    control: Literal[
        "FREE_TEXT", "BOOLEAN", "SINGLE_SELECT", "MULTI_SELECT", "CONFIRM_ADJUST"
    ]
    prompt: str = Field(min_length=1, max_length=2_000)
    choices: list[InterviewQuestionChoice] = Field(default_factory=list, max_length=20)
    priorAnswerSummary: str | None = Field(default=None, max_length=1_000)
    proposedInterpretation: str | None = Field(default=None, max_length=2_000)
    whyEvidenceRefs: list[str] = Field(default_factory=list, max_length=50)
    whyAreWeAsking: str | None = Field(default=None, max_length=2_000)
    frontier: InterviewFrontierResult | None = None
    needId: str | None = Field(default=None, max_length=240)

    @model_validator(mode="after")
    def validate_control_shape(self) -> Self:
        if self.control in {"SINGLE_SELECT", "MULTI_SELECT"} and not self.choices:
            raise ValueError("select Interview controls require choices")
        if self.control == "BOOLEAN" and self.choices:
            raise ValueError("BOOLEAN Interview controls must not carry custom choices")
        if self.control == "CONFIRM_ADJUST":
            if self.intent != "CLARIFY":
                raise ValueError("CONFIRM_ADJUST Interview controls require CLARIFY intent")
            if not self.proposedInterpretation:
                raise ValueError("CONFIRM_ADJUST Interview controls require proposedInterpretation")
            choices_by_id = {choice.id: choice for choice in self.choices}
            if set(choices_by_id) != {"CONFIRM", "ADJUST"}:
                raise ValueError(
                    "CONFIRM_ADJUST Interview controls require CONFIRM and ADJUST choices"
                )
            if choices_by_id["CONFIRM"].requiresFreeText:
                raise ValueError("CONFIRM choice must not require free text")
            if not choices_by_id["ADJUST"].requiresFreeText:
                raise ValueError("ADJUST choice must require free text")
        return self


class InterviewStatementCandidate(BaseModel):
    """Semantic statement candidate; authoritative provenance is API-owned."""

    model_config = ConfigDict(extra="allow")
    statementId: str = Field(min_length=1, pattern=r"\S")
    topic: str = Field(min_length=1, pattern=r"\S")
    statement: str = Field(min_length=1, pattern=r"\S")
    evidenceRefs: list[str] = Field(default_factory=list)
    normalizedValue: Any = None
    scope: dict[str, Any] | str | None = None


class InterviewContextCandidate(BaseModel):
    """Statement envelope shared by model output and API materialization."""

    model_config = ConfigDict(extra="allow")
    statements: list[InterviewStatementCandidate] = Field(default_factory=list)


class InterviewResult(BaseModel):
    """Typed Interview Agent candidate decision before protected API guard persistence."""

    model_config = ConfigDict(extra="forbid")

    expectedContextRevision: int = Field(ge=0)
    mode: Literal["INITIAL_INTERVIEW", "INVESTIGATOR_RESOLUTION"] = "INITIAL_INTERVIEW"
    outcome: Literal[
        "WAITING_FOR_CUSTOMER",
        "CONTEXT_READY",
        "CONTEXT_RESOLVED",
        "BLOCKED_OR_UNRESOLVED",
        "FAILED",
    ]
    activeQuestion: InterviewQuestionResult | None = None
    contextAuthority: Literal[
        "CUSTOMER_STATED",
        "UNCERTAIN",
        "CONFLICTED",
        "CUSTOMER_CONFIRMED",
        "CONFIRMED",
        "SUPERSEDED",
    ] | None = None
    confirmedContext: InterviewContextCandidate = Field(default_factory=InterviewContextCandidate)
    flags: list[Literal["DOWNSTREAM_IMPACT"]] = Field(default_factory=list, max_length=10)
    blockedActions: list[
        Literal["PROVIDE_MORE_CONTEXT", "CHECK_INTERNALLY", "SAVE_AND_EXIT"]
    ] = Field(default_factory=list, max_length=3)
    targetedResolution: dict[str, Any] = Field(default_factory=dict)
    rationale: str | None = Field(default=None, max_length=2_000)

    @model_validator(mode="after")
    def validate_transition_shape(self) -> Self:
        if self.contextAuthority in {"CUSTOMER_CONFIRMED", "CONFIRMED"} and not self.confirmedContext.statements:
            raise ValueError("Confirmed authority requires non-empty confirmedContext.statements")
        if self.activeQuestion is not None and self.outcome != "WAITING_FOR_CUSTOMER":
            raise ValueError("activeQuestion requires WAITING_FOR_CUSTOMER outcome")
        if self.outcome == "WAITING_FOR_CUSTOMER":
            if self.activeQuestion is None:
                raise ValueError("WAITING_FOR_CUSTOMER requires activeQuestion")
            if self.activeQuestion.frontier is None:
                raise ValueError("WAITING_FOR_CUSTOMER activeQuestion requires a structured frontier")
            if (
                self.activeQuestion.frontier.owner != "CUSTOMER"
                or self.activeQuestion.frontier.materiality != "MATERIAL"
            ):
                raise ValueError(
                    "Customer question requires CUSTOMER-owned MATERIAL frontier"
                )
        if self.outcome == "BLOCKED_OR_UNRESOLVED" and not self.blockedActions:
            self.blockedActions = [
                "PROVIDE_MORE_CONTEXT",
                "CHECK_INTERNALLY",
                "SAVE_AND_EXIT",
            ]
        if self.outcome == "CONTEXT_RESOLVED" and self.mode != "INVESTIGATOR_RESOLUTION":
            raise ValueError("CONTEXT_RESOLVED is only valid for INVESTIGATOR_RESOLUTION")
        return self


class PlannerResult(BaseModel):
    """Typed Planner-to-root handoff."""

    model_config = ConfigDict(extra="forbid")

    status: Literal["INVESTIGATE", "NEEDS_INPUT"]
    engineering_rule_ids: list[str] = Field(min_length=1, max_length=100)
    artifact_versions: dict[str, str] = Field(min_length=1, max_length=20)
    coverage_state: Literal["COMPLETE", "LIMITED", "OUT_OF_COVERAGE", "UNKNOWN"]
    selected_scope: list[GraphSeed] = Field(default_factory=list, max_length=100)
    unresolved_facts: list[str] = Field(default_factory=list, max_length=20)
    next_step: Literal["INVESTIGATE", "RESOLVE"]

    @model_validator(mode="after")
    def validate_transition(self) -> Self:
        if self.status == "INVESTIGATE":
            if self.next_step != "INVESTIGATE":
                raise ValueError("INVESTIGATE Planner output must transition to INVESTIGATE")
            if not self.selected_scope:
                raise ValueError("INVESTIGATE Planner output requires selected_scope")
            return self
        if self.next_step != "RESOLVE":
            raise ValueError("NEEDS_INPUT Planner output must transition to RESOLVE")
        if not self.unresolved_facts:
            raise ValueError("NEEDS_INPUT Planner output requires unresolved_facts")
        return self


class _InvestigatorClaimIdentity(BaseModel):
    """Shared identity/limitation fields for every Investigator claim shape.

    Every per-claim_type variant below inherits this instead of repeating it, so
    `claim_id`/`engineering_rule_id` and the model-vs-system limitation-code narrowing stay
    in exactly one place. `limitations` lives here too (all four shapes may carry coverage
    limitation codes); only UNRESOLVED overrides it with `min_length=1`.
    """

    model_config = ConfigDict(extra="forbid")

    claim_id: str = Field(min_length=1, max_length=160)
    engineering_rule_id: str = Field(min_length=1, max_length=160)
    # See _INVESTIGATOR_LIMITATION_CODE_VALUES: the system-authored
    # ENGINEERING_INVESTIGATION_FAILED code is included so
    # managed_targeted_investigator._failed_investigator_handoff's synthetic
    # "claim:failed:"-prefixed fallback still validates through this same model. The
    # validator below narrows a *model*-authored claim to the 5-code subset.
    limitations: list[Literal[*_INVESTIGATOR_LIMITATION_CODE_VALUES]] = Field(
        default_factory=list, max_length=50
    )

    @model_validator(mode="after")
    def validate_limitation_code_origin(self) -> Self:
        allowed = (
            SYSTEM_AUTHORED_INVESTIGATOR_LIMITATION_CODES
            if self.claim_id.startswith(SYSTEM_FAILED_INVESTIGATOR_CLAIM_PREFIX)
            else MODEL_AUTHORED_INVESTIGATOR_LIMITATION_CODES
        )
        invalid = sorted({code for code in self.limitations if code not in allowed})
        if invalid:
            raise ValueError(
                f"Investigator claim limitations contain unsupported codes: {invalid}"
            )
        return self


class _InvestigatorDecidedClaim(_InvestigatorClaimIdentity):
    """Shared shape for RULE_REQUIREMENT_MET / RULE_REQUIREMENT_NOT_MET.

    `criterion` and `confidence` are required (no default) here, structurally — a decided
    claim missing either is unrepresentable rather than merely rejected after the fact.
    The one obligation that genuinely cannot be a single field's own constraint is "at
    least one of these three ref lists is non-empty": that is an OR across siblings, which
    JSON Schema (and Gemini's schema support in particular) has no keyword for even with a
    discriminated union, so it stays a `model_validator`.
    """

    criterion: str = Field(min_length=1, max_length=500)
    confidence: float = Field(gt=0, le=1)
    evidence_refs: list[str] = Field(default_factory=list, max_length=100)
    graph_path_refs: list[str] = Field(default_factory=list, max_length=100)
    source_anchor_refs: list[str] = Field(default_factory=list, max_length=100)

    @model_validator(mode="after")
    def validate_has_ref(self) -> Self:
        if not (self.evidence_refs or self.graph_path_refs or self.source_anchor_refs):
            raise ValueError(
                "decided Investigator claims require at least one evidence, graph-path, or source-anchor ref"
            )
        return self

    def to_evidence_claim(self) -> EvidenceClaim:
        return EvidenceClaim(
            claim_id=self.claim_id,
            engineering_rule_id=self.engineering_rule_id,
            claim_type=self.claim_type,
            value=self.value,
            evidence_refs=tuple(self.evidence_refs),
            graph_path_refs=tuple(self.graph_path_refs),
            source_anchor_refs=tuple(self.source_anchor_refs),
            customer_context_refs=(),
            confidence=self.confidence,
            limitations=tuple(self.limitations),
            criterion=self.criterion,
        )


class InvestigatorRequirementMetClaim(_InvestigatorDecidedClaim):
    """RULE_REQUIREMENT_MET: the criterion IS satisfied."""

    claim_type: Literal[ENGINEERING_EVIDENCE_CLAIM_TYPES["requirement_met"]]
    value: Literal[True]


class InvestigatorRequirementNotMetClaim(_InvestigatorDecidedClaim):
    """RULE_REQUIREMENT_NOT_MET: the criterion is NOT satisfied."""

    claim_type: Literal[ENGINEERING_EVIDENCE_CLAIM_TYPES["requirement_not_met"]]
    value: Literal[False]


class InvestigatorUnresolvedClaim(_InvestigatorClaimIdentity):
    """UNRESOLVED_ENGINEERING_FACT: technical evidence cannot decide the criterion.

    `limitations` overrides the identity base's field with `min_length=1` — the exact
    field that produced the real-run failure this shape exists to close. It is a plain
    field constraint now, not a post-hoc "empty list" check: an empty `limitations` is not
    a representable UNRESOLVED claim.
    """

    claim_type: Literal[ENGINEERING_EVIDENCE_CLAIM_TYPES["unresolved"]]
    value: None = None
    criterion: str | None = Field(default=None, max_length=500)
    confidence: float = Field(ge=0, le=1)
    evidence_refs: list[str] = Field(default_factory=list, max_length=100)
    graph_path_refs: list[str] = Field(default_factory=list, max_length=100)
    source_anchor_refs: list[str] = Field(default_factory=list, max_length=100)
    limitations: list[Literal[*_INVESTIGATOR_LIMITATION_CODE_VALUES]] = Field(
        min_length=1, max_length=50
    )

    def to_evidence_claim(self) -> EvidenceClaim:
        return EvidenceClaim(
            claim_id=self.claim_id,
            engineering_rule_id=self.engineering_rule_id,
            claim_type=self.claim_type,
            value=self.value,
            evidence_refs=tuple(self.evidence_refs),
            graph_path_refs=tuple(self.graph_path_refs),
            source_anchor_refs=tuple(self.source_anchor_refs),
            customer_context_refs=(),
            confidence=self.confidence,
            limitations=tuple(self.limitations),
            criterion=self.criterion,
        )


class InvestigatorScopeNotApplicableClaim(_InvestigatorClaimIdentity):
    """RULE_SCOPE_NOT_APPLICABLE: the EngineeringRule does not apply to this system.

    `customer_context_refs` is required (`min_length=1`) rather than checked after the
    fact, and `evidence_refs`/`graph_path_refs`/`source_anchor_refs` are declared with
    `max_length=0` rather than omitted: omitting the fields entirely would make even an
    explicit `[]` (a completely reasonable caller default) an "extra fields not permitted"
    error, while `max_length=0` structurally forces them empty without forbidding the key.
    `relax_array_upper_bounds` preserves `maxItems: 0` for exactly this reason.
    """

    claim_type: Literal[ENGINEERING_EVIDENCE_CLAIM_TYPES["rule_scope_not_applicable"]]
    value: None = None
    criterion: str | None = Field(default=None, max_length=500)
    confidence: float = Field(ge=0, le=1)
    evidence_refs: list[str] = Field(default_factory=list, max_length=0)
    graph_path_refs: list[str] = Field(default_factory=list, max_length=0)
    source_anchor_refs: list[str] = Field(default_factory=list, max_length=0)
    customer_context_refs: list[str] = Field(min_length=1, max_length=100)

    def to_evidence_claim(self) -> EvidenceClaim:
        return EvidenceClaim(
            claim_id=self.claim_id,
            engineering_rule_id=self.engineering_rule_id,
            claim_type=self.claim_type,
            value=self.value,
            evidence_refs=(),
            graph_path_refs=(),
            source_anchor_refs=(),
            customer_context_refs=tuple(self.customer_context_refs),
            confidence=self.confidence,
            limitations=tuple(self.limitations),
            criterion=self.criterion,
        )


# Plain `Union` (no `Field(discriminator=...)`): pydantic renders this as JSON Schema
# `anyOf`, not `oneOf` + a `discriminator` extension. `langchain_google_genai` has
# explicit, tested handling for `anyOf` in its schema conversion; it has none at all for
# `oneOf`/`discriminator` (verified against the installed library — see
# test_investigator_claim_union_uses_anyof_not_oneof_discriminator). `InvestigatorClaim`
# stays the public name so every existing import/type-hint keeps working unchanged; it is
# no longer directly instantiable as a class, only usable as a type/annotation — the four
# concrete classes above are what callers and tests construct.
InvestigatorClaim = (
    InvestigatorRequirementMetClaim
    | InvestigatorRequirementNotMetClaim
    | InvestigatorUnresolvedClaim
    | InvestigatorScopeNotApplicableClaim
)


class BusinessContextNeed(BaseModel):
    """Bounded Investigator-authored business-context need for Targeted Interview."""

    model_config = ConfigDict(extra="forbid")

    need_id: str = Field(min_length=1, max_length=240)
    business_context_need: str = Field(min_length=1, max_length=2_000)
    resolution_criteria: list[str] = Field(min_length=1, max_length=20)
    why_needed: str | None = Field(default=None, max_length=1_000)
    governed_evidence_refs: list[str] = Field(default_factory=list, max_length=50)

    @model_validator(mode="after")
    def validate_customer_safe_text(self) -> Self:
        _assert_neutral_targeted_text(
            self.business_context_need,
            self.why_needed,
            *self.resolution_criteria,
        )
        return self


class InvestigatorResult(BaseModel):
    """Typed Investigator-to-deterministic-gate handoff."""

    model_config = ConfigDict(extra="forbid")

    status: Literal["READY", "NEEDS_INPUT"]
    artifact_versions: dict[str, str] = Field(min_length=1, max_length=20)
    claims: list[InvestigatorClaim] = Field(default_factory=list, max_length=200)
    limitations: list[str] = Field(default_factory=list, max_length=100)
    missing_input: str | None = Field(default=None, max_length=1_000)
    business_context_need: BusinessContextNeed | None = None
    next_step: Literal["GATE", "RESOLVE"]

    @model_validator(mode="after")
    def validate_transition(self) -> Self:
        if self.status == "READY":
            if self.next_step != "GATE":
                raise ValueError("READY Investigator output must transition to GATE")
            if not self.claims:
                raise ValueError("READY Investigator output requires claims")
            if self.missing_input or self.business_context_need is not None:
                raise ValueError("READY Investigator output cannot carry business-context input")
            return self
        if self.next_step != "RESOLVE":
            raise ValueError("NEEDS_INPUT Investigator output must transition to RESOLVE")
        if not self.missing_input or self.business_context_need is None:
            raise ValueError("NEEDS_INPUT Investigator output requires a bounded business_context_need")
        return self


class ResolverConflictValue(BaseModel):
    """One source value participating in a Resolver handoff."""

    model_config = ConfigDict(extra="forbid")

    source: Literal["CUSTOMER_CONTEXT", "PROGRAM_GRAPH", "INVESTIGATOR", "UNKNOWN"]
    value: Any = None
    source_refs: list[str] = Field(default_factory=list, max_length=100)


class ResolverResult(BaseModel):
    """Typed Resolver-to-root handoff for pre-Interview unresolved context."""

    model_config = ConfigDict(extra="forbid")

    status: Literal["RESOLVED", "CONFLICT", "NEEDS_INPUT"]
    fact_key: str = Field(min_length=1, max_length=240)
    resolved_value: Any = None
    conflicting_values: list[ResolverConflictValue] = Field(default_factory=list, max_length=50)
    source_refs: list[str] = Field(default_factory=list, max_length=100)
    can_resume_existing_plan: bool = False

    @model_validator(mode="after")
    def validate_transition(self) -> Self:
        if self.status == "CONFLICT" and not self.conflicting_values:
            raise ValueError("CONFLICT Resolver output requires conflicting_values")
        if self.status == "RESOLVED" and self.resolved_value is None:
            raise ValueError("RESOLVED Resolver output requires resolved_value")
        if self.status == "NEEDS_INPUT" and self.can_resume_existing_plan:
            raise ValueError("NEEDS_INPUT Resolver output cannot resume existing plan")
        return self


class TriageResult(BaseModel):
    """Typed Legal Triage-to-root handoff."""

    model_config = ConfigDict(extra="forbid")

    status: Literal["READY", "PARTIAL", "NEEDS_INPUT", "ALREADY_RUNNING", "FAILED"]
    triage_execution_id: str | None = Field(default=None, max_length=240)
    trigger: Literal["SCHEDULED", "ENGINEERING_RULE_NOT_READY"] | None = None
    idempotency_key: str | None = Field(default=None, max_length=240)
    legal_rule_catalog_version_id: str | None = Field(default=None, max_length=240)
    legal_corpus_version_id: str | None = Field(default=None, max_length=240)
    triaged_rule_ids: list[str] = Field(default_factory=list, max_length=500)
    candidate_chunk_ids: list[str] = Field(default_factory=list, max_length=1_000)
    context_only_chunk_ids: list[str] = Field(default_factory=list, max_length=1_000)
    rejected_chunk_ids: list[str] = Field(default_factory=list, max_length=1_000)
    engineering_rule_ids: list[str] = Field(default_factory=list, max_length=500)
    limitations: list[str] = Field(default_factory=list, max_length=100)

    @model_validator(mode="after")
    def validate_status_payload(self) -> Self:
        if self.status in {"READY", "PARTIAL"} and not self.triage_execution_id:
            raise ValueError("owned Triage output requires triage_execution_id")
        if self.status == "ALREADY_RUNNING" and not self.triage_execution_id:
            raise ValueError("ALREADY_RUNNING Triage output requires active triage_execution_id")
        if self.status in {"NEEDS_INPUT", "FAILED"} and not self.limitations:
            raise ValueError("blocked Triage output requires limitations")
        return self


SPECIALIST_RESPONSE_FORMATS: dict[str, type[BaseModel]] = {
    "interview": InterviewResult,
    "planner": PlannerResult,
    "investigator": InvestigatorResult,
    "triage": TriageResult,
}


__all__ = [
    "BusinessContextNeed",
    "GraphSeed",
    "InterviewFrontierResult",
    "InterviewQuestionChoice",
    "InterviewQuestionResult",
    "InterviewResult",
    "InvestigatorClaim",
    "InvestigatorRequirementMetClaim",
    "InvestigatorRequirementNotMetClaim",
    "InvestigatorScopeNotApplicableClaim",
    "InvestigatorUnresolvedClaim",
    "InvestigatorResult",
    "PlannerResult",
    "ProvenanceRef",
    "ResolverConflictValue",
    "ResolverResult",
    "SPECIALIST_RESPONSE_FORMATS",
    "TriageResult",
]
