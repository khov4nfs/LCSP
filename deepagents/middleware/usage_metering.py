"""Single governed model boundary: identity, context guard, telemetry and token usage.

Runs for every agent model call, with or without an assessment. Token usage is
reported to the API as provider-reported numbers only. Prompt content, model messages and hidden reasoning are never part
of the usage payload.
"""

from __future__ import annotations

import asyncio
import json
import math
import os
import re
import time
from collections.abc import Iterator, Mapping
from contextlib import contextmanager
from contextvars import ContextVar, copy_context
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from threading import Event, Thread
from types import SimpleNamespace
from typing import Any
from uuid import uuid4

from langchain.agents.middleware import AgentMiddleware
from langchain.agents.middleware import ModelResponse
from langchain_core.exceptions import ModelError
from langchain_core.messages import BaseMessage, message_to_dict, messages_from_dict

from middleware.token_fallback import model_protocol, model_provider
from middleware.usage_recovery import enqueue_usage, record_usage_evidence, drain
from middleware.paid_admission import RunAdmission, prepare_admitted_request
from middleware.failure_policy import PaidAdmissionError
from model_policy import (
    ResolvedModelConfig,
    attach_model_route,
    config_snapshot,
    distinct_runtime_identities,
    model_route_config,
    resolve_role,
    route_for_model,
)
from orchestration.agent_stream import (
    active_agent_stream_cancel,
    active_model_step,
    active_model_step_summary,
    check_agent_execution_active,
    note_model_step,
    publish_agent_stream_event,
    remember_message_model_step,
)
from orchestration.runtime_control import cancellable_async, cancellable_sync, physical_to_thread
from provider_credentials import llm_provider_timeout_seconds
from tools.common.capabilities.platform.api_client import WorkerApiClient
from tools.common.capabilities.platform.callback_schemas import SettledUsagePayload
from tools.common.capabilities.platform.config import resolve_usage_recovery_store_path
from tools.common.capabilities.platform.logging import get_logger

_MODEL_CALL_HEARTBEAT_SECONDS = 10.0
# Why: Separate provider execution termination states from downstream output evaluation outcomes (ASM-USAGE-02..04).
# How: Freeze canonical SCREAMING_SNAKE_CASE state sets for cross-layer metering and telemetry contracts.
# Invariant: Provider completion status never implies schema or domain acceptance of the generated output.
PROVIDER_COMPLETION_STATES: frozenset[str] = frozenset(
    {"COMPLETED", "MAX_TOKENS", "TRUNCATED", "FAILED", "OUTCOME_UNKNOWN"}
)
OUTPUT_EVALUATION_STATES: frozenset[str] = frozenset(
    {"ACCEPTED", "SCHEMA_INVALID", "DOMAIN_REJECTED", "NOT_EVALUATED"}
)
logger = get_logger(__name__)


class ModelContextWindowExceeded(RuntimeError):
    """The active provider/model cannot accept the request after context reduction."""


class ModelIdentityMismatch(RuntimeError):
    """The model that answered is not one of the configured runtime routes."""

    status_code = 400
    error_code = "MODEL_IDENTITY_MISMATCH"


class InFlightAdmissionRecoveryError(RuntimeError):
    """Business purpose: Signal that an invocation admission is already IN_FLIGHT.

    Business rules:
    - Replay of an IN_FLIGHT admission is strictly for evidence recovery or reconciliation.
    - Zero provider bytes or provider calls may be dispatched.

    Execution flow:
    1. Worker identifies returned admission state as IN_FLIGHT.
    2. Halt execution before provider dispatch and attach admission metadata.

    Failure cases:
    - Handled as recovery control flow rather than unmediated error.

    Side effects:
    - Zero provider invocations made.
    """

    def __init__(self, admission: dict):
        super().__init__(
            f"Invocation {admission.get('invocationId')} is already IN_FLIGHT; bypassing provider dispatch for evidence recovery."
        )
        self.admission = admission


_active_agent_role: ContextVar[str | None] = ContextVar(
    "active_agent_role", default=None
)
_active_model_operation_type: ContextVar[str | None] = ContextVar(
    "active_model_operation_type", default=None
)
# One logical agent step. Retries, credential rotation and provider fallback of
# the same step share it, so the live stream shows one row per step instead of
# folding every model call of a run into a single ever-growing row.
_active_model_step_id = active_model_step
_active_provider_route_ordinal: ContextVar[int | None] = ContextVar(
    "active_provider_route_ordinal", default=None
)
_active_credential_slot_safe_id: ContextVar[str | None] = ContextVar(
    "active_credential_slot_safe_id", default=None
)


@contextmanager
def provider_attempt_context(
    *, route_ordinal: int | None = None, credential_slot_safe_id: str | None = None
) -> Iterator[None]:
    """Business purpose: Attach safe route and credential-slot lineage to one provider attempt.

    Business rules:
    - Only supplied route/slot values override the current context; restore enclosing values on every exit.
    Execution flow:
    1. Activate supplied attempt metadata.
    2. Yield the attempt scope and restore its context tokens when it ends.
    Failure cases:
    - Exceptions from the attempt propagate after context restoration; no credential value is recorded.
    Side effects:
    - Temporarily changes context-local routing metadata; no provider or journal operation.
    """
    route_token = _active_provider_route_ordinal.set(route_ordinal) if route_ordinal is not None else None
    slot_token = _active_credential_slot_safe_id.set(credential_slot_safe_id) if credential_slot_safe_id else None
    try:
        yield
    finally:
        if slot_token is not None:
            _active_credential_slot_safe_id.reset(slot_token)
        if route_token is not None:
            _active_provider_route_ordinal.reset(route_token)


def _active_logical_invocation_id() -> str | None:
    """Business purpose: Retrieve the logical invocation shared by retries and fallback within the current model step.

    Business rules:
    - Only a string invocation_id from the active step summary is a usable logical identity.
    Execution flow:
    1. Read the active step summary and return its logical invocation ID when valid.
    Failure cases:
    - Missing summary or non-string identity returns None rather than fabricating an invocation.
    Side effects:
    - Pure context read; no model call or usage record is created.
    """
    summary = active_model_step_summary.get()
    invocation_id = summary.get("invocation_id") if summary else None
    return invocation_id if isinstance(invocation_id, str) else None


def _active_metered_invocation_id() -> str | None:
    """Business purpose: Retrieve the physical settlement identity associated with the current model-step summary.

    Business rules:
    - Only a string settlement_invocation_id is accepted; it remains distinct from logical invocation identity.
    Execution flow:
    1. Read the active summary and return its settlement invocation ID when present.
    Failure cases:
    - Absent or invalid settlement identity returns None; no logical ID is substituted.
    Side effects:
    - Pure context read; no usage mutation.
    """
    summary = active_model_step_summary.get()
    invocation_id = summary.get("settlement_invocation_id") if summary else None
    return invocation_id if isinstance(invocation_id, str) else None


