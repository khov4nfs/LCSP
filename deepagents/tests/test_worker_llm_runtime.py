from __future__ import annotations

import sys
from types import ModuleType, SimpleNamespace
from unittest.mock import patch

from tools.common.capabilities.platform import tracing as tracing_module
from tools.common.capabilities.platform.config import (
    AgenticRuntimeConfig,
    PbacPreflightConfig,
    WorkerConfig,
    load_config,
    load_tracing_config,
)
from tools.common.capabilities.managed.boundary import AgentBoundaryBase
from tools.common.capabilities.managed.invocation import build_boundary


def _base_env(monkeypatch) -> None:
    monkeypatch.setenv("NESTJS_API_BASE_URL", "http://api.test")
    monkeypatch.setenv("WORKER_API_KEY", "worker-test-key")


def _worker_config() -> WorkerConfig:
    return WorkerConfig(
        nestjs_api_base_url="http://api.test",
        worker_api_key="worker-test-key",
        log_level="INFO",
        max_retries=3,
        agentic_runtime=AgenticRuntimeConfig(),
        pbac_preflight=PbacPreflightConfig(),
    )


class _FakeSpan:
    def __init__(self, name: str):
        self.name = name
        self.attributes: dict[str, object] = {}
        self.exceptions: list[Exception] = []

    def set_attribute(self, key: str, value: object) -> None:
        self.attributes[key] = value

    def record_exception(self, exc: Exception) -> None:
        self.exceptions.append(exc)

    def set_status(self, status: object) -> None:
        self.attributes["status"] = status


class _FakeSpanContext:
    def __init__(self, tracer: "_FakeTracer", name: str):
        self.tracer = tracer
        self.span = _FakeSpan(name)

    def __enter__(self) -> _FakeSpan:
        self.tracer.spans.append(self.span)
        return self.span

    def __exit__(self, exc_type, exc, tb) -> bool:
        return False


class _FakeTracer:
    def __init__(self):
        self.spans: list[_FakeSpan] = []

    def start_as_current_span(self, name: str) -> _FakeSpanContext:
        return _FakeSpanContext(self, name)


def test_load_config_does_not_create_a_legacy_provider_chain(monkeypatch) -> None:
    _base_env(monkeypatch)

    config = load_config()

    assert not hasattr(config, "llm_runtime")


def test_load_config_parses_tracing_settings(monkeypatch) -> None:
    _base_env(monkeypatch)
    monkeypatch.setenv("PHOENIX_TRACING", "true")
    monkeypatch.setenv("PHOENIX_PROJECT", "lcsp-fogewise-workers")
    monkeypatch.setenv(
        "PHOENIX_COLLECTOR_ENDPOINT",
        "http://phoenix.test/v1/traces",
    )

    config = load_config()

    assert config.tracing.enabled is True
    assert config.tracing.project_name == "lcsp-fogewise-workers"
    assert config.tracing.collector_endpoint == "http://phoenix.test/v1/traces"


def test_load_tracing_config_does_not_require_worker_env(monkeypatch) -> None:
    monkeypatch.delenv("NESTJS_API_BASE_URL", raising=False)
    monkeypatch.delenv("WORKER_API_KEY", raising=False)
    monkeypatch.delenv("PHOENIX_PROJECT", raising=False)
    monkeypatch.setenv("LOCAL_TRACING", "1")
    monkeypatch.setenv(
        "PHOENIX_COLLECTOR_ENDPOINT",
        "http://localhost:6006/v1/traces",
    )

    config = load_tracing_config()

    assert config.enabled is True
    assert config.project_name == "deepagents"
    assert config.collector_endpoint == "http://localhost:6006/v1/traces"


