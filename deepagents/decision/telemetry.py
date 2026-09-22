"""Semantic telemetry seams for LCSP decision-model calls."""

from __future__ import annotations

from collections.abc import Callable
from datetime import UTC, datetime
from typing import Any

from .contracts import DecisionPolicyResult, DecisionRequest, DecisionResult


DECISION_MODEL_REQUEST = "DECISION_MODEL_REQUEST"
DECISION_MODEL_RESULT = "DECISION_MODEL_RESULT"
DECISION_THRESHOLD_APPLIED = "DECISION_THRESHOLD_APPLIED"
DECISION_FALLBACK = "DECISION_FALLBACK"


TelemetrySink = Callable[[dict[str, Any]], None]


class InMemoryDecisionTelemetrySink:
    """Small test/development sink; production can supply a persistence adapter."""

    def __init__(self) -> None:
        self.events: list[dict[str, Any]] = []

    def __call__(self, event: dict[str, Any]) -> None:
        self.events.append(event)


def build_request_event(request: DecisionRequest, *, provider: str, model: str | None) -> dict[str, Any]:
    return _event(
        DECISION_MODEL_REQUEST,
        request,
        {
            "provider": provider,
            "modelVersion": model,
            "questionIds": [question.question_id for question in request.questions],
            "questionTypes": [question.question_type for question in request.questions],
            "artifactVersionKeys": sorted(request.artifact_versions),
            "statePayloadKeys": sorted(request.state_payload),
        },
    )


def build_result_event(request: DecisionRequest, result: DecisionResult) -> dict[str, Any]:
    return _event(
        DECISION_MODEL_RESULT,
        request,
        {
            "provider": result.provider,
            "modelVersion": result.model_version,
            "questionIds": list(result.question_ids),
            "questionResults": [_question_result(item) for item in result.question_results],
            "confidence": result.confidence,
            "latencyMs": result.latency_ms,
            "usage": result.usage,
            "rawResponseHash": result.raw_response_hash,
            "auditRef": result.audit_ref,
        },
    )


def build_threshold_event(
    request: DecisionRequest,
    policy_result: DecisionPolicyResult,
) -> dict[str, Any]:
    return _event(
        DECISION_THRESHOLD_APPLIED,
        request,
        {
            "action": policy_result.action,
            "reasonCode": policy_result.reason_code,
            "thresholdUsed": policy_result.threshold_used,
            "decisionMode": policy_result.decision_mode,
            "policyVersion": policy_result.policy_version,
        },
    )


def build_fallback_event(
    request: DecisionRequest,
    policy_result: DecisionPolicyResult,
) -> dict[str, Any]:
    return _event(
        DECISION_FALLBACK,
        request,
        {
            "action": policy_result.action,
            "reasonCode": policy_result.reason_code,
            "decisionMode": policy_result.decision_mode,
            "policyVersion": policy_result.policy_version,
        },
    )


def emit_events(
    sink: TelemetrySink | None,
    events: tuple[dict[str, Any], ...],
) -> tuple[dict[str, Any], ...]:
    if sink is not None:
        for event in events:
            sink(event)
    return events


def _event(
    event_type: str,
    request: DecisionRequest,
    data: dict[str, Any],
) -> dict[str, Any]:
    return {
        "eventType": event_type,
        "emittedAt": datetime.now(tz=UTC).isoformat(),
        "decisionId": request.decision_id,
        "decisionType": request.decision_type,
        "assessmentId": request.assessment_id,
        "reviewRunId": request.review_run_id,
        "prNumber": request.pr_number,
        "baseSha": request.base_sha,
        "headSha": request.head_sha,
        "data": _without_none(data),
    }


def _without_none(value: dict[str, Any]) -> dict[str, Any]:
    return {key: item for key, item in value.items() if item is not None}


def _question_result(result: Any) -> dict[str, Any]:
    value: dict[str, Any] = {
        "questionId": result.question_id,
        "questionType": result.question_type,
        "probability": result.probability,
        "probabilities": result.probabilities,
        "confidence": result.confidence,
    }
    if result.selected_choice is not None:
        value["selectedChoice"] = result.selected_choice
    if result.score is not None:
        value["score"] = result.score
    if result.noul is not None:
        value["noul"] = result.noul
    return _without_none(value)


__all__ = [
    "DECISION_FALLBACK",
    "DECISION_MODEL_REQUEST",
    "DECISION_MODEL_RESULT",
    "DECISION_THRESHOLD_APPLIED",
    "InMemoryDecisionTelemetrySink",
    "TelemetrySink",
    "build_fallback_event",
    "build_request_event",
    "build_result_event",
    "build_threshold_event",
    "emit_events",
]