@dataclass
class AgentRunState:
    """Run-scoped identity, provider-route state and usage port for one agent run.

    Always exists for a boundary invocation. ``assessment_id``/``api_client`` are
    only set for assessment runs; without them usage is not reported.
    """

    run_id: str
    agent_role: str
    assessment_id: str | None = None
    preparation_run_id: str | None = None
    api_client: WorkerApiClient | None = None
    admission: RunAdmission | None = None
    bounded: bool = False
    # Why: A terminal ON settlement may empty the wallet on the final model call without another admission.
    # How: Carry the server-owned post-debit decision to Root's separate after_model checkpoint node.
    # Invariant: Fresh execution state resets this process-local flag; it never stands in for a billing receipt.
    payment_required_after_settlement: bool = field(default=False, init=False)
    _attempt_times: dict[str, str] = field(default_factory=dict, init=False)
    _disabled_provider_routes: set[str] = field(default_factory=set, init=False)
    _sticky_provider_routes: set[str] = field(default_factory=set, init=False)
    _attempt_ordinals: dict[str, int] = field(default_factory=dict, init=False)

    def disable_provider_route(self, provider: str, *, sticky: bool = False) -> None:
        """Skip a route for the rest of the run; ``sticky`` marks a transient failure."""
        key = provider.strip().lower()
        self._disabled_provider_routes.add(key)
        if sticky:
            self._sticky_provider_routes.add(key)

    def provider_route_sticky(self, provider: str | None) -> bool:
        return bool(provider and provider.strip().lower() in self._sticky_provider_routes)

    def provider_route_disabled(self, provider: str | None) -> bool:
        return bool(
            provider
            and provider.strip().lower() in self._disabled_provider_routes
        )

    def record_attempt(self, model, invocation_id: str, status: str, *, agent_role=None, response=None, error=None):
        """Commit physical attempt evidence before dispatch; never persist prompts or error text.

        Business purpose: Durably record observed provider-attempt status and numeric usage without storing prompts or error text.

        Business rules:
        - Record only an assessment/preparation run or an explicitly configured journal scope.
        - Preserve one initial occurrence time per invocation, canonical runtime identity and provider-reported usage; unavailable usage stays absent.
        Execution flow:
        1. Resolve attempt time, provider/model identity and numeric usage.
        2. Commit attempt evidence and enqueue API delivery in the existing recovery journal.
        3. Try delivery when an API client is attached, retaining journal evidence on delivery failure.
        Failure cases:
        - Durable commit failure raises ModelError to stop model replay; delivery failure logs only its error class and remains recoverable.
        Side effects:
        - Writes usage/evidence journal records, may deliver usage to the API and caches first-attempt timestamps.
        """
        if not (self.assessment_id or self.preparation_run_id or hasattr(self, "store")):
            return
        started = self._attempt_times.setdefault(invocation_id, datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"))
        provider, name = provider_identity(model, response)
        values = extract_provider_usage(response, model) or {} if response is not None else {}
        payload = SettledUsagePayload(
            assessmentId=self.assessment_id, preparationRunId=self.preparation_run_id,
            runId=self.run_id, invocationId=invocation_id, agentRole=agent_role or self.agent_role,
            provider=provider, model=name, attemptStatus=status,
            failureClass=type(error).__name__ if error is not None else None,
            effectiveRuntimeModel=effective_runtime_model(agent_role or self.agent_role, provider, name, model_protocol(model), model_route_config(model)),
            occurredAt=started, **values)
        path = getattr(self, "store", None) or resolve_usage_recovery_store_path()
        try:
            record_usage_evidence(path, f"attempt:{self.run_id}:{invocation_id}:{status}", {
                "event": "MODEL_ATTEMPT", **payload.model_dump(mode="json", exclude_none=True)})
            if self.api_client is not None:
                enqueue_usage(path, payload)
        except Exception as commit_error:
            raise ModelError("Durable usage commit failed; stop without replaying the model") from commit_error
        if self.api_client is not None:
            try:
                drain(path, self.api_client)
            except Exception as delivery_error:
                logger.warning("MODEL_USAGE_DELIVERY_FAILED", invocation_id=invocation_id, error_type=type(delivery_error).__name__)

    def record(self, response, model, invocation_id: str, *, agent_role: str | None = None) -> None:
        """Business purpose: Record a completed provider response through the same durable attempt path.

        Business rules:
        - Completion retains the supplied physical invocation ID and active agent role; only reported numeric usage is recorded.
        Execution flow:
        1. Delegate the response to record_attempt with COMPLETED status.
        Failure cases:
        - Durability failures propagate from the shared path; missing usage is not replaced with estimated usage.
        Side effects:
        - May write the recovery journal and deliver completed usage to the API.
        """
        self.record_attempt(model, invocation_id, "COMPLETED", agent_role=agent_role, response=response)


_active_state: ContextVar[AgentRunState | None] = ContextVar(
    "active_agent_run_state", default=None
)
_bounded_scope: ContextVar[AgentRunState | None] = ContextVar("bounded_inference_scope", default=None)


@contextmanager
def activate_agent_run_state(
    state: AgentRunState | None,
) -> Iterator[AgentRunState | None]:
    """Business purpose: Keep one run's usage identity and admission scope intact across nested agent work.

    Business rules:
    - An enclosing bounded scope cannot be removed, switched to another run or given a different admission object.
    Execution flow:
    1. Verify the enclosing bounded scope.
    2. Activate the run state and its bound scope.
    3. Restore both contexts when nested work exits.
    Failure cases:
    - Changing a bounded run/admission raises BOUNDED_SCOPE_CHANGED before activation; body errors propagate after restoration.
    Side effects:
    - Temporarily mutates context-local state only; no journal reset or model dispatch.
    """
    parent = _bounded_scope.get()
    if parent is not None and (state is None or state.run_id != parent.run_id or state.admission is not parent.admission):
        raise PaidAdmissionError("BOUNDED_SCOPE_CHANGED", parent.run_id)
    bounded_token = _bounded_scope.set(state if state and (state.bounded or state.admission) else parent)
    token = _active_state.set(state)
    try:
        yield state
    finally:
        _active_state.reset(token)
        _bounded_scope.reset(bounded_token)


def active_agent_run_state() -> AgentRunState | None:
    return _active_state.get()


def assert_model_identity(model: Any, response: Any | None = None) -> None:
    """The model that answered must be one of the resolved runtime identities."""
    provider, model_name = provider_identity(model, response)
    if (provider, model_protocol(model), model_name) not in distinct_runtime_identities():
        raise ModelIdentityMismatch(
            "Provider/model differs from the configured runtime model routes"
        )


def check_request_context(request: Any, model: Any) -> "RequestMetrics":
    metrics = estimate_request_metrics(request, model)
    context_limit = metrics.provider_context_limit
    if context_limit is not None and metrics.estimated_input_tokens > context_limit:
        raise ModelContextWindowExceeded(
            "Input exceeds the active provider context window"
        )
    return metrics


def output_token_limit(model: Any) -> int:
    """Business purpose: Resolve the authoritative per-call output token ceiling for a model route.

    Business rules:
    - Every governed model route must declare an explicit positive integer max_output_tokens; silent numeric defaults are prohibited.
    - Inspect model.profile first, then attached route.options, then model.options when resolving the declared ceiling.
    - Booleans, non-integers, missing values, and non-positive integers fail closed before provider dispatch.

    Execution flow:
    1. Read max_output_tokens from model.profile as a Mapping key or object attribute.
    2. If still None, read max_output_tokens from model_route_config(model).options when available.
    3. If still None, read max_output_tokens from model.options when it is a Mapping.
    4. If the model lacks attached route metadata, match a single configured route by provider, protocol, and model.
    5. Reject bool, non-int, non-positive, missing, or ambiguous values with ValueError; otherwise return the integer limit.

    Failure cases:
    - Raises ValueError mentioning max_output_tokens when the output cap is absent or invalid.

    Side effects:
    - Pure read-only metadata inspection; no model invocation or persistence occurs.
    """
    # Why: Fail closed when a model route omits max_output_tokens instead of silently falling back to a hard-coded default.
    # How: Check profile, then route.options, then model.options while declared is None, then enforce strict positive int.
    # Invariant: Python bool subclasses int, so isinstance(declared, bool) must be rejected explicitly before dispatch.
    profile = getattr(model, "profile", None)
    declared = (
        profile.get("max_output_tokens")
        if isinstance(profile, Mapping)
        else getattr(profile, "max_output_tokens", None)
    )
    if declared is None:
        route = model_route_config(model)
        if route is not None and isinstance(route.options, Mapping):
            declared = route.options.get("max_output_tokens")
    if declared is None:
        options = getattr(model, "options", None)
        if isinstance(options, Mapping):
            declared = options.get("max_output_tokens")
    if isinstance(declared, bool) or not isinstance(declared, int) or declared <= 0:
        raise ValueError("Model route must declare a positive integer max_output_tokens")
    return declared


def input_token_limit(model: Any) -> int:
    """Business purpose: Resolve the authoritative per-call input token ceiling (context window) for a model route.

    Business rules:
    - Every governed model route must declare an explicit positive integer context_window_tokens; silent numeric defaults are prohibited.
    - Fallback lookup for an untagged model must match exactly one provider, protocol, and model identity.
    - Inspect model.profile first, then attached route.options, then model.options when resolving the declared ceiling.
    - Booleans, non-integers, missing values, and non-positive integers fail closed before provider dispatch.

    Execution flow:
    1. Read context_window_tokens or max_input_tokens from model.profile as a Mapping key or object attribute.
    2. If still None, read context_window_tokens or max_input_tokens from model_route_config(model).options when available.
    3. If still None, read context_window_tokens or max_input_tokens from model.options when it is a Mapping.
    4. Reject bool, non-int, or non-positive values with ValueError; otherwise return the integer limit.

    Failure cases:
    - Raises ValueError mentioning context_window_tokens when the context window is absent, ambiguous, or invalid.

    Side effects:
    - Pure read-only metadata inspection; no model invocation or persistence occurs.
    """
    # Why: Fail closed when a model route omits context_window_tokens instead of silently falling back to a loose 1000 default.
    # How: Check profile, then route.options, then model.options while declared is None, then enforce strict positive int.
    # Invariant: Python bool subclasses int, so isinstance(declared, bool) must be rejected explicitly before dispatch.
    profile = getattr(model, "profile", None)
    declared = (
        profile.get("context_window_tokens") or profile.get("max_input_tokens")
        if isinstance(profile, Mapping)
        else (getattr(profile, "context_window_tokens", None) or getattr(profile, "max_input_tokens", None))
    )
    if declared is None:
        route = model_route_config(model)
        if route is not None and isinstance(route.options, Mapping):
            declared = route.options.get("context_window_tokens") or route.options.get("max_input_tokens")
    if declared is None:
        options = getattr(model, "options", None)
        if isinstance(options, Mapping):
            declared = options.get("context_window_tokens") or options.get("max_input_tokens")
    if declared is None:
        try:
            from middleware.paid_admission import _TEST_SCRIPTED_MODEL_REGISTRY
            registry = _TEST_SCRIPTED_MODEL_REGISTRY.get()
            if registry and id(model) in registry:
                declared = registry[id(model)].get("input_upper_bound")
        except Exception:
            pass
    if declared is None:
        try:
            from model_policy import load_model_routes
            routes_obj = load_model_routes()
            provider = getattr(model, "provider", None)
            protocol = model_protocol(model)
            model_name = getattr(model, "model_name", None) or getattr(model, "model", None)
            # Why: A model name can be reused by different providers with different token limits.
            # How: Accept an untagged model only when its full runtime identity selects one route.
            # Invariant: Route ordering cannot lower the exposure sent to server admission.
            matches = [
                cfg for cfg in routes_obj.routes.values()
                if provider and protocol and model_name
                and cfg["provider"] == provider
                and cfg["protocol"] == protocol
                and cfg["model"] == model_name
            ]
            if len(matches) == 1:
                opts = matches[0].get("options", {})
                declared = opts.get("context_window_tokens") or opts.get("max_input_tokens")
        except Exception:
            pass
    if isinstance(declared, bool) or not isinstance(declared, int) or declared <= 0:
        raise ValueError("Model route must declare a positive integer context_window_tokens")
    return declared


def response_shape(response: Any) -> list[dict[str, Any]]:
    """Structure of the answer(s) in a model response (names, sizes, stop reason); never argument values."""
    shapes = []
    for message in getattr(response, "result", None) or ():
        if getattr(message, "type", None) != "ai":
            continue
        metadata = message.response_metadata or {}
        content = message.content
        text = content if isinstance(content, str) else "".join(
            block.get("text", "") for block in content if isinstance(block, dict)
        )
        shapes.append({
            "stop": metadata.get("stop_reason") or metadata.get("finish_reason"),
            "output_tokens": (message.usage_metadata or {}).get("output_tokens"),
            "text_chars": len(text),
            "calls": [
                {"name": call["name"], "arg_keys": sorted(call["args"]), "arg_chars": len(json.dumps(call["args"]))}
                for call in message.tool_calls
            ],
            "invalid": [
                {"name": call.get("name"), "arg_chars": len(call.get("args") or ""), "error": str(call.get("error"))[:120]}
                for call in message.invalid_tool_calls
            ],
        })
    return shapes


def output_cap_settings(model: Any) -> dict[str, int]:
    """Business purpose: Build the native per-call output token ceiling settings for downstream provider dispatch.

    Business rules:
    - Validate and resolve max_output_tokens before provider/protocol projection so misconfigured routes fail closed.
    - LangChain forwards request.model_settings through bind_tools/bind, whereas bare model.bind can be dropped by bind_tools.
    - Google GenAI protocol routes receive max_output_tokens; other supported protocols receive max_tokens.

    Execution flow:
    1. Call output_token_limit(model) eagerly to enforce explicit positive integer cap declaration.
    2. Resolve provider identity and protocol for the target model.
    3. Return the protocol-specific settings mapping containing the validated output limit.

    Failure cases:
    - Propagates ValueError from output_token_limit(model) when max_output_tokens is missing or invalid.

    Side effects:
    - Pure read-only settings construction; no provider call or telemetry write occurs.
    """
    # Why: Resolve and validate output_token_limit eagerly before touching provider/protocol routing.
    # How: Enforce limit = output_token_limit(model) first, then map to the native protocol parameter name.
    # Invariant: Never fall back to any implicit SDK or code-level numeric default when max_output_tokens is missing.
    limit = output_token_limit(model)
    provider, _ = provider_identity(model, None)
    protocol = model_protocol(model) or provider.lower()
    parameter = "max_output_tokens" if protocol == "google_genai" else "max_tokens"
    return {parameter: limit}


@dataclass(frozen=True)
class RequestMetrics:
    provider: str
    model: str
    estimated_input_tokens: int
    estimated_input_bytes: int
    provider_context_limit: int | None
    message_count: int
    tool_result_count: int


def _estimate_input_tokens(encoded: bytes) -> int:
    """Conservative ASCII-heavy prompt-token estimate (bytes / 3)."""

    if not encoded:
        return 0
    return math.ceil(len(encoded) / 3)


def estimate_request_metrics(request: Any, model: Any) -> RequestMetrics:
    provider, model_name = provider_identity(model)
    messages = getattr(request, "messages", None)
    message_list = messages if isinstance(messages, list) else []
    tool_messages = [
        message
        for message in message_list
        if _message_role_shape(message) == "tool"
    ]
    encoded = _safe_json_bytes(
        {
            "system": _jsonable(getattr(request, "system_prompt", None)),
            "messages": [_message_estimation_payload(message) for message in message_list],
            "tools": _tools_estimation_payload(getattr(request, "tools", None)),
            "response_format": _response_format_estimation_payload(
                getattr(request, "response_format", None)
            ),
        }
    )
    return RequestMetrics(
        provider=provider,
        model=model_name,
        estimated_input_bytes=len(encoded),
        estimated_input_tokens=_estimate_input_tokens(encoded),
        provider_context_limit=_provider_context_limit_tokens(model),
        message_count=len(message_list),
        tool_result_count=len(tool_messages),
    )


def estimate_messages_input_tokens(messages: Any) -> int:
    """Estimate prompt tokens for a message list with the context guard's estimator."""
    message_list = list(messages) if isinstance(messages, (list, tuple)) else []
    return _estimate_input_tokens(
        _safe_json_bytes([_message_estimation_payload(message) for message in message_list])
    )


def provider_context_limit_tokens(model: Any) -> int | None:
    """Return the model profile's input window, when the profile declares one."""
    return _provider_context_limit_tokens(model)


def _safe_json_bytes(value: Any) -> bytes:
    return json.dumps(
        _jsonable(value),
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")


def _jsonable(value: Any, *, depth: int = 0) -> Any:
    if depth > 8:
        return repr(type(value).__name__)
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, bytes):
        return value.decode("utf-8", errors="replace")
    if isinstance(value, dict):
        return {
            str(key): _jsonable(item, depth=depth + 1)
            for key, item in value.items()
        }
    if isinstance(value, (list, tuple, set)):
        return [_jsonable(item, depth=depth + 1) for item in value]
    if hasattr(value, "model_dump"):
        try:
            return _jsonable(value.model_dump(mode="json"), depth=depth + 1)
        except TypeError:
            return _jsonable(value.model_dump(), depth=depth + 1)
        except Exception:
            pass
    if hasattr(value, "dict"):
        try:
            return _jsonable(value.dict(), depth=depth + 1)
        except Exception:
            pass
    return {
        key: _jsonable(getattr(value, key), depth=depth + 1)
        for key in (
            "name",
            "description",
            "args",
            "args_schema",
            "schema",
            "parameters",
            "content",
            "additional_kwargs",
            "tool_calls",
            "tool_call_id",
            "role",
            "type",
        )
        if hasattr(value, key)
    } or repr(type(value).__name__)


def _message_estimation_payload(message: Any) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "role": _message_role_shape(message),
        "content": _jsonable(getattr(message, "content", None)),
    }
    for key in ("name", "tool_call_id", "tool_calls", "additional_kwargs"):
        if hasattr(message, key):
            payload[key] = _jsonable(getattr(message, key))
    return payload


def _tools_estimation_payload(tools: Any) -> Any:
    if not isinstance(tools, list):
        return _jsonable(tools)
    return [_tool_estimation_payload(tool) for tool in tools]


def _tool_estimation_payload(tool: Any) -> Any:
    if isinstance(tool, dict):
        return _jsonable(tool)
    schema = None
    args_schema = getattr(tool, "args_schema", None)
    if args_schema is not None:
        try:
            schema = args_schema.model_json_schema()
        except Exception:
            schema = _jsonable(args_schema)
    return {
        "name": getattr(tool, "name", None),
        "description": getattr(tool, "description", None),
        "args": _jsonable(getattr(tool, "args", None)),
        "schema": _jsonable(schema),
    }


def _response_format_estimation_payload(response_format: Any) -> Any:
    if response_format is None:
        return None
    schema = None
    for key in ("schema", "schema_", "output_schema"):
        if not hasattr(response_format, key):
            continue
        schema = getattr(response_format, key)
        break
    if hasattr(schema, "model_json_schema"):
        try:
            schema = schema.model_json_schema()
        except Exception:
            schema = _jsonable(schema)
    return {
        "strategy": type(response_format).__name__,
        "schema": _jsonable(schema),
    }


def _provider_context_limit_tokens(model: Any) -> int | None:
    profile = getattr(model, "profile", None)
    if profile is None:
        return None
    if isinstance(profile, dict):
        value = profile.get("max_input_tokens")
    else:
        value = getattr(profile, "max_input_tokens", None)
    if isinstance(value, int) and value > 0:
        return value
    return None


@contextmanager
def activate_agent_role(agent_role: str) -> Iterator[str]:
    token = _active_agent_role.set(agent_role)
    try:
        yield agent_role
    finally:
        _active_agent_role.reset(token)


def active_agent_role() -> str | None:
    return _active_agent_role.get()


@contextmanager
def activate_model_operation(operation_type: str) -> Iterator[str]:
    """Classify one logical model operation without retaining model input/output.

    Business purpose: Classify a logical model operation for usage and progress observability.

    Business rules:
    - Keep only the operation type in context; no model input/output is retained.
    Execution flow:
    1. Activate the operation type for the scope.
    2. Restore the enclosing operation when the scope exits.
    Failure cases:
    - Body exceptions propagate after context restoration; operation classification cannot approve inference.
    Side effects:
    - Temporarily changes context metadata only.
    """
    token = _active_model_operation_type.set(operation_type)
    try:
        yield operation_type
    finally:
        _active_model_operation_type.reset(token)


def active_model_operation() -> str | None:
    """Business purpose: Expose the operation classification attached to the current model scope.

    Business rules:
    - Return the current context value without inferring a classification when none exists.
    Execution flow:
    1. Read and return the active model operation.
    Failure cases:
    - An unclassified scope returns None; no external failure or fallback is introduced.
    Side effects:
    - Pure context read.
    """
    return _active_model_operation_type.get()


@contextmanager
def activate_model_step(step_id: str | None = None) -> Iterator[str]:
    """Business purpose: Give one logical model step a stable identity shared by its retries and provider fallback.

    Business rules:
    - Use the supplied step ID or allocate one; start a fresh logical invocation/provider summary within the nested scope.
    Execution flow:
    1. Activate the step ID and initialize its logical invocation summary.
    2. Yield the step identity and restore both enclosing contexts on exit.
    Failure cases:
    - Exceptions propagate after restoration; a step identity is not evidence that any provider attempt succeeded.
    Side effects:
    - Creates UUID identities and temporary context-local summary state; no provider request or durable usage write.
    """
    resolved = step_id or str(uuid4())
    token = _active_model_step_id.set(resolved)
    summary_token = active_model_step_summary.set(
        {"providers": [], "invocation_id": str(uuid4())}
    )
    try:
        yield resolved
    finally:
        active_model_step_summary.reset(summary_token)
        _active_model_step_id.reset(token)


