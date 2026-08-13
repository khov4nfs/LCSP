from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol, runtime_checkable

import httpx

from .budget_tracker import BudgetExceeded
from .gateway_client import (
    LLMGatewayClient,
    LLMResponse,
    LLMToolDefinition,
    LLMToolResponse,
)
from .prompt_safety import PromptSafetyViolation


@runtime_checkable
class LLMClientProtocol(Protocol):
    def complete(
        self,
        prompt: str,
        workflow_run_id: str,
        node_name: str,
        max_tokens: int | None = None,
        correlation_id: str | None = None,
    ) -> LLMResponse: ...

    def complete_with_tools(
        self,
        prompt: str,
        *,
        tools: list[LLMToolDefinition],
        workflow_run_id: str,
        node_name: str,
        max_tokens: int | None = None,
        correlation_id: str | None = None,
    ) -> LLMToolResponse: ...


class LlmProviderAuthError(Exception):
    pass


class LlmProviderRateLimitError(Exception):
    pass


class LlmProviderQuotaError(Exception):
    pass


class LlmProviderTimeoutError(Exception):
    pass


class LlmProviderNetworkError(Exception):
    pass


class LlmProviderUnavailableError(Exception):
    def __init__(self, reasons: list[str]):
        self.reasons = reasons
        super().__init__("No eligible LLM provider completed the request.")


@dataclass(frozen=True)
class LlmProviderCandidate:
    name: str
    client: LLMGatewayClient


class PrimaryThenFallbackLLMClient:
    def __init__(
        self,
        providers: tuple[LlmProviderCandidate, ...],
        *,
        fallback_on_codes: tuple[str, ...],
        max_provider_attempts: int,
    ) -> None:
        if not providers:
            raise ValueError("at least one LLM provider candidate is required")
        if max_provider_attempts < 1:
            raise ValueError("max_provider_attempts must be >= 1")
        self._providers = providers
        self._fallback_on_codes = {code.upper() for code in fallback_on_codes}
        self._max_provider_attempts = max_provider_attempts

    def complete(
        self,
        prompt: str,
        workflow_run_id: str,
        node_name: str,
        max_tokens: int | None = None,
        correlation_id: str | None = None,
    ) -> LLMResponse:
        return self._dispatch(
            lambda client: client.complete(
                prompt=prompt,
                workflow_run_id=workflow_run_id,
                node_name=node_name,
                max_tokens=max_tokens,
                correlation_id=correlation_id,
            )
        )

    def complete_with_tools(
        self,
        prompt: str,
        *,
        tools: list[LLMToolDefinition],
        workflow_run_id: str,
        node_name: str,
        max_tokens: int | None = None,
        correlation_id: str | None = None,
    ) -> LLMToolResponse:
        return self._dispatch(
            lambda client: client.complete_with_tools(
                prompt=prompt,
                tools=tools,
                workflow_run_id=workflow_run_id,
                node_name=node_name,
                max_tokens=max_tokens,
                correlation_id=correlation_id,
            )
        )

    def _dispatch(self, operation):
        reasons: list[str] = []
        attempts = 0
        for provider in self._providers:
            if attempts >= self._max_provider_attempts:
                break
            attempts += 1
            try:
                return operation(provider.client)
            except (PromptSafetyViolation, BudgetExceeded):
                raise
            except Exception as exc:
                code = _classify_provider_error(exc)
                reasons.append(f"{provider.name}:{code}")
                if code not in self._fallback_on_codes:
                    raise
                continue
        raise LlmProviderUnavailableError(reasons)


def _classify_provider_error(exc: Exception) -> str:
    if isinstance(exc, LlmProviderAuthError):
        return "AUTH"
    if isinstance(exc, LlmProviderRateLimitError):
        return "RATE_LIMIT"
    if isinstance(exc, LlmProviderQuotaError):
        return "QUOTA"
    if isinstance(exc, LlmProviderTimeoutError):
        return "TIMEOUT"
    if isinstance(exc, LlmProviderNetworkError):
        return "NETWORK"

    status_code = getattr(exc, "status_code", None)
    if status_code == 401 or status_code == 403:
        return "AUTH"
    if status_code == 408:
        return "TIMEOUT"
    if status_code == 429:
        return "RATE_LIMIT"

    response = getattr(exc, "response", None)
    if response is not None:
        response_status = getattr(response, "status_code", None)
        if response_status == 401 or response_status == 403:
            return "AUTH"
        if response_status == 408:
            return "TIMEOUT"
        if response_status == 429:
            return "RATE_LIMIT"

    if isinstance(exc, httpx.TimeoutException):
        return "TIMEOUT"
    if isinstance(exc, httpx.RequestError):
        return "NETWORK"

    message = str(exc).lower()
    if "quota" in message or "insufficient_quota" in message:
        return "QUOTA"
    if "rate limit" in message or "too many requests" in message:
        return "RATE_LIMIT"
    if "timeout" in message or "timed out" in message:
        return "TIMEOUT"
    if "network" in message or "connection" in message:
        return "NETWORK"
    if "auth" in message or "invalid api key" in message or "unauthorized" in message:
        return "AUTH"
    return "UNKNOWN"
