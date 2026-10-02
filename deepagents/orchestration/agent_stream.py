"""Bridge LangGraph/Deep Agents streaming events into the LCSP live chat runtime.

The bridge deliberately exposes only provider/framework-visible streaming content:
the reasoning a provider returns to the caller (reasoning summaries, or the
``reasoning_content`` channel of OpenAI-compatible reasoning routes), each tool call,
and the visible model output. It never synthesizes reasoning and never forwards the
raw thinking text of a content block that also carries a summary. All payloads are
bounded and credential-redacted before they leave the worker process.
"""

from __future__ import annotations

import logging
import json
import math
import re
import time
from queue import Full, Queue
from threading import Event, Thread
from contextlib import contextmanager
from contextvars import ContextVar, copy_context
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Callable, Iterator
from uuid import uuid4

from langchain_core.messages import AIMessage, AIMessageChunk, ToolMessage

from middleware.redaction import redact_dict, redact_string


MAX_STREAM_TEXT_CHARS = 65_536
# Durable reasoning is journaled per model step; keep each entry readable.
MAX_REASONING_SUMMARY_CHARS = 8_000
MAX_STREAM_COLLECTION_ITEMS = 50
MAX_STREAM_DEPTH = 6
STREAM_MODES = ("messages", "updates", "custom", "values")
GRAPH_STREAM_MODES = ("updates", "custom", "values")
SEMANTIC_SCHEMA_VERSION = "AGENT_STREAM_SEMANTIC_V1"
BEST_EFFORT = "BEST_EFFORT"
DURABLE = "DURABLE"
PRIVATE_GRAPH_KEYS = frozenset(
    {
        "messages",
        "prompt",
        "systemprompt",
        "instruction",
        "privatecontext",
        "customercontext",
        "confirmedcontext",
        "confirmedcustomercontext",
        "prioranswerhistory",
        "scratchpad",
        "reasoning",
        "thought",
        "thoughts",
    }
)

# Customer-visible pipeline stage an event belongs to. Mirrors
# ASSESSMENT_AGENT_STREAM_STAGES in packages/contracts so the workspace renders
# one live timeline per stage (Scanner, Interview, Rule analysis, Gate).
AGENT_STREAM_STAGES = {
    "scanner": "SCANNER",
    "interview": "INTERVIEW",
    "rule_analysis": "RULE_ANALYSIS",
    "gate": "GATE",
}

NOISY_STREAM_LOGGER_PREFIXES = (
    "httpx",
    "httpcore",
    "urllib3",
    "pika",
    "langchain",
    "langgraph",
)
NOISY_STREAM_LOG_MARKERS = (
    "PIIMiddleware[",
    "[HIDDEN_PRIVATE_RUNTIME_STATE]",
    "private_runtime_state",
)


class BufferedAgentStreamEmitter:
    """Deliver stream payloads in-order off the model execution thread."""

    def __init__(
        self,
        deliver: Callable[[dict[str, Any]], None],
        *,
        max_pending: int = 4096,
        close_timeout_seconds: float = 2.0,
    ) -> None:
        self._deliver = deliver
        self._queue: Queue[dict[str, Any] | None] = Queue(maxsize=max_pending)
        self._best_effort_backlog_limit = max(1, min(max_pending - 1, 2))
        self._close_timeout_seconds = max(0.0, close_timeout_seconds)
        self._closed = False
        self._thread = Thread(
            target=self._run,
            name="lcsp-agent-stream",
            daemon=True,
        )
        self._thread.start()

    def __call__(self, payload: dict[str, Any]) -> None:
        if self._closed:
            return
        if (
            not _is_critical_stream_payload(payload)
            and self._queue.qsize() >= self._best_effort_backlog_limit
        ):
            # Token deltas and graph updates are best-effort. Do not let them
            # queue ahead of the next durable model/tool turn.
            return
        try:
            self._queue.put_nowait(payload)
        except Full:
            if _is_critical_stream_payload(payload):
                try:
                    self._queue.put(payload, timeout=self._close_timeout_seconds)
                    return
                except Full:
                    try:
                        self._deliver(payload)
                    except Exception:
                        return
                    return
            # Live telemetry must never backpressure model/tool execution. If the
            # local API cannot keep up, drop the excess event instead of blocking
            # the governed assessment workflow.
            return

    def close(self) -> None:
        if self._closed:
            return
        self._closed = True
        try:
            self._queue.put_nowait(None)
        except Full:
            pass
        self._thread.join(timeout=self._close_timeout_seconds)

    def _run(self) -> None:
        while True:
            payload = self._queue.get()
            try:
                if payload is None:
                    return
                try:
                    self._deliver(payload)
                except Exception:
                    # Live telemetry is best-effort and must never fail agent execution.
                    pass
            finally:
                self._queue.task_done()
                if self._closed and self._queue.empty():
                    return


@dataclass
class AgentStreamSession:
    """Per-boundary live-stream context bound to one customer-visible run."""

    assessment_id: str
    run_id: str
    correlation_id: str
    boundary_name: str
    emit_payload: Callable[[dict[str, Any]], None]
    stage: str | None = None
    sequence: int = field(default=0, init=False)
    emitted_model_requests: set[str] = field(default_factory=set, init=False)
    model_output_chunks: dict[str, list[str]] = field(
        default_factory=dict,
        init=False,
    )
    model_reasoning_chunks: dict[str, list[str]] = field(
        default_factory=dict,
        init=False,
    )
    pending_tool_calls: dict[str, "PendingToolCall"] = field(
        default_factory=dict,
        init=False,
    )
    emitted_tool_calls: set[str] = field(default_factory=set, init=False)
    tool_started_at: dict[str, float] = field(default_factory=dict, init=False)

    def emit(self, event_type: str, **fields: Any) -> None:
        step_id = active_model_step.get() or _MESSAGE_MODEL_STEPS.get(
            str(fields.get("message_id") or "")
        )
        data = fields.get("data")
        if step_id and (data is None or isinstance(data, dict)) and "model_step_id" not in (data or {}):
            fields = {**fields, "data": {**(data or {}), "model_step_id": step_id}}
        self.sequence += 1
        payload = {
            "event_id": str(uuid4()),
            "client_sequence": self.sequence,
            "emitted_at": datetime.now(timezone.utc).isoformat(),
            "assessment_id": self.assessment_id,
            "run_id": self.run_id,
            "correlation_id": self.correlation_id,
            "event_type": event_type,
            "source": self.boundary_name,
            **fields,
        }
        stage = active_agent_stream_stage.get() or self.stage
        if stage and "stage" not in fields:
            payload["stage"] = stage
        rule_id = active_agent_stream_rule.get()
        if rule_id and "engineering_rule_id" not in fields:
            payload["engineering_rule_id"] = rule_id
        self.emit_payload(_sanitize_payload(payload))


@dataclass
class PendingToolCall:
    key: str
    agent_name: str
    namespace: tuple[str, ...]
    message_id: str
    tool_name: str = ""
    tool_call_id: str = ""
    args: str = ""
    request_id: str = ""
    model_context: dict[str, Any] = field(default_factory=dict)


# Canonical logical-model-turn identity. Set around one model step (retries,
# credential rotation and provider fallback included); stamped on every event
# emitted inside it. Events emitted later by the stream consumer (MODEL_REQUEST,
# deltas) find it through the response message id remembered at completion.
active_model_step: ContextVar[str | None] = ContextVar("active_model_step_id", default=None)
# Scalar routing summary of the active model step (provider/credential attempts).
# Routing transitions are infrastructure: they are counted here and logged, never
# published as assessment events.
active_model_step_summary: ContextVar[dict[str, Any] | None] = ContextVar(
    "active_model_step_summary", default=None
)


