"""Typed contracts for LCSP bounded decision-model calls."""

from __future__ import annotations

from typing import Any, Literal, Self

from pydantic import BaseModel, ConfigDict, Field, model_validator


DECISION_PROVIDERS = {
    "jev": "jev",
    "disabled": "disabled",
}
DECISION_MODES = {
    "shadow": "SHADOW",
    "assist": "ASSIST",
    "active": "ACTIVE",
}
DECISION_FALLBACKS = {
    "existing": "existing",
    "deterministic": "deterministic",
    "none": "none",
}
QUESTION_TYPES = {
    "choice": "CHOICE",
    "score": "SCORE",
    "noul": "NOUL",
}
POLICY_ACTIONS = {
    "accept_typed_decision": "ACCEPT_TYPED_DECISION",
    "fallback_to_existing_llm": "FALLBACK_TO_EXISTING_LLM",
    "fallback_to_deterministic_path": "FALLBACK_TO_DETERMINISTIC_PATH",
    "no_action": "NO_ACTION",
}
DECISION_TYPES = {
    "pr_review_triage": "PR_REVIEW_TRIAGE",
    "root_non_deterministic_next_stage": "ROOT_NON_DETERMINISTIC_NEXT_STAGE",
    "interview_topic_routing": "INTERVIEW_TOPIC_ROUTING",
    "planner_candidate_ranking": "PLANNER_CANDIDATE_RANKING",
    "investigator_next_action": "INVESTIGATOR_NEXT_ACTION",
}

DecisionProvider = Literal["jev", "disabled"]
DecisionMode = Literal["SHADOW", "ASSIST", "ACTIVE"]
DecisionFallback = Literal["existing", "deterministic", "none"]
QuestionType = Literal["CHOICE", "SCORE", "NOUL"]
PolicyAction = Literal[
    "ACCEPT_TYPED_DECISION",
    "FALLBACK_TO_EXISTING_LLM",
    "FALLBACK_TO_DETERMINISTIC_PATH",
    "NO_ACTION",
]


class DecisionQuestion(BaseModel):
    """One atomic bounded question submitted to Jev."""

    model_config = ConfigDict(extra="forbid")

    question_id: str = Field(min_length=1, max_length=160, pattern=r"^[A-Za-z0-9_.:-]+$")
    question_type: QuestionType
    prompt: str = Field(min_length=1, max_length=1_000)
    choices: tuple[str, ...] = Field(default_factory=tuple, max_length=50)
    score_min: float | None = None
    score_max: float | None = None
    score_rubric: dict[str, str] = Field(default_factory=dict, max_length=50)
    noul_schema: dict[str, Any] = Field(default_factory=dict)

    @model_validator(mode="after")
    def validate_question_shape(self) -> Self:
        if self.question_type == "CHOICE":
            if not self.choices:
                raise ValueError("CHOICE questions require a closed choices domain")
            if len(set(self.choices)) != len(self.choices):
                raise ValueError("CHOICE questions require unique choices")
            if self.score_min is not None or self.score_max is not None or self.score_rubric:
                raise ValueError("CHOICE questions must not carry score fields")
            if self.noul_schema:
                raise ValueError("CHOICE questions must not carry noul_schema")
            return self

        if self.question_type == "SCORE":
            if self.score_min is None or self.score_max is None:
                raise ValueError("SCORE questions require score_min and score_max")
            if self.score_min >= self.score_max:
                raise ValueError("SCORE questions require score_min < score_max")
            if not self.score_rubric:
                raise ValueError("SCORE questions require a closed score_rubric")
            if self.choices:
                raise ValueError("SCORE questions must not carry choices")
            if self.noul_schema:
                raise ValueError("SCORE questions must not carry noul_schema")
            return self

        if self.question_type == "NOUL":
            if not self.noul_schema:
                raise ValueError("NOUL questions require a bounded noul_schema")
            if self.choices or self.score_min is not None or self.score_max is not None or self.score_rubric:
                raise ValueError("NOUL questions must not carry choice or score fields")
            return self

        raise ValueError("unsupported question_type")


