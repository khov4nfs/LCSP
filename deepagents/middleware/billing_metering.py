"""Single governed model boundary for prepaid usage metering.

This module intentionally persists numeric provider usage only. Prompt content,
model messages and hidden reasoning are never included in the billing payload.
"""

from __future__ import annotations

from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Iterator
from uuid import uuid4

from langchain.agents.middleware import AgentMiddleware

from middleware.billing_recovery import (
    enqueue_release,
    enqueue_usage_and_release,
)
from middleware.token_fallback import model_provider
from tools.common.capabilities.platform.api_client import (
    WorkerApiClient,
    WorkerCallbackError,
)
from tools.common.capabilities.platform.callback_schemas import SettledUsagePayload


class BillingUsageUnavailable(RuntimeError):
    """Provider returned no complete numeric usage metadata."""


class BillingReservationUnavailable(RuntimeError):
    """The broker replay found a reservation that is no longer spendable."""


class BillingMeteringError(WorkerCallbackError):
    """Usage delivery failed after a provider response was received."""

    def __init__(self, cause: BaseException) -> None:
        status_code = getattr(cause, "status_code", None)
        super().__init__("Billing usage delivery failed", status_code=status_code)
        # A provider response has already been received. Retrying the model
        # would create a second billable invocation; delivery recovery must
        # use the same invocation/response identity instead.
        self.callback_client_error = True


class BillingFinalizationError(WorkerCallbackError):
    """Reservation finalization failed after model work completed."""

    def __init__(self, cause: BaseException) -> None:
        super().__init__("Billing reservation finalization failed")
        self.callback_client_error = True
        self.__cause__ = cause


_active_agent_role: ContextVar[str | None] = ContextVar(
    "active_billing_agent_role", default=None
)


