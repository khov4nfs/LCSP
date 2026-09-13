"""Bounded credential fallback at the model-call boundary, never replaying tools."""
from __future__ import annotations

from langchain.agents.middleware import AgentMiddleware
from langchain.agents.structured_output import StructuredOutputError
from pydantic import ValidationError

from middleware.failure_policy import TerminalCredentialError, TerminalSchemaError
from provider_credentials import provider_token_source, provider_tokens
from tools.common.capabilities.platform.logging import get_logger


logger = get_logger(__name__)
_AUTH_FAILURE_STATUSES = frozenset({401, 403})
_RETRYABLE_TRANSIENT_STATUSES = frozenset({408, 409, 425, 429})
_DEAD_CREDENTIAL_SLOTS: dict[tuple[str, str], set[int]] = {}


def _error_status(error: BaseException) -> int | None:
    seen: set[int] = set()
    current: BaseException | None = error
    while current is not None and id(current) not in seen:
        seen.add(id(current))
        status = getattr(current, "status_code", None) or getattr(current, "code", None)
        if isinstance(status, int):
            return status
        current = current.__cause__ or current.__context__
    return None


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
    return _error_status(error) in _AUTH_FAILURE_STATUSES


def credential_failure(error: BaseException) -> bool:
    """Return whether an error may start credential rotation.

    Authentication failures are configuration errors for the credential that produced
    them. They are intentionally *not* eligible to start rotation from the primary key;
    rotation only starts for quota/transient failures.
    """
    return _is_retryable_transient_error(error)


def model_provider(model) -> str | None:
    module = type(model).__module__
    if module.startswith("langchain_openai."):
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
    settings["max_retries"] = 0
    return type(model)(**settings)


class TokenFallbackMiddleware(AgentMiddleware):
    """Try configured credential slots for transient provider failures only."""

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

    def _log_fallback_attempt(self, *, provider: str, env_name: str, index: int, reason: str) -> None:
        logger.warning(
            "MODEL_CREDENTIAL_FALLBACK_ATTEMPT",
            provider=provider,
            credential_source=env_name,
            credential_slot=index,
            fallback_enabled=True,
            reason=reason,
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

    def _log_skip_dead_slot(self, *, provider: str, env_name: str, index: int) -> None:
        logger.warning(
            "MODEL_CREDENTIAL_FALLBACK_SLOT_SKIPPED",
            provider=provider,
            credential_source=env_name,
            credential_slot=index,
            fallback_enabled=True,
            reason="previous_auth_failure",
        )

    def _mark_dead(self, *, provider: str, env_name: str, index: int, error: BaseException) -> None:
        self._dead_slots(provider, env_name).add(index)
        self._log_dead_slot(
            provider=provider,
            env_name=env_name,
            index=index,
            status=_error_status(error),
        )

    def _next_candidate_indexes(self, *, provider: str, env_name: str, tokens: tuple[str, ...]):
        dead = self._dead_slots(provider, env_name)
        for index in range(1, len(tokens)):
            if index in dead:
                self._log_skip_dead_slot(provider=provider, env_name=env_name, index=index)
                continue
            yield index

    def _run_with_fallback(self, *, request, handler, provider: str, env_name: str, tokens: tuple[str, ...], asynchronous: bool):
        if asynchronous:
            return self._arun_with_fallback(request, handler, provider, env_name, tokens)
        return self._srun_with_fallback(request, handler, provider, env_name, tokens)

    def _srun_with_fallback(self, request, handler, provider: str, env_name: str, tokens: tuple[str, ...]):
        try:
            return handler(request)
        except Exception as error:
            if _is_auth_failure(error) or not credential_failure(error):
                raise
            first_error = error
        for index in self._next_candidate_indexes(provider=provider, env_name=env_name, tokens=tokens):
            self._log_fallback_attempt(provider=provider, env_name=env_name, index=index, reason="primary_transient_failure")
            try:
                return handler(self._candidate_request(request, provider, tokens[index], index))
            except Exception as error:
                if _is_auth_failure(error):
                    self._mark_dead(provider=provider, env_name=env_name, index=index, error=error)
                    continue
                if not credential_failure(error):
                    raise
                continue
        raise TerminalCredentialError("All configured retryable provider credential slots failed; task stopped") from first_error

    async def _arun_with_fallback(self, request, handler, provider: str, env_name: str, tokens: tuple[str, ...]):
        try:
            return await handler(request)
        except Exception as error:
            if _is_auth_failure(error) or not credential_failure(error):
                raise
            first_error = error
        for index in self._next_candidate_indexes(provider=provider, env_name=env_name, tokens=tokens):
            self._log_fallback_attempt(provider=provider, env_name=env_name, index=index, reason="primary_transient_failure")
            try:
                return await handler(self._candidate_request(request, provider, tokens[index], index))
            except Exception as error:
                if _is_auth_failure(error):
                    self._mark_dead(provider=provider, env_name=env_name, index=index, error=error)
                    continue
                if not credential_failure(error):
                    raise
                continue
        raise TerminalCredentialError("All configured retryable provider credential slots failed; task stopped") from first_error


__all__ = [
    "TokenFallbackMiddleware",
    "credential_failure",
    "model_provider",
    "model_with_token",
]
