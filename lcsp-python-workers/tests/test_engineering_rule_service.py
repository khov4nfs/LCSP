from __future__ import annotations

from unittest.mock import MagicMock

import pytest

from lcsp_workers.legal.engineering_rules.models import (
    DEV_ENGINEERING_RULE_BOOTSTRAP_RULE_FAMILY,
    EngineeringRule,
)
from lcsp_workers.legal.engineering_rules.service import EngineeringRuleService


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


def _service(*, cached=None, recovered=None, recovery_error: Exception | None = None):
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


def test_bootstrap_rule_uses_precompiled_cache_without_llm_compilation() -> None:
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


def test_bootstrap_rule_recovers_precompiled_bundle_on_cache_miss() -> None:
    recovered_rule = _engineering_rule()
    service, compiler, cache, registry = _service(
        cached=[], recovered=[recovered_rule]
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


def test_bootstrap_rule_fails_closed_when_governed_bundle_cannot_recover() -> None:
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
