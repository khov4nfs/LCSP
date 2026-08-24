from __future__ import annotations

from unittest.mock import MagicMock

import pytest

from tools.legal.legal.engineering_rules.models import (
    DEV_ENGINEERING_RULE_BOOTSTRAP_RULE_FAMILY,
    EngineeringRule,
)
from tools.legal.legal.engineering_rules.service import EngineeringRuleService


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
        source_chunk_ids=("LAW:A1",),
        source_locators=("art-1::cl-1",),
        source_fingerprint="sha256:test",
    )


def _service(
    *,
    cached=None,
    recovered=None,
    recovery_error: Exception | None = None,
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
        }
    ]
    cache = MagicMock()
    cache.get.return_value = list(cached or [])
    registry = MagicMock()
    registry.contract_version = contract_version
    if recovery_error is not None:
        registry.materialize.side_effect = recovery_error
    else:
        registry.materialize.return_value = list(recovered or [])
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


def test_bootstrap_rule_uses_cache_without_compilation() -> None:
    cached_rule = _engineering_rule()
    service, compiler, _, registry = _service(cached=[cached_rule])

    rules, cache_hit = service.get_or_compile(
        legal_rule=_legal_rule(family=DEV_ENGINEERING_RULE_BOOTSTRAP_RULE_FAMILY),
        legal_rule_catalog_version_id="catalog-1",
        legal_corpus_version_id="corpus-1",
        workflow_run_id="run-1",
    )

    assert rules == [cached_rule]
    assert cache_hit is True
    compiler.compile.assert_not_called()
    registry.materialize.assert_not_called()


def test_bootstrap_rule_compiles_from_chunks_on_cache_miss_by_default() -> None:
    compiled_rule = _engineering_rule()
    service, compiler, cache, registry = _service(cached=[])
    compiler.compile.return_value = [compiled_rule]

    rules, cache_hit = service.get_or_compile(
        legal_rule=_legal_rule(family=DEV_ENGINEERING_RULE_BOOTSTRAP_RULE_FAMILY),
        legal_rule_catalog_version_id="catalog-1",
        legal_corpus_version_id="corpus-1",
        workflow_run_id="run-1",
    )

    assert rules == [compiled_rule]
    assert cache_hit is False
    compiler.compile.assert_called_once()
    cache.put.assert_called_once()
    registry.materialize.assert_not_called()


def test_bootstrap_rule_can_use_precompiled_bundle_when_fallback_enabled(
    monkeypatch,
) -> None:
    monkeypatch.setenv("ENGINEERING_RULE_ALLOW_PRECOMPILED_FALLBACK", "1")
    recovered_rule = _engineering_rule()
    service, compiler, cache, registry = _service(
        cached=[],
        recovered=[recovered_rule],
    )

    rules, cache_hit = service.get_or_compile(
        legal_rule=_legal_rule(family=DEV_ENGINEERING_RULE_BOOTSTRAP_RULE_FAMILY),
        legal_rule_catalog_version_id="catalog-1",
        legal_corpus_version_id="corpus-1",
        workflow_run_id="run-1",
    )

    assert rules == [recovered_rule]
    assert cache_hit is False
    registry.materialize.assert_called_once()
    cache.put.assert_called_once()
    compiler.compile.assert_not_called()


def test_bootstrap_rule_fails_closed_when_enabled_bundle_cannot_recover(
    monkeypatch,
) -> None:
    monkeypatch.setenv("ENGINEERING_RULE_ALLOW_PRECOMPILED_FALLBACK", "1")
    service, compiler, cache, registry = _service(
        cached=[],
        recovery_error=ValueError("PRECOMPILED_ENGINEERING_RULE_MISSING:LEGAL-1"),
    )

    with pytest.raises(
        ValueError,
        match="PRECOMPILED_ENGINEERING_RULE_MISSING:LEGAL-1",
    ):
        service.get_or_compile(
            legal_rule=_legal_rule(
                family=DEV_ENGINEERING_RULE_BOOTSTRAP_RULE_FAMILY
            ),
            legal_rule_catalog_version_id="catalog-1",
            legal_corpus_version_id="corpus-1",
            workflow_run_id="run-1",
        )

    assert cache.get.called
    assert cache.put.call_count == 0
    registry.materialize.assert_called_once()
    compiler.compile.assert_not_called()


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
            workflow_run_id="run-1",
        )

    fingerprint_v1 = cache_v1.get.call_args.args[0]
    fingerprint_v2 = cache_v2.get.call_args.args[0]
    assert fingerprint_v1 != fingerprint_v2


def test_non_bootstrap_rule_can_compile_on_cache_miss() -> None:
    service, compiler, cache, registry = _service(cached=[])
    compiled = _engineering_rule()
    compiler.compile.return_value = [compiled]

    rules, cache_hit = service.get_or_compile(
        legal_rule=_legal_rule(),
        legal_rule_catalog_version_id="catalog-1",
        legal_corpus_version_id="corpus-1",
        workflow_run_id="run-1",
    )

    assert rules == [compiled]
    assert cache_hit is False
    compiler.compile.assert_called_once()
    cache.put.assert_called_once()
    registry.materialize.assert_not_called()


def test_empty_compilation_result_is_not_cached() -> None:
    service, compiler, cache, registry = _service(cached=[])
    compiler.compile.return_value = []

    rules, cache_hit = service.get_or_compile(
        legal_rule=_legal_rule(),
        legal_rule_catalog_version_id="catalog-1",
        legal_corpus_version_id="corpus-1",
        workflow_run_id="run-1",
    )

    assert rules == []
    assert cache_hit is False
    compiler.compile.assert_called_once()
    cache.put.assert_not_called()
    registry.materialize.assert_not_called()
