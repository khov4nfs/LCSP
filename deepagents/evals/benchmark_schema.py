"""Pure Pydantic v2 domain schemas for LCSP SWE-bench / tau-bench style evaluation.

No LLM SDKs or database drivers are imported here. All models are immutable
(`frozen=True`) and reject unknown fields (`extra="forbid"`) to preserve
reproducibility and contract integrity across offline, scripted, and live runs.
"""
from __future__ import annotations

import re
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
    """Pinned repository snapshot reference; synthetic fixtures are explicitly marked."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    repo_id: str = Field(min_length=1)
    snapshot_kind: Literal["SYNTHETIC_FIXTURE", "GIT_COMMIT"] = "SYNTHETIC_FIXTURE"
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


class LegalProvisionFixture(BaseModel):
    """Pinned legal provision text served by read_legal_source and search_legal_source."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    document_id: str = Field(min_length=1)
    locator: str = Field(min_length=1)
    title: str = Field(min_length=1)
    content: str = Field(min_length=1)
    content_sha256: str = Field(min_length=64, max_length=64)
    source_kind: Literal["SYNTHETIC_PINNED_LAW", "OFFICIAL_PINNED_LAW"] = "SYNTHETIC_PINNED_LAW"


class RuleDefinitionFixture(BaseModel):
    """Case-specific legal requirement, applicability conditions, criteria, and exceptions."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    rule_id: str = Field(min_length=1)
    concept: str = Field(min_length=1)
    legal_requirement_id: str = Field(min_length=1)
    requirement_title: str = Field(min_length=1)
    requirement_proposition: str = Field(min_length=1)
    applicability_conditions: tuple[str, ...] = Field(min_length=1)
    criteria: tuple[dict[str, str], ...] = Field(min_length=1)
    exceptions: tuple[str, ...] = ()


class RuleSetPin(BaseModel):
    """Pinned rule set version and rule IDs in scope for the case."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    rule_set_version_id: str = Field(min_length=1)
    rule_ids: tuple[str, ...] = Field(min_length=1)
    digest_sha256: str = Field(min_length=64, max_length=64)


class HitlFixtureAnswer(BaseModel):
    """Deterministic HITL fixture answer matched by request_key or question_pattern."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    request_key: str = Field(min_length=1)
    question_pattern: str = Field(min_length=1)
    answer: str
    control_type: Literal["FREE_TEXT", "SINGLE_CHOICE", "CONFIRMATION"] = "FREE_TEXT"
    resolves_fact: bool = True


class GoldEvidenceCriterion(BaseModel):
    """Semantic gold evidence criterion pinned to source path, span, and content."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    evidence_type: Literal["REPOSITORY_SOURCE", "LEGAL_PROVISION", "HUMAN_CONFIRMED_FACT"] = "REPOSITORY_SOURCE"
    path: str | None = None
    required_span: tuple[int, int] | None = None
    required_text_substrings: tuple[str, ...] = ()
    fact_to_prove: str = Field(min_length=1)


class StageExpectation(BaseModel):
    """Expected outcome and persisted backend state for one evaluation stage (AC2)."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    stage: StageType
    expected_lifecycle_state: str = Field(min_length=1)
    expected_verdict: CaseVerdict
    required_evidence_refs: tuple[str, ...] = ()
    required_evidence_criteria: tuple[GoldEvidenceCriterion, ...] = ()
    expected_hitl_state: str = Field(min_length=1)
    expected_persisted_state: dict[str, Any] = Field(default_factory=dict)
    allow_authority_violation: Literal[False] = False


class GoldRubric(BaseModel):
    """Reviewed ground truth rubric for a benchmark case."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    gold_revision: str = Field(min_length=1)
    stages: tuple[StageExpectation, ...] = Field(min_length=1)
    notes: str = ""


class BenchmarkCase(BaseModel):
    """Single reproducible benchmark case with real legal provisions, rule specs, and gold."""

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
    legal_provisions: tuple[LegalProvisionFixture, ...] = Field(min_length=1)
    rule_definitions: tuple[RuleDefinitionFixture, ...] = Field(min_length=1)
    hitl_answers: tuple[HitlFixtureAnswer, ...] = ()
    gold_rubric: GoldRubric
    # Pre-baked offline fixture output used ONLY in OFFLINE_FIXTURE mode (never SCRIPTED/LIVE).
    offline_fixture_output: dict[str, Any] | None = None


