"""Narrow TypeSafe AI Jev HTTP adapter."""

from __future__ import annotations

import json
import time
from collections.abc import Callable
from hashlib import sha256
from typing import Any

import httpx
from jsonschema import SchemaError as JsonSchemaSchemaError
from jsonschema import ValidationError as JsonSchemaValidationError
from jsonschema import validate as validate_json_schema
from pydantic import ValidationError

from .contracts import DecisionRequest, DecisionResult, QuestionDecision


class TypeSafeJevError(RuntimeError):
    """Stable provider-boundary error with a policy reason code."""

    def __init__(self, reason_code: str, message: str) -> None:
        super().__init__(message)
        self.reason_code = reason_code


ProviderTransport = Callable[[dict[str, Any], dict[str, str], float], dict[str, Any]]


class TypeSafeJevClient:
    """HTTP adapter for bounded Jev Choice/Score/Noul decisions."""

    def __init__(
        self,
        *,
        api_key: str,
        endpoint: str,
        timeout_ms: int,
        max_retries: int = 1,
        transport: ProviderTransport | None = None,
    ) -> None:
        if not api_key:
            raise TypeSafeJevError("MISSING_CREDENTIALS", "TYPESAFE_API_KEY is required")
        self._api_key = api_key
        self._endpoint = endpoint
        self._timeout_seconds = timeout_ms / 1_000
        self._max_retries = max(0, min(max_retries, 3))
        self._transport = transport

    def invoke(
        self,
        *,
        request: DecisionRequest,
        provider_payload: dict[str, Any],
        policy_version: str,
    ) -> DecisionResult:
        started = time.monotonic()
        response = self._post_with_retry(provider_payload)
        latency_ms = int((time.monotonic() - started) * 1_000)
        return _map_response(
            request=request,
            response=response,
            policy_version=policy_version,
            latency_ms=max(0, latency_ms),
        )

    def _post_with_retry(self, payload: dict[str, Any]) -> dict[str, Any]:
        attempts = self._max_retries + 1
        last_error: TypeSafeJevError | None = None
        headers = {
            "authorization": f"Bearer {self._api_key}",
            "content-type": "application/json",
        }
        for attempt in range(attempts):
            try:
                return (
                    self._transport(payload, headers, self._timeout_seconds)
                    if self._transport is not None
                    else self._http_post(payload, headers)
                )
            except TypeSafeJevError as exc:
                if exc.reason_code not in {
                    "PROVIDER_TIMEOUT",
                    "PROVIDER_NETWORK_ERROR",
                    "PROVIDER_SERVER_ERROR",
                }:
                    raise
                last_error = exc
                if attempt >= attempts - 1:
                    break
        if last_error is not None:
            raise last_error
        raise TypeSafeJevError("PROVIDER_NETWORK_ERROR", "Jev provider request failed")

    def _http_post(self, payload: dict[str, Any], headers: dict[str, str]) -> dict[str, Any]:
        try:
            response = httpx.post(
                self._endpoint,
                json=payload,
                headers=headers,
                timeout=self._timeout_seconds,
            )
        except httpx.TimeoutException as exc:
            raise TypeSafeJevError("PROVIDER_TIMEOUT", "Jev provider timed out") from exc
        except httpx.RequestError as exc:
            raise TypeSafeJevError(
                "PROVIDER_NETWORK_ERROR",
                "Jev provider network request failed",
            ) from exc

        if response.status_code in {401, 403}:
            raise TypeSafeJevError("PROVIDER_AUTH_ERROR", "Jev provider auth failed")
        if response.status_code >= 500:
            raise TypeSafeJevError("PROVIDER_SERVER_ERROR", "Jev provider server error")
        if response.status_code >= 400:
            raise TypeSafeJevError("PROVIDER_HTTP_ERROR", "Jev provider rejected request")
        try:
            value = response.json()
        except json.JSONDecodeError as exc:
            raise TypeSafeJevError(
                "PROVIDER_SCHEMA_INVALID",
                "Jev provider response was not JSON",
            ) from exc
        if not isinstance(value, dict):
            raise TypeSafeJevError(
                "PROVIDER_SCHEMA_INVALID",
                "Jev provider response must be an object",
            )
        return value


def _map_response(
    *,
    request: DecisionRequest,
    response: dict[str, Any],
    policy_version: str,
    latency_ms: int,
) -> DecisionResult:
    try:
        model_version = _model_version(response)
        items = _response_items(response)
        questions_by_id = {question.question_id: question for question in request.questions}
        mapped = tuple(
            _map_question(item, questions_by_id=questions_by_id)
            for item in items
        )
        mapped_question_ids = [result.question_id for result in mapped]
        if (
            len(mapped_question_ids) != len(questions_by_id)
            or len(set(mapped_question_ids)) != len(mapped_question_ids)
            or set(mapped_question_ids) != set(questions_by_id)
        ):
            raise TypeSafeJevError(
                "PROVIDER_SCHEMA_INVALID",
                "Jev response must include exactly one result per requested question",
            )
        confidence = min(result.confidence for result in mapped)
        return DecisionResult(
            provider=str(response.get("provider") or "typesafe"),
            model_version=model_version,
            decision_id=request.decision_id,
            decision_type=request.decision_type,
            question_results=mapped,
            confidence=confidence,
            latency_ms=latency_ms,
            usage=dict(response.get("usage") or {}),
            policy_version=policy_version,
            raw_response_hash=_hash_response(response),
            audit_ref=_optional_str(
                response.get("responseId")
                or response.get("response_id")
                or response.get("auditRef")
                or response.get("audit_ref")
            ),
        )
    except (
        KeyError,
        TypeError,
        ValueError,
        ValidationError,
        JsonSchemaValidationError,
        JsonSchemaSchemaError,
    ) as exc:
        raise TypeSafeJevError(
            "PROVIDER_SCHEMA_INVALID",
            "Jev provider response did not match the LCSP decision contract",
        ) from exc


