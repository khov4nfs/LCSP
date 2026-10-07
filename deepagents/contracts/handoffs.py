"""Structured specialist handoff contracts for LCSP Deep Agents."""

from __future__ import annotations

from typing import Any, Literal, Self

from pydantic import BaseModel, ConfigDict, Field, model_validator



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


class InterviewSnippetRef(BaseModel):
    """Pinned source locator only; raw source is resolved transiently by the API."""

    model_config = ConfigDict(extra="forbid")

    snapshot_id: str = Field(min_length=1, max_length=240)
    commit_sha: str = Field(min_length=1, max_length=240)
    file_path: str = Field(min_length=1, max_length=1_000)
    symbol: str | None = Field(default=None, max_length=500)
    start_line: int = Field(ge=1)
    end_line: int = Field(ge=1)
    evidence_hash: str = Field(pattern=r"^sha256:[0-9a-fA-F]{64}$")
    snippet_policy: Literal["PINNED_SNAPSHOT_BOUNDED_REDACTED_V1"]

    @model_validator(mode="after")
    def validate_bounded_locator(self) -> Self:
        normalized = self.file_path.replace("\\", "/").lstrip("/")
        if not normalized or ".." in normalized.split("/"):
            raise ValueError("snippetRef file_path must stay inside the pinned snapshot")
        if self.end_line < self.start_line or self.end_line - self.start_line + 1 > 7:
            raise ValueError("snippetRef must address at most seven ordered source lines")
        return self


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
    # Stable source locator/hash only. Raw source is resolved transiently by the API.
    snippetRef: InterviewSnippetRef | None = None
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
    # A targeted condition answer names which of the need's criterion ids it settles. The
    # platform validates it against the need it registered and stamps the condition and
    # need identity itself; this field is the only part the model chooses.
    resolvesCriterionId: str | None = None


class InterviewContextCandidate(BaseModel):
    """Statement envelope shared by model output and API materialization."""

    model_config = ConfigDict(extra="allow")
    statements: list[InterviewStatementCandidate] = Field(default_factory=list)


class InterviewResult(BaseModel):
    """Typed Interview Agent candidate decision before protected API guard persistence."""

    model_config = ConfigDict(extra="forbid")

    expectedContextRevision: int = Field(ge=0)
    mode: Literal["INITIAL_INTERVIEW", "BUSINESS_CONTEXT_RESOLUTION"] = "INITIAL_INTERVIEW"
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
        if self.outcome == "CONTEXT_RESOLVED" and self.mode != "BUSINESS_CONTEXT_RESOLUTION":
            raise ValueError("CONTEXT_RESOLVED is only valid for BUSINESS_CONTEXT_RESOLUTION")
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


SPECIALIST_RESPONSE_FORMATS: dict[str, type[BaseModel]] = {
    "interview": InterviewResult,
}


__all__ = [
    "InterviewFrontierResult",
    "InterviewQuestionChoice",
    "InterviewQuestionResult",
    "InterviewSnippetRef",
    "InterviewResult",
    "ResolverConflictValue",
    "ResolverResult",
    "SPECIALIST_RESPONSE_FORMATS",
]
