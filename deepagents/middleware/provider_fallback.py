"""Ordered cross-provider fallback outside same-provider credential rotation."""
from __future__ import annotations

import os
import re

from langchain.agents.middleware import AgentMiddleware
from langchain.chat_models import init_chat_model

from middleware.failure_policy import (
    TerminalCredentialError,
    is_auth_failure,
    is_terminal_task_error,
)
from orchestration.agent_stream import publish_agent_stream_event
from middleware.token_fallback import credential_failure, model_provider
from model_policy import PROVIDER_PRESETS, canonical_provider, provider_init_kwargs
from provider_credentials import (
    PROVIDER_KEY_ENV,
    credential_init_kwargs,
    provider_token_source,
)
from tools.common.capabilities.platform.logging import get_logger


logger = get_logger(__name__)
_FALLBACK_PROVIDER_ENV = re.compile(r"^LLM_FALLBACK_PROVIDER_(\d+)$")


def configured_fallback_providers() -> tuple[str, ...]:
    """Return the ordered, de-duplicated provider fallback chain from environment."""
    indexed: list[tuple[int, str]] = []
    for env_name, raw_value in os.environ.items():
        match = _FALLBACK_PROVIDER_ENV.fullmatch(env_name)
        if match is None:
            continue
        value = raw_value.strip()
        if not value:
            continue
        provider = canonical_provider(value)
        if provider not in PROVIDER_PRESETS:
            supported = ", ".join(PROVIDER_PRESETS)
            raise RuntimeError(f"{env_name} must be one of: {supported}")
        if provider_token_source(provider) is None:
            required = " or ".join(PROVIDER_KEY_ENV[provider])
            raise RuntimeError(f"{env_name}={provider} requires {required}")
        indexed.append((int(match.group(1)), provider))

    providers: list[str] = []
    seen: set[str] = set()
    for _, provider in sorted(indexed, key=lambda item: item[0]):
        if provider in seen:
            continue
        seen.add(provider)
        providers.append(provider)
    return tuple(providers)


def _contains_terminal_credential_error(error: BaseException) -> bool:
    seen: set[int] = set()
    current: BaseException | None = error
    while current is not None and id(current) not in seen:
        seen.add(id(current))
        if isinstance(current, TerminalCredentialError):
            return True
        current = current.__cause__ or current.__context__
    return False


def provider_fallback_failure(error: BaseException) -> bool:
    """Return whether a provider-level route may be attempted for this failure."""
    if _contains_terminal_credential_error(error):
        return True
    if is_terminal_task_error(error):
        return False
    return is_auth_failure(error) or credential_failure(error)


def fallback_model(provider: str):
    """Construct one provider-preset model using only that provider's credentials."""
    canonical = canonical_provider(provider)
    preset = PROVIDER_PRESETS[canonical]
    return init_chat_model(
        preset.reasoning_model,
        **provider_init_kwargs(canonical),
        **credential_init_kwargs(canonical),
    )


class ProviderFallbackMiddleware(AgentMiddleware):
    """Move to the next configured provider after the current provider pool fails.

    Same-provider key rotation remains the responsibility of TokenFallbackMiddleware,
    which must be nested inside this middleware in the governance chain.
    """

    @staticmethod
    def _routes(request) -> tuple[str, ...]:
        current = model_provider(request.model)
        return tuple(
            provider
            for provider in configured_fallback_providers()
            if provider != current
        )

    @staticmethod
    def _log_attempt(*, current_provider: str | None, provider: str, index: int) -> None:
        logger.warning(
            "MODEL_PROVIDER_FALLBACK_ATTEMPT",
            current_provider=current_provider or "unknown",
            fallback_provider=provider,
            fallback_index=index,
        )
        publish_agent_stream_event(
            "PROVIDER_FALLBACK",
            status="RUNNING",
            text="provider fallback attempt",
            data={
                "current_provider": current_provider or "unknown",
                "fallback_provider": provider,
                "fallback_index": index,
            },
        )

    def wrap_model_call(self, request, handler):
        routes = self._routes(request)
        if not routes:
            return handler(request)

        current_provider = model_provider(request.model)
        first_error: BaseException | None = None
        try:
            return handler(request)
        except Exception as error:
            if not provider_fallback_failure(error):
                raise
            first_error = error

        for index, provider in enumerate(routes, start=1):
            self._log_attempt(
                current_provider=current_provider,
                provider=provider,
                index=index,
            )
            try:
                return handler(request.override(model=fallback_model(provider)))
            except Exception as error:
                if not provider_fallback_failure(error):
                    raise
                first_error = first_error or error

        raise TerminalCredentialError(
            "All configured LLM provider routes exhausted; task stopped"
        ) from first_error

    async def awrap_model_call(self, request, handler):
        routes = self._routes(request)
        if not routes:
            return await handler(request)

        current_provider = model_provider(request.model)
        first_error: BaseException | None = None
        try:
            return await handler(request)
        except Exception as error:
            if not provider_fallback_failure(error):
                raise
            first_error = error

        for index, provider in enumerate(routes, start=1):
            self._log_attempt(
                current_provider=current_provider,
                provider=provider,
                index=index,
            )
            try:
                return await handler(request.override(model=fallback_model(provider)))
            except Exception as error:
                if not provider_fallback_failure(error):
                    raise
                first_error = first_error or error

        raise TerminalCredentialError(
            "All configured LLM provider routes exhausted; task stopped"
        ) from first_error


__all__ = [
    "ProviderFallbackMiddleware",
    "configured_fallback_providers",
    "fallback_model",
    "provider_fallback_failure",
]
