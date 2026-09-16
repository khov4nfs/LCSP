"""Targeted exact resume must re-evaluate only the pinned rule scope."""
from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import MagicMock

from tools.common.capabilities.assessment.claims.evidence_claim.models import (
    ENGINEERING_LIMITATION_CODES,
    InvestigationPacket,
)
from tools.common.capabilities.assessment.investigation.engineering_rule.managed_targeted_investigator import (
    _ExactResumePlanner,
    _ResumedHandoffInvestigator,
)
from tools.common.capabilities.assessment.investigation.engineering_rule.planned_pipeline import (
    PlannedEngineeringInvestigationPipeline,
)
from tools.common.capabilities.assessment.planning.engineering_rule.confirmed_business_context import (
    ConfirmedBusinessContextStatement,
    ConfirmedStructuredBusinessContext,
)
from tools.common.capabilities.evidence.graph.schema.models import ProgramEvidenceGraph

RULE_IDS = ("eng-1", "eng-2", "eng-3")
AFFECTED_RULE_ID = "eng-2"


def _graph() -> ProgramEvidenceGraph:
    return ProgramEvidenceGraph(
        graph_id="graph-1",
        snapshot_id="snapshot-1",
        commit_sha="abc123",
        node_count=1,
        edge_count=0,
        nodes=[
            {
                "node_id": "node:ai:1",
                "node_type": "AI_MODEL_INVOCATION",
                "label": "AI call",
                "semantic_types": [],
                "evidence_refs": ["evidence:ai:1"],
            }
        ],
        edges=[],
        source_anchors=[],
        graph_hash="sha256:graph",
    )


def _engineering_rule(rule_id: str):
    return SimpleNamespace(
        engineering_rule_id=rule_id,
        legal_rule_id=f"legal-{rule_id}",
        concept=rule_id.upper(),
        legal_intent={},
        investigation_goals=("inspect",),
        required_evidence=("CONTROL",),
        starting_node_types=("AI_MODEL_INVOCATION",),
        target_node_types=(),
    )


def _packet(rule_id: str) -> InvestigationPacket:
    return InvestigationPacket(
        engineering_rule_id=rule_id,
        concept=rule_id.upper(),
        investigation_goals=("inspect",),
        initial_results=(
            {
                "nodes": [{"node_id": "node:ai:1", "node_type": "AI_MODEL_INVOCATION"}],
                "evidenceRefs": ["evidence:ai:1"],
            },
        ),
        evidence_refs=("evidence:ai:1",),
        required_evidence=("CONTROL",),
    )


def _new_revision_context(revision: int) -> ConfirmedStructuredBusinessContext:
    return ConfirmedStructuredBusinessContext(
        assessment_id="assessment-1",
        context_revision=revision,
        statements=(
            ConfirmedBusinessContextStatement(
                statement_id="stmt-decision-authority",
                topic="decision_authority",
                statement="A human manager must approve before action.",
                normalized_value="human_manager_approval_required",
                scope={"assessmentId": "assessment-1"},
                evidence_refs=("evidence:customer:1",),
                respondent_ref="actor:authenticated:1",
                created_at="2026-09-05T00:00:00Z",
                supersedes_statement_id=None,
            ),
        ),
        limitations=("customer confirmed only current statement set",),
        policy_decision_ref="policy-decision-1",
        source_version_ref="snapshot-1:abc123",
        pge_version="pge-1:v1",
        guidance_version="guidance-1",
        created_by_actor_ref="actor:runtime:1",
    )


def _resumed_handoff() -> dict:
    return {
        "status": "READY",
        "artifact_versions": {"technicalEvidenceReportId": "ter-1"},
        "claims": [
            {
                "claim_id": "claim-resumed",
                "engineering_rule_id": AFFECTED_RULE_ID,
                "claim_type": "UNRESOLVED_ENGINEERING_FACT",
                "value": None,
                "evidence_refs": ["evidence:ai:1"],
                "graph_path_refs": [],
                "source_anchor_refs": [],
                "confidence": 0.5,
                "limitations": [
                    ENGINEERING_LIMITATION_CODES["engineering_evidence_insufficient"]
                ],
                "criterion": "Human approval gate exists",
            }
        ],
        "limitations": [],
        "missing_input": None,
        "next_step": "GATE",
    }


