"""Provider-free regressions: workload length is not an LCSP execution policy."""

from __future__ import annotations

import inspect
from pathlib import Path
from types import SimpleNamespace

import pytest
from deepagents.backends import FilesystemBackend
from langchain_core.callbacks import BaseCallbackHandler
from langchain_core.messages import AIMessage
from langgraph.config import get_config
from langgraph.errors import GraphRecursionError
from middleware.failure_policy import NoProgressDetected
from pydantic import Field

from assessment_root.runner import run_assessment_root
from orchestration.graph_execution import (
    LANGGRAPH_EFFECTIVELY_UNBOUNDED_RECURSION_LIMIT,
    agent_graph_config,
)
from rule_set_preparation import runner as preparation_runner
from rule_set_preparation.agent import create_rule_set_preparation_agent
from rule_set_preparation.legal_source_files import materialize_legal_source
from rule_set_preparation.tools import RuleSetPreparationContext
from test_assessment_root_agent import complete_root_messages, ASSESSMENT, THREAD, FakeClient, RootScriptedModel
from test_rule_set_preparation_agent import DOC, FakeApi, RUN_ID, _bundle, _call, _model, _packet, _sha
from test_rule_set_preparation_native_isolation_preparation import RuleSetPreparationScriptedModel
from tools.common.capabilities.agent_runtime.local_server import _runtime_config


@pytest.fixture(autouse=True)
def offline_models_only(monkeypatch: pytest.MonkeyPatch) -> None:
    from langchain.agents.middleware import ModelRetryMiddleware
    from middleware import usage_metering
    from middleware.model_governance import MODEL_GOVERNANCE_MIDDLEWARE

    original = usage_metering.assert_model_identity
    monkeypatch.setattr(
        usage_metering, "assert_model_identity",
        lambda model, response=None: None
        if isinstance(model, (RuleSetPreparationScriptedModel, RootScriptedModel))
        else original(model, response),
    )
    for middleware in MODEL_GOVERNANCE_MIDDLEWARE:
        if isinstance(middleware, ModelRetryMiddleware):
            monkeypatch.setattr(middleware, "initial_delay", 0.0)
            monkeypatch.setattr(middleware, "max_delay", 0.0)
    # The fake retains prompts for assertions; its repr includes that history.
    # Suppress request diagnostics, not the production governance stack itself.
    monkeypatch.setattr(usage_metering, "logger", SimpleNamespace(
        info=lambda *a, **kw: None, warning=lambda *a, **kw: None,
        error=lambda *a, **kw: None, debug=lambda *a, **kw: None,
    ))


class GraphSteps(BaseCallbackHandler):
    def __init__(self) -> None:
        self.highest_step = -1

    def on_chain_start(self, serialized, inputs, *, metadata=None, **kwargs) -> None:
        step = (metadata or {}).get("langgraph_step")
        if isinstance(step, int):
            self.highest_step = max(self.highest_step, step)


def preparation_responses() -> list[AIMessage]:
    # A finite scripted reasoning sequence unrelated to Legal Source size. All native
    # middleware is present; each read advances to a different source range before
    # validation, so the no-progress guard correctly treats these as distinct evidence.
    return [
        *[
            _call(
                "read_file",
                {"file_path": "/legal-source/INDEX.md", "offset": i * 2, "limit": 2},
                f"read-{i}",
            )
            for i in range(16)
        ],
        _call("validate_compliance_rule_set", {"packet": _packet()}, "validate"),
        _call("submit_compliance_rule_set", {"packet": _packet()}, "submit"),
        AIMessage(content="complete"),
    ]


def test_old_preparation_ceiling_reproduces_framework_exhaustion(tmp_path: Path) -> None:
    context = RuleSetPreparationContext(RUN_ID, FakeApi())
    materialize_legal_source(_bundle(), tmp_path)
    model = _model(preparation_responses())
    agent = create_rule_set_preparation_agent(context=context, legal_source_root=tmp_path, model=model)
    with pytest.raises(GraphRecursionError):
        agent.invoke({"messages": [{"role": "user", "content": "prepare"}]},
                     config={"recursion_limit": 150})
    assert context.validation_calls == 0 and context.submission is None


def test_preparation_continues_past_150_steps_and_submits_once(tmp_path: Path) -> None:
    api, steps = FakeApi(), GraphSteps()
    result = preparation_runner.run_rule_set_preparation(
        api, RUN_ID, model=_model(preparation_responses()), work_dir=tmp_path, callbacks=[steps],
    )
    assert result["state"] == "SUCCEEDED"
    assert api.names() == ["claim", "validate", "submit"]
    assert steps.highest_step > 150
    print(f"PREPARATION_COMPLETED graph_step={steps.highest_step}")


