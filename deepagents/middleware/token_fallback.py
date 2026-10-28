"""Bounded credential fallback at the model-call boundary, never replaying tools."""
from __future__ import annotations

import asyncio
import time
from contextlib import contextmanager
from contextvars import ContextVar
from hashlib import sha256

from langchain.agents.middleware import AgentMiddleware
from langchain.agents.structured_output import StructuredOutputError
from pydantic import ValidationError
from anthropic import APIError as AnthropicAPIError
from openai import APIError as OpenAIAPIError
from langchain_google_genai.chat_models import GoogleAPIError
import httpx

from middleware.failure_policy import (
    TerminalCredentialError,
    TerminalSchemaError,
    error_status,
    is_auth_failure,
    is_paid_admission_error,
    is_provider_capacity_failure,
    is_provider_quota_exhaustion,
    is_terminal_task_error,
)
from model_policy import attach_model_route, model_route_config, route_for_model
from orchestration.agent_stream import model_wait_heartbeat, note_model_step
from provider_credentials import (
    INCEPTION_DEFAULT_BASE_URL,
    NO_SDK_RETRY_MAX_RETRIES,
    apx_base_url,
    inception_base_url,
    mirai_base_url,
    provider_token_source,
)
from tools.common.capabilities.platform.logging import get_logger

logger = get_logger(__name__)
_RATE_LIMITED_STATUSES = frozenset({429})
_RETRYABLE_TRANSIENT_STATUSES = frozenset({408, 409, 425, 429})
_DEFAULT_RATE_LIMIT_COOLDOWN_SECONDS = 30.0
_MAX_RATE_LIMIT_WAIT_SECONDS = 120.0
# Process-window credential health. Auth/depleted allowances are dead for this process;
# rate limits make a slot ineligible until its cooldown expires.
_DEAD_CREDENTIAL_SLOTS: dict[tuple[str, str], set[int]] = {}
_RATE_LIMITED_UNTIL: dict[tuple[str, str], dict[int, float]] = {}
# Slot health is tied to a safe fingerprinted pool snapshot, never just a slot number.
_CREDENTIAL_POOL_FINGERPRINTS: dict[tuple[str, str], tuple[str, ...]] = {}
_monotonic = time.monotonic
_sleep = time.sleep
_asleep = asyncio.sleep
_COOLDOWN_WAIT_TEXT = "model call waiting for credential cooldown"
# Set by ProviderFallbackMiddleware while another provider route remains after the
# current one. Waiting out a same-provider cooldown then only delays the run.
_FURTHER_PROVIDER_ROUTE: ContextVar[bool] = ContextVar(
    "lcsp_further_provider_route", default=False
)


@contextmanager
def further_provider_route(available: bool):
    """Declare whether a later provider route can take over this model call."""
    token = _FURTHER_PROVIDER_ROUTE.set(available)
    try:
        yield
    finally:
        _FURTHER_PROVIDER_ROUTE.reset(token)


def _credential_fingerprint(token: str) -> str:
    """Return a non-secret stable identifier for one configured credential slot."""
    return sha256(token.encode("utf-8")).hexdigest()[:12]


def _error_status(error: BaseException) -> int | None:
    return error_status(error)


_PROVIDER_API_ERRORS = (
    OpenAIAPIError,
    AnthropicAPIError,
    GoogleAPIError,
    httpx.HTTPError,
)


def _is_terminal_model_error(error: BaseException) -> bool:
    """Business purpose: Identify model-call errors that must stop credential-slot retry for the current request.

    Business rules:
    - The shared terminal-task classifier is authoritative for known task-level failures.
    - Type, validation, structured-output, and terminal-schema errors in the cause/context chain are also terminal.

    Execution flow:
    1. Return true if is_terminal_task_error classifies the original error as terminal.
    2. Otherwise walk its cause/context chain once for the additional terminal model error classes.
    3. Return false when no terminal signal is present.

    Failure cases:
    - Nonterminal errors remain subject to transient, capacity, and credential-rotation policy.

    Side effects:
    - Pure classification; it does not mark credential slots or invoke providers.
    """
    if is_terminal_task_error(error):
        return True
    seen: set[int] = set()
    current: BaseException | None = error
    while current is not None and id(current) not in seen:
        seen.add(id(current))
        if isinstance(current, (TypeError, ValidationError, StructuredOutputError, TerminalSchemaError)):
            return True
        current = current.__cause__ or current.__context__
    return False