def note_model_step(counter: str, amount: int = 1) -> None:
    summary = active_model_step_summary.get()
    if summary is not None:
        summary[counter] = summary.get(counter, 0) + amount


_MESSAGE_MODEL_STEPS: dict[str, str] = {}
_MESSAGE_MODEL_STEPS_CAP = 4096


def remember_message_model_step(message_id: Any, step_id: str | None) -> None:
    if not step_id or not isinstance(message_id, str) or not message_id:
        return
    _MESSAGE_MODEL_STEPS[message_id] = step_id
    while len(_MESSAGE_MODEL_STEPS) > _MESSAGE_MODEL_STEPS_CAP:
        _MESSAGE_MODEL_STEPS.pop(next(iter(_MESSAGE_MODEL_STEPS)))


active_agent_stream: ContextVar[AgentStreamSession | None] = ContextVar(
    "active_agent_stream", default=None
)
_emitting_stream_event: ContextVar[bool] = ContextVar(
    "emitting_agent_stream_event", default=False
)
active_agent_stream_stage: ContextVar[str | None] = ContextVar(
    "active_agent_stream_stage", default=None
)
active_agent_stream_rule: ContextVar[str | None] = ContextVar(
    "active_agent_stream_rule", default=None
)
# Set by the Agent Server run loop (local_server.py) around graph.stream(...) so a
# customer-requested stop reaches whichever nested invoke_with_stream call is
# currently iterating its own model/tool stream, however deep the boundary handler
# call stack goes, without threading a cancel parameter through every call site.
active_agent_stream_cancel: ContextVar[Event | None] = ContextVar(
    "active_agent_stream_cancel", default=None
)


class AgentStreamInterrupted(BaseException):
    """Cooperative stop requested mid-stream; not a failure.

    Subclasses BaseException, like TargetedInterviewPending elsewhere in this
    codebase, so it is never swallowed by an ``except Exception`` handler in a
    boundary handler and reaches the Agent Server run loop that owns run status.
    """


def check_agent_execution_active() -> None:
    """Stop nested work before another provider call after run cancellation."""
    cancel_event = active_agent_stream_cancel.get()
    if cancel_event is not None and cancel_event.is_set():
        raise AgentStreamInterrupted("agent execution deadline or cancellation reached")


@contextmanager
def agent_stream_stage(stage: str | None) -> Iterator[None]:
    """Attribute every live event emitted in this block to one pipeline stage.

    Nested stages win, so an Interview dispatched from inside the engineering
    assessment boundary streams as Interview, not as the enclosing stage.
    """
    if not stage:
        yield
        return
    token = active_agent_stream_stage.set(stage)
    try:
        yield
    finally:
        active_agent_stream_stage.reset(token)


class AgentStreamRuleScope:
    """Handle for one EngineeringRule investigation inside the live stream."""

    def __init__(self, rule_id: str) -> None:
        self.rule_id = rule_id
        self.finished = False

    def complete(self, claims: Any = (), *, text: str | None = None) -> None:
        """Publish the rule's reasoning result: one line per criterion claim."""
        summaries = [_claim_summary(claim) for claim in claims or ()]
        summaries = [item for item in summaries if item][:MAX_STREAM_COLLECTION_ITEMS]
        self.finished = True
        publish_agent_stream_event(
            "ENGINEERING_RULE",
            status="COMPLETED",
            text=text or "engineering rule investigation completed",
            data=_semantic_payload(
                "ENGINEERING_RULE",
                durability=DURABLE,
                engineeringRuleId=self.rule_id,
                claimCount=len(summaries),
                decision=_rule_decision(summaries),
                resultSummary={"claims": summaries} if summaries else {},
                status="COMPLETED",
            ),
        )

    def fail(self, error: BaseException, *, status: str = "FAILED") -> None:
        self.finished = True
        publish_agent_stream_event(
            "ENGINEERING_RULE",
            status=status,
            text=redact_string(str(error))[:MAX_STREAM_TEXT_CHARS],
            data=_semantic_payload(
                "ENGINEERING_RULE",
                durability=DURABLE,
                engineeringRuleId=self.rule_id,
                reasonCode=type(error).__name__,
                status=status,
            ),
        )


@contextmanager
def agent_stream_rule_scope(
    rule_id: str | None,
    *,
    concept: str | None = None,
    required_evidence: Any = (),
    investigation_goals: Any = (),
    waiting_on: tuple[type[BaseException], ...] = (),
) -> Iterator[AgentStreamRuleScope | None]:
    """Attribute every live event in this block to one EngineeringRule.

    The workspace renders each rule as its own section: which rule is being
    investigated, then that rule's model/tool/reasoning activity, then its result.
    Exceptions listed in ``waiting_on`` pause the rule (WAITING) instead of failing it.
    """
    if not rule_id:
        yield None
        return
    scope = AgentStreamRuleScope(rule_id)
    token = active_agent_stream_rule.set(rule_id)
    try:
        publish_agent_stream_event(
            "ENGINEERING_RULE",
            status="RUNNING",
            text="engineering rule investigation started",
            data=_semantic_payload(
                "ENGINEERING_RULE",
                durability=DURABLE,
                engineeringRuleId=rule_id,
                concept=_text(concept),
                requiredEvidence=_string_list(list(required_evidence or ())),
                investigationGoals=_string_list(list(investigation_goals or ())),
                status="RUNNING",
            ),
        )
        try:
            yield scope
        except BaseException as error:
            # Intentional pauses (TargetedInterviewPending) are BaseExceptions so
            # generic failure handlers skip them; the rule then waits, not fails.
            if not scope.finished and isinstance(error, waiting_on):
                scope.fail(error, status="WAITING")
            elif not scope.finished and isinstance(error, Exception):
                scope.fail(error, status="FAILED")
            raise
        if not scope.finished:
            scope.complete()
    finally:
        active_agent_stream_rule.reset(token)


def _claim_summary(claim: Any) -> dict[str, Any]:
    def field_value(*names: str) -> Any:
        for name in names:
            value = (
                claim.get(name) if isinstance(claim, dict) else getattr(claim, name, None)
            )
            if value not in (None, "", (), []):
                return value
        return None

    claim_type = _text(field_value("claim_type", "claimType"))
    if not claim_type:
        return {}
    summary: dict[str, Any] = {"claimType": claim_type}
    criterion = _text(field_value("criterion"))
    if criterion:
        summary["criterion"] = criterion[:500]
    confidence = field_value("confidence")
    if isinstance(confidence, (int, float)) and not isinstance(confidence, bool):
        summary["confidence"] = round(float(confidence), 3)
    limitations = field_value("limitations")
    if isinstance(limitations, (list, tuple)):
        summary["limitations"] = _string_list(list(limitations))
    locations = field_value("source_locations", "sourceLocations")
    if isinstance(locations, (list, tuple)):
        # One flat string keeps the claim inside the stream's bounded nesting depth.
        refs = [
            _source_location_ref(location)
            for location in list(locations)[:MAX_STREAM_COLLECTION_ITEMS]
        ]
        if any(refs):
            summary["sourceLocations"] = ", ".join(ref for ref in refs if ref)
    return summary