def active_model_step_id() -> str | None:
    return _active_model_step_id.get()


class _ModelCallTelemetry:
    """Emit safe progress around one blocking provider call."""

    def __init__(
        self,
        model: Any,
        *,
        invocation_id: str | None = None,
        admission: dict | None = None,
        api_client: Any | None = None,
    ) -> None:
        self.provider, self.model_name = provider_identity(model)
        self.protocol = model_protocol(model) or "unknown"
        self.timeout_seconds = llm_provider_timeout_seconds()
        self.model_step_id = active_model_step_id() or str(uuid4())
        self.invocation_id = _active_logical_invocation_id() or invocation_id
        self.settlement_invocation_id = invocation_id
        self.logical_invocation_id = _active_logical_invocation_id()
        self.agent_role = active_agent_role()
        self.operation_type = active_model_operation()
        self._admission = admission
        self._api_client = api_client
        self._started_at = time.monotonic()
        self._stop = Event()
        self._context = copy_context()
        self._thread: Thread | None = None
        # Each billed call is one provider-route attempt of the same logical step.
        self._summary = active_model_step_summary.get()
        note_model_step("provider_attempts")
        self.attempt_ordinal = self._summary.get("provider_attempts") if self._summary else None
        if self._summary is not None:
            self._summary["settlement_invocation_id"] = self.settlement_invocation_id
            self._summary["provider"] = self.provider.lower()
            self._summary["protocol"] = self.protocol
            self._summary["model"] = self.model_name
            if self.provider.lower() not in self._summary["providers"][:8]:
                self._summary["providers"].append(self.provider.lower())

    def routing_summary(self) -> dict[str, Any]:
        """Scalar routing metadata of the logical step; never a list of transitions.

        Business purpose: Expose scalar retry/fallback lineage for the current logical model step.

        Business rules:
        - Keep provider attempts, credential rotations, route ordinal and safe slot identity distinct; never expose credentials or a transition payload list.
        Execution flow:
        1. Read the step's attempt/rotation counters and captured route context.
        2. Return scalar routing and fallback indicators.
        Failure cases:
        - Absent counters use the current attempt's default of one; this summary alone cannot reconcile missing physical ledger rows.
        Side effects:
        - Read-only telemetry projection.
        """
        summary = self._summary or {}
        provider_attempts = summary.get("provider_attempts", 1)
        return {
            "provider_attempts": provider_attempts,
            "credential_attempts": provider_attempts + summary.get("credential_rotations", 0),
            "fallback_used": provider_attempts > 1,
            "route_ordinal": self._context.get(_active_provider_route_ordinal),
            "credential_slot_safe_id": self._context.get(_active_credential_slot_safe_id),
        }

    def start(self) -> None:
        if self._summary is None or not self._summary.get("started"):
            if self._summary is not None:
                self._summary["started"] = True
            self._emit(
                "MODEL_CALL_STARTED",
                status="RUNNING",
                text="model call started",
                data=self._data(elapsed_seconds=0),
            )
        self._thread = Thread(
            target=self._heartbeat,
            name="lcsp-model-call-heartbeat",
            daemon=True,
        )
        self._thread.start()

    def complete(self, response: Any = None, *, invocation_id: str | None = None) -> None:
        extra: dict[str, Any] = {
            "duration_ms": max(0, int((time.monotonic() - self._started_at) * 1000)),
            **self.routing_summary(),
        }
        usage = provider_usage_telemetry(response)
        if usage:
            extra["usage"] = usage
        if invocation_id:
            extra["invocation_id"] = invocation_id
        for message in getattr(response, "result", None) or ():
            message_id = getattr(message, "id", None)
            if isinstance(message_id, str) and message_id:
                # Exact bridge between this logical turn and its stream message.
                extra["message_id"] = message_id
                remember_message_model_step(message_id, self.model_step_id)
        self._finish(
            "MODEL_CALL_COMPLETED",
            status="COMPLETED",
            text="model call completed",
            data_extra=extra,
        )

    def fail(self, error: BaseException, *, record_attempt: bool = True) -> None:
        # A failed route attempt is infrastructure: stop the heartbeat only. The one
        # logical failure is published by the step owner if every route fails.
        """Business purpose: Stop telemetry for a failed provider route without prematurely failing the whole logical step.

        Business rules:
        - A failed route may still be followed by fallback; the step owner publishes terminal failure only after exhaustion.
        - Suppressed/cancelled attempts do not publish ordinary provider-error activity.
        Execution flow:
        1. Stop and briefly join the heartbeat.
        2. Publish a safe attempt failure only when requested and the error is an Exception.
        Failure cases:
        - Provider errors are classified without logging their text; no automatic retry or usage settlement occurs here.
        Side effects:
        - Stops the heartbeat thread and may publish failed-attempt progress metadata.
        """
        self._stop.set()
        if self._thread is not None:
            self._thread.join(timeout=0.25)
        if record_attempt and isinstance(error, Exception):
            _publish_provider_attempt_failure(
                error, provider=self.provider.lower(), protocol=self.protocol,
                model=self.model_name, model_step_id=self.model_step_id,
                invocation_id=self.invocation_id, attempt_ordinal=self.attempt_ordinal,
            )

    def cancel(self) -> None:
        self._finish("MODEL_CALL_CANCELLED", status="STOPPED", text="Model step interrupted")

    def _finish(
        self,
        event_type: str,
        *,
        status: str,
        text: str,
        data_extra: dict[str, Any] | None = None,
    ) -> None:
        """Business purpose: Publish a terminal model-call telemetry event with consistent elapsed time and invocation identity.

        Business rules:
        - Stop heartbeat before terminal publication; captured invocation identity overrides additional event fields.
        Execution flow:
        1. Stop and join heartbeat activity.
        2. Merge base timing/identity with supplied terminal metadata.
        3. Emit the final event in the captured context.
        Failure cases:
        - Publication failures propagate; this helper does not turn an unrecorded outcome into successful usage settlement.
        Side effects:
        - Stops telemetry thread activity and publishes an agent stream event.
        """
        self._stop.set()
        if self._thread is not None:
            self._thread.join(timeout=0.25)
        data = self._data(elapsed_seconds=self._elapsed_seconds())
        if data_extra:
            data.update(data_extra)
        if self.invocation_id:
            data["invocation_id"] = self.invocation_id
        self._emit(event_type, status=status, text=text, data=data)

    def _heartbeat(self) -> None:
        """Business purpose: Emit live progress telemetry and extend the in-flight admission lease during model inference.

        Business rules:
        - Runs on a background thread while model inference is active.
        - Emits safe waiting progress events at fixed intervals without logging raw prompts or keys.
        - Calls the server admission heartbeat endpoint with capability token to prevent false lease recovery sweeps.
        - Heartbeat failures are non-blocking and never abort an in-progress model inference.

        Execution flow:
        1. Initialize timer tracking next heartbeat interval.
        2. Wait on stop event or cancellation context.
        3. When interval elapses, emit MODEL_CALL_HEARTBEAT telemetry event.
        4. If api_client and admission are present, POST heartbeat extension to internal billing API.
        5. Reset timer and loop until execution terminates or cancellation triggers.

        Failure cases:
        - Network errors or rejected heartbeats are caught and ignored; the inference loop continues.

        Side effects:
        - Emits progress stream events and updates inFlightLeaseExpiresAt on the server.
        """
        cancel = self._context.get(active_agent_stream_cancel)
        next_heartbeat = time.monotonic() + _MODEL_CALL_HEARTBEAT_SECONDS
        while not self._stop.wait(min(0.025, _MODEL_CALL_HEARTBEAT_SECONDS)):
            if cancel is not None and cancel.is_set():
                self._stop.set()
                return
            if time.monotonic() >= next_heartbeat:
                self._emit(
                    "MODEL_CALL_HEARTBEAT",
                    status="RUNNING",
                    text="model call waiting",
                    data=self._data(elapsed_seconds=self._elapsed_seconds()),
                )
                if self._api_client is not None and self._admission is not None:
                    try:
                        self._api_client.heartbeat_invocation_admission({
                            "admissionId": self._admission.get("admissionId"),
                            "invocationId": self._admission.get("invocationId"),
                            "capabilityToken": self._admission.get("capabilityToken", ""),
                            "extensionSeconds": 900,
                        })
                    except Exception:
                        pass
                next_heartbeat = time.monotonic() + _MODEL_CALL_HEARTBEAT_SECONDS

    def _elapsed_seconds(self) -> int:
        return max(0, int(time.monotonic() - self._started_at))

    def _data(self, *, elapsed_seconds: int) -> dict[str, Any]:
        """Business purpose: Project safe model-call identity and timing for customer-visible progress.

        Business rules:
        - Include logical and physical settlement IDs separately when known; omit prompt content, response content and credentials.
        Execution flow:
        1. Build provider/protocol/model, timeout and elapsed-time fields.
        2. Add available invocation, agent-role and operation identities.
        Failure cases:
        - Unrecognized optional context is omitted; no provider success or billing result is inferred.
        Side effects:
        - Pure telemetry payload construction.
        """
        data: dict[str, Any] = {
            "provider": self.provider.lower(),
            "protocol": self.protocol,
            "model": self.model_name,
            "timeout_seconds": self.timeout_seconds,
            "elapsed_seconds": elapsed_seconds,
            "model_step_id": self.model_step_id,
        }
        if self.invocation_id:
            data["invocation_id"] = self.invocation_id
        if self.logical_invocation_id:
            data["logical_invocation_id"] = self.logical_invocation_id
        if self.settlement_invocation_id:
            data["settlement_invocation_id"] = self.settlement_invocation_id
        if self.agent_role:
            data["agent_role"] = self.agent_role
        if self.operation_type:
            data["operation_type"] = self.operation_type
        return data

    def _emit(self, event_type: str, **fields: Any) -> None:
        self._context.run(publish_agent_stream_event, event_type, **fields)


def _message_role_shape(message: Any) -> str:
    role = (
        getattr(message, "role", None)
        or getattr(message, "type", None)
        or type(message).__name__
    )
    normalized = {
        "ai": "assistant",
        "human": "user",
    }.get(str(role), str(role))
    tool_calls = getattr(message, "tool_calls", None)
    if normalized == "assistant" and isinstance(tool_calls, list) and tool_calls:
        return "assistant(tool_calls)"
    return normalized


def _tool_call_id_shape(value: Any) -> dict[str, Any]:
    text = str(value or "")
    return {
        "length": len(text),
        "has_call_prefix": text.startswith("call_"),
        "contains_whitespace": any(character.isspace() for character in text),
    }


def _safe_scalar(value: Any) -> Any:
    return value if isinstance(value, (str, int, float, bool)) or value is None else None


_DIAGNOSTIC_ROLE_TAIL = 8


def _request_shape_diagnostic(request: Any, model: Any) -> dict[str, Any]:
    provider, model_name = provider_identity(model)
    messages = getattr(request, "messages", None)
    message_list = messages if isinstance(messages, list) else []
    tools = getattr(request, "tools", None)
    tool_list = tools if isinstance(tools, list) else []
    tool_messages = [
        message
        for message in message_list
        if _message_role_shape(message) == "tool"
    ]
    # Long agent runs carry hundreds of messages; logging every role and every
    # tool-call id shape made each line tens of KB. Keep the recent tail and the
    # distinct shapes, which is what diagnosing a provider rejection needs.
    tool_call_id_shapes: list[dict[str, Any]] = []
    for message in tool_messages:
        shape = _tool_call_id_shape(getattr(message, "tool_call_id", None))
        if shape not in tool_call_id_shapes:
            tool_call_id_shapes.append(shape)
    roles = [_message_role_shape(message) for message in message_list]
    return {
        "provider": provider.lower(),
        "protocol": model_protocol(model),
        "model": model_name,
        "message_count": len(message_list),
        "message_roles": roles[-_DIAGNOSTIC_ROLE_TAIL:],
        "message_roles_omitted": max(0, len(roles) - _DIAGNOSTIC_ROLE_TAIL),
        "tool_count": len(tool_list),
        "tool_result_count": len(tool_messages),
        "tool_call_id_shapes": tool_call_id_shapes,
        "response_format_type": type(getattr(request, "response_format", None)).__name__,
        "tool_choice": _safe_scalar(getattr(request, "tool_choice", None)),
        "tool_choice_type": type(getattr(request, "tool_choice", None)).__name__,
        "stream": getattr(model, "streaming", getattr(model, "stream", None)),
    }


def _is_timeout_error(error: BaseException) -> bool:
    seen: set[int] = set()
    current: BaseException | None = error
    while current is not None and id(current) not in seen:
        seen.add(id(current))
        if isinstance(current, TimeoutError):
            return True
        name = type(current).__name__.lower()
        if "timeout" in name or "timedout" in name:
            return True
        current = current.__cause__ or current.__context__
    return False


