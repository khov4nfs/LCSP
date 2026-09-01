from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import MagicMock

from tools.common.capabilities.assessment.claims.evidence_claim.models import (
    ENGINEERING_LIMITATION_CODES,
    EvidenceClaim,
    InvestigationPacket,
)
from tools.common.capabilities.assessment.investigation.engineering_rule import pipeline
from tools.common.capabilities.assessment.investigation.engineering_rule.pipeline import EngineeringInvestigationPipeline
from tools.common.capabilities.evidence.graph.schema.models import ProgramEvidenceGraph


def _evidence_report() -> dict:
    return {
        "id": "ter-1",
        "evidence_payload": {
            "evidence_graph": {
                "graph_id": "graph-1",
                "snapshot_id": "snapshot-1",
                "commit_sha": "abc123",
                "node_count": 1,
                "edge_count": 0,
                "nodes": [
                    {
                        "node_id": "node:review-control",
                        "node_type": "CONTROL",
                        "label": "human oversight review controls",
                        "source": {
                            "file_path": "app/review.py",
                            "start_line": 10,
                            "end_line": 20,
                            "symbol_ref": "review_control",
                            "source_hash": "sha256:source",
                        },
                        "evidence_refs": ["evidence:finding-1"],
                    }
                ],
                "edges": [],
                "source_anchors": [],
                "indexes": {},
                "unresolved_frontiers": [],
                "coverage_state": "SUFFICIENT",
                "coverage_notes": [],
                "provenance": {"scan_job_id": "scan-1"},
                "evidence_refs": ["evidence:finding-1"],
                "graph_hash": "sha256:graph",
                "schema_version": "2.0.0",
            }
        },
    }


def _rule(rule_id: str = "eng-1"):
    return SimpleNamespace(
        engineering_rule_id=rule_id,
        legal_rule_id="legal-1",
        concept="HUMAN_OVERSIGHT",
        source_chunk_ids=("LAW:A1",),
        source_locators=("art-1::cl-1",),
    )


def _api_client(rules=None):
    api_client = MagicMock()
    api_client.get_active_legal_rule_catalog.return_value = {
        "versionId": "catalog-v1",
        "rules": rules
        if rules is not None
        else [{"legalRuleId": "rule-1", "status": "APPROVED"}],
    }
    api_client.get_active_legal_corpus.return_value = {"versionId": "corpus-v1"}
    api_client.get_legal_corpus_chunks.return_value = {
        "chunks": [{"id": "LAW:A1", "content": "approved legal text"}]
    }
    return api_client


def test_pipeline_returns_direct_compliant_rule_evaluation() -> None:
    api_client = _api_client()
    retriever = MagicMock()
    engineering_rule = _rule()
    rule_service = MagicMock()
    rule_service.get_or_compile.return_value = ([engineering_rule], True)
    packet = InvestigationPacket(
        engineering_rule_id="eng-1",
        concept="HUMAN_OVERSIGHT",
        investigation_goals=("Find review controls",),
        initial_results=(),
    )
    query_executor = MagicMock()
    query_executor.execute.return_value = packet
    claim = EvidenceClaim(
        claim_id="claim-1",
        engineering_rule_id="eng-1",
        claim_type="RULE_REQUIREMENT_MET",
        value=True,
        evidence_refs=("evidence:finding-1",),
        confidence=0.95,
        criterion="HUMAN_OVERSIGHT",
    )
    investigator = MagicMock()
    investigator.investigate.return_value = [claim]

    result = EngineeringInvestigationPipeline(
        api_client=api_client,
        model="test:model",
        retriever=retriever,
        rule_service=rule_service,
        query_executor=query_executor,
        investigator=investigator,
    ).run(
        evidence_report=_evidence_report(),
        workflow_run_id="workflow-1",
        correlation_id="corr-1",
    )

    assert result.status == "COMPLETE"
    assert result.engineering_rules_executed == 1
    assert result.engineering_rule_cache_hits == 1
    assert result.claims == (claim,)
    assert result.evaluations[0].status == "COMPLIANT"
    assert result.evaluations[0].source_chunk_ids == ("LAW:A1",)
    assert result.to_assessment_data()["summary"] == {
        "compliant": 1,
        "non_compliant": 0,
        "unknown": 0,
        "total": 1,
    }