def _source_location_ref(location: Any) -> str:
    if not isinstance(location, dict):
        return ""
    path = _text(location.get("path"))
    if not path:
        return ""
    start = location.get("start_line") or location.get("startLine")
    end = location.get("end_line") or location.get("endLine")
    if isinstance(start, int) and isinstance(end, int) and end != start:
        return f"{path}#L{start}-L{end}"
    if isinstance(start, int):
        return f"{path}#L{start}"
    return path


def _rule_decision(summaries: list[dict[str, Any]]) -> str:
    """The shared claim type when every criterion agrees; per-claim lines otherwise."""
    claim_types = {summary.get("claimType") for summary in summaries}
    claim_types.discard(None)
    return str(next(iter(claim_types))) if len(claim_types) == 1 else ""


@contextmanager
def activate_agent_stream(session: AgentStreamSession | None) -> Iterator[None]:
    """Bind a live-stream session to the current boundary execution context."""
    token = active_agent_stream.set(session)
    # A new boundary owns its attribution, not its caller's Scanner/Interview stage.
    stage_token = active_agent_stream_stage.set(session.stage if session else None)
    try:
        yield
    finally:
        try:
            closer = getattr(session.emit_payload, "close", None) if session is not None else None
            if callable(closer):
                closer()
        finally:
            active_agent_stream_stage.reset(stage_token)
            active_agent_stream.reset(token)


MODEL_WAIT_HEARTBEAT_SECONDS = 10.0


@contextmanager
def model_wait_heartbeat(
    text: str,
    *,
    interval_seconds: float | None = None,
) -> Iterator[None]:
    """Keep the run visibly alive while a model call waits outside a provider attempt.

    Credential-cooldown waits happen between provider attempts, where the per-call
    heartbeat is not running. The API treats the latest runtime event as liveness.
    """
    interval = MODEL_WAIT_HEARTBEAT_SECONDS if interval_seconds is None else interval_seconds
    stop = Event()
    context = copy_context()

    def beat() -> None:
        while not stop.wait(interval):
            context.run(
                publish_agent_stream_event,
                "MODEL_CALL_HEARTBEAT",
                status="RUNNING",
                text=text,
            )

    thread = Thread(target=beat, name="lcsp-model-wait-heartbeat", daemon=True)
    thread.start()
    try:
        yield
    finally:
        stop.set()
        thread.join(timeout=0.25)


def publish_agent_stream_event(event_type: str, **fields: Any) -> None:
    """Publish one safe live event when the current boundary has a stream session."""
    session = active_agent_stream.get()
    if session is None or _emitting_stream_event.get():
        return
    token = _emitting_stream_event.set(True)
    try:
        session.emit(event_type, **fields)
    finally:
        _emitting_stream_event.reset(token)


class _FinalValues:
    """Track the invoked graph's own final state across its multi-mode stream.

    A graph invoked from inside a parent graph node streams every chunk under the
    parent task namespace, and its subgraphs always stream deeper. The shortest
    namespace seen is therefore this invocation's own level, empty or not.
    """

    def __init__(self) -> None:
        self.namespace: tuple[str, ...] | None = None
        self.value: Any = None
        self.seen = False

    def offer(self, namespace: tuple[str, ...], data: Any) -> None:
        if self.namespace is None or len(namespace) < len(self.namespace):
            self.namespace = namespace
        if namespace == self.namespace:
            self.value = data
            self.seen = True


def invoke_with_stream(
    agent: Any,
    input_value: Any,
    *,
    config: Any | None = None,
    context: Any | None = None,
    agent_name: str | None = None,
    stage: str | None = None,
) -> Any:
    """Invoke one LangGraph/Deep Agent while forwarding its v2 multi-mode stream.

    The final ``values`` projection is returned so existing business code receives
    the same final graph state it previously obtained from ``invoke``. ``stage``
    attributes the whole stream to one customer-visible pipeline stage.
    """
    with agent_stream_stage(stage):
        return _invoke_with_stream(
            agent,
            input_value,
            config=config,
            context=context,
            agent_name=agent_name,
        )


def _invoke_with_stream(
    agent: Any,
    input_value: Any,
    *,
    config: Any | None,
    context: Any | None,
    agent_name: str | None,
) -> Any:
    session = active_agent_stream.get()
    if session is None or not callable(getattr(agent, "stream", None)):
        check_agent_execution_active()
        invoke_kwargs: dict[str, Any] = {}
        if config is not None:
            invoke_kwargs["config"] = config
        if context is not None:
            invoke_kwargs["context"] = context
        return agent.invoke(input_value, **invoke_kwargs)

    resolved_name = (
        agent_name
        or _text(getattr(agent, "name", None))
        or _text(getattr(agent, "__name__", None))
        or "agent"
    )
    publish_agent_stream_event(
        "AGENT_STARTED",
        agent_name=resolved_name,
        status="RUNNING",
    )

    final = _FinalValues()
    cancel_event = active_agent_stream_cancel.get()
    try:
        stream_kwargs: dict[str, Any] = {
            "stream_mode": list(STREAM_MODES),
            "subgraphs": True,
            "version": "v2",
        }
        if config is not None:
            stream_kwargs["config"] = config
        if context is not None:
            stream_kwargs["context"] = context
        for chunk in agent.stream(input_value, **stream_kwargs):
            if cancel_event is not None and cancel_event.is_set():
                publish_agent_stream_event(
                    "AGENT_FAILED",
                    agent_name=resolved_name,
                    status="FAILED",
                    text="agent turn stopped by customer request",
                    data={"reasonCode": "CUSTOMER_REQUESTED_STOP"},
                )
                raise AgentStreamInterrupted(
                    "agent stream cooperatively interrupted"
                )
            if not isinstance(chunk, dict):
                continue
            mode = _text(chunk.get("type"))
            namespace = _namespace(chunk.get("ns"))
            data = chunk.get("data")
            if mode == "values":
                final.offer(namespace, data)
                _emit_values_metadata(
                    data,
                    namespace=namespace,
                    agent_name=resolved_name,
                )
                continue
            if mode == "messages":
                _emit_message_event(
                    data,
                    namespace=namespace,
                    agent_name=resolved_name,
                )
                continue
            if mode == "updates":
                _emit_update_event(
                    data,
                    namespace=namespace,
                    agent_name=resolved_name,
                )
                continue
            if mode == "custom":
                publish_agent_stream_event(
                    "CUSTOM_PROGRESS",
                    agent_name=resolved_name,
                    namespace=list(namespace),
                    data=_safe_value(data),
                    status="RUNNING",
                )
    except Exception as error:
        publish_agent_stream_event(
            "AGENT_FAILED",
            agent_name=resolved_name,
            status="FAILED",
            text=redact_string(str(error))[:MAX_STREAM_TEXT_CHARS],
            data={"exception_type": type(error).__name__},
        )
        raise

    if not final.seen:
        raise RuntimeError(
            "LCSP streamed agent invocation completed without a final values projection"
        )

    publish_agent_stream_event(
        "AGENT_COMPLETED",
        agent_name=resolved_name,
        status="COMPLETED",
    )
    return final.value



def invoke_graph_with_stream(
    graph: Any,
    input_value: Any,
    *,
    config: Any | None = None,
    graph_name: str = "workflow",
    stage: str | None = None,
) -> Any:
    """Run a LangGraph workflow with live node/custom/state events and preserve invoke semantics."""
    with agent_stream_stage(stage):
        return _invoke_graph_with_stream(
            graph,
            input_value,
            config=config,
            graph_name=graph_name,
        )