def _is_retryable_transient_error(error: BaseException) -> bool:
    """Business purpose: Recognize temporary model-provider failures that may justify trying another credential slot.

    Business rules:
    - Terminal task errors are never transient for credential rotation.
    - Explicit retryable HTTP statuses and statuses at or above 500 are transient; without a status, timeout names, provider API errors, and local timeout/connection errors qualify.

    Execution flow:
    1. Reject terminal model errors.
    2. Check the provider status against the retryable set and server-error range.
    3. When status is absent, inspect the exception chain once for timeout or provider API errors.
    4. Fall back to local TimeoutError or ConnectionError classification.

    Failure cases:
    - A present status outside the retryable set returns false without overriding it from the exception type.
    - Unrecognized failures return false.

    Side effects:
    - Pure classification with no cooldown, logging, or provider invocation.
    """
    if _is_terminal_model_error(error):
        return False
    status = _error_status(error)
    if status in _RETRYABLE_TRANSIENT_STATUSES:
        return True
    if status is not None:
        return status >= 500
    seen: set[int] = set()
    current: BaseException | None = error
    while current is not None and id(current) not in seen:
        seen.add(id(current))
        name = type(current).__name__.lower()
        if "timeout" in name:
            return True
        if isinstance(current, _PROVIDER_API_ERRORS):
            return True
        current = current.__cause__ or current.__context__
    return isinstance(error, (TimeoutError, ConnectionError))


def _is_auth_failure(error: BaseException) -> bool:
    return is_auth_failure(error)


def _is_rate_limited(error: BaseException) -> bool:
    return not _is_terminal_model_error(error) and _error_status(error) in _RATE_LIMITED_STATUSES


_GOOGLE_RETRY_INFO_TYPE = "type.googleapis.com/google.rpc.RetryInfo"


def _google_retry_delay_seconds(error: BaseException) -> float | None:
    """Return Google's `google.rpc.RetryInfo.retryDelay` (e.g. "37s") from an error body.

    Gemini 429s carry the delay in the JSON error details, not a Retry-After header.
    """
    body = getattr(error, "details", None)
    payload = body.get("error") if isinstance(body, dict) else None
    details = payload.get("details") if isinstance(payload, dict) else None
    for item in details if isinstance(details, list) else ():
        if not isinstance(item, dict) or item.get("@type") != _GOOGLE_RETRY_INFO_TYPE:
            continue
        raw = item.get("retryDelay")
        if not isinstance(raw, str) or not raw.endswith("s"):
            return None
        try:
            value = float(raw[:-1])
        except ValueError:
            return None
        return value if value >= 0 else None
    return None


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
        google_delay = _google_retry_delay_seconds(current)
        if google_delay is not None:
            return google_delay
        current = current.__cause__ or current.__context__
    return None


def credential_failure(error: BaseException) -> bool:
    """Business purpose: Decide whether a failed credential slot may be bypassed for a model call.

    Business rules:
    - Paid-call admission failures cannot trigger rotation.
    - Provider-capacity and retryable transient failures may rotate; authentication failures are handled separately as dead credentials.

    Execution flow:
    1. Exclude paid-admission failures.
    2. Return true for provider-capacity failures or a retryable transient model error.

    Failure cases:
    - Terminal, authentication-only, and otherwise unclassified failures return false for this predicate.

    Side effects:
    - Pure classification; slot health changes are performed by the middleware caller.
    """
    return not is_paid_admission_error(error) and (is_provider_capacity_failure(error) or _is_retryable_transient_error(error))


