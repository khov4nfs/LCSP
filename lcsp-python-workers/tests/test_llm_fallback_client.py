from __future__ import annotations

from types import SimpleNamespace

import pytest

from lcsp_workers.llm import (
    BudgetExceeded,
    LlmProviderCandidate,
    LlmProviderUnavailableError,
    PrimaryThenFallbackLLMClient,
    PromptSafetyViolation,
)
from lcsp_workers.llm.fallback_client import _safe_provider_error_details


class FakeClient:
    def __init__(self, result=None, error: Exception | None = None):
        self.result = result
        self.error = error
        self.calls = 0

    def complete(
        self,
        prompt: str,
        workflow_run_id: str,
        node_name: str,
        max_tokens: int | None = None,
        correlationId: str | None = None,
    ):
        del prompt, workflow_run_id, node_name, max_tokens, correlationId
        self.calls += 1
        if self.error is not None:
            raise self.error
        return self.result

    def complete_with_tools(self, **kwargs):
        self.calls += 1
        if self.error is not None:
            raise self.error
        return self.result


class RateLimitError(Exception):
    status_code = 429


class ProviderBadRequestError(Exception):
    status_code = 400
    request_id = "req_direct_123"


class ProviderResponseError(Exception):
    def __init__(self, message: str):
        super().__init__(message)
        self.response = SimpleNamespace(
            status_code=400,
            headers={"X-Request-Id": "req_header_456"},
        )


def test_primary_then_fallback_uses_second_provider_on_retryable_error() -> None:
    primary = FakeClient(error=RateLimitError("too many requests"))
    fallback = FakeClient(result="ok")
    client = PrimaryThenFallbackLLMClient(
        (
            LlmProviderCandidate(name="openai", client=primary),
            LlmProviderCandidate(name="anthropic", client=fallback),
        ),
        fallback_on_codes=("RATE_LIMIT", "NETWORK"),
        max_provider_attempts=2,
    )

    result = client.complete(
        "hello",
        workflow_run_id="wf-1",
        node_name="node-1",
    )

    assert result == "ok"
    assert primary.calls == 1
    assert fallback.calls == 1


def test_primary_then_fallback_does_not_retry_budget_exceeded() -> None:
    primary = FakeClient(error=BudgetExceeded("cap reached"))
    fallback = FakeClient(result="ok")
    client = PrimaryThenFallbackLLMClient(
        (
            LlmProviderCandidate(name="openai", client=primary),
            LlmProviderCandidate(name="anthropic", client=fallback),
        ),
        fallback_on_codes=("RATE_LIMIT", "NETWORK"),
        max_provider_attempts=2,
    )

    with pytest.raises(BudgetExceeded):
        client.complete(
            "hello",
            workflow_run_id="wf-1",
            node_name="node-1",
        )

    assert primary.calls == 1
    assert fallback.calls == 0


def test_primary_then_fallback_does_not_retry_prompt_safety_violation() -> None:
    primary = FakeClient(error=PromptSafetyViolation("unsafe"))
    fallback = FakeClient(result="ok")
    client = PrimaryThenFallbackLLMClient(
        (
            LlmProviderCandidate(name="openai", client=primary),
            LlmProviderCandidate(name="anthropic", client=fallback),
        ),
        fallback_on_codes=("RATE_LIMIT", "NETWORK"),
        max_provider_attempts=2,
    )

    with pytest.raises(PromptSafetyViolation):
        client.complete(
            "hello",
            workflow_run_id="wf-1",
            node_name="node-1",
        )

    assert primary.calls == 1
    assert fallback.calls == 0


def test_primary_then_fallback_raises_when_all_candidates_fail() -> None:
    primary = FakeClient(error=RateLimitError("too many requests"))
    fallback_error = Exception("network down")
    fallback = FakeClient(error=fallback_error)
    client = PrimaryThenFallbackLLMClient(
        (
            LlmProviderCandidate(name="openai", client=primary),
            LlmProviderCandidate(name="anthropic", client=fallback),
        ),
        fallback_on_codes=("RATE_LIMIT", "NETWORK", "UNKNOWN"),
        max_provider_attempts=2,
    )

    with pytest.raises(LlmProviderUnavailableError) as exc_info:
        client.complete(
            "hello",
            workflow_run_id="wf-1",
            node_name="node-1",
        )

    assert "openai:RATE_LIMIT" in exc_info.value.reasons
    assert exc_info.value.last_error is fallback_error
    assert exc_info.value.last_provider == "anthropic"
    assert fallback.calls == 1


def test_safe_provider_error_details_include_status_and_direct_request_id() -> None:
    error = ProviderBadRequestError("request is too large")

    details = _safe_provider_error_details(error)

    assert details == {
        "error_message": "request is too large",
        "status_code": 400,
        "request_id": "req_direct_123",
    }


def test_safe_provider_error_details_read_request_id_header_and_redact_api_key() -> None:
    api_key = "sk-test-super-secret-key-value-123456"
    error = ProviderResponseError(
        f"invalid request: api_key={api_key}; context_length_exceeded"
    )

    details = _safe_provider_error_details(error, api_keys=(api_key,))

    assert details["status_code"] == 400
    assert details["request_id"] == "req_header_456"
    assert api_key not in str(details["error_message"])
    assert "[REDACTED" in str(details["error_message"])
    assert "context_length_exceeded" in str(details["error_message"])