def _invoke_graph_with_stream(
    graph: Any,
    input_value: Any,
    *,
    config: Any | None,
    graph_name: str,
) -> Any:
    if active_agent_stream.get() is None or not callable(getattr(graph, "stream", None)):
        check_agent_execution_active()
        if config is None:
            return graph.invoke(input_value)
        return graph.invoke(input_value, config)

    final = _FinalValues()
    cancel_event = active_agent_stream_cancel.get()
    publish_agent_stream_event(
        "AGENT_STARTED",
        agent_name=graph_name,
        status="RUNNING",
        data={"kind": "workflow"},
    )
    try:
        for chunk in graph.stream(
            input_value,
            config=config,
            stream_mode=list(GRAPH_STREAM_MODES),
            subgraphs=True,
            version="v2",
        ):
            if cancel_event is not None and cancel_event.is_set():
                publish_agent_stream_event(
                    "AGENT_FAILED",
                    agent_name=graph_name,
                    status="FAILED",
                    text="agent turn stopped by customer request",
                    data={"kind": "workflow", "reasonCode": "CUSTOMER_REQUESTED_STOP"},
                )
                raise AgentStreamInterrupted(
                    "agent stream cooperatively interrupted"
                )
            if not isinstance(chunk, dict):
                continue
            mode = _text(chunk.get("type"))
            namespace = _namespace(chunk.get("ns"))
            data = chunk.get("data")
            if mode == "values":
                final.offer(namespace, data)
                _emit_values_metadata(
                    data,
                    namespace=namespace,
                    agent_name=graph_name,
                )
            elif mode == "updates":
                _emit_update_event(
                    data,
                    namespace=namespace,
                    agent_name=graph_name,
                )
            elif mode == "custom":
                publish_agent_stream_event(
                    "CUSTOM_PROGRESS",
                    agent_name=graph_name,
                    namespace=list(namespace),
                    data=_safe_graph_update(data),
                    status="RUNNING",
                )
    except Exception as error:
        publish_agent_stream_event(
            "AGENT_FAILED",
            agent_name=graph_name,
            status="FAILED",
            text=redact_string(str(error))[:MAX_STREAM_TEXT_CHARS],
            data={"kind": "workflow", "exception_type": type(error).__name__},
        )
        raise

    if not final.seen:
        raise RuntimeError(
            "LCSP streamed workflow completed without a final root values projection"
        )
    publish_agent_stream_event(
        "AGENT_COMPLETED",
        agent_name=graph_name,
        status="COMPLETED",
        data={"kind": "workflow"},
    )
    return final.value

def _emit_message_event(
    data: Any,
    *,
    namespace: tuple[str, ...],
    agent_name: str,
) -> None:
    if not isinstance(data, (tuple, list)) or not data:
        return
    message = data[0]
    metadata = data[1] if len(data) > 1 and isinstance(data[1], dict) else {}
    message_id = _text(getattr(message, "id", None))
    safe_metadata = _message_metadata(metadata)
    session = active_agent_stream.get()

    if isinstance(message, ToolMessage):
        tool_name = _text(getattr(message, "name", None))
        tool_call_id = _text(getattr(message, "tool_call_id", None))
        result_text = _safe_text(getattr(message, "content", ""))
        result_metrics = _tool_result_metrics(
            getattr(message, "content", ""),
            session.tool_started_at.pop(tool_call_id, None) if session else None,
        )
        if result_metrics:
            safe_metadata = {**safe_metadata, "result_metrics": result_metrics}
        publish_agent_stream_event(
            "TOOL_RESULT",
            agent_name=agent_name,
            namespace=list(namespace),
            message_id=message_id,
            tool_name=tool_name,
            tool_call_id=tool_call_id,
            text=result_text,
            data=safe_metadata,
            status="COMPLETED",
        )
        publish_agent_stream_event(
            "SEMANTIC_TOOL_RESULT",
            agent_name=agent_name,
            namespace=list(namespace),
            message_id=message_id,
            tool_name=tool_name,
            tool_call_id=tool_call_id,
            text="tool result completed",
            data=_semantic_payload(
                "TOOL_RESULT",
                durability=DURABLE,
                toolName=tool_name,
                toolCallId=tool_call_id,
                resultSummary={"text": result_text} if result_text else {},
                result_metrics=result_metrics,
                status="COMPLETED",
                **_model_context_from_metadata(safe_metadata),
            ),
            status="COMPLETED",
        )
        return

    if not isinstance(message, AIMessage):
        return

    model_context = _model_context_from_metadata(safe_metadata)
    _emit_model_request_once(
        message,
        namespace=namespace,
        agent_name=agent_name,
        message_id=message_id,
        safe_metadata=safe_metadata,
        model_context=model_context,
    )

    if not isinstance(message, AIMessageChunk):
        # A non-streaming provider call (stream=False) arrives as one complete
        # message. Surface its reasoning, each tool call and its visible output as
        # separate entries instead of dropping the whole step from the stream.
        _emit_complete_model_message(
            message,
            namespace=namespace,
            agent_name=agent_name,
            message_id=message_id,
            safe_metadata=safe_metadata,
            model_context=model_context,
        )
        return

    for tool_call in message.tool_call_chunks or []:
        if not isinstance(tool_call, dict):
            continue
        tool_name = _text(tool_call.get("name"))
        tool_call_id = _text(tool_call.get("id"))
        safe_arguments = _safe_tool_arguments(tool_call.get("args", ""))
        publish_agent_stream_event(
            "TOOL_CALL_DELTA",
            agent_name=agent_name,
            namespace=list(namespace),
            message_id=message_id,
            tool_name=tool_name,
            tool_call_id=tool_call_id,
            text=safe_arguments,
            data={
                **safe_metadata,
                "index": tool_call.get("index"),
            },
            status="RUNNING",
        )
        _record_tool_call_chunk(
            agent_name=agent_name,
            namespace=namespace,
            message_id=message_id,
            tool_name=tool_name,
            tool_call_id=tool_call_id,
            index=tool_call.get("index"),
            args=tool_call.get("args", ""),
            model_context=model_context,
        )

    for kind, text in _content_deltas(message):
        if kind == "MODEL_CONTENT_DELTA":
            _record_model_output_delta(
                message_id=message_id,
                namespace=namespace,
                agent_name=agent_name,
                text=text,
            )
        else:
            _record_model_reasoning_delta(
                message_id=message_id,
                namespace=namespace,
                agent_name=agent_name,
                text=text,
            )
        publish_agent_stream_event(
            kind,
            agent_name=agent_name,
            namespace=list(namespace),
            message_id=message_id,
            text=text,
            data=safe_metadata,
            status="RUNNING",
        )

    finish_reason = _text(safe_metadata.get("finish_reason")) or _text(
        (getattr(message, "response_metadata", None) or {}).get("finish_reason")
    )
    if finish_reason:
        _flush_pending_tool_calls_for_message(
            message_id=message_id,
            namespace=namespace,
            agent_name=agent_name,
        )
        _emit_reasoning_summary(
            _pop_model_reasoning(
                message_id=message_id,
                namespace=namespace,
                agent_name=agent_name,
            ),
            namespace=namespace,
            agent_name=agent_name,
            message_id=message_id,
            model_context=model_context,
        )
        publish_agent_stream_event(
            "MODEL_RESULT",
            agent_name=agent_name,
            namespace=list(namespace),
            node_name=model_context.get("nodeName"),
            message_id=message_id,
            text="model result summary",
            data=_semantic_payload(
                "MODEL_OUTPUT",
                durability=DURABLE,
                requestId=message_id,
                messageId=message_id,
                finishReason=finish_reason,
                usage=_usage_metadata(message, safe_metadata),
                outputRefs=_output_refs(safe_metadata, message_id=message_id),
                resultSummary=_model_result_summary(
                    message,
                    message_id=message_id,
                    namespace=namespace,
                    agent_name=agent_name,
                ),
                status="COMPLETED",
                **model_context,
            ),
            status="COMPLETED",
        )


