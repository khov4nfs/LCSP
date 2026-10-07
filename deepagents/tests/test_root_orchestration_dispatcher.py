from __future__ import annotations

from unittest.mock import MagicMock

import pytest

from model_policy import resolve_agent_model

from contracts.handoffs import InterviewResult
from orchestration.context import LCSPRunContext
from orchestration.dispatcher import RootSubagentDispatcher
from orchestration.lifecycle import RootSubagentReservation
from orchestration.agent_stream import (
    AGENT_STREAM_STAGES,
    AgentStreamSession,
    activate_agent_stream,
    agent_stream_stage,
)


@pytest.mark.parametrize("specialist,stage", [
    ("interview", "INTERVIEW"), ("repository-analyst", "RULE_ANALYSIS"),
])
def test_specialist_selection_is_attributed_to_target_not_enclosing_scanner(monkeypatch, specialist, stage):
    import orchestration.dispatcher as dispatcher_module

    lifecycle = MagicMock()
    lifecycle.reserve_subagent.return_value = RootSubagentReservation(
        subagent_type=specialist, status="OWNER", execution_id="x:owner", trigger="T",
    )
    lifecycle.owner_instruction.return_value = ""
    lifecycle.complete_subagent.return_value = {}
    definition = {**_definition(), "name": specialist}
    definition.pop("response_format")
    dispatcher = RootSubagentDispatcher(
        lifecycle=lifecycle,
        agent_factory=MagicMock(),
        subagents={specialist: definition},
    )
    monkeypatch.setattr(dispatcher_module, "invoke_with_stream", lambda *a, **k: {})
    events = []
    session = AgentStreamSession(
        assessment_id="assessment-1", run_id="scan-job-1", correlation_id="corr-1",
        boundary_name="scan_requested", emit_payload=events.append,
        stage=AGENT_STREAM_STAGES["scanner"],
    )
    with activate_agent_stream(session), agent_stream_stage(AGENT_STREAM_STAGES["scanner"]):
        dispatcher.dispatch(subagent_type=specialist, instruction="bounded specialist work")
    assert events[0]["event_type"] == "SUBAGENT_SELECTED"
    assert events[0]["stage"] == stage


def _definition(name: str = "interview", *, handoff: bool = True) -> dict:
    definition = {
        "name": name,
        "model": "test-model",
        "tools": [],
        "system_prompt": f"{name} prompt",
        "middleware": [],
        "response_format": InterviewResult,
    }
    if not handoff:
        definition.pop("response_format")
    return definition


def test_dispatcher_has_no_root_reentry_path() -> None:
    # One orchestrator: the deterministic Python loop dispatches specialists directly; there
    # is no root-model re-entry surface left to call.
    import inspect

    assert "reenter_root" not in inspect.signature(RootSubagentDispatcher.dispatch).parameters
    assert not hasattr(RootSubagentDispatcher, "_dispatch_via_root")


def test_direct_dispatch_passes_context_and_explicit_checkpointer() -> None:
    lifecycle = MagicMock()
    reservation = RootSubagentReservation(
        subagent_type="repository-analyst",
        status="OWNER",
        execution_id="repository-analyst:owner",
        trigger="RULE_ANALYSIS",
    )
    lifecycle.reserve_subagent.return_value = reservation
    lifecycle.owner_instruction.return_value = ""
    lifecycle.complete_subagent.return_value = {"status": "COMPLETE"}
    specialist = MagicMock()
    specialist.invoke.return_value = {"messages": []}
    checkpointer = object()
    factory = MagicMock(return_value=specialist)
    context = LCSPRunContext(
        assessment_id="assessment-1",
        user_id="user-1",
        workflow_run_id="workflow-1",
        artifact_versions={"legalRuleCatalogVersionId": "catalog-1"},
    )
    dispatcher = RootSubagentDispatcher(
        lifecycle=lifecycle,
        agent_factory=factory,
        subagents={"repository-analyst": _definition("repository-analyst", handoff=False)},
        enable_thread_checkpointing=True,
        checkpointer=checkpointer,
    )

    result = dispatcher.dispatch(
        subagent_type="repository-analyst",
        instruction="Analyze one pinned rule.",
        trigger="RULE_ANALYSIS",
        thread_id="workflow-1",
        context=context,
    )

    assert result["checkpointing"] == {"threadId": "workflow-1", "enabled": True}
    assert factory.call_args.kwargs["checkpointer"] is checkpointer
    assert specialist.invoke.call_args.kwargs["context"] is context
    assert specialist.invoke.call_args.kwargs["config"]["configurable"] == {
        "thread_id": "workflow-1"
    }


