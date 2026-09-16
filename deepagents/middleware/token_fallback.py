"""Bounded credential fallback at the model-call boundary, never replaying tools."""
from __future__ import annotations

import time

from langchain.agents.middleware import AgentMiddleware
from langchain.agents.structured_output import StructuredOutputError
from pydantic import ValidationError

from middleware.failure_policy import (
    TerminalCredentialError,
    TerminalSchemaError,
    is_auth_failure,
    error_status,
)
from orchestration.agent_stream import publish_agent_stream_event
from provider_credentials import (
    LLM7_DEFAULT_BASE_URL,
    NO_SDK_RETRY_MAX_RETRIES,
    llm7_base_url,
    provider_token_source,
)
from tools.common.capabilities.platform.logging import get_logger


logger = get_logger(__name__)
_RATE_LIMITED_STATUSES = frozenset({429})
_RETRYABLE_TRANSIENT_STATUSES = frozenset({408, 409, 425, 429})
_DEFAULT_RATE_LIMIT_COOLDOWN_SECONDS = 30.0
_MAX_RATE_LIMIT_COOLDOWN_SECONDS = 120.0
# Process-window credential health. Auth failures are permanent for the process;
# rate limits only deprioritize a slot until its cooldown expires.
_DEAD_CREDENTIAL_SLOTS: dict[tuple[str, str], set[int]] = {}
_RATE_LIMITED_UNTIL: dict[tuple[str, str], dict[int, float]] = {}
_monotonic = time.monotonic


def _error_status(error: BaseException) -> int | None:
    return error_status(error)


def _is_terminal_model_error(error: BaseException) -> bool:
    seen: set[int] = set()
    current: BaseException | None = error
    while current is not None and id(current) not in seen:
        seen.add(id(current))
        if isinstance(current, (TypeError, ValidationError, StructuredOutputError, TerminalSchemaError)):
            return True
        current = current.__cause__ or current.__context__
    return False


def _is_retryable_transient_error(error: BaseException) -> bool:
    if _is_terminal_model_error(error):
        return False
    status = _error_status(error)
    if status in _RETRYABLE_TRANSIENT_STATUSES:
        return True
    if status is not None:
        return status >= 500
    return isinstance(error, (TimeoutError, ConnectionError))


def _is_auth_failure(error: BaseException) -> bool:
    return is_auth_failure(error)


def _is_rate_limited(error: BaseException) -> bool:
    return not _is_terminal_model_error(error) and _error_status(error) in _RATE_LIMITED_STATUSES


def _retry_after_seconds(error: BaseException) -> float | None:
    seen: set[int] = set()
    current: BaseException | None = error
    while current is not None and id(current) not in seen:
        seen.add(id(current))
        response = getattr(current, "response", None)
        headers = getattr(response, "headers", None)
        raw = headers.get("retry-after") if hasattr(headers, "get") else None
        if raw is not None:
            try:
                value = float(raw)
            except (TypeError, ValueError):
                return None
            return value if value >= 0 else None
        current = current.__cause__ or current.__context__
    return None


def credential_failure(error: BaseException) -> bool:
    """Return whether an error may move a model call to another credential slot.

    Authentication failures are handled separately: they mark the failing slot dead for
    this process instead of being treated as a transient failure of the same slot.
    """
    return _is_retryable_transient_error(error)


def model_provider(model) -> str | None:
    module = type(model).__module__
    if module.startswith("langchain_openai."):
        base_url = str(getattr(model, "openai_api_base", "") or "").rstrip("/")
        configured_llm7 = llm7_base_url()
        default_llm7 = LLM7_DEFAULT_BASE_URL.rstrip("/")
        if base_url == configured_llm7 or base_url == default_llm7 or base_url.startswith(
            f"{default_llm7}/"
        ):
            return "llm7"
        return "openai"
    if module.startswith("langchain_google_genai."):
        return "google_genai"
    return None


def model_with_token(model, provider: str, token: str):
    # Reconstruct SDK clients; model_copy would retain the previous key's clients.
    settings = model.model_dump(exclude={"openai_api_key", "google_api_key"})
    settings["api_key"] = token
    # Fallback rotation owns retry policy. In particular, retrying a 401 with the same
    # dead Gemini key only adds latency and duplicate Unauthorized log lines.
    settings["max_retries"] = NO_SDK_RETRY_MAX_RETRIES[provider]
    return type(model)(**settings)