def test_exact_resume_selects_only_affected_rule_even_when_openwiki_is_unavailable(
    monkeypatch,
) -> None:
    # If OpenWiki were consulted, this unavailable runtime would trigger the
    # OPENWIKI_REQUIRED_FALLBACK_ALL plan and widen the resume to every rule.
    monkeypatch.setenv("OPENWIKI_RUNTIME_COMMAND", "missing-openwiki-runtime-command")
    api_client = MagicMock()
    api_client.get_active_legal_rule_catalog.return_value = {
        "versionId": "catalog-v1",
        "rules": [
            {"legalRuleId": f"legal-{rule_id}", "status": "APPROVED"}
            for rule_id in RULE_IDS
        ],
    }
    api_client.get_active_legal_corpus.return_value = {"versionId": "corpus-v1"}
    api_client.get_legal_corpus_chunks.return_value = {
        "chunks": [{"id": "LAW:A1", "content": "approved legal text"}]
    }
    rule_service = MagicMock()
    rule_service.get_or_compile.side_effect = [
        ([_engineering_rule(rule_id)], True) for rule_id in RULE_IDS
    ]
    query_executor = MagicMock()
    query_executor.execute.side_effect = [_packet(rule_id) for rule_id in RULE_IDS]
    evaluator = MagicMock()
    evaluator.evaluate.side_effect = lambda rule, _claims: SimpleNamespace(
        engineering_rule_id=rule.engineering_rule_id,
        status="UNKNOWN",
        evidence_refs=("evidence:ai:1",),
    )
    assert _ExactResumePlanner.requires_openwiki_context is False

    pipeline = PlannedEngineeringInvestigationPipeline(
        api_client=api_client,
        model="test:model",
        retriever=MagicMock(),
        rule_service=rule_service,
        query_executor=query_executor,
        planner=_ExactResumePlanner((AFFECTED_RULE_ID,)),
        investigator=_ResumedHandoffInvestigator(
            affected_rule_ids=(AFFECTED_RULE_ID,),
            handoff=_resumed_handoff(),
        ),
        evaluator=evaluator,
    )

    result = pipeline.run(
        evidence_report={"evidence_payload": {"evidence_graph": _graph().to_dict()}},
        workflow_run_id="investigator:exec-1:gate:4",
        confirmed_customer_context=_new_revision_context(4),
        workspace_path=None,
        scan_job_id="scan-1",
    )

    assert result.engineering_rules_executed == 1
    assert [item.engineering_rule_id for item in result.evaluations] == [AFFECTED_RULE_ID]
    assert {
        row["engineering_rule_id"]: row["final_decision"]
        for row in result.planner_decisions
    } == {"eng-1": "SKIP", "eng-2": "SELECT", "eng-3": "SKIP"}
    assert {row["reason_code"] for row in result.planner_decisions} == {
        "TARGETED_EXACT_RESUME_PIN"
    }
    assert {row["interviewContextRevisionUsed"] for row in result.planner_decisions} == {4}
    assert not result.planner_fallback_used
    assert result.observability["openwiki"] == {
        "available": False,
        "skipped": "DETERMINISTIC_PLANNER_DOES_NOT_USE_OPENWIKI",
    }
    assert ENGINEERING_LIMITATION_CODES["engineering_investigation_failed"] not in (
        result.limitations
    )
    emitted = [call.args[1] for call in api_client.post_scan_runtime_event.call_args_list]
    assert not [event for event in emitted if event["event_type"] == "TOOL_FAILED"]
    investigated = [
        event["tool_name"]
        for event in emitted
        if event["tool_name"].startswith("engineering_rule_investigation:")
    ]
    assert investigated == [f"engineering_rule_investigation:{AFFECTED_RULE_ID}"]
