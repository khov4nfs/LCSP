from __future__ import annotations

from unittest.mock import MagicMock

import pytest

from contracts.handoffs import InvestigatorResult, TriageResult
from orchestration.context import LCSPRunContext
from orchestration.dispatcher import RootSubagentDispatcher
from orchestration.lifecycle import RootSubagentReservation


def _definition() -> dict:
    return {
        "name": "triage",
        "model": "test-model",
        "tools": [],
        "system_prompt": "triage prompt",
        "middleware": [],
        "response_format": TriageResult,
    }


def _investigator_definition() -> dict:
    return {
        "name": "investigator",
        "model": "test-model",
        "tools": [],
        "system_prompt": "investigator prompt",
        "middleware": [],
        "response_format": InvestigatorResult,
    }


def _program_graph() -> dict:
    return {
        "graph_id": "graph-1",
        "snapshot_id": "snapshot-1",
        "commit_sha": "abc123",
        "node_count": 1,
        "edge_count": 0,
        "nodes": [
            {
                "node_id": "node:ai",
                "node_type": "AI_MODEL_INVOCATION",
                "label": "responses.create",
                "source": {},
                "attributes": {},
                "semantic_types": [],
                "evidence_refs": [],
                "origin": "STATIC_ANALYSIS",
                "resolution_state": "CORROBORATED",
                "support_refs": [],
            }
        ],
        "edges": [],
        "source_anchors": [],
        "evidence_refs": [],
        "graph_hash": "sha256:graph",
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
        reenter_root=False,
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


def test_root_dispatcher_prefers_reentering_managed_root_thread() -> None:
    root = MagicMock()
    root.invoke.return_value = {"messages": [{"role": "assistant", "content": "queued"}]}
    lifecycle = MagicMock()
    factory = MagicMock()
    dispatcher = RootSubagentDispatcher(
        lifecycle=lifecycle,
        agent_factory=factory,
        root_agent=root,
        subagents={"triage": _definition()},
    )
    context = LCSPRunContext(
        assessment_id="assessment-1",
        user_id="user-1",
        workflow_run_id="workflow-1",
        artifact_versions={"technicalEvidenceReportId": "ter-1"},
    )

    result = dispatcher.dispatch(
        subagent_type="triage",
        instruction="Run bounded legal preparation.",
        affected_rule_ids=["RULE-1"],
        idempotency_key="legal-triage:key",
        trigger="ENGINEERING_RULE_NOT_READY",
        context=context,
    )

    assert result["status"] == "ROOT_REENTERED"
    assert result["rootReentry"] is True
    assert result["checkpointing"] == {"threadId": "workflow-1", "enabled": True}
    assert result["episode"] == {"captured": False}
    factory.assert_not_called()
    lifecycle.reserve_subagent.assert_not_called()
    root.invoke.assert_called_once()
    assert root.invoke.call_args.kwargs["context"] is context


def test_root_dispatcher_requires_managed_root_for_default_reentry() -> None:
    dispatcher = RootSubagentDispatcher(
        lifecycle=MagicMock(),
        agent_factory=MagicMock(),
        subagents={"triage": _definition()},
    )

    with pytest.raises(RuntimeError, match="managed root agent is required"):
        dispatcher.dispatch(
            subagent_type="triage",
            instruction="Run bounded legal preparation.",
        )


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
        reenter_root=False,
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
            reenter_root=False,
        )
    lifecycle.fail_subagent.assert_called_once_with(reservation)


def test_direct_investigator_hydrates_program_graph_from_pinned_api_metadata() -> None:
    lifecycle = MagicMock()
    reservation = RootSubagentReservation(
        subagent_type="investigator",
        status="OWNER",
        execution_id="investigator:owner",
        trigger="SYSTEM",
    )
    lifecycle.reserve_subagent.return_value = reservation
    lifecycle.owner_instruction.return_value = ""
    lifecycle.complete_subagent.return_value = {"status": "COMPLETE"}
    specialist = MagicMock()
    specialist.invoke.return_value = {
        "structured_response": {
            "status": "READY",
            "artifact_versions": {"technicalEvidenceReportId": "ter-1"},
            "claims": [
                {
                    "claim_id": "claim-1",
                    "engineering_rule_id": "ENG-1",
                    "claim_type": "UNRESOLVED_ENGINEERING_FACT",
                    "value": None,
                    "evidence_refs": [],
                    "graph_path_refs": ["node:ai"],
                    "source_anchor_refs": [],
                    "confidence": 0.9,
                    "limitations": [],
                    "criterion": "AI invocation exists",
                }
            ],
            "limitations": [],
            "missing_input": None,
            "next_step": "GATE",
        }
    }
    api_client = MagicMock()
    api_client.get_accepted_technical_evidence_report.return_value = {
        "evidence_payload": {"evidence_graph": _program_graph()}
    }
    context = LCSPRunContext(
        assessment_id="assessment-1",
        user_id="user-1",
        workflow_run_id="workflow-1",
        artifact_versions={"technicalEvidenceReportId": "ter-1"},
    )
    dispatcher = RootSubagentDispatcher(
        lifecycle=lifecycle,
        agent_factory=MagicMock(return_value=specialist),
        subagents={"investigator": _investigator_definition()},
    )

    result = dispatcher.dispatch(
        subagent_type="investigator",
        instruction="Investigate one pinned rule.",
        affected_rule_ids=["ENG-1"],
        metadata={"api_client": api_client},
        context=context,
        reenter_root=False,
    )

    assert result["status"] == "COMPLETED"
    api_client.get_accepted_technical_evidence_report.assert_called_once_with("ter-1")


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
        reenter_root=False,
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
        reenter_root=False,
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
            reenter_root=False,
        )

    lifecycle.fail_subagent.assert_called_once_with(reservation)
    lifecycle.complete_subagent.assert_not_called()


def test_root_dispatcher_fails_policy_when_structured_handoff_is_missing() -> None:
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
    specialist.invoke.return_value = {"messages": []}
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
            reenter_root=False,
        )

    lifecycle.fail_subagent.assert_called_once_with(reservation)
    lifecycle.complete_subagent.assert_not_called()
