"""Fail-closed configuration and confidence policy for LCSP decisions."""

from __future__ import annotations

import os
from dataclasses import dataclass, field

from .contracts import (
    DECISION_FALLBACKS,
    DECISION_MODES,
    DECISION_PROVIDERS,
    DECISION_TYPES,
    POLICY_ACTIONS,
    DecisionFallback,
    DecisionMode,
    DecisionPolicyResult,
    DecisionProvider,
    DecisionRequest,
    DecisionResult,
)


DEFAULT_POLICY_VERSION = "LCSP_JEV_CONFIDENCE_POLICY_V1"
DEFAULT_JEV_ENDPOINT = "https://api.typesafe.ai/v1/jev/decisions"
DEFAULT_TIMEOUT_MS = 3_000
DEFAULT_MAX_RETRIES = 1
PERMANENTLY_EXCLUDED_DECISION_TYPE_MARKERS = (
    "LEGAL",
    "COMPLIANCE",
    "FINAL_RISK",
    "FINAL_READINESS",
    "FINAL_ASSESSMENT",
)


class DecisionConfigurationError(RuntimeError):
    """Raised when an explicit active decision configuration is unsafe."""


@dataclass(frozen=True)
class DecisionGatewayConfig:
    provider: DecisionProvider = DECISION_PROVIDERS["jev"]
    mode: DecisionMode = DECISION_MODES["shadow"]
    fallback: DecisionFallback = DECISION_FALLBACKS["existing"]
    api_key: str | None = None
    timeout_ms: int = DEFAULT_TIMEOUT_MS
    policy_version: str = DEFAULT_POLICY_VERSION
    endpoint: str = DEFAULT_JEV_ENDPOINT
    max_retries: int = DEFAULT_MAX_RETRIES
    requested_model_version: str | None = None

    @classmethod
    def from_env(cls) -> "DecisionGatewayConfig":
        provider = _provider(os.getenv("LCSP_DECISION_PROVIDER") or "jev")
        mode = _mode(os.getenv("LCSP_DECISION_MODE") or "shadow")
        fallback = _fallback(os.getenv("LCSP_DECISION_FALLBACK") or "existing")
        timeout_ms = _positive_int(
            os.getenv("LCSP_JEV_TIMEOUT_MS"),
            default=DEFAULT_TIMEOUT_MS,
            name="LCSP_JEV_TIMEOUT_MS",
        )
        max_retries = _bounded_int(
            os.getenv("LCSP_JEV_MAX_RETRIES"),
            default=DEFAULT_MAX_RETRIES,
            name="LCSP_JEV_MAX_RETRIES",
            lower=0,
            upper=3,
        )
        policy_version = (
            os.getenv("LCSP_JEV_CONFIDENCE_POLICY_VERSION")
            or DEFAULT_POLICY_VERSION
        ).strip()
        if not policy_version:
            raise DecisionConfigurationError(
                "LCSP_JEV_CONFIDENCE_POLICY_VERSION must not be blank"
            )
        endpoint = (os.getenv("TYPESAFE_JEV_ENDPOINT") or DEFAULT_JEV_ENDPOINT).strip()
        if not endpoint:
            raise DecisionConfigurationError("TYPESAFE_JEV_ENDPOINT must not be blank")
        return cls(
            provider=provider,
            mode=mode,
            fallback=fallback,
            api_key=(os.getenv("TYPESAFE_API_KEY") or "").strip() or None,
            timeout_ms=timeout_ms,
            policy_version=policy_version,
            endpoint=endpoint,
            max_retries=max_retries,
            requested_model_version=(
                os.getenv("LCSP_JEV_MODEL_VERSION") or ""
            ).strip()
            or None,
        )

    def validate_active_credentials(self) -> None:
        if self.provider == DECISION_PROVIDERS["jev"] and self.mode == "ACTIVE" and not self.api_key:
            raise DecisionConfigurationError(
                "ACTIVE Jev decision mode requires TYPESAFE_API_KEY"
            )


@dataclass(frozen=True)
class DecisionTypePolicy:
    threshold: float
    assist_allowed: bool = False
    active_allowed: bool = False
    safety_critical: bool = False
    min_quality_score: float = 0.90
    min_eval_sample_size: int = 50
    max_false_negative_rate: float = 0.02
    max_expected_calibration_error: float = 0.10
    safety_question_ids: tuple[str, ...] = field(default_factory=tuple)
    fallback_path_tested: bool = False
    privacy_review_clear: bool = False
    rollback_switch_available: bool = True
    approved_model_versions: tuple[str, ...] = field(default_factory=tuple)
    permanent_exclusion_reason: str | None = None


