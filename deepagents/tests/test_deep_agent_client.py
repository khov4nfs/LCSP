from __future__ import annotations

import logging
import json
import warnings
from contextlib import contextmanager
from types import ModuleType
from types import SimpleNamespace
from unittest.mock import patch

import pytest

from tools.common.llm import BudgetTracker, DeepAgentClient, LLMToolDefinition
from tools.common.llm.deep_agent_client import (
    _LCSP_SKILLS_DIR,
    _api_key_env_name,
    _lcsp_backend,
    _lcsp_skill_sources,
    _select_subagent_mode,
    deep_agent_runtime_context,
    lcsp_search_engineering_rules,
    lcsp_search_source_code,
    lcsp_triage_chunks,
)
from tools.common.llm.docker_sandbox import DockerSandboxBackend, docker_sandbox_config
from tools.common.llm.prompt_safety import PromptSafetyViolation
from tools.common.platform import tracing as tracing_module


@pytest.fixture(autouse=True)
def _disable_phoenix_tracing(monkeypatch) -> None:
    monkeypatch.setattr(tracing_module, "_tracer", None)


def _tracker() -> BudgetTracker:
    return BudgetTracker(monthly_budget_usd=100.0, monthly_token_cap=1_000_000)


def _client() -> DeepAgentClient:
    return DeepAgentClient(
        provider="openai",
        api_key="sk-test-key",
        model="gpt-4o-mini",
        budget_tracker=_tracker(),
    )


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
        warnings.warn(
            "The middleware `RubricMiddleware` is in beta.",
            UserWarning,
            stacklevel=2,
        )
        self.model = model
        self.system_prompt = system_prompt
        self.tools = tools
        self.max_iterations = max_iterations
        self.on_evaluation = on_evaluation


class _FakeCodeInterpreterMiddleware:
    def __init__(self):
        warnings.warn(
            "The class `CodeInterpreterMiddleware` is in beta.",
            UserWarning,
            stacklevel=2,
        )


class _FakeAsyncSubAgent(dict):
    def __init__(self, **kwargs):
        super().__init__(kwargs)


class _FakeFilesystemPermission:
    def __init__(self, operations, paths, mode="allow"):
        self.operations = operations
        self.paths = paths
        self.mode = mode


@contextmanager
def _fake_deepagents(create_deep_agent, *, quickjs: bool = False):
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
    modules = {
        "deepagents": module,
        "deepagents.backends": backends,
        "langgraph.checkpoint.memory": checkpoint,
        "langgraph.store.memory": store,
    }
    if quickjs:
        quickjs_module = ModuleType("langchain_quickjs")
        quickjs_module.CodeInterpreterMiddleware = _FakeCodeInterpreterMiddleware
        modules["langchain_quickjs"] = quickjs_module
    with patch.dict(
        "sys.modules",
        modules,
    ):
        yield


class _FakeAgent:
    def __init__(self, tool_name: str | None = None):
        self.tool_name = tool_name

    def invoke(self, payload, config=None):
        if self.tool_name:
            return {
                "messages": [
                    SimpleNamespace(content="captured", usage_metadata={"input_tokens": 5, "output_tokens": 2})
                ]
            }
        return {
            "messages": [
                SimpleNamespace(content="deep response", usage_metadata={"input_tokens": 7, "output_tokens": 3})
            ]
        }


def _invoke_capture_tool(tool, **arguments):
    if hasattr(tool, "invoke"):
        return tool.invoke(arguments)
    return tool(**arguments)