def model_provider(model) -> str | None:
    """Business purpose: Resolve the provider identity used to select the model's configured credential pool.

    Business rules:
    - An explicit model route configuration takes precedence over package and URL inference.
    - For supported LangChain adapters, infer the gateway/provider from package module and configured base URL; unknown model types return None.

    Execution flow:
    1. Return the provider from explicit route configuration when present.
    2. Classify OpenAI-compatible adapters by Inception, APX, MiraiAPI, or default OpenAI base URL.
    3. Classify Google GenAI directly and Anthropic adapters by APX, MiraiAPI, or default Anthropic URL.
    4. Return None for unsupported adapter modules.

    Failure cases:
    - Missing or unrecognized model routing information returns None so credential middleware can pass the call through without rotation.

    Side effects:
    - Reads model route metadata and configured base URLs; it does not access credentials or make a provider call.
    """
    route = model_route_config(model)
    if route is not None:
        return route.provider
    module = type(model).__module__
    if module.startswith("langchain_openai."):
        base_url = str(getattr(model, "openai_api_base", "") or "").rstrip("/")
        configured_inception = inception_base_url()
        default_inception = INCEPTION_DEFAULT_BASE_URL.rstrip("/")
        if (
            base_url == configured_inception
            or base_url == default_inception
            or base_url.startswith(f"{default_inception}/")
        ):
            return "inception"
        if base_url == apx_base_url("openai"):
            return "apx"
        if base_url == mirai_base_url():
            return "miraiapi"
        return "openai"
    if module.startswith("langchain_google_genai."):
        return "google_genai"
    if module.startswith("langchain_anthropic."):
        base_url = str(
            getattr(model, "anthropic_api_url", None)
            or getattr(model, "base_url", "")
            or ""
        ).rstrip("/")
        if base_url == apx_base_url():
            return "apx"
        if base_url == mirai_base_url("anthropic"):
            return "miraiapi"
        return "anthropic"
    return None


def model_protocol(model) -> str | None:
    route = model_route_config(model)
    if route is not None:
        return route.protocol
    module = type(model).__module__
    if module.startswith("langchain_openai."):
        return "openai"
    if module.startswith("langchain_google_genai."):
        return "google_genai"
    if module.startswith("langchain_anthropic."):
        return "anthropic"
    protocol = getattr(model, "protocol", None)
    if isinstance(protocol, str):
        return protocol
    provider = model_provider(model) or getattr(model, "provider", None)
    model_name = (
        getattr(model, "model_name", None)
        or getattr(model, "model", None)
        or getattr(model, "model_id", None)
    )
    route = route_for_model(str(provider).lower(), str(model_name)) if provider and model_name else None
    return route.protocol if route is not None else None


def model_with_token(model, provider: str, token: str):
    # Reconstruct SDK clients; model_copy would retain the previous key's clients.
    settings = model.model_dump(
        exclude={"openai_api_key", "google_api_key", "anthropic_api_key"}
    )
    settings["api_key"] = token
    # Fallback rotation owns retry policy. In particular, retrying a 401 with the same
    # dead Gemini key only adds latency and duplicate Unauthorized log lines.
    settings["max_retries"] = NO_SDK_RETRY_MAX_RETRIES[provider]
    # ``profile`` is excluded from model_dump; without it a rotated slot loses the
    # context window that context trimming and the billing guard rely on.
    profile = getattr(model, "profile", None)
    if profile is not None:
        settings["profile"] = profile
    replacement = type(model)(**settings)
    route = model_route_config(model)
    return attach_model_route(replacement, route) if route is not None else replacement