def test_pipeline_captures_verified_episode_after_deterministic_evaluation(
    monkeypatch,
) -> None:
    captured = []
    monkeypatch.setattr(
        pipeline,
        "capture_verified_episode",
        lambda **kwargs: captured.append(kwargs),
    )
    api_client = _api_client()
    engineering_rule = _rule()
    rule_service = MagicMock()
    rule_service.get_or_compile.return_value = ([engineering_rule], True)
    query_executor = MagicMock()
    query_executor.execute.return_value = InvestigationPacket(
        engineering_rule_id="eng-1",
        concept="HUMAN_OVERSIGHT",
        investigation_goals=("Find review controls",),
        initial_results=(),
    )
    claim = EvidenceClaim(
        claim_id="claim-1",
        engineering_rule_id="eng-1",
        claim_type="RULE_REQUIREMENT_MET",
        value=True,
        evidence_refs=("evidence:finding-1",),
        confidence=0.95,
        criterion="HUMAN_OVERSIGHT",
    )
    invalid_claim = EvidenceClaim(
        claim_id="claim-invalid-ref",
        engineering_rule_id="eng-1",
        claim_type="RULE_REQUIREMENT_NOT_MET",
        value=False,
        evidence_refs=("evidence:invented",),
        confidence=0.99,
        criterion="HUMAN_OVERSIGHT",
    )
    investigator = MagicMock()
    investigator.investigate.return_value = [claim, invalid_claim]

    result = EngineeringInvestigationPipeline(
        api_client=api_client,
        model="test:model",
        retriever=MagicMock(),
        rule_service=rule_service,
        query_executor=query_executor,
        investigator=investigator,
    ).run(
        evidence_report=_evidence_report(),
        workflow_run_id="workflow-1",
        assessment_id="assessment-1",
        user_id="user-1",
    )

    assert result.claims == (claim,)
    assert result.evaluations[0].status == "COMPLIANT"
    assert result.evaluations[0].evidence_refs == ("evidence:finding-1",)
    assert len(captured) == 1
    assert captured[0]["owner_agent"] == "investigator"
    assert captured[0]["assessment_id"] == "assessment-1"
    assert captured[0]["user_id"] == "user-1"
    assert captured[0]["engineering_rule_ids"] == ("eng-1",)
    assert captured[0]["artifact_versions"] == {
        "technicalEvidenceReportId": "ter-1",
        "legalRuleCatalogVersionId": "catalog-v1",
        "legalCorpusVersionId": "corpus-v1",
    }
    assert captured[0]["handoff"]["status"] == "DETERMINISTIC_OUTCOME_READY"
    assert [item["claim_id"] for item in captured[0]["handoff"]["claims"]] == [
        "claim-1"
    ]
    assert captured[0]["handoff"]["omitted_unvalidated_claim_count"] == 1
    assert captured[0]["handoff"]["evaluation"]["status"] == "COMPLIANT"
    assert captured[0]["handoff"]["evaluation"]["evidence_refs"] == (
        "evidence:finding-1",
    )
    assert "evidence:invented" not in str(captured[0])
    assert captured[0]["prompt_version"] == "engineering-rule-investigation.v1"
    assert captured[0]["model_id"] == "test:model"
    assert captured[0]["successful_strategy_summary"] == (
        "validated engineering investigation rule=eng-1 outcome=COMPLIANT "
        "validated_claims=1 evidence_refs=1"
    )
    assert captured[0]["evidence_refs"] == ("evidence:finding-1",)


def test_pipeline_does_not_capture_episode_after_investigator_failure(
    monkeypatch,
) -> None:
    captured = []
    monkeypatch.setattr(
        pipeline,
        "capture_verified_episode",
        lambda **kwargs: captured.append(kwargs),
    )
    api_client = _api_client()
    engineering_rule = _rule()
    rule_service = MagicMock()
    rule_service.get_or_compile.return_value = ([engineering_rule], True)
    query_executor = MagicMock()
    query_executor.execute.return_value = InvestigationPacket(
        engineering_rule_id="eng-1",
        concept="HUMAN_OVERSIGHT",
        investigation_goals=("Find review controls",),
        initial_results=(),
    )
    investigator = MagicMock()
    investigator.investigate.side_effect = RuntimeError("model failed")
    evaluator = MagicMock()
    evaluator.evaluate.return_value = SimpleNamespace(
        engineering_rule_id="eng-1",
        status="UNKNOWN",
        evidence_refs=(),
    )

    result = EngineeringInvestigationPipeline(
        api_client=api_client,
        model="test:model",
        retriever=MagicMock(),
        rule_service=rule_service,
        query_executor=query_executor,
        investigator=investigator,
        evaluator=evaluator,
    ).run(
        evidence_report=_evidence_report(),
        workflow_run_id="workflow-1",
        assessment_id="assessment-1",
        user_id="user-1",
    )

    assert result.status == "PARTIAL"
    assert result.claims == ()
    assert result.limitations == (
        ENGINEERING_LIMITATION_CODES["engineering_investigation_failed"],
    )
    assert captured == []