def test_deep_agent_complete_uses_create_deep_agent() -> None:
    created = {}

    def fake_create_deep_agent(**kwargs):
        created.update(kwargs)
        return _FakeAgent()

    with _fake_deepagents(fake_create_deep_agent):
        response = _client().complete(
            "Hello",
            workflow_run_id="workflow-1",
            node_name="classification.rationale_narrator",
        )

    assert response.content == "deep response"
    assert response.provider == "openai"
    assert created["model"] == "openai:gpt-4o-mini"
    assert created["name"] == "lcsp-deep-agent"
    assert created["tools"][0].__name__ == "lcsp_search_source_code"
    assert created["skills"] == ["/skills/"]
    assert type(created["backend"]).__name__ == "_FakeCompositeBackend"
    assert type(created["backend"].default).__name__ == "DockerSandboxBackend"
    assert created["backend"].default.config.per_workflow is False
    assert "/workspace/" not in created["backend"].routes
    assert created["backend"].routes["/skills/"].root_dir == _LCSP_SKILLS_DIR
    assert "/memories/" in created["backend"].routes
    assert type(created["checkpointer"]).__name__ == "_FakeMemorySaver"
    assert type(created["store"]).__name__ == "_FakeInMemoryStore"
    assert type(created["middleware"][0]).__name__ == "_FakeRubricMiddleware"
    assert {agent["name"] for agent in created["subagents"]} == {
        "lcsp-source-code-agent",
        "lcsp-openwiki-agent",
        "lcsp-engineering-rule-agent",
    }
    assert all(
        path == "/skills/"
        for agent in created["subagents"]
        for path in agent["skills"]
    )


def test_deep_agent_structured_completion_uses_response_format() -> None:
    created = {}

    class StructuredAgent:
        def invoke(self, payload, config=None):
            del payload, config
            return {
                "messages": [
                    SimpleNamespace(
                        content="ignored text",
                        usage_metadata={"input_tokens": 7, "output_tokens": 3},
                    )
                ],
                "structured_response": {"answer": "ok"},
            }

    def fake_create_deep_agent(**kwargs):
        created.update(kwargs)
        return StructuredAgent()

    with _fake_deepagents(fake_create_deep_agent):
        response = _client().complete_structured(
            "Return a structured answer",
            response_format={
                "title": "Answer",
                "type": "object",
                "additionalProperties": False,
                "properties": {"answer": {"type": "string"}},
                "required": ["answer"],
            },
            workflow_run_id="workflow-1",
            node_name="structured_node",
        )

    assert response.structured_response == {"answer": "ok"}
    assert response.provider == "openai"
    assert created["response_format"] is not None
    assert type(created["response_format"]).__name__ == "ToolStrategy"


def test_lcsp_deep_agent_skill_source_points_to_backend_route() -> None:
    sources = _lcsp_skill_sources()

    assert sources == ["/skills/"]
    assert (_LCSP_SKILLS_DIR / "lcsp" / "SKILL.md").exists()


def test_lcsp_backend_exposes_skill_source_route() -> None:
    from deepagents.backends import CompositeBackend, FilesystemBackend, StoreBackend
    from langgraph.store.memory import InMemoryStore

    store = InMemoryStore()
    backend = _lcsp_backend(
        CompositeBackend=CompositeBackend,
        FilesystemBackend=FilesystemBackend,
        StoreBackend=StoreBackend,
        store=store,
        workflow_run_id="workflow-1",
        node_name="plan_engineering_rules",
    )

    listed = backend.ls("/skills/")
    assert listed.error is None
    assert any(entry["path"] == "/skills/lcsp/" for entry in listed.entries or [])

    [skill] = backend.download_files(["/skills/lcsp/SKILL.md"])
    assert skill.error is None
    assert skill.content is not None
    assert b"name: lcsp" in skill.content


def test_deep_agent_mounts_workspace_only_from_runtime_context(tmp_path) -> None:
    created = {}

    def fake_create_deep_agent(**kwargs):
        created.update(kwargs)
        return _FakeAgent()

    with deep_agent_runtime_context(source_root=tmp_path):
        with _fake_deepagents(fake_create_deep_agent):
            _client().complete(
                "Hello",
                workflow_run_id="workflow-1",
                node_name="classification.rationale_narrator",
            )

    assert "/workspace/" in created["backend"].routes
    assert created["backend"].default.config.workspace_root == tmp_path


def test_deep_agent_required_tool_is_captured_not_executed() -> None:
    captured_tools = {}

    def fake_create_deep_agent(**kwargs):
        captured_tools["tools"] = kwargs["tools"]
        _invoke_capture_tool(
            next(tool for tool in kwargs["tools"] if tool.__name__ == "finish"),
            decision="SELECT",
        )
        return _FakeAgent(tool_name="finish")

    tool = LLMToolDefinition(
        name="finish",
        description="Submit final decision.",
        input_schema={
            "type": "object",
            "additionalProperties": False,
            "properties": {"decision": {"type": "string"}},
            "required": ["decision"],
        },
        tool_choice_required=True,
    )
    with _fake_deepagents(fake_create_deep_agent):
        response = _client().complete_with_tools(
            "Finish.",
            tools=[tool],
            workflow_run_id="workflow-1",
            node_name="investigate_engineering_rule",
        )

    assert response.tool_calls[0].name == "finish"
    assert response.tool_calls[0].arguments == {"decision": "SELECT"}
    assert captured_tools["tools"][-1].__name__ == "finish"
    assert captured_tools["tools"][-1].args_schema is not None


