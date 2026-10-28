"""Exercise the installed telemetry stack without exporters or network access."""
import subprocess
import sys

from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter
from opentelemetry.trace import get_current_span
from opentelemetry.trace.propagation.tracecontext import TraceContextTextMapPropagator


def test_oversized_tracestate_parsing_is_bounded():
    subprocess.run([sys.executable, "-c", """
import logging
from opentelemetry.trace import TraceState
logging.disable(logging.CRITICAL)
for whitespace in (' ', '\\t'):
    assert not TraceState.from_header(['a=b' + whitespace * 500_000 + 'x'])
"""], check=True, timeout=5, capture_output=True)


def test_valid_context_propagation_and_local_span_export_remain_compatible():
    carrier = {"traceparent": "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01",
               "tracestate": "vendor=valid, other=value"}
    context = TraceContextTextMapPropagator().extract(carrier)
    parent = get_current_span(context).get_span_context()
    assert dict(parent.trace_state.items()) == {"vendor": "valid", "other": "value"}
    exporter = InMemorySpanExporter()
    provider = TracerProvider()
    provider.add_span_processor(SimpleSpanProcessor(exporter))
    try:
        with provider.get_tracer(__name__).start_as_current_span("offline", context=context):
            pass
        span, = exporter.get_finished_spans()
        assert span.context.trace_id == parent.trace_id and span.parent.span_id == parent.span_id
    finally:
        provider.shutdown()