def _model_version(response: dict[str, Any]) -> str:
    value = (
        response.get("modelVersion")
        or response.get("model_version")
        or response.get("version")
    )
    if not isinstance(value, str) or not value.strip():
        raise TypeSafeJevError(
            "PROVIDER_SCHEMA_INVALID",
            "Jev response must include concrete model/version",
        )
    return value.strip()


def _response_items(response: dict[str, Any]) -> list[dict[str, Any]]:
    value = response.get("decisions") or response.get("results")
    if not isinstance(value, list) or not value:
        raise TypeSafeJevError(
            "PROVIDER_SCHEMA_INVALID",
            "Jev response must include decisions",
        )
    if not all(isinstance(item, dict) for item in value):
        raise TypeSafeJevError(
            "PROVIDER_SCHEMA_INVALID",
            "Jev decisions must be objects",
        )
    return value


def _map_question(
    item: dict[str, Any],
    *,
    questions_by_id: dict[str, Any],
) -> QuestionDecision:
    question_id = str(item.get("questionId") or item.get("question_id") or "")
    question = questions_by_id.get(question_id)
    if question is None:
        raise TypeSafeJevError(
            "PROVIDER_SCHEMA_INVALID",
            "Jev response contains unknown question ID",
        )
    qtype = question.question_type
    common = {
        "question_id": question_id,
        "question_type": qtype,
        "probability": _optional_float(item.get("probability")),
        "probabilities": _probabilities(item.get("probabilities")),
        "confidence": _required_float(item.get("confidence"), "confidence"),
    }
    if qtype == "CHOICE":
        selected = str(
            item.get("choice")
            or item.get("selectedChoice")
            or item.get("selected_choice")
            or ""
        )
        if selected not in question.choices:
            raise TypeSafeJevError(
                "PROVIDER_SCHEMA_INVALID",
                "Jev selected choice is outside the closed output domain",
            )
        return QuestionDecision(**common, selected_choice=selected)
    if qtype == "SCORE":
        score = _required_float(item.get("score"), "score")
        if score < question.score_min or score > question.score_max:
            raise TypeSafeJevError(
                "PROVIDER_SCHEMA_INVALID",
                "Jev score is outside the closed score range",
            )
        return QuestionDecision(**common, score=score)
    if qtype == "NOUL":
        noul = item.get("noul") or item.get("value")
        if not isinstance(noul, dict):
            raise TypeSafeJevError(
                "PROVIDER_SCHEMA_INVALID",
                "Jev NOUL result must be an object",
            )
        _validate_noul_schema(noul, question.noul_schema)
        return QuestionDecision(**common, noul=noul)
    raise TypeSafeJevError("PROVIDER_SCHEMA_INVALID", "unsupported question type")


def _probabilities(value: Any) -> dict[str, float]:
    if value is None:
        return {}
    if not isinstance(value, dict):
        raise TypeSafeJevError("PROVIDER_SCHEMA_INVALID", "probabilities must be an object")
    return {str(key): _required_float(item, "probability") for key, item in value.items()}


def _validate_noul_schema(value: dict[str, Any], schema: dict[str, Any]) -> None:
    try:
        validate_json_schema(instance=value, schema=schema)
    except (JsonSchemaValidationError, JsonSchemaSchemaError) as exc:
        raise TypeSafeJevError(
            "PROVIDER_SCHEMA_INVALID",
            "Jev NOUL result does not match the declared schema",
        ) from exc


def _required_float(value: Any, field_name: str) -> float:
    if isinstance(value, bool):
        raise TypeSafeJevError("PROVIDER_SCHEMA_INVALID", f"{field_name} must be numeric")
    try:
        parsed = float(value)
    except (TypeError, ValueError) as exc:
        raise TypeSafeJevError("PROVIDER_SCHEMA_INVALID", f"{field_name} must be numeric") from exc
    return parsed


def _optional_float(value: Any) -> float | None:
    if value is None:
        return None
    return _required_float(value, "probability")


def _optional_str(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _hash_response(response: dict[str, Any]) -> str:
    encoded = json.dumps(
        response,
        ensure_ascii=True,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return "sha256:" + sha256(encoded).hexdigest()


__all__ = ["ProviderTransport", "TypeSafeJevClient", "TypeSafeJevError"]