def _content_deltas(message: AIMessage) -> list[tuple[str, str]]:
    deltas: list[tuple[str, str]] = []
    # OpenAI-compatible reasoning models (MiniMax, GLM, DeepSeek, Qwen via llm7 and
    # similar routes) return provider-visible reasoning beside the content, not in it.
    provider_reasoning = _additional_reasoning_text(message)
    if provider_reasoning:
        deltas.append(("MODEL_REASONING_DELTA", provider_reasoning))

    content = getattr(message, "content", None)
    if isinstance(content, str):
        text = _safe_text(content)
        return [*deltas, ("MODEL_CONTENT_DELTA", text)] if text else deltas
    if not isinstance(content, list):
        return deltas

    for block in content:
        if isinstance(block, str):
            text = _safe_text(block)
            if text:
                deltas.append(("MODEL_CONTENT_DELTA", text))
            continue
        if not isinstance(block, dict):
            continue
        block_type = _text(block.get("type")).lower()
        if "reason" in block_type or "thinking" in block_type:
            # Content blocks carry both a provider summary and raw thinking; only
            # the summary is customer-visible.
            text = _safe_text(
                _reasoning_value_text(
                    block.get("summary")
                    or block.get("summary_text")
                    or block.get("reasoning_summary")
                    or ""
                )
            )
            if text:
                deltas.append(("MODEL_REASONING_DELTA", text))
            continue
        if block_type in {"text", "text_delta", "output_text", "output_text_delta"}:
            text = _safe_text(
                block.get("text") or block.get("content") or block.get("delta") or ""
            )
            if text:
                deltas.append(("MODEL_CONTENT_DELTA", text))
    return deltas


def _additional_reasoning_text(message: Any) -> str:
    kwargs = getattr(message, "additional_kwargs", None)
    if not isinstance(kwargs, dict):
        return ""
    for key in ("reasoning_content", "reasoning"):
        text = _reasoning_value_text(kwargs.get(key))
        if text:
            return _safe_text(text)
    return ""


def _reasoning_value_text(value: Any) -> str:
    """Flatten provider reasoning shapes (text, summary lists, summary dicts)."""
    if isinstance(value, str):
        return value
    if isinstance(value, dict):
        for key in ("text", "summary", "summary_text", "content"):
            text = _reasoning_value_text(value.get(key))
            if text:
                return text
        return ""
    if isinstance(value, (list, tuple)):
        parts = [
            _reasoning_value_text(item)
            for item in list(value)[:MAX_STREAM_COLLECTION_ITEMS]
        ]
        return "\n".join(part for part in parts if part)
    return ""


def _emit_model_request_once(
    message: AIMessage,
    *,
    namespace: tuple[str, ...],
    agent_name: str,
    message_id: str,
    safe_metadata: dict[str, Any],
    model_context: dict[str, Any],
) -> None:
    session = active_agent_stream.get()
    model_request_key = _model_request_key(
        message_id=message_id,
        namespace=namespace,
        agent_name=agent_name,
        model_context=model_context,
    )
    if not model_context or (
        session is not None and model_request_key in session.emitted_model_requests
    ):
        return
    if session is not None:
        session.emitted_model_requests.add(model_request_key)
    publish_agent_stream_event(
        "MODEL_REQUEST",
        agent_name=agent_name,
        namespace=list(namespace),
        node_name=model_context.get("nodeName"),
        message_id=message_id,
        text="model request summary",
        data=_semantic_payload(
            "MODEL_REQUEST",
            durability=DURABLE,
            agentName=agent_name,
            agentRole=agent_name,
            requestId=message_id,
            messageId=message_id,
            availableToolNames=_available_tool_names(
                safe_metadata,
                getattr(message, "tool_call_chunks", None)
                or getattr(message, "tool_calls", None),
            ),
            inputArtifactRefs=_input_artifact_refs(
                safe_metadata,
                message_id=message_id,
                model_context=model_context,
            ),
            promptVersion=_text(safe_metadata.get("prompt_version")),
            **model_context,
        ),
        status="RUNNING",
    )


def _emit_complete_model_message(
    message: AIMessage,
    *,
    namespace: tuple[str, ...],
    agent_name: str,
    message_id: str,
    safe_metadata: dict[str, Any],
    model_context: dict[str, Any],
) -> None:
    deltas = _content_deltas(message)
    reasoning = "\n".join(text for kind, text in deltas if kind == "MODEL_REASONING_DELTA")
    output = "".join(text for kind, text in deltas if kind == "MODEL_CONTENT_DELTA")
    _emit_reasoning_summary(
        reasoning,
        namespace=namespace,
        agent_name=agent_name,
        message_id=message_id,
        model_context=model_context,
    )

    for index, tool_call in enumerate(getattr(message, "tool_calls", None) or []):
        if not isinstance(tool_call, dict):
            continue
        tool_name = _text(tool_call.get("name"))
        tool_call_id = _text(tool_call.get("id"))
        pending = PendingToolCall(
            key=_tool_call_key(
                message_id=message_id,
                namespace=namespace,
                agent_name=agent_name,
                tool_call_id=tool_call_id,
                index=index,
            ),
            agent_name=agent_name,
            namespace=namespace,
            message_id=message_id,
            tool_name=tool_name,
            tool_call_id=tool_call_id,
            request_id=message_id,
            model_context=model_context,
        )
        _emit_completed_tool_call(pending, _safe_value(tool_call.get("args") or {}))

    response_metadata = getattr(message, "response_metadata", None)
    finish_reason = _text(safe_metadata.get("finish_reason")) or (
        _text(response_metadata.get("finish_reason"))
        if isinstance(response_metadata, dict)
        else ""
    )
    publish_agent_stream_event(
        "MODEL_RESULT",
        agent_name=agent_name,
        namespace=list(namespace),
        node_name=model_context.get("nodeName"),
        message_id=message_id,
        text="model result summary",
        data=_semantic_payload(
            "MODEL_OUTPUT",
            durability=DURABLE,
            requestId=message_id,
            messageId=message_id,
            finishReason=finish_reason,
            usage=_usage_metadata(message, safe_metadata),
            outputRefs=_output_refs(safe_metadata, message_id=message_id),
            resultSummary={"text": _safe_text(output)} if output else {},
            status="COMPLETED",
            **model_context,
        ),
        status="COMPLETED",
    )


def _emit_reasoning_summary(
    reasoning: str,
    *,
    namespace: tuple[str, ...],
    agent_name: str,
    message_id: str,
    model_context: dict[str, Any],
) -> None:
    """Publish one reasoning entry per model step, never one per token."""
    text = _safe_text(reasoning).strip()
    if not text:
        return
    if len(text) > MAX_REASONING_SUMMARY_CHARS:
        text = text[:MAX_REASONING_SUMMARY_CHARS].rstrip() + "…"
    publish_agent_stream_event(
        "CUSTOM_PROGRESS",
        agent_name=agent_name,
        namespace=list(namespace),
        node_name=model_context.get("nodeName"),
        message_id=message_id,
        text="provider reasoning summary",
        data=_semantic_payload(
            "REASONING_SUMMARY",
            durability=DURABLE,
            resultSummary={"summary": text},
            status="COMPLETED",
            requestId=message_id,
            messageId=message_id,
            **model_context,
        ),
        status="COMPLETED",
    )