def test_initialize_tracer_registers_batch_silent_phoenix_once(monkeypatch) -> None:
    calls = []
    phoenix_module = ModuleType("phoenix")
    phoenix_otel_module = ModuleType("phoenix.otel")
    opentelemetry_module = ModuleType("opentelemetry")
    trace_module = ModuleType("opentelemetry.trace")
    trace_module.get_tracer = lambda name: f"tracer:{name}"
    opentelemetry_module.trace = trace_module

    def register(**kwargs):
        calls.append(kwargs)

    phoenix_otel_module.register = register
    monkeypatch.setitem(sys.modules, "phoenix", phoenix_module)
    monkeypatch.setitem(sys.modules, "phoenix.otel", phoenix_otel_module)
    monkeypatch.setitem(sys.modules, "opentelemetry", opentelemetry_module)
    monkeypatch.setitem(sys.modules, "opentelemetry.trace", trace_module)
    monkeypatch.setattr(
        tracing_module,
        "load_tracing_config",
        lambda: SimpleNamespace(
            enabled=True,
            project_name="deepagents",
            collector_endpoint="http://localhost:6006/v1/traces",
        ),
    )
    monkeypatch.setattr(
        tracing_module,
        "_instrument_optional_openinference_packages",
        lambda: None,
    )
    monkeypatch.setattr(tracing_module, "_tracing_registered", False)
    assert tracing_module._initialize_tracer() == "tracer:lcsp_managed_deep_agent"
    assert tracing_module._initialize_tracer() == "tracer:lcsp_managed_deep_agent"

    assert calls == [
        {
            "project_name": "deepagents",
            "endpoint": "http://localhost:6006/v1/traces",
            "batch": True,
            "verbose": False,
        }
    ]


def test_traceable_creates_workflow_parent_and_records_llm_input(monkeypatch) -> None:
    fake_tracer = _FakeTracer()
    monkeypatch.setattr(tracing_module, "_tracer", fake_tracer)
    monkeypatch.setattr(tracing_module, "_current_span_is_valid", lambda: False)

    class Client:
        provider = "openai"
        model = "gpt-4o-mini"

    class Response:
        content = "done Authorization: Bearer secret-output-token"
        input_tokens = 11
        output_tokens = 3

    @tracing_module.traceable(
        name="LangChainAgent.invoke",
        run_type="llm",
    )
    def call_llm(
        self,
        prompt: str,
        *,
        workflow_run_id: str,
        node_name: str,
        correlationId: str,
    ) -> Response:
        return Response()

    call_llm(
        Client(),
        "raw prompt Authorization: Bearer secret-input-token visible in phoenix",
        workflow_run_id="engineering-rule-planner:test",
        node_name="plan_engineering_rules",
        correlationId="request-123",
    )

    parent_span, llm_span = fake_tracer.spans
    assert parent_span.name == "lcsp.workflow:plan_engineering_rules"
    assert parent_span.attributes["metadata.correlationId"] == "request-123"
    assert "status" in parent_span.attributes
    assert llm_span.name == "LangChainAgent.invoke"
    assert llm_span.attributes["openinference.span.kind"] == "LLM"
    assert llm_span.attributes["metadata.workflow_run_id"] == (
        "engineering-rule-planner:test"
    )
    assert llm_span.attributes["input.value"] == (
        "raw prompt Authorization: Bearer visible in phoenix"
    )
    assert llm_span.attributes["llm.input_messages.0.message.content"] == (
        "raw prompt Authorization: Bearer visible in phoenix"
    )
    assert llm_span.attributes["output.value"] == "done Authorization: Bearer"
    assert "status" in llm_span.attributes
    assert llm_span.attributes["llm.token_count.prompt"] == 11


def test_build_boundary_keeps_graph_assembler_deterministic() -> None:
    class GraphBoundary(AgentBoundaryBase):
        boundary_source = "test"
        source_event = "test"

        def __init__(self, config, evidence_graph_assembler=None):
            super().__init__(config)
            self.evidence_graph_assembler = evidence_graph_assembler

        def handle(self, message: dict, correlationId: str) -> None:
            return None

    config = _worker_config()
    with (
        patch("tools.common.capabilities.managed.invocation.load_config", return_value=config),
        patch("tools.common.capabilities.managed.invocation.load_boundary", return_value=GraphBoundary),
    ):
        boundary = build_boundary("ignored:GraphBoundary")

    assert boundary.evidence_graph_assembler is None


def test_build_boundary_keeps_deterministic_default_without_legacy_llm() -> None:
    class GraphBoundary(AgentBoundaryBase):
        boundary_source = "test"
        source_event = "test"

        def __init__(self, config, evidence_graph_assembler=None):
            super().__init__(config)
            self.evidence_graph_assembler = evidence_graph_assembler

        def handle(self, message: dict, correlationId: str) -> None:
            return None

    config = _worker_config()
    with (
        patch("tools.common.capabilities.managed.invocation.load_config", return_value=config),
        patch("tools.common.capabilities.managed.invocation.load_boundary", return_value=GraphBoundary),
    ):
        boundary = build_boundary("ignored:GraphBoundary")

    assert boundary.evidence_graph_assembler is None
