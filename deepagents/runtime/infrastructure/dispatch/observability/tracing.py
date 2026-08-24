"""Phoenix tracing module for OpenTelemetry tracing."""

import functools
import json
import logging
import os
import threading
from typing import Any, Callable

from tools.common.platform.config import load_tracing_config
from tools.common.platform.redaction import redact_string

logger = logging.getLogger(__name__)
_tracer = None
_tracer_lock = threading.Lock()
_tracing_registered = False


def _initialize_tracer() -> Any:
    """Initialize Phoenix tracing when enabled by worker configuration."""
    global _tracing_registered
    try:
        config = load_tracing_config()
        if not config.enabled:
            return None

        with _tracer_lock:
            from opentelemetry import trace

            if not _tracing_registered:
                from phoenix.otel import register

                register(
                    project_name=config.project_name,
                    endpoint=config.collector_endpoint,
                    batch=True,
                    verbose=False,
                )
                _instrument_optional_openinference_packages()
                _tracing_registered = True
            return trace.get_tracer("lcsp_managed_deep_agent")
    except Exception as exc:
        logger.warning("Phoenix tracing initialization failed", exc_info=exc)
        return None


def traceable(
    name: str | None = None,
    run_type: str | None = None,
    metadata: dict[str, Any] | None = None,
    *args: Any,
    **kwargs: Any,
) -> Callable[[Callable[..., Any]], Callable[..., Any]]:
    """Traceable decorator sending spans directly to Phoenix UI at http://localhost:6006."""

    def decorator(func: Callable[..., Any]) -> Callable[..., Any]:
        target_name = name or func.__name__

        @functools.wraps(func)
        def wrapper(*w_args: Any, **w_kwargs: Any) -> Any:
            if _tracer is not None:
                if _current_span_is_valid():
                    return _run_traced_call(
                        func=func,
                        target_name=target_name,
                        run_type=run_type,
                        metadata=metadata,
                        w_args=w_args,
                        w_kwargs=w_kwargs,
                    )

                with _tracer.start_as_current_span(
                    _parent_span_name(w_kwargs)
                ) as parent_span:
                    parent_span.set_attribute("openinference.span.kind", "CHAIN")
                    _set_parent_span_attributes(parent_span, w_kwargs)
                    try:
                        result = _run_traced_call(
                            func=func,
                            target_name=target_name,
                            run_type=run_type,
                            metadata=metadata,
                            w_args=w_args,
                            w_kwargs=w_kwargs,
                        )
                        _set_span_status(parent_span, "ok")
                        return result
                    except Exception as exc:
                        _set_span_status(parent_span, "error", str(exc))
                        raise
            return func(*w_args, **w_kwargs)

        return wrapper

    return decorator


def _run_traced_call(
    *,
    func: Callable[..., Any],
    target_name: str,
    run_type: str | None,
    metadata: dict[str, Any] | None,
    w_args: tuple[Any, ...],
    w_kwargs: dict[str, Any],
) -> Any:
    with _tracer.start_as_current_span(target_name) as span:
        if run_type:
            span.set_attribute("openinference.span.kind", run_type.upper())
        if metadata:
            for k, v in metadata.items():
                span.set_attribute(f"metadata.{k}", str(v))
        _set_common_span_attributes(span, w_args, w_kwargs)
        try:
            result = func(*w_args, **w_kwargs)
            _set_output_span_attributes(span, result)
            _set_span_status(span, "ok")
            return result
        except Exception as exc:
            _set_span_status(span, "error", str(exc), exception=exc)
            raise


def _current_span_is_valid() -> bool:
    try:
        from opentelemetry import trace

        context = trace.get_current_span().get_span_context()
        return bool(getattr(context, "is_valid", False))
    except Exception:
        return False


def _parent_span_name(kwargs: dict[str, Any]) -> str:
    workflow_run_id = kwargs.get("workflow_run_id")
    node_name = kwargs.get("node_name")
    if workflow_run_id and node_name:
        return f"lcsp.workflow:{node_name}"
    if workflow_run_id:
        return "lcsp.workflow"
    correlation_id = kwargs.get("correlationId")
    if correlation_id:
        return "lcsp.request"
    return "lcsp.worker"


