"""Dispatch LLM calls across primary/fallback providers under explicit policy."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol, runtime_checkable

import httpx

from lcsp_workers.platform.logging import get_logger
from lcsp_workers.platform.redaction import redact_string

from .budget_tracker import BudgetExceeded
from .gateway_client import (
    LLMGatewayClient,
    LLMResponse,
    LLMToolDefinition,
    LLMToolResponse,
)
from .prompt_safety import PromptSafetyViolation


logger = get_logger(__name__)
_MAX_PROVIDER_ERROR_MESSAGE_CHARS = 4_000
_PROVIDER_REQUEST_ID_HEADERS = (
    "x-request-id",
    "request-id",
    "openai-request-id",
    "anthropic-request-id",
    "x-goog-request-id",
)


@runtime_checkable
class LLMClientProtocol(Protocol):
    """Minimal completion interface consumed by worker orchestration code."""

    def complete(
        self,
        prompt: str,
        workflow_run_id: str,
        node_name: str,
        max_tokens: int | None = None,
        correlationId: str | None = None,
    ) -> LLMResponse:
        """Execute a plain-text completion request."""
        ...

    def complete_with_tools(
        self,
        prompt: str,
        *,
        tools: list[LLMToolDefinition],
        workflow_run_id: str,
        node_name: str,
        max_tokens: int | None = None,
        correlationId: str | None = None,
    ) -> LLMToolResponse:
        """Execute a completion request that may return structured tool calls."""
        ...


class LlmProviderAuthError(Exception):
    """Raised for provider authentication failures."""


class LlmProviderRateLimitError(Exception):
    """Raised when a provider rejects a request due to rate limiting."""


class LlmProviderQuotaError(Exception):
    """Raised when a provider account has exhausted its quota."""


class LlmProviderTimeoutError(Exception):
    """Raised when a provider request exceeds its timeout."""


class LlmProviderNetworkError(Exception):
    """Raised for transport-level provider connectivity failures."""


class LlmProviderUnavailableError(Exception):
    """Raised when no eligible provider completes the operation."""

    def __init__(
        self,
        reasons: list[str],
        *,
        last_error: Exception | None = None,
        last_provider: str | None = None,
    ):
        """Store provider failure reasons for audit/debug visibility.

        Args:
            reasons: Ordered ``provider:error_code`` entries from attempted providers.
            last_error: Final provider exception, retained only for safe diagnostic extraction.
            last_provider: Provider name associated with ``last_error``.
        """
        self.reasons = reasons
        self.last_error = last_error
        self.last_provider = last_provider
        super().__init__("No eligible LLM provider completed the request.")


@dataclass(frozen=True)
class LlmProviderCandidate:
    """Named LLM gateway client considered during provider dispatch."""

    name: str
    client: LLMGatewayClient


class PrimaryThenFallbackLLMClient:
    """Try providers in order while honoring explicit fallback error codes."""

    def __init__(
        self,
        providers: tuple[LlmProviderCandidate, ...],
        *,
        fallback_on_codes: tuple[str, ...],
        max_provider_attempts: int,
    ) -> None:
        """Create a bounded provider-fallback dispatcher.

        Args:
            providers: Ordered provider candidates; first entry is primary.
            fallback_on_codes: Classified error codes allowed to trigger fallback.
            max_provider_attempts: Maximum provider calls for one logical request.

        Raises:
            ValueError: If no providers are supplied or the attempt limit is invalid.
        """
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
        correlationId: str | None = None,
    ) -> LLMResponse:
        """Dispatch a plain completion and emit safe request/response telemetry."""
        self._log_request(
            operation="complete",
            prompt=prompt,
            workflow_run_id=workflow_run_id,
            node_name=node_name,
            max_tokens=max_tokens,
            correlation_id=correlationId,
        )
        try:
            result = self._dispatch(
                lambda client: client.complete(
                    prompt=prompt,
                    workflow_run_id=workflow_run_id,
                    node_name=node_name,
                    max_tokens=max_tokens,
                    correlationId=correlationId,
                )
            )
        except Exception as exc:
            self._log_failure(
                operation="complete",
                workflow_run_id=workflow_run_id,
                node_name=node_name,
                correlation_id=correlationId,
                error=exc,
            )
            raise
        self._log_response(
            operation="complete",
            workflow_run_id=workflow_run_id,
            node_name=node_name,
            correlation_id=correlationId,
            response=result,
        )
        return result

    def complete_with_tools(
        self,
        prompt: str,
        *,
        tools: list[LLMToolDefinition],
        workflow_run_id: str,
        node_name: str,
        max_tokens: int | None = None,
        correlationId: str | None = None,
    ) -> LLMToolResponse:
        """Dispatch a tool-enabled completion and emit safe request telemetry."""
        self._log_request(
            operation="complete_with_tools",
            prompt=prompt,
            workflow_run_id=workflow_run_id,
            node_name=node_name,
            max_tokens=max_tokens,
            correlation_id=correlationId,
            tool_names=[tool.name for tool in tools],
        )
        try:
            result = self._dispatch(
                lambda client: client.complete_with_tools(
                    prompt=prompt,
                    tools=tools,
                    workflow_run_id=workflow_run_id,
                    node_name=node_name,
                    max_tokens=max_tokens,
                    correlationId=correlationId,
                )
            )
        except Exception as exc:
            self._log_failure(
                operation="complete_with_tools",
                workflow_run_id=workflow_run_id,
                node_name=node_name,
                correlation_id=correlationId,
                error=exc,
            )
            raise
        self._log_response(
            operation="complete_with_tools",
            workflow_run_id=workflow_run_id,
            node_name=node_name,
            correlation_id=correlationId,
            response=result,
        )
        return result

    def _dispatch(self, operation):
        """Run one operation against eligible providers until policy stops fallback."""
        reasons: list[str] = []
        attempts = 0
        last_error: Exception | None = None
        last_provider: str | None = None
        for provider in self._providers:
            if attempts >= self._max_provider_attempts:
                break
            attempts += 1
            try:
                return operation(provider.client)
            except (PromptSafetyViolation, BudgetExceeded):
                raise
            except Exception as exc:
                last_error = exc
                last_provider = provider.name
                code = _classify_provider_error(exc)
                reasons.append(f"{provider.name}:{code}")
                if code not in self._fallback_on_codes:
                    raise
                continue
        raise LlmProviderUnavailableError(
            reasons,
            last_error=last_error,
            last_provider=last_provider,
        )

    def _log_request(
        self,
        *,
        operation: str,
        prompt: str,
        workflow_run_id: str,
        node_name: str,
        max_tokens: int | None,
        correlation_id: str | None,
        tool_names: list[str] | None = None,
    ) -> None:
        """Log one safe logical LLM request without prompt or credential contents."""
        logger.info(
            "LLM_REQUEST",
            operation=operation,
            provider_chain=[provider.name for provider in self._providers],
            model_chain=[
                getattr(provider.client, "model", None) for provider in self._providers
            ],
            workflow_run_id=workflow_run_id,
            node_name=node_name,
            max_tokens=max_tokens,
            prompt_chars=len(prompt),
            tool_names=tool_names or [],
            correlationId=correlation_id,
        )

    @staticmethod
    def _log_response(
        *,
        operation: str,
        workflow_run_id: str,
        node_name: str,
        correlation_id: str | None,
        response: LLMResponse,
    ) -> None:
        """Log normalized provider usage after a successful LLM request."""
        logger.info(
            "LLM_RESPONSE",
            operation=operation,
            provider=getattr(response, "provider", None),
            model=getattr(response, "model", None),
            workflow_run_id=workflow_run_id,
            node_name=node_name,
            request_id=getattr(response, "request_id", None),
            input_tokens=getattr(response, "input_tokens", None),
            output_tokens=getattr(response, "output_tokens", None),
            tool_call_count=len(getattr(response, "tool_calls", ()) or ()),
            correlationId=correlation_id,
        )

    def _log_failure(
        self,
        *,
        operation: str,
        workflow_run_id: str,
        node_name: str,
        correlation_id: str | None,
        error: Exception,
    ) -> None:
        """Log redacted provider failure details while preserving the original exception."""
        diagnostic_error = (
            error.last_error
            if isinstance(error, LlmProviderUnavailableError) and error.last_error is not None
            else error
        )
        provider = (
            error.last_provider if isinstance(error, LlmProviderUnavailableError) else None
        )
        details = _safe_provider_error_details(
            diagnostic_error,
            api_keys=tuple(
                str(key)
                for key in (
                    getattr(candidate.client, "api_key", None)
                    for candidate in self._providers
                )
                if key
            ),
        )
        logger.error(
            "LLM_REQUEST_FAILED",
            operation=operation,
            workflow_run_id=workflow_run_id,
            node_name=node_name,
            provider=provider,
            error_type=type(diagnostic_error).__name__,
            error_code=_classify_provider_error(diagnostic_error),
            error_message=details["error_message"],
            status_code=details["status_code"],
            request_id=details["request_id"],
            correlationId=correlation_id,
        )


def _safe_provider_error_details(
    error: Exception,
    *,
    api_keys: tuple[str, ...] = (),
) -> dict[str, str | int | None]:
    """Extract bounded provider diagnostics without exposing configured credentials."""
    response = getattr(error, "response", None)
    status_code = getattr(error, "status_code", None)
    if status_code is None and response is not None:
        status_code = getattr(response, "status_code", None)

    request_id = (
        getattr(error, "request_id", None)
        or getattr(error, "requestId", None)
        or _request_id_from_headers(getattr(response, "headers", None))
    )

    message = redact_string(str(error)).strip() or type(error).__name__
    for api_key in api_keys:
        if api_key:
            message = message.replace(api_key, "[REDACTED:API_KEY]")
    if len(message) > _MAX_PROVIDER_ERROR_MESSAGE_CHARS:
        message = message[:_MAX_PROVIDER_ERROR_MESSAGE_CHARS] + "…"

    normalized_status: str | int | None
    if isinstance(status_code, int):
        normalized_status = status_code
    elif status_code is None:
        normalized_status = None
    else:
        try:
            normalized_status = int(status_code)
        except (TypeError, ValueError):
            normalized_status = str(status_code)[:64]

    return {
        "error_message": message,
        "status_code": normalized_status,
        "request_id": str(request_id)[:256] if request_id is not None else None,
    }


def _request_id_from_headers(headers) -> str | None:
    """Read only allow-listed request-id headers from a provider HTTP response."""
    if headers is None:
        return None
    try:
        normalized = {str(key).lower(): value for key, value in headers.items()}
    except (AttributeError, TypeError, ValueError):
        return None
    for name in _PROVIDER_REQUEST_ID_HEADERS:
        value = normalized.get(name)
        if value:
            return str(value)
    return None


def _classify_provider_error(exc: Exception) -> str:
    """Normalize provider/transport exceptions into fallback policy codes.

    Args:
        exc: Exception raised by a provider client.

    Returns:
        One of the known provider error codes or ``UNKNOWN``.
    """
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