def test_deep_agent_enables_hitl_for_conflict_capture_tools() -> None:
    created = {}

    def fake_create_deep_agent(**kwargs):
        created.update(kwargs)
        return _FakeAgent(tool_name="resolve_conflict")

    tool = LLMToolDefinition(
        name="resolve_conflict",
        description="Resolve wizard/source conflict.",
        input_schema={
            "type": "object",
            "additionalProperties": False,
            "properties": {"decision": {"type": "string"}},
        },
    )

    with _fake_deepagents(fake_create_deep_agent):
        _client().complete_with_tools(
            "Wizard claim conflicts with source evidence.",
            tools=[tool],
            workflow_run_id="workflow-1",
            node_name="classification_review_resolution",
        )

    assert created["interrupt_on"]["resolve_conflict"]["allowed_decisions"] == [
        "approve",
        "edit",
        "reject",
        "respond",
    ]


def test_deep_agent_dynamic_subagent_policy_adds_code_interpreter() -> None:
    created = {}

    def fake_create_deep_agent(**kwargs):
        created.update(kwargs)
        return _FakeAgent()

    with _fake_deepagents(fake_create_deep_agent, quickjs=True):
        _client().complete(
            "candidate_count 48 selected_rule_ids fan-out",
            workflow_run_id="workflow-1",
            node_name="plan_engineering_rules",
        )

    assert any(
        type(item).__name__ == "_FakeCodeInterpreterMiddleware"
        for item in created["middleware"]
    )


def test_deep_agent_suppresses_known_beta_middleware_warnings() -> None:
    def fake_create_deep_agent(**_kwargs):
        return _FakeAgent()

    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        with _fake_deepagents(fake_create_deep_agent, quickjs=True):
            _client().complete(
                "candidate_count 48 selected_rule_ids fan-out",
                workflow_run_id="workflow-1",
                node_name="plan_engineering_rules",
            )

    assert not [
        warning
        for warning in caught
        if "RubricMiddleware" in str(warning.message)
        or "CodeInterpreterMiddleware" in str(warning.message)
    ]


def test_deep_agent_async_policy_ignores_remote_async_subagents(monkeypatch) -> None:
    created = {}
    monkeypatch.setenv(
        "LCSP_DEEP_AGENT_ASYNC_AGENT_URL",
        "https://agent-protocol.example.test",
    )

    def fake_create_deep_agent(**kwargs):
        created.update(kwargs)
        return _FakeAgent()

    with _fake_deepagents(fake_create_deep_agent):
        _client().complete(
            "No valid engineering chunks. Build corpus and resume waiting-runs.",
            workflow_run_id="workflow-1",
            node_name="resume_waiting_runs",
        )

    assert {agent["name"] for agent in created["subagents"]} == {
        "lcsp-source-code-agent",
        "lcsp-openwiki-agent",
        "lcsp-engineering-rule-agent",
    }


def test_deep_agent_async_policy_uses_local_async_subagents(monkeypatch) -> None:
    created = {}
    monkeypatch.setenv(
        "LCSP_DEEP_AGENT_ASYNC_AGENT_URL",
        "http://127.0.0.1:2024",
    )

    def fake_create_deep_agent(**kwargs):
        created.update(kwargs)
        return _FakeAgent()

    with _fake_deepagents(fake_create_deep_agent):
        _client().complete(
            "No valid engineering chunks. Build corpus and resume waiting-runs.",
            workflow_run_id="workflow-1",
            node_name="resume_waiting_runs",
        )

    assert {agent["name"] for agent in created["subagents"]} == {
        "lcsp-corpus-build-agent",
        "lcsp-rule-investigation-agent",
    }
    assert all(
        agent["url"] == "http://127.0.0.1:2024"
        for agent in created["subagents"]
    )