@dataclass(frozen=True)
class DecisionActivationEvidence:
    """Versioned offline-eval evidence required before ACTIVE can accept Jev."""

    decision_type: str
    model_version: str
    dataset_version: str
    dataset_hash: str
    policy_version: str
    sample_size: int
    quality_score: float
    false_negative_rate: float | None
    expected_calibration_error: float | None
    safety_question_count: int
    fallback_path_tested: bool
    privacy_review_clear: bool
    rollback_switch_available: bool


DEFAULT_DECISION_POLICIES: dict[str, DecisionTypePolicy] = {
    DECISION_TYPES["pr_review_triage"]: DecisionTypePolicy(
        threshold=0.70,
        safety_question_ids=(
            "security_sensitive_change",
            "exact_head_lifecycle_risk",
            "needs_deep_review",
            "likely_missing_regression_tests",
            "requires_managed_sandbox_attention",
        ),
    ),
    DECISION_TYPES["root_non_deterministic_next_stage"]: DecisionTypePolicy(
        threshold=0.85,
        safety_critical=True,
        safety_question_ids=("needs_reasoning_escalation",),
    ),
    DECISION_TYPES["interview_topic_routing"]: DecisionTypePolicy(
        threshold=0.80,
        safety_critical=True,
        safety_question_ids=(
            "material_customer_fact_unresolved",
            "current_context_sufficient",
        ),
    ),
    DECISION_TYPES["planner_candidate_ranking"]: DecisionTypePolicy(threshold=0.75),
    DECISION_TYPES["investigator_next_action"]: DecisionTypePolicy(
        threshold=0.85,
        safety_critical=True,
        safety_question_ids=("next_action",),
    ),
}


class DecisionPolicy:
    """Central decision policy; integrations must not inline thresholds."""

    def __init__(
        self,
        policies: dict[str, DecisionTypePolicy] | None = None,
        activation_evidence: dict[
            tuple[str, str, str], DecisionActivationEvidence
        ] | None = None,
    ) -> None:
        self._policies = dict(policies or DEFAULT_DECISION_POLICIES)
        self._activation_evidence = dict(activation_evidence or {})

    def supports_decision_type(self, decision_type: str) -> bool:
        return decision_type in self._policies

    def failure(
        self,
        *,
        request: DecisionRequest,
        config: DecisionGatewayConfig,
        reason_code: str,
    ) -> DecisionPolicyResult:
        policy = self._policies.get(request.decision_type)
        return DecisionPolicyResult(
            action=_fallback_action(config.fallback),
            reason_code=reason_code,
            threshold_used=policy.threshold if policy else None,
            decision_mode=config.mode,
            policy_version=config.policy_version,
        )

    def evaluate(
        self,
        *,
        request: DecisionRequest,
        result: DecisionResult,
        config: DecisionGatewayConfig,
    ) -> DecisionPolicyResult:
        policy = self._policies.get(request.decision_type)
        if policy is None:
            return self.failure(
                request=request,
                config=config,
                reason_code="UNKNOWN_DECISION_TYPE",
            )
        if _is_permanently_excluded(request.decision_type, policy):
            return self.failure(
                request=request,
                config=config,
                reason_code="DECISION_TYPE_PERMANENTLY_EXCLUDED",
            )
        if (
            policy.approved_model_versions
            and result.model_version not in policy.approved_model_versions
        ):
            return self.failure(
                request=request,
                config=config,
                reason_code="MODEL_VERSION_DRIFT",
            )
        if result.confidence < policy.threshold:
            return self.failure(
                request=request,
                config=config,
                reason_code="LOW_CONFIDENCE",
            )
        if config.mode == "SHADOW":
            return DecisionPolicyResult(
                action=POLICY_ACTIONS["no_action"],
                reason_code="SHADOW_MODE_OBSERVE_ONLY",
                threshold_used=policy.threshold,
                decision_mode=config.mode,
                policy_version=config.policy_version,
            )
        if config.mode == "ASSIST" and not policy.assist_allowed:
            return self.failure(
                request=request,
                config=config,
                reason_code="ASSIST_NOT_ALLOWLISTED",
            )
        if config.mode == "ACTIVE" and not policy.active_allowed:
            return self.failure(
                request=request,
                config=config,
                reason_code="ACTIVE_NOT_ALLOWLISTED",
            )
        if config.mode == "ACTIVE" and not _activation_evidence_ready(
            policy,
            evidence=self._activation_evidence.get(
                (request.decision_type, result.model_version, result.policy_version)
            ),
            result=result,
        ):
            return self.failure(
                request=request,
                config=config,
                reason_code="ACTIVATION_EVIDENCE_INCOMPLETE",
            )
        if config.mode == "ACTIVE" and policy.safety_critical:
            return self.failure(
                request=request,
                config=config,
                reason_code="ACTIVE_SAFETY_REVIEW_REQUIRED",
            )
        return DecisionPolicyResult(
            action=POLICY_ACTIONS["accept_typed_decision"],
            reason_code="THRESHOLD_PASSED",
            threshold_used=policy.threshold,
            decision_mode=config.mode,
            policy_version=config.policy_version,
        )