def _publish_terminal_model_failure(
    step_id: str, agent_role: str | None, error: BaseException
) -> None:
    """One logical failure per model step, after every route was exhausted.

    Business purpose: Publish one logical model failure after configured retry/fallback paths are exhausted.

    Business rules:
    - Only a started logical step emits a terminal event; timeout and other failures retain safe route-attempt summaries.
    Execution flow:
    1. Read the active step's started state and attempt lineage.
    2. Classify timeout, retryability and fallback eligibility.
    3. Publish the terminal failure with bounded provider identities and last-attempt diagnostics.
    Failure cases:
    - An absent/unstarted summary emits no event; the original exception remains owned by the caller.
    Side effects:
    - Publishes a terminal agent stream event without persisting prompt/error text or replaying inference.
    """
    summary = active_model_step_summary.get()
    if not summary or not summary.get("started"):
        return
    attempts = summary.get("provider_attempts", 1)
    timeout = _is_timeout_error(error)
    from middleware.failure_policy import error_status, retry_model_error
    from middleware.provider_fallback import provider_fallback_failure

    publish_agent_stream_event(
        "MODEL_CALL_TIMEOUT" if timeout else "MODEL_CALL_FAILED",
        status="FAILED",
        text="model call timed out" if timeout else "model call failed",
        data={
            "model_step_id": step_id,
            **({"invocation_id": summary["invocation_id"]} if isinstance(summary.get("invocation_id"), str) else {}),
            **({"agent_role": agent_role} if agent_role else {}),
            "provider": summary.get("provider"),
            "protocol": summary.get("protocol"),
            "model": summary.get("model"),
            "operation_type": active_model_operation(),
            "error_type": type(error).__name__,
            "http_status": error_status(error),
            "retryability": "RETRYABLE" if retry_model_error(error) else "NOT_RETRYABLE",
            "fallback_eligibility": provider_fallback_failure(error),
            "provider_attempts": attempts,
            "credential_attempts": attempts + summary.get("credential_rotations", 0),
            "providers_attempted": list(summary.get("providers", []))[:8],
            "attempt_ordinal": summary.get("last_attempt_ordinal"),
            "route_ordinal": summary.get("last_route_ordinal"),
            "credential_slot_safe_id": summary.get("last_credential_slot_safe_id"),
            "last_attempt_error_class": summary.get("last_error_class"),
            "last_attempt_http_status": summary.get("last_http_status"),
            "last_attempt_retryability": summary.get("last_retryability"),
            "last_attempt_fallback_eligibility": summary.get(
                "last_fallback_eligibility"
            ),
        },
    )


def _safe_provider_error_code(error: BaseException) -> str | None:
    """Business purpose: Recover a provider's safe machine error code for observability without leaking error bodies.

    Business rules:
    - Accept only one-to-eighty ASCII letters, digits, underscore, dot or hyphen; inspect causal errors without cycling.
    Execution flow:
    1. Walk the error/cause chain and inspect top-level or nested code/type fields.
    2. Return the first safe scalar code or None.
    Failure cases:
    - Unsafe values and cyclic or exhausted chains yield no code; raw provider messages are never returned.
    Side effects:
    - Read-only error classification.
    """
    seen: set[int] = set()
    current: BaseException | None = error
    while current is not None and id(current) not in seen:
        seen.add(id(current))
        values = [getattr(current, key, None) for key in ("error_code", "code", "type")]
        body = getattr(current, "body", None)
        nested = body.get("error") if isinstance(body, dict) else None
        if isinstance(nested, dict):
            values.extend(nested.get(key) for key in ("code", "type"))
        for value in values:
            if isinstance(value, str) and re.fullmatch(r"[A-Za-z0-9_.-]{1,80}", value):
                return value
        current = current.__cause__ or current.__context__
    return None


def _publish_provider_attempt_failure(
    error: BaseException, *, provider: str, protocol: str, model: str,
    model_step_id: str, invocation_id: str | None, attempt_ordinal: int | None,
) -> None:
    """Business purpose: Record safe failure lineage for an individual provider attempt while fallback remains possible.

    Business rules:
    - Preserve route/slot and logical-step identity, class/status, retryability and fallback eligibility without error text.
    Execution flow:
    1. Classify the attempt failure and construct its safe metadata.
    2. Update the active step's last-attempt summary.
    3. Publish durable failed-attempt progress.
    Failure cases:
    - Unrecognized optional codes or identities stay absent; publication failure propagates and never triggers a provider retry itself.
    Side effects:
    - Mutates the context-local step summary and publishes a durable activity event.
    """
    from middleware.failure_policy import error_status, retry_model_error
    from middleware.provider_fallback import provider_fallback_failure

    data = {
        "provider": provider, "protocol": protocol, "model": model,
        "model_step_id": model_step_id, "attempt_ordinal": attempt_ordinal,
        "route_ordinal": _active_provider_route_ordinal.get(),
        "credential_slot_safe_id": _active_credential_slot_safe_id.get(),
        "error_class": type(error).__name__, "http_status": error_status(error),
        "provider_error_code": _safe_provider_error_code(error),
        "operation_type": active_model_operation(),
        "retryability": "RETRYABLE" if retry_model_error(error) else "NOT_RETRYABLE",
        "fallback_eligibility": provider_fallback_failure(error),
    }
    if invocation_id:
        data["invocation_id"] = invocation_id
    summary = active_model_step_summary.get()
    if summary is not None:
        summary.update(
            {
                "last_attempt_ordinal": attempt_ordinal,
                "last_route_ordinal": data["route_ordinal"],
                "last_credential_slot_safe_id": data["credential_slot_safe_id"],
                "last_error_class": data["error_class"],
                "last_http_status": data["http_status"],
                "last_retryability": data["retryability"],
                "last_fallback_eligibility": data["fallback_eligibility"],
            }
        )
    publish_agent_stream_event("CUSTOM_PROGRESS", status="FAILED", data={
        **data, "durability": "DURABLE", "activity_kind": "MODEL_PROVIDER_ATTEMPT_FAILED",
    })


def _checkpoint_model_step_id(request: Any) -> str | None:
    """Business purpose: Bind a billable logical model step to the native graph task across checkpoint replay.

    Business rules:
    - Use only a LangGraph execution task identity when present; its server-bound run context is checked at admission.
    - A repeated physical attempt within one task retains the same logical operation; distinct tasks have distinct IDs.
    Execution flow:
    1. Read the request runtime's checkpointed execution information.
    2. Return its nonempty task ID as the model-step identity, or None for nongraph callers.
    Failure cases:
    - Missing or malformed graph metadata falls back to the caller's existing fresh-step behavior.
    Side effects:
    - Pure context inspection; no journal, provider, or server write.
    """
    # Why: A crash after paid settlement but before model-node checkpoint replays that node.
    # How: LangGraph retains the same task_id on node replay, allowing the server's logical-operation fence to match it.
    # Invariant: A fresh random step ID must not bypass the server's already-settled admission on replay.
    info = getattr(getattr(request, "runtime", None), "execution_info", None)
    task_id = getattr(info, "task_id", None)
    return f"graph-task:{task_id}" if isinstance(task_id, str) and task_id.strip() else None


class AgentRoleMiddleware(AgentMiddleware):
    """Attach the canonical policy role to every model call of one agent."""

    def __init__(self, agent_role: str, *, operation_type: str = "AGENT_MODEL"):
        self.agent_role = agent_role
        self.operation_type = operation_type

    def wrap_model_call(self, request, handler):
        """Business purpose: Scope a synchronous logical model call to its policy role, operation and step identity.

        Business rules:
        - All downstream retries/fallback share this logical scope; the role owner publishes terminal failure only if the handler fails.
        Execution flow:
        1. Activate role, operation and a logical model step.
        2. Invoke the downstream handler and return its response.
        3. On exception, publish terminal step failure and rethrow.
        Failure cases:
        - The handler's exception remains a failure after safe telemetry; no fallback success is fabricated.
        Side effects:
        - Changes temporary contexts and may publish terminal failure; downstream middleware owns provider calls and usage.
        """
        with activate_agent_role(self.agent_role), activate_model_operation(self.operation_type), activate_model_step(_checkpoint_model_step_id(request)) as step_id:
            try:
                return handler(request)
            except Exception as error:
                _publish_terminal_model_failure(step_id, self.agent_role, error)
                raise

    async def awrap_model_call(self, request, handler):
        """Business purpose: Scope an asynchronous logical model call to its policy role, operation and step identity.

        Business rules:
        - Keep one logical scope across awaited retry/fallback work and restore enclosing contexts on exit.
        Execution flow:
        1. Activate role, operation and model-step context.
        2. Await the handler.
        3. Publish terminal step failure on exception and propagate it.
        Failure cases:
        - Handler exceptions are not converted to successful responses; context restoration follows scope exit.
        Side effects:
        - Changes temporary contexts and may publish terminal failure; downstream middleware owns inference and settlement.
        """
        with activate_agent_role(self.agent_role), activate_model_operation(self.operation_type), activate_model_step(_checkpoint_model_step_id(request)) as step_id:
            try:
                return await handler(request)
            except Exception as error:
                _publish_terminal_model_failure(step_id, self.agent_role, error)
                raise