class DecisionRequest(BaseModel):
    """Gateway request for one bounded decision-model invocation."""

    model_config = ConfigDict(extra="forbid")

    decision_id: str = Field(min_length=1, max_length=240, pattern=r"^[A-Za-z0-9_.:-]+$")
    decision_type: str = Field(min_length=1, max_length=160, pattern=r"^[A-Z0-9_]+$")
    assessment_id: str | None = Field(default=None, max_length=240)
    review_run_id: str | None = Field(default=None, max_length=240)
    pr_number: int | None = Field(default=None, ge=1)
    base_sha: str | None = Field(default=None, max_length=80)
    head_sha: str | None = Field(default=None, max_length=80)
    artifact_versions: dict[str, str] = Field(default_factory=dict, max_length=100)
    state_payload: dict[str, Any] = Field(default_factory=dict)
    questions: tuple[DecisionQuestion, ...] = Field(min_length=1, max_length=25)
    timeout_ms: int | None = Field(default=None, ge=1, le=120_000)
    policy_version: str | None = Field(default=None, max_length=160)

    @model_validator(mode="after")
    def validate_request_shape(self) -> Self:
        question_ids = [question.question_id for question in self.questions]
        if len(set(question_ids)) != len(question_ids):
            raise ValueError("DecisionRequest question IDs must be unique")
        for key, value in self.artifact_versions.items():
            if not str(key).strip() or not str(value).strip():
                raise ValueError("artifact_versions must contain non-empty keys and values")
        return self


class QuestionDecision(BaseModel):
    """Typed result for one question."""

    model_config = ConfigDict(extra="forbid")

    question_id: str = Field(min_length=1, max_length=160)
    question_type: QuestionType
    selected_choice: str | None = Field(default=None, max_length=500)
    score: float | None = None
    noul: dict[str, Any] | None = None
    probability: float | None = Field(default=None, ge=0.0, le=1.0)
    probabilities: dict[str, float] = Field(default_factory=dict, max_length=100)
    confidence: float = Field(ge=0.0, le=1.0)

    @model_validator(mode="after")
    def validate_result_shape(self) -> Self:
        if self.question_type == "CHOICE" and self.selected_choice is None:
            raise ValueError("CHOICE result requires selected_choice")
        if self.question_type == "SCORE" and self.score is None:
            raise ValueError("SCORE result requires score")
        if self.question_type == "NOUL" and self.noul is None:
            raise ValueError("NOUL result requires noul")
        for value in self.probabilities.values():
            if value < 0.0 or value > 1.0:
                raise ValueError("probabilities must stay within 0..1")
        return self


class DecisionResult(BaseModel):
    """Provider result after schema mapping into LCSP contracts."""

    model_config = ConfigDict(extra="forbid")

    provider: str = Field(min_length=1, max_length=80)
    model_version: str = Field(min_length=1, max_length=160)
    decision_id: str = Field(min_length=1, max_length=240)
    decision_type: str = Field(min_length=1, max_length=160)
    question_results: tuple[QuestionDecision, ...] = Field(min_length=1, max_length=25)
    confidence: float = Field(ge=0.0, le=1.0)
    latency_ms: int = Field(ge=0)
    usage: dict[str, Any] = Field(default_factory=dict)
    policy_version: str = Field(min_length=1, max_length=160)
    raw_response_hash: str = Field(pattern=r"^sha256:[0-9a-f]{64}$")
    audit_ref: str | None = Field(default=None, max_length=240)

    @property
    def question_ids(self) -> tuple[str, ...]:
        return tuple(result.question_id for result in self.question_results)


class DecisionPolicyResult(BaseModel):
    """Deterministic policy decision applied after the provider result."""

    model_config = ConfigDict(extra="forbid")

    action: PolicyAction
    reason_code: str = Field(min_length=1, max_length=120, pattern=r"^[A-Z0-9_]+$")
    threshold_used: float | None = Field(default=None, ge=0.0, le=1.0)
    decision_mode: DecisionMode
    policy_version: str = Field(min_length=1, max_length=160)

    @property
    def accepts_provider_decision(self) -> bool:
        return self.action == POLICY_ACTIONS["accept_typed_decision"]


class DecisionGatewayOutcome(BaseModel):
    """Complete gateway outcome for callers and tests."""

    model_config = ConfigDict(extra="forbid")

    request: DecisionRequest
    provider_result: DecisionResult | None = None
    policy_result: DecisionPolicyResult
    telemetry_events: tuple[dict[str, Any], ...] = Field(default_factory=tuple)


__all__ = [
    "DECISION_FALLBACKS",
    "DECISION_MODES",
    "DECISION_PROVIDERS",
    "DECISION_TYPES",
    "POLICY_ACTIONS",
    "QUESTION_TYPES",
    "DecisionFallback",
    "DecisionGatewayOutcome",
    "DecisionMode",
    "DecisionPolicyResult",
    "DecisionProvider",
    "DecisionQuestion",
    "DecisionRequest",
    "DecisionResult",
    "PolicyAction",
    "QuestionDecision",
    "QuestionType",
]