class TrialUsage(BaseModel):
    """Observed resource usage distinguishing physical provider calls from simulated/scripted."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    # Real external provider model calls from reconciled governance receipts; 0 if unverified/offline.
    physical_attempts: int = Field(ge=0, default=0)
    physical_attempts_verified: bool = False
    unverified_callback_calls: int = Field(ge=0, default=0)
    failed_attempts: int = Field(ge=0, default=0)
    simulated_provider_calls: int = Field(ge=0, default=0)
    scripted_invocations: int = Field(ge=0, default=0)
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
    authority_gate_tested: bool = False
    completion_gate_tested: bool = False
    tested_invariants: tuple[str, ...] = ()
    rule_set_version_id: str | None = None
    graph_executed: bool = False
    checkpoint_id: str | None = None
    injected_fault_observed: bool = False
    recovery_observed: bool = False
    lifecycle_state: str = Field(min_length=1)
    actual_verdict: str = Field(min_length=1)
    error_code: str | None = None
    error_message: str | None = None
    latency_ms: float = Field(ge=0.0)
    usage: TrialUsage = Field(default_factory=TrialUsage)
    trace_path: str | None = None
    trace_sha256: str | None = None
    persisted_state_snapshot: dict[str, Any] = Field(default_factory=dict)


class ManualReviewRecord(BaseModel):
    """P15 manual semantic review bound to a specific run, case, stage, trial, trace, and config."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    run_id: str = Field(min_length=1)
    case_id: str = Field(min_length=1)
    stage: StageType = "INITIAL"
    trial_index: int = Field(ge=0, default=0)
    thread_id: str = Field(min_length=1)
    trace_sha256: str = Field(min_length=64, max_length=64)
    model_route: str = Field(min_length=1)
    instruction_bundle_digest: str = Field(min_length=1)
    rule_set_version_id: str = Field(min_length=1)
    review_status: Literal["EXPERT_VERIFIED", "SEEDED_UNVERIFIED"] = "SEEDED_UNVERIFIED"
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
    case_split_manifest_sha256: str | None = None
    git_commit_sha: str | None = None

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

    @field_validator("case_split_manifest_sha256")
    @classmethod
    def _validate_case_split_manifest_sha256(cls, value: str | None) -> str | None:
        """Business purpose: Keep an optional frozen evaluation split attached to its P14 run.

        Business rules:
        - A supplied split identity must be a lowercase SHA-256 digest.
        - An absent digest preserves existing non-LCSP-400 benchmark behavior.

        Execution flow:
        1. Accept null when the run has no split-manifest binding.
        2. Validate the exact digest format when a binding is supplied.

        Failure cases:
        - Malformed split digests fail RunConfig validation before execution.

        Side effects:
        - None: validates immutable run configuration.
        """
        if value is not None and not re.fullmatch(r"[a-f0-9]{64}", value):
            raise ValueError("INVALID_CASE_SPLIT_MANIFEST_SHA256")
        return value

    @field_validator("git_commit_sha")
    @classmethod
    def _validate_git_commit_sha(cls, value: str | None) -> str | None:
        """Business purpose: Bind evaluation artifacts to the source revision used for execution.

        Business rules:
        - An omitted revision preserves generic P14 runs that do not need LCSP-400 provenance.
        - A supplied Git object ID must be a full SHA-1 or SHA-256 hexadecimal identifier.

        Execution flow:
        1. Preserve null when no source revision was provided.
        2. Validate a supplied full-length lowercase object ID before it enters the manifest.

        Failure cases:
        - Abbreviated, malformed, or uppercase IDs raise ValueError.

        Side effects:
        - None: validates immutable run configuration.
        """
        if value is not None and not re.fullmatch(r"(?:[a-f0-9]{40}|[a-f0-9]{64})", value):
            raise ValueError("INVALID_GIT_COMMIT_SHA")
        return value
