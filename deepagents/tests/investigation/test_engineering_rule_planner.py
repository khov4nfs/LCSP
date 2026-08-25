from __future__ import annotations

import sys
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from tools.common.capabilities.assessment.planning.engineering_rule.engineering_rule_planner import (
    ENGINEERING_RULE_PLAN_BASIS,
    ENGINEERING_RULE_PLAN_DECISIONS,
    ENGINEERING_RULE_PLAN_REASON_CODES,
    EngineeringRulePlan,
    EngineeringRulePlanner,
    EngineeringRulePlanningCandidate,
)
from tools.common.capabilities.assessment.claims.evidence_claim.models import (
    ENGINEERING_LIMITATION_CODES,
    EvidenceClaim,
    InvestigationPacket,
)
from tools.common.capabilities.assessment.investigation.engineering_rule.planned_pipeline import PlannedEngineeringInvestigationPipeline
from tools.common.capabilities.evidence.graph.schema.models import ProgramEvidenceGraph


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
        legal_reasoning_contract={
            "legalRuleId": f"legal-{rule_id}",
            "legalCorpusVersionId": "corpus-v1",
            "legalRuleCatalogVersionId": "catalog-v1",
            "jurisdiction": "VN",
            "effectiveDate": "UNSPECIFIED",
            "applicabilityCriteria": {
                "requiredFacts": [],
                "blockingFacts": [],
                "unknownFactPolicy": "BLOCK_ON_UNKNOWN",
            },
            "requiredEvidence": ["CONTROL"],
            "acceptedEvidenceTypes": ["CONTROL"],
            "negativeEvidenceTypes": [],
            "citationSet": [{"chunkId": f"chunk-{rule_id}", "locator": "art-1"}],
            "validationPolicy": {
                "noCitationNoLegalClaim": True,
                "noSourceAnchorNoRepoClaim": True,
                "failClosedOnMissingEvidence": True,
                "separateApplicabilityFromCompliance": True,
                "deterministicValidatorsBeforeLlmTrust": True,
                "humanLegalSignoffRequired": True,
            },
        },
        starting_node_types=("AI_MODEL_INVOCATION",),
        target_node_types=(),
        source_hit_count=source_hits,
        source_evidence_count=source_hits,
        source_node_types=("AI_MODEL_INVOCATION",) if source_hits else (),
    )


@pytest.fixture
def native_agent(monkeypatch):
    agent = MagicMock()
    monkeypatch.setattr(
        sys.modules[EngineeringRulePlanner.__module__],
        "create_agent",
        lambda **_kwargs: agent,
    )
    return agent


def _structured_response(decisions: list[dict]):
    return {"structured_response": {"decisions": decisions}}