def test_direct_dispatch_requires_checkpointer_when_thread_checkpointing_enabled() -> None:
    lifecycle = MagicMock()
    reservation = RootSubagentReservation(
        subagent_type="repository-analyst",
        status="OWNER",
        execution_id="repository-analyst:owner",
        trigger="RULE_ANALYSIS",
    )
    lifecycle.reserve_subagent.return_value = reservation
    lifecycle.owner_instruction.return_value = ""
    dispatcher = RootSubagentDispatcher(
        lifecycle=lifecycle,
        agent_factory=MagicMock(),
        subagents={"repository-analyst": _definition("repository-analyst", handoff=False)},
        enable_thread_checkpointing=True,
    )

    with pytest.raises(RuntimeError, match="explicit checkpointer"):
        dispatcher.dispatch(
            subagent_type="repository-analyst",
            instruction="Analyze one pinned rule.",
            trigger="RULE_ANALYSIS",
            thread_id="workflow-1",
            )
    lifecycle.fail_subagent.assert_called_once_with(reservation)


def test_repository_analyst_dispatch_passes_trusted_context_and_needs_no_handoff_schema() -> None:
    lifecycle = MagicMock()
    reservation = RootSubagentReservation(
        subagent_type="repository-analyst",
        status="OWNER",
        execution_id="repository-analyst:owner",
        trigger="RULE_ANALYSIS",
    )
    lifecycle.reserve_subagent.return_value = reservation
    lifecycle.owner_instruction.return_value = ""
    lifecycle.complete_subagent.return_value = {"status": "COMPLETE"}
    specialist = MagicMock()
    specialist.invoke.return_value = {"messages": []}
    factory = MagicMock(return_value=specialist)
    context = LCSPRunContext(
        assessment_id="assessment-1",
        user_id="user-1",
        workflow_run_id="workflow-1",
        engineering_rule_ids=("ENG-1",),
        rule_execution_id="exec-1",
    )
    definition = _definition() | {"name": "repository-analyst"}
    definition.pop("response_format")
    dispatcher = RootSubagentDispatcher(
        lifecycle=lifecycle,
        agent_factory=factory,
        subagents={"repository-analyst": definition},
    )

    result = dispatcher.dispatch(
        subagent_type="repository-analyst",
        instruction="Analyze one pinned rule.",
        affected_rule_ids=["ENG-1"],
        context=context,
    )

    assert result["status"] == "COMPLETED"
    # Results travel through the governed submit tool, not a structured handoff.
    assert result["handoff"] is None
    assert "response_format" not in factory.call_args.kwargs
    # Governed tools read the trusted run context from ToolRuntime.
    assert factory.call_args.kwargs["context_schema"] is LCSPRunContext
    assert specialist.invoke.call_args.kwargs["context"] is context
    lifecycle.complete_subagent.assert_called_once_with(reservation)


def test_root_dispatcher_does_not_auto_promote_verified_episode() -> None:
    lifecycle = MagicMock()
    reservation = RootSubagentReservation(
        subagent_type="repository-analyst",
        status="OWNER",
        execution_id="repository-analyst:owner",
        trigger="RULE_ANALYSIS",
    )
    lifecycle.reserve_subagent.return_value = reservation
    lifecycle.owner_instruction.return_value = ""
    lifecycle.complete_subagent.return_value = {"status": "COMPLETE"}
    specialist = MagicMock()
    specialist.invoke.return_value = {"messages": []}
    dispatcher = RootSubagentDispatcher(
        lifecycle=lifecycle,
        agent_factory=MagicMock(return_value=specialist),
        subagents={"repository-analyst": _definition("repository-analyst", handoff=False)},
    )

    result = dispatcher.dispatch(
        subagent_type="repository-analyst",
        instruction="Analyze one pinned rule.",
        affected_rule_ids=["RULE-1"],
        metadata={
            "assessment_id": "assessment-1",
            "artifact_versions": {"legalRuleCatalogVersionId": "catalog-1"},
        },
        thread_id="workflow-1",
        trigger="RULE_ANALYSIS",
    )

    assert result["episode"] == {"captured": False}


