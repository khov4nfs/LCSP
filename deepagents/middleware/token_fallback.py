"""Bounded credential fallback at the model-call boundary, never replaying tools."""
from __future__ import annotations

import time
import asyncio
from contextlib import contextmanager
from contextvars import ContextVar
from hashlib import sha256

from langchain.agents.middleware import AgentMiddleware
from langchain.agents.structured_output import StructuredOutputError
from pydantic import ValidationError

from middleware.failure_policy import (
    TerminalCredentialError,
    TerminalSchemaError,
    is_auth_failure,
    is_provider_capacity_failure,
    is_terminal_task_error,
    error_status,
)
from orchestration.agent_stream import model_wait_heartbeat, note_model_step
from provider_credentials import (
    INCEPTION_DEFAULT_BASE_URL,
    LLM7_DEFAULT_BASE_URL,
    NO_SDK_RETRY_MAX_RETRIES,
    inception_base_url,
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
# rate limits make a slot ineligible until its cooldown expires.
_DEAD_CREDENTIAL_SLOTS: dict[tuple[str, str], set[int]] = {}
_RATE_LIMITED_UNTIL: dict[tuple[str, str], dict[int, float]] = {}
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
    seen: set[int] = set()
    current: BaseException | None = error
    while current is not None and id(current) not in seen:
        seen.add(id(current))
        name = type(current).__name__.lower()
        if "timeout" in name:
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
    """Return whether an error may move a model call to another credential slot.

    Authentication failures are handled separately: they mark the failing slot dead for
    this process instead of being treated as a transient failure of the same slot.
    """
    return is_provider_capacity_failure(error) or _is_retryable_transient_error(error)


def model_provider(model) -> str | None:
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
        configured_llm7 = llm7_base_url()
        default_llm7 = LLM7_DEFAULT_BASE_URL.rstrip("/")
        if base_url == configured_llm7 or base_url == default_llm7 or base_url.startswith(
            f"{default_llm7}/"
        ):
            return "llm7"
        return "openai"
    if module.startswith("langchain_google_genai."):
        return "google_genai"
    if module.startswith("langchain_anthropic."):
        return "anthropic"
    return None


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
    return type(model)(**settings)


class TokenFallbackMiddleware(AgentMiddleware):
    """Try healthy configured credential slots, each at most once per model call.

    - 401/403: the slot is dead for this process and is skipped on later calls.
    - 429: the slot cools down (Retry-After when present, capped) and is skipped until
      it expires; it is never marked dead. When only cooling slots remain, the call
      waits once for the soonest one and retries it (see ``_next_step``), unless a
      later provider route can take the call (see ``further_provider_route``).
    - other transient failures (5xx, timeouts): move on to the next slot.
    - schema/request/billing failures: raised immediately, no rotation.
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
    ) -> None:
        logger.warning(
            "MODEL_CREDENTIAL_FALLBACK_SLOT_DEAD",
            provider=provider,
            credential_source=env_name,
            credential_slot=index,
            credential_fingerprint=fingerprint,
            fallback_enabled=True,
            status_code=status,
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
            reason="previous_auth_failure",
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
        """Plan the next slots while keeping one bounded recovery retry per model call.

        Every slot is invoked at most once initially. Once no healthy untried slot
        remains, exactly one extra provider invocation may be used either to retry a
        transiently failed slot when every alternative slot is permanently dead, or to
        wait for and retry the soonest rate-limited slot. A model call therefore makes
        at most len(tokens) + 1 provider invocations.
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
        if _is_auth_failure(error):
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
    "further_provider_route",
    "credential_failure",
    "model_provider",
    "model_with_token",
]
