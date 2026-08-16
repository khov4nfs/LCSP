from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import MagicMock

from lcsp_workers.investigation.models import EvidenceClaim, InvestigationPacket
from lcsp_workers.investigation.pipeline import EngineeringInvestigationPipeline
from lcsp_workers.llm.budget_tracker import BudgetExceeded


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


def test_pipeline_compiles_queries_investigates_and_returns_only_validated_claims() -> None:
    api_client = MagicMock()
    api_client.get_active_legal_rule_catalog.return_value = {
        "versionId": "catalog-v1",
        "rules": [{"legalRuleId": "rule-1", "status": "APPROVED"}],
    }
    api_client.get_active_legal_corpus.return_value = {"versionId": "corpus-v1"}
    api_client.get_legal_corpus_chunks.return_value = {
        "chunks": [{"id": "LAW:A1", "content": "approved legal text"}]
    }
    retriever = MagicMock()
    engineering_rule = SimpleNamespace(engineering_rule_id="eng-1")
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
        claim_type="HUMAN_REVIEW_PRESENT",
        value=True,
        evidence_refs=("evidence:finding-1",),
        confidence=0.95,
    )
    investigator = MagicMock()
    investigator.investigate.return_value = [claim]

    pipeline = EngineeringInvestigationPipeline(
        api_client=api_client,
        llm_client=MagicMock(),
        retriever=retriever,
        rule_service=rule_service,
        query_executor=query_executor,
        investigator=investigator,
    )
    result = pipeline.run(
        evidence_report=_evidence_report(),
        workflow_run_id="workflow-1",
        correlation_id="corr-1",
    )

    assert result.status == "COMPLETE"
    assert result.legal_rule_catalog_version_id == "catalog-v1"
    assert result.legal_corpus_version_id == "corpus-v1"
    assert result.rules_considered == 1
    assert result.engineering_rules_executed == 1
    assert result.engineering_rule_cache_hits == 1
    assert result.claims == (claim,)
    retriever.index_corpus.assert_called_once()
    rule_service.get_or_compile.assert_called_once()
    query_executor.execute.assert_called_once()
    investigator.investigate.assert_called_once()


def test_pipeline_fails_one_rule_closed_without_dropping_other_rules() -> None:
    api_client = MagicMock()
    api_client.get_active_legal_rule_catalog.return_value = {
        "versionId": "catalog-v1",
        "rules": [
            {"legalRuleId": "rule-bad", "status": "APPROVED"},
            {"legalRuleId": "rule-good", "status": "APPROVED"},
        ],
    }
    api_client.get_active_legal_corpus.return_value = {"versionId": "corpus-v1"}
    api_client.get_legal_corpus_chunks.return_value = {"chunks": []}
    rule_service = MagicMock()
    engineering_rule = SimpleNamespace(engineering_rule_id="eng-good")
    rule_service.get_or_compile.side_effect = [ValueError("unresolvable"), ([engineering_rule], False)]
    query_executor = MagicMock()
    query_executor.execute.return_value = InvestigationPacket(
        engineering_rule_id="eng-good",
        concept="DATA_PROCESSING",
        investigation_goals=(),
        initial_results=(),
    )
    investigator = MagicMock()
    investigator.investigate.return_value = []

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
    assert result.limitations == (
        "ENGINEERING_RULE_INVESTIGATION_FAILED:rule-bad:ValueError",
    )


def test_pipeline_ignores_explicitly_inactive_legal_rules() -> None:
    api_client = MagicMock()
    api_client.get_active_legal_rule_catalog.return_value = {
        "versionId": "catalog-v1",
        "rules": [{"legalRuleId": "rule-1", "status": "DRAFT"}],
    }
    api_client.get_active_legal_corpus.return_value = {"versionId": "corpus-v1"}
    api_client.get_legal_corpus_chunks.return_value = {"chunks": []}
    rule_service = MagicMock()

    result = EngineeringInvestigationPipeline(
        api_client=api_client,
        llm_client=MagicMock(),
        retriever=MagicMock(),
        rule_service=rule_service,
        query_executor=MagicMock(),
        investigator=MagicMock(),
    ).run(evidence_report=_evidence_report(), workflow_run_id="workflow-1")

    assert result.status == "COMPLETE"
    assert result.rules_considered == 0
    rule_service.get_or_compile.assert_not_called()


def test_pipeline_stops_investigation_when_llm_budget_is_exhausted() -> None:
    api_client = MagicMock()
    api_client.get_active_legal_rule_catalog.return_value = {
        "versionId": "catalog-v1",
        "rules": [
            {"legalRuleId": "rule-1", "status": "APPROVED"},
            {"legalRuleId": "rule-2", "status": "APPROVED"},
        ],
    }
    api_client.get_active_legal_corpus.return_value = {"versionId": "corpus-v1"}
    api_client.get_legal_corpus_chunks.return_value = {"chunks": []}
    rule_service = MagicMock()
    rule_service.get_or_compile.side_effect = BudgetExceeded("Monthly token cap exceeded.")

    result = EngineeringInvestigationPipeline(
        api_client=api_client,
        llm_client=MagicMock(),
        retriever=MagicMock(),
        rule_service=rule_service,
        query_executor=MagicMock(),
        investigator=MagicMock(),
    ).run(evidence_report=_evidence_report(), workflow_run_id="workflow-1")

    assert result.status == "PARTIAL"
    assert result.engineering_rules_executed == 0
    assert result.limitations == (
        "ENGINEERING_INVESTIGATION_BUDGET_EXHAUSTED:rule-1",
    )
    assert rule_service.get_or_compile.call_count == 1
