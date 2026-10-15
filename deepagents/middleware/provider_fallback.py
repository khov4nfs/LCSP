"""Ordered configured-route fallback outside same-provider credential rotation.

Routes come from the model routes YAML (``model_policy``); circuit and sticky state are
keyed by route identity ``provider:model``.
"""
from __future__ import annotations

import asyncio
import time

from langchain.agents.middleware import AgentMiddleware

from middleware.failure_policy import (
    TerminalCredentialError,
    error_status,
    is_auth_failure,
    is_provider_capacity_failure,
    is_provider_model_unavailable,
    is_provider_quota_exhaustion,
    is_provider_refusal,
    is_provider_route_incompatibility,
    is_structured_output_rejection,
    is_terminal_task_error,
)
from middleware.token_fallback import (
    credential_failure,
    further_provider_route,
    model_protocol,
)
from middleware.usage_metering import (
    active_agent_role,
    active_agent_run_state,
    provider_identity,
)
from model_policy import (
    ResolvedModelConfig,
    build_model,
    fallback_routes,
    model_route_config,
    resolve_role,
    route_for_model,
)
from provider_credentials import PROVIDER_KEY_ENV, provider_token_source
from tools.common.capabilities.platform.logging import get_logger

logger = get_logger(__name__)
_PERMANENT_PROVIDER_ROUTE_STATUSES = frozenset({401, 402, 403})
# A plain 429 across a whole pool is a per-minute window, not a fault: the routes that hit one are
# retried after these pauses (bounded; about four minutes in all) before the task is ended.
_RATE_LIMIT_BACKOFF_SECONDS = (5.0, 15.0, 30.0, 60.0, 60.0, 60.0)
_sleep = time.sleep
_asleep = asyncio.sleep


def route_key(provider: str, model: str, protocol: str) -> str:
    """Stable identity of one configured route; circuit/sticky state is keyed by it."""
    return f"{provider.lower()}:{protocol}:{model}"


def _config_key(config: ResolvedModelConfig) -> str:
    return route_key(config.provider, config.model, config.protocol)


def _request_route(model) -> tuple[str, ResolvedModelConfig | None]:
    """Return (route key, configured route) of the request's model.

    Attached configuration is authoritative; class-derived identity is only a
    compatibility path for models created outside the route loader.
    """
    route = model_route_config(model)
    if route is not None:
        return _config_key(route), route
    provider, name = provider_identity(model)
    provider = provider.lower()
    protocol = model_protocol(model)
    role = active_agent_role()
    if role:
        config = resolve_role(role)
        if (
            (config.provider, config.model) == (provider, name)
            and (protocol is None or config.protocol == protocol)
        ):
            return _config_key(config), config
    config = route_for_model(provider, name, protocol)
    if config is not None:
        return _config_key(config), config
    return route_key(provider, name, protocol or "unknown"), None


def _fallback_chain(config: ResolvedModelConfig | None) -> tuple[ResolvedModelConfig, ...]:
    """Configured fallback routes of the current route (the role's chain if unmapped)."""
    if config is not None:
        return fallback_routes(config.route_id)
    return fallback_routes(active_agent_role() or "default")


def _require_credentials(chain: tuple[ResolvedModelConfig, ...]) -> None:
    for config in chain:
        if provider_token_source(config.provider) is None:
            required = " or ".join(PROVIDER_KEY_ENV[config.provider])
            raise RuntimeError(
                f"fallback route {config.route_id!r} ({config.provider}) requires {required}"
            )


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
    if is_provider_route_incompatibility(error):
        return True
    # The model route is down; the request is fine and another provider has it.
    if is_provider_model_unavailable(error):
        return True
    # One route's model declined the sample; another route (or another sample) may answer.
    if is_provider_refusal(error):
        return True
    # The provider's model could not produce the contract; another provider may.
    if is_structured_output_rejection(error):
        return True
    if is_terminal_task_error(error):
        return False
    return (
        is_auth_failure(error)
        or is_provider_capacity_failure(error)
        or credential_failure(error)
    )


def _is_rate_limited_chain(error: BaseException) -> bool:
    """Whether a failure is a plain 429 rate limit (not quota exhaustion or auth)."""
    seen: set[int] = set()
    current: BaseException | None = error
    while current is not None and id(current) not in seen:
        seen.add(id(current))
        if error_status(current) == 429 and not is_provider_quota_exhaustion(current):
            return True
        current = current.__cause__ or current.__context__
    return False


def _exhaustion_error(errors: list[BaseException]) -> BaseException:
    """Report exhaustion truthfully: a contract failure on every route stays a schema error."""
    if errors and all(is_structured_output_rejection(error) for error in errors):
        return errors[0]
    # Every route declined the sample: surface the refusal itself so the model retry resamples,
    # instead of a terminal "exhausted" that no retry may follow.
    if errors and all(is_provider_refusal(error) for error in errors):
        return errors[0]
    return TerminalCredentialError("All configured LLM provider routes exhausted; task stopped")


