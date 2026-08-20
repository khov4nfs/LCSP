from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import MagicMock

from lcsp_workers.investigation.engineering_rule_planner import (
    ENGINEERING_RULE_PLAN_BASIS,
    ENGINEERING_RULE_PLAN_DECISIONS,
    ENGINEERING_RULE_PLAN_REASON_CODES,
    EngineeringRulePlan,
    EngineeringRulePlanner,
    EngineeringRulePlanningCandidate,
)
from lcsp_workers.investigation.models import EvidenceClaim, InvestigationPacket
from lcsp_workers.investigation.planned_pipeline import PlannedEngineeringInvestigationPipeline
from lcsp_workers.scanner.program_graph.models import ProgramEvidenceGraph


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


def _candidate(rule_id: str, *, source_hits: int) -> EngineeringRulePlanningCandidate:
    return EngineeringRulePlanningCandidate(
        engineering_rule_id=rule_id,
        concept=rule_id.upper(),
        legal_intent={},
        investigation_goals=("inspect",),
        required_evidence=("CONTROL",),
        starting_node_types=("AI_MODEL_INVOCATION",),
        target_node_types=(),
        source_hit_count=source_hits,
        source_evidence_count=source_hits,
        source_node_types=("AI_MODEL_INVOCATION",) if source_hits else (),
    )


def _tool_response(decisions: list[dict]):
    return SimpleNamespace(
        tool_calls=(
            SimpleNamespace(
                name="submit_engineering_rule_plan",
                arguments={"decisions": decisions},
            ),
        )
    )


def test_planner_selects_only_relevant_rules() -> None:
    llm = MagicMock()
    llm.complete_with_tools.return_value = _tool_response(
        [
            {
                "engineeringRuleId": "eng-general",
                "decision": ENGINEERING_RULE_PLAN_DECISIONS["select"],
                "reasonCode": ENGINEERING_RULE_PLAN_REASON_CODES[
                    "wizard_and_source_match"
                ],
                "basis": [
                    ENGINEERING_RULE_PLAN_BASIS["wizard"],
                    ENGINEERING_RULE_PLAN_BASIS["source"],
                ],
            },
            {
                "engineeringRuleId": "eng-health",
                "decision": ENGINEERING_RULE_PLAN_DECISIONS["skip"],
                "reasonCode": ENGINEERING_RULE_PLAN_REASON_CODES[
                    "wizard_scope_excludes"
                ],
                "basis": [ENGINEERING_RULE_PLAN_BASIS["wizard"]],
            },
        ]
    )

    result = EngineeringRulePlanner(llm).plan(
        candidates=(
            _candidate("eng-general", source_hits=2),
            _candidate("eng-health", source_hits=0),
        ),
        wizard_context={"sector": "GENERAL_BUSINESS"},
        graph=_graph(),
        workflow_run_id="workflow-1",
    )

    assert result.selected_rule_ids == ("eng-general",)
    assert result.skipped_rule_ids == ("eng-health",)
    assert result.fallback_used is False
    llm.complete_with_tools.assert_called_once()


def test_planner_cannot_skip_source_backed_rule_using_wizard_only() -> None:
    llm = MagicMock()
    llm.complete_with_tools.return_value = _tool_response(
        [
            {
                "engineeringRuleId": "eng-source-conflict",
                "decision": ENGINEERING_RULE_PLAN_DECISIONS["skip"],
                "reasonCode": ENGINEERING_RULE_PLAN_REASON_CODES[
                    "wizard_scope_excludes"
                ],
                "basis": [ENGINEERING_RULE_PLAN_BASIS["wizard"]],
            },
            {
                "engineeringRuleId": "eng-other",
                "decision": ENGINEERING_RULE_PLAN_DECISIONS["skip"],
                "reasonCode": ENGINEERING_RULE_PLAN_REASON_CODES["no_scope_signal"],
                "basis": [ENGINEERING_RULE_PLAN_BASIS["wizard"]],
            },
        ]
    )

    result = EngineeringRulePlanner(llm).plan(
        candidates=(
            _candidate("eng-source-conflict", source_hits=1),
            _candidate("eng-other", source_hits=0),
        ),
        wizard_context={"highImpactIndicators": ["NONE"]},
        graph=_graph(),
        workflow_run_id="workflow-1",
    )

    assert result.selected_rule_ids == ("eng-source-conflict",)
    assert result.skipped_rule_ids == ("eng-other",)


