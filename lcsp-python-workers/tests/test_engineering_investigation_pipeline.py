from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import MagicMock

from lcsp_workers.investigation.models import (
    ENGINEERING_LIMITATION_CODES,
    EvidenceClaim,
    InvestigationPacket,
)
from lcsp_workers.investigation.pipeline import EngineeringInvestigationPipeline


def _evidence_report() -> dict:
    return {
        "id": "ter-1",
        "evidence_payload": {
            "evidence_graph": {
                "graph_id": "graph-1",
                "snapshot_id": "snapshot-1",
                "commit_sha": "abc123",
                "node_count": 0,
                "edge_count": 0,
                "nodes": [],
                "edges": [],
                "source_anchors": [],
                "indexes": {},
                "unresolved_frontiers": [],
                "coverage_state": "SUFFICIENT",
                "coverage_notes": [],
                "provenance": {"scan_job_id": "scan-1"},
                "evidence_refs": [],
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
    )
    investigator = MagicMock()
    investigator.investigate.return_value = [claim]

    result = EngineeringInvestigationPipeline(
        api_client=api_client,
        llm_client=MagicMock(),
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
            evidence_refs=("graph:path:1",),
            confidence=0.9,
        )
    ]

    result = EngineeringInvestigationPipeline(
        api_client=api_client,
        llm_client=MagicMock(),
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
        llm_client=MagicMock(),
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
        llm_client=MagicMock(),
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
