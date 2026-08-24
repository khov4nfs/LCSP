from __future__ import annotations

from contextlib import contextmanager
from types import ModuleType
from types import SimpleNamespace
from unittest.mock import patch

import pytest

from tools.common.llm import BudgetTracker, DeepAgentClient, LLMToolDefinition
from tools.common.platform import tracing as tracing_module


@pytest.fixture(autouse=True)
def _disable_phoenix_tracing(monkeypatch) -> None:
    monkeypatch.setattr(tracing_module, "_tracer", None)


def _tracker() -> BudgetTracker:
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


def _required_tool() -> LLMToolDefinition:
    return LLMToolDefinition(
        name="finish",
        description="Submit the terminal structured result.",
        input_schema={
            "type": "object",
            "additionalProperties": False,
            "properties": {"decision": {"type": "string"}},
            "required": ["decision"],
        },
        tool_choice_required=True,
    )


def _invoke_capture_tool(tool, **arguments):
    if hasattr(tool, "invoke"):
        return tool.invoke(arguments)
    return tool(**arguments)


def test_required_tool_definition_is_captured_by_deep_agent() -> None:
    created = {}

    class FakeAgent:
        def invoke(self, _payload, config=None):
            del config
            _invoke_capture_tool(
                next(tool for tool in created["tools"] if tool.__name__ == "finish"),
                decision="SELECT",
            )
            return {
                "messages": [
                    SimpleNamespace(
                        content="done",
                        usage_metadata={"input_tokens": 10, "output_tokens": 5},
                    )
                ]
            }

    def fake_create_deep_agent(**kwargs):
        created.update(kwargs)
        return FakeAgent()

    client = DeepAgentClient(
        provider="openai",
        api_key="sk-test-key",
        model="gpt-4o",
        budget_tracker=_tracker(),
    )

    with _fake_deepagents(fake_create_deep_agent):
        response = client.complete_with_tools(
            "Finish now.",
            tools=[_required_tool()],
            workflow_run_id="workflow-1",
            node_name="investigate_engineering_rule_finish",
        )

    assert response.tool_calls[0].name == "finish"
    assert response.tool_calls[0].arguments == {"decision": "SELECT"}
    assert created["tools"][0].__name__ == "lcsp_search_source_code"
    assert created["tools"][-1].__name__ == "finish"
    assert created["tools"][-1].args_schema is not None
    assert "You must call one of the provided tools" in created["system_prompt"]


def test_required_empty_tool_call_retries_with_schema_payload() -> None:
    attempts = 0
    tool = LLMToolDefinition(
        name="finish",
        description="Submit the terminal structured result.",
        input_schema={
            "type": "object",
            "additionalProperties": False,
            "properties": {"decision": {"type": "string"}},
        },
        tool_choice_required=True,
    )

    class FakeAgent:
        def __init__(self, capture_tool):
            self._capture_tool = capture_tool

        def invoke(self, _payload, config=None):
            nonlocal attempts
            del config
            attempts += 1
            if attempts == 1:
                _invoke_capture_tool(self._capture_tool)
            else:
                _invoke_capture_tool(self._capture_tool, decision="SELECT")
            return {
                "messages": [
                    SimpleNamespace(
                        content="done",
                        usage_metadata={"input_tokens": 10, "output_tokens": 5},
                    )
                ]
            }

    def fake_create_deep_agent(**kwargs):
        return FakeAgent(
            next(tool for tool in kwargs["tools"] if tool.__name__ == "finish")
        )

    client = DeepAgentClient(
        provider="openai",
        api_key="sk-test-key",
        model="gpt-4o",
        budget_tracker=_tracker(),
    )

    with _fake_deepagents(fake_create_deep_agent):
        response = client.complete_with_tools(
            "Finish now.",
            tools=[tool],
            workflow_run_id="workflow-1",
            node_name="investigate_engineering_rule_finish",
        )

    assert attempts == 2
    assert response.tool_calls[0].arguments == {"decision": "SELECT"}


def test_required_schema_invalid_tool_call_retries_with_valid_payload() -> None:
    attempts = 0
    prompts: list[str] = []
    tool = LLMToolDefinition(
        name="submit_planner_selection",
        description="Submit planner selection.",
        input_schema={
            "type": "object",
            "additionalProperties": False,
            "required": ["nodes", "edges"],
            "properties": {
                "nodes": {
                    "type": "array",
                    "minItems": 1,
                    "items": {
                        "type": "object",
                        "additionalProperties": False,
                        "required": ["proposalNodeId"],
                        "properties": {
                            "proposalNodeId": {
                                "type": "string",
                                "pattern": r"^[a-z][a-z0-9_-]{1,63}$",
                            }
                        },
                    },
                },
                "edges": {"type": "array"},
            },
        },
        tool_choice_required=True,
    )

    class FakeAgent:
        def __init__(self, capture_tool):
            self._capture_tool = capture_tool

        def invoke(self, _payload, config=None):
            nonlocal attempts
            del config
            prompts.append(_payload["messages"][0]["content"])
            attempts += 1
            if attempts == 1:
                _invoke_capture_tool(self._capture_tool, nodes=[], edges=[])
            else:
                _invoke_capture_tool(
                    self._capture_tool,
                    nodes=[{"proposalNodeId": "business_action"}],
                    edges=[],
                )
            return {
                "messages": [
                    SimpleNamespace(
                        content="done",
                        usage_metadata={"input_tokens": 10, "output_tokens": 5},
                    )
                ]
            }

    def fake_create_deep_agent(**kwargs):
        return FakeAgent(
            next(
                tool
                for tool in kwargs["tools"]
                if tool.__name__ == "submit_planner_selection"
            )
        )

    client = DeepAgentClient(
        provider="openai",
        api_key="sk-test-key",
        model="gpt-4o",
        budget_tracker=_tracker(),
    )

    with _fake_deepagents(fake_create_deep_agent):
        response = client.complete_with_tools(
            "Submit planner selection.",
            tools=[tool],
            workflow_run_id="workflow-1",
            node_name="plan_engineering_rules",
        )

    assert attempts == 2
    assert "submit_planner_selection: object" in prompts[1]
    assert "nodes" in prompts[1]
    assert "minItems=1" in prompts[1]
    assert response.tool_calls[0].arguments == {
        "nodes": [{"proposalNodeId": "business_action"}],
        "edges": [],
    }