class UsageMeteringMiddleware(AgentMiddleware):
    """Govern each actual downstream provider response exactly once.

    Identity assertion, the context-window guard and call telemetry always run;
    token usage is reported only when the run state is attached to an assessment.
    """

    def __init__(self, recovery_store: Any | None = None) -> None:
        super().__init__()
        self._recovery_store = recovery_store

    @staticmethod
    def _serialize_model_response(response: Any) -> dict[str, Any]:
        """Business purpose: Encode a paid model response for exact graph-step recovery.

        Business rules:
        - Preserve message content, tool calls, metadata, and usage through LangChain's message schema.
        - Reject unsupported structured outputs rather than storing a lossy representation.
        Execution flow:
        1. Encode each model message using the LangChain message serializer.
        2. Validate the full payload is JSON-compatible before encrypted persistence.
        Failure cases:
        - Unsupported response shape or non-JSON metadata raises before settlement.
        Side effects:
        - Pure serialization; no disk or provider access.
        """
        # Why: ModelResponse.dumpd() is not implemented and repr cannot restore paid tool calls.
        # How: Use the supported message schema and a strict JSON round trip.
        # Invariant: Never persist an incomplete response that would change graph behavior on replay.
        if isinstance(response, ModelResponse):
            payload = {
                "kind": "model_response",
                "result": [message_to_dict(message) for message in response.result],
                "structured_response": response.structured_response,
            }
        elif isinstance(response, BaseMessage):
            payload = {"kind": "message", "data": message_to_dict(response)}
        elif isinstance(response, SimpleNamespace):
            # Why: Some governed integrations return a plain response object with token metadata.
            # How: Retain only its JSON attributes and restore the same inert container type.
            # Invariant: Never deserialize arbitrary Python classes from paid response storage.
            payload = {"kind": "simple_response", "data": vars(response)}
        else:
            raise ValueError("Unsupported model response type for recovery")
        return json.loads(json.dumps(payload, allow_nan=False))

    @staticmethod
    def _deserialize_model_response(payload: dict[str, Any]) -> Any:
        """Business purpose: Restore the original paid model result for a replayed graph node.

        Business rules:
        - Accept only the bounded message schema created by the serializer.
        - Do not import arbitrary Python classes from persisted ciphertext.
        Execution flow:
        1. Validate payload keys and message list.
        2. Restore LangChain message instances and structured JSON value.
        Failure cases:
        - Malformed payload raises before the graph can consume it.
        Side effects:
        - Pure in-memory reconstruction; no provider call.
        """
        # Why: Returning plain dictionaries would break downstream tool-call and checkpoint semantics.
        # How: Reconstruct only LangChain's known message types from authenticated JSON.
        # Invariant: Never execute code or import arbitrary classes from the recovery store.
        if not isinstance(payload, dict):
            raise ValueError("Invalid recovered model response shape")
        if payload.get("kind") == "message" and set(payload) == {"kind", "data"}:
            return messages_from_dict([payload["data"]])[0]
        if payload.get("kind") == "simple_response" and set(payload) == {"kind", "data"}:
            if not isinstance(payload["data"], dict):
                raise ValueError("Invalid recovered simple response")
            return SimpleNamespace(**payload["data"])
        if payload.get("kind") != "model_response" or set(payload) != {"kind", "result", "structured_response"}:
            raise ValueError("Invalid recovered model response shape")
        messages = payload["result"]
        if not isinstance(messages, list) or not messages:
            raise ValueError("Recovered model response has no messages")
        return ModelResponse(result=messages_from_dict(messages), structured_response=payload["structured_response"])

    @staticmethod
    def _response_recovery_identity(request: Any) -> tuple[str, str]:
        """Business purpose: Bind a temporary paid answer to its original execution and graph step.

        Business rules:
        - A missing run or stable logical step cannot authorize response recovery.
        Execution flow:
        1. Read trusted active run state and the active graph step.
        2. Fall back only to the request's explicitly supplied execution IDs.
        Failure cases:
        - Missing identity raises a fail-closed paid admission error.
        Side effects:
        - Pure identity lookup.
        """
        # Why: A response may contain customer material and must never cross run or step boundaries.
        # How: Reuse the same stable identities that the server admission request uses.
        # Invariant: No random fallback ID can bind a paid result.
        state = active_agent_run_state()
        run_id = (state.run_id if state else None) or getattr(request, "run_id", None)
        step_id = active_model_step_id() or getattr(request, "logical_operation_id", None)
        if not isinstance(run_id, str) or not run_id or not isinstance(step_id, str) or not step_id:
            raise PaidAdmissionError("MISSING_EXECUTION_CONTEXT", run_id or "unknown")
        return run_id, step_id

    def _persist_model_response(self, request: Any, admission: dict[str, Any], response: Any) -> None:
        """Business purpose: Durably protect the original paid answer before settlement may become terminal.

        Business rules:
        - Persist an authenticated response before settlement to close the paid-answer crash window.
        - A failed write must stop terminal settlement and never silently discard the answer.
        Execution flow:
        1. Resolve exact run and graph step identities.
        2. Serialize the model response without losing tool calls or usage.
        3. Encrypt and commit a temporary response with a 24-hour expiry.
        Failure cases:
        - Missing store or unsupported response fails closed with no terminal acknowledgment.
        Side effects:
        - Writes encrypted customer response content to worker-local SQLite.
        """
        # Why: LangGraph's checkpoint occurs only after this middleware returns.
        # How: Commit encrypted ciphertext synchronously before the server settlement call.
        # Invariant: A missing durable answer cannot become a locally replayable terminal result.
        store = self._get_recovery_store()
        if store is None:
            raise PaidAdmissionError("CAPABILITY_RECOVERY_STORE_UNAVAILABLE", getattr(request, "run_id", "unknown"))
        run_id, step_id = self._response_recovery_identity(request)
        payload = self._serialize_model_response(response)
        store.record_model_response(
            admission["admissionId"], admission["invocationId"], run_id, step_id, payload,
            datetime.now(timezone.utc) + timedelta(hours=24),
        )

    def _persist_output_causation(self, request: Any, invocation_id: str, response: Any) -> None:
        """Business purpose: Link each emitted tool call to the physical model attempt that produced it.

        Business rules:
        - Only the server-issued invocation identity can own a tool-call causation row.
        - A conflicting mapping must fail closed before downstream evaluation.
        Execution flow:
        1. Resolve the active run and encrypted recovery store.
        2. Persist each model-emitted tool call under the physical invocation identity.
        Failure cases:
        - Missing store or conflicting tool-call identity raises and stops this response.
        Side effects:
        - Writes worker-local durable causation rows for later evidence matching.
        """
        # Why: A logical model turn can emit multiple tool calls and can span physical retries.
        # How: Bind emitted tool_call IDs to the current server invocation before any evaluator sees them.
        # Invariant: A later DOMAIN_REJECTED verdict cannot guess its physical cause from model_turn alone.
        from middleware.model_output_causation import record_physical_tool_call_causation

        run_id, _ = self._response_recovery_identity(request)
        store = self._get_recovery_store()
        if store is None:
            raise PaidAdmissionError("CAPABILITY_RECOVERY_STORE_UNAVAILABLE", run_id)
        record_physical_tool_call_causation(store.db_path, run_id, invocation_id, response)

    def _restore_terminal_model_response(self, request: Any, admission: dict[str, Any]) -> Any:
        """Business purpose: Return a previously paid answer after the server confirms terminal replay.

        Business rules:
        - Require both server SETTLED status and exact local admission and invocation IDs.
        - An expired, missing, or damaged answer must fail closed without provider redispatch.
        Execution flow:
        1. Resolve the original run and graph step.
        2. Read authenticated terminal response record from local storage.
        3. Compare the server replay IDs and reconstruct the model response.
        Failure cases:
        - Any mismatch or missing terminal record rejects replay.
        Side effects:
        - Reads encrypted worker-local SQLite; no provider call or new settlement.
        """
        # Why: A local terminal marker alone cannot prove current billing authority.
        # How: Compare it against a fresh server-issued SETTLED replay for the same physical invocation.
        # Invariant: One paid physical call yields at most its original answer on graph replay.
        run_id, step_id = self._response_recovery_identity(request)
        store = self._get_recovery_store()
        record = store.get_terminal_model_response_record(run_id, step_id) if store else None
        if (
            record is None
            or record.get("admissionId") != admission.get("admissionId")
            or record.get("invocationId") != admission.get("invocationId")
        ):
            raise PaidAdmissionError("PAID_RESPONSE_RECOVERY_UNAVAILABLE", run_id)
        return self._deserialize_model_response(record["response"])

    @staticmethod
    def _stamp_physical_invocation_id(response: Any, invocation_id: str) -> None:
        """Business purpose: Preserve the server-issued physical call identity for downstream output evaluation.

        Business rules:
        - The marker comes only from the current server admission, never provider response metadata.
        - It identifies one physical attempt; retry and fallback responses must carry their own invocation IDs.
        Execution flow:
        1. Locate returned model messages.
        2. Overwrite the reserved metadata field on every message with the current invocation ID.
        Failure cases:
        - Responses without mutable message metadata remain unmarked and cannot support an authoritative verdict.
        Side effects:
        - Mutates response metadata persisted by the graph; never stores a capability secret or changes billing.
        """
        # Why: The outer schema/domain evaluators run after metering and otherwise see only a logical model step.
        # How: Overwrite any provider-supplied marker with the admission's physical invocation ID.
        # Invariant: A retry verdict cannot accidentally attach to an earlier paid provider attempt.
        messages = getattr(response, "result", None)
        if messages is None and hasattr(response, "model_response"):
            messages = getattr(response.model_response, "result", None)
        if messages is None:
            messages = [response]
        for message in messages:
            metadata = getattr(message, "response_metadata", None)
            if isinstance(metadata, dict):
                metadata["_lcsp_physical_invocation_id"] = invocation_id

    @staticmethod
    def _stamp_payment_decision(response: Any, required: bool) -> None:
        """Business purpose: Carry a server-owned settlement decision across the model checkpoint boundary.

        Business rules:
        - Every provider result clears the reserved marker before settlement, even when no recovery store exists.
        - Only an acknowledged terminal ON settlement may replace the marker with true.
        Execution flow:
        1. Locate returned model messages without changing their content or tool calls.
        2. Overwrite the reserved metadata field on each message with the trusted decision.
        Failure cases:
        - Responses without mutable message metadata retain the run-scoped decision only.
        Side effects:
        - Mutates safe response metadata that LangGraph persists; never writes a capability token.
        """
        # Why: A provider may supply arbitrary metadata, including a forged reserved payment marker.
        # How: Overwrite it on all returned messages before and after authoritative settlement.
        # Invariant: The checkpoint contains only a boolean payment decision, never wallet or capability secrets.
        messages = getattr(response, "result", None)
        if messages is None and hasattr(response, "model_response"):
            messages = getattr(response.model_response, "result", None)
        if messages is None:
            messages = [response]
        for message in messages:
            metadata = getattr(message, "response_metadata", None)
            if isinstance(metadata, dict):
                metadata["_lcsp_payment_required_after_settlement"] = required

    def _get_recovery_store(self) -> Any:
        """Business purpose: Resolve or lazily initialize the worker capability recovery store.

        Business rules:
        - Uses explicit injected instance if provided.
        - Otherwise, initializes from WORKER_ENVELOPE_ENCRYPTION_KEY if set in environment.
        - If unconfigured, returns None (graceful no-op for non-hardened environments).
        Execution flow:
        1. Return injected recovery store if set.
        2. Check for WORKER_ENVELOPE_ENCRYPTION_KEY environment variable.
        3. If present, instantiate WorkerEnvelopeKeyring and CapabilityRecoveryStore.
        Failure cases:
        - Corrupted keyring or store startup errors log warning and fail closed for capability recovery.
        Side effects:
        - May initialize worker-local SQLite database tables for capability recovery.
        """
        # Why: Support dependency injection for tests while maintaining zero-config initialization from env in workers.
        # How: Check instance attribute, then lazy load from keyring.from_env() and store.
        # Invariants & Constraints: Key must be 32 bytes; fails closed on corrupt key.
        if getattr(self, "_recovery_store", None) is not None:
            return self._recovery_store
        key = os.environ.get("WORKER_ENVELOPE_ENCRYPTION_KEY")
        if not key or not key.strip():
            return None
        try:
            from middleware.envelope_encryption import WorkerEnvelopeKeyring
            from middleware.capability_recovery import CapabilityRecoveryStore
            keyring = WorkerEnvelopeKeyring.from_env()
            db_path = os.environ.get("WORKER_RECOVERY_DB_PATH", ".data/worker_recovery.db")
            self._recovery_store = CapabilityRecoveryStore(db_path, keyring)
            return self._recovery_store
        except Exception as error:
            logger.warning("FAILED_TO_INITIALIZE_CAPABILITY_RECOVERY_STORE", error=str(error))
            return None

    def _settle_completed_invocation(
        self,
        request: Any,
        admission: Any,
        invocation_id: str,
        response: Any,
        model: Any = None,
    ) -> None:
        """Business purpose: Commit provider token evidence to local durable store and settle billable invocation with authoritative server.

        Business rules:
        - Must normalize token usage into non-overlapping accounting buckets prior to settlement.
        - Pin only bounded canonical tool-call IDs from the actual physical response; unknown outcomes carry none.
        - Must record token usage evidence in recovery store prior to invoking /internal/billing/usage/settle.
        - Only server-confirmed terminal settlement may promote the encrypted answer to replayable state.
        - Calls client.settle_invocation_usage() with providerCompletionState COMPLETED and exact token counts.
        - Only removes capability envelope from recovery store upon verified terminal acknowledgement (settled: true, slotReleased: true).
        Execution flow:
        1. Resolve capability recovery store, worker API client, and model execution context.
        2. Normalize token usage and validate current-response tool-call IDs.
        3. Record token and tool-call causation evidence durably in worker recovery store.
        4. Send billable invocation settlement request to server.
        5. On terminal release, preserve the server-owned payment decision and promote the encrypted answer before deleting the capability envelope.
        Failure cases:
        - Non-terminal server responses (settled: false) retain envelope for subsequent crash/reconciliation recovery.
        - Unverified or invalid usage metadata reports OUTCOME_UNKNOWN and retains envelope.
        - Network/server or local cleanup errors are logged without suppressing completed inference response or a confirmed payment pause.
        Side effects:
        - Releases admission concurrency slot on server, marks the encrypted answer terminal, deletes local capability envelope, and may flag Root to pause after the model step.
        """
        # Rationale ("Why"): Releasing server slot and closing exposure window requires capabilityToken and usage settlement.
        # Mechanism ("How"): Send billableInvocationSettlementRequest to /internal/billing/usage/settle and verify terminal ack.
        # Invariants & Constraints: Token never leaks; envelope preserved if server returns settled: false.
        store = self._get_recovery_store()
        if store is None or not isinstance(admission, dict):
            return

        client = admission.get("_api_client")
        if client is None or not hasattr(client, "settle_invocation_usage"):
            return

        try:
            from middleware.capability_recovery import extract_verified_token_evidence
            from types import SimpleNamespace

            # Resolve model context for provider identity and inclusive cache bucket calculation
            model_ctx = model or getattr(request, "model", None)
            if model_ctx is None:
                p_name = admission.get("resolvedProvider") or "UNKNOWN"
                m_name = admission.get("resolvedModel") or "UNKNOWN"
                model_ctx = SimpleNamespace(
                    provider=p_name,
                    model_name=m_name,
                    protocol=p_name.lower(),
                )

            # Rationale ("Why"): Normalize token buckets into non-overlapping counts to prevent double-charging cache.
            # Mechanism ("How"): Delegate strictly to extract_provider_usage with model context, then validate via extract_verified_token_evidence.
            # Invariants & Constraints: If normalization rejects contradictory/invalid usage (e.g. input < cached), NEVER fallback to raw usage
            # to send COMPLETED. Leave verified_evidence as None to route strictly to OUTCOME_UNKNOWN.
            extracted_usage = extract_provider_usage(response, model_ctx)
            verified_evidence = None
            if extracted_usage is not None:
                verified_evidence = extract_verified_token_evidence(extracted_usage)
            tool_call_ids: list[str] = []
            if verified_evidence is not None:
                try:
                    tool_call_ids = extract_settlement_tool_call_ids(response)
                except ValueError as invalid_tool_calls:
                    # Why: A malformed tool identity would poison immutable output-verdict causation.
                    # How: Treat the physical outcome as unverified and retain its slot for reconciliation.
                    # Invariant: Never settle COMPLETED with partial, duplicate, or guessed tool IDs.
                    logger.warning("INVALID_SETTLEMENT_TOOL_CALL_IDS", invocation_id=invocation_id, error=str(invalid_tool_calls))
                    verified_evidence = None

            tracker = getattr(request, "_lcsp_attempt_tracker", {}) or {}
            attempt_ordinal = tracker.get("ordinal", 1) or 1

            if verified_evidence is not None:
                # 1. Durably record usage evidence with all verified priced buckets
                store.record_usage_evidence(invocation_id, {
                    "invocationId": invocation_id,
                    **verified_evidence,
                    "toolCallIds": tool_call_ids,
                })

                # 2. Settle with server as COMPLETED with all priced token buckets
                settle_payload = {
                    "admissionId": admission["admissionId"],
                    "invocationId": invocation_id,
                    "capabilityToken": admission.get("capabilityToken", ""),
                    "attemptOrdinal": attempt_ordinal,
                    "providerCompletionState": "COMPLETED",
                    **verified_evidence,
                    "toolCallIds": tool_call_ids,
                }
                settle_resp = client.settle_invocation_usage(settle_payload)

                # 3. Terminal acknowledgement carries the payment decision before local cleanup.
                if isinstance(settle_resp, dict) and settle_resp.get("settled") is True and settle_resp.get("slotReleased") is True:
                    # Why: SQLite deletion may fail after the server has committed a debit; Root must still pause.
                    # How: Stamp the server's terminal ON decision before attempting fallible envelope cleanup.
                    # Invariant: An undeleted envelope permits idempotent settlement recovery, never provider redispatch.
                    if settle_resp.get("debitMode") == "ON" and settle_resp.get("paymentRequired") is True:
                        run_state = active_agent_run_state()
                        if run_state is not None and run_state.assessment_id is not None:
                            run_state.payment_required_after_settlement = True
                            self._stamp_payment_decision(response, True)
                            # Why: A replayed answer must preserve the server-owned payment pause decision.
                            # How: Replace only the encrypted response before making it terminal for replay.
                            # Invariant: The graph must never continue without the payment marker after ON depletion.
                            run_id, step_id = self._response_recovery_identity(request)
                            store.update_model_response_before_terminal(
                                admission["admissionId"], invocation_id, run_id, step_id,
                                self._serialize_model_response(response),
                            )
                    # Why: Server terminal acknowledgment is the only authority to release this paid answer for replay.
                    # How: Mark the encrypted row terminal before fallible capability-envelope cleanup.
                    # Invariant: A crash after settlement can still restore the original response without redispatch.
                    store.mark_model_response_terminal(admission["admissionId"])
                    store.remove_admission_recovery(admission["admissionId"])
            else:
                # Root Cause 3 Fix: If provider omitted either token bucket or reported invalid usage,
                # do NOT default to 0 and do NOT send COMPLETED!
                # Report OUTCOME_UNKNOWN and retain envelope and concurrency slot for integrity review.
                settle_payload = {
                    "admissionId": admission["admissionId"],
                    "invocationId": invocation_id,
                    "capabilityToken": admission.get("capabilityToken", ""),
                    "attemptOrdinal": attempt_ordinal,
                    "providerCompletionState": "OUTCOME_UNKNOWN",
                }
                settle_resp = client.settle_invocation_usage(settle_payload)
                if isinstance(settle_resp, dict) and settle_resp.get("settled") is True and settle_resp.get("slotReleased") is True:
                    store.remove_admission_recovery(admission["admissionId"])
        except Exception as error:
            logger.warning("FAILED_TO_SETTLE_COMPLETED_INVOCATION", invocation_id=invocation_id, error=str(error))

    def _prepare(self, request):
        """Business purpose: Prepare a governed provider request without exceeding admitted token exposure.

        Business rules:
        - The model identity and prompt context must pass the configured route guards.
        - Provider-facing output caps cannot exceed the model cap used for server admission.
        - A valid smaller caller cap may reduce output; it cannot increase the admitted limit.
        Execution flow:
        1. Validate model identity and context; log non-sensitive request diagnostics.
        2. Resolve the provider-specific hard output cap and clamp any request cap to it.
        3. Return the prepared request and original model for admission and dispatch.
        Failure cases:
        - Invalid model identity, context, or output cap aborts before provider dispatch.
        Side effects:
        - Writes diagnostic logs and may create an overridden request object; no provider call occurs.
        """
        check_agent_execution_active()
        model = request.model
        assert_model_identity(model)
        metrics = check_request_context(request, model)
        logger.info(
            "MODEL_CONTEXT_DIAGNOSTIC",
            provider=metrics.provider.lower(),
            protocol=model_protocol(model),
            model=metrics.model,
            agent_role=active_agent_role(),
            message_count=metrics.message_count,
            tool_result_count=metrics.tool_result_count,
            estimated_input_tokens=metrics.estimated_input_tokens,
            estimated_input_bytes=metrics.estimated_input_bytes,
            provider_context_limit=metrics.provider_context_limit,
        )
        logger.info("MODEL_REQUEST_DIAGNOSTIC", **_request_shape_diagnostic(request, model))
        check_agent_execution_active()
        # The request keeps its original model for identity/usage; the cap travels as model settings.
        if hasattr(request, "override"):
            settings = dict(getattr(request, "model_settings", None) or {})
            for cap_name, route_cap in output_cap_settings(model).items():
                requested_cap = settings.get(cap_name)
                # Why: Request settings must not raise the provider cap above the amount priced by admission.
                # How: Preserve a valid smaller caller cap, but clamp larger values to the route cap.
                # Invariant: The provider-facing output bound is always <= admission.outputTokensUpperBound.
                if requested_cap is None:
                    settings[cap_name] = route_cap
                elif type(requested_cap) is int and requested_cap > 0:
                    settings[cap_name] = min(requested_cap, route_cap)
                else:
                    raise ValueError(f"Invalid positive integer {cap_name} in request model settings")
            request = request.override(model_settings=settings)
        return request, model

    @staticmethod
    def _log_response(response, model) -> None:
        provider, name = provider_identity(model)
        logger.info("MODEL_RESPONSE_DIAGNOSTIC", provider=provider.lower(), model=name,
                    agent_role=active_agent_role(), answers=response_shape(response))

    def _record(self, response, model, invocation_id: str) -> None:
        """Business purpose: Commit provider-reported response usage and reconcile any attached run admission.

        Business rules:
        - Use the active run state and physical invocation ID; attached admission reconciliation is attempted even if recording raises.
        Execution flow:
        1. Locate the current run state.
        2. Record its completed response and, in finally, settle admission using normalized reported usage.
        Failure cases:
        - Journal/API recording or admission errors propagate; absent usage retains admission's unknown exposure rather than estimated tokens.
        Side effects:
        - May persist/deliver usage and settle the admission journal; no model dispatch occurs.
        """
        state = active_agent_run_state()
        if state is not None:
            try:
                state.record(response, model, invocation_id, agent_role=active_agent_role())
            finally:
                if state.admission is not None:
                    state.admission.settle(invocation_id, extract_provider_usage(response, model))

    @staticmethod
    def _admit(request, invocation_id):
        """Business purpose: Record and authorize the physical provider attempt before downstream model dispatch.

        Business rules:
        - Bounded scopes require their own unchanged run admission; losing that scope fails closed.
        - STARTED attempt evidence must be durably recorded before the handler can run.
        Execution flow:
        1. Validate and prepare any bounded admitted request.
        2. Mark its reserved attempt IN_FLIGHT.
        3. Commit STARTED evidence for the active run and return the request.
        Failure cases:
        - Missing/mismatched admission raises MISSING_RUN_BUDGET; policy denial or journal durability failure prevents dispatch.
        Side effects:
        - May reserve/transition admission state and persist/deliver STARTED usage evidence; does not call the model.
        """
        state = active_agent_run_state()
        if state is not None and (state.bounded or state.admission is not None):
            if state.admission is None or state.admission.run_id != state.run_id:
                raise PaidAdmissionError("MISSING_RUN_BUDGET", state.run_id, invocation_id)
            request = prepare_admitted_request(state.admission, request, invocation_id, active_agent_role() or state.agent_role)
            state.admission.transition(invocation_id, "IN_FLIGHT")
        elif _bounded_scope.get() is not None:
            raise PaidAdmissionError("MISSING_RUN_BUDGET", _bounded_scope.get().run_id, invocation_id)
        if state is not None:
            state.record_attempt(request.model, invocation_id, "STARTED", agent_role=active_agent_role())
        return request

    @staticmethod
    def _unknown(invocation_id, model, error):
        """Business purpose: Preserve exposure and observable failure when a physical provider attempt has no accepted response.

        Business rules:
        - An attached admission becomes outcome-unknown; a direct integer HTTP 4xx/5xx classifies the observed attempt FAILED, otherwise OUTCOME_UNKNOWN.
        Execution flow:
        1. Find the current run state.
        2. Retain unknown admission exposure.
        3. Commit safe attempt status and error class under the same physical invocation ID.
        Failure cases:
        - No active run produces no usage write; journal or admission failures propagate without assuming zero provider charge.
        Side effects:
        - Updates admission state and writes/delivers usage evidence; no provider replay.
        """
        from tools.common.capabilities.agent_runtime.root_capacity import observe_provider_pressure
        observe_provider_pressure(error)
        state = active_agent_run_state()
        if state is not None:
            if state.admission is not None:
                state.admission.transition(invocation_id, "OUTCOME_UNKNOWN")
            code = getattr(error, "status_code", None)
            status = "FAILED" if type(code) is int and 400 <= code <= 599 else "OUTCOME_UNKNOWN"
            state.record_attempt(model, invocation_id, status, agent_role=active_agent_role(), error=error)

    @staticmethod
    def _cancel_unconsumed_server_admission(client, store, admission, reason: str, run_id: str) -> None:
        """Business purpose: Release an unconsumed server slot when local authorization prevents provider dispatch.

        Business rules:
        - Only a server-confirmed terminal cancellation can release the slot and delete its recovery envelope.
        - A lost response or IN_FLIGHT conflict keeps the encrypted envelope for crash recovery.
        Execution flow:
        1. Send cancellation with the same admission identity and capability.
        2. Delete the local envelope only after CONFIRMED_NO_USAGE and slotReleased are both confirmed.
        Failure cases:
        - Network, state, or cleanup errors retain the envelope; the caller's original admission failure remains authoritative.
        Side effects:
        - May cancel an ADMITTED server record and delete its worker-local encrypted recovery record.
        """
        # Why: A local hard ceiling may reject after the server reserved a wallet slot but before any model byte left the worker.
        # How: Ask the server to cancel only its still-ADMITTED record and require terminal acknowledgement before cleanup.
        # Invariant: An ambiguous consume or cancellation never turns an IN_FLIGHT call into worker-asserted no usage.
        try:
            result = client.cancel_invocation_admission({
                "admissionId": admission["admissionId"],
                "invocationId": admission["invocationId"],
                "capabilityToken": admission["capabilityToken"],
                "cancellationReason": reason,
            })
            if isinstance(result, dict) and result.get("state") == "CONFIRMED_NO_USAGE" and result.get("slotReleased") is True:
                # Why: The local journal otherwise retains an IN_FLIGHT hard-ceiling reservation after the server freed its slot.
                # How: Close only the same run's local predispatch attempt after the trusted terminal server receipt.
                # Invariant: An ambiguous consume or nonterminal cancel still retains both local exposure and envelope.
                state = active_agent_run_state()
                if state is not None and state.admission is not None and state.run_id == run_id:
                    state.admission.cancel_pre_dispatch(admission["invocationId"])
                store.remove_admission_recovery(admission["admissionId"])
        except Exception as error:
            logger.warning("PRE_CONSUME_ADMISSION_CANCEL_UNCONFIRMED", invocation_id=admission["invocationId"],
                           error_type=type(error).__name__)

    def _execute_server_admission(self, request, model, invocation_id: str | None = None) -> dict:
        """Business purpose: Acquire server-issued admission and coordinate local authorization before atomic CAS consume.

        Business rules:
        - Must contact server via WorkerApiClient to verify wallet solvency and concurrency limits.
        - Fails closed on HTTP 402 PAYMENT_REQUIRED, 429/409 concurrency limit, or 403 context mismatch.
        - If returned admission is already IN_FLIGHT, raises InFlightAdmissionRecoveryError to prevent duplicate dispatch.
        - SETTLED replay may return only a matching encrypted terminal response; every other non-ADMITTED state remains non-dispatchable.
        - Local hard ceilings must authorize the attempt before atomic CAS consume and provider invocation.
        - Prices exposure using the configured route input ceiling, never a request-local token estimate.

        Execution flow:
        1. Resolve WorkerApiClient from active run state or environment configuration.
        2. Derive attempt ordinal and construct admission request payload.
        3. POST to /internal/billing/admission/request.
        4. If state == IN_FLIGHT, raise InFlightAdmissionRecoveryError; if SETTLED, require matching local paid response IDs.
        5. For fresh ADMITTED calls, durably store the capability and authorize the local hard ceiling.
        6. POST to /internal/billing/admission/consume and return the prepared request with admitted metadata.

        Failure cases:
        - 402/429/409/422 errors propagate immediately as WorkerCallbackError, aborting provider dispatch.
        - A non-ADMITTED replay without matching terminal response is rejected before local reservation or provider dispatch.
        - Missing server invocationId, missing/invalid capabilityToken, or unavailable recovery store raises PaidAdmissionError.

        Side effects:
        - May cancel ADMITTED on a local denial; otherwise moves server admission to IN_FLIGHT.
        """
        # Why: Enforces financial safety and single-slot concurrency boundary at the worker level.
        # How: Sends admission request, checks for IN_FLIGHT replay, and commits capability token before provider byte dispatch.
        # Invariants & Constraints: Provider handler is NEVER invoked if admission or consume fails.
        state = active_agent_run_state()
        if state is not None and getattr(state, "api_client", None) is not None:
            client = state.api_client
        else:
            from tools.common.capabilities.platform import api_client as api_client_module
            base_url = os.environ.get("LCSP_API_BASE_URL", "http://127.0.0.1:3000")
            api_key = os.environ.get("LCSP_WORKER_API_KEY", "")
            client = api_client_module.WorkerApiClient(base_url, api_key)

        logical_op_id = active_model_step_id() or getattr(request, "logical_operation_id", None)
        run_id = (state.run_id if state else None) or getattr(request, "run_id", None)
        assessment_id = (state.assessment_id if state else None) or getattr(request, "assessment_id", None)
        preparation_run_id = (state.preparation_run_id if state else None) or getattr(request, "preparation_run_id", None)
        agent_role = active_agent_role() or (state.agent_role if state else None) or "assessment-root"
        operation_type = active_model_operation() or "SYNTHESIS"
        lease_token = getattr(state, "execution_lease_token", None) or getattr(request, "execution_lease_token", None)

        # Why: Enforces fail-closed security boundary when execution context is missing (ADR-028).
        # How: Verifies real run_id, logical_op_id, and authority context without synthesizing dummy fallback strings.
        # Invariants: Model provider cannot be dispatched when runtime context binding is lost or unauthenticated.
        # Assessment requests require an active executionLeaseToken; RuleSetPreparation requests require verified preparationRunId.
        if not logical_op_id or not run_id:
            raise PaidAdmissionError(
                "MISSING_EXECUTION_CONTEXT",
                run_id or "unknown",
            )
        if not preparation_run_id and not lease_token:
            raise PaidAdmissionError(
                "MISSING_EXECUTION_CONTEXT",
                run_id or "unknown",
            )

        # Why: Preserve deterministic admissionRequestId and attempt ordinal across retries and lost responses.
        # How: Inspect if request already carries an admission_request_id; if not, initialize and pin it.
        # Invariants: A retry of the same attempt re-sends the exact same admissionRequestId without a new random UUID.
        admission_request_id = getattr(request, "_lcsp_admission_request_id", None) or getattr(request, "admission_request_id", None)
        if not admission_request_id:
            if state is not None:
                ordinals = getattr(state, "_attempt_ordinals", None)
                if ordinals is None:
                    ordinals = {}
                    setattr(state, "_attempt_ordinals", ordinals)
                attempt_ordinal = ordinals.get(logical_op_id, 0) + 1
                ordinals[logical_op_id] = attempt_ordinal
            else:
                tracker = getattr(request, "_lcsp_attempt_tracker", None)
                if tracker is not None and isinstance(tracker, dict):
                    tracker["ordinal"] = tracker.get("ordinal", 0) + 1
                    attempt_ordinal = tracker["ordinal"]
                else:
                    attempt_ordinal = getattr(request, "_lcsp_attempt_ordinal", 0) + 1
            try:
                object.__setattr__(request, "_lcsp_attempt_ordinal", attempt_ordinal)
            except Exception:
                pass
            admission_request_id = f"adm-req-{logical_op_id}-{attempt_ordinal}"
            try:
                object.__setattr__(request, "_lcsp_admission_request_id", admission_request_id)
            except Exception:
                pass
        else:
            attempt_ordinal = getattr(request, "_lcsp_attempt_ordinal", 1)

        output_bound = output_token_limit(model)
        # Why: Request-local estimates can understate a provider call's actual token volume and its exposure.
        # How: Always resolve the configured hard route ceiling before asking the server for admission.
        # Invariant: The request cannot lower the ceiling used to price maximumExposureMicrocredits.
        input_bound = input_token_limit(model)

        # Derive requested provider and model from model attributes, route config, or test registry
        req_provider = getattr(model, "provider", None)
        req_model = getattr(model, "model_name", None) or getattr(model, "model", None)
        if not req_provider or not req_model:
            try:
                from middleware.paid_admission import _TEST_SCRIPTED_MODEL_REGISTRY
                registry = _TEST_SCRIPTED_MODEL_REGISTRY.get()
                if registry and id(model) in registry:
                    req_provider = req_provider or registry[id(model)].get("provider")
                    req_model = req_model or registry[id(model)].get("model")
            except Exception:
                pass
        if not req_provider or not req_model:
            route = model_route_config(model)
            if route is not None:
                req_provider = req_provider or route.provider
                req_model = req_model or route.model

        if not req_provider or not req_model:
            # Why: ADR-028 & Security Invariant: Admission requires a verified, registered provider and model identity.
            # Mechanism: Fail closed before issuing request_invocation_admission when provider or model cannot be resolved.
            # Invariants: Server must never be sent fabricated or arbitrary fallback identities (e.g. "anthropic"/"claude-sonnet-4-6"); 0 admissions, 0 provider calls.
            raise PaidAdmissionError("UNBOUND_MODEL_ROUTE", run_id)

        # Why: Construct canonical admission payload matching contracts schema (ADR-028 Section 3).
        # How: Send assessmentId/executionLeaseToken for assessment runs, or preparationRunId for legal rule preparation runs.
        # Invariants: Server validates funding principal, locks wallet/sponsorship, and enforces CAS before first provider byte.
        admit_payload: dict[str, Any] = {
            "admissionRequestId": admission_request_id,
            "logicalOperationId": logical_op_id,
            "attemptOrdinal": attempt_ordinal,
            "runId": run_id,
            "agentRole": agent_role,
            "operationType": operation_type,
            "requestedProvider": req_provider,
            "requestedModel": req_model,
            "inputTokensUpperBound": int(input_bound),
            "outputTokensUpperBound": int(output_bound),
        }
        if assessment_id:
            admit_payload["assessmentId"] = assessment_id
            if lease_token:
                admit_payload["executionLeaseToken"] = lease_token
        if preparation_run_id:
            admit_payload["preparationRunId"] = preparation_run_id

        admission = client.request_invocation_admission(admit_payload)

        if admission.get("state") == "IN_FLIGHT":
            raise InFlightAdmissionRecoveryError(admission)
        if admission.get("state") == "SETTLED":
            # Why: A graph node may replay after the server settled a paid response but before checkpointing.
            # How: Return the server's terminal identity only when an encrypted terminal response exists locally.
            # Invariant: The wrapper compares both physical IDs before returning; this path never consumes or dispatches.
            store = self._get_recovery_store()
            record = store.get_terminal_model_response_record(run_id, logical_op_id) if store else None
            if (
                record is not None
                and record.get("admissionId") == admission.get("admissionId")
                and record.get("invocationId") == admission.get("invocationId")
            ):
                return admission
        if admission.get("state") != "ADMITTED":
            # Why: A checkpoint replay may return an already SETTLED invocation after the worker lost the model response.
            # How: Refuse every non-dispatchable server state before local admission or CAS consume.
            # Invariant: Terminal billing evidence can never authorize a second physical provider request.
            raise PaidAdmissionError("ADMISSION_NOT_DISPATCHABLE", run_id or "unknown")

        # Why (ADR-028 & Root Cause): Server assigns authoritative invocationId during admission issuance.
        # Mechanism: Validate invocationId exists and is string before storing envelope or consuming.
        # Invariants: Fail closed immediately if server does not issue invocationId; never fallback to client UUID.
        invocation_id = admission.get("invocationId") if isinstance(admission, dict) else None
        if not invocation_id or not isinstance(invocation_id, str):
            raise PaidAdmissionError("MISSING_SERVER_INVOCATION_ID", run_id or "unknown")

        # Why (ADR-028 & Issue 2): Validate authoritative capabilityToken before attempting durable write or consume.
        # Mechanism: Ensure capabilityToken is present and non-empty string.
        # Invariants: 0 consume calls and 0 provider calls if capabilityToken is absent or empty.
        capability_token = admission.get("capabilityToken") if isinstance(admission, dict) else None
        if not capability_token or not isinstance(capability_token, str) or not capability_token.strip():
            raise PaidAdmissionError("MISSING_SERVER_CAPABILITY_TOKEN", run_id or "unknown")

        # Why (ADR-028 & G-06/G-07): Durably encrypt capability recovery envelope before consuming.
        # How: Persist AES-256-GCM envelope to worker SQLite with AAD before calling consume_invocation_admission.
        # Invariants & Constraints: Token must never be written in plaintext; durable write must succeed before consume.
        store = self._get_recovery_store()
        if store is None:
            raise PaidAdmissionError("CAPABILITY_RECOVERY_STORE_UNAVAILABLE", run_id)

        envelope_data = {
            "admissionId": admission["admissionId"],
            "invocationId": invocation_id,
            "runId": run_id or admission.get("runId", "unknown"),
            "attemptOrdinal": attempt_ordinal,
            "capabilityToken": capability_token,
            "maximumExposureMicrocredits": str(admission.get("maximumExposureMicrocredits", "0")),
            "expiresAt": admission.get("expiresAt", ""),
        }
        store.record_in_flight_admission(envelope_data)

        # Why: A local RunAdmission denial after server consume strands an IN_FLIGHT wallet slot without provider usage.
        # How: Commit local authorization while the server is still ADMITTED; cancel that server reservation on denial.
        # Invariant: The provider is never dispatched unless both local hard ceilings and server CAS approve this attempt.
        try:
            prepared_request = self._admit(request, invocation_id)
            check_agent_execution_active()
        except BaseException:
            self._cancel_unconsumed_server_admission(client, store, admission, "LOCAL_ADMISSION_REJECTED", run_id)
            raise

        consume_payload = {
            "admissionId": admission["admissionId"],
            "invocationId": invocation_id,
            "capabilityToken": capability_token,
        }
        try:
            client.consume_invocation_admission(consume_payload)
        except BaseException:
            # Why: A failed consume response may mean the CAS did or did not commit remotely.
            # How: Cancel only if the server still confirms ADMITTED; retain the envelope on any ambiguity.
            # Invariant: No provider call follows an unconfirmed consume, and worker claims never free IN_FLIGHT slots.
            self._cancel_unconsumed_server_admission(client, store, admission, "CONSUME_UNCONFIRMED", run_id)
            raise
        try:
            delattr(request, "_lcsp_admission_request_id")
        except Exception:
            pass
        if isinstance(admission, dict):
            admission["_api_client"] = client
            admission["_prepared_request"] = prepared_request
        return admission

    def wrap_model_call(self, request, handler):
        """Business purpose: Govern one synchronous downstream provider attempt and durably record its actual response or unknown outcome.

        Business rules:
        - Validate configured identity/context and honor execution control before dispatch.
        - Each physical attempt gets a fresh settlement ID; late responses still use that ID for recording and reconciliation.
        - Encrypt the original model response before terminal settlement so checkpoint replay can restore it.
        Execution flow:
        1. Prepare/admit the request and start safe heartbeat telemetry.
        2. On a server-confirmed SETTLED replay, return the matching encrypted answer without provider dispatch.
        3. Otherwise invoke through the cancellable boundary, store the answer and causation, then record usage.
        4. On failure preserve unknown exposure and cancellation/failure telemetry; on success settle and return the answer.
        Failure cases:
        - Admission, provider, control or durability failures propagate; cancellation emits STOPPED and never fabricates a completed response.
        Side effects:
        - May dispatch a real model, persist encrypted response content locally for bounded recovery, settle admission and publish content-free usage telemetry.
        """
        tracker = getattr(request, "_lcsp_attempt_tracker", None)
        if tracker is None:
            tracker = {"ordinal": 0}
            try:
                object.__setattr__(request, "_lcsp_attempt_tracker", tracker)
            except Exception:
                pass
        request, model = self._prepare(request)
        if not hasattr(request, "_lcsp_attempt_tracker"):
            try:
                object.__setattr__(request, "_lcsp_attempt_tracker", tracker)
            except Exception:
                pass
        # Server assigns authoritative invocationId during admission issuance.
        # Invariants: Fail closed immediately if server does not issue invocationId; never fallback to client UUID.
        admission = self._execute_server_admission(request, model)
        if isinstance(admission, dict) and admission.get("state") == "SETTLED":
            return self._restore_terminal_model_response(request, admission)
        invocation_id = admission.get("invocationId") if isinstance(admission, dict) else None
        if not invocation_id or not isinstance(invocation_id, str):
            run_id = getattr(request, "run_id", None) or "unknown"
            raise PaidAdmissionError("MISSING_SERVER_INVOCATION_ID", run_id)
        request = admission["_prepared_request"]
        client = admission.get("_api_client") if isinstance(admission, dict) else None
        telemetry = _ModelCallTelemetry(
            model,
            invocation_id=invocation_id,
            admission=admission if isinstance(admission, dict) else None,
            api_client=client,
        )
        telemetry.start()
        try:
            response = cancellable_sync(lambda: handler(request), late_result=lambda result: self._record(result, model, invocation_id))
            self._stamp_payment_decision(response, False)
            self._stamp_physical_invocation_id(response, invocation_id)
            self._persist_model_response(request, admission, response)
            self._persist_output_causation(request, invocation_id, response)
            self._record(response, model, invocation_id)
            check_agent_execution_active()
        except BaseException as error:
            self._unknown(invocation_id, model, error)
            from langgraph.errors import NodeCancelledError
            from orchestration.agent_stream import AgentStreamInterrupted
            cancelled = isinstance(error, (AgentStreamInterrupted, asyncio.CancelledError, NodeCancelledError))
            telemetry.fail(error, record_attempt=not cancelled)
            if cancelled:
                telemetry.cancel()
            raise
        self._log_response(response, model)
        telemetry.complete(response, invocation_id=invocation_id)
        self._settle_completed_invocation(request, admission, invocation_id, response, model=model)
        return response

    async def awrap_model_call(self, request, handler):
        """Business purpose: Govern one asynchronous downstream provider attempt with durable usage and cancellation-safe observability.

        Business rules:
        - Use a fresh physical settlement ID and the configured identity/context guards; blocking journal work runs outside the async cancellation loop.
        - Persist encrypted response and physical causation before terminal settlement; replay requires server SETTLED confirmation.
        Execution flow:
        1. Prepare the request and ask for server admission in a worker thread.
        2. Restore a matching paid response on terminal replay or await one governed provider inference.
        3. Commit encrypted response and causation before usage settlement in worker threads.
        4. Preserve unknown exposure on failure or publish successful completion.
        Failure cases:
        - Admission, provider, control and durability errors propagate; late responses retain their original settlement identity.
        Side effects:
        - May dispatch a real model, retain encrypted response content temporarily, write usage and admission records, and publish content-free telemetry.
        """
        tracker = getattr(request, "_lcsp_attempt_tracker", None)
        if tracker is None:
            tracker = {"ordinal": 0}
            try:
                object.__setattr__(request, "_lcsp_attempt_tracker", tracker)
            except Exception:
                pass
        request, model = self._prepare(request)
        if not hasattr(request, "_lcsp_attempt_tracker"):
            try:
                object.__setattr__(request, "_lcsp_attempt_tracker", tracker)
            except Exception:
                pass
        # Why: ADR-028 & Root Cause 1: Worker must bind to server-issued invocationId across both sync and async paths.
        # Mechanism: Await admission issuance on worker thread, extract server invocationId, and pass it to _admit and telemetry.
        # Invariants: Preserves server authority; fail closed if invocationId missing, never fallback to ad-hoc client UUID.
        admission = await physical_to_thread(self._execute_server_admission, request, model)
        if isinstance(admission, dict) and admission.get("state") == "SETTLED":
            return await physical_to_thread(self._restore_terminal_model_response, request, admission)
        invocation_id = admission.get("invocationId") if isinstance(admission, dict) else None
        if not invocation_id or not isinstance(invocation_id, str):
            run_id = getattr(request, "run_id", None) or "unknown"
            raise PaidAdmissionError("MISSING_SERVER_INVOCATION_ID", run_id)
        request = admission["_prepared_request"]
        client = admission.get("_api_client") if isinstance(admission, dict) else None
        telemetry = _ModelCallTelemetry(
            model,
            invocation_id=invocation_id,
            admission=admission if isinstance(admission, dict) else None,
            api_client=client,
        )
        telemetry.start()
        try:
            response = await cancellable_async(lambda: handler(request), late_result=lambda result: self._record(result, model, invocation_id))
            self._stamp_payment_decision(response, False)
            self._stamp_physical_invocation_id(response, invocation_id)
            await physical_to_thread(self._persist_model_response, request, admission, response)
            await physical_to_thread(self._persist_output_causation, request, invocation_id, response)
            # Usage-only delivery must not block the graph's async cancellation
            # loop. This thread can finish telemetry after the turn is stopped.
            await physical_to_thread(self._record, response, model, invocation_id)
            check_agent_execution_active()
        except BaseException as error:
            await physical_to_thread(self._unknown, invocation_id, model, error)
            from langgraph.errors import NodeCancelledError
            from orchestration.agent_stream import AgentStreamInterrupted
            cancelled = isinstance(error, (AgentStreamInterrupted, asyncio.CancelledError, NodeCancelledError))
            telemetry.fail(error, record_attempt=not cancelled)
            if cancelled:
                telemetry.cancel()
            raise
        self._log_response(response, model)
        telemetry.complete(response, invocation_id=invocation_id)
        await physical_to_thread(self._settle_completed_invocation, request, admission, invocation_id, response, model)
        return response

    def wrap_tool_call(self, request, handler):
        return cancellable_sync(lambda: handler(request))

    async def awrap_tool_call(self, request, handler):
        return await cancellable_async(lambda: handler(request))