def _fallback_action(fallback: DecisionFallback) -> str:
    if fallback == DECISION_FALLBACKS["deterministic"]:
        return POLICY_ACTIONS["fallback_to_deterministic_path"]
    if fallback == DECISION_FALLBACKS["none"]:
        return POLICY_ACTIONS["no_action"]
    return POLICY_ACTIONS["fallback_to_existing_llm"]


def _is_permanently_excluded(decision_type: str, policy: DecisionTypePolicy) -> bool:
    if policy.permanent_exclusion_reason:
        return True
    return any(
        marker in decision_type
        for marker in PERMANENTLY_EXCLUDED_DECISION_TYPE_MARKERS
    )


def _activation_evidence_ready(
    policy: DecisionTypePolicy,
    *,
    evidence: DecisionActivationEvidence | None,
    result: DecisionResult,
) -> bool:
    if evidence is None:
        return False
    if evidence.model_version != result.model_version:
        return False
    if evidence.decision_type != result.decision_type:
        return False
    if evidence.policy_version != result.policy_version:
        return False
    if not evidence.dataset_version or not evidence.dataset_hash.startswith("sha256:"):
        return False
    if evidence.sample_size < policy.min_eval_sample_size:
        return False
    if evidence.quality_score < policy.min_quality_score:
        return False
    if policy.safety_critical or policy.safety_question_ids:
        if evidence.safety_question_count < len(policy.safety_question_ids):
            return False
        if evidence.false_negative_rate is None:
            return False
        if evidence.false_negative_rate > policy.max_false_negative_rate:
            return False
    if (
        evidence.expected_calibration_error is None
        or evidence.expected_calibration_error > policy.max_expected_calibration_error
    ):
        return False
    return (
        evidence.fallback_path_tested
        and evidence.privacy_review_clear
        and evidence.rollback_switch_available
        and len(policy.approved_model_versions) > 0
    )


def _provider(value: str) -> DecisionProvider:
    normalized = value.strip().lower()
    if normalized in DECISION_PROVIDERS:
        return DECISION_PROVIDERS[normalized]  # type: ignore[return-value]
    raise DecisionConfigurationError(
        "LCSP_DECISION_PROVIDER must be one of: "
        + ", ".join(sorted(DECISION_PROVIDERS.values()))
    )


def _mode(value: str) -> DecisionMode:
    normalized = value.strip().lower()
    if normalized in DECISION_MODES:
        return DECISION_MODES[normalized]  # type: ignore[return-value]
    raise DecisionConfigurationError(
        "LCSP_DECISION_MODE must be one of: SHADOW, ASSIST, ACTIVE"
    )


def _fallback(value: str) -> DecisionFallback:
    normalized = value.strip().lower()
    if normalized in DECISION_FALLBACKS:
        return DECISION_FALLBACKS[normalized]  # type: ignore[return-value]
    raise DecisionConfigurationError(
        "LCSP_DECISION_FALLBACK must be one of: existing, deterministic, none"
    )


def _positive_int(value: str | None, *, default: int, name: str) -> int:
    return _bounded_int(value, default=default, name=name, lower=1, upper=120_000)


def _bounded_int(
    value: str | None,
    *,
    default: int,
    name: str,
    lower: int,
    upper: int,
) -> int:
    if value is None or not value.strip():
        return default
    try:
        parsed = int(value)
    except ValueError as exc:
        raise DecisionConfigurationError(f"{name} must be an integer") from exc
    if parsed < lower or parsed > upper:
        raise DecisionConfigurationError(f"{name} must be between {lower} and {upper}")
    return parsed


__all__ = [
    "DEFAULT_DECISION_POLICIES",
    "DEFAULT_JEV_ENDPOINT",
    "DEFAULT_MAX_RETRIES",
    "DEFAULT_POLICY_VERSION",
    "DEFAULT_TIMEOUT_MS",
    "DecisionConfigurationError",
    "DecisionActivationEvidence",
    "DecisionGatewayConfig",
    "DecisionPolicy",
    "DecisionTypePolicy",
    "PERMANENTLY_EXCLUDED_DECISION_TYPE_MARKERS",
]