def test_root_dispatcher_releases_specialist_policy_when_agent_fails() -> None:
    lifecycle = MagicMock()
    reservation = RootSubagentReservation(
        subagent_type="interview",
        status="OWNER",
        execution_id="interview:owner",
        trigger="INTERVIEW",
    )
    lifecycle.reserve_subagent.return_value = reservation
    lifecycle.owner_instruction.return_value = ""
    specialist = MagicMock()
    specialist.invoke.side_effect = RuntimeError("model failed")
    dispatcher = RootSubagentDispatcher(
        lifecycle=lifecycle,
        agent_factory=MagicMock(return_value=specialist),
        subagents={"interview": _definition()},
    )

    with pytest.raises(RuntimeError, match="model failed"):
        dispatcher.dispatch(
            subagent_type="interview",
            instruction="Interview the customer.",
            trigger="INTERVIEW",
            )

    lifecycle.fail_subagent.assert_called_once_with(reservation)
    lifecycle.complete_subagent.assert_not_called()


@pytest.mark.parametrize("result", [{"messages": []}, {"structured_response": None}])
def test_root_dispatcher_fails_policy_when_structured_handoff_is_missing(result) -> None:
    lifecycle = MagicMock()
    reservation = RootSubagentReservation(
        subagent_type="interview",
        status="OWNER",
        execution_id="interview:owner",
        trigger="INTERVIEW",
    )
    lifecycle.reserve_subagent.return_value = reservation
    lifecycle.owner_instruction.return_value = ""
    specialist = MagicMock()
    specialist.invoke.return_value = result
    dispatcher = RootSubagentDispatcher(
        lifecycle=lifecycle,
        agent_factory=MagicMock(return_value=specialist),
        subagents={"interview": _definition()},
    )

    with pytest.raises(RuntimeError, match="structured_response"):
        dispatcher.dispatch(
            subagent_type="interview",
            instruction="Interview the customer.",
            trigger="INTERVIEW",
            )

    lifecycle.fail_subagent.assert_called_once_with(reservation)
    lifecycle.complete_subagent.assert_not_called()


@pytest.mark.parametrize("subagent_type", ["interview", "repository-analyst"])
def test_default_agent_factory_builds_each_specialist_definition(monkeypatch, subagent_type) -> None:
    """Assessment 7976a135 regression: the real factory must accept real definitions.

    Specialists are built with Deep Agents' own ``create_deep_agent`` from the same
    definition dict the root ``task`` tool uses, so each role and budget middleware
    appears exactly once and the model spec resolves through the LCSP profiles.
    """
    import deepagents.graph as deep_graph
    from deepagents import create_deep_agent

    from subagents import FLOW_SUBAGENTS

    monkeypatch.setenv("OPENAI_API_KEY", "test-openai-key")
    monkeypatch.setenv("LLM7_API_KEY", "test-llm7-key")
    compiled: dict[str, list[str]] = {}
    real_create_agent = deep_graph.create_agent

    def recording_create_agent(model, **kwargs):
        compiled[kwargs["name"]] = [middleware.name for middleware in kwargs["middleware"]]
        return real_create_agent(model, **kwargs)

    monkeypatch.setattr(deep_graph, "create_agent", recording_create_agent)
    definition = next(item for item in FLOW_SUBAGENTS if item["name"] == subagent_type)

    factory = RootSubagentDispatcher()._agent_factory
    assert factory is create_deep_agent
    factory(
        model=resolve_agent_model(subagent_type),
        tools=definition["tools"],
        system_prompt=definition["system_prompt"],
        middleware=definition["middleware"],
        name=f"lcsp-{subagent_type}-root-dispatch",
    )

    stack = compiled[f"lcsp-{subagent_type}-root-dispatch"]
    assert stack.count("AgentRoleMiddleware") == 1
