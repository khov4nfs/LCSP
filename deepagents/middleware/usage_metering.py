"""Single governed model boundary: identity, context guard, telemetry and token usage.

Runs for every agent model call, with or without an assessment. Token usage is
reported to the API as provider-reported numbers only. Prompt content, model messages and hidden reasoning are never part
of the usage payload.
"""

from __future__ import annotations

import asyncio
import json
import math
import re
import time
from contextlib import contextmanager
from contextvars import ContextVar, copy_context
from dataclasses import dataclass, field
from datetime import datetime, timezone
from threading import Event, Thread
from typing import Any, Iterator
from uuid import uuid4

from langchain.agents.middleware import AgentMiddleware

from middleware.token_fallback import model_protocol, model_provider
from middleware.usage_recovery import enqueue_usage
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
from orchestration.runtime_control import cancellable_async, cancellable_sync
from provider_credentials import llm_provider_timeout_seconds
from tools.common.capabilities.platform.api_client import WorkerApiClient
from tools.common.capabilities.platform.callback_schemas import SettledUsagePayload
from tools.common.capabilities.platform.config import resolve_usage_recovery_store_path
from tools.common.capabilities.platform.logging import get_logger

_MODEL_CALL_HEARTBEAT_SECONDS = 10.0
# Output cap when the model route declares no ``max_output_tokens`` option.
DEFAULT_MAX_OUTPUT_TOKENS = 4096
logger = get_logger(__name__)


class ModelContextWindowExceeded(RuntimeError):
    """The active provider/model cannot accept the request after context reduction."""


class ModelIdentityMismatch(RuntimeError):
    """The model that answered is not one of the configured runtime routes."""

    status_code = 400
    error_code = "MODEL_IDENTITY_MISMATCH"


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
    summary = active_model_step_summary.get()
    invocation_id = summary.get("invocation_id") if summary else None
    return invocation_id if isinstance(invocation_id, str) else None


def _active_metered_invocation_id() -> str | None:
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
    api_client: WorkerApiClient | None = None
    _disabled_provider_routes: set[str] = field(default_factory=set, init=False)
    _sticky_provider_routes: set[str] = field(default_factory=set, init=False)

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

    def record(
        self,
        response: Any,
        model: Any,
        invocation_id: str,
        *,
        agent_role: str | None = None,
    ) -> None:
        """Report provider-reported token usage; best effort, never fails the run.

        Nothing is posted when the provider returned no usage numbers (no invented
        counts) or when the run has no assessment to attribute usage to.
        """
        if self.api_client is None or not self.assessment_id:
            return
        usage = extract_provider_usage(response, model)
        if usage is None:
            return
        provider, model_name = provider_identity(model, response)
        payload = SettledUsagePayload(
            assessmentId=self.assessment_id,
            runId=self.run_id,
            invocationId=invocation_id,
            agentRole=agent_role or self.agent_role,
            providerResponseId=usage.pop("providerResponseId", None),
            provider=provider,
            model=model_name,
            effectiveRuntimeModel=effective_runtime_model(
                agent_role or self.agent_role,
                provider,
                model_name,
                model_protocol(model),
                model_route_config(model),
            ),
            occurredAt=datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
            **usage,
        )
        try:
            self.api_client.post_settled_usage(payload)
        except Exception as error:
            # Usage is telemetry: the provider already answered, so failing (and
            # replaying) the model call would only duplicate work.
            logger.warning(
                "MODEL_USAGE_DELIVERY_FAILED",
                invocation_id=invocation_id,
                error_type=type(error).__name__,
            )
            self._enqueue_for_recovery(payload, invocation_id)

    @staticmethod
    def _enqueue_for_recovery(payload: SettledUsagePayload, invocation_id: str) -> None:
        """Keep undelivered usage durable for the background drain; never raises."""
        try:
            enqueue_usage(resolve_usage_recovery_store_path(), payload)
        except Exception as error:  # noqa: BLE001 - telemetry never fails the model call
            logger.error(
                "MODEL_USAGE_RECOVERY_ENQUEUE_FAILED",
                invocation_id=invocation_id,
                error_type=type(error).__name__,
            )


