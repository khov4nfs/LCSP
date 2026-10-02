from __future__ import annotations

from unittest.mock import MagicMock

import pytest

from model_policy import resolve_agent_model

from contracts.handoffs import TriageResult
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


def _definition() -> dict:
    return {
        "name": "triage",
        "model": "test-model",
        "tools": [],
        "system_prompt": "triage prompt",
        "middleware": [],
        "response_format": TriageResult,
    }


def test_root_dispatcher_owns_triage_begin_and_complete_transitions() -> None:
    lifecycle = MagicMock()
    reservation = RootSubagentReservation(
        subagent_type="triage",
        status="OWNER",
        execution_id="triage:owner",
        trigger="ENGINEERING_RULE_NOT_READY",
    )
    lifecycle.reserve_subagent.return_value = reservation
    lifecycle.owner_instruction.return_value = "ROOT OWNS TRIAGE"
    lifecycle.complete_subagent.return_value = {
        "status": "COMPLETE",
        "assessmentReconciliation": {"resumedAssessmentCount": 2},
    }
    specialist = MagicMock()
    specialist.invoke.return_value = {
        "structured_response": {
            "status": "READY",
            "triage_execution_id": "triage:owner",
            "trigger": "ENGINEERING_RULE_NOT_READY",
            "idempotency_key": "legal-triage:key",
            "legal_rule_catalog_version_id": "catalog-1",
            "legal_corpus_version_id": "corpus-1",
            "triaged_rule_ids": ["RULE-1"],
            "candidate_chunk_ids": ["chunk-1"],
            "context_only_chunk_ids": [],
            "rejected_chunk_ids": [],
            "engineering_rule_ids": ["ENG-1"],
            "limitations": [],
        }
    }
    factory = MagicMock(return_value=specialist)
    dispatcher = RootSubagentDispatcher(
        lifecycle=lifecycle,
        agent_factory=factory,
        subagents={"triage": _definition()},
    )

    result = dispatcher.dispatch(
        subagent_type="triage",
        instruction="Run bounded legal preparation.",
        affected_rule_ids=["RULE-1"],
        idempotency_key="legal-triage:key",
        trigger="ENGINEERING_RULE_NOT_READY",
        metadata={"correlationId": "corr-1"},
        thread_id="triage:legal-triage:key",
    )

    lifecycle.reserve_subagent.assert_called_once_with(
        subagent_type="triage",
        affected_rule_ids=["RULE-1"],
        idempotency_key="legal-triage:key",
        trigger="ENGINEERING_RULE_NOT_READY",
    )
    factory.assert_called_once()
    assert factory.call_args.kwargs["response_format"] is TriageResult
    invoke_input = specialist.invoke.call_args.args[0]
    invoke_config = specialist.invoke.call_args.kwargs["config"]
    assert invoke_input["messages"][0]["content"].startswith("ROOT OWNS TRIAGE")
    assert "Run bounded legal preparation." in invoke_input["messages"][0]["content"]
    assert "configurable" not in invoke_config
    assert invoke_config["metadata"]["lcsp_thread_id"] == "triage:legal-triage:key"
    assert invoke_config["metadata"]["lcsp_thread_checkpointing"] == "disabled"
    lifecycle.complete_subagent.assert_called_once_with(reservation)
    lifecycle.fail_subagent.assert_not_called()
    assert result["status"] == "COMPLETED"
    assert result["executionId"] == "triage:owner"
    assert result["orchestration"]["assessmentReconciliation"]["resumedAssessmentCount"] == 2
    assert result["handoff"]["engineering_rule_ids"] == ["ENG-1"]
    assert result["checkpointing"] == {
        "threadId": "triage:legal-triage:key",
        "enabled": False,
    }
    assert result["episode"] == {"captured": False}


def test_dispatcher_has_no_root_reentry_path() -> None:
    # One orchestrator: the deterministic Python loop dispatches specialists directly; there
    # is no root-model re-entry surface left to call.
    import inspect

    assert "reenter_root" not in inspect.signature(RootSubagentDispatcher.dispatch).parameters
    assert not hasattr(RootSubagentDispatcher, "_dispatch_via_root")


