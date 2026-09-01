"""Structured specialist handoff contracts for LCSP Managed Deep Agents."""

from __future__ import annotations

from typing import Any, Literal, Self

from pydantic import BaseModel, ConfigDict, Field, model_validator

from tools.common.capabilities.assessment.claims.evidence_claim.models import EvidenceClaim


class GraphSeed(BaseModel):
    model_config = ConfigDict(extra="forbid")

    ref: str = Field(min_length=1, max_length=240)
    criterion: str = Field(min_length=1, max_length=500)
    rationale: str | None = Field(default=None, max_length=1_000)


class ProvenanceRef(BaseModel):
    """Stable model-facing reference to governed evidence/provenance."""

    model_config = ConfigDict(extra="forbid")

    ref: str = Field(min_length=1, max_length=240)
    source_kind: Literal["PROGRAM_GRAPH", "SOURCE_ANCHOR", "WIZARD", "LEGAL_CHUNK", "SYSTEM"]
    artifact_version: str | None = Field(default=None, max_length=240)
    source_anchor_ref: str | None = Field(default=None, max_length=240)


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


class InvestigatorClaim(BaseModel):
    """Model-facing equivalent of the deterministic EvidenceClaim dataclass."""

    model_config = ConfigDict(extra="forbid")

    claim_id: str = Field(min_length=1, max_length=160)
    engineering_rule_id: str = Field(min_length=1, max_length=160)
    claim_type: Literal[
        "RULE_REQUIREMENT_MET",
        "RULE_REQUIREMENT_NOT_MET",
        "UNRESOLVED_ENGINEERING_FACT",
    ]
    value: bool | None
    evidence_refs: list[str] = Field(default_factory=list, max_length=100)
    graph_path_refs: list[str] = Field(default_factory=list, max_length=100)
    source_anchor_refs: list[str] = Field(default_factory=list, max_length=100)
    confidence: float = Field(ge=0, le=1)
    limitations: list[str] = Field(default_factory=list, max_length=50)
    criterion: str | None = Field(default=None, max_length=500)

    def to_evidence_claim(self) -> EvidenceClaim:
        return EvidenceClaim(
            claim_id=self.claim_id,
            engineering_rule_id=self.engineering_rule_id,
            claim_type=self.claim_type,
            value=self.value,
            evidence_refs=tuple(self.evidence_refs),
            graph_path_refs=tuple(self.graph_path_refs),
            source_anchor_refs=tuple(self.source_anchor_refs),
            confidence=self.confidence,
            limitations=tuple(self.limitations),
            criterion=self.criterion,
        )


class InvestigatorResult(BaseModel):
    """Typed Investigator-to-deterministic-gate handoff."""

    model_config = ConfigDict(extra="forbid")

    status: Literal["READY", "NEEDS_INPUT"]
    artifact_versions: dict[str, str] = Field(min_length=1, max_length=20)
    claims: list[InvestigatorClaim] = Field(default_factory=list, max_length=200)
    limitations: list[str] = Field(default_factory=list, max_length=100)
    missing_input: str | None = Field(default=None, max_length=1_000)
    next_step: Literal["GATE", "RESOLVE"]

    @model_validator(mode="after")
    def validate_transition(self) -> Self:
        if self.status == "READY":
            if self.next_step != "GATE":
                raise ValueError("READY Investigator output must transition to GATE")
            if not self.claims:
                raise ValueError("READY Investigator output requires claims")
            if self.missing_input:
                raise ValueError("READY Investigator output cannot carry missing_input")
            return self
        if self.next_step != "RESOLVE":
            raise ValueError("NEEDS_INPUT Investigator output must transition to RESOLVE")
        if not self.missing_input:
            raise ValueError("NEEDS_INPUT Investigator output requires missing_input")
        return self


class ResolverConflict(BaseModel):
    model_config = ConfigDict(extra="forbid")

    source: Literal["WIZARD", "REPOSITORY", "USER_CONFIRMATION", "UNKNOWN"]
    value: Any | None = None
    source_refs: list[str] = Field(default_factory=list, max_length=50)


class ResolverResult(BaseModel):
    """Typed Resolver-to-root handoff."""

    model_config = ConfigDict(extra="forbid")

    status: Literal["RESOLVED", "CONFLICT", "NEEDS_INPUT"]
    fact_key: str = Field(min_length=1, max_length=240)
    resolved_value: Any | None = None
    conflicting_values: list[ResolverConflict] = Field(default_factory=list, max_length=20)
    source_refs: list[str] = Field(default_factory=list, max_length=50)
    can_resume_existing_plan: bool

    @model_validator(mode="after")
    def validate_resolution(self) -> Self:
        if self.status == "RESOLVED" and self.resolved_value is None:
            raise ValueError("RESOLVED Resolver output requires resolved_value")
        if self.status == "RESOLVED" and not self.can_resume_existing_plan:
            raise ValueError("RESOLVED Resolver output must resume the existing plan")
        if self.status == "CONFLICT" and not self.conflicting_values:
            raise ValueError("CONFLICT Resolver output requires conflicting_values")
        if self.status == "NEEDS_INPUT" and self.can_resume_existing_plan:
            raise ValueError("NEEDS_INPUT Resolver output cannot resume the existing plan")
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
    "planner": PlannerResult,
    "investigator": InvestigatorResult,
    "resolver": ResolverResult,
    "triage": TriageResult,
}


__all__ = [
    "GraphSeed",
    "InvestigatorClaim",
    "InvestigatorResult",
    "PlannerResult",
    "ProvenanceRef",
    "ResolverConflict",
    "ResolverResult",
    "SPECIALIST_RESPONSE_FORMATS",
    "TriageResult",
]