def _set_parent_span_attributes(span: Any, kwargs: dict[str, Any]) -> None:
    for key in ("workflow_run_id", "node_name", "correlationId"):
        value = kwargs.get(key)
        if value is not None:
            span.set_attribute(f"metadata.{key}", str(value))


def _set_common_span_attributes(
    span: Any,
    args: tuple[Any, ...],
    kwargs: dict[str, Any],
) -> None:
    """Attach Phoenix-visible LLM metadata and request input."""
    if args:
        instance = args[0]
        provider = getattr(instance, "provider", None)
        model = getattr(instance, "model", None)
        if provider:
            span.set_attribute("llm.provider", str(provider))
            span.set_attribute("metadata.ls_provider", str(provider))
        if model:
            span.set_attribute("llm.model_name", str(model))
            span.set_attribute("metadata.ls_model_name", str(model))

    for key in ("workflow_run_id", "node_name", "correlationId"):
        value = kwargs.get(key)
        if value is not None:
            span.set_attribute(f"metadata.{key}", str(value))

    tools = kwargs.get("tools")
    if isinstance(tools, list):
        span.set_attribute("llm.tool_count", len(tools))
        span.set_attribute(
            "llm.tool_names",
            ",".join(str(getattr(tool, "name", "")) for tool in tools),
        )

    prompt = _extract_prompt(args, kwargs)
    if prompt is not None:
        prompt_text = redact_string(str(prompt))
        span.set_attribute("input.mime_type", "text/plain")
        span.set_attribute("input.value", prompt_text)
        span.set_attribute("llm.input_messages.0.message.role", "user")
        span.set_attribute("llm.input_messages.0.message.content", prompt_text)


def _extract_prompt(args: tuple[Any, ...], kwargs: dict[str, Any]) -> Any | None:
    if "prompt" in kwargs:
        return kwargs["prompt"]
    if len(args) >= 2:
        return args[1]
    return None


def _set_output_span_attributes(span: Any, result: Any) -> None:
    content = getattr(result, "content", None)
    tool_calls = getattr(result, "tool_calls", None)
    if content:
        output_value = str(content)
    elif tool_calls:
        output_value = json.dumps(
            [
                {
                    "name": getattr(call, "name", None),
                    "arguments": getattr(call, "arguments", None),
                    "call_id": getattr(call, "call_id", None),
                }
                for call in tool_calls
            ],
            ensure_ascii=False,
        )
    else:
        output_value = None

    if output_value is not None:
        output_value = redact_string(output_value)
        span.set_attribute("output.mime_type", "text/plain")
        span.set_attribute("output.value", output_value)

    input_tokens = getattr(result, "input_tokens", None)
    output_tokens = getattr(result, "output_tokens", None)
    if input_tokens is not None:
        span.set_attribute("llm.token_count.prompt", int(input_tokens))
    if output_tokens is not None:
        span.set_attribute("llm.token_count.completion", int(output_tokens))


def _set_span_status(
    span: Any,
    status: str,
    description: str | None = None,
    *,
    exception: Exception | None = None,
) -> None:
    try:
        from opentelemetry.trace import Status, StatusCode

        if exception is not None:
            span.record_exception(exception)
        if status == "ok":
            span.set_status(Status(StatusCode.OK))
            return
        span.set_status(Status(StatusCode.ERROR, description or "error"))
    except Exception:
        pass


def _instrument_optional_openinference_packages() -> None:
    """Enable provider auto-instrumentation when optional packages are installed."""
    try:
        from openinference.instrumentation.langchain import LangChainInstrumentor

        LangChainInstrumentor().instrument()
    except Exception:
        logger.debug("LangChain OpenInference instrumentation is unavailable")

    try:
        from openinference.instrumentation.openai import OpenAIInstrumentor

        OpenAIInstrumentor().instrument()
    except Exception:
        logger.debug("OpenAI OpenInference instrumentation is unavailable")


def get_current_run_tree() -> Any:
    return None


_tracer = _initialize_tracer()


__all__ = ["traceable", "get_current_run_tree"]