def _emit_update_event(
    data: Any,
    *,
    namespace: tuple[str, ...],
    agent_name: str,
) -> None:
    if not isinstance(data, dict):
        publish_agent_stream_event(
            "GRAPH_UPDATE",
            agent_name=agent_name,
            namespace=list(namespace),
            data=_safe_graph_update(data),
            status="RUNNING",
        )
        return
    for node_name, value in data.items():
        publish_agent_stream_event(
            "GRAPH_UPDATE",
            agent_name=agent_name,
            namespace=list(namespace),
            node_name=str(node_name),
            data=_safe_graph_update(value),
            status="RUNNING",
        )


def _emit_values_metadata(
    value: Any,
    *,
    namespace: tuple[str, ...],
    agent_name: str,
) -> None:
    # ``values`` is used to preserve invoke() return semantics. Only state shape is
    # exposed here; dumping the full state could leak prompts/private context.
    keys = sorted(str(key) for key in value) if isinstance(value, dict) else []
    publish_agent_stream_event(
        "GRAPH_STATE",
        agent_name=agent_name,
        namespace=list(namespace),
        data={"state_fields": keys[:MAX_STREAM_COLLECTION_ITEMS]},
        status="RUNNING",
    )


def _message_metadata(metadata: dict[str, Any]) -> dict[str, Any]:
    allowed = {
        "langgraph_node",
        "langgraph_step",
        "ls_provider",
        "ls_model_name",
        "finish_reason",
        "lcsp_available_tool_names",
        "available_tool_names",
        "tool_names",
        "lcsp_input_artifact_refs",
        "input_artifact_refs",
        "lcsp_output_refs",
        "output_refs",
        "usage",
        "usage_metadata",
        "token_usage",
        "prompt_version",
        "promptVersion",
    }
    return _sanitize_payload(
        {str(key): value for key, value in metadata.items() if str(key) in allowed}
    )


def _record_tool_call_chunk(
    *,
    agent_name: str,
    namespace: tuple[str, ...],
    message_id: str,
    tool_name: str,
    tool_call_id: str,
    index: Any,
    args: Any,
    model_context: dict[str, Any],
) -> None:
    session = active_agent_stream.get()
    if session is None:
        parsed, _complete = _structured_tool_parameters(args)
        publish_agent_stream_event(
            "SEMANTIC_TOOL_CALL",
            agent_name=agent_name,
            namespace=list(namespace),
            message_id=message_id,
            tool_name=tool_name,
            tool_call_id=tool_call_id,
            text="tool call started",
            data=_semantic_payload(
                "TOOL_CALL",
                durability=DURABLE,
                toolName=tool_name,
                toolCallId=tool_call_id,
                parameters=parsed,
                status="RUNNING",
                requestId=message_id,
                messageId=message_id,
                **model_context,
            ),
            status="RUNNING",
        )
        return

    key = _tool_call_key(
        message_id=message_id,
        namespace=namespace,
        agent_name=agent_name,
        tool_call_id=tool_call_id,
        index=index,
    )
    pending = session.pending_tool_calls.get(key)
    if pending is None:
        pending = PendingToolCall(
            key=key,
            agent_name=agent_name,
            namespace=namespace,
            message_id=message_id,
            tool_name=tool_name,
            tool_call_id=tool_call_id,
            request_id=message_id,
            model_context=model_context,
        )
        session.pending_tool_calls[key] = pending
    if tool_name:
        pending.tool_name = tool_name
    if tool_call_id:
        pending.tool_call_id = tool_call_id
    if model_context:
        pending.model_context = model_context
    if isinstance(args, str):
        pending.args += args
    elif args is not None:
        pending.args += str(args)

    parameters, complete = _structured_tool_parameters(pending.args)
    if complete:
        _emit_completed_tool_call(pending, parameters)


def _flush_pending_tool_calls_for_message(
    *,
    message_id: str,
    namespace: tuple[str, ...],
    agent_name: str,
) -> None:
    session = active_agent_stream.get()
    if session is None:
        return
    message_key = _model_request_key(
        message_id=message_id,
        namespace=namespace,
        agent_name=agent_name,
        model_context={},
    )
    for key, pending in list(session.pending_tool_calls.items()):
        pending_message_key = _model_request_key(
            message_id=pending.message_id,
            namespace=pending.namespace,
            agent_name=pending.agent_name,
            model_context={},
        )
        if pending_message_key != message_key:
            continue
        parameters, _complete = _structured_tool_parameters(pending.args)
        _emit_completed_tool_call(pending, parameters)


def _emit_completed_tool_call(
    pending: PendingToolCall,
    parameters: Any,
) -> None:
    session = active_agent_stream.get()
    if session is not None:
        if pending.key in session.emitted_tool_calls:
            return
        session.emitted_tool_calls.add(pending.key)
        if pending.tool_call_id:
            session.tool_started_at[pending.tool_call_id] = time.monotonic()
        session.pending_tool_calls.pop(pending.key, None)
    publish_agent_stream_event(
        "SEMANTIC_TOOL_CALL",
        agent_name=pending.agent_name,
        namespace=list(pending.namespace),
        message_id=pending.message_id,
        tool_name=pending.tool_name,
        tool_call_id=pending.tool_call_id,
        text="tool call started",
        data=_semantic_payload(
            "TOOL_CALL",
            durability=DURABLE,
            toolName=pending.tool_name,
            toolCallId=pending.tool_call_id,
            parameters=parameters,
            status="RUNNING",
            requestId=pending.request_id,
            messageId=pending.message_id,
            **pending.model_context,
        ),
        status="RUNNING",
    )


def _structured_tool_parameters(value: Any) -> tuple[Any, bool]:
    if not isinstance(value, str):
        return _safe_value(value), True
    try:
        parsed = json.loads(value)
    except Exception:
        return {"arguments": _safe_tool_arguments(value)}, False
    return _safe_value(parsed), True


_RESULT_ITEM_KEYS = ("items", "results", "matches", "files", "entries", "nodes")
_RESULT_PARSE_MAX_BYTES = 1_000_000


def _tool_result_metrics(content: Any, started_at: float | None) -> dict[str, Any]:
    """Model-independent size facts of the payload handed to the agent.

    Sizes and counts only: no content, no token numbers.
    """
    metrics: dict[str, Any] = {}
    if started_at is not None:
        metrics["duration_ms"] = max(0, int((time.monotonic() - started_at) * 1000))
    if isinstance(content, str):
        text = content
    else:
        try:
            text = json.dumps(content, default=str, ensure_ascii=False)
        except Exception:
            return metrics
    size = len(text.encode("utf-8", errors="replace"))
    metrics["bytes"] = size
    metrics["lines"] = text.count("\n") + 1 if text else 0
    if text[:1] in "[{" and size <= _RESULT_PARSE_MAX_BYTES:
        try:
            parsed = json.loads(text)
        except Exception:
            parsed = None
        if isinstance(parsed, dict):
            if isinstance(parsed.get("truncated"), bool):
                metrics["truncated"] = parsed["truncated"]
            parsed = next(
                (parsed[k] for k in _RESULT_ITEM_KEYS if isinstance(parsed.get(k), list)),
                None,
            )
        if isinstance(parsed, list):
            metrics["items"] = len(parsed)
    return metrics