def test_pipeline_does_not_capture_episode_without_validated_claim_provenance(
    monkeypatch,
) -> None:
    captured = []
    monkeypatch.setattr(
        pipeline,
        "capture_verified_episode",
        lambda **kwargs: captured.append(kwargs),
    )
    api_client = _api_client()
    engineering_rule = _rule()
    rule_service = MagicMock()
    rule_service.get_or_compile.return_value = ([engineering_rule], True)
    query_executor = MagicMock()
    query_executor.execute.return_value = InvestigationPacket(
        engineering_rule_id="eng-1",
        concept="HUMAN_OVERSIGHT",
        investigation_goals=("Find review controls",),
        initial_results=(),
    )
    investigator = MagicMock()
    investigator.investigate.return_value = [
        EvidenceClaim(
            claim_id="claim-unresolved",
            engineering_rule_id="eng-1",
            claim_type="UNRESOLVED_ENGINEERING_FACT",
            value=None,
            evidence_refs=(),
            graph_path_refs=(),
            source_anchor_refs=(),
            confidence=0.0,
        )
    ]

    result = EngineeringInvestigationPipeline(
        api_client=api_client,
        model="test:model",
        retriever=MagicMock(),
        rule_service=rule_service,
        query_executor=query_executor,
        investigator=investigator,
    ).run(
        evidence_report=_evidence_report(),
        workflow_run_id="workflow-1",
        assessment_id="assessment-1",
        user_id="user-1",
    )

    assert result.status == "COMPLETE"
    assert result.evaluations[0].status == "UNKNOWN"
    assert captured == []


def test_pipeline_treats_unknown_as_valid_complete_evaluation() -> None:
    api_client = _api_client()
    engineering_rule = _rule()
    rule_service = MagicMock()
    rule_service.get_or_compile.return_value = ([engineering_rule], True)
    query_executor = MagicMock()
    query_executor.execute.return_value = InvestigationPacket(
        engineering_rule_id="eng-1",
        concept="HUMAN_OVERSIGHT",
        investigation_goals=("Find review controls",),
        initial_results=(),
    )
    investigator = MagicMock()
    investigator.investigate.return_value = [
        EvidenceClaim(
            claim_id="claim-unknown",
            engineering_rule_id="eng-1",
            claim_type="UNRESOLVED_ENGINEERING_FACT",
            value=None,
            evidence_refs=("evidence:finding-1",),
            confidence=0.5,
            limitations=(
                ENGINEERING_LIMITATION_CODES["engineering_evidence_insufficient"],
            ),
        )
    ]

    result = EngineeringInvestigationPipeline(
        api_client=api_client,
        model="test:model",
        retriever=MagicMock(),
        rule_service=rule_service,
        query_executor=query_executor,
        investigator=investigator,
    ).run(evidence_report=_evidence_report(), workflow_run_id="workflow-1")

    assert result.status == "COMPLETE"
    assert result.evaluations[0].status == "UNKNOWN"
    assert result.limitations == ()
    assert result.to_assessment_data()["summary"] == {
        "compliant": 0,
        "non_compliant": 0,
        "unknown": 1,
        "total": 1,
    }