@dataclass
class BillingMeteringSession:
    """Durable identity and API port for one reserved run/invocation group."""

    api_client: WorkerApiClient
    assessment_id: str
    run_id: str
    reservation_id: str
    agent_role: str
    effective_runtime_model: dict[str, str] = field(default_factory=dict)
    recovery_store_path: str | None = None
    max_input_tokens: int | None = None
    max_input_bytes: int | None = None
    max_output_tokens: int | None = None
    max_reasoning_tokens: int | None = None
    max_invocations: int | None = None
    reserved_provider: str = ""
    reserved_model: str = ""
    authorized_models: set[tuple[str, str]] = field(default_factory=set)
    _provider_invocation_count: int = field(default=0, init=False)
    _invocation_ids: set[str] = field(default_factory=set, init=False)

    @classmethod
    def reserve(
        cls,
        *,
        api_client: WorkerApiClient,
        assessment_id: str,
        run_id: str,
        agent_role: str,
        amount_credits: str,
        max_charge_credits: str,
        provider: str,
        model: str,
        max_input_tokens: str,
        max_input_bytes: str,
        max_output_tokens: str,
        max_reasoning_tokens: str,
        max_invocations: str,
        authorized_models: list[dict[str, str]],
        idempotency_key: str,
        effective_runtime_model: dict[str, str] | None = None,
        recovery_store_path: str | None = None,
    ) -> "BillingMeteringSession":
        from tools.common.capabilities.platform.callback_schemas import (
            BillingReservationPayload,
        )

        result = api_client.reserve_billing_credits(
            BillingReservationPayload(
                assessmentId=assessment_id,
                runId=run_id,
                amountCredits=amount_credits,
                maxChargeCredits=max_charge_credits,
                provider=provider,
                model=model,
                maxInputTokens=max_input_tokens,
                maxInputBytes=max_input_bytes,
                maxOutputTokens=max_output_tokens,
                maxReasoningTokens=max_reasoning_tokens,
                maxInvocations=max_invocations,
                authorizedModels=authorized_models,
                idempotencyKey=idempotency_key,
            )
        )
        reservation_id = result.get("id") or result.get("reservationId")
        if not isinstance(reservation_id, str) or not reservation_id:
            raise RuntimeError("Billing reservation response did not include an id")
        status = result.get("status")
        if status is not None and status != "RESERVED":
            raise BillingReservationUnavailable(
                f"Billing reservation is not spendable: {status}"
            )
        return cls(
            api_client=api_client,
            assessment_id=assessment_id,
            run_id=run_id,
            reservation_id=reservation_id,
            agent_role=agent_role,
            effective_runtime_model=dict(effective_runtime_model or {}),
            recovery_store_path=recovery_store_path,
            max_input_tokens=_parse_limit(max_input_tokens),
            max_input_bytes=_parse_limit(max_input_bytes),
            max_output_tokens=_parse_limit(max_output_tokens),
            max_reasoning_tokens=_parse_limit(max_reasoning_tokens),
            max_invocations=_parse_limit(max_invocations),
            reserved_provider=provider.upper(),
            reserved_model=model,
            authorized_models={
                (str(item["provider"]).upper(), str(item["model"]))
                for item in authorized_models
            },
        )

    def release(self) -> None:
        from tools.common.capabilities.platform.callback_schemas import (
            BillingReservationReleasePayload,
        )

        payload = BillingReservationReleasePayload(
            assessmentId=self.assessment_id
        )
        try:
            self.api_client.release_billing_reservation(
                self.reservation_id, payload
            )
        except Exception:
            if self.recovery_store_path:
                enqueue_release(self.recovery_store_path, self.reservation_id, payload)
            raise

    def new_invocation_id(self) -> str:
        invocation_id = str(uuid4())
        self._invocation_ids.add(invocation_id)
        return invocation_id

    def assert_invocation_capacity(self, invocation_id: str) -> None:
        if (
            self.max_invocations is not None
            and self._provider_invocation_count >= self.max_invocations
        ):
            raise BillingReservationUnavailable(
                "Provider invocation group capacity is exhausted"
            )
        if self.max_invocations is not None:
            from tools.common.capabilities.platform.callback_schemas import (
                BillingReservationClaimPayload,
            )

            self.api_client.claim_billing_invocation(
                self.reservation_id,
                BillingReservationClaimPayload(
                    assessmentId=self.assessment_id,
                    invocationId=invocation_id,
                ),
            )
        self._provider_invocation_count += 1

    def assert_model_identity(self, model: Any, response: Any | None = None) -> None:
        if not self.authorized_models and not (
            self.reserved_provider or self.reserved_model
        ):
            return
        provider, model_name = provider_identity(model, response)
        envelope = self.authorized_models or {
            (self.reserved_provider, self.reserved_model)
        }
        if (provider, model_name) not in envelope:
            raise BillingReservationUnavailable(
                "Provider/model differs from the reserved pricing envelope"
            )

    def assert_input_within_limit(self, request: Any) -> None:
        if self.max_input_bytes is None and self.max_input_tokens is None:
            return
        request_input = {
            "messages": getattr(request, "messages", None),
            "tools": getattr(request, "tools", None),
            "system": getattr(request, "system_prompt", None),
        }
        if all(value is None for value in request_input.values()):
            return
        # A UTF-8 byte can produce at most one tokenizer byte-fallback token.
        # Therefore bytes <= maxInputTokens is a conservative, provider-neutral
        # token bound; the configured byte ceiling may be stricter still.
        encoded = str(request_input).encode("utf-8")
        byte_ceiling = self.max_input_bytes
        if self.max_input_tokens is not None:
            byte_ceiling = (
                self.max_input_tokens
                if byte_ceiling is None
                else min(byte_ceiling, self.max_input_tokens)
            )
        if byte_ceiling is not None and len(encoded) > byte_ceiling:
            raise BillingUsageUnavailable(
                "Input exceeds the reserved token/byte ceiling"
            )

    def bounded_model(self, model: Any) -> Any:
        output_limit = (self.max_output_tokens or 0) + (
            self.max_reasoning_tokens or 0
        )
        if not output_limit or not hasattr(model, "bind"):
            return model
        provider, _ = provider_identity(model, None)
        parameter = "max_output_tokens" if provider in {"OPENAI", "GOOGLE_GENAI"} else "max_tokens"
        return model.bind(**{parameter: output_limit})

    def record(
        self,
        response: Any,
        model: Any,
        invocation_id: str,
        *,
        agent_role: str | None = None,
    ) -> None:
        usage = extract_provider_usage(response, model)
        if usage is None:
            usage = {}
            response_id = _response_identity(response)
            if response_id:
                usage["providerResponseId"] = response_id
        provider, model_name = provider_identity(model, response)
        payload = SettledUsagePayload(
            assessmentId=self.assessment_id,
            runId=self.run_id,
            reservationId=self.reservation_id,
            invocationId=invocation_id,
            agentRole=agent_role or self.agent_role,
            providerResponseId=usage.pop("providerResponseId", None),
            provider=provider,
            model=model_name,
            effectiveRuntimeModel=(
                {
                    **self.effective_runtime_model,
                    "provider": provider,
                    "model": model_name,
                }
                if self.effective_runtime_model
                else None
            ),
            occurredAt=datetime.now(timezone.utc).isoformat(),
            **usage,
        )
        try:
            self.api_client.post_settled_usage(payload)
        except BillingMeteringError:
            raise
        except Exception as error:
            if self.recovery_store_path:
                from tools.common.capabilities.platform.callback_schemas import (
                    BillingReservationReleasePayload,
                )

                try:
                    enqueue_usage_and_release(
                        self.recovery_store_path,
                        payload,
                        BillingReservationReleasePayload(
                            assessmentId=self.assessment_id
                        ),
                    )
                except Exception as recovery_error:
                    # The provider already succeeded. A recovery-store failure
                    # is still terminal: replaying the model would double-spend.
                    raise BillingMeteringError(recovery_error) from error
            raise BillingMeteringError(error) from error