def test_direct_dispatch_passes_context_and_explicit_checkpointer() -> None:
    lifecycle = MagicMock()
    reservation = RootSubagentReservation(
        subagent_type="triage",
        status="OWNER",
        execution_id="triage:owner",
        trigger="SCHEDULED",
    )
    lifecycle.reserve_subagent.return_value = reservation
    lifecycle.owner_instruction.return_value = ""
    lifecycle.complete_subagent.return_value = {"status": "COMPLETE"}
    specialist = MagicMock()
    specialist.invoke.return_value = {
        "structured_response": {
            "status": "READY",
            "triage_execution_id": "triage:owner",
            "trigger": "SCHEDULED",
            "idempotency_key": None,
            "legal_rule_catalog_version_id": "catalog-1",
            "legal_corpus_version_id": "corpus-1",
            "triaged_rule_ids": ["RULE-1"],
            "candidate_chunk_ids": ["chunk-1"],
            "context_only_chunk_ids": [],
            "rejected_chunk_ids": [],
            "engineering_rule_ids": ["ENG-1"],
            "limitations": [],
        }
    }
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
        subagents={"triage": _definition()},
        enable_thread_checkpointing=True,
        checkpointer=checkpointer,
    )

    result = dispatcher.dispatch(
        subagent_type="triage",
        instruction="Run scheduled maintenance.",
        trigger="SCHEDULED",
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
        subagent_type="triage",
        status="OWNER",
        execution_id="triage:owner",
        trigger="SCHEDULED",
    )
    lifecycle.reserve_subagent.return_value = reservation
    lifecycle.owner_instruction.return_value = ""
    dispatcher = RootSubagentDispatcher(
        lifecycle=lifecycle,
        agent_factory=MagicMock(),
        subagents={"triage": _definition()},
        enable_thread_checkpointing=True,
    )

    with pytest.raises(RuntimeError, match="explicit checkpointer"):
        dispatcher.dispatch(
            subagent_type="triage",
            instruction="Run scheduled maintenance.",
            trigger="SCHEDULED",
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
        subagent_type="triage",
        status="OWNER",
        execution_id="triage:owner",
        trigger="SCHEDULED",
    )
    lifecycle.reserve_subagent.return_value = reservation
    lifecycle.owner_instruction.return_value = "ROOT OWNS TRIAGE"
    lifecycle.complete_subagent.return_value = {"status": "COMPLETE"}
    specialist = MagicMock()
    specialist.invoke.return_value = {
        "structured_response": {
            "status": "READY",
            "triage_execution_id": "triage:owner",
            "trigger": "SCHEDULED",
            "idempotency_key": None,
            "legal_rule_catalog_version_id": "catalog-1",
            "legal_corpus_version_id": "corpus-1",
            "triaged_rule_ids": ["RULE-1"],
            "candidate_chunk_ids": ["chunk-1"],
            "context_only_chunk_ids": [],
            "rejected_chunk_ids": [],
            "engineering_rule_ids": ["ENG-1"],
            "limitations": [],
        }
    }
    dispatcher = RootSubagentDispatcher(
        lifecycle=lifecycle,
        agent_factory=MagicMock(return_value=specialist),
        subagents={"triage": _definition()},
    )

    result = dispatcher.dispatch(
        subagent_type="triage",
        instruction="Run scheduled maintenance.",
        affected_rule_ids=["RULE-1"],
        metadata={
            "assessment_id": "assessment-1",
            "artifact_versions": {"legalRuleCatalogVersionId": "catalog-1"},
        },
        thread_id="workflow-1",
        trigger="SCHEDULED",
    )

    assert result["episode"] == {"captured": False}


def test_root_dispatcher_does_not_create_second_triage_when_policy_reports_running() -> None:
    lifecycle = MagicMock()
    lifecycle.reserve_subagent.return_value = RootSubagentReservation(
        subagent_type="triage",
        status="ALREADY_RUNNING",
        execution_id="triage:active",
        trigger="ENGINEERING_RULE_NOT_READY",
    )
    factory = MagicMock()
    dispatcher = RootSubagentDispatcher(
        lifecycle=lifecycle,
        agent_factory=factory,
        subagents={"triage": _definition()},
    )

    result = dispatcher.dispatch(
        subagent_type="triage",
        instruction="Run.",
        affected_rule_ids=["RULE-2"],
        idempotency_key="legal-triage:key2",
        trigger="ENGINEERING_RULE_NOT_READY",
    )

    assert result == {
        "status": "ALREADY_RUNNING",
        "subagentType": "triage",
        "executionId": "triage:active",
        "subagentStarted": False,
    }
    factory.assert_not_called()
    lifecycle.complete_subagent.assert_not_called()


def test_root_dispatcher_releases_specialist_policy_when_agent_fails() -> None:
    lifecycle = MagicMock()
    reservation = RootSubagentReservation(
        subagent_type="triage",
        status="OWNER",
        execution_id="triage:owner",
        trigger="SCHEDULED",
    )
    lifecycle.reserve_subagent.return_value = reservation
    lifecycle.owner_instruction.return_value = "ROOT OWNS TRIAGE"
    specialist = MagicMock()
    specialist.invoke.side_effect = RuntimeError("model failed")
    dispatcher = RootSubagentDispatcher(
        lifecycle=lifecycle,
        agent_factory=MagicMock(return_value=specialist),
        subagents={"triage": _definition()},
    )

    with pytest.raises(RuntimeError, match="model failed"):
        dispatcher.dispatch(
            subagent_type="triage",
            instruction="Run scheduled maintenance.",
            trigger="SCHEDULED",
            )

    lifecycle.fail_subagent.assert_called_once_with(reservation)
    lifecycle.complete_subagent.assert_not_called()


@pytest.mark.parametrize("result", [{"messages": []}, {"structured_response": None}])
def test_root_dispatcher_fails_policy_when_structured_handoff_is_missing(result) -> None:
    lifecycle = MagicMock()
    reservation = RootSubagentReservation(
        subagent_type="triage",
        status="OWNER",
        execution_id="triage:owner",
        trigger="SCHEDULED",
    )
    lifecycle.reserve_subagent.return_value = reservation
    lifecycle.owner_instruction.return_value = "ROOT OWNS TRIAGE"
    specialist = MagicMock()
    specialist.invoke.return_value = result
    dispatcher = RootSubagentDispatcher(
        lifecycle=lifecycle,
        agent_factory=MagicMock(return_value=specialist),
        subagents={"triage": _definition()},
    )

    with pytest.raises(RuntimeError, match="structured_response"):
        dispatcher.dispatch(
            subagent_type="triage",
            instruction="Run scheduled maintenance.",
            trigger="SCHEDULED",
            )

    lifecycle.fail_subagent.assert_called_once_with(reservation)
    lifecycle.complete_subagent.assert_not_called()


@pytest.mark.parametrize("subagent_type", ["triage", "interview", "repository-analyst"])
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
