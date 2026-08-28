from __future__ import annotations

from unittest.mock import MagicMock

import pytest

from tools.legal.corpus.engineering_rules.contract.models import (
    DEV_ENGINEERING_RULE_BOOTSTRAP_RULE_FAMILY,
    EngineeringRule,
)
from tools.legal.corpus.engineering_rules.orchestration.service import EngineeringRuleService


def _legal_rule(*, family: str = "AI_HUMAN_OVERSIGHT") -> dict:
    return {
        "legalRuleId": "LEGAL-1",
        "ruleFamily": family,
        "requiredFacts": [],
        "optionalFacts": [],
        "blockingFacts": [],
        "unknownFactPolicy": "BLOCK_ON_UNKNOWN",
        "citationLocatorRefs": [{"chunkId": "LAW:A1"}],
    }


def _engineering_rule() -> EngineeringRule:
    return EngineeringRule(
        engineering_rule_id="ENG-1",
        legal_rule_id="LEGAL-1",
        legal_rule_catalog_version_id="catalog-1",
        legal_corpus_version_id="corpus-1",
        concept="HUMAN_OVERSIGHT",
        legal_intent={},
        investigation_goals=("Find human review controls",),
        starting_node_types=(),
        target_node_types=(),
        edge_strategies=(),
        graph_queries=(),
        required_evidence=("HUMAN_REVIEW_CONTROL",),
        source_chunk_ids=("LAW:A1",),
        source_locators=("art-1::cl-1",),
        source_fingerprint="sha256:test",
    )


def _proposal() -> dict:
    return {
        "engineeringRuleId": "ENG-1",
        "concept": "HUMAN_OVERSIGHT",
        "legalIntent": {"requirement": "HUMAN_REVIEW"},
        "investigationGoals": ["Find human review controls"],
        "startingNodeTypes": [],
        "targetNodeTypes": [],
        "edgeStrategies": [],
        "graphQueries": [],
        "keywords": ["review", "override"],
        "commonApis": [],
        "commonLibraries": [],
        "patterns": [],
        "requiredEvidence": ["HUMAN_REVIEW_CONTROL"],
        "supportingEvidence": [],
        "negativeEvidence": [],
        "unresolvedConditions": [],
    }


def _service(
    *,
    cached=None,
    contract_version: str = "test-contract-v1",
):
    compiler = MagicMock()
    retriever = MagicMock()
    retriever.retrieve_exact_context.return_value = [
        {
            "id": "LAW:A1",
            "legalStatus": "ACTIVE",
            "contentSha256": "sha256:chunk",
            "locator": "art-1::cl-1",
            "content": (
                "Nhà cung cấp hệ thống trí tuệ nhân tạo phải duy trì cơ chế "
                "con người xem xét trước khi thực hiện quyết định cuối cùng."
            ),
            "hierarchy": {"normativeClass": "ENGINEERING_RULE_CANDIDATE"},
        }
    ]
    cache = MagicMock()
    cache.get.return_value = list(cached or [])
    registry = MagicMock()
    registry.contract_version = contract_version
    return (
        EngineeringRuleService(
            compiler=compiler,
            retriever=retriever,
            cache=cache,
            precompiled_registry=registry,
        ),
        compiler,
        cache,
        registry,
    )


def _candidate_analysis() -> list[dict]:
    return [
        {
            "chunkId": "LAW:A1",
            "verdict": "ENGINEERING_RULE_CANDIDATE",
            "reason": "The chunk imposes a concrete human-review obligation.",
            "engineeringObligation": "Maintain human review before final action.",
            "verificationTargets": ["human review", "approval", "override"],
        }
    ]


def test_ready_rule_uses_cache_without_compilation() -> None:
    cached_rule = _engineering_rule()
    service, compiler, _, registry = _service(cached=[cached_rule])

    rules, cache_hit = service.get_or_compile(
        legal_rule=_legal_rule(),
        legal_rule_catalog_version_id="catalog-1",
        legal_corpus_version_id="corpus-1",
        workflow_run_id="assessment-run-1",
    )

    assert rules == [cached_rule]
    assert cache_hit is True
    compiler.compile.assert_not_called()
    registry.materialize.assert_not_called()


def test_assessment_cache_miss_does_not_compile_or_materialize_fallback() -> None:
    service, compiler, cache, registry = _service(cached=[])

    rules, cache_hit = service.get_or_compile(
        legal_rule=_legal_rule(family=DEV_ENGINEERING_RULE_BOOTSTRAP_RULE_FAMILY),
        legal_rule_catalog_version_id="catalog-1",
        legal_corpus_version_id="corpus-1",
        workflow_run_id="assessment-run-1",
    )

    assert rules == []
    assert cache_hit is False
    assert cache.get.called
    cache.put.assert_not_called()
    compiler.compile.assert_not_called()
    registry.materialize.assert_not_called()