def test_deep_agent_uses_per_workflow_docker_sandbox_for_planner() -> None:
    created = {}

    def fake_create_deep_agent(**kwargs):
        created.update(kwargs)
        return _FakeAgent()

    with _fake_deepagents(fake_create_deep_agent):
        _client().complete(
            "candidate_count 48",
            workflow_run_id="workflow-1",
            node_name="plan_engineering_rules",
        )

    backend = created["backend"].default
    assert isinstance(backend, DockerSandboxBackend)
    assert backend.config.per_workflow is True
    assert backend.config.scope == "workflow-1"


def test_docker_sandbox_config_uses_per_run_scope_for_chunk_triage() -> None:
    config = docker_sandbox_config(
        workflow_run_id="workflow-1",
        node_name="chunking_llm_triage",
        workspace_root=None,
        openwiki_root=None,
    )

    assert config.per_workflow is False
    assert config.scope == "workflow-1-chunking_llm_triage"


def test_docker_sandbox_config_uses_per_run_scope_for_engineering_rule_compile() -> None:
    config = docker_sandbox_config(
        workflow_run_id="workflow-1",
        node_name="compile_engineering_rules",
        workspace_root=None,
        openwiki_root=None,
    )

    assert config.per_workflow is False
    assert config.scope == "workflow-1-compile_engineering_rules"


def test_deep_agent_rejects_unsafe_prompt_before_agent_creation() -> None:
    called = False

    def fake_create_deep_agent(**_kwargs):
        nonlocal called
        called = True
        return _FakeAgent()

    with _fake_deepagents(fake_create_deep_agent):
        with pytest.raises(PromptSafetyViolation):
            _client().complete(
                "def unsafe(): pass",
                workflow_run_id="workflow-1",
                node_name="classification.rationale_narrator",
            )
    assert called is False


def test_deep_agent_monthly_budget_does_not_block_provider_call() -> None:
    tracker = BudgetTracker(monthly_budget_usd=0.000001, monthly_token_cap=1)
    tracker._in_memory_store["tokens"] = 999_999_999
    tracker._in_memory_store["cost"] = 999_999.0
    client = DeepAgentClient(
        provider="openai",
        api_key="sk-test-key",
        model="gpt-4o-mini",
        budget_tracker=tracker,
    )

    with _fake_deepagents(lambda **_kwargs: _FakeAgent()):
        response = client.complete(
            "Hello, world!",
            workflow_run_id="workflow-1",
            node_name="classification.rationale_narrator",
        )

    assert response.content == "deep response"


def test_deep_agent_api_key_not_in_logs(caplog) -> None:
    client = DeepAgentClient(
        provider="openai",
        api_key="SECRET_API_KEY_123",
        model="gpt-4o-mini",
        budget_tracker=_tracker(),
    )

    with _fake_deepagents(lambda **_kwargs: _FakeAgent()):
        with caplog.at_level(logging.DEBUG):
            client.complete(
                "Hello",
                workflow_run_id="workflow-1",
                node_name="classification.rationale_narrator",
            )

    for record in caplog.records:
        assert "SECRET_API_KEY_123" not in record.message


def test_deep_agent_response_strips_secret_values() -> None:
    class SecretAgent:
        def invoke(self, _payload, config=None):
            del config
            return {
                "messages": [
                    SimpleNamespace(
                        content="Your key is sk-ant-12345",
                        usage_metadata={"input_tokens": 7, "output_tokens": 3},
                    )
                ]
            }

    with _fake_deepagents(lambda **_kwargs: SecretAgent()):
        response = _client().complete(
            "What is my key?",
            workflow_run_id="workflow-1",
            node_name="classification.rationale_narrator",
        )

    assert "sk-ant-12345" not in response.content


def test_deep_agent_strips_secrets_from_prompt_before_invoke() -> None:
    observed = {}

    class ObservingAgent:
        def invoke(self, payload, config=None):
            del config
            observed["prompt"] = payload["messages"][0]["content"]
            return {
                "messages": [
                    SimpleNamespace(
                        content="ok",
                        usage_metadata={"input_tokens": 7, "output_tokens": 3},
                    )
                ]
            }

    with _fake_deepagents(lambda **_kwargs: ObservingAgent()):
        _client().complete(
            "The token is ghp_123456789012345678901234567890123456",
            workflow_run_id="workflow-1",
            node_name="classification.rationale_narrator",
        )

    assert "123456789012345678901234567890123456" not in observed["prompt"]