def provider_circuit_breaker_failure(error: BaseException) -> bool:
    """Return whether this provider route should stay disabled for the active run."""
    if is_provider_route_incompatibility(error) or is_structured_output_rejection(error):
        return True
    # A model the provider has withdrawn or overloaded will not recover inside
    # this run, so stop re-selecting the route that just reported it.
    if is_provider_model_unavailable(error):
        return True
    if is_terminal_task_error(error):
        return False
    return (
        error_status(error) in _PERMANENT_PROVIDER_ROUTE_STATUSES
        or is_auth_failure(error)
    )


def _provider_route_disabled(provider: str | None) -> bool:
    state = active_agent_run_state()
    return state is not None and state.provider_route_disabled(provider)


def _provider_route_sticky(provider: str | None) -> bool:
    state = active_agent_run_state()
    return state is not None and state.provider_route_sticky(provider)


def _trip_provider_circuit(provider: str | None, error: BaseException) -> None:
    if not provider or not provider_circuit_breaker_failure(error):
        return
    state = active_agent_run_state()
    if state is None or state.provider_route_disabled(provider):
        return
    state.disable_provider_route(provider)
    logger.warning(
        "MODEL_PROVIDER_CIRCUIT_OPENED",
        provider=provider,
        status_code=error_status(error),
        error_type=type(error).__name__,
        error_message=str(error)[:300],
        run_id=state.run_id,
    )
    # Circuit state is technical provider-routing telemetry. The customer-visible
    # fallback attempt below already carries the meaningful activity and technical
    # provider details, so do not emit a second bespoke stream event.


def _stick_to_fallback(failed: list[str | None]) -> None:
    """Keep routes that failed transiently disabled for the rest of the active run.

    A credential cooldown expiring mid-run must not send later turns back through a
    pool that just exhausted. The state lives on the run-scoped run state, so a
    new run reconsiders every configured route; there is no process-wide blacklist.
    """
    state = active_agent_run_state()
    if state is None:
        return
    for provider in failed:
        if provider and not state.provider_route_disabled(provider):
            state.disable_provider_route(provider, sticky=True)
            logger.warning(
                "MODEL_PROVIDER_STICKY_FALLBACK",
                provider=provider,
                run_id=state.run_id,
            )


def fallback_model(config: ResolvedModelConfig):
    """Build one configured fallback route using only that provider's credentials."""
    return build_model(config)