_active_session: ContextVar[BillingMeteringSession | None] = ContextVar(
    "active_billing_metering_session", default=None
)


@contextmanager
def activate_billing_metering(
    session: BillingMeteringSession | None,
) -> Iterator[BillingMeteringSession | None]:
    token = _active_session.set(session)
    try:
        yield session
    finally:
        _active_session.reset(token)


def active_billing_metering() -> BillingMeteringSession | None:
    return _active_session.get()


@contextmanager
def activate_billing_agent_role(agent_role: str) -> Iterator[str]:
    token = _active_agent_role.set(agent_role)
    try:
        yield agent_role
    finally:
        _active_agent_role.reset(token)


def active_billing_agent_role() -> str | None:
    return _active_agent_role.get()


class BillingAgentRoleMiddleware(AgentMiddleware):
    """Attach the canonical policy role to every model call of one agent."""

    def __init__(self, agent_role: str):
        self.agent_role = agent_role

    def wrap_model_call(self, request, handler):
        with activate_billing_agent_role(self.agent_role):
            return handler(request)

    async def awrap_model_call(self, request, handler):
        with activate_billing_agent_role(self.agent_role):
            return await handler(request)


class BillingMeteringMiddleware(AgentMiddleware):
    """Meter each actual downstream provider response exactly once."""

    def wrap_model_call(self, request, handler):
        session = active_billing_metering()
        if session is None:
            return handler(request)
        session.assert_input_within_limit(request)
        invocation_id = session.new_invocation_id()
        # Keep the authorized candidate for settlement. Applying bind() below
        # returns a RunnableBinding that no longer exposes provider identity.
        billing_model = request.model
        session.assert_model_identity(billing_model)
        session.assert_invocation_capacity(invocation_id)
        if hasattr(request, "override"):
            request = request.override(model=session.bounded_model(billing_model))
        response = handler(request)
        session.record(
            response,
            billing_model,
            invocation_id,
            agent_role=active_billing_agent_role(),
        )
        return response

    async def awrap_model_call(self, request, handler):
        session = active_billing_metering()
        if session is None:
            return await handler(request)
        session.assert_input_within_limit(request)
        invocation_id = session.new_invocation_id()
        billing_model = request.model
        session.assert_model_identity(billing_model)
        session.assert_invocation_capacity(invocation_id)
        if hasattr(request, "override"):
            request = request.override(model=session.bounded_model(billing_model))
        response = await handler(request)
        session.record(
            response,
            billing_model,
            invocation_id,
            agent_role=active_billing_agent_role(),
        )
        return response


def provider_identity(model: Any, response: Any | None = None) -> tuple[str, str]:
    provider = model_provider(model) or getattr(model, "provider", None)
    provider = provider or getattr(model, "_llm_type", None) or "UNKNOWN"
    response_metadata = getattr(response, "response_metadata", None)
    if isinstance(response_metadata, dict):
        provider = provider if provider != "UNKNOWN" else response_metadata.get("provider", provider)
    model_name = (
        getattr(model, "model_name", None)
        or getattr(model, "model", None)
        or getattr(model, "model_id", None)
        or (response_metadata.get("model") if isinstance(response_metadata, dict) else None)
        or (response_metadata.get("model_name") if isinstance(response_metadata, dict) else None)
        or "UNKNOWN"
    )
    return str(provider).upper(), str(model_name)