def stamp_server_payment_decision_in_recovery_payload(payload: dict[str, Any], required: bool) -> dict[str, Any]:
    """Business purpose: Preserve an authoritative payment pause when a crash sweeper closes a paid call.

    Business rules:
    - Only the caller's verified terminal server receipt may supply the payment decision.
    - The response payload must remain within the bounded serializer schema.
    Execution flow:
    1. Decode the encrypted-store payload to a known response type.
    2. Overwrite the reserved payment marker on returned messages.
    3. Re-encode the response for encrypted persistence before terminal marking.
    Failure cases:
    - Invalid or unsupported payload raises and prevents terminal response replay.
    Side effects:
    - Pure in-memory transformation; no provider dispatch or database write.
    """
    # Why: Recovery may settle after the worker crashed, so the original in-memory payment flag is unavailable.
    # How: Reuse the middleware's strict response codec and server-marker overwrite.
    # Invariant: A terminal ON settlement cannot resume the graph without its payment pause.
    response = UsageMeteringMiddleware._deserialize_model_response(payload)
    UsageMeteringMiddleware._stamp_payment_decision(response, required)
    return UsageMeteringMiddleware._serialize_model_response(response)


def extract_settlement_tool_call_ids(response: Any) -> list[str]:
    """Business purpose: Identify the physical model result's tool calls for later output verdicts.

    Business rules:
    - Include only tool-call IDs from the actual response, never request data or prior attempts.
    - Allow at most 64 unique IDs of 1 to 200 characters, with no surrounding whitespace.
    Execution flow:
    1. Read returned LangChain messages and their tool calls.
    2. Validate each ID and reject duplicates.
    3. Return IDs in canonical sorted order.
    Failure cases:
    - Malformed, repeated, or excessive IDs raise and prevent a false COMPLETED settlement.
    Side effects:
    - Pure extraction; sends no content, arguments, or model output to billing.
    """
    # Why: An evaluator must prove that a rejected tool call came from this paid physical invocation.
    # How: Send only bounded IDs extracted from the actual stamped result, sorted for fingerprint stability.
    # Invariant: No tool arguments, response text, or prior retry IDs cross the billing boundary.
    messages = getattr(response, "result", None)
    if messages is None:
        messages = [response]
    if not isinstance(messages, list):
        raise ValueError("Invalid model response messages")
    ids: list[str] = []
    for message in messages:
        calls = getattr(message, "tool_calls", None) or []
        if not isinstance(calls, list):
            raise ValueError("Invalid model tool calls")
        for call in calls:
            call_id = call.get("id") if isinstance(call, dict) else None
            # Why: JavaScript and PostgreSQL sort some Unicode identities differently.
            # How: Accept only printable ASCII IDs shared by contract, worker, and DB canonical ordering.
            # Invariant: Unrecognized provider IDs produce OUTCOME_UNKNOWN, never ambiguous receipt evidence.
            if not isinstance(call_id, str) or not 1 <= len(call_id) <= 200 or re.fullmatch(r"[!-~]+", call_id) is None:
                raise ValueError("Invalid model tool call ID")
            ids.append(call_id)
            if len(ids) > 64:
                raise ValueError("Model response exceeds maximum tool call IDs")
    if len(set(ids)) != len(ids):
        raise ValueError("Duplicate model tool call IDs")
    return sorted(ids)