class TokenFallbackMiddleware(AgentMiddleware):
    """Try healthy configured credential slots, each at most once per model call.

    - 401/403 or depleted quota: the slot is dead for this process and skipped on later calls.
    - 429: the slot cools down (Retry-After when present, capped) and is skipped until
      it expires; it is never marked dead. When only cooling slots remain, the call
      waits once for the soonest one and retries it (see ``_next_step``), unless a
      later provider route can take the call (see ``further_provider_route``).
    - other transient failures (5xx, timeouts): move on to the next slot.
    - schema/request/billing failures: raised immediately, no rotation.
    """

    def wrap_model_call(self, request, handler):
        """Business purpose: Execute a synchronous model inference using an eligible credential slot and rotate within that provider's pool when policy permits.

        Business rules:
        - Calls without a known provider token source pass directly to the next handler.
        - A single credential is used once with a safe metering slot label; multiple credentials use the bounded fallback state machine.
        - APX pool identity is refreshed before multi-slot rotation, and this middleware does not replay tool execution.

        Execution flow:
        1. Resolve the provider from the model and obtain its configured credential source.
        2. Pass through when no source exists, or invoke once with slot context when only one token exists.
        3. For a multi-token pool, refresh APX pool identity when applicable and run the synchronous rotation flow.

        Failure cases:
        - Nonretryable errors propagate; exhausted retryable slots produce the fallback flow's terminal credential error.

        Side effects:
        - Invokes the downstream inference handler, may rotate credentials and update in-process slot health/cooldowns, and emits metering/fallback telemetry.
        """
        provider = model_provider(request.model)
        source = provider_token_source(provider) if provider else None
        if source is None:
            return handler(request)
        env_name, tokens = source
        if len(tokens) < 2:
            with self._attempt_context(0):
                return handler(request)
        if provider == "apx":
            self._refresh_pool_identity(provider, env_name, tokens)
        return self._run_with_fallback(
            request=request,
            handler=handler,
            provider=provider,
            env_name=env_name,
            tokens=tokens,
            asynchronous=False,
        )

    async def awrap_model_call(self, request, handler):
        """Business purpose: Execute an asynchronous model inference using an eligible credential slot and rotate within that provider's pool when policy permits.

        Business rules:
        - Calls without a known provider token source pass directly to the next handler.
        - A single credential is used once with a safe metering slot label; multiple credentials use the bounded asynchronous fallback state machine.
        - APX pool identity is refreshed before multi-slot rotation, and this middleware does not replay tool execution.

        Execution flow:
        1. Resolve the provider from the model and obtain its configured credential source.
        2. Await pass-through when no source exists, or await one call with slot context when only one token exists.
        3. For a multi-token pool, refresh APX pool identity when applicable and await the asynchronous rotation flow.

        Failure cases:
        - Nonretryable errors propagate; exhausted retryable slots produce the fallback flow's terminal credential error.

        Side effects:
        - Awaits the downstream inference handler, may rotate credentials and update in-process slot health/cooldowns, and emits metering/fallback telemetry.
        """
        provider = model_provider(request.model)
        source = provider_token_source(provider) if provider else None
        if source is None:
            return await handler(request)
        env_name, tokens = source
        if len(tokens) < 2:
            with self._attempt_context(0):
                return await handler(request)
        if provider == "apx":
            self._refresh_pool_identity(provider, env_name, tokens)
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

    @staticmethod
    def _attempt_context(index: int):
        """Business purpose: Associate one model inference with a safe credential-slot identifier in the shared usage-metering context.

        Business rules:
        - Use a one-based CREDENTIAL_SLOT identifier rather than exposing the credential value.
        - Delegate context lifetime and restoration to provider_attempt_context.

        Execution flow:
        1. Convert the zero-based slot index to a padded one-based safe identifier.
        2. Return the metering context manager for the caller to enter around the provider attempt.

        Failure cases:
        - Metering context setup errors propagate to the caller.

        Side effects:
        - Creates a context manager that temporarily changes provider-attempt metering context when entered.
        """
        from middleware.usage_metering import provider_attempt_context

        return provider_attempt_context(credential_slot_safe_id=f"CREDENTIAL_SLOT_{index + 1:02d}")

    def _dead_slots(self, provider: str, env_name: str) -> set[int]:
        return _DEAD_CREDENTIAL_SLOTS.setdefault((provider, env_name), set())

    def _rate_limited_slots(self, provider: str, env_name: str) -> dict[int, float]:
        return _RATE_LIMITED_UNTIL.setdefault((provider, env_name), {})

    def _refresh_pool_identity(
        self, provider: str, env_name: str, tokens: tuple[str, ...]
    ) -> None:
        key = (provider, env_name)
        fingerprint = tuple(_credential_fingerprint(token) for token in tokens)
        if _CREDENTIAL_POOL_FINGERPRINTS.get(key) != fingerprint:
            _DEAD_CREDENTIAL_SLOTS.pop(key, None)
            _RATE_LIMITED_UNTIL.pop(key, None)
            _CREDENTIAL_POOL_FINGERPRINTS[key] = fingerprint

    def _log_fallback_attempt(
        self,
        *,
        provider: str,
        env_name: str,
        index: int,
        fingerprint: str,
        reason: str,
    ) -> None:
        logger.warning(
            "MODEL_CREDENTIAL_FALLBACK_ATTEMPT",
            provider=provider,
            credential_source=env_name,
            credential_slot=index,
            credential_fingerprint=fingerprint,
            fallback_enabled=True,
            reason=reason,
        )
        note_model_step("credential_rotations")

    def _log_dead_slot(
        self,
        *,
        provider: str,
        env_name: str,
        index: int,
        fingerprint: str,
        status: int | None,
        reason: str,
    ) -> None:
        logger.warning(
            "MODEL_CREDENTIAL_FALLBACK_SLOT_DEAD",
            provider=provider,
            credential_source=env_name,
            credential_slot=index,
            credential_fingerprint=fingerprint,
            fallback_enabled=True,
            status_code=status,
            reason=reason,
        )

    def _log_skip_dead_slot(
        self,
        *,
        provider: str,
        env_name: str,
        index: int,
        fingerprint: str,
    ) -> None:
        logger.warning(
            "MODEL_CREDENTIAL_FALLBACK_SLOT_SKIPPED",
            provider=provider,
            credential_source=env_name,
            credential_slot=index,
            credential_fingerprint=fingerprint,
            fallback_enabled=True,
            reason="previous_credential_failure",
        )

    def _log_rate_limited_slot(
        self,
        *,
        provider: str,
        env_name: str,
        index: int,
        fingerprint: str,
        cooldown_seconds: float,
    ) -> None:
        logger.warning(
            "MODEL_CREDENTIAL_FALLBACK_SLOT_RATE_LIMITED",
            provider=provider,
            credential_source=env_name,
            credential_slot=index,
            credential_fingerprint=fingerprint,
            fallback_enabled=True,
            cooldown_seconds=cooldown_seconds,
        )

    def _log_wait_for_rate_limit(
        self,
        *,
        provider: str,
        env_name: str,
        index: int,
        fingerprint: str,
        wait_seconds: float,
    ) -> None:
        logger.warning(
            "MODEL_CREDENTIAL_FALLBACK_WAITING_FOR_RATE_LIMIT",
            provider=provider,
            credential_source=env_name,
            credential_slot=index,
            credential_fingerprint=fingerprint,
            fallback_enabled=True,
            wait_seconds=wait_seconds,
        )

    def _mark_dead(
        self,
        *,
        provider: str,
        env_name: str,
        index: int,
        token: str,
        error: BaseException,
    ) -> None:
        self._dead_slots(provider, env_name).add(index)
        self._rate_limited_slots(provider, env_name).pop(index, None)
        self._log_dead_slot(
            provider=provider,
            env_name=env_name,
            index=index,
            fingerprint=_credential_fingerprint(token),
            status=_error_status(error),
            reason=(
                "allowance_exhausted"
                if is_provider_quota_exhaustion(error)
                else "authentication_failure"
            ),
        )

    def _mark_rate_limited(
        self,
        *,
        provider: str,
        env_name: str,
        index: int,
        token: str,
        error: BaseException,
    ) -> None:
        """Business purpose: Hold a rate-limited credential slot until the provider's requested or default cooldown expires.

        Business rules:
        - Honor a valid Retry-After or provider retry delay; use the configured default when none can be parsed.
        - Record cooldown by provider, credential environment name, and slot index, while logging only a credential fingerprint.

        Execution flow:
        1. Derive the retry delay from the error chain or choose the default cooldown.
        2. Store the monotonic expiry for this slot.
        3. Emit the rate-limited-slot event with its safe fingerprint and cooldown duration.

        Failure cases:
        - Invalid or absent retry timing falls back to the default; logging and clock behavior follow their configured implementations.

        Side effects:
        - Mutates the in-process cooldown map and writes a rate-limit telemetry event; it does not persist or log the token itself.
        """
        retry_after = _retry_after_seconds(error)
        cooldown = retry_after if retry_after is not None else _DEFAULT_RATE_LIMIT_COOLDOWN_SECONDS
        self._rate_limited_slots(provider, env_name)[index] = _monotonic() + cooldown
        self._log_rate_limited_slot(
            provider=provider,
            env_name=env_name,
            index=index,
            fingerprint=_credential_fingerprint(token),
            cooldown_seconds=cooldown,
        )

    def _mark_healthy(self, *, provider: str, env_name: str, index: int) -> None:
        self._rate_limited_slots(provider, env_name).pop(index, None)

    def _attempt_order(
        self,
        *,
        provider: str,
        env_name: str,
        tokens: tuple[str, ...],
        attempted: set[int],
    ) -> list[int]:
        dead = self._dead_slots(provider, env_name)
        cooling = self._rate_limited_slots(provider, env_name)
        now = _monotonic()
        healthy: list[int] = []
        for index in range(len(tokens)):
            if index in attempted:
                continue
            if index in dead:
                # Log once per model call, on its first plan, not on every re-plan.
                if not attempted:
                    self._log_skip_dead_slot(
                        provider=provider,
                        env_name=env_name,
                        index=index,
                        fingerprint=_credential_fingerprint(tokens[index]),
                    )
                continue
            if cooling.get(index, 0.0) > now:
                continue
            else:
                cooling.pop(index, None)
                healthy.append(index)
        return healthy

    def _next_rate_limited_slot(
        self,
        *,
        provider: str,
        env_name: str,
        tokens: tuple[str, ...],
    ) -> tuple[int, float] | None:
        """Return the soonest-eligible cooling slot; ties break on the lower slot index."""
        dead = self._dead_slots(provider, env_name)
        cooling = self._rate_limited_slots(provider, env_name)
        now = _monotonic()
        candidates = [
            (until, index)
            for index, until in cooling.items()
            if index < len(tokens) and index not in dead and until > now
        ]
        if not candidates:
            return None
        until, index = min(candidates)
        return index, until - now

    def _next_step(
        self,
        *,
        provider: str,
        env_name: str,
        tokens: tuple[str, ...],
        attempted: set[int],
        transient_retry_index: int | None,
        saw_auth_failure: bool,
        recovery_retry_used: bool,
    ) -> tuple[list[int], tuple[int, float] | None, bool]:
        """Business purpose: Plan the next credential attempts while bounding recovery work for a single model call.

        Business rules:
        - Try healthy unattempted slots first; permanently dead and cooling slots are unavailable until their state changes.
        - After initial slots, allow at most one recovery attempt: retry a transient slot only when every alternative is permanently dead, or wait for the soonest rate-limited slot.
        - Do not wait beyond the configured maximum or sleep while another provider route is available; retain cooldown state for later calls.

        Execution flow:
        1. Ask _attempt_order for eligible unattempted slots and return them when available.
        2. Stop when a recovery retry was already used.
        3. Consider one transient retry only when an authentication failure has made every alternative slot dead.
        4. Otherwise select the soonest cooling slot, reject excessive waits, defer to another provider route when available, or return the wait plan.

        Failure cases:
        - Return an empty plan when no eligible attempt or bounded wait remains; this is not itself an exception.

        Side effects:
        - May clear an expired cooldown or emit a warning when deferring to another provider; it does not invoke a model.
        """
        order = self._attempt_order(
            provider=provider,
            env_name=env_name,
            tokens=tokens,
            attempted=attempted,
        )
        if order:
            return order, None, False
        if recovery_retry_used:
            return [], None, False

        # A timeout/5xx does not make a credential unhealthy. If every alternative
        # credential has now proved permanently unusable (401/403), give the transient
        # slot one final bounded attempt before declaring the provider pool exhausted.
        # This is intentionally narrower than retrying arbitrary transient failures:
        # all-transient pools still fail fast and ModelRetry remains the outer policy.
        if transient_retry_index is not None and saw_auth_failure:
            dead = self._dead_slots(provider, env_name)
            cooling = self._rate_limited_slots(provider, env_name)
            now = _monotonic()
            alternatives = [
                index for index in range(len(tokens)) if index != transient_retry_index
            ]
            if (
                alternatives
                and all(index in dead for index in alternatives)
                and transient_retry_index not in dead
                and cooling.get(transient_retry_index, 0.0) <= now
            ):
                cooling.pop(transient_retry_index, None)
                return [transient_retry_index], None, True

        wait = self._next_rate_limited_slot(
            provider=provider,
            env_name=env_name,
            tokens=tokens,
        )
        # Preserve long provider delays; fail this call instead of retrying before its reset.
        if wait is not None and wait[1] > _MAX_RATE_LIMIT_WAIT_SECONDS:
            return [], None, False
        if wait is not None and _FURTHER_PROVIDER_ROUTE.get():
            # Hand the call to the next provider now instead of sleeping for the
            # soonest cooldown; the cooling slots stay recorded for later calls.
            logger.warning(
                "MODEL_CREDENTIAL_FALLBACK_DEFERRED_TO_PROVIDER_ROUTE",
                provider=provider,
                credential_env=env_name,
                wait_seconds=wait[1],
            )
            return [], None, False
        return [], wait, False

    def _end_cooldown_wait(self, *, provider: str, env_name: str, index: int, attempted: set[int]) -> None:
        # The awaited slot is eligible by construction; do not let clock rounding skip it.
        self._rate_limited_slots(provider, env_name).pop(index, None)
        attempted.discard(index)

    def _record_failure(
        self,
        *,
        provider: str,
        env_name: str,
        index: int,
        token: str,
        error: BaseException,
    ) -> bool:
        """Record slot health for a failed attempt; return whether rotation may continue."""
        # Billing gates, callback rejections and request/schema failures are not credential
        # faults. Billing errors may carry a provider-like status (402, or the callback's
        # 429/5xx); rotating on them would re-authorize or re-bill the same invocation.
        if is_terminal_task_error(error):
            return False
        if _is_auth_failure(error) or is_provider_quota_exhaustion(error):
            self._mark_dead(
                provider=provider,
                env_name=env_name,
                index=index,
                token=token,
                error=error,
            )
            return True
        if _is_rate_limited(error):
            self._mark_rate_limited(
                provider=provider,
                env_name=env_name,
                index=index,
                token=token,
                error=error,
            )
            return True
        return credential_failure(error)

    def _before_attempt(
        self,
        *,
        provider: str,
        env_name: str,
        tokens: tuple[str, ...],
        index: int,
        attempt_count: int,
        attempted: set[int],
    ) -> None:
        if attempt_count:
            self._log_fallback_attempt(
                provider=provider,
                env_name=env_name,
                index=index,
                fingerprint=_credential_fingerprint(tokens[index]),
                reason="previous_slot_failure",
            )
        attempted.add(index)

    def _run_with_fallback(self, *, request, handler, provider: str, env_name: str, tokens: tuple[str, ...], asynchronous: bool):
        if asynchronous:
            return self._arun_with_fallback(request, handler, provider, env_name, tokens)
        return self._srun_with_fallback(request, handler, provider, env_name, tokens)

    def _srun_with_fallback(self, request, handler, provider: str, env_name: str, tokens: tuple[str, ...]):
        """Business purpose: Run the synchronous credential-rotation state machine for one model inference.

        Business rules:
        - Follow _next_step's bounded slot order and one-recovery limit; preserve terminal task and nonretryable provider errors.
        - Continue after a failed slot only when _record_failure classifies rotation as safe.
        - Do not expose credential values in attempt context or fallback telemetry.

        Execution flow:
        1. Initialize per-call attempted-slot, transient-retry, authentication, and recovery state.
        2. Repeatedly request the next attempt plan; for a cooldown plan, report a wait heartbeat, sleep once, clear that cooldown, and re-plan.
        3. Invoke each planned slot under safe attempt context, recording eligible failures and slot health.
        4. Mark a successful slot healthy and return its response; if no plan remains, raise terminal credential exhaustion chained from the first failure.

        Failure cases:
        - Propagate any error _record_failure marks non-rotatable; raise TerminalCredentialError when all allowed slots and recovery attempts fail.

        Side effects:
        - Invokes provider inference, may sleep and emit heartbeat/log events, and updates in-process credential health and cooldown state.
        """
        first_error: BaseException | None = None
        attempted: set[int] = set()
        transient_retry_index: int | None = None
        saw_auth_failure = False
        recovery_retry_used = False
        attempt_count = 0
        while True:
            order, wait, transient_recovery = self._next_step(
                provider=provider,
                env_name=env_name,
                tokens=tokens,
                attempted=attempted,
                transient_retry_index=transient_retry_index,
                saw_auth_failure=saw_auth_failure,
                recovery_retry_used=recovery_retry_used,
            )
            if transient_recovery:
                recovery_retry_used = True
            if wait is not None:
                index, wait_seconds = wait
                recovery_retry_used = True
                self._log_wait_for_rate_limit(
                    provider=provider,
                    env_name=env_name,
                    index=index,
                    fingerprint=_credential_fingerprint(tokens[index]),
                    wait_seconds=wait_seconds,
                )
                with model_wait_heartbeat(_COOLDOWN_WAIT_TEXT):
                    _sleep(wait_seconds)
                self._end_cooldown_wait(provider=provider, env_name=env_name, index=index, attempted=attempted)
                continue
            if not order:
                break
            for index in order:
                self._before_attempt(
                    provider=provider,
                    env_name=env_name,
                    tokens=tokens,
                    index=index,
                    attempt_count=attempt_count,
                    attempted=attempted,
                )
                attempt_count += 1
                try:
                    with self._attempt_context(index):
                        response = handler(self._candidate_request(request, provider, tokens[index], index))
                except Exception as error:
                    if not self._record_failure(
                        provider=provider,
                        env_name=env_name,
                        index=index,
                        token=tokens[index],
                        error=error,
                    ):
                        raise
                    if _is_auth_failure(error):
                        saw_auth_failure = True
                    if (
                        transient_retry_index is None
                        and _is_retryable_transient_error(error)
                        and not _is_rate_limited(error)
                    ):
                        transient_retry_index = index
                    first_error = first_error or error
                    continue
                self._mark_healthy(provider=provider, env_name=env_name, index=index)
                return response
        raise TerminalCredentialError("All configured retryable provider credential slots failed; task stopped") from first_error

    async def _arun_with_fallback(self, request, handler, provider: str, env_name: str, tokens: tuple[str, ...]):
        """Business purpose: Run the asynchronous credential-rotation state machine for one model inference.

        Business rules:
        - Follow _next_step's bounded slot order and one-recovery limit; preserve terminal task and nonretryable provider errors.
        - Continue after a failed slot only when _record_failure classifies rotation as safe.
        - Do not expose credential values in attempt context or fallback telemetry.

        Execution flow:
        1. Initialize per-call attempted-slot, transient-retry, authentication, and recovery state.
        2. Repeatedly request the next attempt plan; for a cooldown plan, report a wait heartbeat, await one sleep, clear that cooldown, and re-plan.
        3. Await each planned slot under safe attempt context, recording eligible failures and slot health.
        4. Mark a successful slot healthy and return its response; if no plan remains, raise terminal credential exhaustion chained from the first failure.

        Failure cases:
        - Propagate any error _record_failure marks non-rotatable; raise TerminalCredentialError when all allowed slots and recovery attempts fail.

        Side effects:
        - Awaits provider inference, may await cooldowns and emit heartbeat/log events, and updates in-process credential health and cooldown state.
        """
        first_error: BaseException | None = None
        attempted: set[int] = set()
        transient_retry_index: int | None = None
        saw_auth_failure = False
        recovery_retry_used = False
        attempt_count = 0
        while True:
            order, wait, transient_recovery = self._next_step(
                provider=provider,
                env_name=env_name,
                tokens=tokens,
                attempted=attempted,
                transient_retry_index=transient_retry_index,
                saw_auth_failure=saw_auth_failure,
                recovery_retry_used=recovery_retry_used,
            )
            if transient_recovery:
                recovery_retry_used = True
            if wait is not None:
                index, wait_seconds = wait
                recovery_retry_used = True
                self._log_wait_for_rate_limit(
                    provider=provider,
                    env_name=env_name,
                    index=index,
                    fingerprint=_credential_fingerprint(tokens[index]),
                    wait_seconds=wait_seconds,
                )
                with model_wait_heartbeat(_COOLDOWN_WAIT_TEXT):
                    await _asleep(wait_seconds)
                self._end_cooldown_wait(provider=provider, env_name=env_name, index=index, attempted=attempted)
                continue
            if not order:
                break
            for index in order:
                self._before_attempt(
                    provider=provider,
                    env_name=env_name,
                    tokens=tokens,
                    index=index,
                    attempt_count=attempt_count,
                    attempted=attempted,
                )
                attempt_count += 1
                try:
                    with self._attempt_context(index):
                        response = await handler(self._candidate_request(request, provider, tokens[index], index))
                except Exception as error:
                    if not self._record_failure(
                        provider=provider,
                        env_name=env_name,
                        index=index,
                        token=tokens[index],
                        error=error,
                    ):
                        raise
                    if _is_auth_failure(error):
                        saw_auth_failure = True
                    if (
                        transient_retry_index is None
                        and _is_retryable_transient_error(error)
                        and not _is_rate_limited(error)
                    ):
                        transient_retry_index = index
                    first_error = first_error or error
                    continue
                self._mark_healthy(provider=provider, env_name=env_name, index=index)
                return response
        raise TerminalCredentialError("All configured retryable provider credential slots failed; task stopped") from first_error

__all__ = [
    "TokenFallbackMiddleware",
    "credential_failure",
    "further_provider_route",
    "model_protocol",
    "model_provider",
    "model_with_token",
]