def extract_provider_usage(response: Any, model: Any) -> dict[str, Any] | None:
    """Normalize LangChain/provider numeric usage without inferring missing fields."""
    metadata = _usage_metadata(response)
    if not isinstance(metadata, dict):
        return None

    input_tokens = _number(
        metadata,
        "input_tokens",
        "prompt_tokens",
        "promptTokenCount",
        "inputTokenCount",
    )
    output_tokens = _number(
        metadata,
        "output_tokens",
        "completion_tokens",
        "candidates_tokens",
        "candidatesTokenCount",
        "outputTokenCount",
    )
    if input_tokens is None or output_tokens is None:
        return None

    result: dict[str, Any] = {"outputTokens": str(output_tokens)}
    nested_input = metadata.get("input_token_details")
    nested_output = metadata.get("output_token_details")
    if isinstance(nested_input, dict):
        metadata = {**metadata, **nested_input}
    if isinstance(nested_output, dict):
        metadata = {**metadata, **nested_output}
    optional = (
        (
            "cachedInputTokens",
            "cached_input_tokens",
            "cache_read_input_tokens",
            "cache_read",
            "cached_tokens",
            "cache_read_tokens",
            "cached_content_token_count",
            "cachedContentTokenCount",
        ),
        (
            "cacheWriteTokens",
            "cache_creation_input_tokens",
            "cache_write_input_tokens",
            "cache_creation",
            "cache_creation_tokens",
            "cache_write_tokens",
            "cacheWriteTokenCount",
        ),
        (
            "reasoningTokens",
            "reasoning_tokens",
            "reasoning",
            "thoughts_token_count",
            "reasoningTokenCount",
        ),
        ("totalTokens", "total_tokens", "total_token_count", "totalTokenCount"),
    )
    for target, *keys in optional:
        value = _number(metadata, *keys)
        if value is not None:
            result[target] = str(value)
    cached_input = int(result.get("cachedInputTokens", "0"))
    cache_write = int(result.get("cacheWriteTokens", "0"))
    provider, _ = provider_identity(model, response)
    # OpenAI prompt_tokens is a total that includes cached and cache-write
    # slices. Convert it to the disjoint canonical uncached bucket. Other
    # providers already expose input_tokens as the uncached dimension.
    if provider in {"OPENAI", "GOOGLE_GENAI"}:
        if cached_input + cache_write > input_tokens:
            return None
        input_tokens = max(input_tokens - cached_input - cache_write, 0)
    result["inputTokens"] = str(input_tokens)
    response_id = _response_identity(response)
    if response_id:
        result["providerResponseId"] = response_id
    return result


def _usage_metadata(response: Any) -> dict[str, Any] | None:
    candidates = [getattr(response, "usage_metadata", None)]
    response_metadata = getattr(response, "response_metadata", None)
    if isinstance(response_metadata, dict):
        candidates.extend(
            [
                response_metadata.get("token_usage"),
                response_metadata.get("usage"),
                response_metadata,
            ]
        )
    result = getattr(response, "result", None)
    if isinstance(result, (list, tuple)):
        candidates.extend(getattr(item, "usage_metadata", None) for item in result)
        candidates.extend(getattr(item, "response_metadata", None) for item in result)
    for candidate in candidates:
        if isinstance(candidate, dict):
            return candidate
    return None


def _response_identity(response: Any) -> str | None:
    for source in (response, *(getattr(response, "result", None) or ())):
        metadata = getattr(source, "response_metadata", None)
        if isinstance(metadata, dict):
            for key in ("id", "response_id", "responseId", "request_id"):
                value = metadata.get(key)
                if value:
                    return str(value)
        value = getattr(source, "id", None)
        if value:
            return str(value)
    return None


def _number(value: dict[str, Any], *keys: str) -> int | None:
    for key in keys:
        candidate = value.get(key)
        if isinstance(candidate, bool):
            return None
        if isinstance(candidate, int) and candidate >= 0:
            return candidate
        if isinstance(candidate, str) and candidate.isdigit():
            return int(candidate)
    return None


def _parse_limit(value: str | None) -> int | None:
    if value is None or not value.strip():
        return None
    if not value.isdigit():
        raise ValueError("billing token limits must be non-negative integers")
    return int(value)


__all__ = [
    "BillingMeteringMiddleware",
    "BillingAgentRoleMiddleware",
    "BillingMeteringSession",
    "BillingMeteringError",
    "BillingUsageUnavailable",
    "BillingReservationUnavailable",
    "BillingFinalizationError",
    "activate_billing_metering",
    "active_billing_metering",
    "active_billing_agent_role",
    "activate_billing_agent_role",
    "extract_provider_usage",
]
