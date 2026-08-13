from __future__ import annotations

import pytest

from lcsp_workers.llm import (
    BudgetExceeded,
    LlmProviderCandidate,
    LlmProviderUnavailableError,
    PrimaryThenFallbackLLMClient,
    PromptSafetyViolation,
)


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
        correlation_id: str | None = None,
    ):
        del prompt, workflow_run_id, node_name, max_tokens, correlation_id
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
    fallback = FakeClient(error=Exception("network down"))
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
    assert fallback.calls == 1
