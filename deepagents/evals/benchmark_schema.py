"""Pure Pydantic v2 domain schemas for LCSP SWE-bench / tau-bench style evaluation.

No LLM SDKs or database drivers are imported here. All models are immutable
(`frozen=True`) and reject unknown fields (`extra="forbid"`) to preserve
reproducibility and contract integrity across offline, scripted, and live runs.
"""
from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


# Canonical execution modes; offline CI only permits OFFLINE_FIXTURE and SCRIPTED.
ExecutionMode = Literal["OFFLINE_FIXTURE", "SCRIPTED", "LIVE"]
BenchmarkSplit = Literal["DEV", "HOLDOUT"]
StageType = Literal["INITIAL", "WAITING_FOR_HUMAN", "RESUME_FINAL", "FAULT_RECOVERY"]
CaseVerdict = Literal[
    "APPLICABLE_COMPLIANT",
    "APPLICABLE_NON_COMPLIANT",
    "NOT_APPLICABLE",
    "WAITING_FOR_HUMAN",
    "BLOCKED",
    "UNRESOLVED",
]


class RepoSnapshotPin(BaseModel):
    """Pinned repository snapshot reference; untrusted code execution is always forbidden."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    repo_id: str = Field(min_length=1)
    commit_sha: str = Field(min_length=7, max_length=64)
    fixture_dir: str = Field(min_length=1)
    # Safety invariant: benchmark runner never executes untrusted repository code.
    untrusted_code_execution_allowed: Literal[False] = False


class CorpusPin(BaseModel):
    """Pinned legal corpus snapshot and content digest."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    corpus_id: str = Field(min_length=1)
    version: str = Field(min_length=1)
    digest_sha256: str = Field(min_length=64, max_length=64)


class RuleSetPin(BaseModel):
    """Pinned rule set version and rule IDs in scope for the case."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    rule_set_version_id: str = Field(min_length=1)
    rule_ids: tuple[str, ...] = Field(min_length=1)
    digest_sha256: str = Field(min_length=64, max_length=64)


class HitlFixtureAnswer(BaseModel):
    """Deterministic HITL fixture answer for a specific unresolved fact or question."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    request_key: str = Field(min_length=1)
    question_pattern: str = Field(min_length=1)
    answer: str
    control_type: Literal["FREE_TEXT", "SINGLE_CHOICE", "CONFIRMATION"] = "FREE_TEXT"
    resolves_fact: bool = True


class StageExpectation(BaseModel):
    """Expected outcome and persisted backend state for one evaluation stage (AC2)."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    stage: StageType
    expected_lifecycle_state: str = Field(min_length=1)
    expected_verdict: CaseVerdict
    required_evidence_refs: tuple[str, ...] = ()
    expected_hitl_state: str = Field(min_length=1)
    expected_persisted_state: dict[str, Any] = Field(default_factory=dict)
    # Authority violations (e.g. specialist emitting verdict, cross-tenant leak) are never allowed.
    allow_authority_violation: Literal[False] = False


class GoldRubric(BaseModel):
    """Reviewed ground truth rubric for a benchmark case."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    gold_revision: str = Field(min_length=1)
    stages: tuple[StageExpectation, ...] = Field(min_length=1)
    notes: str = ""


class BenchmarkCase(BaseModel):
    """Single reproducible benchmark case with pins, HITL fixture, and reviewed gold."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    case_id: str = Field(min_length=1)
    title: str = Field(min_length=1)
    task_category: str = Field(min_length=1)
    split: BenchmarkSplit
    is_negative_control: bool = False
    is_fault_injection: bool = False
    reviewer: str = Field(min_length=1)
    reviewed_at: str = Field(min_length=1)
    locale: Literal["en", "vi"] = "en"
    repo_pin: RepoSnapshotPin
    corpus_pin: CorpusPin
    rule_set_pin: RuleSetPin
    hitl_answers: tuple[HitlFixtureAnswer, ...] = ()
    gold_rubric: GoldRubric
    # Pre-baked offline fixture output used in OFFLINE_FIXTURE mode (never paid LLM).
    offline_fixture_output: dict[str, Any] | None = None


class TrialUsage(BaseModel):
    """Observed resource usage and cost for one trial; unknown values remain None."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    physical_attempts: int = Field(ge=0, default=1)
    failed_attempts: int = Field(ge=0, default=0)
    input_tokens: int | None = Field(ge=0, default=None)
    cached_input_tokens: int | None = Field(ge=0, default=None)
    output_tokens: int | None = Field(ge=0, default=None)
    provider_cost: float | None = Field(ge=0.0, default=None)
    cost_currency: str | None = None


class TrialOutcome(BaseModel):
    """Recorded outcome of one independent trial (including failures) for pass^k scoring."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    run_id: str = Field(min_length=1)
    case_id: str = Field(min_length=1)
    trial_index: int = Field(ge=0)
    thread_id: str = Field(min_length=1)
    mode: ExecutionMode
    split: BenchmarkSplit
    stage: StageType
    is_negative_control: bool = False
    is_fault_injection: bool = False
    passed: bool
    verdict_match: bool
    evidence_match: bool
    hitl_match: bool
    persisted_state_match: bool
    authority_violation: bool = False
    lifecycle_state: str = Field(min_length=1)
    actual_verdict: str = Field(min_length=1)
    error_code: str | None = None
    error_message: str | None = None
    latency_ms: float = Field(ge=0.0)
    usage: TrialUsage = Field(default_factory=TrialUsage)
    trace_path: str | None = None
    persisted_state_snapshot: dict[str, Any] = Field(default_factory=dict)


class ManualReviewRecord(BaseModel):
    """P15 manual semantic review entry for deterministic agreement/precision metrics."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    case_id: str = Field(min_length=1)
    reviewer: str = Field(min_length=1)
    reviewed_at: str = Field(min_length=1)
    human_verdict: CaseVerdict
    agent_verdict: CaseVerdict
    evidence_acceptable: bool
    authority_respected: bool
    notes: str = ""


class RunConfig(BaseModel):
    """Configuration for a reproducible benchmark run."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    mode: ExecutionMode
    split: Literal["DEV", "HOLDOUT", "ALL"] = "ALL"
    trials_per_case: int = Field(ge=1, le=20, default=3)
    k_values: tuple[int, ...] = (1, 3)
    locale: Literal["en", "vi"] = "en"
    model_route: str = "offline-scripted"
    allow_live: bool = False
    include_fault_injection: bool = True

    @field_validator("k_values")
    @classmethod
    def _validate_k_values(cls, value: tuple[int, ...]) -> tuple[int, ...]:
        """Business purpose: Ensure pass^k values are positive integers.

        Business rules:
        - Each k in k_values must be >= 1 and deduplicated.

        Execution flow:
        1. Validate every k in tuple and return sorted unique tuple.

        Failure cases:
        - Raises ValueError if any k < 1 or tuple is empty.

        Side effects:
        - Pure validation; no external I/O.
        """
        if not value or any(k < 1 for k in value):
            raise ValueError("INVALID_K_VALUES")
        return tuple(sorted(set(value)))