def _semantic_payload(kind: str, *, durability: str, **fields: Any) -> dict[str, Any]:
    payload = {
        "schemaVersion": SEMANTIC_SCHEMA_VERSION,
        "kind": kind,
        "durability": durability,
    }
    for key, value in fields.items():
        if value in (None, "", [], {}):
            continue
        payload[key] = value
    return _sanitize_payload(payload)


def _model_context_from_metadata(metadata: dict[str, Any]) -> dict[str, Any]:
    context: dict[str, Any] = {}
    provider = _text(metadata.get("ls_provider"))
    model = _text(metadata.get("ls_model_name"))
    node_name = _text(metadata.get("langgraph_node"))
    if provider:
        context["provider"] = provider
    if model:
        context["model"] = model
    if node_name:
        context["nodeName"] = node_name
        context["goalSummary"] = f"Execute node {node_name}"
    return context


def _model_request_key(
    *,
    message_id: str,
    namespace: tuple[str, ...],
    agent_name: str,
    model_context: dict[str, Any],
) -> str:
    return ":".join(
        [
            agent_name,
            "/".join(namespace),
            message_id,
            _text(model_context.get("nodeName")),
            _text(model_context.get("model")),
        ]
    )


def _model_message_key(
    *,
    message_id: str,
    namespace: tuple[str, ...],
    agent_name: str,
) -> str:
    return ":".join([agent_name, "/".join(namespace), message_id])


def _tool_call_key(
    *,
    message_id: str,
    namespace: tuple[str, ...],
    agent_name: str,
    tool_call_id: str,
    index: Any,
) -> str:
    index_text = (
        str(index)
        if isinstance(index, int) and not isinstance(index, bool)
        else _text(index)
    )
    identity = index_text or tool_call_id or "0"
    return ":".join([agent_name, "/".join(namespace), message_id, identity])


def _record_model_output_delta(
    *,
    message_id: str,
    namespace: tuple[str, ...],
    agent_name: str,
    text: str,
) -> None:
    if not text:
        return
    session = active_agent_stream.get()
    if session is None:
        return
    key = _model_message_key(
        message_id=message_id,
        namespace=namespace,
        agent_name=agent_name,
    )
    chunks = session.model_output_chunks.setdefault(key, [])
    current_length = sum(len(chunk) for chunk in chunks)
    remaining = MAX_STREAM_TEXT_CHARS - current_length
    if remaining <= 0:
        return
    chunks.append(text[:remaining])


def _record_model_reasoning_delta(
    *,
    message_id: str,
    namespace: tuple[str, ...],
    agent_name: str,
    text: str,
) -> None:
    session = active_agent_stream.get()
    if session is None or not text:
        return
    key = _model_message_key(
        message_id=message_id,
        namespace=namespace,
        agent_name=agent_name,
    )
    chunks = session.model_reasoning_chunks.setdefault(key, [])
    remaining = MAX_REASONING_SUMMARY_CHARS - sum(len(chunk) for chunk in chunks)
    if remaining > 0:
        chunks.append(text[:remaining])


def _pop_model_reasoning(
    *,
    message_id: str,
    namespace: tuple[str, ...],
    agent_name: str,
) -> str:
    session = active_agent_stream.get()
    if session is None:
        return ""
    key = _model_message_key(
        message_id=message_id,
        namespace=namespace,
        agent_name=agent_name,
    )
    return "".join(session.model_reasoning_chunks.pop(key, []))


def _available_tool_names(
    metadata: dict[str, Any],
    tool_call_chunks: Any,
) -> list[str]:
    for key in ("lcsp_available_tool_names", "available_tool_names", "tool_names"):
        names = _string_list(metadata.get(key))
        if names:
            return names
    return _bound_tool_names(tool_call_chunks)


def _bound_tool_names(tool_call_chunks: Any) -> list[str]:
    if not isinstance(tool_call_chunks, list):
        return []
    names: list[str] = []
    for item in tool_call_chunks[:MAX_STREAM_COLLECTION_ITEMS]:
        if isinstance(item, dict):
            name = _text(item.get("name"))
            if name and name not in names:
                names.append(name)
    return names


def _input_artifact_refs(
    metadata: dict[str, Any],
    *,
    message_id: str,
    model_context: dict[str, Any],
) -> list[str]:
    for key in ("lcsp_input_artifact_refs", "input_artifact_refs"):
        refs = _string_list(metadata.get(key))
        if refs:
            return refs
    node_name = _text(model_context.get("nodeName"))
    if node_name:
        return [f"langgraph-node:{node_name}"]
    if message_id:
        return [f"message:{message_id}:input"]
    return []


def _output_refs(metadata: dict[str, Any], *, message_id: str) -> list[str]:
    for key in ("lcsp_output_refs", "output_refs"):
        refs = _string_list(metadata.get(key))
        if refs:
            return refs
    return [f"message:{message_id}:output"] if message_id else []


def _usage_metadata(message: Any, metadata: dict[str, Any]) -> Any:
    candidates = [
        getattr(message, "usage_metadata", None),
        metadata.get("usage_metadata"),
        metadata.get("usage"),
        metadata.get("token_usage"),
    ]
    response_metadata = getattr(message, "response_metadata", None)
    if isinstance(response_metadata, dict):
        candidates.extend(
            [
                response_metadata.get("usage_metadata"),
                response_metadata.get("usage"),
                response_metadata.get("token_usage"),
            ]
        )
    for candidate in candidates:
        if candidate:
            return _safe_value(candidate)
    return {}


def _model_result_summary(
    message: AIMessageChunk,
    *,
    message_id: str,
    namespace: tuple[str, ...],
    agent_name: str,
) -> Any:
    session = active_agent_stream.get()
    if session is not None:
        key = _model_message_key(
            message_id=message_id,
            namespace=namespace,
            agent_name=agent_name,
        )
        chunks = session.model_output_chunks.pop(key, [])
        if chunks:
            return {"text": _safe_text("".join(chunks))}
    content = getattr(message, "content", None)
    if isinstance(content, str):
        text = _safe_text(content)
        return {"text": text} if text else {}
    if isinstance(content, list):
        text_parts: list[str] = []
        for kind, text in _content_deltas(message):
            if kind == "MODEL_CONTENT_DELTA" and text:
                text_parts.append(text)
        if text_parts:
            return {"text": _safe_text("".join(text_parts))}
    return {}