_active_state: ContextVar[AgentRunState | None] = ContextVar(
    "active_agent_run_state", default=None
)


@contextmanager
def activate_agent_run_state(
    state: AgentRunState | None,
) -> Iterator[AgentRunState | None]:
    token = _active_state.set(state)
    try:
        yield state
    finally:
        _active_state.reset(token)


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
    """The route's ``max_output_tokens`` profile value or the code default."""
    profile = getattr(model, "profile", None)
    declared = (
        profile.get("max_output_tokens")
        if isinstance(profile, dict)
        else getattr(profile, "max_output_tokens", None)
    )
    return declared if isinstance(declared, int) and declared > 0 else DEFAULT_MAX_OUTPUT_TOKENS


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
    """The per-call output ceiling as native model settings.

    LangChain forwards ``request.model_settings`` through ``bind_tools``/``bind``. A bare
    ``model.bind(max_tokens=...)`` is dropped by ``bind_tools``, so a cap bound that way never
    reached the provider and the SDK's own default (4096 for an unknown Anthropic model id) won.
    """
    provider, _ = provider_identity(model, None)
    protocol = model_protocol(model) or provider.lower()
    parameter = "max_output_tokens" if protocol == "google_genai" else "max_tokens"
    return {parameter: output_token_limit(model)}


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
    """Classify one logical model operation without retaining model input/output."""
    token = _active_model_operation_type.set(operation_type)
    try:
        yield operation_type
    finally:
        _active_model_operation_type.reset(token)


def active_model_operation() -> str | None:
    return _active_model_operation_type.get()


@contextmanager
def activate_model_step(step_id: str | None = None) -> Iterator[str]:
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

    def __init__(self, model: Any, *, invocation_id: str | None = None) -> None:
        self.provider, self.model_name = provider_identity(model)
        self.protocol = model_protocol(model) or "unknown"
        self.timeout_seconds = llm_provider_timeout_seconds()
        self.model_step_id = active_model_step_id() or str(uuid4())
        self.invocation_id = _active_logical_invocation_id() or invocation_id
        self.settlement_invocation_id = invocation_id
        self.logical_invocation_id = _active_logical_invocation_id()
        self.agent_role = active_agent_role()
        self.operation_type = active_model_operation()
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
        """Scalar routing metadata of the logical step; never a list of transitions."""
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
                next_heartbeat = time.monotonic() + _MODEL_CALL_HEARTBEAT_SECONDS

    def _elapsed_seconds(self) -> int:
        return max(0, int(time.monotonic() - self._started_at))

    def _data(self, *, elapsed_seconds: int) -> dict[str, Any]:
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
    """One logical failure per model step, after every route was exhausted."""
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