def test_large_productive_preparation_exceeds_old_call_assumptions(tmp_path: Path) -> None:
    bundle = _bundle()
    chunks = []
    responses = [_call("read_file", {"file_path": "/legal-source/INDEX.md"}, "index")]
    for index in range(270):
        locator = f"section-{index}::clause-1"
        content = f"Distinct synthetic provision observation {index}."
        chunks.append({
            "chunkId": f"chunk-{index}", "locator": locator, "content": content,
            "contentSha256": _sha(content), "legalStatus": "IN_FORCE",
            "legalEffectStatus": "EFFECTIVE", "legalStatusSourceRef": "fixture:source",
            "hierarchy": {"path": [f"section-{index}"]},
        })
        responses.append(_call(
            "read_file",
            {"file_path": f"/legal-source/{DOC}/section-{index}__clause-1.md"},
            f"source-{index}",
        ))
    bundle["documents"][0]["chunks"] = chunks
    class LargeApi(FakeApi):
        def claim_rule_set_preparation(self, run_id: str) -> dict:
            self.calls.append(("claim", (run_id,)))
            return bundle

    # This long but productive run is allowed to let its own agent make the completion claim.
    responses.extend([
        _call("validate_compliance_rule_set", {"packet": _packet()}, "validate"),
        _call("submit_compliance_rule_set", {"packet": _packet()}, "submit"),
    ])
    api = LargeApi()
    model = _model(responses)
    result = preparation_runner.run_rule_set_preparation(
        api,
        RUN_ID,
        model=model,
        work_dir=tmp_path,
    )

    assert result["state"] == "SUCCEEDED"
    assert api.names() == ["claim", "validate", "submit"]
    assert len(model.prompts) > 256


def test_root_continues_past_its_old_1000_steps_with_governance(tmp_path: Path) -> None:
    (tmp_path / "source.txt").write_text("\n".join(f"source line {i}" for i in range(70)))
    model = RootScriptedModel(responses=[
        *[_call("read_file", {"file_path": "/source.txt", "offset": i, "limit": 1}, f"read-{i}") for i in range(65)],
        *complete_root_messages(),
    ])
    client, steps = FakeClient(), GraphSteps()
    result = run_assessment_root(
        client, ASSESSMENT,
        backend_factory=lambda *_: (FilesystemBackend(root_dir=tmp_path, virtual_mode=True), None),
        model=model, extra_callbacks=[steps],
    )
    assert result["state"] == "SUCCEEDED"
    assert result["threadId"] == THREAD
    assert steps.highest_step > 1000
    print(f"ASSESSMENT_COMPLETED graph_step={steps.highest_step}")


def test_native_researcher_inherits_the_shared_technical_ceiling(tmp_path: Path) -> None:
    class ConfigRecordingModel(RootScriptedModel):
        limits: list[int] = Field(default_factory=list)

        def _generate(self, messages, **kwargs):
            self.limits.append(get_config()["recursion_limit"])
            return super()._generate(messages, **kwargs)

    model = ConfigRecordingModel(responses=[
        _call("task", {"description": "Inspect the repository", "subagent_type": "repository-researcher"}, "research"),
        AIMessage(content="research complete"),
        *complete_root_messages(),
    ])
    result = run_assessment_root(
        FakeClient(), ASSESSMENT,
        backend_factory=lambda *_: (FilesystemBackend(root_dir=tmp_path, virtual_mode=True), None),
        model=model,
    )
    assert result["state"] == "SUCCEEDED"
    assert model.limits == [LANGGRAPH_EFFECTIVELY_UNBOUNDED_RECURSION_LIMIT] * 4


def test_framework_exhaustion_is_runtime_error_not_model_error(monkeypatch, tmp_path: Path) -> None:
    class ExhaustedGraph:
        def invoke(self, *args, **kwargs):
            raise GraphRecursionError("framework recursion ceiling exhausted")

    monkeypatch.setattr(preparation_runner, "create_rule_set_preparation_agent", lambda **kw: ExhaustedGraph())
    api = FakeApi()
    result = preparation_runner.run_rule_set_preparation(api, RUN_ID, work_dir=tmp_path)
    assert result["failureReason"] == preparation_runner.RUNTIME_ERROR
    assert result["error"]["type"] == "GraphRecursionError"
    assert api.calls[-1] == ("fail", (RUN_ID, preparation_runner.RUNTIME_ERROR))


def test_no_progress_execution_failure_is_runtime_error_not_model_error(monkeypatch, tmp_path: Path) -> None:
    class ExhaustedGraph:
        def invoke(self, *args, **kwargs):
            raise NoProgressDetected(
                "NO_PROGRESS_DETECTED"
            )

    monkeypatch.setattr(preparation_runner, "create_rule_set_preparation_agent", lambda **kw: ExhaustedGraph())
    api = FakeApi()
    result = preparation_runner.run_rule_set_preparation(api, RUN_ID, work_dir=tmp_path)
    assert result["failureReason"] == preparation_runner.RUNTIME_ERROR
    assert result["error"]["type"] == "NoProgressDetected"
    assert "NO_PROGRESS_DETECTED" in result["error"]["message"]
    assert api.calls[-1] == ("fail", (RUN_ID, preparation_runner.RUNTIME_ERROR))


def test_runner_interfaces_do_not_expose_per_workload_limits() -> None:
    for runner in [run_assessment_root, preparation_runner.run_rule_set_preparation]:
        assert "recursion_limit" not in inspect.signature(runner).parameters


def test_runtime_config_preserves_checkpoints_and_discards_stale_small_ceiling() -> None:
    config = {"recursion_limit": 150, "configurable": {"checkpoint_id": "saved"}, "tags": ["trace"]}
    result = _runtime_config(THREAD, config, {"origin": "test"}, {})
    assert result["recursion_limit"] == LANGGRAPH_EFFECTIVELY_UNBOUNDED_RECURSION_LIMIT
    assert result["configurable"]["checkpoint_id"] == "saved"
    assert result["configurable"]["thread_id"] == THREAD
    assert result["tags"] == ["trace"]
    assert result["metadata"]["origin"] == "test"
    assert config["recursion_limit"] == 150
    assert agent_graph_config()["recursion_limit"] == (1 << 31) - 1
