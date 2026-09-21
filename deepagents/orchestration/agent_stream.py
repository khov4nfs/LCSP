"""Bridge LangGraph/Deep Agents streaming events into the LCSP live chat runtime.

The bridge deliberately exposes only provider/framework-visible streaming content.
It never synthesizes or exposes hidden chain-of-thought. All payloads are bounded
and credential-redacted before they leave the worker process.
"""

from __future__ import annotations

import logging
import json
from queue import Full, Queue
from threading import Event, Thread
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Callable, Iterator
from uuid import uuid4

from langchain_core.messages import AIMessageChunk, ToolMessage

from middleware.redaction import redact_dict, redact_string


MAX_STREAM_TEXT_CHARS = 65_536
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
        self._close_timeout_seconds = max(0.0, close_timeout_seconds)
        self._stop = Event()
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
        try:
            self._queue.put_nowait(payload)
        except Full:
            if _is_durable_stream_payload(payload):
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
        if self._thread.is_alive():
            self._stop.set()
            try:
                self._queue.put_nowait(None)
            except Full:
                pass

    def _run(self) -> None:
        while not self._stop.is_set():
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


@dataclass
class AgentStreamSession:
    """Per-boundary live-stream context bound to one customer-visible run."""

    assessment_id: str
    run_id: str
    correlation_id: str
    boundary_name: str
    emit_payload: Callable[[dict[str, Any]], None]
    sequence: int = field(default=0, init=False)
    emitted_model_requests: set[str] = field(default_factory=set, init=False)
    model_output_chunks: dict[str, list[str]] = field(
        default_factory=dict,
        init=False,
    )
    pending_tool_calls: dict[str, "PendingToolCall"] = field(
        default_factory=dict,
        init=False,
    )
    emitted_tool_calls: set[str] = field(default_factory=set, init=False)

    def emit(self, event_type: str, **fields: Any) -> None:
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


active_agent_stream: ContextVar[AgentStreamSession | None] = ContextVar(
    "active_agent_stream", default=None
)
_emitting_stream_event: ContextVar[bool] = ContextVar(
    "emitting_agent_stream_event", default=False
)


@contextmanager
def activate_agent_stream(session: AgentStreamSession | None) -> Iterator[None]:
    """Bind a live-stream session to the current boundary execution context."""
    token = active_agent_stream.set(session)
    try:
        yield
    finally:
        try:
            closer = getattr(session.emit_payload, "close", None) if session is not None else None
            if callable(closer):
                closer()
        finally:
            active_agent_stream.reset(token)


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


def invoke_with_stream(
    agent: Any,
    input_value: Any,
    *,
    config: Any | None = None,
    context: Any | None = None,
    agent_name: str | None = None,
) -> Any:
    """Invoke one LangGraph/Deep Agent while forwarding its v2 multi-mode stream.

    The final ``values`` projection is returned so existing business code receives
    the same final graph state it previously obtained from ``invoke``.
    """
    session = active_agent_stream.get()
    if session is None or not callable(getattr(agent, "stream", None)):
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

    final_value: Any = None
    saw_values = False
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
            if not isinstance(chunk, dict):
                continue
            mode = _text(chunk.get("type"))
            namespace = _namespace(chunk.get("ns"))
            data = chunk.get("data")
            if mode == "values":
                if not namespace:
                    final_value = data
                    saw_values = True
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

    if not saw_values:
        raise RuntimeError(
            "LCSP streamed agent invocation completed without a final values projection"
        )

    publish_agent_stream_event(
        "AGENT_COMPLETED",
        agent_name=resolved_name,
        status="COMPLETED",
    )
    return final_value



def invoke_graph_with_stream(
    graph: Any,
    input_value: Any,
    *,
    config: Any | None = None,
    graph_name: str = "workflow",
) -> Any:
    """Run a LangGraph workflow with live node/custom/state events and preserve invoke semantics."""
    if active_agent_stream.get() is None or not callable(getattr(graph, "stream", None)):
        if config is None:
            return graph.invoke(input_value)
        return graph.invoke(input_value, config)

    final_value: Any = None
    saw_values = False
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
            if not isinstance(chunk, dict):
                continue
            mode = _text(chunk.get("type"))
            namespace = _namespace(chunk.get("ns"))
            data = chunk.get("data")
            if mode == "values":
                if not namespace:
                    final_value = data
                    saw_values = True
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

    if not saw_values:
        raise RuntimeError(
            "LCSP streamed workflow completed without a final root values projection"
        )
    publish_agent_stream_event(
        "AGENT_COMPLETED",
        agent_name=graph_name,
        status="COMPLETED",
        data={"kind": "workflow"},
    )
    return final_value

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
                status="COMPLETED",
                **_model_context_from_metadata(safe_metadata),
            ),
            status="COMPLETED",
        )
        return

    if not isinstance(message, AIMessageChunk):
        return

    model_context = _model_context_from_metadata(safe_metadata)
    model_request_key = _model_request_key(
        message_id=message_id,
        namespace=namespace,
        agent_name=agent_name,
        model_context=model_context,
    )
    if model_context and (
        session is None or model_request_key not in session.emitted_model_requests
    ):
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
                    getattr(message, "tool_call_chunks", None),
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
        publish_agent_stream_event(
            kind,
            agent_name=agent_name,
            namespace=list(namespace),
            message_id=message_id,
            text=text,
            data=safe_metadata,
            status="RUNNING",
        )
        if kind == "MODEL_REASONING_DELTA":
            publish_agent_stream_event(
                "CUSTOM_PROGRESS",
                agent_name=agent_name,
                namespace=list(namespace),
                message_id=message_id,
                text="provider reasoning summary",
                data=_semantic_payload(
                    "REASONING_SUMMARY",
                    durability=BEST_EFFORT,
                    resultSummary={"summary": text},
                    status="RUNNING",
                    requestId=message_id,
                    messageId=message_id,
                    **model_context,
                ),
                status="RUNNING",
            )

    finish_reason = _text(safe_metadata.get("finish_reason"))
    if finish_reason:
        _flush_pending_tool_calls_for_message(
            message_id=message_id,
            namespace=namespace,
            agent_name=agent_name,
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


def _content_deltas(message: AIMessageChunk) -> list[tuple[str, str]]:
    content = getattr(message, "content", None)
    if isinstance(content, str):
        text = _safe_text(content)
        return [("MODEL_CONTENT_DELTA", text)] if text else []
    if not isinstance(content, list):
        return []

    deltas: list[tuple[str, str]] = []
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
            text = _safe_text(
                block.get("summary")
                or block.get("summary_text")
                or block.get("reasoning_summary")
                or ""
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
    return redact_dict(_safe_value(payload))


def _is_durable_stream_payload(payload: dict[str, Any]) -> bool:
    data = payload.get("data")
    return isinstance(data, dict) and data.get("durability") == DURABLE


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


class AgentStreamLogHandler(logging.Handler):
    """Forward normal Python logs emitted inside an active agent boundary."""

    def emit(self, record: logging.LogRecord) -> None:
        if active_agent_stream.get() is None or _emitting_stream_event.get():
            return
        try:
            publish_agent_stream_event(
                "LOG",
                text=redact_string(record.getMessage())[:MAX_STREAM_TEXT_CHARS],
                data={
                    "level": record.levelname,
                    "logger": record.name,
                },
                status="RUNNING",
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
    "AgentStreamSession",
    "BufferedAgentStreamEmitter",
    "activate_agent_stream",
    "active_agent_stream",
    "install_agent_stream_log_handler",
    "invoke_graph_with_stream",
    "invoke_with_stream",
    "publish_agent_stream_event",
]
