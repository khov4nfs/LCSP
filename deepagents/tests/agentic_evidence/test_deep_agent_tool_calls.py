from __future__ import annotations

from contextlib import contextmanager
from types import ModuleType
from types import SimpleNamespace
from unittest.mock import patch
from uuid import uuid4

import pytest

from tools.common.agentic_evidence import (
    AgenticToolRequest,
    build_sprint6_agentic_registry,
)
from tools.common.llm import BudgetTracker, DeepAgentClient, LLMToolDefinition
from tools.common.platform import tracing as tracing_module


@pytest.fixture(autouse=True)
def _disable_phoenix_tracing(monkeypatch) -> None:
    monkeypatch.setattr(tracing_module, "_tracer", None)


def tool_definition() -> LLMToolDefinition:
    return LLMToolDefinition(
        name="get_scan_coverage",
        description="Return bounded scan coverage for an accepted evidence report.",
        input_schema={
            "type": "object",
            "additionalProperties": False,
            "properties": {
                "maxResults": {"type": "integer", "minimum": 1, "maximum": 100}
            },
            "required": ["maxResults"],
        },
    )


def budget_tracker() -> BudgetTracker:
    return BudgetTracker(monthly_budget_usd=100.0, monthly_token_cap=1_000_000)


class _FakeStateBackend:
    pass


class _FakeFilesystemBackend:
    def __init__(self, root_dir=None, virtual_mode=True, max_file_size_mb=10):
        self.root_dir = root_dir
        self.virtual_mode = virtual_mode
        self.max_file_size_mb = max_file_size_mb


class _FakeStoreBackend:
    def __init__(self, *, namespace, store=None):
        self.namespace = namespace
        self.store = store


class _FakeCompositeBackend:
    def __init__(self, default, routes, *, artifacts_root="/"):
        self.default = default
        self.routes = routes
        self.artifacts_root = artifacts_root


class _FakeMemorySaver:
    pass


class _FakeInMemoryStore:
    pass


class _FakeRubricMiddleware:
    def __init__(
        self,
        *,
        model,
        system_prompt=None,
        tools=None,
        max_iterations=3,
        on_evaluation=None,
    ):
        self.model = model
        self.system_prompt = system_prompt
        self.tools = tools
        self.max_iterations = max_iterations
        self.on_evaluation = on_evaluation


class _FakeAsyncSubAgent(dict):
    def __init__(self, **kwargs):
        super().__init__(kwargs)


class _FakeFilesystemPermission:
    def __init__(self, operations, paths, mode="allow"):
        self.operations = operations
        self.paths = paths
        self.mode = mode


@contextmanager
def _fake_deepagents(create_deep_agent):
    module = ModuleType("deepagents")
    module.__path__ = []
    module.AsyncSubAgent = _FakeAsyncSubAgent
    module.FilesystemPermission = _FakeFilesystemPermission
    module.create_deep_agent = create_deep_agent
    module.RubricMiddleware = _FakeRubricMiddleware
    backends = ModuleType("deepagents.backends")
    backends.CompositeBackend = _FakeCompositeBackend
    backends.FilesystemBackend = _FakeFilesystemBackend
    backends.StateBackend = _FakeStateBackend
    backends.StoreBackend = _FakeStoreBackend
    checkpoint = ModuleType("langgraph.checkpoint.memory")
    checkpoint.MemorySaver = _FakeMemorySaver
    store = ModuleType("langgraph.store.memory")
    store.InMemoryStore = _FakeInMemoryStore
    with patch.dict(
        "sys.modules",
        {
            "deepagents": module,
            "deepagents.backends": backends,
            "langgraph.checkpoint.memory": checkpoint,
            "langgraph.store.memory": store,
        },
    ):
        yield


def _client() -> DeepAgentClient:
    return DeepAgentClient(
        provider="gemini",
        api_key="AIzaSy-mock-key",
        model="gemini-2.5-flash",
        budget_tracker=budget_tracker(),
    )


def _invoke_capture_tool(tool, **arguments):
    if hasattr(tool, "invoke"):
        return tool.invoke(arguments)
    return tool(**arguments)


def test_deep_agent_tool_call_is_manual_and_registry_validated() -> None:
    class FakeAgent:
        def __init__(self, capture_tool):
            self._capture_tool = capture_tool

        def invoke(self, _payload, config=None):
            del config
            _invoke_capture_tool(self._capture_tool, maxResults=25)
            return {
                "messages": [
                    SimpleNamespace(
                        content="",
                        usage_metadata={"input_tokens": 12, "output_tokens": 8},
                    )
                ]
            }

    def fake_create_deep_agent(**kwargs):
        return FakeAgent(kwargs["tools"][-1])

    with _fake_deepagents(fake_create_deep_agent):
        response = _client().complete_with_tools(
            "Inspect current scan coverage.",
            tools=[tool_definition()],
            workflow_run_id=str(uuid4()),
            node_name="agentic.resolve_missing_input",
            correlationId=str(uuid4()),
        )

    assert response.content == ""
    assert len(response.tool_calls) == 1
    call = response.tool_calls[0]
    assert call.name == "get_scan_coverage"
    assert call.arguments == {"maxResults": 25}
    assert call.call_id is not None

    request = AgenticToolRequest.model_validate(
        {
            "toolName": call.name,
            "requestId": str(uuid4()),
            "assessmentId": str(uuid4()),
            "workflowRunId": str(uuid4()),
            "artifactVersions": {"technicalEvidenceReportId": "ter-1"},
            "correlationId": str(uuid4()),
            "scope": {},
            "budget": {
                "maxItems": call.arguments["maxResults"],
                "maxDepth": 1,
                "maxBytes": 16_384,
                "maxDurationMs": 1_000,
            },
            "input": call.arguments,
        }
    )
    capability = build_sprint6_agentic_registry().validate(request)
    assert capability.name == "get_scan_coverage"


def test_tool_schema_must_be_closed_before_deep_agent_creation() -> None:
    unsafe = LLMToolDefinition(
        name="get_scan_coverage",
        description="Coverage",
        input_schema={"type": "object", "properties": {}},
    )
    called = False

    def fake_create_deep_agent(**_kwargs):
        nonlocal called
        called = True

    with _fake_deepagents(fake_create_deep_agent):
        with pytest.raises(ValueError, match="additionalProperties=false"):
            _client().complete_with_tools(
                "Inspect evidence.",
                tools=[unsafe],
                workflow_run_id=str(uuid4()),
                node_name="agentic.resolve_missing_input",
            )

    assert called is False


def test_required_tool_call_fails_closed_when_agent_does_not_call_tool() -> None:
    required = LLMToolDefinition(
        name="get_scan_coverage",
        description="Coverage",
        input_schema={
            "type": "object",
            "additionalProperties": False,
            "properties": {},
        },
        tool_choice_required=True,
    )

    class FakeAgent:
        def invoke(self, _payload, config=None):
            del config
            return {
                "messages": [
                    SimpleNamespace(
                        content="no tool",
                        usage_metadata={"input_tokens": 10, "output_tokens": 5},
                    )
                ]
            }

    with _fake_deepagents(lambda **_kwargs: FakeAgent()):
        with pytest.raises(ValueError, match="no tool call"):
            _client().complete_with_tools(
                "Inspect evidence.",
                tools=[required],
                workflow_run_id=str(uuid4()),
                node_name="agentic.resolve_missing_input",
            )
