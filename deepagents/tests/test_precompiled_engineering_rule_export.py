from __future__ import annotations

import json
from pathlib import Path
from unittest.mock import MagicMock

import pytest

from tools.legal.corpus.engineering_rules.orchestration.service import (
    EngineeringRuleService,
)
from tools.legal.corpus.engineering_rules.registry.precompiled_export import (
    build_bundle,
    build_no_rule_entry,
    build_template,
    template_id_for,
)
from tools.legal.corpus.engineering_rules.registry.precompiled_registry import (
    PrecompiledEngineeringRuleRegistry,
)


def _persisted_rule() -> dict:
    """One EngineeringRule as Triage persisted it (asdict -> snake_case)."""
    return {
        "engineering_rule_id": "LEGAL-1::ENG::1",
        "legal_rule_id": "LEGAL-1",
        "legal_rule_catalog_version_id": "catalog-1",
        "legal_corpus_version_id": "corpus-1",
        "concept": "HUMAN_OVERSIGHT",
        "legal_intent": {"modality": "MUST"},
        "investigation_goals": ["Find a bounded human-review path"],
        "starting_node_types": ["AI_MODEL_INVOCATION"],
        "target_node_types": ["APPROVAL"],
        "edge_strategies": ["CALLS"],
        "graph_queries": [],
        "keywords": ["review"],
        "common_apis": [],
        "common_libraries": [],
        "patterns": [],
        "required_evidence": ["Human review control"],
        "supporting_evidence": [],
        "negative_evidence": [],
        "unresolved_conditions": [],
        "source_chunk_ids": ["LAW:A1"],
        "source_locators": ["art-1::cl-1"],
        "source_fingerprint": "sha256:fingerprint",
        "compiler_model": "triage",
    }


def _legal_rule() -> dict:
    return {
        "legalRuleId": "LEGAL-1",
        "citationLocatorRefs": [{"chunkId": "LAW:A1"}, {"chunkId": "LAW:A2"}],
    }


def _registry(tmp_path: Path, bundle: dict) -> PrecompiledEngineeringRuleRegistry:
    bundle_path = tmp_path / "bundle.json"
    bundle_path.write_text(json.dumps(bundle), encoding="utf-8")
    overrides_path = tmp_path / "contract-overrides.json"
    overrides_path.write_text("{}", encoding="utf-8")
    return PrecompiledEngineeringRuleRegistry(
        str(bundle_path),
        contract_overrides_path=str(overrides_path),
    )


def test_exported_bundle_recovers_the_rule_triage_persisted(tmp_path: Path) -> None:
    # The cited context is wider than the candidate chunk, which is the normal case:
    # CONTEXT_ONLY chunks stay in the grounding set even though no rule matches them.
    grounding = {"LAW:A1": "sha256:a1", "LAW:A2": "sha256:a2"}
    bundle = build_bundle(
        [
            build_template(
                _persisted_rule(),
                legal_rule_id="LEGAL-1",
                grounding_hashes=grounding,
            )
        ],
        bundle_id="lcsp-test",
        compiler_model="legal-rule-triage-subagent",
    )

    recovered = _registry(tmp_path, bundle).materialize(
        legal_rule=_legal_rule(),
        legal_rule_catalog_version_id="catalog-1",
        legal_corpus_version_id="corpus-1",
        legal_context=[
            {
                "id": "LAW:A1",
                "locator": "art-1::cl-1",
                "contentSha256": "sha256:a1",
                "legalStatus": "ACTIVE",
            },
            {
                "id": "LAW:A2",
                "locator": "art-1::cl-2",
                "contentSha256": "sha256:a2",
                "legalStatus": "ACTIVE",
            },
        ],
        source_fingerprint="sha256:fingerprint",
    )

    assert len(recovered) == 1
    rule = recovered[0]
    assert rule.engineering_rule_id == "LEGAL-1::PRECOMPILED::ENG-1"
    assert rule.concept == "HUMAN_OVERSIGHT"
    assert rule.investigation_goals == ("Find a bounded human-review path",)
    assert rule.required_evidence == ("Human review control",)
    assert rule.source_fingerprint == "sha256:fingerprint"