def test_assessment_cache_miss_stays_ready_only_when_fallback_flag_enabled(
    monkeypatch,
) -> None:
    monkeypatch.setenv("ENGINEERING_RULE_ALLOW_PRECOMPILED_FALLBACK", "1")
    service, compiler, cache, registry = _service(cached=[])

    rules, cache_hit = service.get_or_compile(
        legal_rule=_legal_rule(family=DEV_ENGINEERING_RULE_BOOTSTRAP_RULE_FAMILY),
        legal_rule_catalog_version_id="catalog-1",
        legal_corpus_version_id="corpus-1",
        workflow_run_id="assessment-run-1",
    )

    assert rules == []
    assert cache_hit is False
    cache.put.assert_not_called()
    compiler.compile.assert_not_called()
    registry.materialize.assert_not_called()


def test_enabled_bootstrap_contract_version_changes_cache_fingerprint(
    monkeypatch,
) -> None:
    monkeypatch.setenv("ENGINEERING_RULE_ALLOW_PRECOMPILED_FALLBACK", "1")
    service_v1, _, cache_v1, _ = _service(
        cached=[_engineering_rule()],
        contract_version="transparency-v1",
    )
    service_v2, _, cache_v2, _ = _service(
        cached=[_engineering_rule()],
        contract_version="transparency-v2",
    )

    for service in (service_v1, service_v2):
        service.get_or_compile(
            legal_rule=_legal_rule(
                family=DEV_ENGINEERING_RULE_BOOTSTRAP_RULE_FAMILY
            ),
            legal_rule_catalog_version_id="catalog-1",
            legal_corpus_version_id="corpus-1",
            workflow_run_id="assessment-run-1",
        )

    fingerprint_v1 = cache_v1.get.call_args.args[0]
    fingerprint_v2 = cache_v2.get.call_args.args[0]
    assert fingerprint_v1 != fingerprint_v2


def test_triage_preparation_persists_candidate_engineering_rules() -> None:
    service, compiler, cache, registry = _service(cached=[])

    rules, cache_hit = service.prepare_from_triage(
        legal_rule=_legal_rule(),
        legal_rule_catalog_version_id="catalog-1",
        legal_corpus_version_id="corpus-1",
        chunk_analyses=_candidate_analysis(),
        engineering_rule_rows=[_proposal()],
        workflow_run_id="triage-run-1",
    )

    assert cache_hit is False
    assert [rule.engineering_rule_id for rule in rules] == ["ENG-1"]
    assert rules[0].compiler_model == "managed-deep-agent:triage"
    cache.put.assert_called_once()
    compiler.compile.assert_not_called()
    registry.materialize.assert_not_called()


def test_triage_candidate_without_rule_proposal_does_not_mark_completed() -> None:
    service, _, cache, _ = _service(cached=[])
    store_triage_artifact = MagicMock()
    service._store_triage_artifact = store_triage_artifact

    with pytest.raises(
        ValueError,
        match="triage candidates require at least one EngineeringRule proposal",
    ):
        service.prepare_from_triage(
            legal_rule=_legal_rule(),
            legal_rule_catalog_version_id="catalog-1",
            legal_corpus_version_id="corpus-1",
            chunk_analyses=_candidate_analysis(),
            engineering_rule_rows=[],
            workflow_run_id="triage-run-1",
        )

    cache.put.assert_not_called()
    store_triage_artifact.assert_not_called()


def test_triage_context_only_result_does_not_create_rule() -> None:
    service, _, cache, _ = _service(cached=[])
    store_triage_artifact = MagicMock()
    service._store_triage_artifact = store_triage_artifact
    analyses = [
        {
            "chunkId": "LAW:A1",
            "verdict": "CONTEXT_ONLY",
            "reason": "The chunk only defines a term.",
            "engineeringObligation": "",
            "verificationTargets": [],
        }
    ]

    rules, cache_hit = service.prepare_from_triage(
        legal_rule=_legal_rule(),
        legal_rule_catalog_version_id="catalog-1",
        legal_corpus_version_id="corpus-1",
        chunk_analyses=analyses,
        engineering_rule_rows=[],
        workflow_run_id="triage-run-1",
    )

    assert rules == []
    assert cache_hit is False
    cache.put.assert_not_called()
    store_triage_artifact.assert_called_once()


def test_triage_cannot_persist_rules_without_candidates() -> None:
    service, _, cache, _ = _service(cached=[])
    store_triage_artifact = MagicMock()
    service._store_triage_artifact = store_triage_artifact
    analyses = [
        {
            "chunkId": "LAW:A1",
            "verdict": "REJECT",
            "reason": "The text is document structure only.",
            "engineeringObligation": "",
            "verificationTargets": [],
        }
    ]

    with pytest.raises(
        ValueError,
        match="cannot be persisted when triage produced no candidates",
    ):
        service.prepare_from_triage(
            legal_rule=_legal_rule(),
            legal_rule_catalog_version_id="catalog-1",
            legal_corpus_version_id="corpus-1",
            chunk_analyses=analyses,
            engineering_rule_rows=[_proposal()],
            workflow_run_id="triage-run-1",
        )

    cache.put.assert_not_called()
    store_triage_artifact.assert_not_called()
