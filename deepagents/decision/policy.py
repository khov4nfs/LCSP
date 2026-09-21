"""Fail-closed configuration and confidence policy for LCSP decisions."""

from __future__ import annotations

import os
from dataclasses import dataclass

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


DEFAULT_DECISION_POLICIES: dict[str, DecisionTypePolicy] = {
    DECISION_TYPES["pr_review_triage"]: DecisionTypePolicy(threshold=0.70),
    DECISION_TYPES["root_non_deterministic_next_stage"]: DecisionTypePolicy(
        threshold=0.85,
        safety_critical=True,
    ),
    DECISION_TYPES["interview_topic_routing"]: DecisionTypePolicy(
        threshold=0.80,
        safety_critical=True,
    ),
    DECISION_TYPES["planner_candidate_ranking"]: DecisionTypePolicy(threshold=0.75),
    DECISION_TYPES["investigator_next_action"]: DecisionTypePolicy(
        threshold=0.85,
        safety_critical=True,
    ),
}


class DecisionPolicy:
    """Central decision policy; integrations must not inline thresholds."""

    def __init__(self, policies: dict[str, DecisionTypePolicy] | None = None) -> None:
        self._policies = dict(policies or DEFAULT_DECISION_POLICIES)

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
    "DecisionGatewayConfig",
    "DecisionPolicy",
    "DecisionTypePolicy",
]