def test_cleared_cache_still_serves_ready_rules_from_the_exported_bundle(
    tmp_path: Path,
) -> None:
    """warm-up -> export -> cache wiped must still answer READY, with no LLM involved."""
    bundle = build_bundle(
        [
            build_template(
                _persisted_rule(),
                legal_rule_id="LEGAL-1",
                grounding_hashes={"LAW:A1": "sha256:a1"},
            )
        ],
        bundle_id="lcsp-test",
        compiler_model="legal-rule-triage-subagent",
    )
    retriever = MagicMock()
    retriever.retrieve_exact_context.return_value = [
        {
            "id": "LAW:A1",
            "locator": "art-1::cl-1",
            "contentSha256": "sha256:a1",
            "legalStatus": "ACTIVE",
        }
    ]
    cache = MagicMock()
    cache.get.return_value = []
    cache.is_triaged_without_rules.return_value = False
    service = EngineeringRuleService(
        retriever=retriever,
        cache=cache,
        precompiled_registry=_registry(tmp_path, bundle),
    )

    rules, cache_hit = service.get_or_compile(
        legal_rule={
            "legalRuleId": "LEGAL-1",
            "ruleFamily": "AI_HUMAN_OVERSIGHT",
            "citationLocatorRefs": [{"chunkId": "LAW:A1"}],
        },
        legal_rule_catalog_version_id="catalog-1",
        legal_corpus_version_id="corpus-1",
        workflow_run_id="assessment-run-1",
    )

    assert cache_hit is False
    assert [rule.concept for rule in rules] == ["HUMAN_OVERSIGHT"]
    assert cache.put.called


def test_export_rejects_context_it_cannot_hash_verify() -> None:
    with pytest.raises(ValueError, match="content hash for every cited chunk"):
        build_template(
            _persisted_rule(),
            legal_rule_id="LEGAL-1",
            grounding_hashes={"LAW:A1": ""},
        )


def test_export_rejects_candidate_chunks_outside_the_cited_context() -> None:
    with pytest.raises(ValueError, match="not grounded by the cited context"):
        build_template(
            _persisted_rule(),
            legal_rule_id="LEGAL-1",
            grounding_hashes={"LAW:A2": "sha256:a2"},
        )


def test_template_ids_stay_unique_within_one_legal_rule() -> None:
    assert template_id_for("LEGAL-1", "LEGAL-1::ENG::1") == "ENG-1"
    assert template_id_for("LEGAL-1", "LEGAL-1::ENG::2") == "ENG-2"
    assert template_id_for("LEGAL-1", "standalone") == "standalone"


def _no_rule_bundle(grounding: dict) -> dict:
    return build_bundle(
        [],
        bundle_id="lcsp-test",
        compiler_model="legal-rule-triage-subagent",
        no_rule_entries=[
            build_no_rule_entry(legal_rule_id="LEGAL-1", grounding_hashes=grounding)
        ],
    )


def test_context_only_decision_survives_a_cleared_cache(tmp_path: Path) -> None:
    """A rule triaged to no candidates must not look unprepared after a cache wipe."""
    retriever = MagicMock()
    retriever.retrieve_exact_context.return_value = [
        {
            "id": "LAW:A1",
            "locator": "art-1::cl-1",
            "contentSha256": "sha256:a1",
            "legalStatus": "ACTIVE",
        }
    ]
    cache = MagicMock()
    cache.get.return_value = []
    cache.is_triaged_without_rules.return_value = False
    service = EngineeringRuleService(
        retriever=retriever,
        cache=cache,
        precompiled_registry=_registry(tmp_path, _no_rule_bundle({"LAW:A1": "sha256:a1"})),
    )

    rules, cache_hit = service.get_or_compile(
        legal_rule={
            "legalRuleId": "LEGAL-1",
            "citationLocatorRefs": [{"chunkId": "LAW:A1"}],
        },
        legal_rule_catalog_version_id="catalog-1",
        legal_corpus_version_id="corpus-1",
        workflow_run_id="assessment-run-1",
    )

    assert rules == []
    # cache_hit True is what stops the readiness gate re-requesting triage.
    assert cache_hit is True
    cache.mark_no_engineering_rules.assert_called_once()


def test_no_rule_decision_retires_when_the_cited_text_changes(tmp_path: Path) -> None:
    retriever = MagicMock()
    retriever.retrieve_exact_context.return_value = [
        {
            "id": "LAW:A1",
            "locator": "art-1::cl-1",
            "contentSha256": "sha256:CHANGED",
            "legalStatus": "ACTIVE",
        }
    ]
    cache = MagicMock()
    cache.get.return_value = []
    cache.is_triaged_without_rules.return_value = False
    service = EngineeringRuleService(
        retriever=retriever,
        cache=cache,
        precompiled_registry=_registry(tmp_path, _no_rule_bundle({"LAW:A1": "sha256:a1"})),
    )

    rules, cache_hit = service.get_or_compile(
        legal_rule={
            "legalRuleId": "LEGAL-1",
            "citationLocatorRefs": [{"chunkId": "LAW:A1"}],
        },
        legal_rule_catalog_version_id="catalog-1",
        legal_corpus_version_id="corpus-1",
        workflow_run_id="assessment-run-1",
    )

    assert rules == []
    assert cache_hit is False
    cache.mark_no_engineering_rules.assert_not_called()
