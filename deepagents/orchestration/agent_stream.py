"""Bridge LangGraph/Deep Agents streaming events into the LCSP live chat runtime.

The bridge deliberately exposes only provider/framework-visible streaming content.
It never synthesizes or exposes hidden chain-of-thought. All payloads are bounded
and credential-redacted before they leave the worker process.
"""

from __future__ import annotations

import logging
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

    if isinstance(message, ToolMessage):
        publish_agent_stream_event(
            "TOOL_RESULT",
            agent_name=agent_name,
            namespace=list(namespace),
            message_id=message_id,
            tool_name=_text(getattr(message, "name", None)),
            tool_call_id=_text(getattr(message, "tool_call_id", None)),
            text=_safe_text(getattr(message, "content", "")),
            data=safe_metadata,
            status="COMPLETED",
        )
        return

    if not isinstance(message, AIMessageChunk):
        return

    for tool_call in message.tool_call_chunks or []:
        if not isinstance(tool_call, dict):
            continue
        publish_agent_stream_event(
            "TOOL_CALL_DELTA",
            agent_name=agent_name,
            namespace=list(namespace),
            message_id=message_id,
            tool_name=_text(tool_call.get("name")),
            tool_call_id=_text(tool_call.get("id")),
            text=_safe_tool_arguments(tool_call.get("args", "")),
            data={
                **safe_metadata,
                "index": tool_call.get("index"),
            },
            status="RUNNING",
        )

    for kind, text in _content_deltas(message):
        publish_agent_stream_event(
            kind,
            agent_name=agent_name,
            namespace=list(namespace),
            message_id=message_id,
            text=text,
            data=safe_metadata,
            status="RUNNING",
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
    }
    return _sanitize_payload(
        {str(key): value for key, value in metadata.items() if str(key) in allowed}
    )



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
