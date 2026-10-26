"""Ordered configured-route fallback outside same-provider credential rotation.

Routes come from the model routes YAML (``model_policy``); circuit and sticky state are
keyed by route identity ``provider:model``.
"""
from __future__ import annotations

import asyncio
import time

from langchain.agents.middleware import AgentMiddleware
from anthropic import APIError as AnthropicAPIError
from openai import APIError as OpenAIAPIError
from langchain_google_genai.chat_models import GoogleAPIError
import httpx

from middleware.failure_policy import (
    TerminalCredentialError,
    error_status,
    is_auth_failure,
    is_paid_admission_error,
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


_PROVIDER_API_ERRORS = (
    OpenAIAPIError,
    AnthropicAPIError,
    GoogleAPIError,
    httpx.HTTPError,
)


def _is_provider_api_error(error: BaseException) -> bool:
    """Business purpose: Recognize failures originating from a supported provider SDK or HTTP transport.

    Business rules:
    - Match the configured OpenAI, Anthropic, Google, and httpx error classes anywhere in the cause/context chain.
    - Do not classify unrelated application exceptions as provider API failures.

    Execution flow:
    1. Walk the exception chain once, guarding against cycles.
    2. Return true on a supported provider or transport error; otherwise return false.

    Failure cases:
    - Unrecognized exception types return false and remain available to other failure classifiers.

    Side effects:
    - Pure classification with no logging, retries, or state changes.
    """
    seen: set[int] = set()
    current: BaseException | None = error
    while current is not None and id(current) not in seen:
        seen.add(id(current))
        if isinstance(current, _PROVIDER_API_ERRORS):
            return True
        current = current.__cause__ or current.__context__
    return False


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
    """Business purpose: Decide whether a failed model call may move to another configured provider route.

    Business rules:
    - Paid-call admission denial never triggers another route.
    - Credential exhaustion, route incompatibility, model unavailability, refusal, and structured-output rejection can use another route.
    - Other terminal task errors cannot; authentication, capacity, retryable credential, and provider API errors can.

    Execution flow:
    1. Reject paid-admission failures before route decisions.
    2. Allow route-specific credential, compatibility, availability, refusal, and structured-output failures.
    3. Reject remaining terminal task errors.
    4. For other errors, allow fallback only when a recognized credential, capacity, or provider API classifier matches.

    Failure cases:
    - An unclassified error returns false so provider routing does not mask an application or payload defect.

    Side effects:
    - Pure classification; it does not invoke another provider or change circuit state.
    """
    if is_paid_admission_error(error):
        return False
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
        or _is_provider_api_error(error)
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
    """Business purpose: Preserve the most informative failure when all eligible provider routes have been exhausted.

    Business rules:
    - If every route failed structured-output validation, retain the first structured-output rejection.
    - If every route refused the sample, retain the first refusal so outer model retry can resample.
    - Mixed or other failures become a terminal credential-route exhaustion error.

    Execution flow:
    1. Check whether the error list is uniformly structured-output rejection.
    2. Otherwise check whether it is uniformly provider refusal.
    3. Return the first matching error or construct TerminalCredentialError for general exhaustion.

    Failure cases:
    - An empty error list produces the terminal exhaustion error because no specific route failure is available.

    Side effects:
    - Constructs or returns an exception object; it does not raise, log, or mutate routing state.
    """
    if errors and all(is_structured_output_rejection(error) for error in errors):
        return errors[0]
    # Every route declined the sample: surface the refusal itself so the model retry resamples,
    # instead of a terminal "exhausted" that no retry may follow.
    if errors and all(is_provider_refusal(error) for error in errors):
        return errors[0]
    return TerminalCredentialError("All configured LLM provider routes exhausted; task stopped")


def provider_circuit_breaker_failure(error: BaseException) -> bool:
    """Business purpose: Decide whether a provider route should remain disabled for the active agent run.

    Business rules:
    - Paid-admission and per-invocation structured-output failures do not open the route circuit.
    - Route incompatibility and model unavailability disable the route; terminal task errors do not.
    - Permanent provider-route statuses and authentication failures disable the route.

    Execution flow:
    1. Exclude admission and structured-output errors from circuit failure.
    2. Open the circuit for route incompatibility or an unavailable model.
    3. Exclude other terminal task errors.
    4. Classify remaining errors by permanent route status or authentication.

    Failure cases:
    - Errors without a route-level failure signal return false and leave circuit policy unchanged.

    Side effects:
    - Pure classification; the caller owns any run-state mutation and logging.
    """
    if is_paid_admission_error(error):
        return False
    # A model-generated invalid structured answer belongs to one invocation,
    # not to the provider route for every independent later source question.
    # It still triggers bounded cross-provider fallback for this invocation.
    if is_structured_output_rejection(error):
        return False
    if is_provider_route_incompatibility(error):
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
    """Business purpose: Keep transiently failed provider routes out of later turns in the current agent run.

    Business rules:
    - Only the supplied failed route identifiers are disabled, and already-disabled routes are left alone.
    - A credential cooldown expiring does not re-enable a route after its pool exhausted during this run.
    - Malformed output and refusal are request-local failures and must not be added to this sticky list.
    - Run-scoped state is not a process-wide blacklist; a new run may reconsider configured routes.

    Execution flow:
    1. Read the active agent-run state and return when no run state is available.
    2. For each nonempty route not already disabled, disable it as sticky and log the run-scoped fallback.

    Failure cases:
    - Without an active run state the helper is a no-op; it does not create routing state.

    Side effects:
    - Updates the active run's provider-route state and emits a warning for each newly sticky route.
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
        """Business purpose: Record the provider routes and delay while fallback waits between rate-limited attempts.

        Business rules:
        - The event reports the route identifiers and wait duration supplied by the fallback loop.
        - It does not change retry scheduling or provider state.

        Execution flow:
        1. Emit MODEL_PROVIDER_RATE_LIMIT_WAIT with the providers and wait_seconds fields.

        Failure cases:
        - Logger failures follow the configured logging behavior; the helper does not convert them into provider results.

        Side effects:
        - Writes one warning-level operational log entry.
        """
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
        """Business purpose: Execute a synchronous model request across configured provider routes when the current route fails for a recoverable provider-level reason.

        Business rules:
        - Preserve the original route first unless it is disabled; try configured fallback routes in order.
        - Do not reroute paid-admission or terminal task errors; route-level classifiers decide which failures qualify.
        - Retry only plain 429-limited routes during the configured backoff schedule, and keep route/circuit state scoped to the active run.

        Execution flow:
        1. Resolve the current route and eligible fallback chain, then expose route ordinals and remaining-route availability to nested middleware.
        2. Call the original route unless disabled, recording eligible failures and opening circuits as classified.
        3. Try each fallback model in order, returning on first success and marking transiently failed routes sticky.
        4. After immediate route attempts, wait through the configured backoff intervals for remaining plain rate limits and retry those routes.
        5. Preserve schema/refusal exhaustion errors or raise terminal route exhaustion with the first failure as its cause.

        Failure cases:
        - Propagate non-fallback errors immediately; route configuration can also fail before inference when required fallback credentials are absent.
        - If every eligible route fails, surface the specialized schema/refusal failure or TerminalCredentialError.

        Side effects:
        - Invokes one or more provider models, may sleep between rate-limited attempts, writes operational logs, and updates active-run circuit/sticky-route state.
        """
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
                if not is_structured_output_rejection(error) and not is_provider_refusal(error):
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
                if not is_structured_output_rejection(error) and not is_provider_refusal(error):
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
        """Business purpose: Execute an asynchronous model request across configured provider routes when the current route fails for a recoverable provider-level reason.

        Business rules:
        - Preserve the original route first unless it is disabled; try configured fallback routes in order.
        - Do not reroute paid-admission or terminal task errors; route-level classifiers decide which failures qualify.
        - Retry only plain 429-limited routes during the configured backoff schedule, and keep route/circuit state scoped to the active run.

        Execution flow:
        1. Resolve the current route and eligible fallback chain, then expose route ordinals and remaining-route availability to nested middleware.
        2. Await the original route unless disabled, recording eligible failures and opening circuits as classified.
        3. Await each fallback model in order, returning on first success and marking transiently failed routes sticky.
        4. After immediate route attempts, await configured backoff intervals for remaining plain rate limits and retry those routes.
        5. Preserve schema/refusal exhaustion errors or raise terminal route exhaustion with the first failure as its cause.

        Failure cases:
        - Propagate non-fallback errors immediately; route configuration can also fail before inference when required fallback credentials are absent.
        - If every eligible route fails, surface the specialized schema/refusal failure or TerminalCredentialError.

        Side effects:
        - Invokes one or more provider models, awaits rate-limit delays, writes operational logs, and updates active-run circuit/sticky-route state.
        """
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
                if not is_structured_output_rejection(error) and not is_provider_refusal(error):
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
                if not is_structured_output_rejection(error) and not is_provider_refusal(error):
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