class AgentRoleMiddleware(AgentMiddleware):
    """Attach the canonical policy role to every model call of one agent."""

    def __init__(self, agent_role: str, *, operation_type: str = "AGENT_MODEL"):
        self.agent_role = agent_role
        self.operation_type = operation_type

    def wrap_model_call(self, request, handler):
        with activate_agent_role(self.agent_role), activate_model_operation(self.operation_type), activate_model_step() as step_id:
            try:
                return handler(request)
            except Exception as error:
                _publish_terminal_model_failure(step_id, self.agent_role, error)
                raise

    async def awrap_model_call(self, request, handler):
        with activate_agent_role(self.agent_role), activate_model_operation(self.operation_type), activate_model_step() as step_id:
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

    def _prepare(self, request):
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
            settings = {**output_cap_settings(model), **(getattr(request, "model_settings", None) or {})}
            request = request.override(model_settings=settings)
        return request, model

    @staticmethod
    def _log_response(response, model) -> None:
        provider, name = provider_identity(model)
        logger.info("MODEL_RESPONSE_DIAGNOSTIC", provider=provider.lower(), model=name,
                    agent_role=active_agent_role(), answers=response_shape(response))

    def _record(self, response, model, invocation_id: str) -> None:
        state = active_agent_run_state()
        if state is not None:
            state.record(response, model, invocation_id, agent_role=active_agent_role())

    def wrap_model_call(self, request, handler):
        request, model = self._prepare(request)
        # Each answered attempt must survive the API's settlement idempotency key.
        invocation_id = str(uuid4())
        telemetry = _ModelCallTelemetry(model, invocation_id=invocation_id)
        telemetry.start()
        try:
            response = cancellable_sync(lambda: handler(request), late_result=lambda result: self._record(result, model, invocation_id))
            self._record(response, model, invocation_id)
            check_agent_execution_active()
        except BaseException as error:
            from langgraph.errors import NodeCancelledError
            from orchestration.agent_stream import AgentStreamInterrupted
            cancelled = isinstance(error, (AgentStreamInterrupted, asyncio.CancelledError, NodeCancelledError))
            telemetry.fail(error, record_attempt=not cancelled)
            if cancelled:
                telemetry.cancel()
            raise
        self._log_response(response, model)
        telemetry.complete(response, invocation_id=invocation_id)
        return response

    async def awrap_model_call(self, request, handler):
        request, model = self._prepare(request)
        invocation_id = str(uuid4())
        telemetry = _ModelCallTelemetry(model, invocation_id=invocation_id)
        telemetry.start()
        try:
            response = await cancellable_async(lambda: handler(request), late_result=lambda result: self._record(result, model, invocation_id))
            # Usage-only delivery must not block the graph's async cancellation
            # loop. This thread can finish telemetry after the turn is stopped.
            await asyncio.to_thread(self._record, response, model, invocation_id)
            check_agent_execution_active()
        except BaseException as error:
            from langgraph.errors import NodeCancelledError
            from orchestration.agent_stream import AgentStreamInterrupted
            cancelled = isinstance(error, (AgentStreamInterrupted, asyncio.CancelledError, NodeCancelledError))
            telemetry.fail(error, record_attempt=not cancelled)
            if cancelled:
                telemetry.cancel()
            raise
        self._log_response(response, model)
        telemetry.complete(response, invocation_id=invocation_id)
        return response

    def wrap_tool_call(self, request, handler):
        return cancellable_sync(lambda: handler(request))

    async def awrap_tool_call(self, request, handler):
        return await cancellable_async(lambda: handler(request))


def effective_runtime_model(
    role: str, provider: str, model: str, protocol: str | None = None,
    route: ResolvedModelConfig | None = None,
) -> dict[str, str] | None:
    """Audit identity of the route that actually answered, scoped to the agent role.

    Attached route options are authoritative, including when several inference
    policies share a physical model. Untagged clients use role/unique identity lookup.
    Mismatched or unconfigured identities remain unknown.
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
    """Normalize LangChain/provider numeric usage without inferring missing fields."""
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
    # LangChain Anthropic totals include cache slices; raw Anthropic usage excludes them.
    if provider in {"OPENAI", "GOOGLE_GENAI"} or (
        model_protocol(model) == "anthropic" and normalized
    ):
        if cached_input + cache_write > input_tokens:
            return None
        input_tokens = max(input_tokens - cached_input - cache_write, 0)
    result["inputTokens"] = str(input_tokens)
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
    candidates = [getattr(response, "usage_metadata", None)]
    response_metadata = getattr(response, "response_metadata", None)
    if isinstance(response_metadata, dict):
        candidates.extend(
            [
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
    "UsageMeteringMiddleware",
    "activate_agent_role",
    "activate_agent_run_state",
    "active_agent_role",
    "active_agent_run_state",
    "extract_provider_usage",
    "provider_usage_telemetry",
]