def test_deep_agent_invoke_sets_langgraph_thread_id() -> None:
    observed = {}

    class ObservingAgent:
        def invoke(self, _payload, config=None):
            observed["config"] = config
            return {
                "messages": [
                    SimpleNamespace(
                        content="ok",
                        usage_metadata={"input_tokens": 7, "output_tokens": 3},
                    )
                ]
            }

    with _fake_deepagents(lambda **_kwargs: ObservingAgent()):
        _client().complete(
            "Hello",
            workflow_run_id="workflow-1",
            node_name="classification.rationale_narrator",
            correlationId="corr-1",
        )

    configurable = observed["config"]["configurable"]
    assert configurable["thread_id"] == "workflow-1"
    assert configurable["workflow_run_id"] == "workflow-1"
    assert configurable["node_name"] == "classification.rationale_narrator"
    assert configurable["correlationId"] == "corr-1"


def test_deep_agent_missing_workflow_or_node_context_rejected() -> None:
    with pytest.raises(ValueError):
        _client().complete(
            "Hello",
            workflow_run_id="",
            node_name="classification.rationale_narrator",
        )

    with pytest.raises(ValueError):
        _client().complete("Hello", workflow_run_id="workflow-1", node_name="")


def test_deep_agent_source_retrieval_tool_requires_runtime_context() -> None:
    result = lcsp_search_source_code("DeepAgentClient", max_results=2)
    payload = json.loads(result)

    assert payload["matches"] == []


def test_deep_agent_source_retrieval_tool_searches_job_workspace(tmp_path) -> None:
    source = tmp_path / "src" / "app.py"
    source.parent.mkdir()
    source.write_text("class AssessmentSourceRuntime: pass\n", encoding="utf-8")

    with deep_agent_runtime_context(source_root=tmp_path):
        result = lcsp_search_source_code("AssessmentSourceRuntime", max_results=2)

    assert "app.py" in result
    assert "AssessmentSourceRuntime" in result


def test_deep_agent_chunk_triage_combines_retrieval_sources() -> None:
    with deep_agent_runtime_context(
        legal_chunks=[
            {
                "id": "chunk-1",
                "text": "Engineering control requires audit logging.",
            }
        ],
        engineering_rules=[
            {
                "engineeringRuleId": "rule-1",
                "concept": "AUDIT_LOGGING",
            }
        ],
    ):
        result = lcsp_triage_chunks("audit logging", max_results=3)
        payload = json.loads(result)

    assert payload["query"] == "audit logging"
    assert payload["triage_policy"]
    assert any(match["source"] == "openwiki" for match in payload["matches"])
    assert any(match["source"] == "engineering_rules" for match in payload["matches"])


def test_deep_agent_engineering_rule_retrieval_uses_runtime_db_context() -> None:
    with deep_agent_runtime_context(
        legal_rules=[{"legalRuleId": "legal-1", "title": "Audit logging"}],
        engineering_rules=[
            {"engineeringRuleId": "eng-1", "concept": "AUDIT_LOGGING"}
        ],
    ):
        payload = json.loads(lcsp_search_engineering_rules("audit", max_results=5))

    assert {match["source"] for match in payload["matches"]} == {
        "engineering_rules",
        "legal_rules",
    }


def test_deep_agent_subagent_policy_selects_modes() -> None:
    assert (
        _select_subagent_mode(
            workflow_run_id="workflow-1",
            node_name="plan_engineering_rules",
            prompt="candidate_count 48",
        )
        == "dynamic"
    )
    assert (
        _select_subagent_mode(
            workflow_run_id="workflow-1",
            node_name="resume_waiting_runs",
            prompt="No engineering chunks, build corpus",
        )
        == "async"
    )
    assert (
        _select_subagent_mode(
            workflow_run_id="workflow-1",
            node_name="rationale_narrator",
            prompt="single summary",
        )
        == "sync"
    )


def test_provider_key_env_mapping() -> None:
    assert _api_key_env_name("openai") == "OPENAI_API_KEY"
    assert _api_key_env_name("anthropic") == "ANTHROPIC_API_KEY"
    assert _api_key_env_name("gemini") == "GOOGLE_API_KEY"