class ProviderFallbackMiddleware(AgentMiddleware):
    """Move to the next configured provider after the current provider pool fails.

    Same-provider key rotation remains the responsibility of TokenFallbackMiddleware,
    which must be nested inside this middleware in the governance chain. Permanent
    route failures are remembered only inside the active agent run state.
    """

    @staticmethod
    def _routes(request) -> tuple[str, tuple[ResolvedModelConfig, ...]]:
        """Return the current route key and the usable ordered fallback routes."""
        current, config = _request_route(request.model)
        chain = tuple(
            item
            for item in _fallback_chain(config)
            if _config_key(item) != current and not _provider_route_disabled(_config_key(item))
        )
        _require_credentials(chain)
        return current, chain

    @staticmethod
    def _log_rate_limit_wait(routes: list[str], delay: float) -> None:
        logger.warning("MODEL_PROVIDER_RATE_LIMIT_WAIT", providers=routes, wait_seconds=delay)

    @staticmethod
    def _log_attempt(*, current_provider: str | None, provider: str, index: int) -> None:
        logger.warning(
            "MODEL_PROVIDER_FALLBACK_ATTEMPT",
            current_provider=current_provider or "unknown",
            fallback_provider=provider,
            fallback_index=index,
        )

    @staticmethod
    def _log_circuit_skip(provider: str) -> None:
        logger.info("MODEL_PROVIDER_CIRCUIT_SKIP", provider=provider)
        # Routing transitions stay in infrastructure logs, never in the assessment stream.

    def wrap_model_call(self, request, handler):
        from middleware.usage_metering import provider_attempt_context

        current_provider, routes = self._routes(request)
        first_error: BaseException | None = None
        errors: list[BaseException] = []
        failed: list[str | None] = []
        # Routes whose last failure was a plain 429 (None is the request's own model).
        limited: list[ResolvedModelConfig | None] = []

        if not _provider_route_disabled(current_provider):
            try:
                with provider_attempt_context(route_ordinal=0):
                    with further_provider_route(bool(routes)):
                        return handler(request)
            except Exception as error:
                if not provider_fallback_failure(error):
                    raise
                _trip_provider_circuit(current_provider, error)
                first_error = error
                errors.append(error)
                failed.append(current_provider)
                if _is_rate_limited_chain(error):
                    limited.append(None)
        elif current_provider:
            self._log_circuit_skip(current_provider)

        for index, config in enumerate(routes, start=1):
            provider = _config_key(config)
            self._log_attempt(
                current_provider=current_provider,
                provider=provider,
                index=index,
            )
            try:
                with provider_attempt_context(route_ordinal=index):
                    with further_provider_route(index < len(routes)):
                        response = handler(request.override(model=fallback_model(config)))
            except Exception as error:
                if not provider_fallback_failure(error):
                    raise
                _trip_provider_circuit(provider, error)
                first_error = first_error or error
                errors.append(error)
                failed.append(provider)
                if _is_rate_limited_chain(error):
                    limited.append(config)
                continue
            _stick_to_fallback(failed)
            return response

        for delay in _RATE_LIMIT_BACKOFF_SECONDS:
            if not limited:
                break
            self._log_rate_limit_wait(
                [_config_key(config) if config else current_provider or "unknown" for config in limited],
                delay,
            )
            _sleep(delay)
            for config in list(limited):
                try:
                    route_ordinal = next(
                        (i for i, route in enumerate(routes, start=1)
                         if config is not None and _config_key(route) == _config_key(config)),
                        0 if config is None else None,
                    )
                    with provider_attempt_context(route_ordinal=route_ordinal):
                        with further_provider_route(False):
                            response = handler(
                                request if config is None else request.override(model=fallback_model(config))
                            )
                except Exception as error:
                    if not provider_fallback_failure(error):
                        raise
                    errors.append(error)
                    if not _is_rate_limited_chain(error):
                        limited.remove(config)
                    continue
                if config is not None:
                    # The route that just recovered must stay available for later turns.
                    _stick_to_fallback([item for item in failed if item != _config_key(config)])
                return response

        exhausted = _exhaustion_error(errors)
        if exhausted is first_error:
            raise exhausted
        raise exhausted from first_error

    async def awrap_model_call(self, request, handler):
        from middleware.usage_metering import provider_attempt_context

        current_provider, routes = self._routes(request)
        first_error: BaseException | None = None
        errors: list[BaseException] = []
        failed: list[str | None] = []
        # Routes whose last failure was a plain 429 (None is the request's own model).
        limited: list[ResolvedModelConfig | None] = []

        if not _provider_route_disabled(current_provider):
            try:
                with provider_attempt_context(route_ordinal=0):
                    with further_provider_route(bool(routes)):
                        return await handler(request)
            except Exception as error:
                if not provider_fallback_failure(error):
                    raise
                _trip_provider_circuit(current_provider, error)
                first_error = error
                errors.append(error)
                failed.append(current_provider)
                if _is_rate_limited_chain(error):
                    limited.append(None)
        elif current_provider:
            self._log_circuit_skip(current_provider)

        for index, config in enumerate(routes, start=1):
            provider = _config_key(config)
            self._log_attempt(
                current_provider=current_provider,
                provider=provider,
                index=index,
            )
            try:
                with provider_attempt_context(route_ordinal=index):
                    with further_provider_route(index < len(routes)):
                        response = await handler(request.override(model=fallback_model(config)))
            except Exception as error:
                if not provider_fallback_failure(error):
                    raise
                _trip_provider_circuit(provider, error)
                first_error = first_error or error
                errors.append(error)
                failed.append(provider)
                if _is_rate_limited_chain(error):
                    limited.append(config)
                continue
            _stick_to_fallback(failed)
            return response

        for delay in _RATE_LIMIT_BACKOFF_SECONDS:
            if not limited:
                break
            self._log_rate_limit_wait(
                [_config_key(config) if config else current_provider or "unknown" for config in limited],
                delay,
            )
            await _asleep(delay)
            for config in list(limited):
                try:
                    route_ordinal = next(
                        (i for i, route in enumerate(routes, start=1)
                         if config is not None and _config_key(route) == _config_key(config)),
                        0 if config is None else None,
                    )
                    with provider_attempt_context(route_ordinal=route_ordinal):
                        with further_provider_route(False):
                            response = await handler(
                                request if config is None else request.override(model=fallback_model(config))
                            )
                except Exception as error:
                    if not provider_fallback_failure(error):
                        raise
                    errors.append(error)
                    if not _is_rate_limited_chain(error):
                        limited.remove(config)
                    continue
                if config is not None:
                    # The route that just recovered must stay available for later turns.
                    _stick_to_fallback([item for item in failed if item != _config_key(config)])
                return response

        exhausted = _exhaustion_error(errors)
        if exhausted is first_error:
            raise exhausted
        raise exhausted from first_error


__all__ = [
    "ProviderFallbackMiddleware",
    "fallback_model",
    "provider_circuit_breaker_failure",
    "provider_fallback_failure",
    "route_key",
]