def test_invalid_plan_falls_back_to_all_candidates() -> None:
    llm = MagicMock()
    llm.complete_with_tools.return_value = _tool_response(
        [
            {
                "engineeringRuleId": "invented-rule",
                "decision": ENGINEERING_RULE_PLAN_DECISIONS["select"],
                "reasonCode": ENGINEERING_RULE_PLAN_REASON_CODES[
                    "uncertain_scope_investigate"
                ],
                "basis": [ENGINEERING_RULE_PLAN_BASIS["rule_contract"]],
            }
        ]
    )

    result = EngineeringRulePlanner(llm).plan(
        candidates=(
            _candidate("eng-1", source_hits=0),
            _candidate("eng-2", source_hits=0),
        ),
        wizard_context={},
        graph=_graph(),
        workflow_run_id="workflow-1",
    )

    assert result.selected_rule_ids == ("eng-1", "eng-2")
    assert result.skipped_rule_ids == ()
    assert result.fallback_used is True


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
                "nodes": [
                    {
                        "node_id": "node:ai:1",
                        "node_type": "AI_MODEL_INVOCATION",
                    }
                ],
                "evidenceRefs": ["evidence:ai:1"],
            },
        ),
        evidence_refs=("evidence:ai:1",),
        required_evidence=("CONTROL",),
    )


def test_planned_pipeline_investigates_only_selected_rule() -> None:
    api_client = MagicMock()
    api_client.get_active_legal_rule_catalog.return_value = {
        "versionId": "catalog-v1",
        "rules": [
            {"legalRuleId": "legal-1", "status": "APPROVED"},
            {"legalRuleId": "legal-2", "status": "APPROVED"},
        ],
    }
    api_client.get_active_legal_corpus.return_value = {"versionId": "corpus-v1"}
    api_client.get_legal_corpus_chunks.return_value = {"chunks": []}

    rule_one = _engineering_rule("eng-1")
    rule_two = _engineering_rule("eng-2")
    rule_service = MagicMock()
    rule_service.get_or_compile.side_effect = [([rule_one], True), ([rule_two], True)]

    query_executor = MagicMock()
    query_executor.execute.side_effect = [_packet("eng-1"), _packet("eng-2")]

    planner = MagicMock()
    planner.plan.return_value = EngineeringRulePlan(
        selected_rule_ids=("eng-1",),
        skipped_rule_ids=("eng-2",),
    )

    claim = EvidenceClaim(
        claim_id="claim-1",
        engineering_rule_id="eng-1",
        claim_type="RULE_REQUIREMENT_MET",
        value=True,
        evidence_refs=("evidence:ai:1",),
        confidence=0.9,
    )
    investigator = MagicMock()
    investigator.investigate.return_value = [claim]

    evaluation = SimpleNamespace(
        engineering_rule_id="eng-1",
        status="COMPLIANT",
        evidence_refs=("evidence:ai:1",),
    )
    evaluator = MagicMock()
    evaluator.evaluate.return_value = evaluation

    retriever = MagicMock()
    pipeline = PlannedEngineeringInvestigationPipeline(
        api_client=api_client,
        llm_client=MagicMock(),
        retriever=retriever,
        rule_service=rule_service,
        query_executor=query_executor,
        investigator=investigator,
        evaluator=evaluator,
        planner=planner,
    )

    evidence_report = {
        "evidence_payload": {"evidence_graph": _graph().to_dict()}
    }
    result = pipeline.run(
        evidence_report=evidence_report,
        workflow_run_id="workflow-1",
        wizard_context={"sector": "GENERAL_BUSINESS"},
    )

    assert result.engineering_rules_executed == 1
    assert len(result.evaluations) == 1
    assert result.evaluations[0].engineering_rule_id == "eng-1"
    investigator.investigate.assert_called_once()
    planner.plan.assert_called_once()