def effective_runtime_model(
    role: str, provider: str, model: str, protocol: str | None = None,
    route: ResolvedModelConfig | None = None,
) -> dict[str, str] | None:
    """Audit identity of the route that actually answered, scoped to the agent role.

    Attached route options are authoritative, including when several inference
    policies share a physical model. Untagged clients use role/unique identity lookup.
    Mismatched or unconfigured identities remain unknown.

    Business purpose: Identify the route that actually answered for usage audit, including role-specific route options.

    Business rules:
    - An attached route is authoritative; untagged clients may use role or unique configured identity lookup.
    - Provider, model and optional protocol must match a configured route; unknown identities stay unknown.
    Execution flow:
    1. Compare the attached/role route with the observed identity.
    2. Resolve an untagged matching route when needed and return its role-free configuration snapshot.
    Failure cases:
    - Mismatched attached route or unconfigured identity returns None; no provider alias or route is invented.
    Side effects:
    - Read-only model-policy lookup; no inference or usage persistence.
    """
    canonical = provider.lower()  # inverse of provider_identity()'s UPPER ledger form; no aliasing
    config = route or resolve_role(role)
    if (
        (config.provider, config.model) != (canonical, model)
        or (protocol is not None and config.protocol != protocol)
    ):
        if route is not None:
            return None
        config = route_for_model(canonical, model, protocol)
    if config is None:
        return None
    snapshot = config_snapshot(config, role)
    snapshot.pop("role")
    return snapshot


