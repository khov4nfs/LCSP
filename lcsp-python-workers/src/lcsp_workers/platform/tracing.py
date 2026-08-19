"""Phoenix tracing module for OpenTelemetry tracing."""

import functools
import os
from typing import Any, Callable

_ENABLE_TRACING = os.getenv("PHOENIX_TRACING", "false").lower() in ("true", "1") or os.getenv("LOCAL_TRACING", "false").lower() in ("true", "1")

_tracer = None
if _ENABLE_TRACING:
    try:
        from openinference.instrumentation.langchain import LangChainInstrumentor
        from openinference.instrumentation.openai import OpenAIInstrumentor
        from opentelemetry import trace
        from phoenix.otel import register

        register(
            project_name="lcsp-python-workers",
            endpoint=os.getenv("PHOENIX_COLLECTOR_ENDPOINT", "http://localhost:6006/v1/traces"),
        )
        try:
            LangChainInstrumentor().instrument()
            OpenAIInstrumentor().instrument()
        except Exception:
            pass
        _tracer = trace.get_tracer("lcsp_workers")
    except Exception:
        _tracer = None


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
                with _tracer.start_as_current_span(target_name) as span:
                    if run_type:
                        span.set_attribute("openinference.span.kind", run_type.upper())
                    if metadata:
                        for k, v in metadata.items():
                            span.set_attribute(f"metadata.{k}", str(v))
                    return func(*w_args, **w_kwargs)
            return func(*w_args, **w_kwargs)

        return wrapper

    return decorator


def get_current_run_tree() -> Any:
    return None


__all__ = ["traceable", "get_current_run_tree"]