class TokenFallbackMiddleware(AgentMiddleware):
    """Try healthy configured credential slots, each at most once per model call.

    - 401/403: the slot is dead for this process and is skipped on later calls.
    - 429: the slot is cooled down (Retry-After when present) and tried after healthy
      slots until the cooldown expires; it is never marked dead.
    - other transient failures (5xx, timeouts): move on to the next slot.
    - schema/request failures: raised immediately, no rotation.
    """

    def wrap_model_call(self, request, handler):
        provider = model_provider(request.model)
        source = provider_token_source(provider) if provider else None
        if source is None or len(source[1]) < 2:
            return handler(request)
        env_name, tokens = source
        return self._run_with_fallback(
            request=request,
            handler=handler,
            provider=provider,
            env_name=env_name,
            tokens=tokens,
            asynchronous=False,
        )

    async def awrap_model_call(self, request, handler):
        provider = model_provider(request.model)
        source = provider_token_source(provider) if provider else None
        if source is None or len(source[1]) < 2:
            return await handler(request)
        env_name, tokens = source
        return await self._run_with_fallback(
            request=request,
            handler=handler,
            provider=provider,
            env_name=env_name,
            tokens=tokens,
            asynchronous=True,
        )

    def _candidate_request(self, request, provider: str, token: str, index: int):
        if index == 0:
            return request
        return request.override(model=model_with_token(request.model, provider, token))

    def _dead_slots(self, provider: str, env_name: str) -> set[int]:
        return _DEAD_CREDENTIAL_SLOTS.setdefault((provider, env_name), set())

    def _rate_limited_slots(self, provider: str, env_name: str) -> dict[int, float]:
        return _RATE_LIMITED_UNTIL.setdefault((provider, env_name), {})

    def _log_fallback_attempt(self, *, provider: str, env_name: str, index: int, reason: str) -> None:
        logger.warning(
            "MODEL_CREDENTIAL_FALLBACK_ATTEMPT",
            provider=provider,
            credential_source=env_name,
            credential_slot=index,
            fallback_enabled=True,
            reason=reason,
        )
        publish_agent_stream_event(
            "CREDENTIAL_ROTATION",
            status="RUNNING",
            text="credential fallback attempt",
            data={
                "provider": provider,
                "credential_source": env_name,
                "credential_slot": index,
                "reason": reason,
            },
        )

    def _log_dead_slot(self, *, provider: str, env_name: str, index: int, status: int | None) -> None:
        logger.warning(
            "MODEL_CREDENTIAL_FALLBACK_SLOT_DEAD",
            provider=provider,
            credential_source=env_name,
            credential_slot=index,
            fallback_enabled=True,
            status_code=status,
        )
        publish_agent_stream_event(
            "CREDENTIAL_ROTATION",
            status="FAILED",
            text="credential slot marked dead",
            data={
                "provider": provider,
                "credential_source": env_name,
                "credential_slot": index,
                "status_code": status,
            },
        )

    def _log_skip_dead_slot(self, *, provider: str, env_name: str, index: int) -> None:
        logger.warning(
            "MODEL_CREDENTIAL_FALLBACK_SLOT_SKIPPED",
            provider=provider,
            credential_source=env_name,
            credential_slot=index,
            fallback_enabled=True,
            reason="previous_auth_failure",
        )

    def _log_rate_limited_slot(
        self, *, provider: str, env_name: str, index: int, cooldown_seconds: float
    ) -> None:
        logger.warning(
            "MODEL_CREDENTIAL_FALLBACK_SLOT_RATE_LIMITED",
            provider=provider,
            credential_source=env_name,
            credential_slot=index,
            fallback_enabled=True,
            cooldown_seconds=cooldown_seconds,
        )
        publish_agent_stream_event(
            "CREDENTIAL_ROTATION",
            status="WAITING",
            text="credential slot rate limited",
            data={
                "provider": provider,
                "credential_source": env_name,
                "credential_slot": index,
                "cooldown_seconds": cooldown_seconds,
            },
        )

    def _mark_dead(self, *, provider: str, env_name: str, index: int, error: BaseException) -> None:
        self._dead_slots(provider, env_name).add(index)
        self._rate_limited_slots(provider, env_name).pop(index, None)
        self._log_dead_slot(
            provider=provider,
            env_name=env_name,
            index=index,
            status=_error_status(error),
        )

    def _mark_rate_limited(self, *, provider: str, env_name: str, index: int, error: BaseException) -> None:
        retry_after = _retry_after_seconds(error)
        cooldown = min(
            retry_after if retry_after is not None else _DEFAULT_RATE_LIMIT_COOLDOWN_SECONDS,
            _MAX_RATE_LIMIT_COOLDOWN_SECONDS,
        )
        self._rate_limited_slots(provider, env_name)[index] = _monotonic() + cooldown
        self._log_rate_limited_slot(
            provider=provider,
            env_name=env_name,
            index=index,
            cooldown_seconds=cooldown,
        )

    def _mark_healthy(self, *, provider: str, env_name: str, index: int) -> None:
        self._rate_limited_slots(provider, env_name).pop(index, None)

    def _attempt_order(self, *, provider: str, env_name: str, tokens: tuple[str, ...]) -> list[int]:
        dead = self._dead_slots(provider, env_name)
        cooling = self._rate_limited_slots(provider, env_name)
        now = _monotonic()
        healthy: list[int] = []
        cooled: list[int] = []
        for index in range(len(tokens)):
            if index in dead:
                self._log_skip_dead_slot(provider=provider, env_name=env_name, index=index)
                continue
            if cooling.get(index, 0.0) > now:
                cooled.append(index)
            else:
                cooling.pop(index, None)
                healthy.append(index)
        return healthy + sorted(cooled, key=lambda index: cooling[index])

    def _record_failure(self, *, provider: str, env_name: str, index: int, error: BaseException) -> bool:
        """Record slot health for a failed attempt; return whether rotation may continue."""
        if _is_auth_failure(error):
            self._mark_dead(provider=provider, env_name=env_name, index=index, error=error)
            return True
        if _is_rate_limited(error):
            self._mark_rate_limited(provider=provider, env_name=env_name, index=index, error=error)
            return True
        return credential_failure(error)

    def _run_with_fallback(self, *, request, handler, provider: str, env_name: str, tokens: tuple[str, ...], asynchronous: bool):
        if asynchronous:
            return self._arun_with_fallback(request, handler, provider, env_name, tokens)
        return self._srun_with_fallback(request, handler, provider, env_name, tokens)

    def _srun_with_fallback(self, request, handler, provider: str, env_name: str, tokens: tuple[str, ...]):
        first_error: BaseException | None = None
        for attempt, index in enumerate(
            self._attempt_order(provider=provider, env_name=env_name, tokens=tokens)
        ):
            if attempt:
                self._log_fallback_attempt(provider=provider, env_name=env_name, index=index, reason="previous_slot_failure")
            try:
                response = handler(self._candidate_request(request, provider, tokens[index], index))
            except Exception as error:
                if not self._record_failure(provider=provider, env_name=env_name, index=index, error=error):
                    raise
                first_error = first_error or error
                continue
            self._mark_healthy(provider=provider, env_name=env_name, index=index)
            return response
        raise TerminalCredentialError("All configured retryable provider credential slots failed; task stopped") from first_error

    async def _arun_with_fallback(self, request, handler, provider: str, env_name: str, tokens: tuple[str, ...]):
        first_error: BaseException | None = None
        for attempt, index in enumerate(
            self._attempt_order(provider=provider, env_name=env_name, tokens=tokens)
        ):
            if attempt:
                self._log_fallback_attempt(provider=provider, env_name=env_name, index=index, reason="previous_slot_failure")
            try:
                response = await handler(self._candidate_request(request, provider, tokens[index], index))
            except Exception as error:
                if not self._record_failure(provider=provider, env_name=env_name, index=index, error=error):
                    raise
                first_error = first_error or error
                continue
            self._mark_healthy(provider=provider, env_name=env_name, index=index)
            return response
        raise TerminalCredentialError("All configured retryable provider credential slots failed; task stopped") from first_error


__all__ = [
    "TokenFallbackMiddleware",
    "credential_failure",
    "model_provider",
    "model_with_token",
]