def _string_list(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    output: list[str] = []
    for item in value[:MAX_STREAM_COLLECTION_ITEMS]:
        item_text = _text(item)
        if item_text and item_text not in output:
            output.append(item_text)
    return output


def _safe_graph_update(value: Any, *, depth: int = MAX_STREAM_DEPTH) -> Any:
    """Keep useful workflow output while excluding prompts/messages/private reasoning state."""
    if depth <= 0:
        return {"truncated": "max_depth"}
    if isinstance(value, dict):
        output: dict[str, Any] = {}
        for key, item in list(value.items())[:MAX_STREAM_COLLECTION_ITEMS]:
            key_text = str(key)
            if _private_graph_key(key_text):
                output[key_text] = {"hidden": "private_runtime_state"}
                continue
            output[key_text] = _safe_graph_update(item, depth=depth - 1)
        return output
    if isinstance(value, (list, tuple)):
        return [
            _safe_graph_update(item, depth=depth - 1)
            for item in value[:MAX_STREAM_COLLECTION_ITEMS]
        ]
    return _safe_value(value, depth=depth)

def _private_graph_key(key: str) -> bool:
    normalized = "".join(character for character in key.lower() if character.isalnum())
    return normalized in PRIVATE_GRAPH_KEYS


def _safe_value(value: Any, *, depth: int = MAX_STREAM_DEPTH) -> Any:
    if depth <= 0:
        return {"truncated": "max_depth"}
    if value is None or isinstance(value, (bool, int, float)):
        return value
    if isinstance(value, str):
        return redact_string(value)[:MAX_STREAM_TEXT_CHARS]
    if isinstance(value, dict):
        items = list(value.items())[:MAX_STREAM_COLLECTION_ITEMS]
        return {
            str(key): _safe_value(item, depth=depth - 1)
            for key, item in items
        }
    if isinstance(value, (list, tuple)):
        return [
            _safe_value(item, depth=depth - 1)
            for item in value[:MAX_STREAM_COLLECTION_ITEMS]
        ]
    if hasattr(value, "model_dump"):
        try:
            return _safe_value(value.model_dump(), depth=depth - 1)
        except Exception:
            pass
    if hasattr(value, "content"):
        return {
            "type": type(value).__name__,
            "content": _safe_value(getattr(value, "content", None), depth=depth - 1),
        }
    return redact_string(str(value))[:MAX_STREAM_TEXT_CHARS]


def _sanitize_payload(payload: dict[str, Any]) -> dict[str, Any]:
    safe = _safe_value(payload)
    redacted = redact_dict(safe)
    # redact_dict blanks any key with a "token" segment (reasoning_tokens, ...).
    # Provider usage counters are numeric-only, so restore them after re-validation.
    data = safe.get("data") if isinstance(safe, dict) else None
    # Only the model-call completion event carries trusted provider usage; graph/tool
    # authored `usage` keys on any other event are ordinary (redacted) data.
    usage = (
        _trusted_usage(data.get("usage"))
        if isinstance(data, dict) and safe.get("event_type") == "MODEL_CALL_COMPLETED"
        else None
    )
    if usage is not None and isinstance(redacted.get("data"), dict):
        redacted["data"]["usage"] = usage
    return redacted


_USAGE_METRIC_KEY = re.compile(r"^[a-z][a-z0-9_]{0,47}$")


def _usage_number(value: Any) -> bool:
    return (
        isinstance(value, (int, float))
        and not isinstance(value, bool)
        and math.isfinite(value)
        and value >= 0
    )


def _trusted_usage(usage: Any) -> dict[str, Any] | None:
    if not isinstance(usage, dict):
        return None
    out: dict[str, Any] = {}
    for key in ("input_tokens", "output_tokens", "total_tokens"):
        if _usage_number(usage.get(key)):
            out[key] = usage[key]
    details = usage.get("details")
    if isinstance(details, dict):
        clean = {
            k: v
            for k, v in list(details.items())[:24]
            if isinstance(k, str) and _USAGE_METRIC_KEY.match(k) and _usage_number(v)
        }
        if clean:
            out["details"] = clean
    return out or None


def _is_durable_stream_payload(payload: dict[str, Any]) -> bool:
    data = payload.get("data")
    return isinstance(data, dict) and data.get("durability") == DURABLE


CRITICAL_STREAM_EVENT_TYPES = frozenset(
    {
        "BOUNDARY_STARTED",
        "BOUNDARY_COMPLETED",
        "BOUNDARY_FAILED",
        "BOUNDARY_PAUSED",
        "AGENT_STARTED",
        "AGENT_COMPLETED",
        "AGENT_FAILED",
        "MODEL_CALL_STARTED",
        "MODEL_CALL_COMPLETED",
        "MODEL_CALL_FAILED",
        "MODEL_CALL_TIMEOUT",
        "PROVIDER_FALLBACK",
        "CREDENTIAL_ROTATION",
    }
)


def _is_critical_stream_payload(payload: dict[str, Any]) -> bool:
    return _is_durable_stream_payload(payload) or payload.get(
        "event_type"
    ) in CRITICAL_STREAM_EVENT_TYPES


def _safe_tool_arguments(value: Any) -> str:
    text = value if isinstance(value, str) else str(value)
    lowered = text.lower()
    sensitive_markers = (
        "api_key",
        "api-key",
        "authorization",
        "credential",
        "password",
        "secret",
        "token",
    )
    if any(marker in lowered for marker in sensitive_markers):
        return "[redacted tool arguments]"
    return _safe_text(text)



def _safe_text(value: Any) -> str:
    if isinstance(value, str):
        return redact_string(value)[:MAX_STREAM_TEXT_CHARS]
    safe = _safe_value(value)
    return redact_string(str(safe))[:MAX_STREAM_TEXT_CHARS]


def _namespace(value: Any) -> tuple[str, ...]:
    if not isinstance(value, (list, tuple)):
        return ()
    return tuple(str(item) for item in value[:MAX_STREAM_COLLECTION_ITEMS])


def _text(value: Any) -> str:
    return value.strip() if isinstance(value, str) else ""


def _should_forward_stream_log(record: logging.LogRecord) -> bool:
    """Keep customer-visible runtime logs high signal without hiding failures."""
    message = record.getMessage()
    if any(marker in message for marker in NOISY_STREAM_LOG_MARKERS):
        return False
    if record.levelno >= logging.WARNING:
        return True
    if record.levelno < logging.INFO:
        return False
    logger_name = record.name.lower()
    return not any(
        logger_name == prefix or logger_name.startswith(f"{prefix}.")
        for prefix in NOISY_STREAM_LOGGER_PREFIXES
    )


class AgentStreamLogHandler(logging.Handler):
    """Forward high-signal Python logs emitted inside an active agent boundary."""

    def emit(self, record: logging.LogRecord) -> None:
        if active_agent_stream.get() is None or _emitting_stream_event.get():
            return
        if not _should_forward_stream_log(record):
            return
        try:
            publish_agent_stream_event(
                "LOG",
                text=redact_string(record.getMessage())[:MAX_STREAM_TEXT_CHARS],
                data={
                    "level": record.levelname,
                    "logger": record.name,
                },
                status=(
                    "FAILED"
                    if record.levelno >= logging.ERROR
                    else "RUNNING"
                ),
            )
        except Exception:
            # Logging must never change agent runtime semantics.
            return


def install_agent_stream_log_handler() -> None:
    """Install one process-wide ContextVar-aware log bridge."""
    root = logging.getLogger()
    if any(isinstance(handler, AgentStreamLogHandler) for handler in root.handlers):
        return
    root.addHandler(AgentStreamLogHandler())


__all__ = [
    "AGENT_STREAM_STAGES",
    "AgentStreamInterrupted",
    "AgentStreamRuleScope",
    "AgentStreamSession",
    "BufferedAgentStreamEmitter",
    "activate_agent_stream",
    "active_agent_stream",
    "active_agent_stream_cancel",
    "active_agent_stream_rule",
    "active_agent_stream_stage",
    "agent_stream_rule_scope",
    "agent_stream_stage",
    "install_agent_stream_log_handler",
    "invoke_graph_with_stream",
    "invoke_with_stream",
    "publish_agent_stream_event",
]