def test_pipeline_keeps_other_rules_when_one_compilation_fails() -> None:
    api_client = _api_client(
        [
            {"legalRuleId": "rule-bad", "status": "APPROVED"},
            {"legalRuleId": "rule-good", "status": "APPROVED"},
        ]
    )
    rule_service = MagicMock()
    rule_service.get_or_compile.side_effect = [
        ValueError("unresolvable"),
        ([_rule("eng-good")], False),
    ]
    query_executor = MagicMock()
    query_executor.execute.return_value = InvestigationPacket(
        engineering_rule_id="eng-good",
        concept="DATA_PROCESSING",
        investigation_goals=(),
        initial_results=(),
    )
    investigator = MagicMock()
    investigator.investigate.return_value = [
        EvidenceClaim(
            claim_id="claim-good",
                engineering_rule_id="eng-good",
                claim_type="RULE_REQUIREMENT_NOT_MET",
                value=False,
                evidence_refs=("evidence:finding-1",),
                confidence=0.9,
                criterion="HUMAN_OVERSIGHT",
            )
        ]

    result = EngineeringInvestigationPipeline(
        api_client=api_client,
        model="test:model",
        retriever=MagicMock(),
        rule_service=rule_service,
        query_executor=query_executor,
        investigator=investigator,
    ).run(evidence_report=_evidence_report(), workflow_run_id="workflow-1")

    assert result.status == "PARTIAL"
    assert result.engineering_rules_executed == 1
    assert result.evaluations[0].status == "NON_COMPLIANT"
    assert result.limitations == (
        ENGINEERING_LIMITATION_CODES["engineering_rule_compilation_failed"],
    )


def test_pipeline_blocks_when_no_approved_source_rules_exist() -> None:
    api_client = _api_client([{"legalRuleId": "rule-1", "status": "DRAFT"}])
    rule_service = MagicMock()

    result = EngineeringInvestigationPipeline(
        api_client=api_client,
        model="test:model",
        retriever=MagicMock(),
        rule_service=rule_service,
        query_executor=MagicMock(),
        investigator=MagicMock(),
    ).run(evidence_report=_evidence_report(), workflow_run_id="workflow-1")

    assert result.status == "BLOCKED"
    assert result.rules_considered == 0
    assert result.limitations == (
        ENGINEERING_LIMITATION_CODES["no_engineering_rule_source_rules"],
    )
    rule_service.get_or_compile.assert_not_called()


def test_pipeline_deduplicates_compilation_failure_to_machine_code() -> None:
    api_client = _api_client(
        [
            {"legalRuleId": "rule-1", "status": "APPROVED"},
            {"legalRuleId": "rule-2", "status": "APPROVED"},
        ]
    )
    rule_service = MagicMock()
    rule_service.get_or_compile.side_effect = RuntimeError("provider failure detail")

    result = EngineeringInvestigationPipeline(
        api_client=api_client,
        model="test:model",
        retriever=MagicMock(),
        rule_service=rule_service,
        query_executor=MagicMock(),
        investigator=MagicMock(),
    ).run(evidence_report=_evidence_report(), workflow_run_id="workflow-1")

    assert result.status == "BLOCKED"
    assert result.engineering_rules_executed == 0
    assert result.evaluations == ()
    assert result.limitations == (
        ENGINEERING_LIMITATION_CODES["engineering_rule_compilation_failed"],
    )
    assert rule_service.get_or_compile.call_count == 2


def test_safe_technical_evidence_projection_keeps_source_location_without_source_body() -> None:
    graph = ProgramEvidenceGraph.from_dict(
        {
            "graph_id": "graph-1",
            "snapshot_id": "snapshot-1",
            "commit_sha": "abc123",
            "node_count": 1,
            "edge_count": 0,
            "nodes": [
                {
                    "node_id": "node-1",
                    "node_type": "HUMAN_REVIEW",
                    "label": "approveRequest",
                    "source": {
                        "file_path": "repo-abc1234/apps/api/src/review.ts",
                        "symbol_ref": "approveRequest",
                        "start_line": 42,
                        "end_line": 48,
                        "source_hash": "sha256:source",
                    },
                    "semantic_types": ["HUMAN_OVERSIGHT"],
                    "evidence_refs": ["evidence:review"],
                }
            ],
            "edges": [],
            "source_anchors": [],
            "indexes": {},
            "unresolved_frontiers": [],
            "coverage_state": "SUFFICIENT",
            "coverage_notes": [],
            "provenance": {"scan_job_id": "scan-1"},
            "evidence_refs": ["evidence:review"],
            "graph_hash": "sha256:graph",
            "schema_version": "2.0.0",
        }
    )

    displays = EngineeringInvestigationPipeline._technical_evidence_displays(
        graph,
        ("evidence:review",),
    )

    assert displays == [
        {
            "kind": "HUMAN_REVIEW",
            "label": "approveRequest",
            "file_path": "repo-abc1234/apps/api/src/review.ts",
            "symbol_ref": "approveRequest",
            "start_line": 42,
            "end_line": 48,
        }
    ]
    assert "code" not in displays[0]
    assert "source" not in displays[0]