def provider_identity(model: Any, response: Any | None = None) -> tuple[str, str]:
    route = model_route_config(model)
    provider = route.provider if route is not None else model_provider(model)
    if route is None:
        provider = provider or getattr(model, "provider", None)
    provider = provider or getattr(model, "_llm_type", None) or "UNKNOWN"
    response_metadata = getattr(response, "response_metadata", None)
    if isinstance(response_metadata, dict):
        provider = provider if provider != "UNKNOWN" else response_metadata.get("provider", provider)
    model_name = route.model if route is not None else (
        getattr(model, "model_name", None)
        or getattr(model, "model", None)
        or getattr(model, "model_id", None)
        or (response_metadata.get("model") if isinstance(response_metadata, dict) else None)
        or (response_metadata.get("model_name") if isinstance(response_metadata, dict) else None)
        or "UNKNOWN"
    )
    return str(provider).upper(), str(model_name)


def extract_provider_usage(response: Any, model: Any) -> dict[str, Any] | None:
    """Normalize LangChain/provider numeric usage without inferring missing fields.

    Business purpose: Normalize numeric provider usage into canonical accounting buckets without estimating absent fields.

    Business rules:
    - Respect provider/protocol-specific inclusive input semantics and cache buckets; reasoning remains an output breakdown.
    - Raw Google candidate output is visible output and needs a reported reasoning bucket to establish combined output.
    Execution flow:
    1. Select reported usage metadata and read supported numeric aliases.
    2. Normalize cached/noncached input and output/reasoning fields when their reported buckets establish them.
    3. Attach a known provider response identity and return available values only.
    Failure cases:
    - Absent metadata or unusable/contradictory buckets return None or omit unknown fields; negative derived uncached input rejects the usage.
    Side effects:
    - Pure response projection; does not persist usage or inspect hidden reasoning text.
    """
    metadata = _usage_metadata(response)
    if not isinstance(metadata, dict):
        return None
    messages = getattr(response, "result", None)
    normalized = metadata is getattr(response, "usage_metadata", None) or (
        isinstance(messages, (list, tuple))
        and any(metadata is getattr(message, "usage_metadata", None) for message in messages)
    )

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
    result: dict[str, Any] = {}
    if output_tokens is not None:
        result["outputTokens"] = str(output_tokens)
    nested_input = metadata.get("input_token_details")
    nested_output = metadata.get("output_token_details")
    prompt_details = metadata.get("prompt_tokens_details")
    completion_details = metadata.get("completion_tokens_details")
    cache_creation = metadata.get("cache_creation")
    details = metadata.get("details")

    # Rationale ("Why"): Providers place cache and reasoning breakdowns in various nested containers
    # (e.g. OpenAI prompt_tokens_details, Anthropic input_token_details, or telemetry details).
    # Mechanism ("How"): Flatten all known nested dictionary containers into metadata to ensure complete bucket extraction.
    # Invariants & Constraints: Overwrites only if child dict is non-empty; preserves root if nested missing.
    if isinstance(nested_input, dict):
        metadata = {**metadata, **nested_input}
    if isinstance(nested_output, dict):
        metadata = {**metadata, **nested_output}
    if isinstance(prompt_details, dict):
        metadata = {**metadata, **prompt_details}
    if isinstance(completion_details, dict):
        metadata = {**metadata, **completion_details}
    if isinstance(cache_creation, dict):
        metadata = {**metadata, **cache_creation}
    if isinstance(details, dict):
        metadata = {**metadata, **details}
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
            "thoughtsTokenCount",
            "reasoningTokenCount",
        ),
        ("cacheWrite5mTokens", "ephemeral_5m_input_tokens"),
        ("cacheWrite1hTokens", "ephemeral_1h_input_tokens"),
        ("totalTokens", "total_tokens", "total_token_count", "totalTokenCount"),
    )
    for target, *keys in optional:
        value = _number(metadata, *keys)
        if value is not None:
            result[target] = str(value)
    provider, _ = provider_identity(model, response)
    if input_tokens is not None:
        inclusive = (
            provider in {"OPENAI", "GOOGLE_GENAI", "INCEPTION"}
            or (model_protocol(model) in {"anthropic", "openai"} and normalized)
            or ("prompt_tokens_details" in metadata)
            or ("cached_tokens" in metadata)
        )
        cached = result.get("cachedInputTokens")
        written = result.get("cacheWriteTokens")
        cached_val = int(cached) if cached is not None else 0
        written_val = int(written) if written is not None else 0
        if inclusive:
            result["inputTokensIncludingCache"] = str(input_tokens)
            # Rationale ("Why"): In inclusive accounting, inputTokens represents strictly uncached prompt tokens.
            # Mechanism ("How"): Subtract cached and cache-creation tokens from inclusive input_tokens.
            # Invariants & Constraints: Double-counting of cached tokens is strictly prevented.
            if cached is not None or written is not None:
                uncached = input_tokens - cached_val - written_val
                if uncached < 0:
                    return None
                result["inputTokens"] = str(uncached)
            else:
                result["inputTokens"] = str(input_tokens)
        else:
            result["inputTokens"] = str(input_tokens)
            if cached is not None or written is not None:
                result["inputTokensIncludingCache"] = str(input_tokens + cached_val + written_val)
    if not normalized and provider == "GOOGLE_GENAI" and "candidatesTokenCount" in metadata:
        result["visibleOutputTokens"] = str(output_tokens) if output_tokens is not None else None
        if output_tokens is not None and "reasoningTokens" in result:
            result["outputTokens"] = str(output_tokens + int(result["reasoningTokens"]))
        else:
            result.pop("outputTokens", None)
    if not result:
        return None
    response_id = _response_identity(response)
    if response_id:
        result["providerResponseId"] = response_id
    return result


_USAGE_KEY_RE = re.compile(r"^[a-z][a-z0-9_]{0,47}$")
_USAGE_CANONICAL = {
    "input_tokens": ("input_tokens", "prompt_tokens", "prompt_token_count", "input_token_count"),
    "output_tokens": (
        "output_tokens", "completion_tokens", "candidates_tokens",
        "candidates_token_count", "output_token_count",
    ),
    "total_tokens": ("total_tokens", "total_token_count"),
}
_USAGE_MAX_DETAILS = 24


def _usage_key(key: Any) -> str | None:
    if not isinstance(key, str):
        return None
    snake = re.sub(r"(?<=[a-z0-9])([A-Z])", r"_\1", key).lower()
    return snake if _USAGE_KEY_RE.match(snake) else None


def _usage_value(value: Any) -> int | float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    if isinstance(value, float) and not math.isfinite(value):
        return None
    return value if value >= 0 else None


def provider_usage_telemetry(response: Any) -> dict[str, Any] | None:
    """Customer-visible usage exactly as the provider reported it (no inference).

    Separate from extract_provider_usage: that one is the usage-record normalization
    (disjoint buckets, string payload); this keeps raw reported numbers for display.
    Missing fields are omitted; only provider response metadata is read.
    """
    metadata = _usage_metadata(response, include_root=False)
    if not isinstance(metadata, dict):
        return None
    flat: dict[str, Any] = {}
    nested: list[Any] = []
    for raw_key, raw in metadata.items():
        if isinstance(raw, dict):
            nested.append((_usage_key(raw_key) or "", raw))
            continue
        key = _usage_key(raw_key)
        value = _usage_value(raw)
        if key is not None and value is not None:
            flat.setdefault(key, value)
    for group_name, group in nested:  # one level, e.g. input_token_details / output_token_details
        for raw_key, raw in group.items():
            key = _usage_key(raw_key)
            value = _usage_value(raw)
            if key is None or value is None:
                continue
            if key in flat and group_name:  # same name in two groups: keep both, unambiguously
                key = _usage_key(f"{group_name}_{key}") or key
            flat.setdefault(key, value)
    usage: dict[str, Any] = {}
    consumed: set[str] = set()
    for target, aliases in _USAGE_CANONICAL.items():
        consumed.update(aliases)
        for alias in aliases:
            if alias in flat:
                usage[target] = flat[alias]
                break
    details = {k: v for k, v in flat.items() if k not in consumed}
    if details:
        usage["details"] = dict(sorted(details.items())[:_USAGE_MAX_DETAILS])
    return usage or None


def _usage_metadata(response: Any, *, include_root: bool = True) -> dict[str, Any] | None:
    """Business purpose: Select the first available usage dictionary from supported model response locations.

    Business rules:
    - Prefer normalized response usage, then supported metadata and message usage; include raw root dictionaries only when requested.
    Execution flow:
    1. Collect candidate response and message usage locations in precedence order.
    2. Return the first dictionary or None.
    Failure cases:
    - Missing/non-dictionary candidates are skipped; an empty first dictionary is retained and does not justify inferred tokens.
    Side effects:
    - Read-only response metadata inspection; no logging or settlement occurs.
    """
    candidates = [getattr(response, "usage_metadata", None)]
    if isinstance(response, dict):
        candidates.append(response)
    response_metadata = getattr(response, "response_metadata", None)
    if isinstance(response_metadata, dict):
        candidates.extend(
            [
                response_metadata.get("usage_metadata"),
                response_metadata.get("usageMetadata"),
                response_metadata.get("token_usage"),
                response_metadata.get("usage"),
                *([response_metadata] if include_root else []),
            ]
        )
    result = getattr(response, "result", None)
    if isinstance(result, (list, tuple)):
        candidates.extend(getattr(item, "usage_metadata", None) for item in result)
        if include_root:
            candidates.extend(getattr(item, "response_metadata", None) for item in result)
        else:
            for item in result:
                meta = getattr(item, "response_metadata", None)
                if isinstance(meta, dict):
                    candidates.extend([meta.get("token_usage"), meta.get("usage")])
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


__all__ = [
    "AgentRoleMiddleware",
    "AgentRunState",
    "ModelContextWindowExceeded",
    "ModelIdentityMismatch",
    "OUTPUT_EVALUATION_STATES",
    "PROVIDER_COMPLETION_STATES",
    "UsageMeteringMiddleware",
    "activate_agent_role",
    "activate_agent_run_state",
    "active_agent_role",
    "active_agent_run_state",
    "extract_provider_usage",
    "input_token_limit",
    "output_cap_settings",
    "output_token_limit",
    "provider_usage_telemetry",
]