def test_planner_selects_only_relevant_rules(native_agent) -> None:
    native_agent.invoke.return_value = _structured_response(
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

    result = EngineeringRulePlanner().plan(
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
    native_agent.invoke.assert_called_once()


def test_planner_cannot_skip_source_backed_rule_using_wizard_only(native_agent) -> None:
    native_agent.invoke.return_value = _structured_response(
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

    result = EngineeringRulePlanner().plan(
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


def test_invalid_plan_falls_back_to_all_candidates(native_agent) -> None:
    native_agent.invoke.return_value = _structured_response(
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

    result = EngineeringRulePlanner().plan(
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


def test_planner_prompt_contains_legal_reasoning_contract() -> None:
    prompt = EngineeringRulePlanner._prompt(
        (_candidate("eng-contract", source_hits=0),),
        wizard_context={"sector": "GENERAL_BUSINESS"},
        graph=_graph(),
    )

    assert "LegalReasoningContract" in prompt
    assert "citationSet" in prompt
    assert '"legalCorpusVersionId":"corpus-v1"' in prompt
    assert "Do not create legal claims or compliance conclusions" in prompt


def test_planner_prompt_treats_openwiki_as_unverified_hint_only() -> None:
    prompt = EngineeringRulePlanner._prompt(
        (_candidate("eng-contract", source_hits=0),),
        wizard_context={"sector": "GENERAL_BUSINESS"},
        graph=_graph(),
        openwiki_context={
            "source": "openwiki",
            "available": True,
            "authority": "UNVERIFIED_ARCHITECTURE_HINT",
            "policy": "May prioritize planner investigation only.",
            "hintCount": 1,
            "hints": [
                {
                    "path": "openwiki/architecture/overview.md",
                    "title": "Architecture",
                    "snippet": "AI review workflow uses human oversight.",
                    "matchedTerms": ["AI", "review"],
                    "authority": "UNVERIFIED_ARCHITECTURE_HINT",
                    "policy": "May prioritize planner investigation only.",
                }
            ],
        },
    )

    assert "openWikiArchitectureHints" in prompt
    assert "UNVERIFIED_ARCHITECTURE_HINT" in prompt
    assert "not SOURCE basis" in prompt
    assert "not proof of compliance" in prompt


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


def test_planned_pipeline_investigates_only_selected_rule(tmp_path) -> None:
    wiki = tmp_path / "openwiki" / "architecture"
    wiki.mkdir(parents=True)
    (wiki / "overview.md").write_text(
        "# Architecture\n\nAI model invocation flows through a review surface.",
        encoding="utf-8",
    )

    api_client = MagicMock()
    api_client.get_active_legal_rule_catalog.return_value = {
        "versionId": "catalog-v1",
        "rules": [
            {"legalRuleId": "legal-1", "status": "APPROVED"},
            {"legalRuleId": "legal-2", "status": "APPROVED"},
        ],
    }
    api_client.get_active_legal_corpus.return_value = {"versionId": "corpus-v1"}
    api_client.get_legal_corpus_chunks.return_value = {
        "chunks": [{"id": "LAW:A1", "content": "approved legal text"}]
    }

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
        model="test:model",
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
        workspace_path=tmp_path,
    )

    assert result.engineering_rules_executed == 1
    assert len(result.evaluations) == 1
    assert result.evaluations[0].engineering_rule_id == "eng-1"
    investigator.investigate.assert_called_once()
    planner.plan.assert_called_once()
    assert planner.plan.call_args.kwargs["openwiki_context"]["available"] is True
    assert (
        planner.plan.call_args.kwargs["openwiki_context"]["authority"]
        == "UNVERIFIED_ARCHITECTURE_HINT"
    )


def test_planned_pipeline_falls_back_all_when_openwiki_runtime_context_missing(
    tmp_path,
    monkeypatch,
) -> None:
    monkeypatch.setenv("OPENWIKI_RUNTIME_COMMAND", "missing-openwiki-runtime-command")

    api_client = MagicMock()
    api_client.get_active_legal_rule_catalog.return_value = {
        "versionId": "catalog-v1",
        "rules": [
            {"legalRuleId": "legal-1", "status": "APPROVED"},
            {"legalRuleId": "legal-2", "status": "APPROVED"},
        ],
    }
    api_client.get_active_legal_corpus.return_value = {"versionId": "corpus-v1"}
    api_client.get_legal_corpus_chunks.return_value = {
        "chunks": [{"id": "LAW:A1", "content": "approved legal text"}]
    }

    rule_service = MagicMock()
    rule_service.get_or_compile.side_effect = [
        ([_engineering_rule("eng-1")], True),
        ([_engineering_rule("eng-2")], True),
    ]
    query_executor = MagicMock()
    query_executor.execute.side_effect = [_packet("eng-1"), _packet("eng-2")]
    planner = MagicMock()

    investigator = MagicMock()
    investigator.investigate.side_effect = [
        [
            EvidenceClaim(
                claim_id="claim-1",
                engineering_rule_id="eng-1",
                claim_type="RULE_REQUIREMENT_MET",
                value=True,
                evidence_refs=("evidence:ai:1",),
                confidence=0.9,
            )
        ],
        [
            EvidenceClaim(
                claim_id="claim-2",
                engineering_rule_id="eng-2",
                claim_type="RULE_REQUIREMENT_MET",
                value=True,
                evidence_refs=("evidence:ai:1",),
                confidence=0.9,
            )
        ],
    ]
    evaluator = MagicMock()
    evaluator.evaluate.side_effect = [
        SimpleNamespace(
            engineering_rule_id="eng-1",
            status="COMPLIANT",
            evidence_refs=("evidence:ai:1",),
        ),
        SimpleNamespace(
            engineering_rule_id="eng-2",
            status="COMPLIANT",
            evidence_refs=("evidence:ai:1",),
        ),
    ]

    pipeline = PlannedEngineeringInvestigationPipeline(
        api_client=api_client,
        model="test:model",
        retriever=MagicMock(),
        rule_service=rule_service,
        query_executor=query_executor,
        investigator=investigator,
        evaluator=evaluator,
        planner=planner,
    )

    result = pipeline.run(
        evidence_report={"evidence_payload": {"evidence_graph": _graph().to_dict()}},
        workflow_run_id="workflow-1",
        wizard_context={"sector": "GENERAL_BUSINESS"},
        workspace_path=tmp_path,
    )

    planner.plan.assert_not_called()
    assert result.engineering_rules_executed == 2
    assert [item.engineering_rule_id for item in result.evaluations] == [
        "eng-1",
        "eng-2",
    ]
    assert result.observability["openwiki"] == {
        "available": False,
        "error": "OPENWIKI_RUNTIME_COMMAND_UNAVAILABLE",
        "fallback": "OPENWIKI_REQUIRED_FALLBACK_ALL",
    }
    assert result.observability["candidate_source_hit_distribution"][
        "candidate_count"
    ] == 2
    assert result.observability["planner_decision_distribution"][
        "validation_override_counts"
    ] == {"OPENWIKI_REQUIRED_FALLBACK_ALL": 2}


def test_planned_pipeline_persists_compile_failure_observability(
    tmp_path,
    monkeypatch,
) -> None:
    monkeypatch.setenv("OPENWIKI_RUNTIME_COMMAND", "missing-openwiki-runtime-command")

    api_client = MagicMock()
    api_client.get_active_legal_rule_catalog.return_value = {
        "versionId": "catalog-v1",
        "rules": [
            {"legalRuleId": "legal-broken", "status": "APPROVED"},
            {"legalRuleId": "legal-ok", "status": "APPROVED"},
        ],
    }
    api_client.get_active_legal_corpus.return_value = {"versionId": "corpus-v1"}
    api_client.get_legal_corpus_chunks.return_value = {
        "chunks": [{"id": "LAW:A1", "content": "approved legal text"}]
    }

    rule_service = MagicMock()
    rule_service.get_or_compile.side_effect = [
        ValueError("compiler structured response must be object"),
        ([_engineering_rule("eng-ok")], False),
    ]
    query_executor = MagicMock()
    query_executor.execute.return_value = _packet("eng-ok")
    investigator = MagicMock()
    investigator.investigate.return_value = [
        EvidenceClaim(
            claim_id="claim-1",
            engineering_rule_id="eng-ok",
            claim_type="RULE_REQUIREMENT_MET",
            value=True,
            evidence_refs=("evidence:ai:1",),
            confidence=0.9,
        )
    ]
    evaluator = MagicMock()
    evaluator.evaluate.return_value = SimpleNamespace(
        engineering_rule_id="eng-ok",
        status="COMPLIANT",
        evidence_refs=("evidence:ai:1",),
    )

    pipeline = PlannedEngineeringInvestigationPipeline(
        api_client=api_client,
        model="test:model",
        retriever=MagicMock(),
        rule_service=rule_service,
        query_executor=query_executor,
        investigator=investigator,
        evaluator=evaluator,
        planner=MagicMock(),
    )

    result = pipeline.run(
        evidence_report={"evidence_payload": {"evidence_graph": _graph().to_dict()}},
        workflow_run_id="workflow-1",
        workspace_path=tmp_path,
    )

    preparation = result.observability["engineering_rule_preparation"]
    assert result.status == "PARTIAL"
    assert preparation["legal_rules_seen"] == 2
    assert preparation["candidate_count"] == 1
    assert preparation["compile_failed_count"] == 1
    assert preparation["compile_failed_legal_rule_ids"] == ["legal-broken"]
    assert preparation["compile_failures"] == [
        {
            "legal_rule_id": "legal-broken",
            "error_type": "ValueError",
            "error_message": "compiler structured response must be object",
        }
    ]


def test_planned_pipeline_recovers_corpus_sources_and_retries_when_no_rules_prepare(
    tmp_path,
    monkeypatch,
) -> None:
    monkeypatch.setenv("OPENWIKI_RUNTIME_COMMAND", "missing-openwiki-runtime-command")

    api_client = MagicMock()
    api_client.get_active_legal_rule_catalog.return_value = {
        "versionId": "catalog-v1",
        "rules": [{"legalRuleId": "legal-1", "status": "APPROVED"}],
    }
    api_client.get_active_legal_corpus.side_effect = [
        {"versionId": "corpus-stale"},
        {"versionId": "corpus-rebuilt"},
    ]
    api_client.get_legal_corpus_chunks.side_effect = [
        {"chunks": []},
        {"chunks": [{"id": "LAW:A1", "content": "rebuilt legal chunk"}]},
    ]

    recovery_driver = MagicMock()
    recovery_driver.run.return_value = {
        "status": "READY",
        "corpusVersionId": "corpus-rebuilt",
    }

    rule_service = MagicMock()
    rule_service.get_or_compile.return_value = ([_engineering_rule("eng-1")], False)
    query_executor = MagicMock()
    query_executor.execute.return_value = _packet("eng-1")
    investigator = MagicMock()
    investigator.investigate.return_value = [
        EvidenceClaim(
            claim_id="claim-1",
            engineering_rule_id="eng-1",
            claim_type="RULE_REQUIREMENT_MET",
            value=True,
            evidence_refs=("evidence:ai:1",),
            confidence=0.9,
        )
    ]
    evaluator = MagicMock()
    evaluator.evaluate.return_value = SimpleNamespace(
        engineering_rule_id="eng-1",
        status="COMPLIANT",
        evidence_refs=("evidence:ai:1",),
    )

    pipeline = PlannedEngineeringInvestigationPipeline(
        api_client=api_client,
        model="test:model",
        retriever=MagicMock(),
        rule_service=rule_service,
        query_executor=query_executor,
        investigator=investigator,
        evaluator=evaluator,
        planner=MagicMock(),
        corpus_recovery_driver=recovery_driver,
    )

    result = pipeline.run(
        evidence_report={"evidence_payload": {"evidence_graph": _graph().to_dict()}},
        workflow_run_id="workflow-1",
        correlation_id="corr-1",
        workspace_path=tmp_path,
    )

    assert result.status == "COMPLETE"
    assert result.legal_corpus_version_id == "corpus-rebuilt"
    assert result.engineering_rules_executed == 1
    recovery_driver.run.assert_called_once()
    rule_service.get_or_compile.assert_called_once()


def test_planned_pipeline_stops_before_planner_when_corpus_triage_still_missing(
    tmp_path,
) -> None:
    api_client = MagicMock()
    api_client.get_active_legal_rule_catalog.return_value = {
        "versionId": "catalog-v1",
        "rules": [{"legalRuleId": "legal-1", "status": "APPROVED"}],
    }
    api_client.get_active_legal_corpus.return_value = {"versionId": "corpus-v1"}
    api_client.get_legal_corpus_chunks.return_value = {"chunks": []}

    recovery_driver = MagicMock()
    recovery_driver.run.return_value = {
        "status": "READY",
        "corpusVersionId": "corpus-v1",
    }
    rule_service = MagicMock()
    planner = MagicMock()
    investigator = MagicMock()

    pipeline = PlannedEngineeringInvestigationPipeline(
        api_client=api_client,
        model="test:model",
        retriever=MagicMock(),
        rule_service=rule_service,
        query_executor=MagicMock(),
        investigator=investigator,
        evaluator=MagicMock(),
        planner=planner,
        corpus_recovery_driver=recovery_driver,
    )

    result = pipeline.run(
        evidence_report={"evidence_payload": {"evidence_graph": _graph().to_dict()}},
        workflow_run_id="workflow-1",
        correlation_id="corr-1",
        workspace_path=tmp_path,
    )

    assert result.status == "BLOCKED"
    assert result.limitations == (
        ENGINEERING_LIMITATION_CODES["no_legal_corpus_source"],
    )
    recovery_driver.run.assert_called_once()
    rule_service.get_or_compile.assert_not_called()
    planner.plan.assert_not_called()
    investigator.investigate.assert_not_called()


def test_planned_pipeline_waits_when_catalog_has_no_source_rules_after_recovery(
    tmp_path,
) -> None:
    api_client = MagicMock()
    api_client.get_active_legal_rule_catalog.return_value = {
        "versionId": "catalog-v1",
        "rules": [],
    }
    api_client.get_active_legal_corpus.return_value = {"versionId": "corpus-v1"}
    api_client.get_legal_corpus_chunks.return_value = {
        "chunks": [{"id": "LAW:A1", "content": "approved legal text"}]
    }

    recovery_driver = MagicMock()
    recovery_driver.run.return_value = {
        "status": "READY",
        "corpusVersionId": "corpus-v1",
    }
    rule_service = MagicMock()
    planner = MagicMock()
    investigator = MagicMock()

    pipeline = PlannedEngineeringInvestigationPipeline(
        api_client=api_client,
        model="test:model",
        retriever=MagicMock(),
        rule_service=rule_service,
        query_executor=MagicMock(),
        investigator=investigator,
        evaluator=MagicMock(),
        planner=planner,
        corpus_recovery_driver=recovery_driver,
    )

    result = pipeline.run(
        evidence_report={"evidence_payload": {"evidence_graph": _graph().to_dict()}},
        workflow_run_id="workflow-1",
        correlation_id="corr-1",
        workspace_path=tmp_path,
    )

    assert result.status == "WAITING"
    assert result.limitations == (
        ENGINEERING_LIMITATION_CODES["no_engineering_rule_source_rules"],
    )
    recovery_driver.run.assert_called_once()
    rule_service.get_or_compile.assert_not_called()
    planner.plan.assert_not_called()
    investigator.investigate.assert_not_called()


def test_planned_pipeline_stops_before_planner_when_engineering_rule_triage_finds_none(
    tmp_path,
) -> None:
    api_client = MagicMock()
    api_client.get_active_legal_rule_catalog.return_value = {
        "versionId": "catalog-v1",
        "rules": [{"legalRuleId": "legal-1", "status": "APPROVED"}],
    }
    api_client.get_active_legal_corpus.return_value = {"versionId": "corpus-v1"}
    api_client.get_legal_corpus_chunks.return_value = {
        "chunks": [{"id": "LAW:A1", "content": "approved legal text"}]
    }

    recovery_driver = MagicMock()
    recovery_driver.run.return_value = {
        "status": "READY",
        "corpusVersionId": "corpus-v1",
    }
    rule_service = MagicMock()
    rule_service.get_or_compile.return_value = ([], False)
    planner = MagicMock()
    investigator = MagicMock()

    pipeline = PlannedEngineeringInvestigationPipeline(
        api_client=api_client,
        model="test:model",
        retriever=MagicMock(),
        rule_service=rule_service,
        query_executor=MagicMock(),
        investigator=investigator,
        evaluator=MagicMock(),
        planner=planner,
        corpus_recovery_driver=recovery_driver,
    )

    result = pipeline.run(
        evidence_report={"evidence_payload": {"evidence_graph": _graph().to_dict()}},
        workflow_run_id="workflow-1",
        correlation_id="corr-1",
        workspace_path=tmp_path,
    )

    assert result.status == "BLOCKED"
    assert result.limitations == (
        ENGINEERING_LIMITATION_CODES["no_engineering_rule_candidates"],
    )
    recovery_driver.run.assert_called_once()
    assert rule_service.get_or_compile.call_count == 2
    planner.plan.assert_not_called()
    investigator.investigate.assert_not_called()
